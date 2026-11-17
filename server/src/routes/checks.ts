import type { FastifyInstance } from 'fastify';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { isoDateSchema, POSES, type CheckDto, type Pose, type WeightDto } from '@palestra/shared';
import { requireViewer } from '../app.js';
import { withTx, type Queryable } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertCanView, assertCoachOf, type Access, type Viewer } from '../services/access.js';

const uuid = z.string().uuid();
const num = (min: number, max: number) => z.number().min(min).max(max).nullable();

const checkSchema = z.object({
  checkDate: isoDateSchema,
  weightKg: num(20, 400),
  bicepsCm: num(10, 100),
  chestCm: num(40, 250),
  thighCm: num(20, 150),
  waistCm: num(30, 250),
  note: z.string().trim().max(2000).nullable(),
  sharePhotos: z.boolean(),
});

interface CheckRow {
  id: string; athlete_id: string; check_date: string; weight_kg: number | null; biceps_cm: number | null; chest_cm: number | null;
  thigh_cm: number | null; waist_cm: number | null; note: string | null; share_photos: boolean; reviewed_at: Date | null; created_at: Date;
}

const MAX_PIXELS = 40_000_000;

/**
 * Normalizza la foto: verifica il formato reale (non l'estensione), ruota secondo EXIF, ridimensiona
 * e RIMUOVE tutti i metadati (posizione GPS, dispositivo) prima di salvarla.
 */
async function processPhoto(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw badRequest('Immagine non valida', 'invalid_image');
  }
  if (!meta.format || !['jpeg', 'png', 'webp', 'heif', 'avif'].includes(meta.format)) throw badRequest('Formato non supportato (usa JPEG, PNG, WebP o HEIC)', 'invalid_image');
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw badRequest('Impossibile elaborare l\'immagine (formato HEIC non supportato su questo server? Prova JPEG).', 'invalid_image');
  }
}

async function loadChecks(db: Queryable, viewer: Viewer, access: Access, where: string, params: unknown[]): Promise<CheckDto[]> {
  const c = await db.query<CheckRow>(
    `select id, athlete_id, check_date, weight_kg, biceps_cm, chest_cm, thigh_cm, waist_cm, note, share_photos, reviewed_at, created_at
       from body_checks where ${where} order by check_date desc, created_at desc limit 200`,
    params,
  );
  const ids = c.rows.map((r) => r.id);
  if (!ids.length) return [];
  const [photos, feedback] = await Promise.all([
    db.query<{ id: string; check_id: string; pose: Pose; width: number; height: number }>(
      'select id, check_id, pose, width, height from check_photos where check_id = any($1)',
      [ids],
    ),
    db.query<{ id: string; check_id: string; body: string; created_at: Date; coach_name: string }>(
      `select f.id, f.check_id, f.body, f.created_at, u.display_name as coach_name from check_feedback f join users u on u.id = f.coach_id
        where f.check_id = any($1) order by f.created_at`,
      [ids],
    ),
  ]);
  return c.rows.map((r) => {
    const all = photos.rows.filter((p) => p.check_id === r.id);
    const visible = access === 'self' || r.share_photos; // il coach vede le foto solo se condivise ORA
    return {
      id: r.id, athleteId: r.athlete_id, checkDate: r.check_date, weightKg: r.weight_kg, bicepsCm: r.biceps_cm, chestCm: r.chest_cm,
      thighCm: r.thigh_cm, waistCm: r.waist_cm, note: r.note, sharePhotos: r.share_photos, reviewedAt: r.reviewed_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      photos: visible ? all.map((p) => ({ id: p.id, pose: p.pose, width: p.width, height: p.height })) : [],
      photoCount: all.length,
      feedback: feedback.rows.filter((f) => f.check_id === r.id).map((f) => ({ id: f.id, body: f.body, createdAt: f.created_at.toISOString(), coachName: f.coach_name })),
    };
  });
}

export async function checkRoutes(app: FastifyInstance): Promise<void> {
  const { db, storage } = app.deps;

  async function ownCheck(viewer: Viewer, id: string): Promise<CheckRow> {
    if (!uuid.safeParse(id).success) throw notFound();
    const r = await db.query<CheckRow>('select * from body_checks where id = $1', [id]);
    const row = r.rows[0];
    if (!row || row.athlete_id !== viewer.id) throw notFound();
    return row;
  }

  async function drainGc(): Promise<void> {
    const r = await db.query<{ storage_key: string }>('delete from storage_gc returning storage_key');
    for (const { storage_key } of r.rows) {
      await storage.delete(storage_key).catch((err: unknown) => {
        app.log.error({ err, storage_key }, 'eliminazione file fallita: riaccodo');
        return db.query('insert into storage_gc(storage_key) values ($1) on conflict do nothing', [storage_key]);
      });
    }
  }

  app.get<{ Querystring: { userId?: string } }>('/checks', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    const access = await assertCanView(db, viewer, athleteId);
    return loadChecks(db, viewer, access, 'athlete_id = $1', [athleteId]);
  });

  app.get<{ Params: { id: string } }>('/checks/:id', async (req) => {
    const viewer = requireViewer(req);
    if (!uuid.safeParse(req.params.id).success) throw notFound();
    const r = await db.query<{ athlete_id: string }>('select athlete_id from body_checks where id = $1', [req.params.id]);
    if (!r.rows[0]) throw notFound();
    const access = await assertCanView(db, viewer, r.rows[0].athlete_id);
    return (await loadChecks(db, viewer, access, 'id = $1', [req.params.id]))[0];
  });

  /** Crea o aggiorna (id dal client → idempotente). Retrodatabile. */
  app.put<{ Params: { id: string } }>('/checks/:id', async (req) => {
    const viewer = requireViewer(req);
    const id = uuid.parse(req.params.id);
    const b = checkSchema.parse(req.body);
    const r = await db.query(
      `insert into body_checks(id, athlete_id, check_date, weight_kg, biceps_cm, chest_cm, thigh_cm, waist_cm, note, share_photos)
       values ($1, $2, $3, $4, $5, $6, $7, $8, nullif($9, ''), $10)
       on conflict (id) do update set check_date = excluded.check_date, weight_kg = excluded.weight_kg, biceps_cm = excluded.biceps_cm,
         chest_cm = excluded.chest_cm, thigh_cm = excluded.thigh_cm, waist_cm = excluded.waist_cm, note = excluded.note,
         share_photos = excluded.share_photos, updated_at = now()
       where body_checks.athlete_id = excluded.athlete_id
       returning id`,
      [id, viewer.id, b.checkDate, b.weightKg, b.bicepsCm, b.chestCm, b.thighCm, b.waistCm, b.note, b.sharePhotos],
    );
    if (!r.rowCount) throw notFound();
    return (await loadChecks(db, viewer, 'self', 'id = $1', [id]))[0];
  });

  app.patch<{ Params: { id: string } }>('/checks/:id/sharing', async (req) => {
    const viewer = requireViewer(req);
    const { sharePhotos } = z.object({ sharePhotos: z.boolean() }).parse(req.body);
    const row = await ownCheck(viewer, req.params.id);
    await db.query('update body_checks set share_photos = $2, updated_at = now() where id = $1', [row.id, sharePhotos]);
    return (await loadChecks(db, viewer, 'self', 'id = $1', [row.id]))[0];
  });

  app.delete<{ Params: { id: string } }>('/checks/:id', async (req) => {
    const viewer = requireViewer(req);
    const row = await ownCheck(viewer, req.params.id);
    await db.query('delete from body_checks where id = $1', [row.id]);
    await drainGc();
    return { ok: true };
  });

  app.put<{ Params: { id: string; pose: string } }>('/checks/:id/photos/:pose', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const viewer = requireViewer(req);
    const pose = z.enum(POSES as unknown as [Pose, ...Pose[]]).parse(req.params.pose);
    const row = await ownCheck(viewer, req.params.id);
    const file = await req.file();
    if (!file) throw badRequest('Nessuna foto ricevuta');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('Foto troppo grande (max 12 MB)');
    const img = await processPhoto(buf);
    const key = await storage.put(img.data);
    try {
      await withTx(db, async (tx) => {
        await tx.query('delete from check_photos where check_id = $1 and pose = $2', [row.id, pose]); // il trigger accoda il file vecchio
        await tx.query(
          `insert into check_photos(check_id, athlete_id, pose, storage_key, mime, bytes, width, height) values ($1, $2, $3, $4, 'image/jpeg', $5, $6, $7)`,
          [row.id, viewer.id, pose, key, img.data.length, img.width, img.height],
        );
      });
    } catch (err) {
      await storage.delete(key);
      throw err;
    }
    await drainGc();
    return (await loadChecks(db, viewer, 'self', 'id = $1', [row.id]))[0];
  });

  app.delete<{ Params: { id: string; pose: string } }>('/checks/:id/photos/:pose', async (req) => {
    const viewer = requireViewer(req);
    const pose = z.enum(POSES as unknown as [Pose, ...Pose[]]).parse(req.params.pose);
    const row = await ownCheck(viewer, req.params.id);
    await db.query('delete from check_photos where check_id = $1 and pose = $2', [row.id, pose]);
    await drainGc();
    return (await loadChecks(db, viewer, 'self', 'id = $1', [row.id]))[0];
  });

  /** Unico punto di accesso ai file: proprietà o (collegamento attivo E condivisione attiva) verificati a ogni richiesta. */
  app.get<{ Params: { id: string } }>('/photos/:id', async (req, reply) => {
    const viewer = requireViewer(req);
    if (!uuid.safeParse(req.params.id).success) throw notFound();
    const r = await db.query<{ storage_key: string; athlete_id: string; share_photos: boolean }>(
      `select p.storage_key, p.athlete_id, c.share_photos from check_photos p join body_checks c on c.id = p.check_id where p.id = $1`,
      [req.params.id],
    );
    const row = r.rows[0];
    if (!row) throw notFound();
    const access = await assertCanView(db, viewer, row.athlete_id);
    if (access === 'coach' && !row.share_photos) throw notFound();
    const data = await storage.get(row.storage_key);
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .send(data);
  });

  app.post<{ Params: { id: string } }>('/checks/:id/feedback', async (req, reply) => {
    const viewer = requireViewer(req);
    const { body } = z.object({ body: z.string().trim().min(1, 'Scrivi un commento').max(2000) }).parse(req.body);
    if (!uuid.safeParse(req.params.id).success) throw notFound();
    const r = await db.query<{ athlete_id: string }>('select athlete_id from body_checks where id = $1', [req.params.id]);
    if (!r.rows[0]) throw notFound();
    await assertCoachOf(db, viewer, r.rows[0].athlete_id);
    await db.query('insert into check_feedback(check_id, coach_id, body) values ($1, $2, $3)', [req.params.id, viewer.id, body]);
    await db.query('update body_checks set reviewed_at = coalesce(reviewed_at, now()) where id = $1', [req.params.id]);
    return reply.status(201).send((await loadChecks(db, viewer, 'coach', 'id = $1', [req.params.id]))[0]);
  });

  // ---------- peso ----------

  app.get<{ Querystring: { userId?: string } }>('/weights', async (req) => {
    const viewer = requireViewer(req);
    const athleteId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, athleteId);
    const r = await db.query<{ id: string; measured_on: string; weight_kg: number; source: 'entry' | 'check' }>(
      `select id, measured_on, weight_kg, 'entry' as source from weight_entries where athlete_id = $1
       union all
       select id, check_date, weight_kg, 'check' from body_checks where athlete_id = $1 and weight_kg is not null
       order by 2 desc limit 500`,
      [athleteId],
    );
    return r.rows.map((w): WeightDto => ({ id: w.id, measuredOn: w.measured_on, weightKg: w.weight_kg, source: w.source }));
  });

  app.put<{ Params: { id: string } }>('/weights/:id', async (req) => {
    const viewer = requireViewer(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ measuredOn: isoDateSchema, weightKg: z.number().min(20).max(400) }).parse(req.body);
    const r = await db.query(
      `insert into weight_entries(id, athlete_id, measured_on, weight_kg) values ($1, $2, $3, $4)
       on conflict (id) do update set measured_on = excluded.measured_on, weight_kg = excluded.weight_kg where weight_entries.athlete_id = excluded.athlete_id`,
      [id, viewer.id, b.measuredOn, b.weightKg],
    );
    if (!r.rowCount) throw notFound();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/weights/:id', async (req) => {
    const viewer = requireViewer(req);
    await db.query('delete from weight_entries where id = $1 and athlete_id = $2', [uuid.parse(req.params.id), viewer.id]);
    return { ok: true };
  });
}
