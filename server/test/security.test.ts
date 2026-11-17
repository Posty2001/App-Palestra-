import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Device, expect200, insertUser, PASSWORD, setup, teardown, testJpeg, uuid, world, type Ctx, type World } from './helpers.js';

/** Priorità 1: accessi, inviti e isolamento dei dati tra coach, atleta A e atleta B. */
describe('accessi e isolamento', () => {
  let ctx: Ctx;
  let w: World;
  let workoutA: string;
  let checkA: string;
  let photoA: string;
  let programA: string;

  beforeAll(async () => {
    ctx = await setup();
    w = await world(ctx);
    // A ha una scheda assegnata dal coach, una seduta salvata e un check con foto PRIVATE.
    const coachPrograms = await w.coach.req('GET', '/api/programs');
    const assigned = await w.coach.req('POST', `/api/programs/${coachPrograms.body[0].id}/duplicate`, { ownerId: w.ids.a });
    expect200(assigned);
    programA = assigned.body.id;
    workoutA = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${workoutA}`, { programId: programA, programVersionId: assigned.body.currentVersionId, dayIndex: 0, startedAt: new Date().toISOString() }));
    expect200(await w.a.req('PUT', `/api/workouts/${workoutA}/sets/${uuid()}`, { exerciseSlot: 'x', exerciseKey: 'iliac', exerciseName: 'Iliac', kind: 'work', setIndex: 0, weightKg: 50, reps: 8, rir: 2, completedAt: new Date().toISOString() }));
    expect200(await w.a.req('POST', `/api/workouts/${workoutA}/finish`, { athleteNote: null, endedAt: new Date().toISOString() }));
    checkA = uuid();
    expect200(await w.a.req('PUT', `/api/checks/${checkA}`, { checkDate: '2026-11-15', weightKg: 75, bicepsCm: null, chestCm: null, thighCm: null, waistCm: 85, note: 'ok', sharePhotos: false }));
    const up = await w.a.upload('PUT', `/api/checks/${checkA}/photos/front`, await testJpeg('#884455'), 'front.jpg', 'image/jpeg');
    expect200(up);
    photoA = up.body.photos[0].id;
  });
  afterAll(() => teardown(ctx));

  it('senza sessione le API rispondono 401', async () => {
    const anon = new Device(ctx.app);
    for (const url of ['/api/auth/me', '/api/programs', '/api/checks', `/api/photos/${photoA}`, '/api/bundle']) {
      expect((await anon.req('GET', url)).status, url).toBe(401);
    }
  });

  it('richieste di modifica senza header anti-CSRF sono rifiutate', async () => {
    const r = await w.a.req('PUT', `/api/checks/${uuid()}`, { checkDate: '2026-11-01', weightKg: 70, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: null, sharePhotos: false }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('login errato: messaggio generico, nessuna enumerazione', async () => {
    const d = new Device(ctx.app);
    const wrongPw = await d.login('atleta.a@demo.app-palestra.test', 'sbagliata-123');
    const noUser = await d.login('nessuno@demo.app-palestra.test', 'sbagliata-123');
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.message).toBe(noUser.body.message);
  });

  it('atleta B non ottiene sessioni, check, foto, schede o progressi di A', async () => {
    const attempts: [string, string][] = [
      ['GET', `/api/workouts?userId=${w.ids.a}`],
      ['GET', `/api/workouts/${workoutA}`],
      ['GET', `/api/checks?userId=${w.ids.a}`],
      ['GET', `/api/checks/${checkA}`],
      ['GET', `/api/photos/${photoA}`],
      ['GET', `/api/programs?userId=${w.ids.a}`],
      ['GET', `/api/programs/${programA}`],
      ['GET', `/api/weights?userId=${w.ids.a}`],
      ['GET', `/api/progress/exercises?userId=${w.ids.a}`],
      ['GET', `/api/progress/exercises/iliac?userId=${w.ids.a}`],
      ['GET', `/api/questions?userId=${w.ids.a}`],
    ];
    for (const [m, url] of attempts) expect((await w.b.req(m as 'GET', url)).status, url).toBe(404);
  });

  it('atleta B non può modificare o cancellare dati di A (anche conoscendo gli id)', async () => {
    expect((await w.b.req('PUT', `/api/checks/${checkA}`, { checkDate: '2026-11-15', weightKg: 99, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: 'hack', sharePhotos: true })).status).toBe(404);
    expect((await w.b.req('PATCH', `/api/checks/${checkA}/sharing`, { sharePhotos: true })).status).toBe(404);
    expect((await w.b.req('DELETE', `/api/checks/${checkA}`)).status).toBe(404);
    expect((await w.b.req('DELETE', `/api/checks/${checkA}/photos/front`)).status).toBe(404);
    expect((await w.b.req('POST', `/api/workouts/${workoutA}/finish`, { athleteNote: 'x', endedAt: new Date().toISOString() })).status).toBe(404);
    expect((await w.b.req('PUT', `/api/programs/${programA}/draft`, { name: 'x', startDate: null, endDate: null, content: { days: [{ id: 'd', name: 'G', exercises: [] }] } })).status).toBe(404);
    // Il check di A è intatto
    const own = await w.a.req('GET', `/api/checks/${checkA}`);
    expect(own.body.weightKg).toBe(75);
    expect(own.body.sharePhotos).toBe(false);
  });

  it('B non può avviare una seduta su una scheda di A', async () => {
    const p = await w.a.req('GET', `/api/programs/${programA}`);
    const r = await w.b.req('PUT', `/api/workouts/${uuid()}`, { programId: programA, programVersionId: p.body.currentVersionId, dayIndex: 0, startedAt: new Date().toISOString() });
    expect(r.status).toBe(404);
  });

  it('un atleta non accede alle funzioni coach', async () => {
    expect((await w.a.req('GET', '/api/coach/athletes')).status).toBe(403);
    expect((await w.a.req('GET', '/api/coach/review')).status).toBe(403);
    expect((await w.a.req('POST', '/api/coach/invites', { athleteName: 'x' })).status).toBe(403);
    expect((await w.a.req('POST', `/api/coach/athletes/${w.ids.b}/exercise-feedback`, { exerciseName: 'Iliac', body: 'x' })).status).toBe(404);
  });

  it('il coach vede solo gli atleti collegati', async () => {
    const otherId = await insertUser(ctx.db, 'estraneo@demo.app-palestra.test', 'athlete', '[DEMO] Estraneo');
    const list = await w.coach.req('GET', '/api/coach/athletes');
    expect(list.body.map((x: { id: string }) => x.id).sort()).toEqual([w.ids.a, w.ids.b].sort());
    expect((await w.coach.req('GET', `/api/checks?userId=${otherId}`)).status).toBe(404);
    expect((await w.coach.req('GET', `/api/workouts?userId=${otherId}`)).status).toBe(404);
    // Un secondo coach non vede gli atleti del primo
    await insertUser(ctx.db, 'coach2@demo.app-palestra.test', 'coach', '[DEMO] Coach 2');
    const c2 = new Device(ctx.app);
    expect200(await c2.login('coach2@demo.app-palestra.test'));
    expect((await c2.req('GET', '/api/coach/athletes')).body).toEqual([]);
    expect((await c2.req('GET', `/api/checks?userId=${w.ids.a}`)).status).toBe(404);
    expect((await c2.req('GET', `/api/photos/${photoA}`)).status).toBe(404);
  });

  it('il coach vede le foto solo se autorizzate, e la revoca è immediata', async () => {
    let checks = await w.coach.req('GET', `/api/checks?userId=${w.ids.a}`);
    expect(checks.body[0].photos).toEqual([]);
    expect(checks.body[0].photoCount).toBe(1);
    expect((await w.coach.req('GET', `/api/photos/${photoA}`)).status).toBe(404);

    expect200(await w.a.req('PATCH', `/api/checks/${checkA}/sharing`, { sharePhotos: true }));
    checks = await w.coach.req('GET', `/api/checks?userId=${w.ids.a}`);
    expect(checks.body[0].photos).toHaveLength(1);
    const ok = await w.coach.req('GET', `/api/photos/${photoA}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toBe('private, no-store');

    expect200(await w.a.req('PATCH', `/api/checks/${checkA}/sharing`, { sharePhotos: false }));
    expect((await w.coach.req('GET', `/api/photos/${photoA}`)).status).toBe(404);
  });

  it('scollegare l\'atleta toglie subito l\'accesso del coach', async () => {
    const extra = new Device(ctx.app);
    const inv = await w.coach.req('POST', '/api/coach/invites', { athleteName: '[DEMO] Temporaneo' });
    const token = String(inv.body.url).split('#')[1];
    const acc = await extra.req('POST', `/api/invites/${token}/accept`, { mode: 'register', displayName: '[DEMO] Temporaneo', email: 'temp@demo.app-palestra.test', password: PASSWORD });
    expect200(acc);
    expect((await w.coach.req('GET', `/api/checks?userId=${acc.body.id}`)).status).toBe(200);
    expect200(await w.coach.req('DELETE', `/api/coach/athletes/${acc.body.id}`));
    expect((await w.coach.req('GET', `/api/checks?userId=${acc.body.id}`)).status).toBe(404);
  });

  describe('inviti', () => {
    it('stato e messaggi per invito non valido, usato, revocato, scaduto', async () => {
      const anon = new Device(ctx.app);
      expect((await anon.req('GET', '/api/invites/token-inesistente-xxxxxxxxxxxxxxxx')).body.status).toBe('invalid');

      const inv = await w.coach.req('POST', '/api/coach/invites', { athleteName: '[DEMO] C' });
      const token = String(inv.body.url).split('#')[1];
      expect(inv.body.url).toMatch(/^http:\/\/app\.test\/invito#/);
      expect((await anon.req('GET', `/api/invites/${token}`)).body).toMatchObject({ status: 'valid', athleteName: '[DEMO] C' });
      expect200(await anon.req('POST', `/api/invites/${token}/accept`, { mode: 'register', displayName: '[DEMO] C', email: 'c@demo.app-palestra.test', password: PASSWORD }));
      const again = await new Device(ctx.app).req('POST', `/api/invites/${token}/accept`, { mode: 'register', displayName: 'X', email: 'x@demo.app-palestra.test', password: PASSWORD });
      expect(again.status).toBe(410);
      expect(again.body.error).toBe('invite_used');

      const inv2 = await w.coach.req('POST', '/api/coach/invites', { athleteName: '[DEMO] D' });
      const t2 = String(inv2.body.url).split('#')[1];
      await w.coach.req('DELETE', `/api/coach/invites/${inv2.body.id}`);
      expect((await anon.req('GET', `/api/invites/${t2}`)).body.status).toBe('revoked');

      const inv3 = await w.coach.req('POST', '/api/coach/invites', { athleteName: '[DEMO] E' });
      const t3 = String(inv3.body.url).split('#')[1];
      await ctx.db.query(`update invites set expires_at = now() - interval '1 minute' where id = $1`, [inv3.body.id]);
      expect((await anon.req('GET', `/api/invites/${t3}`)).body.status).toBe('expired');
      expect((await anon.req('POST', `/api/invites/${t3}/accept`, { mode: 'register', displayName: 'E', email: 'e@demo.app-palestra.test', password: PASSWORD })).body.error).toBe('invite_expired');
    });

    it('un account esistente si collega con "Ho già un account"; non si ruba un account già collegato', async () => {
      const soloId = await insertUser(ctx.db, 'solo@demo.app-palestra.test', 'athlete', '[DEMO] Solo');
      const inv = await w.coach.req('POST', '/api/coach/invites', { athleteName: '[DEMO] Solo' });
      const token = String(inv.body.url).split('#')[1];
      const d = new Device(ctx.app);
      const r = await d.req('POST', `/api/invites/${token}/accept`, { mode: 'login', email: 'solo@demo.app-palestra.test', password: PASSWORD });
      expect200(r);
      expect(r.body.coach.id).toBe(w.ids.coach);
      expect(r.body.id).toBe(soloId);

      // Registrazione con email già usata → errore chiaro, nessun account duplicato
      const inv2 = await w.coach.req('POST', '/api/coach/invites', { athleteName: 'dup' });
      const t2 = String(inv2.body.url).split('#')[1];
      const dup = await new Device(ctx.app).req('POST', `/api/invites/${t2}/accept`, { mode: 'register', displayName: 'dup', email: 'solo@demo.app-palestra.test', password: PASSWORD });
      expect(dup.status).toBe(409);
    });

    it('il token dell\'invito non è salvato in chiaro', async () => {
      const inv = await w.coach.req('POST', '/api/coach/invites', { athleteName: 'hash' });
      const token = String(inv.body.url).split('#')[1]!;
      const r = await ctx.db.query('select count(*)::int as n from invites where encode(token_hash, \'escape\') like $1', [`%${token}%`]);
      expect(r.rows[0].n).toBe(0);
    });
  });

  describe('recupero accesso', () => {
    it('forgot non rivela le email; reset invalida le altre sessioni', async () => {
      const anon = new Device(ctx.app);
      expect((await anon.req('POST', '/api/auth/forgot', { email: 'nessuno@demo.app-palestra.test' })).status).toBe(204);
      expect((await anon.req('POST', '/api/auth/forgot', { email: 'atleta.b@demo.app-palestra.test' })).status).toBe(204);

      const link = await w.coach.req('POST', `/api/coach/athletes/${w.ids.b}/recovery-link`);
      const token = String(link.body.url).split('#')[1];
      const otherDevice = new Device(ctx.app);
      expect200(await otherDevice.login('atleta.b@demo.app-palestra.test'));
      const phone = new Device(ctx.app);
      expect200(await phone.req('POST', '/api/auth/reset', { token, password: 'nuova-password-456' }));
      expect((await otherDevice.req('GET', '/api/auth/me')).status).toBe(401);
      expect((await phone.req('GET', '/api/auth/me')).body.id).toBe(w.ids.b);
      expect((await new Device(ctx.app).req('POST', '/api/auth/reset', { token, password: 'altra-password-789' })).status).toBe(400);
      const relog = new Device(ctx.app);
      expect200(await relog.login('atleta.b@demo.app-palestra.test', 'nuova-password-456'));
      w.b = relog;
    });

    it('un coach non genera link di recupero per atleti non suoi', async () => {
      const other = await insertUser(ctx.db, 'altro@demo.app-palestra.test', 'athlete', 'x');
      expect((await w.coach.req('POST', `/api/coach/athletes/${other}/recovery-link`)).status).toBe(404);
    });
  });

  it('logout invalida la sessione lato server', async () => {
    const d = new Device(ctx.app);
    expect200(await d.login('atleta.a@demo.app-palestra.test'));
    const cookie = d.cookie;
    expect((await d.req('POST', '/api/auth/logout')).status).toBe(204);
    d.cookie = cookie;
    expect((await d.req('GET', '/api/auth/me')).status).toBe(401);
  });
});
