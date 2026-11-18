import { z } from 'zod';
import { setInputSchema, type ExerciseContextDto, type ExerciseState, type QuestionDto, type SetDto, type SetInput, type WorkoutDto } from '@palestra/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { nowIso, type QuestionRec, type SetRec, type Tx, type WorkoutRec } from '../db';
import type { AnyTx, Viewer } from './access';

export const startSchema = z.object({
  programId: z.string().min(1),
  programVersionId: z.string().min(1),
  dayIndex: z.number().int().min(0).max(20),
  startedAt: z.string().datetime(),
});

export const exerciseStateSchema = z.object({
  slot: z.string().min(1).max(64),
  state: z.union([
    z.null(),
    z.object({ state: z.literal('skipped') }),
    z.object({ state: z.literal('substituted'), name: z.string().trim().min(1).max(120) }),
  ]),
});

export const finishSchema = z.object({ athleteNote: z.string().trim().max(2000).nullable(), endedAt: z.string().datetime() });

export function toSetDto(s: SetRec): SetDto {
  return {
    id: s.id, workoutId: s.workoutId, exerciseSlot: s.exerciseSlot, exerciseKey: s.exerciseKey, exerciseName: s.exerciseName, kind: s.kind,
    setIndex: s.setIndex, weightKg: s.weightKg, reps: s.reps, rir: s.rir, completedAt: s.completedAt,
  };
}

const bySetOrder = (a: SetRec, b: SetRec): number => a.completedAt.localeCompare(b.completedAt) || a.setIndex - b.setIndex;

export async function setsOf(tx: AnyTx, workoutId: string): Promise<SetRec[]> {
  return (await tx.objectStore('sets').index('workoutId').getAll(workoutId)).sort(bySetOrder);
}

export async function toWorkoutDto(tx: AnyTx, w: WorkoutRec): Promise<WorkoutDto> {
  return {
    id: w.id, athleteId: w.athleteId, programId: w.programId, programVersionId: w.programVersionId, versionNo: w.versionNo, programName: w.programName,
    dayIndex: w.dayIndex, day: w.day, status: w.status, startedAt: w.startedAt, endedAt: w.endedAt, athleteNote: w.athleteNote,
    exerciseStates: w.exerciseStates, sets: (await setsOf(tx, w.id)).map(toSetDto),
  };
}

export async function workoutsOf(tx: AnyTx, athleteId: string, status: WorkoutRec['status']): Promise<WorkoutRec[]> {
  return (await tx.objectStore('workouts').index('athleteId').getAll(athleteId)).filter((w) => w.status === status).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function listWorkouts(tx: AnyTx, athleteId: string, limit: number, before: string | null): Promise<WorkoutDto[]> {
  const ws = (await workoutsOf(tx, athleteId, 'completed')).filter((w) => !before || w.startedAt < before).slice(0, limit);
  const out: WorkoutDto[] = [];
  for (const w of ws) out.push(await toWorkoutDto(tx, w));
  return out;
}

export async function activeWorkout(tx: AnyTx, athleteId: string): Promise<WorkoutRec | null> {
  return (await workoutsOf(tx, athleteId, 'in_progress'))[0] ?? null;
}

async function own(tx: AnyTx, viewer: Viewer, id: string): Promise<WorkoutRec | null> {
  const w = await tx.objectStore('workouts').get(id);
  if (w && w.athleteId !== viewer.id) throw notFound();
  return w ?? null;
}

function assertOpen(w: WorkoutRec | null): asserts w is WorkoutRec {
  if (!w) throw notFound('Seduta non trovata');
  if (w.status !== 'in_progress') throw conflict('La seduta è già chiusa', 'workout_closed');
}

/** Avvio idempotente: la copia del giorno (snapshot) viene presa dalla versione indicata e non cambia più. */
export async function startWorkout(tx: Tx, viewer: Viewer, id: string, body: z.infer<typeof startSchema>): Promise<void> {
  if (await own(tx, viewer, id)) return;
  const v = await tx.objectStore('versions').get(body.programVersionId);
  const p = await tx.objectStore('programs').get(body.programId);
  if (!v || !p || v.programId !== p.id || p.ownerId !== viewer.id) throw notFound('Scheda non trovata');
  const day = v.content.days[body.dayIndex];
  if (!day) throw badRequest('Giorno inesistente');
  if (await activeWorkout(tx, viewer.id)) throw conflict("C'è già un allenamento in corso", 'active_exists');
  await tx.objectStore('workouts').add({
    id, athleteId: viewer.id, programId: p.id, programVersionId: v.id, versionNo: v.versionNo, programName: p.name, dayIndex: body.dayIndex,
    day: structuredClone(day), status: 'in_progress', startedAt: body.startedAt, endedAt: null, athleteNote: null, exerciseStates: {},
    coachReviewedAt: null, updatedAt: nowIso(),
  });
}

/** Upsert della serie con id fisso: ripetere la stessa scrittura non crea duplicati. */
export async function putSet(tx: Tx, viewer: Viewer, workoutId: string, setId: string, input: SetInput): Promise<void> {
  const s = setInputSchema.parse(input);
  const w = await own(tx, viewer, workoutId);
  assertOpen(w);
  const prev = await tx.objectStore('sets').get(setId);
  if (prev && (prev.workoutId !== workoutId || prev.athleteId !== viewer.id)) throw notFound();
  const now = nowIso();
  await tx.objectStore('sets').put({
    id: setId, workoutId, athleteId: viewer.id, exerciseSlot: prev?.exerciseSlot ?? s.exerciseSlot, exerciseKey: s.exerciseKey, exerciseName: s.exerciseName,
    kind: prev?.kind ?? s.kind, setIndex: prev?.setIndex ?? s.setIndex, weightKg: s.weightKg, reps: s.reps, rir: s.rir,
    completedAt: prev?.completedAt ?? s.completedAt, updatedAt: now,
  });
  await tx.objectStore('workouts').put({ ...w, updatedAt: now });
}

export async function deleteSet(tx: Tx, viewer: Viewer, workoutId: string, setId: string): Promise<void> {
  const w = await own(tx, viewer, workoutId);
  assertOpen(w);
  const s = await tx.objectStore('sets').get(setId);
  if (s && s.workoutId === workoutId && s.athleteId === viewer.id) await tx.objectStore('sets').delete(setId);
}

export async function setExerciseState(tx: Tx, viewer: Viewer, workoutId: string, slot: string, state: ExerciseState | null): Promise<void> {
  const w = await own(tx, viewer, workoutId);
  assertOpen(w);
  const states = { ...w.exerciseStates };
  if (state) states[slot] = state;
  else delete states[slot];
  await tx.objectStore('workouts').put({ ...w, exerciseStates: states, updatedAt: nowIso() });
}

/** Salva (anche parziale) e porta avanti la rotazione sul numero di giorni della versione CORRENTE. Idempotente. */
export async function finishWorkout(tx: Tx, viewer: Viewer, id: string, body: z.infer<typeof finishSchema>): Promise<void> {
  const w = await own(tx, viewer, id);
  if (!w) throw notFound('Seduta non trovata');
  if (w.status === 'completed') return;
  if (w.status !== 'in_progress') throw conflict('La seduta è stata scartata', 'workout_closed');
  const endedAt = body.endedAt < w.startedAt ? w.startedAt : body.endedAt;
  await tx.objectStore('workouts').put({ ...w, status: 'completed', endedAt, athleteNote: body.athleteNote || null, updatedAt: nowIso() });
  if (w.programId) {
    const p = await tx.objectStore('programs').get(w.programId);
    if (p && p.ownerId === viewer.id) {
      const v = await tx.objectStore('versions').get(p.currentVersionId);
      const days = Math.max(v?.content.days.length ?? 1, 1);
      await tx.objectStore('programs').put({ ...p, nextDayIndex: (w.dayIndex + 1) % days, updatedAt: nowIso() });
    }
  }
}

/** Scarta: elimina le serie, la rotazione non cambia. Il record resta («discarded») come traccia. */
export async function discardWorkout(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const w = await own(tx, viewer, id);
  if (!w || w.status === 'discarded') return;
  if (w.status === 'completed') throw conflict('Seduta già salvata', 'workout_closed');
  for (const s of await setsOf(tx, id)) await tx.objectStore('sets').delete(s.id);
  const now = nowIso();
  await tx.objectStore('workouts').put({ ...w, status: 'discarded', endedAt: now, updatedAt: now });
}

export function toQuestionDto(q: QuestionRec): QuestionDto {
  return { id: q.id, athleteId: q.athleteId, exerciseKey: q.exerciseKey, exerciseName: q.exerciseName, body: q.body, answer: q.answer, answeredAt: q.answeredAt, createdAt: q.createdAt, context: q.context };
}

export async function questionsOf(tx: AnyTx, athleteId: string): Promise<QuestionDto[]> {
  return (await tx.objectStore('questions').index('athleteId').getAll(athleteId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(toQuestionDto);
}

/** Contesto per esercizio: serie dell'ultima seduta completata, assetto, indicazioni del coach, domande. */
export async function exerciseContexts(tx: AnyTx, athleteId: string, keys: string[]): Promise<Record<string, ExerciseContextDto>> {
  const out: Record<string, ExerciseContextDto> = {};
  if (!keys.length) return out;
  for (const k of keys) out[k] = { exerciseKey: k, lastSets: [], lastDate: null, machineSetup: null, feedback: [], questions: [] };
  const completed = new Map((await workoutsOf(tx, athleteId, 'completed')).map((w) => [w.id, w]));
  for (const k of keys) {
    const sets = (await tx.objectStore('sets').index('athleteExercise').getAll([athleteId, k])).filter((s) => completed.has(s.workoutId));
    let last: WorkoutRec | null = null;
    for (const s of sets) {
      const w = completed.get(s.workoutId)!;
      if (!last || w.startedAt > last.startedAt) last = w;
    }
    if (last) {
      const lw = last;
      out[k]!.lastSets = sets
        .filter((s) => s.workoutId === lw.id)
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'work' ? -1 : 1) || a.setIndex - b.setIndex || a.completedAt.localeCompare(b.completedAt))
        .map(toSetDto);
      out[k]!.lastDate = lw.startedAt;
    }
    const note = await tx.objectStore('notes').get([athleteId, k]);
    if (note) out[k]!.machineSetup = note.machineSetup;
  }
  const fb = (await tx.objectStore('feedback').index('athleteId').getAll(athleteId)).filter((f) => f.kind === 'exercise').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const f of fb) if (f.exerciseKey) out[f.exerciseKey]?.feedback.push({ id: f.id, body: f.body, createdAt: f.createdAt, coachName: f.coachName });
  for (const q of await questionsOf(tx, athleteId)) out[q.exerciseKey]?.questions.push(q);
  return out;
}
