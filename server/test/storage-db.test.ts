import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckDto } from '@palestra/shared';
import { expect200, setup, teardown, testJpeg, uuid, world, type Ctx, type World } from './helpers.js';

/** STORAGE_DRIVER=db (hosting gratuito senza disco): stesse regole di privacy, foto in PostgreSQL. */
describe('foto in database (STORAGE_DRIVER=db)', () => {
  let ctx: Ctx;
  let w: World;
  beforeAll(async () => {
    ctx = await setup({ storageDriver: 'db' });
    w = await world(ctx);
  });
  afterAll(() => teardown(ctx));

  const blobs = async () => (await ctx.db.query('select count(*)::int n from photo_blobs')).rows[0].n as number;

  it('upload, accesso, condivisione, revoca, sostituzione ed eliminazione', async () => {
    const id = uuid();
    expect200(await w.a.req('PUT', `/api/checks/${id}`, { checkDate: '2026-11-17', weightKg: 75, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: null, sharePhotos: false }));
    const up = await w.a.upload('PUT', `/api/checks/${id}/photos/front`, await testJpeg('#884455'), 'f.jpg', 'image/jpeg');
    expect200(up);
    const photoId = (up.body as CheckDto).photos[0]!.id;
    expect(await blobs()).toBe(1);
    expect(await readdir(ctx.storageDir)).toEqual([]); // nessun file su disco

    const own = await w.a.req('GET', `/api/photos/${photoId}`);
    expect(own.status).toBe(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect((await sharp(own.raw).metadata()).exif).toBeUndefined(); // EXIF/GPS rimossi anche qui

    expect((await w.coach.req('GET', `/api/photos/${photoId}`)).status).toBe(404); // privata
    expect((await w.b.req('GET', `/api/photos/${photoId}`)).status).toBe(404);
    expect200(await w.a.req('PATCH', `/api/checks/${id}/sharing`, { sharePhotos: true }));
    const shared = await w.coach.req('GET', `/api/photos/${photoId}`);
    expect(shared.status).toBe(200);
    expect(Buffer.compare(shared.raw, own.raw)).toBe(0);
    expect((await w.b.req('GET', `/api/photos/${photoId}`)).status).toBe(404);
    expect200(await w.a.req('PATCH', `/api/checks/${id}/sharing`, { sharePhotos: false }));
    expect((await w.coach.req('GET', `/api/photos/${photoId}`)).status).toBe(404); // revoca immediata

    // Sostituzione della stessa posa: il blob precedente viene eliminato
    expect200(await w.a.upload('PUT', `/api/checks/${id}/photos/front`, await testJpeg('#112233'), 'g.jpg', 'image/jpeg'));
    expect(await blobs()).toBe(1);
    expect200(await w.a.upload('PUT', `/api/checks/${id}/photos/side`, await testJpeg('#445566'), 's.jpg', 'image/jpeg'));
    expect(await blobs()).toBe(2);
    expect200(await w.a.req('DELETE', `/api/checks/${id}/photos/side`));
    expect(await blobs()).toBe(1);
    // Eliminazione del check: blob rimossi a cascata (via storage_gc)
    expect200(await w.a.req('DELETE', `/api/checks/${id}`));
    expect(await blobs()).toBe(0);
    expect((await ctx.db.query('select count(*)::int n from storage_gc')).rows[0].n).toBe(0);
  });

  it('un file non valido non lascia blob orfani', async () => {
    const id = uuid();
    expect200(await w.b.req('PUT', `/api/checks/${id}`, { checkDate: '2026-11-10', weightKg: 70, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: null, sharePhotos: false }));
    expect((await w.b.upload('PUT', `/api/checks/${id}/photos/front`, Buffer.from('<svg/>'), 'x.jpg', 'image/jpeg')).status).toBe(400);
    expect(await blobs()).toBe(0);
  });
});
