import { expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp, CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createCoach } from '../src/seed.js';
import { hashPassword } from '../src/lib/crypto.js';

export const PASSWORD = 'prova-sicura-123';

export interface Ctx {
  app: FastifyInstance;
  db: Db;
  storageDir: string;
}

export async function setup(): Promise<Ctx> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL non impostata (vedi .env.example)');
  if (!/test/i.test(url)) throw new Error('Per sicurezza TEST_DATABASE_URL deve contenere "test"');
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'palestra-test-'));
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, STORAGE_DIR: storageDir, APP_URL: 'http://app.test' });
  const db = createPool(url);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db, () => undefined);
  const app = await buildApp({ config, db });
  await app.ready();
  return { app, db, storageDir };
}

export async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  await ctx.db.end();
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  raw: Buffer;
}

/** Client che simula un dispositivo: conserva il proprio cookie di sessione. */
export class Device {
  cookie: string | null = null;
  constructor(private readonly app: FastifyInstance) {}

  async req<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, opts: { csrf?: boolean } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = {};
    if (opts.csrf !== false) headers[CSRF_HEADER] = CSRF_VALUE;
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
    const res = await this.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
    const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) this.cookie = set.value || null;
    let body: unknown = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body: body as T, headers: res.headers, raw: res.rawPayload };
  }

  async upload<T = any>(method: 'POST' | 'PUT', url: string, file: Buffer, filename: string, mime: string): Promise<Res<T>> {
    const boundary = '----palestra' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const headers: Record<string, string> = { [CSRF_HEADER]: CSRF_VALUE, 'content-type': `multipart/form-data; boundary=${boundary}` };
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
    const res = await this.app.inject({ method, url, headers, payload });
    let body: unknown = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body: body as T, headers: res.headers, raw: res.rawPayload };
  }

  async login(email: string, password = PASSWORD): Promise<Res> {
    return this.req('POST', '/api/auth/login', { email, password });
  }
}

export interface World {
  coach: Device;
  a: Device;
  b: Device;
  ids: { coach: string; a: string; b: string };
}

/** Coach + atleti A e B collegati tramite inviti reali (flusso completo). */
export async function world(ctx: Ctx, suffix = ''): Promise<World> {
  const coachEmail = `coach${suffix}@demo.app-palestra.test`;
  const coachId = await createCoach(ctx.db, { email: coachEmail, password: PASSWORD, displayName: '[DEMO] Coach', isDemo: true });
  const coach = new Device(ctx.app);
  expect200(await coach.login(coachEmail));
  const ids = { coach: coachId, a: '', b: '' };
  const devices: Record<'a' | 'b', Device> = { a: new Device(ctx.app), b: new Device(ctx.app) };
  for (const k of ['a', 'b'] as const) {
    const inv = await coach.req('POST', '/api/coach/invites', { athleteName: `[DEMO] Atleta ${k.toUpperCase()}` });
    expect200(inv);
    const token = String(inv.body.url).split('#')[1]!;
    const acc = await devices[k].req('POST', `/api/invites/${token}/accept`, { mode: 'register', displayName: `[DEMO] Atleta ${k.toUpperCase()}`, email: `atleta.${k}${suffix}@demo.app-palestra.test`, password: PASSWORD });
    expect200(acc);
    ids[k] = acc.body.id;
  }
  return { coach, a: devices.a, b: devices.b, ids };
}

export function expect200(res: Res): void {
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
}

export async function insertUser(db: Db, email: string, role: 'coach' | 'athlete', name: string): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into users(email, password_hash, display_name, role, is_demo) values ($1, $2, $3, $4, true) returning id`, [email, await hashPassword(PASSWORD), name, role]);
  return r.rows[0]!.id;
}

/** JPEG di prova con EXIF (incluso GPS) per verificare la rimozione dei metadati. */
export async function testJpeg(color: string): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 1200, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'Privacy-1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 27/1 0/1' } })
    .toBuffer();
}

export const uuid = (): string => crypto.randomUUID();
