import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exerciseKey, type ProgramDetailDto, type TodayBundleDto, type WorkoutDto } from '@palestra/shared';
import { Device, expect200, PASSWORD, setup, teardown, uuid, world, type Ctx, type World } from './helpers.js';

/** Priorità 3 (lato server): salvataggio progressivo, idempotenza della sync, versione congelata, rotazione. */
describe('sedute', () => {
  let ctx: Ctx;
  let w: World;
  let program: ProgramDetailDto;

  beforeAll(async () => {
    ctx = await setup();
    w = await world(ctx);
    const base = (await w.coach.req('GET', '/api/programs')).body[0] as ProgramDetailDto;
    program = (await w.coach.req('POST', `/api/programs/${base.id}/duplicate`, { ownerId: w.ids.a, name: 'Massa' })).body;
  });
  afterAll(() => teardown(ctx));

  const pendulumSet = (workoutId: string, slot: string, setIndex: number, weightKg: number, reps: number, kind: 'work' | 'warmup' = 'work') => ({
    exerciseSlot: slot, exerciseKey: exerciseKey('Pendulum Squat'), exerciseName: 'Pendulum Squat', kind, setIndex, weightKg, reps, rir: 1,
    completedAt: new Date().toISOString(), workoutId,
  });

  it('Giorno 3 → Pendulum: serie, ripetizione della stessa richiesta (riconnessione) senza duplicati', async () => {
    const id = uuid();
    const start = { programId: program.id, programVersionId: program.currentVersionId, dayIndex: 2, startedAt: new Date().toISOString() };
    const w1 = (await w.a.req('PUT', `/api/workouts/${id}`, start)).body as WorkoutDto;
    expect(w1.day.exercises[2]!.name).toBe('Pendulum Squat');
    // Stesso avvio ripetuto (es. sync dopo timeout): nessuna seconda seduta
    expect((await w.a.req('PUT', `/api/workouts/${id}`, start)).status).toBe(200);
    // Un altro avvio mentre c'è una seduta in corso → conflitto esplicito
    expect((await w.a.req('PUT', `/api/workouts/${uuid()}`, start)).body.error).toBe('active_exists');

    const slot = w1.day.exercises[2]!.id;
    const warm = uuid();
    const s1 = uuid();
    const s2 = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${warm}`, pendulumSet(id, slot, 0, 40, 10, 'warmup')));
    for (let i = 0; i < 3; i++) expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${s1}`, pendulumSet(id, slot, 0, 60, 7)));
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${s2}`, pendulumSet(id, slot, 1, 65, 5)));
    // Correzione della serie 2 (stesso id) → aggiorna, non duplica
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${s2}`, pendulumSet(id, slot, 1, 65, 6)));

    // Nuovo accesso con la stessa utenza da un altro dispositivo: la seduta in sospeso è recuperabile
    const phone2 = new Device(ctx.app);
    expect200(await phone2.login('atleta.a@demo.app-palestra.test', PASSWORD));
    const bundle = (await phone2.req('GET', '/api/bundle')).body as TodayBundleDto;
    expect(bundle.activeWorkout?.id).toBe(id);
    expect(bundle.activeWorkout?.sets).toHaveLength(3);

    const fin = { athleteNote: 'Pendulum pesante oggi', endedAt: new Date().toISOString() };
    const done = (await w.a.req('POST', `/api/workouts/${id}/finish`, fin)).body as WorkoutDto;
    expect(done.status).toBe('completed');
    expect((await w.a.req('POST', `/api/workouts/${id}/finish`, fin)).status).toBe(200); // idempotente
    // Dopo il salvataggio nessuna scrittura tardiva viene accettata
    expect((await w.a.req('PUT', `/api/workouts/${id}/sets/${uuid()}`, pendulumSet(id, slot, 2, 70, 5))).body.error).toBe('workout_closed');

    const r = await ctx.db.query('select count(*)::int n from workout_sets where workout_id = $1', [id]);
    expect(r.rows[0].n).toBe(3);
    const p = (await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto;
    expect(p.nextDayIndex).toBe(3); // rotazione: dopo il Giorno 3 viene il Giorno 4

    // Ultima volta: serie allenanti precompilabili + riscaldamento separato
    const ctxPend = (await w.a.req('GET', `/api/exercises/${encodeURIComponent('Pendulum Squat')}/context`)).body;
    expect(ctxPend.lastSets.filter((s: { kind: string }) => s.kind === 'work').map((s: { weightKg: number; reps: number }) => [s.weightKg, s.reps])).toEqual([[60, 7], [65, 6]]);
    expect(ctxPend.lastSets.filter((s: { kind: string }) => s.kind === 'warmup')).toHaveLength(1);

    // Progressi: il riscaldamento resta nello storico ma non fa record (verificato anche nel pacchetto shared)
    const prog = (await w.a.req('GET', `/api/progress/exercises/${encodeURIComponent('pendulum squat')}`)).body;
    expect(prog.sets).toHaveLength(3);
  });

  it('pubblicare una modifica durante una seduta non altera quella seduta', async () => {
    let p = (await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto;
    const id = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${id}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex: 2, startedAt: new Date().toISOString() }));

    const content = structuredClone(p.content);
    content.days[2]!.exercises[2]!.repsRaw = '8/6';
    content.days[2]!.exercises.splice(5, 1); // rimuove Calf machine
    const pub = await w.coach.req('POST', `/api/programs/${p.id}/publish`, { name: p.name, startDate: p.startDate, endDate: p.endDate, content });
    expect200(pub);

    const active = (await w.a.req('GET', '/api/workouts/active')).body as WorkoutDto;
    expect(active.versionNo).toBe(1);
    expect(active.day.exercises[2]!.repsRaw).toBe('7/5');
    expect(active.day.exercises).toHaveLength(6);
    expect200(await w.a.req('POST', `/api/workouts/${id}/finish`, { athleteNote: null, endedAt: new Date().toISOString() }));
    const hist = (await w.a.req('GET', `/api/workouts/${id}`)).body as WorkoutDto;
    expect(hist.day.exercises[2]!.repsRaw).toBe('7/5');

    // La nuova versione vale dalla seduta successiva
    p = (await w.a.req('GET', `/api/programs/${program.id}`)).body;
    const next = uuid();
    const nw = (await w.a.req('PUT', `/api/workouts/${next}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex: 2, startedAt: new Date().toISOString() })).body as WorkoutDto;
    expect(nw.versionNo).toBe(2);
    expect(nw.day.exercises[2]!.repsRaw).toBe('8/6');
    expect200(await w.a.req('POST', `/api/workouts/${next}/discard`));
  });

  it('Scarta seduta: le serie spariscono, la rotazione resta al giorno precedente allo scarto', async () => {
    const before = ((await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto);
    const id = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${id}`, { programId: program.id, programVersionId: before.currentVersionId, dayIndex: before.nextDayIndex, startedAt: new Date().toISOString() }));
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${uuid()}`, { ...pendulumSet(id, 'x', 0, 10, 10), exerciseKey: 't bar', exerciseName: 'T Bar' }));
    expect200(await w.a.req('POST', `/api/workouts/${id}/discard`));
    expect200(await w.a.req('POST', `/api/workouts/${id}/discard`)); // idempotente
    const after = ((await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto);
    expect(after.nextDayIndex).toBe(before.nextDayIndex);
    expect((await ctx.db.query('select count(*)::int n from workout_sets where workout_id = $1', [id])).rows[0].n).toBe(0);
    // Una sync tardiva della seduta scartata non la riapre
    expect((await w.a.req('PUT', `/api/workouts/${id}/sets/${uuid()}`, pendulumSet(id, 'x', 0, 10, 10))).body.error).toBe('workout_closed');
    expect((await w.a.req('GET', '/api/workouts/active')).body).toBeNull();
  });

  it('salvataggio parziale con esercizio saltato e sostituito', async () => {
    const p = (await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto;
    const id = uuid();
    const wk = (await w.a.req('PUT', `/api/workouts/${id}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex: 0, startedAt: new Date().toISOString() })).body as WorkoutDto;
    expect200(await w.a.req('PATCH', `/api/workouts/${id}/exercise-state`, { slot: wk.day.exercises[0]!.id, state: { state: 'skipped' } }));
    expect200(await w.a.req('PATCH', `/api/workouts/${id}/exercise-state`, { slot: wk.day.exercises[1]!.id, state: { state: 'substituted', name: 'Panca piana manubri' } }));
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${uuid()}`, { exerciseSlot: wk.day.exercises[1]!.id, exerciseKey: exerciseKey('Panca piana manubri'), exerciseName: 'Panca piana manubri', kind: 'work', setIndex: 0, weightKg: 30, reps: 9, rir: null, completedAt: new Date().toISOString() }));
    const done = (await w.a.req('POST', `/api/workouts/${id}/finish`, { athleteNote: '', endedAt: new Date().toISOString() })).body as WorkoutDto;
    expect(done.exerciseStates[wk.day.exercises[0]!.id]).toEqual({ state: 'skipped' });
    expect(done.sets[0]!.exerciseName).toBe('Panca piana manubri');
    expect(done.athleteNote).toBeNull();
  });

  it('annullare una serie la elimina (DELETE idempotente, solo sulla propria seduta)', async () => {
    const p = (await w.a.req('GET', `/api/programs/${program.id}`)).body as ProgramDetailDto;
    const id = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${id}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex: 0, startedAt: new Date().toISOString() }));
    const sid = uuid();
    expect200(await w.a.req('PUT', `/api/workouts/${id}/sets/${sid}`, pendulumSet(id, 'x', 0, 50, 8)));
    expect((await w.b.req('DELETE', `/api/workouts/${id}/sets/${sid}`)).status).toBe(404);
    expect200(await w.a.req('DELETE', `/api/workouts/${id}/sets/${sid}`));
    expect200(await w.a.req('DELETE', `/api/workouts/${id}/sets/${sid}`));
    expect((await ctx.db.query('select count(*)::int n from workout_sets where workout_id = $1', [id])).rows[0].n).toBe(0);
    expect200(await w.a.req('POST', `/api/workouts/${id}/discard`));
  });

  it('validazione input della serie', async () => {
    const p = (await w.b.req('GET', '/api/programs')).body;
    expect(p).toEqual([]);
    const bad = await w.a.req('PUT', `/api/workouts/${uuid()}/sets/${uuid()}`, { exerciseSlot: 'x', exerciseKey: 'x', exerciseName: 'x', kind: 'work', setIndex: 0, weightKg: -5, reps: 5, rir: null, completedAt: new Date().toISOString() });
    expect(bad.status).toBe(400);
  });
});
