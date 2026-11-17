import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExercise, newId, type ProgramContent, type ProgramDetailDto } from '@palestra/shared';
import { expect200, setup, teardown, uuid, world, type Ctx, type World } from './helpers.js';

const PDF = new URL('../assets/scheda_allenamento_5_giorni.pdf', import.meta.url);

/** Priorità 2: creazione manuale, import del PDF incluso, revisione, giorni, più programmi e rotazioni. */
describe('schede', () => {
  let ctx: Ctx;
  let w: World;
  beforeAll(async () => {
    ctx = await setup();
    w = await world(ctx);
  });
  afterAll(() => teardown(ctx));

  it('la scheda personale del coach è precaricata con Pendulum Squat al Giorno 3', async () => {
    const list = await w.coach.req('GET', '/api/programs');
    expect(list.body).toHaveLength(1);
    const p = list.body[0];
    expect(p.name).toBe('Scheda 5 giorni');
    expect(p.content.days).toHaveLength(5);
    const day3 = p.content.days[2];
    expect(day3.exercises.map((e: { name: string }) => e.name)).toEqual([
      'Adductor machine', 'Leg curl seduto', 'Pendulum Squat', 'Leg extension singola', 'Leg curl sdraiato', 'Calf machine',
    ]);
    expect(day3.exercises[2]).toMatchObject({ sets: 2, setsRaw: '2', repsRaw: '7/5', restRaw: '4’-5’', restSeconds: { min: 240, max: 300 } });
    const names = p.content.days.flatMap((d: { exercises: { name: string }[] }) => d.exercises.map((e) => e.name));
    expect(names).not.toContain('RDL manubri');
    // Le notazioni originali sono conservate
    expect(p.content.days[0].exercises[0]).toMatchObject({ setsRaw: '3 (2 top set + 1 back off del 20%)', repsRaw: '7-5 (top set); 10 reps (back off)', topSets: 2, backoffSets: 1, backoffPct: 20 });
    expect(p.content.days[0].exercises[6]).toMatchObject({ name: 'Pulley stretto', repsRaw: '10/6', restRaw: '—', restSeconds: null });
  });

  it('import del PDF incluso: 5 giorni, righe su più linee, elementi dubbi segnalati', async () => {
    const res = await w.a.upload('POST', '/api/import/pdf', await readFile(PDF), 'scheda_allenamento_5_giorni.pdf', 'application/pdf');
    expect200(res);
    const r = res.body;
    expect(r.status).toBe('partial');
    const days: ProgramContent['days'] = r.content.days;
    expect(days.map((d) => d.name)).toEqual(['Giorno 1', 'Giorno 2', 'Giorno 3', 'Giorno 4', 'Giorno 5']);
    expect(days.map((d) => d.exercises.length)).toEqual([7, 8, 6, 8, 5]);
    expect(days[1]!.exercises[3]!.name).toBe('Hammer curl con gomito in appoggio con manubri');
    expect(days[3]!.exercises[7]!.name).toBe('Alzate laterali con manubri / Raises machine (2ª variante)');
    expect(days[2]!.exercises[2]!.name).toBe('RDL manubri'); // il PDF originale contiene ancora RDL
    expect(r.doubts).toEqual([
      { where: '0:6', message: 'Recupero non indicato' },
      { where: '1:4', message: 'Percentuale del back-off non indicata' },
    ]);
  });

  it('file non PDF o PDF senza testo: limite comunicato, nessuna bozza', async () => {
    const notPdf = await w.a.upload('POST', '/api/import/pdf', Buffer.from('ciao'), 'x.pdf', 'application/pdf');
    expect(notPdf.body).toMatchObject({ status: 'unreadable', content: null });
    // PDF minimale valido senza testo (come una scansione)
    const empty = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const scan = await w.a.upload('POST', '/api/import/pdf', empty, 'scan.pdf', 'application/pdf');
    expect(scan.body.status).toBe('unreadable');
    expect(scan.body.message).toMatch(/scansione|a mano/);
  });

  it('revisione della bozza: sostituisco RDL con Pendulum, aggiungo e rimuovo giorni, poi salvo', async () => {
    const res = await w.a.upload('POST', '/api/import/pdf', await readFile(PDF), 'scheda.pdf', 'application/pdf');
    const content: ProgramContent = res.body.content;
    const rdl = content.days[2]!.exercises[2]!;
    content.days[2]!.exercises[2] = buildExercise({ id: rdl.id, name: 'Pendulum Squat', setsRaw: '2', repsRaw: '7/5', restRaw: '4’-5’' }).exercise;
    content.days.push({ id: newId(), name: 'Giorno 6', exercises: [buildExercise({ name: 'Crunch', setsRaw: '3', repsRaw: '15', restRaw: '1’' }).exercise] });
    content.days.splice(4, 1); // rimuovo il Giorno 5
    const saved = await w.a.req('POST', '/api/programs', { name: res.body.name, startDate: '2026-11-01', endDate: '2026-12-15', content });
    expect(saved.status).toBe(201);
    const p: ProgramDetailDto = saved.body;
    expect(p.content.days.map((d) => d.name)).toEqual(['Giorno 1', 'Giorno 2', 'Giorno 3', 'Giorno 4', 'Giorno 6']);
    expect(p.content.days[2]!.exercises[2]!.name).toBe('Pendulum Squat');
    expect(p.versionNo).toBe(1);
  });

  it('validazione: periodo incoerente e scheda senza giorni sono rifiutati', async () => {
    const bad = await w.a.req('POST', '/api/programs', { name: 'X', startDate: '2026-12-01', endDate: '2026-11-01', content: { days: [{ id: 'd', name: 'G1', exercises: [] }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/data finale/);
    expect((await w.a.req('POST', '/api/programs', { name: 'X', startDate: null, endDate: null, content: { days: [] } })).status).toBe(400);
  });

  it('creazione manuale + due programmi con rotazioni indipendenti', async () => {
    const mk = (n: number): ProgramContent => ({
      days: Array.from({ length: n }, (_, i) => ({ id: newId(), name: `Giorno ${i + 1}`, exercises: [buildExercise({ name: `Esercizio ${i + 1}`, setsRaw: '2', repsRaw: '10-6', restRaw: '2’' }).exercise] })),
    });
    const p1 = (await w.b.req('POST', '/api/programs', { name: 'Upper/Lower', startDate: null, endDate: null, content: mk(4) })).body as ProgramDetailDto;
    const p2 = (await w.b.req('POST', '/api/programs', { name: 'Full body', startDate: null, endDate: null, content: mk(3) })).body as ProgramDetailDto;

    const run = async (p: ProgramDetailDto, dayIndex: number): Promise<void> => {
      const id = uuid();
      expect200(await w.b.req('PUT', `/api/workouts/${id}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex, startedAt: new Date().toISOString() }));
      expect200(await w.b.req('POST', `/api/workouts/${id}/finish`, { athleteNote: null, endedAt: new Date().toISOString() }));
    };
    await run(p1, 0);
    await run(p1, 1);
    await run(p2, 0);
    const list = (await w.b.req('GET', '/api/programs')).body as ProgramDetailDto[];
    expect(list.find((x) => x.id === p1.id)!.nextDayIndex).toBe(2);
    expect(list.find((x) => x.id === p2.id)!.nextDayIndex).toBe(1);
    // Ordine cambiato: eseguo il giorno 4 → la rotazione riparte dal giorno 1
    await run(p1, 3);
    expect(((await w.b.req('GET', `/api/programs/${p1.id}`)).body as ProgramDetailDto).nextDayIndex).toBe(0);
  });

  it('il coach duplica e assegna: la copia personalizzata non modifica quella di altri atleti', async () => {
    const base = (await w.coach.req('GET', '/api/programs')).body[0] as ProgramDetailDto;
    const forA = (await w.coach.req('POST', `/api/programs/${base.id}/duplicate`, { ownerId: w.ids.a, name: 'Massa · 5 giorni', startDate: '2026-11-03', endDate: '2026-12-15' })).body as ProgramDetailDto;
    const forB = (await w.coach.req('POST', `/api/programs/${base.id}/duplicate`, { ownerId: w.ids.b, name: 'Massa · 5 giorni' })).body as ProgramDetailDto;
    expect(forA.ownerId).toBe(w.ids.a);
    expect(forA.unseenChange).toBeNull();

    const content = structuredClone(forA.content);
    content.days[0]!.exercises[1]!.repsRaw = '8-6';
    const pub = await w.coach.req('POST', `/api/programs/${forA.id}/publish`, { name: forA.name, startDate: forA.startDate, endDate: forA.endDate, content });
    expect200(pub);
    expect(pub.body.versionNo).toBe(2);
    expect(pub.body.changes).toEqual(['Giorno 1, Panca 45° S.M.: ripetizioni 10-6 → 8-6']);

    const bView = (await w.b.req('GET', `/api/programs/${forB.id}`)).body as ProgramDetailDto;
    expect(bView.content.days[0]!.exercises[1]!.repsRaw).toBe('10-6');
    expect(((await w.coach.req('GET', `/api/programs/${base.id}`)).body as ProgramDetailDto).content.days[0]!.exercises[1]!.repsRaw).toBe('10-6');

    // L'atleta vede il riepilogo della modifica finché non lo conferma
    const aView = (await w.a.req('GET', '/api/programs')).body.find((x: ProgramDetailDto) => x.id === forA.id) as ProgramDetailDto;
    expect(aView.unseenChange).toMatchObject({ versionNo: 2, summary: 'Giorno 1, Panca 45° S.M.: ripetizioni 10-6 → 8-6' });
    expect200(await w.a.req('POST', `/api/programs/${forA.id}/seen`));
    expect(((await w.a.req('GET', `/api/programs/${forA.id}`)).body as ProgramDetailDto).unseenChange).toBeNull();
  });

  it('Modifica scheda: bozza salvata senza effetti, poi Pubblica modifica', async () => {
    const p = (await w.a.req('GET', '/api/programs')).body[0] as ProgramDetailDto;
    const content = structuredClone(p.content);
    content.days[0]!.exercises.push(buildExercise({ name: 'Face pull', setsRaw: '2', repsRaw: '12', restRaw: '90"' }).exercise);
    const draft = await w.a.req('PUT', `/api/programs/${p.id}/draft`, { name: p.name, startDate: p.startDate, endDate: p.endDate, content });
    expect(draft.body.hasDraft).toBe(true);
    expect(draft.body.versionNo).toBe(p.versionNo);
    expect(draft.body.content.days[0].exercises).toHaveLength(p.content.days[0]!.exercises.length);
    const pub = await w.a.req('POST', `/api/programs/${p.id}/publish`, { name: p.name, startDate: p.startDate, endDate: p.endDate, content });
    expect(pub.body.program.hasDraft).toBe(false);
    expect(pub.body.program.versionNo).toBe(p.versionNo + 1);
    const nothing = await w.a.req('POST', `/api/programs/${p.id}/publish`, { name: p.name, startDate: p.startDate, endDate: p.endDate, content: pub.body.program.content });
    expect(nothing.body.error).toBe('no_changes');
  });

  it('scheda in scadenza appare in Da rivedere e ne esce dopo la revisione', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const base = (await w.coach.req('GET', '/api/programs')).body[0] as ProgramDetailDto;
    const p = (await w.coach.req('POST', `/api/programs/${base.id}/duplicate`, { ownerId: w.ids.b, name: 'In scadenza', startDate: today, endDate: soon })).body as ProgramDetailDto;
    let q = (await w.coach.req('GET', '/api/coach/review')).body as { type: string; id: string }[];
    expect(q.some((i) => i.type === 'program_expiry' && i.id === p.id)).toBe(true);
    expect200(await w.coach.req('POST', `/api/coach/review/program_expiry/${p.id}`));
    q = (await w.coach.req('GET', '/api/coach/review')).body;
    expect(q.some((i) => i.id === p.id)).toBe(false);
  });
});
