import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { emailSchema, passwordSchema, type InviteStatus, type UserDto } from '@palestra/shared';
import { requireViewer, SESSION_COOKIE } from '../app.js';
import { withTx, type Queryable } from '../db.js';
import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors.js';

export async function getUserDto(db: Queryable, userId: string): Promise<UserDto> {
  const r = await db.query<{ id: string; email: string; display_name: string; role: 'coach' | 'athlete'; is_demo: boolean; coach_id: string | null; coach_name: string | null }>(
    `select u.id, u.email, u.display_name, u.role, u.is_demo, c.id as coach_id, c.display_name as coach_name
       from users u
       left join coach_links l on l.athlete_id = u.id and l.ended_at is null
       left join users c on c.id = l.coach_id
      where u.id = $1`,
    [userId],
  );
  const u = r.rows[0];
  if (!u) throw unauthorized();
  return {
    id: u.id, email: u.email, displayName: u.display_name, role: u.role, isDemo: u.is_demo,
    coach: u.coach_id && u.coach_name ? { id: u.coach_id, displayName: u.coach_name } : null,
  };
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const nameSchema = z.string().trim().min(1, 'Nome obbligatorio').max(80);

interface InviteRow {
  id: string;
  coach_id: string;
  coach_name: string;
  athlete_name: string;
  email: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

function inviteStatus(row: InviteRow | undefined): InviteStatus {
  if (!row) return 'invalid';
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  return 'valid';
}

const INVITE_MESSAGES: Record<Exclude<InviteStatus, 'valid'>, string> = {
  invalid: 'Invito non valido. Controlla il link o chiedine uno nuovo al coach.',
  expired: 'Invito scaduto. Chiedi al coach di generarne uno nuovo.',
  used: 'Invito già utilizzato. Se è il tuo, accedi con le tue credenziali.',
  revoked: 'Invito annullato dal coach.',
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, mailer } = app.deps;

  async function startSession(reply: FastifyReply, userId: string, userAgent: string | undefined): Promise<void> {
    const token = newToken();
    await db.query(
      `insert into auth_sessions(user_id, token_hash, expires_at, user_agent) values ($1, $2, now() + make_interval(days => $3), $4)`,
      [userId, hashToken(token), config.SESSION_DAYS, userAgent?.slice(0, 300) ?? null],
    );
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: config.SESSION_DAYS * 86400,
    });
  }

  const authLimit = { config: { rateLimit: { max: config.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } } };

  app.post('/auth/login', authLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const r = await db.query<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [body.email]);
    const user = r.rows[0];
    const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Email o password non corretti');
    await startSession(reply, user.id, req.headers['user-agent']);
    return getUserDto(db, user.id);
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionId) await db.query('delete from auth_sessions where id = $1', [req.sessionId]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => getUserDto(db, requireViewer(req).id));

  app.post('/auth/forgot', authLimit, async (req, reply) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const r = await db.query<{ id: string }>('select id from users where email = $1', [email]);
    const user = r.rows[0];
    if (user) {
      const token = newToken();
      await db.query(`insert into password_resets(token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [hashToken(token), user.id]);
      const url = `${config.APP_URL}/reimposta-password#${token}`;
      await mailer.send(email, 'APP PALESTRA · Recupero accesso', `Per scegliere una nuova password apri questo link entro un'ora:\n${url}\n\nSe non hai chiesto il recupero, ignora questo messaggio.`);
    }
    // Stessa risposta in ogni caso: non rivela quali email sono registrate.
    return reply.status(204).send();
  });

  app.post('/auth/reset', authLimit, async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).parse(req.body);
    const hash = await hashPassword(body.password);
    const userId = await withTx(db, async (tx) => {
      const r = await tx.query<{ user_id: string }>(
        `update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`,
        [hashToken(body.token)],
      );
      const row = r.rows[0];
      if (!row) throw badRequest('Link di recupero non valido o scaduto. Richiedine uno nuovo.', 'invalid_token');
      await tx.query('update users set password_hash = $2, password_changed_at = now() where id = $1', [row.user_id, hash]);
      await tx.query('delete from auth_sessions where user_id = $1', [row.user_id]); // invalida tutti i dispositivi
      await tx.query('delete from password_resets where user_id = $1 and used_at is null', [row.user_id]);
      return row.user_id;
    });
    await startSession(reply, userId, req.headers['user-agent']);
    return getUserDto(db, userId);
  });

  app.post('/auth/password', authLimit, async (req) => {
    const viewer = requireViewer(req);
    const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).parse(req.body);
    const r = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [viewer.id]);
    if (!(await verifyPassword(body.currentPassword, r.rows[0]?.password_hash ?? DUMMY_HASH))) throw badRequest('Password attuale non corretta');
    await db.query('update users set password_hash = $2, password_changed_at = now() where id = $1', [viewer.id, await hashPassword(body.newPassword)]);
    await db.query('delete from auth_sessions where user_id = $1 and id <> $2', [viewer.id, req.sessionId]);
    return { ok: true };
  });

  // ---------- inviti ----------

  async function loadInvite(q: Queryable, token: string, lock = false): Promise<InviteRow | undefined> {
    if (token.length < 20 || token.length > 200) return undefined;
    const r = await q.query<InviteRow>(
      `select i.id, i.coach_id, c.display_name as coach_name, i.athlete_name, i.email, i.expires_at, i.used_at, i.revoked_at
         from invites i join users c on c.id = i.coach_id where i.token_hash = $1 ${lock ? 'for update of i' : ''}`,
      [hashToken(token)],
    );
    return r.rows[0];
  }

  app.get<{ Params: { token: string } }>('/invites/:token', authLimit, async (req) => {
    const row = await loadInvite(db, req.params.token);
    const status = inviteStatus(row);
    return {
      status,
      message: status === 'valid' ? null : INVITE_MESSAGES[status],
      coachName: status === 'valid' ? row?.coach_name : null,
      athleteName: status === 'valid' ? row?.athlete_name : null,
      email: status === 'valid' ? row?.email : null,
    };
  });

  const acceptSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('register'), displayName: nameSchema, email: emailSchema, password: passwordSchema }),
    z.object({ mode: z.literal('login'), email: emailSchema, password: z.string().min(1).max(200) }),
    z.object({ mode: z.literal('current') }),
  ]);

  app.post<{ Params: { token: string } }>('/invites/:token/accept', authLimit, async (req, reply) => {
    const body = acceptSchema.parse(req.body);
    const pwHash = body.mode === 'register' ? await hashPassword(body.password) : null;
    const userId = await withTx(db, async (tx) => {
      const inv = await loadInvite(tx, req.params.token, true);
      const status = inviteStatus(inv);
      if (!inv || status !== 'valid') throw new HttpError(410, `invite_${status}`, INVITE_MESSAGES[status as Exclude<InviteStatus, 'valid'>]);

      let athleteId: string;
      if (body.mode === 'register') {
        const r = await tx.query<{ id: string }>(
          // Chi accetta l'invito di un coach di prova è a sua volta di prova: i dati demo restano confinati.
          `insert into users(email, password_hash, display_name, role, is_demo)
           select $1, $2, $3, 'athlete', c.is_demo from users c where c.id = $4
           on conflict (email) do nothing returning id`,
          [body.email, pwHash, body.displayName, inv.coach_id],
        );
        if (!r.rows[0]) throw conflict('Esiste già un account con questa email: scegli "Ho già un account".', 'email_taken');
        athleteId = r.rows[0].id;
      } else if (body.mode === 'login') {
        const r = await tx.query<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [body.email]);
        const ok = await verifyPassword(body.password, r.rows[0]?.password_hash ?? DUMMY_HASH);
        if (!r.rows[0] || !ok) throw new HttpError(401, 'invalid_credentials', 'Email o password non corretti');
        athleteId = r.rows[0].id;
      } else {
        if (!req.viewer) throw unauthorized();
        athleteId = req.viewer.id;
      }

      const u = await tx.query<{ role: string }>('select role from users where id = $1', [athleteId]);
      if (u.rows[0]?.role !== 'athlete') throw badRequest('Un account coach non può essere collegato come atleta.', 'not_athlete');
      if (athleteId === inv.coach_id) throw badRequest('Non puoi accettare un tuo invito.');

      const active = await tx.query<{ coach_id: string }>('select coach_id from coach_links where athlete_id = $1 and ended_at is null for update', [athleteId]);
      const current = active.rows[0];
      if (current && current.coach_id !== inv.coach_id) {
        throw conflict('Questo account è già collegato a un altro coach. Chiedi di scollegarlo prima di accettare.', 'already_linked');
      }
      if (!current) {
        await tx.query(
          `insert into coach_links(coach_id, athlete_id) values ($1, $2)
           on conflict (coach_id, athlete_id) do update set ended_at = null, created_at = now()`,
          [inv.coach_id, athleteId],
        );
      }
      await tx.query('update invites set used_at = now(), used_by = $2 where id = $1', [inv.id, athleteId]);
      return athleteId;
    });
    if (body.mode !== 'current') await startSession(reply, userId, req.headers['user-agent']);
    return getUserDto(db, userId);
  });
}
