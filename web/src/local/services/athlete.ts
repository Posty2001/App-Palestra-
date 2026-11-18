import { z } from 'zod';
import { exerciseKey, isoDateSchema, type TodayBundleDto, type UserDto, type WeightDto } from '@palestra/shared';
import { badRequest, notFound } from '../../lib/errors';
import { nowIso, type Tx } from '../db';
import { myCoach, type AnyTx, type Viewer } from './access';
import { listPrograms } from './programs';
import { activeWorkout, exerciseContexts, toQuestionDto, toSetDto, toWorkoutDto, workoutsOf } from './workouts';

export const keySchema = z.string().trim().min(1).max(160);

export async function userDto(tx: AnyTx, viewer: Viewer): Promise<UserDto> {
  const coach = viewer.role === 'athlete' ? await myCoach(tx) : null;
  return { id: viewer.id, email: '', displayName: viewer.displayName, role: viewer.role, isDemo: false, coach: coach ? { id: coach.id, displayName: coach.displayName } : null };
}

/** Pacchetto Oggi: schede, seduta in corso e contesto degli esercizi, letto in un'unica transazione coerente. */
export async function bundle(tx: AnyTx, viewer: Viewer, today: string): Promise<TodayBundleDto> {
  const programs = await listPrograms(tx, viewer.id, viewer.id);
  const aw = await activeWorkout(tx, viewer.id);
  const active = aw ? await toWorkoutDto(tx, aw) : null;
  const keys = new Set<string>();
  for (const p of programs) for (const d of p.content.days) for (const e of d.exercises) keys.add(exerciseKey(e.name));
  if (active) for (const e of active.day.exercises) keys.add(exerciseKey(e.name));
  for (const st of Object.values(active?.exerciseStates ?? {})) if (st.state === 'substituted') keys.add(exerciseKey(st.name));
  const contexts = await exerciseContexts(tx, viewer.id, [...keys]);
  let checkDue: TodayBundleDto['checkDue'] = null;
  const coach = viewer.role === 'athlete' ? await myCoach(tx) : null;
  if (coach && coach.checkWeekday !== null) {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const done = (await tx.objectStore('checks').index('athleteId').getAll(viewer.id)).some((c) => c.checkDate === today);
    checkDue = { weekday: coach.checkWeekday, dueToday: dow === coach.checkWeekday, doneToday: done };
  }
  return { user: await userDto(tx, viewer), programs, activeWorkout: active, contexts, checkDue, generatedAt: nowIso() };
}

export async function putExerciseNote(tx: Tx, viewer: Viewer, rawKey: string, machineSetup: string): Promise<void> {
  const key = exerciseKey(keySchema.parse(rawKey));
  const v = z.string().trim().max(300).parse(machineSetup);
  await tx.objectStore('notes').put({ athleteId: viewer.id, exerciseKey: key, machineSetup: v || null, updatedAt: nowIso() });
}

export const questionSchema = z.object({ exerciseName: z.string().trim().min(1).max(120), body: z.string().trim().min(1, 'Scrivi la domanda').max(500) });

/** «Chiedi al coach»: la domanda resta sul dispositivo e parte con il prossimo «Condividi dati». */
export async function putQuestion(tx: Tx, viewer: Viewer, id: string, b: z.infer<typeof questionSchema>) {
  const coach = viewer.role === 'athlete' ? await myCoach(tx) : null;
  if (!coach) throw badRequest('Non sei collegato a un coach', 'no_coach');
  const existing = await tx.objectStore('questions').get(id);
  if (existing) {
    if (existing.athleteId !== viewer.id) throw notFound();
    return toQuestionDto(existing);
  }
  const key = exerciseKey(b.exerciseName);
  const ctx = (await exerciseContexts(tx, viewer.id, [key]))[key];
  const rec = {
    id, athleteId: viewer.id, exerciseKey: key, exerciseName: b.exerciseName, body: b.body,
    context: { lastDate: ctx?.lastDate ?? null, sets: (ctx?.lastSets ?? []).filter((s) => s.kind === 'work').map((s) => ({ weightKg: s.weightKg, reps: s.reps })) },
    answer: null, answeredAt: null, reviewedAt: null, createdAt: nowIso(),
  };
  await tx.objectStore('questions').add(rec);
  return toQuestionDto(rec);
}

export async function progressExercises(tx: AnyTx, athleteId: string) {
  const completed = new Set((await workoutsOf(tx, athleteId, 'completed')).map((w) => w.id));
  const sets = (await tx.objectStore('sets').index('athleteExercise').getAll(IDBKeyRange.bound([athleteId, ''], [athleteId, '￿']))).filter((s) => completed.has(s.workoutId));
  const agg = new Map<string, { exerciseKey: string; exerciseName: string; lastAt: string; ws: Set<string>; workSets: number }>();
  for (const s of sets) {
    const a = agg.get(s.exerciseKey) ?? { exerciseKey: s.exerciseKey, exerciseName: s.exerciseName, lastAt: s.completedAt, ws: new Set<string>(), workSets: 0 };
    if (s.completedAt >= a.lastAt) {
      a.lastAt = s.completedAt;
      a.exerciseName = s.exerciseName;
    }
    a.ws.add(s.workoutId);
    if (s.kind === 'work') a.workSets++;
    agg.set(s.exerciseKey, a);
  }
  return [...agg.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((a) => ({ exerciseKey: a.exerciseKey, exerciseName: a.exerciseName, lastAt: a.lastAt, sessions: a.ws.size, workSets: a.workSets }));
}

export async function progressExercise(tx: AnyTx, athleteId: string, rawKey: string) {
  const key = exerciseKey(keySchema.parse(rawKey));
  const completed = new Set((await workoutsOf(tx, athleteId, 'completed')).map((w) => w.id));
  const sets = (await tx.objectStore('sets').index('athleteExercise').getAll([athleteId, key])).filter((s) => completed.has(s.workoutId));
  sets.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  return { exerciseKey: key, sets: sets.slice(0, 5000).map(toSetDto) };
}

export async function weights(tx: AnyTx, athleteId: string): Promise<WeightDto[]> {
  const entries = (await tx.objectStore('weights').index('athleteId').getAll(athleteId)).map((w): WeightDto => ({ id: w.id, measuredOn: w.measuredOn, weightKg: w.weightKg, source: 'entry' }));
  const fromChecks = (await tx.objectStore('checks').index('athleteId').getAll(athleteId))
    .filter((c) => c.weightKg !== null)
    .map((c): WeightDto => ({ id: c.id, measuredOn: c.checkDate, weightKg: c.weightKg!, source: 'check' }));
  return [...entries, ...fromChecks].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn)).slice(0, 500);
}

export const weightSchema = z.object({ measuredOn: isoDateSchema, weightKg: z.number().min(20).max(400) });

export async function putWeight(tx: Tx, viewer: Viewer, id: string, b: z.infer<typeof weightSchema>): Promise<void> {
  const prev = await tx.objectStore('weights').get(id);
  if (prev && prev.athleteId !== viewer.id) throw notFound();
  await tx.objectStore('weights').put({ id, athleteId: viewer.id, measuredOn: b.measuredOn, weightKg: b.weightKg, createdAt: prev?.createdAt ?? nowIso() });
}

export async function deleteWeight(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const prev = await tx.objectStore('weights').get(id);
  if (prev && prev.athleteId === viewer.id) await tx.objectStore('weights').delete(id);
}
