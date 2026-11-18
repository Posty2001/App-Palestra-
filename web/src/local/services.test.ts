import { describe, expect, it } from 'vitest';
import type { AthleteSummaryDto, CheckDto, ProgramDetailDto, ProgramSummaryDto, ReviewItemDto, WorkoutDto } from '@palestra/shared';
import { api, ApiError } from '../lib/api';
import { createProfile } from './profile';
import { db, readTx, writeTx } from './db';
import { bundle, program, setBody, setupAthlete, setupCoach, start } from '../test/helpers';

const expectStatus = async (p: Promise<unknown>, status: number, code?: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(status);
  if (code) expect((err as ApiError).code).toBe(code);
};

describe('profilo locale', () => {
  it('senza profilo ogni richiesta è rifiutata', async () => {
    await expectStatus(api('GET', '/bundle'), 401, 'no_profile');
  });

  it('crea una sola identità e la scheda base con il Pendulum Squat al Giorno 3', async () => {
    const { profile, programs } = await setupAthlete();
    const again = await createProfile({ displayName: 'Altro', role: 'coach', withBaseProgram: true });
    expect(again.id).toBe(profile.id);
    expect(programs).toHaveLength(1);
    const day3 = programs[0]!.content.days[2]!;
    expect(day3.exercises[2]!.name).toBe('Pendulum Squat');
    expect(day3.exercises[2]!.setsRaw).toBe('2');
    expect(day3.exercises[2]!.repsRaw).toBe('7/5');
    expect(day3.exercises.some((e) => /rdl manubri/i.test(e.name))).toBe(false);
    expect(programs[0]!.content.days).toHaveLength(5);
  });
});

describe('sedute', () => {
  it('serie idempotenti, rotazione avanzata alla fine, contesto «ultima volta»', async () => {
    const { programs } = await setupAthlete();
    const p = programs[0]!;
    const w = await start(p, 0);
    const slot = w.day.exercises[0]!.id;
    const name = w.day.exercises[0]!.name;
    const setId = crypto.randomUUID();
    await api('PUT', `/workouts/${w.id}/sets/${setId}`, setBody(slot, name, 0, 60, 8));
    await api('PUT', `/workouts/${w.id}/sets/${setId}`, setBody(slot, name, 0, 62.5, 8)); // stessa serie corretta
    const active = await api<WorkoutDto>('GET', '/workouts/active');
    expect(active.sets).toHaveLength(1);
    expect(active.sets[0]!.weightKg).toBe(62.5);
    // seconda seduta contemporanea rifiutata
    await expectStatus(start(p, 1), 409, 'active_exists');
    // ripetere l'avvio con lo stesso id non duplica
    await start(p, 0, w.id);
    await api('POST', `/workouts/${w.id}/finish`, { athleteNote: 'ok', endedAt: new Date().toISOString() });
    await api('POST', `/workouts/${w.id}/finish`, { athleteNote: 'ok', endedAt: new Date().toISOString() }); // idempotente
    const b = await bundle();
    expect(b.activeWorkout).toBeNull();
    expect(b.programs[0]!.nextDayIndex).toBe(1);
    const key = active.sets[0]!.exerciseKey;
    expect(b.contexts[key]?.lastSets.map((s) => s.weightKg)).toEqual([62.5]);
    const hist = await api<WorkoutDto[]>('GET', '/workouts');
    expect(hist).toHaveLength(1);
    await expectStatus(api('PUT', `/workouts/${w.id}/sets/${crypto.randomUUID()}`, setBody(slot, name, 1, 60, 8)), 409, 'workout_closed');
  });

  it('scartare elimina le serie e non tocca la rotazione', async () => {
    const { programs } = await setupAthlete();
    const w = await start(programs[0]!, 2);
    await api('PUT', `/workouts/${w.id}/sets/${crypto.randomUUID()}`, setBody(w.day.exercises[0]!.id, w.day.exercises[0]!.name, 0, 40, 10));
    await api('POST', `/workouts/${w.id}/discard`, {});
    const b = await bundle();
    expect(b.activeWorkout).toBeNull();
    expect(b.programs[0]!.nextDayIndex).toBe(0);
    expect(await readTx((tx) => tx.objectStore('sets').count())).toBe(0);
    await expectStatus(api('POST', `/workouts/${w.id}/finish`, { athleteNote: null, endedAt: new Date().toISOString() }), 409);
  });

  it('una nuova versione pubblicata durante la seduta non altera la seduta già iniziata', async () => {
    const { programs } = await setupAthlete();
    const p = programs[0]!;
    const w = await start(p, 2);
    const detail = await program(p.id);
    const content = structuredClone(detail.content);
    content.days[2]!.exercises[0]!.name = 'Esercizio cambiato';
    content.days.pop(); // 4 giorni
    const res = await api<{ versionNo: number; program: ProgramDetailDto }>('POST', `/programs/${p.id}/publish`, { name: p.name, startDate: null, endDate: null, content });
    expect(res.versionNo).toBe(2);
    const active = await api<WorkoutDto>('GET', '/workouts/active');
    expect(active.versionNo).toBe(1);
    expect(active.day.exercises[0]!.name).toBe(w.day.exercises[0]!.name);
    expect(active.day.exercises[0]!.name).not.toBe('Esercizio cambiato');
    // la versione 1 resta consultabile e immutata
    const v1 = await api<{ content: { days: unknown[] } }>('GET', `/program-versions/${p.currentVersionId}`);
    expect(v1.content.days).toHaveLength(5);
    await api('POST', `/workouts/${w.id}/finish`, { athleteNote: null, endedAt: new Date().toISOString() });
    expect((await bundle()).programs[0]!.nextDayIndex).toBe(3); // (2+1) % 4
    await expectStatus(api('POST', `/programs/${p.id}/publish`, { name: p.name, startDate: null, endDate: null, content }), 400, 'no_changes');
  });
});

describe('transazioni', () => {
  it('un errore a metà annulla TUTTE le scritture della transazione', async () => {
    const { programs } = await setupAthlete();
    const before = await readTx((tx) => tx.objectStore('programs').count());
    await expect(
      writeTx(async (tx) => {
        await tx.objectStore('programs').put({ ...(await tx.objectStore('programs').get(programs[0]!.id))!, name: 'Modificata' });
        await tx.objectStore('weights').add({ id: 'w1', athleteId: 'x', measuredOn: '2026-11-18', weightKg: 80, createdAt: '' });
        throw new Error('interruzione simulata');
      }),
    ).rejects.toThrow('interruzione simulata');
    expect(await readTx((tx) => tx.objectStore('programs').count())).toBe(before);
    expect((await program(programs[0]!.id)).name).toBe(programs[0]!.name);
    expect(await (await db()).count('weights')).toBe(0);
  });

  it('una scrittura non valida dal router non lascia tracce parziali', async () => {
    const { programs } = await setupAthlete();
    await expectStatus(api('POST', '/programs', { name: '', startDate: null, endDate: null, content: programs[0]!.content }), 400, 'validation');
    expect(await api<ProgramSummaryDto[]>('GET', '/programs')).toHaveLength(1);
  });
});

describe('coach: atleti locali e permessi', () => {
  it('crea atleta, assegna scheda, coda da rivedere, isolamento', async () => {
    const coach = await setupCoach();
    const a = await api<AthleteSummaryDto>('POST', '/coach/athletes', { displayName: 'Atleta A' });
    const own = (await api<ProgramSummaryDto[]>('GET', '/programs'))[0]!;
    const assigned = await api<ProgramDetailDto>('POST', `/programs/${own.id}/duplicate`, { ownerId: a.id });
    expect(assigned.ownerId).toBe(a.id);
    expect(assigned.name).toBe(own.name);
    expect(assigned.versions[0]!.summary).toBe(`Assegnata da ${coach.displayName}`);
    expect((await api<ProgramSummaryDto[]>(`GET`, `/programs?userId=${a.id}`))).toHaveLength(1);
    // le schede personali del coach non cambiano
    expect(await api<ProgramSummaryDto[]>('GET', '/programs')).toHaveLength(1);
    // il coach non può avviare sedute a nome dell'atleta
    await expectStatus(start(assigned, 0), 404);
    await api('PATCH', `/coach/athletes/${a.id}`, { checkWeekday: 1, keyExercises: ['Panca Piana'] });
    const s = await api<AthleteSummaryDto>('GET', `/coach/athletes/${a.id}`);
    expect(s.checkWeekday).toBe(1);
    expect(s.keyExercises).toEqual(['panca piana']);
    // scadenza scheda in coda
    await api('POST', `/programs/${assigned.id}/publish`, { name: assigned.name, startDate: '2026-10-01', endDate: '2026-11-20', content: assigned.content });
    const q = await api<ReviewItemDto[]>('GET', '/coach/review?today=2026-11-18');
    expect(q.map((i) => i.type)).toEqual(['program_expiry']);
    await api('POST', `/coach/review/program_expiry/${assigned.id}`, {});
    expect(await api<ReviewItemDto[]>('GET', '/coach/review?today=2026-11-18')).toHaveLength(0);
    // id sconosciuto → 404 (nessuna informazione su dati altrui)
    await expectStatus(api('GET', `/programs?userId=${crypto.randomUUID()}`), 404);
    await expectStatus(api('GET', `/checks?userId=${crypto.randomUUID()}`), 404);
    // rimozione: accesso cessato, dati non cancellati
    await api('DELETE', `/coach/athletes/${a.id}`);
    await expectStatus(api('GET', `/programs?userId=${a.id}`), 404);
    expect(await api<AthleteSummaryDto[]>('GET', '/coach/athletes')).toHaveLength(0);
    expect(await readTx((tx) => tx.objectStore('programs').get(assigned.id))).toBeTruthy();
  });

  it('un atleta non accede alle funzioni coach', async () => {
    await setupAthlete();
    await expectStatus(api('GET', '/coach/athletes'), 403);
    await expectStatus(api('POST', '/coach/athletes', { displayName: 'X' }), 403);
  });
});

describe('check e foto', () => {
  it('check, condivisione foto e regola di accesso del coach', async () => {
    const coach = await setupCoach();
    const a = await api<AthleteSummaryDto>('POST', '/coach/athletes', { displayName: 'Atleta A' });
    // simulazione di un check ricevuto dall'atleta con foto NON condivise
    const checkId = crypto.randomUUID();
    const photoId = crypto.randomUUID();
    await writeTx(async (tx) => {
      await tx.objectStore('checks').add({ id: checkId, athleteId: a.id, checkDate: '2026-11-18', weightKg: 80.5, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: null, sharePhotos: false, reviewedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.objectStore('photos').add({ id: photoId, checkId, athleteId: a.id, pose: 'front', mime: 'image/jpeg', bytes: 3, width: 1, height: 1, sha256: '', blob: new Blob([new Uint8Array([1, 2, 3])]), createdAt: '' });
    });
    const c = await api<CheckDto>('GET', `/checks/${checkId}`);
    expect(c.photos).toHaveLength(0);
    expect(c.photoCount).toBe(1);
    await expectStatus(api('GET', `/photos/${photoId}`), 404);
    const q = await api<ReviewItemDto[]>('GET', '/coach/review?today=2026-11-18');
    expect(q[0]).toMatchObject({ type: 'check', title: 'Check del 18/11', detail: 'Peso 80,5 kg · foto private' });
    const fb = await api<CheckDto>('POST', `/checks/${checkId}/feedback`, { body: 'Bene' });
    expect(fb.feedback[0]).toMatchObject({ body: 'Bene', coachName: coach.displayName });
    expect(fb.reviewedAt).not.toBeNull();
    // il coach non può modificare il check dell'atleta
    await expectStatus(api('PATCH', `/checks/${checkId}/sharing`, { sharePhotos: true }), 404);
    await expectStatus(api('DELETE', `/checks/${checkId}`), 404);
  });

  it("l'atleta vede le proprie foto e l'eliminazione del check rimuove foto e commenti", async () => {
    const { profile } = await setupAthlete(false);
    const id = crypto.randomUUID();
    const c = await api<CheckDto>('PUT', `/checks/${id}`, { checkDate: '2026-11-18', weightKg: 81, bicepsCm: null, chestCm: null, thighCm: null, waistCm: null, note: '', sharePhotos: false });
    expect(c.sharePhotos).toBe(false);
    expect(c.note).toBeNull();
    await writeTx((tx) => tx.objectStore('photos').add({ id: 'ph', checkId: id, athleteId: profile.id, pose: 'side', mime: 'image/jpeg', bytes: 1, width: 1, height: 1, sha256: '', blob: new Blob([new Uint8Array([9])]), createdAt: '' }).then(() => undefined));
    expect((await api<Blob>('GET', '/photos/ph')).size).toBe(1);
    expect((await api<CheckDto>('GET', `/checks/${id}`)).photos).toHaveLength(1);
    await api('DELETE', `/checks/${id}`);
    expect(await readTx((tx) => tx.objectStore('photos').count())).toBe(0);
    const w = await api<{ measuredOn: string; source: string }[]>('GET', '/weights');
    expect(w).toHaveLength(0);
  });
});
