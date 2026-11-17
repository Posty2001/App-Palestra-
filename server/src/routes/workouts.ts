import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setInputSchema, type ProgramContent } from '@palestra/shared';
import { requireViewer } from '../app.js';
import { withTx, type Queryable } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { assertCanView, type Viewer } from '../services/access.js';
import { loadWorkout, loadWorkouts } from '../services/workouts.js';

const uuid = z.string().uuid();

const startSchema = z.object({
  programId: uuid,
  programVersionId: uuid,
  dayIndex: z.number().int().min(0).max(20),
  startedAt: z.string().datetime(),
});

const exerciseStateSchema = z.object({
  slot: z.string().min(1).max(64),
  state: z.union([
    z.null(),
    z.object({ state: z.literal('skipped') }),
    z.object({ state: z.literal('substituted'), name: z.string().trim().min(1).max(120) }),
  ]),
});

/** Solo il proprietario scrive sulle proprie sedute. Risposta 404 se la seduta non è sua. */
async function ownWorkout(db: Queryable, viewer: Viewer, id: string, lock = false): Promise<{ status: string; athlete_id: string } | null> {
  if (!uuid.safeParse(id).success) throw notFound();
  const r = await db.query<{ status: string; athlete_id: string }>(`select status, athlete_id from workouts where id = $1 ${lock ? 'for update' : ''}`, [id]);
  const row = r.rows[0];
  if (row && row.athlete_id !== viewer.id) throw notFound();
  return row ?? null;
}

function assertOpen(row: { status: string } | null): void {
  if (!row) throw notFound('Seduta non trovata');
  if (row.status !== 'in_progress') throw conflict('La seduta è già chiusa', 'workout_closed');
}

export async function workoutRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get<{ Querystring: { userId?: string; limit?: string; before?: string } }>('/workouts', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
    const before = req.query.before ? z.string().datetime().parse(req.query.before) : null;
    return loadWorkouts(db, `athlete_id = $1 and status = 'completed' ${before ? 'and started_at < $2' : ''}`, before ? [athleteId, before] : [athleteId], limit);
  });

  app.get('/workouts/active', async (req) => {
    const viewer = requireViewer(req);
    return (await loadWorkouts(db, `athlete_id = $1 and status = 'in_progress'`, [viewer.id], 1))[0] ?? null;
  });

  app.get<{ Params: { id: string } }>('/workouts/:id', async (req) => {
    const viewer = requireViewer(req);
    if (!uuid.safeParse(req.params.id).success) throw notFound();
    const w = await loadWorkout(db, req.params.id);
    if (!w) throw notFound();
    await assertCanView(db, viewer, w.athleteId);
    return w;
  });

  /** Avvio idempotente: lo stesso id (generato dal client, anche offline) non crea mai duplicati. */
  app.put<{ Params: { id: string } }>('/workouts/:id', async (req) => {
    const viewer = requireViewer(req);
    const body = startSchema.parse(req.body);
    const id = req.params.id;
    await withTx(db, async (tx) => {
      const existing = await ownWorkout(tx, viewer, id, true);
      if (existing) return;
      const v = await tx.query<{ content: ProgramContent; version_no: number; owner_id: string; name: string }>(
        `select v.content, v.version_no, p.owner_id, p.name from program_versions v join programs p on p.id = v.program_id
          where v.id = $1 and p.id = $2`,
        [body.programVersionId, body.programId],
      );
      const ver = v.rows[0];
      if (!ver || ver.owner_id !== viewer.id) throw notFound('Scheda non trovata');
      const day = ver.content.days[body.dayIndex];
      if (!day) throw badRequest('Giorno inesistente');
      const active = await tx.query<{ id: string }>(`select id from workouts where athlete_id = $1 and status = 'in_progress'`, [viewer.id]);
      if (active.rows[0]) throw conflict('C\'è già un allenamento in corso', 'active_exists');
      await tx.query(
        `insert into workouts(id, athlete_id, program_id, program_version_id, version_no, program_name, day_index, day_snapshot, status, started_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'in_progress', $9)`,
        [id, viewer.id, body.programId, body.programVersionId, ver.version_no, ver.name, body.dayIndex, JSON.stringify(day), body.startedAt],
      );
    });
    return loadWorkout(db, id);
  });

  /** Upsert idempotente della serie: ripetere la stessa richiesta (riconnessione) non duplica nulla. */
  app.put<{ Params: { id: string; setId: string } }>('/workouts/:id/sets/:setId', async (req) => {
    const viewer = requireViewer(req);
    const setId = uuid.parse(req.params.setId);
    const s = setInputSchema.parse(req.body);
    assertOpen(await ownWorkout(db, viewer, req.params.id));
    const r = await db.query(
      `insert into workout_sets(id, workout_id, athlete_id, exercise_slot, exercise_key, exercise_name, kind, set_index, weight_kg, reps, rir, completed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set weight_kg = excluded.weight_kg, reps = excluded.reps, rir = excluded.rir,
              exercise_name = excluded.exercise_name, exercise_key = excluded.exercise_key, updated_at = now()
        where workout_sets.workout_id = excluded.workout_id and workout_sets.athlete_id = excluded.athlete_id
       returning id`,
      [setId, req.params.id, viewer.id, s.exerciseSlot, s.exerciseKey, s.exerciseName, s.kind, s.setIndex, s.weightKg, s.reps, s.rir, s.completedAt],
    );
    if (!r.rowCount) throw notFound();
    await db.query('update workouts set updated_at = now() where id = $1', [req.params.id]);
    return { ok: true, id: setId };
  });

  app.delete<{ Params: { id: string; setId: string } }>('/workouts/:id/sets/:setId', async (req) => {
    const viewer = requireViewer(req);
    const setId = uuid.parse(req.params.setId);
    assertOpen(await ownWorkout(db, viewer, req.params.id));
    await db.query('delete from workout_sets where id = $1 and workout_id = $2 and athlete_id = $3', [setId, req.params.id, viewer.id]);
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/workouts/:id/exercise-state', async (req) => {
    const viewer = requireViewer(req);
    const body = exerciseStateSchema.parse(req.body);
    assertOpen(await ownWorkout(db, viewer, req.params.id));
    await db.query(
      `update workouts set exercise_states = case when $3::jsonb is null then exercise_states - $2 else jsonb_set(exercise_states, array[$2], $3::jsonb) end,
              updated_at = now() where id = $1`,
      [req.params.id, body.slot, body.state ? JSON.stringify(body.state) : null],
    );
    return { ok: true };
  });

  /** Salva (anche parziale) e aggiorna la rotazione della scheda eseguita. Idempotente. */
  app.post<{ Params: { id: string } }>('/workouts/:id/finish', async (req) => {
    const viewer = requireViewer(req);
    const body = z.object({ athleteNote: z.string().trim().max(2000).nullable(), endedAt: z.string().datetime() }).parse(req.body);
    await withTx(db, async (tx) => {
      const row = await ownWorkout(tx, viewer, req.params.id, true);
      if (!row) throw notFound('Seduta non trovata');
      if (row.status === 'completed') return;
      if (row.status !== 'in_progress') throw conflict('La seduta è stata scartata', 'workout_closed');
      const w = await tx.query<{ program_id: string | null; day_index: number }>(
        `update workouts set status = 'completed', ended_at = greatest($2::timestamptz, started_at), athlete_note = nullif($3, ''), updated_at = now()
          where id = $1 returning program_id, day_index`,
        [req.params.id, body.endedAt, body.athleteNote],
      );
      const done = w.rows[0];
      if (done?.program_id) {
        // Rotazione: giorno successivo a quello eseguito, sul numero di giorni della versione corrente.
        await tx.query(
          `update programs p set next_day_index = ($2 + 1) % greatest(jsonb_array_length(v.content->'days'), 1), updated_at = now()
             from program_versions v where v.id = p.current_version_id and p.id = $1 and p.owner_id = $3`,
          [done.program_id, done.day_index, viewer.id],
        );
      }
    });
    return loadWorkout(db, req.params.id);
  });

  /** Scarta: elimina le serie, non tocca la rotazione. La riga resta (stato "discarded") per bloccare sync tardive. */
  app.post<{ Params: { id: string } }>('/workouts/:id/discard', async (req) => {
    const viewer = requireViewer(req);
    await withTx(db, async (tx) => {
      const row = await ownWorkout(tx, viewer, req.params.id, true);
      if (!row || row.status === 'discarded') return;
      if (row.status === 'completed') throw conflict('Seduta già salvata', 'workout_closed');
      await tx.query('delete from workout_sets where workout_id = $1', [req.params.id]);
      await tx.query(`update workouts set status = 'discarded', ended_at = now(), updated_at = now() where id = $1`, [req.params.id]);
    });
    return { ok: true };
  });
}
