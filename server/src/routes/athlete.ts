import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exerciseKey, isoDateSchema, type TodayBundleDto } from '@palestra/shared';
import { requireViewer } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertCanView } from '../services/access.js';
import { listPrograms } from '../services/programs.js';
import { exerciseContexts, loadQuestions, loadWorkouts, SET_COLUMNS, toSetDto } from '../services/workouts.js';
import { getUserDto } from './auth.js';

const uuid = z.string().uuid();
const keySchema = z.string().trim().min(1).max(160);

export async function athleteRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  /**
   * Pacchetto unico per la vista Oggi e per l'uso offline: schede, seduta in corso e contesto di ogni esercizio.
   * Una sola richiesta riduce la latenza su rete mobile; il client lo conserva in IndexedDB.
   */
  app.get<{ Querystring: { today?: string } }>('/bundle', async (req): Promise<TodayBundleDto> => {
    const viewer = requireViewer(req);
    const today = req.query.today ? isoDateSchema.parse(req.query.today) : new Date().toISOString().slice(0, 10);
    const [user, programs, active] = await Promise.all([
      getUserDto(db, viewer.id),
      listPrograms(db, viewer.id, viewer.id),
      loadWorkouts(db, `athlete_id = $1 and status = 'in_progress'`, [viewer.id], 1),
    ]);
    const activeWorkout = active[0] ?? null;
    const keys = new Set<string>();
    for (const p of programs) for (const d of p.content.days) for (const e of d.exercises) keys.add(exerciseKey(e.name));
    if (activeWorkout) for (const e of activeWorkout.day.exercises) keys.add(exerciseKey(e.name));
    for (const st of Object.values(activeWorkout?.exerciseStates ?? {})) if (st.state === 'substituted') keys.add(exerciseKey(st.name));
    const contexts = await exerciseContexts(db, viewer.id, [...keys]);

    let checkDue: TodayBundleDto['checkDue'] = null;
    const link = await db.query<{ check_weekday: number | null }>('select check_weekday from coach_links where athlete_id = $1 and ended_at is null', [viewer.id]);
    const weekday = link.rows[0]?.check_weekday;
    if (weekday !== null && weekday !== undefined) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const done = await db.query('select 1 from body_checks where athlete_id = $1 and check_date = $2', [viewer.id, today]);
      checkDue = { weekday, dueToday: dow === weekday, doneToday: (done.rowCount ?? 0) > 0 };
    }
    return { user, programs, activeWorkout, contexts, checkDue, generatedAt: new Date().toISOString() };
  });

  app.get<{ Params: { key: string }; Querystring: { userId?: string } }>('/exercises/:key/context', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    const key = exerciseKey(keySchema.parse(req.params.key));
    return (await exerciseContexts(db, athleteId, [key]))[key];
  });

  app.put<{ Params: { key: string } }>('/exercise-notes/:key', async (req) => {
    const viewer = requireViewer(req);
    const key = exerciseKey(keySchema.parse(req.params.key));
    const { machineSetup } = z.object({ machineSetup: z.string().trim().max(300) }).parse(req.body);
    await db.query(
      `insert into exercise_notes(user_id, exercise_key, machine_setup) values ($1, $2, nullif($3, ''))
       on conflict (user_id, exercise_key) do update set machine_setup = excluded.machine_setup, updated_at = now()`,
      [viewer.id, key, machineSetup],
    );
    return { ok: true };
  });

  /** "Chiedi al coach": salva la domanda con l'ultima prestazione come contesto per il coach. */
  app.put<{ Params: { id: string } }>('/questions/:id', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const viewer = requireViewer(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ exerciseName: z.string().trim().min(1).max(120), body: z.string().trim().min(1, 'Scrivi la domanda').max(500) }).parse(req.body);
    const link = await db.query<{ coach_id: string }>('select coach_id from coach_links where athlete_id = $1 and ended_at is null', [viewer.id]);
    const coachId = link.rows[0]?.coach_id;
    if (!coachId) throw badRequest('Non sei collegato a un coach', 'no_coach');
    const key = exerciseKey(b.exerciseName);
    const ctx = (await exerciseContexts(db, viewer.id, [key]))[key];
    const context = {
      lastDate: ctx?.lastDate ?? null,
      sets: (ctx?.lastSets ?? []).filter((s) => s.kind === 'work').map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
    };
    await db.query(
      `insert into questions(id, athlete_id, coach_id, exercise_key, exercise_name, body, context) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [id, viewer.id, coachId, key, b.exerciseName, b.body, JSON.stringify(context)],
    );
    const q = (await loadQuestions(db, 'id = $1 and athlete_id = $2', [id, viewer.id]))[0];
    if (!q) throw notFound();
    return q;
  });

  app.get<{ Querystring: { userId?: string } }>('/questions', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    return loadQuestions(db, 'athlete_id = $1', [athleteId]);
  });

  // ---------- progressi ----------

  app.get<{ Querystring: { userId?: string } }>('/progress/exercises', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    const r = await db.query<{ exercise_key: string; exercise_name: string; last_at: Date; sessions: number; work_sets: number }>(
      `select s.exercise_key, (array_agg(s.exercise_name order by s.completed_at desc))[1] as exercise_name, max(s.completed_at) as last_at,
              count(distinct s.workout_id)::int as sessions, count(*) filter (where s.kind = 'work')::int as work_sets
         from workout_sets s join workouts w on w.id = s.workout_id
        where s.athlete_id = $1 and w.status = 'completed'
        group by s.exercise_key order by max(s.completed_at) desc`,
      [athleteId],
    );
    return r.rows.map((x) => ({ exerciseKey: x.exercise_key, exerciseName: x.exercise_name, lastAt: x.last_at.toISOString(), sessions: x.sessions, workSets: x.work_sets }));
  });

  app.get<{ Params: { key: string }; Querystring: { userId?: string } }>('/progress/exercises/:key', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    const key = exerciseKey(keySchema.parse(req.params.key));
    const r = await db.query(
      `select ${SET_COLUMNS.split(', ').map((c) => `s.${c}`).join(', ')} from workout_sets s join workouts w on w.id = s.workout_id
        where s.athlete_id = $1 and s.exercise_key = $2 and w.status = 'completed' order by s.completed_at limit 5000`,
      [athleteId, key],
    );
    return { exerciseKey: key, sets: r.rows.map(toSetDto) };
  });
}
