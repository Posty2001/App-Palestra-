import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { hashToken } from './lib/crypto.js';
import { HttpError, unauthorized } from './lib/errors.js';
import type { Viewer } from './services/access.js';
import { createMailer, type Mailer } from './services/mailer.js';
import { DbStorage, FsStorage, type PrivateStorage } from './services/storage.js';
import { authRoutes } from './routes/auth.js';
import { coachRoutes } from './routes/coach.js';
import { programRoutes } from './routes/programs.js';
import { workoutRoutes } from './routes/workouts.js';
import { checkRoutes } from './routes/checks.js';
import { athleteRoutes } from './routes/athlete.js';

export const SESSION_COOKIE = 'ap_session';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'app-palestra';

export interface AppDeps {
  config: Config;
  db: Db;
  storage?: PrivateStorage;
  mailer?: Mailer;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Required<AppDeps>;
  }
  interface FastifyRequest {
    viewer: Viewer | null;
    sessionId: string | null;
  }
}

export function requireViewer(req: FastifyRequest): Viewer {
  if (!req.viewer) throw unauthorized();
  return req.viewer;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  const storage = deps.storage ?? (config.STORAGE_DRIVER === 'db' ? new DbStorage(db) : new FsStorage(path.resolve(config.STORAGE_DIR)));
  const mailer = deps.mailer ?? createMailer(config.SMTP_URL, config.MAIL_FROM, app.log, config.NODE_ENV === 'production');
  app.decorate('deps', { config, db, storage, mailer });
  app.decorateRequest('viewer', null);
  app.decorateRequest('sessionId', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 5 } });

  // CSRF: le richieste che modificano dati devono avere un header personalizzato (impossibile cross-origin senza CORS).
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new HttpError(403, 'csrf', 'Richiesta non valida');
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const r = await db.query<{ session_id: string; id: string; role: 'coach' | 'athlete'; display_name: string; email: string; is_demo: boolean; stale: boolean }>(
      `select s.id as session_id, u.id, u.role, u.display_name, u.email, u.is_demo,
              s.last_seen_at < now() - interval '1 hour' as stale
         from auth_sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)],
    );
    const row = r.rows[0];
    if (!row) return;
    req.viewer = { id: row.id, role: row.role, displayName: row.display_name, email: row.email, isDemo: row.is_demo };
    req.sessionId = row.session_id;
    if (row.stale) {
      await db.query(`update auth_sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where id = $1`, [row.session_id, config.SESSION_DAYS]);
    }
  });

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message ?? 'Dati non validi', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === '23505') return reply.status(409).send({ error: 'conflict', message: 'Elemento già presente' });
    if (e.code === '23514' || e.code === '22P02' || e.code === '22003') return reply.status(400).send({ error: 'validation', message: 'Valore fuori dai limiti consentiti' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'error', message: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Errore interno' });
  });

  app.get('/api/health', async () => {
    await db.query('select 1');
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(coachRoutes, { prefix: '/api' });
  await app.register(programRoutes, { prefix: '/api' });
  await app.register(workoutRoutes, { prefix: '/api' });
  await app.register(checkRoutes, { prefix: '/api' });
  await app.register(athleteRoutes, { prefix: '/api' });

  // In produzione il server serve anche la PWA compilata (stessa origine → cookie SameSite senza CORS).
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, setHeaders: (res, file) => {
      if (file.endsWith('sw.js') || file.endsWith('index.html') || file.endsWith('.webmanifest')) res.header('cache-control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
    } });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.status(404).send({ error: 'not_found', message: 'Non trovato' });
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Non trovato' }));
  }

  return app;
}
