import { readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckDto, ExerciseContextDto, QuestionDto, ReviewItemDto, TodayBundleDto } from '@palestra/shared';
import { Device, expect200, PASSWORD, setup, teardown, testJpeg, uuid, world, type Ctx, type World } from './helpers.js';
import { purgeDemo } from '../src/seed.js';

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) n++;
  return n;
}

/** Priorità 4: check fisico, foto private, Chiedi al coach, coda Da rivedere, feedback visibile all'atleta. */
describe('check fisico e feedback', () => {
  let ctx: Ctx;
  let w: World;
  beforeAll(async () => {
    ctx = await setup();
    w = await world(ctx);
  });
  afterAll(() => teardown(ctx));

  it('giorno del check fissato dal coach → "Fai il check" in Oggi', async () => {
    const today = '2026-11-17'; // martedì
    expect200(await w.coach.req('PATCH', `/api/coach/athletes/${w.ids.a}`, { checkWeekday: 2 }));
    const b = (await w.a.req('GET', `/api/bundle?today=${today}`)).body as TodayBundleDto;
    expect(b.checkDue).toEqual({ weekday: 2, dueToday: true, doneToday: false });
    const other = (await w.a.req('GET', '/api/bundle?today=2026-11-18')).body as TodayBundleDto;
    expect(other.checkDue?.dueToday).toBe(false);
    expect((await w.b.req('GET', `/api/bundle?today=${today}`)).body.checkDue).toBeNull();
  });

  it('Atleta → check con foto (private) → Coach Da rivedere → feedback → Atleta lo ritrova nel check', async () => {
    const first = uuid();
    const last = uuid();
    // Check retrodatato + check di oggi
    expect200(await w.a.req('PUT', `/api/checks/${first}`, { checkDate: '2026-10-01', weightKg: 77.4, bicepsCm: 38, chestCm: 104, thighCm: 60, waistCm: 88, note: 'Inizio', sharePhotos: false }));
    expect200(await w.a.req('PUT', `/api/checks/${last}`, { checkDate: '2026-11-17', weightKg: 75.2, bicepsCm: 38.5, chestCm: 105, thighCm: 60.5, waistCm: 85, note: null, sharePhotos: false }));
    for (const [id, color] of [[first, '#553344'], [last, '#335544']] as const) {
      for (const pose of ['front', 'side', 'back']) {
        const up = await w.a.upload('PUT', `/api/checks/${id}/photos/${pose}`, await testJpeg(color), `${pose}.jpg`, 'image/jpeg');
        expect200(up);
      }
    }
    const mine = (await w.a.req('GET', '/api/checks')).body as CheckDto[];
    expect(mine.map((c) => c.checkDate)).toEqual(['2026-11-17', '2026-10-01']);
    expect(mine[0]!.photos).toHaveLength(3);
    expect(mine[0]!.sharePhotos).toBe(false); // privato per impostazione iniziale

    // Le foto salvate non contengono metadati EXIF/GPS
    const img = await w.a.req('GET', `/api/photos/${mine[0]!.photos[0]!.id}`);
    const meta = await sharp(img.raw).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');

    // Coach: il check è in Da rivedere, misure visibili, foto no
    let queue = (await w.coach.req('GET', '/api/coach/review')).body as ReviewItemDto[];
    const item = queue.find((q) => q.type === 'check' && q.id === last);
    expect(item).toMatchObject({ athleteId: w.ids.a, title: 'Check del 17/11' });
    expect(item!.detail).toContain('foto private');
    const coachView = (await w.coach.req('GET', `/api/checks/${last}`)).body as CheckDto;
    expect(coachView.weightKg).toBe(75.2);
    expect(coachView.photos).toEqual([]);

    // L'atleta condivide le foto di quel check
    expect200(await w.a.req('PATCH', `/api/checks/${last}/sharing`, { sharePhotos: true }));
    expect((await w.coach.req('GET', `/api/checks/${last}`)).body.photos).toHaveLength(3);
    expect((await w.coach.req('GET', `/api/checks/${first}`)).body.photos).toHaveLength(0);

    // Feedback del coach → esce dalla coda, resta nel profilo
    expect200(await w.coach.req('POST', `/api/checks/${last}/feedback`, { body: 'Ottimo calo in vita, mantieni le calorie.' }));
    queue = (await w.coach.req('GET', '/api/coach/review')).body;
    expect(queue.some((q) => q.id === last)).toBe(false);
    expect((await w.coach.req('GET', `/api/checks?userId=${w.ids.a}`)).body).toHaveLength(2);

    // Secondo dispositivo dell'atleta: ritrova check, foto e feedback
    const tablet = new Device(ctx.app);
    expect200(await tablet.login('atleta.a@demo.app-palestra.test', PASSWORD));
    const fromTablet = (await tablet.req('GET', `/api/checks/${last}`)).body as CheckDto;
    expect(fromTablet.feedback.map((f) => f.body)).toEqual(['Ottimo calo in vita, mantieni le calorie.']);
    expect(fromTablet.photos).toHaveLength(3);
    expect((await tablet.req('GET', `/api/photos/${fromTablet.photos[1]!.id}`)).status).toBe(200);

    // Revoca della visibilità: il coach perde subito l'accesso
    const photoId = fromTablet.photos[0]!.id;
    expect((await w.coach.req('GET', `/api/photos/${photoId}`)).status).toBe(200);
    expect200(await tablet.req('PATCH', `/api/checks/${last}/sharing`, { sharePhotos: false }));
    expect((await w.coach.req('GET', `/api/photos/${photoId}`)).status).toBe(404);

    // Eliminazione di una foto: record e file rimossi
    const filesBefore = await countFiles(ctx.storageDir);
    const after = (await w.a.req('DELETE', `/api/checks/${last}/photos/front`)).body as CheckDto;
    expect(after.photos.map((p) => p.pose).sort()).toEqual(['back', 'side']);
    expect(await countFiles(ctx.storageDir)).toBe(filesBefore - 1);
    expect((await w.a.req('GET', `/api/photos/${photoId}`)).status).toBe(404);

    // Eliminazione del check: anche le foto rimanenti spariscono dall'archivio
    expect200(await w.a.req('DELETE', `/api/checks/${last}`));
    expect(await countFiles(ctx.storageDir)).toBe(filesBefore - 3);
  });

  it('sostituire la foto di una posa elimina il file precedente', async () => {
    const id = uuid();
    expect200(await w.b.req('PUT', `/api/checks/${id}`, { checkDate: '2026-11-10', weightKg: 70, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: null, sharePhotos: false }));
    const n0 = await countFiles(ctx.storageDir);
    await w.b.upload('PUT', `/api/checks/${id}/photos/front`, await testJpeg('#111111'), 'a.jpg', 'image/jpeg');
    await w.b.upload('PUT', `/api/checks/${id}/photos/front`, await testJpeg('#222222'), 'b.jpg', 'image/jpeg');
    expect(await countFiles(ctx.storageDir)).toBe(n0 + 1);
    const bad = await w.b.upload('PUT', `/api/checks/${id}/photos/front`, Buffer.from('<svg onload=alert(1)>'), 'x.jpg', 'image/jpeg');
    expect(bad.status).toBe(400);
  });

  it('peso: inserimenti retrodatati e media settimanale disponibili', async () => {
    expect200(await w.a.req('PUT', `/api/weights/${uuid()}`, { measuredOn: '2026-11-16', weightKg: 75.6 }));
    expect200(await w.a.req('PUT', `/api/weights/${uuid()}`, { measuredOn: '2026-11-14', weightKg: 75.9 }));
    const list = (await w.a.req('GET', '/api/weights')).body as { measuredOn: string; source: string }[];
    expect(list.map((x) => `${x.measuredOn}:${x.source}`)).toEqual(['2026-11-16:entry', '2026-11-14:entry', '2026-10-01:check']);
    expect((await w.b.req('GET', `/api/weights?userId=${w.ids.a}`)).status).toBe(404);
  });

  it('Chiedi al coach → Da rivedere con atleta, esercizio e ultima prestazione → risposta nell\'esercizio', async () => {
    const qid = uuid();
    const q = (await w.a.req('PUT', `/api/questions/${qid}`, { exerciseName: 'Pendulum Squat', body: 'Posso scendere più in profondità?' })).body as QuestionDto;
    expect(q.exerciseKey).toBe('pendulum squat');
    // Idempotente: reinvio offline non duplica
    expect200(await w.a.req('PUT', `/api/questions/${qid}`, { exerciseName: 'Pendulum Squat', body: 'Posso scendere più in profondità?' }));
    const queue = (await w.coach.req('GET', '/api/coach/review')).body as ReviewItemDto[];
    const item = queue.filter((i) => i.type === 'question');
    expect(item).toHaveLength(1);
    expect(item[0]).toMatchObject({ athleteName: '[DEMO] Atleta A', title: 'Domanda · Pendulum Squat', detail: 'Posso scendere più in profondità?' });

    expect200(await w.coach.req('POST', `/api/questions/${qid}/answer`, { answer: 'Sì, fino a dove mantieni il bacino neutro.' }));
    expect200(await w.coach.req('POST', `/api/coach/athletes/${w.ids.a}/exercise-feedback`, { exerciseName: 'Pendulum Squat', body: 'Prossima volta +2,5 kg sul top set.' }));
    expect(((await w.coach.req('GET', '/api/coach/review')).body as ReviewItemDto[]).some((i) => i.type === 'question')).toBe(false);

    const ctxA = (await w.a.req('GET', `/api/exercises/${encodeURIComponent('Pendulum Squat')}/context`)).body as ExerciseContextDto;
    expect(ctxA.questions[0]).toMatchObject({ body: 'Posso scendere più in profondità?', answer: 'Sì, fino a dove mantieni il bacino neutro.' });
    expect(ctxA.feedback.map((f) => f.body)).toEqual(['Prossima volta +2,5 kg sul top set.']);
    // B non vede feedback né domande di A
    const ctxB = (await w.b.req('GET', `/api/exercises/${encodeURIComponent('Pendulum Squat')}/context`)).body as ExerciseContextDto;
    expect(ctxB.questions).toEqual([]);
    expect(ctxB.feedback).toEqual([]);
    // Un atleta senza coach non può fare domande
    expect200(await w.coach.req('DELETE', `/api/coach/athletes/${w.ids.b}`));
    expect((await w.b.req('PUT', `/api/questions/${uuid()}`, { exerciseName: 'Iliac', body: '?' })).body.error).toBe('no_coach');
  });

  it('i dati di esempio sono riconoscibili e rimovibili in blocco', async () => {
    const r = await ctx.db.query<{ email: string; display_name: string; is_demo: boolean }>("select email, display_name, is_demo from users where role = 'coach' or email like 'atleta.%'");
    for (const u of r.rows) {
      expect(u.is_demo).toBe(true);
      expect(u.email).toMatch(/@demo\.app-palestra\.test$/);
      expect(u.display_name).toMatch(/^\[DEMO\]/);
    }
    const n = await purgeDemo(ctx.db);
    expect(n).toBeGreaterThanOrEqual(3);
    const left = await ctx.db.query('select (select count(*) from users)::int u, (select count(*) from body_checks)::int c, (select count(*) from check_photos)::int p, (select count(*) from storage_gc)::int g');
    expect(left.rows[0]).toMatchObject({ u: 0, c: 0, p: 0 });
    expect(left.rows[0].g).toBeGreaterThan(0); // file accodati per la pulizia
    void path;
  });
});
