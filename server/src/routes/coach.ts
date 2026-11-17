import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailSchema, exerciseKey, type AthleteSummaryDto, type InviteDto, type ReviewItemDto } from '@palestra/shared';
import { requireViewer } from '../app.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { forbidden, notFound } from '../lib/errors.js';
import { assertCoachOf, type Viewer } from '../services/access.js';
import { loadQuestions } from '../services/workouts.js';

const uuid = z.string().uuid();

function requireCoach(viewer: Viewer): void {
  if (viewer.role !== 'coach') throw forbidden('Funzione riservata al coach');
}

export async function coachRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.deps;

  // ---------- inviti ----------

  app.post('/coach/invites', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    const b = z.object({ athleteName: z.string().trim().min(1, 'Nome atleta obbligatorio').max(80), email: emailSchema.nullable().optional() }).parse(req.body);
    const token = newToken();
    const r = await db.query<{ id: string; expires_at: Date; created_at: Date }>(
      `insert into invites(coach_id, token_hash, athlete_name, email, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5))
       returning id, expires_at, created_at`,
      [viewer.id, hashToken(token), b.athleteName, b.email ?? null, config.INVITE_DAYS],
    );
    const row = r.rows[0]!;
    // Il token in chiaro esiste solo in questa risposta: nel DB c'è l'hash. Va nel fragment (#) per non finire nei log HTTP.
    const dto: InviteDto = {
      id: row.id, athleteName: b.athleteName, email: b.email ?? null, expiresAt: row.expires_at.toISOString(), usedAt: null, revokedAt: null,
      createdAt: row.created_at.toISOString(), url: `${config.APP_URL}/invito#${token}`,
    };
    return reply.status(201).send(dto);
  });

  app.get('/coach/invites', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    const r = await db.query<{ id: string; athlete_name: string; email: string | null; expires_at: Date; used_at: Date | null; revoked_at: Date | null; created_at: Date }>(
      'select id, athlete_name, email, expires_at, used_at, revoked_at, created_at from invites where coach_id = $1 order by created_at desc limit 50',
      [viewer.id],
    );
    return r.rows.map((i): InviteDto => ({
      id: i.id, athleteName: i.athlete_name, email: i.email, expiresAt: i.expires_at.toISOString(), usedAt: i.used_at?.toISOString() ?? null,
      revokedAt: i.revoked_at?.toISOString() ?? null, createdAt: i.created_at.toISOString(),
    }));
  });

  app.delete<{ Params: { id: string } }>('/coach/invites/:id', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    await db.query('update invites set revoked_at = now() where id = $1 and coach_id = $2 and used_at is null and revoked_at is null', [uuid.parse(req.params.id), viewer.id]);
    return { ok: true };
  });

  // ---------- atleti ----------

  async function summaries(coachId: string, athleteId: string | null): Promise<AthleteSummaryDto[]> {
    const r = await db.query<{
      id: string; display_name: string; email: string; is_demo: boolean; linked_at: Date; check_weekday: number | null; key_exercises: string[];
      p_id: string | null; p_name: string | null; p_start: string | null; p_end: string | null;
      w_id: string | null; w_day: string | null; w_end: Date | null; c_id: string | null; c_date: string | null; pending: number;
    }>(
      `select u.id, u.display_name, u.email, u.is_demo, l.created_at as linked_at, l.check_weekday, l.key_exercises,
              p.id as p_id, p.name as p_name, p.start_date as p_start, p.end_date as p_end,
              w.id as w_id, w.day_snapshot->>'name' as w_day, w.ended_at as w_end,
              c.id as c_id, c.check_date as c_date,
              ((select count(*) from body_checks bc where bc.athlete_id = u.id and bc.reviewed_at is null and bc.created_at >= l.created_at)
             + (select count(*) from questions q where q.athlete_id = u.id and q.coach_id = l.coach_id and q.reviewed_at is null)
             + (select count(*) from workouts wn where wn.athlete_id = u.id and wn.status = 'completed' and wn.athlete_note is not null and wn.coach_reviewed_at is null and wn.started_at >= l.created_at))::int as pending
         from coach_links l join users u on u.id = l.athlete_id
         left join lateral (select * from programs where owner_id = u.id and archived_at is null order by updated_at desc limit 1) p on true
         left join lateral (select * from workouts where athlete_id = u.id and status = 'completed' order by started_at desc limit 1) w on true
         left join lateral (select * from body_checks where athlete_id = u.id order by check_date desc, created_at desc limit 1) c on true
        where l.coach_id = $1 and l.ended_at is null ${athleteId ? 'and u.id = $2' : ''}
        order by u.display_name`,
      athleteId ? [coachId, athleteId] : [coachId],
    );
    return r.rows.map((x) => ({
      id: x.id, displayName: x.display_name, email: x.email, isDemo: x.is_demo, linkedAt: x.linked_at.toISOString(), checkWeekday: x.check_weekday,
      keyExercises: x.key_exercises,
      activeProgram: x.p_id && x.p_name ? { id: x.p_id, name: x.p_name, startDate: x.p_start, endDate: x.p_end } : null,
      lastWorkout: x.w_id ? { id: x.w_id, dayName: x.w_day ?? '', endedAt: x.w_end?.toISOString() ?? null } : null,
      lastCheck: x.c_id && x.c_date ? { id: x.c_id, checkDate: x.c_date } : null,
      pendingReview: x.pending,
    }));
  }

  app.get('/coach/athletes', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    return summaries(viewer.id, null);
  });

  app.get<{ Params: { id: string } }>('/coach/athletes/:id', async (req) => {
    const viewer = requireViewer(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound();
    await assertCoachOf(db, viewer, id.data);
    const s = (await summaries(viewer.id, id.data))[0];
    if (!s) throw notFound();
    return s;
  });

  app.patch<{ Params: { id: string } }>('/coach/athletes/:id', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = uuid.parse(req.params.id);
    await assertCoachOf(db, viewer, athleteId);
    const b = z
      .object({ checkWeekday: z.number().int().min(0).max(6).nullable().optional(), keyExercises: z.array(z.string().trim().min(1).max(160)).max(3, 'Massimo 3 esercizi chiave').optional() })
      .parse(req.body);
    if (b.checkWeekday !== undefined) await db.query('update coach_links set check_weekday = $3 where coach_id = $1 and athlete_id = $2', [viewer.id, athleteId, b.checkWeekday]);
    if (b.keyExercises) await db.query('update coach_links set key_exercises = $3 where coach_id = $1 and athlete_id = $2', [viewer.id, athleteId, b.keyExercises.map(exerciseKey)]);
    return (await summaries(viewer.id, athleteId))[0];
  });

  /** Scollega: l'accesso del coach a dati e foto cessa immediatamente (ogni richiesta verifica il collegamento). */
  app.delete<{ Params: { id: string } }>('/coach/athletes/:id', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = uuid.parse(req.params.id);
    await assertCoachOf(db, viewer, athleteId);
    await db.query('update coach_links set ended_at = now() where coach_id = $1 and athlete_id = $2 and ended_at is null', [viewer.id, athleteId]);
    return { ok: true };
  });

  /** Recupero accesso senza email: il coach genera un link monouso (1 ora) da consegnare all'atleta. */
  app.post<{ Params: { id: string } }>('/coach/athletes/:id/recovery-link', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const viewer = requireViewer(req);
    const athleteId = uuid.parse(req.params.id);
    await assertCoachOf(db, viewer, athleteId);
    const token = newToken();
    await db.query(`insert into password_resets(token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [hashToken(token), athleteId]);
    return { url: `${config.APP_URL}/reimposta-password#${token}`, expiresInMinutes: 60 };
  });

  app.post<{ Params: { id: string } }>('/coach/athletes/:id/exercise-feedback', async (req, reply) => {
    const viewer = requireViewer(req);
    const athleteId = uuid.parse(req.params.id);
    await assertCoachOf(db, viewer, athleteId);
    const b = z.object({ exerciseName: z.string().trim().min(1).max(120), body: z.string().trim().min(1, 'Scrivi un\'indicazione').max(2000) }).parse(req.body);
    const r = await db.query<{ id: string }>(
      'insert into exercise_feedback(athlete_id, coach_id, exercise_key, exercise_name, body) values ($1, $2, $3, $4, $5) returning id',
      [athleteId, viewer.id, exerciseKey(b.exerciseName), b.exerciseName, b.body],
    );
    return reply.status(201).send({ id: r.rows[0]!.id });
  });

  app.post<{ Params: { id: string } }>('/questions/:id/answer', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    const id = uuid.parse(req.params.id);
    const { answer } = z.object({ answer: z.string().trim().min(1, 'Scrivi la risposta').max(2000) }).parse(req.body);
    const r = await db.query<{ athlete_id: string }>('select athlete_id from questions where id = $1', [id]);
    if (!r.rows[0]) throw notFound();
    await assertCoachOf(db, viewer, r.rows[0].athlete_id);
    await db.query('update questions set answer = $2, answered_at = now(), reviewed_at = now() where id = $1', [id, answer]);
    return (await loadQuestions(db, 'id = $1', [id]))[0];
  });

  // ---------- coda "Da rivedere" ----------

  app.get('/coach/review', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    const r = await db.query<{ type: ReviewItemDto['type']; id: string; athlete_id: string; athlete_name: string; at: Date; title: string; detail: string; exercise_key: string | null }>(
      `select 'check' as type, c.id, u.id as athlete_id, u.display_name as athlete_name, c.created_at as at,
              'Check del ' || to_char(c.check_date, 'DD/MM') as title,
              concat_ws(' · ', 'Peso ' || replace(trim_scale(c.weight_kg)::text, '.', ',') || ' kg', case when c.share_photos then 'foto condivise' else 'foto private' end) as detail,
              null as exercise_key
         from body_checks c join coach_links l on l.athlete_id = c.athlete_id and l.coach_id = $1 and l.ended_at is null
         join users u on u.id = c.athlete_id
        where c.reviewed_at is null and c.created_at >= l.created_at
       union all
       select 'question', q.id, u.id, u.display_name, q.created_at, 'Domanda · ' || q.exercise_name, q.body, q.exercise_key
         from questions q join coach_links l on l.athlete_id = q.athlete_id and l.coach_id = $1 and l.ended_at is null
         join users u on u.id = q.athlete_id
        where q.coach_id = $1 and q.reviewed_at is null
       union all
       select 'workout_note', w.id, u.id, u.display_name, w.ended_at, 'Nota allenamento · ' || (w.day_snapshot->>'name'), w.athlete_note, null
         from workouts w join coach_links l on l.athlete_id = w.athlete_id and l.coach_id = $1 and l.ended_at is null
         join users u on u.id = w.athlete_id
        where w.status = 'completed' and w.athlete_note is not null and w.coach_reviewed_at is null and w.started_at >= l.created_at
       union all
       select 'program_expiry', p.id, u.id, u.display_name, p.end_date::timestamptz,
              case when p.end_date < current_date then 'Scheda scaduta' else 'Scheda in scadenza' end,
              p.name || ' · fine ' || to_char(p.end_date, 'DD/MM/YYYY'), null
         from programs p join coach_links l on l.athlete_id = p.owner_id and l.coach_id = $1 and l.ended_at is null
         join users u on u.id = p.owner_id
        where p.archived_at is null and p.end_date is not null and p.end_date <= current_date + 7 and p.expiry_reviewed_at is null
       order by at desc
       limit 200`,
      [viewer.id],
    );
    return r.rows.map((x) => ({
      type: x.type, id: x.id, athleteId: x.athlete_id, athleteName: x.athlete_name, at: x.at.toISOString(), title: x.title, detail: x.detail ?? '',
      ...(x.type === 'question' ? { exerciseKey: x.exercise_key ?? '' } : {}),
    })) as ReviewItemDto[];
  });

  /** Segna come rivisto: esce dalla coda ma resta consultabile nel profilo. */
  app.post<{ Params: { type: string; id: string } }>('/coach/review/:type/:id', async (req) => {
    const viewer = requireViewer(req);
    requireCoach(viewer);
    const type = z.enum(['check', 'question', 'workout_note', 'program_expiry']).parse(req.params.type);
    const id = uuid.parse(req.params.id);
    const table = { check: ['body_checks', 'athlete_id', 'reviewed_at'], question: ['questions', 'athlete_id', 'reviewed_at'], workout_note: ['workouts', 'athlete_id', 'coach_reviewed_at'], program_expiry: ['programs', 'owner_id', 'expiry_reviewed_at'] }[type];
    const [tbl, ownerCol, col] = table as [string, string, string];
    const r = await db.query<{ owner: string }>(`select ${ownerCol} as owner from ${tbl} where id = $1`, [id]);
    if (!r.rows[0]) throw notFound();
    await assertCoachOf(db, viewer, r.rows[0].owner);
    await db.query(`update ${tbl} set ${col} = coalesce(${col}, now()) where id = $1`, [id]);
    return { ok: true };
  });
}
