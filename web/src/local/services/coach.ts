import { z } from 'zod';
import { exerciseKey, type AthleteSummaryDto, type ReviewItemDto } from '@palestra/shared';
import { notFound } from '../../lib/errors';
import { nowIso, uuid, type PersonRec, type Tx } from '../db';
import { assertCoachOf, requireCoach, type AnyTx, type Viewer } from './access';
import { toQuestionDto, workoutsOf } from './workouts';

export const newAthleteSchema = z.object({ displayName: z.string().trim().min(1, 'Nome atleta obbligatorio').max(80) });
export const patchAthleteSchema = z.object({
  checkWeekday: z.number().int().min(0).max(6).nullable().optional(),
  keyExercises: z.array(z.string().trim().min(1).max(160)).max(3, 'Massimo 3 esercizi chiave').optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export function newPerson(role: PersonRec['role'], displayName: string, id = uuid()): PersonRec {
  return {
    id, role, displayName, remoteId: null, signPublic: null, encPublic: null, keyId: null, keyConfirmedAt: null, pendingKey: null,
    checkWeekday: null, keyExercises: [], createdAt: nowIso(), lastReceivedAt: null, lastSentAt: null, endedAt: null,
  };
}

/** Il coach aggiunge un atleta sul proprio dispositivo; il collegamento con il telefono dell'atleta avviene poi via file. */
export async function addAthlete(tx: Tx, viewer: Viewer, displayName: string): Promise<string> {
  requireCoach(viewer);
  const p = newPerson('athlete', displayName);
  await tx.objectStore('people').add(p);
  return p.id;
}

async function summary(tx: AnyTx, a: PersonRec): Promise<AthleteSummaryDto> {
  const programs = (await tx.objectStore('programs').index('ownerId').getAll(a.id)).filter((p) => !p.archivedAt).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  const completed = await workoutsOf(tx, a.id, 'completed');
  const checks = (await tx.objectStore('checks').index('athleteId').getAll(a.id)).sort((x, y) => y.checkDate.localeCompare(x.checkDate) || y.createdAt.localeCompare(x.createdAt));
  const questions = await tx.objectStore('questions').index('athleteId').getAll(a.id);
  const pending =
    checks.filter((c) => !c.reviewedAt && c.createdAt >= a.createdAt).length +
    questions.filter((q) => !q.reviewedAt).length +
    completed.filter((w) => w.athleteNote && !w.coachReviewedAt && w.startedAt >= a.createdAt).length;
  const p = programs[0];
  const w = completed[0];
  const c = checks[0];
  return {
    id: a.id, displayName: a.displayName, email: '', isDemo: false, linkedAt: a.createdAt, checkWeekday: a.checkWeekday, keyExercises: a.keyExercises,
    activeProgram: p ? { id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate } : null,
    lastWorkout: w ? { id: w.id, dayName: w.day.name, endedAt: w.endedAt } : null,
    lastCheck: c ? { id: c.id, checkDate: c.checkDate } : null,
    pendingReview: pending,
  };
}

export async function listAthletes(tx: AnyTx, viewer: Viewer): Promise<AthleteSummaryDto[]> {
  requireCoach(viewer);
  const people = (await tx.objectStore('people').index('role').getAll('athlete')).filter((p) => !p.endedAt);
  people.sort((a, b) => a.displayName.localeCompare(b.displayName, 'it'));
  const out: AthleteSummaryDto[] = [];
  for (const p of people) out.push(await summary(tx, p));
  return out;
}

export async function getAthlete(tx: AnyTx, viewer: Viewer, id: string): Promise<AthleteSummaryDto> {
  return summary(tx, await assertCoachOf(tx, viewer, id));
}

export async function patchAthlete(tx: Tx, viewer: Viewer, id: string, b: z.infer<typeof patchAthleteSchema>): Promise<AthleteSummaryDto> {
  const a = await assertCoachOf(tx, viewer, id);
  const next: PersonRec = {
    ...a,
    ...(b.checkWeekday !== undefined ? { checkWeekday: b.checkWeekday } : {}),
    ...(b.keyExercises ? { keyExercises: b.keyExercises.map(exerciseKey) } : {}),
    ...(b.displayName ? { displayName: b.displayName } : {}),
  };
  await tx.objectStore('people').put(next);
  return summary(tx, next);
}

/** Rimuove l'atleta dall'elenco: l'app non mostra più i suoi dati (restano nel backup completo, nessuna cancellazione silenziosa). */
export async function endAthlete(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const a = await assertCoachOf(tx, viewer, id);
  await tx.objectStore('people').put({ ...a, endedAt: nowIso() });
}

export const feedbackSchema = z.object({ exerciseName: z.string().trim().min(1).max(120), body: z.string().trim().min(1, "Scrivi un'indicazione").max(2000) });

export async function addExerciseFeedback(tx: Tx, viewer: Viewer, athleteId: string, b: z.infer<typeof feedbackSchema>): Promise<string> {
  await assertCoachOf(tx, viewer, athleteId);
  const id = uuid();
  await tx.objectStore('feedback').add({
    id, athleteId, coachId: viewer.id, coachName: viewer.displayName, kind: 'exercise', exerciseKey: exerciseKey(b.exerciseName), exerciseName: b.exerciseName,
    checkId: null, body: b.body, createdAt: nowIso(),
  });
  return id;
}

export async function answerQuestion(tx: Tx, viewer: Viewer, id: string, answer: string) {
  requireCoach(viewer);
  const q = await tx.objectStore('questions').get(id);
  if (!q) throw notFound();
  await assertCoachOf(tx, viewer, q.athleteId);
  const now = nowIso();
  const next = { ...q, answer, answeredAt: now, reviewedAt: now };
  await tx.objectStore('questions').put(next);
  return toQuestionDto(next);
}

const ddmm = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const kg = (n: number): string => String(Number(n.toFixed(2))).replace('.', ',');

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Coda «Da rivedere» calcolata dai dati ricevuti dagli atleti. `today` è la data locale del dispositivo (AAAA-MM-GG). */
export async function reviewQueue(tx: AnyTx, viewer: Viewer, today: string): Promise<ReviewItemDto[]> {
  requireCoach(viewer);
  const out: ReviewItemDto[] = [];
  const athletes = (await tx.objectStore('people').index('role').getAll('athlete')).filter((p) => !p.endedAt);
  for (const a of athletes) {
    const base = { athleteId: a.id, athleteName: a.displayName };
    for (const c of await tx.objectStore('checks').index('athleteId').getAll(a.id)) {
      if (c.reviewedAt || c.createdAt < a.createdAt) continue;
      const detail = [c.weightKg !== null ? `Peso ${kg(c.weightKg)} kg` : null, c.sharePhotos ? 'foto condivise' : 'foto private'].filter(Boolean).join(' · ');
      out.push({ type: 'check', id: c.id, ...base, at: c.createdAt, title: `Check del ${ddmm(c.checkDate)}`, detail });
    }
    for (const q of await tx.objectStore('questions').index('athleteId').getAll(a.id)) {
      if (!q.reviewedAt) out.push({ type: 'question', id: q.id, ...base, at: q.createdAt, title: `Domanda · ${q.exerciseName}`, detail: q.body, exerciseKey: q.exerciseKey });
    }
    for (const w of await workoutsOf(tx, a.id, 'completed')) {
      if (w.athleteNote && !w.coachReviewedAt && w.startedAt >= a.createdAt) out.push({ type: 'workout_note', id: w.id, ...base, at: w.endedAt ?? w.startedAt, title: `Nota allenamento · ${w.day.name}`, detail: w.athleteNote });
    }
    for (const p of await tx.objectStore('programs').index('ownerId').getAll(a.id)) {
      if (p.archivedAt || !p.endDate || p.expiryReviewedAt || p.endDate > addDays(today, 7)) continue;
      out.push({
        type: 'program_expiry', id: p.id, ...base, at: `${p.endDate}T00:00:00.000Z`, title: p.endDate < today ? 'Scheda scaduta' : 'Scheda in scadenza',
        detail: `${p.name} · fine ${ddmm(p.endDate)}/${p.endDate.slice(0, 4)}`,
      });
    }
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 200);
}

export const reviewTypeSchema = z.enum(['check', 'question', 'workout_note', 'program_expiry']);

export async function markReviewed(tx: Tx, viewer: Viewer, type: z.infer<typeof reviewTypeSchema>, id: string): Promise<void> {
  requireCoach(viewer);
  const now = nowIso();
  if (type === 'check') {
    const c = await tx.objectStore('checks').get(id);
    if (!c) throw notFound();
    await assertCoachOf(tx, viewer, c.athleteId);
    await tx.objectStore('checks').put({ ...c, reviewedAt: c.reviewedAt ?? now });
  } else if (type === 'question') {
    const q = await tx.objectStore('questions').get(id);
    if (!q) throw notFound();
    await assertCoachOf(tx, viewer, q.athleteId);
    await tx.objectStore('questions').put({ ...q, reviewedAt: q.reviewedAt ?? now });
  } else if (type === 'workout_note') {
    const w = await tx.objectStore('workouts').get(id);
    if (!w) throw notFound();
    await assertCoachOf(tx, viewer, w.athleteId);
    await tx.objectStore('workouts').put({ ...w, coachReviewedAt: w.coachReviewedAt ?? now });
  } else {
    const p = await tx.objectStore('programs').get(id);
    if (!p) throw notFound();
    await assertCoachOf(tx, viewer, p.ownerId);
    await tx.objectStore('programs').put({ ...p, expiryReviewedAt: p.expiryReviewedAt ?? now });
  }
}
