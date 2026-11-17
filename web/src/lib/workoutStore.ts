import { useSyncExternalStore } from 'react';
import { exerciseKey, type ExerciseState, type ProgramSummaryDto, type SetDto, type SetInput, type TodayBundleDto, type WorkoutDto } from '@palestra/shared';
import { uuid } from './api';
import { atomicWrite, kvGet, kvSet } from './idb';
import type { RestTimer } from './rest';
import { newOp, notifyEnqueued, onOpSettled, pendingOps } from './sync';
import type { OutboxOp } from './idb';

/**
 * Seduta in corso "local-first": lo stato vive in IndexedDB (sopravvive a chiusura app e assenza di rete),
 * ogni modifica è accodata come operazione idempotente verso il server.
 */

export type { RestTimer } from './rest';

export interface LocalWorkout extends WorkoutDto {
  rest: RestTimer | null;
}

let userId: string | null = null;
let current: LocalWorkout | null = null;
let loaded = false;
const listeners = new Set<() => void>();

const key = (u: string) => `active:${u}`;
export const bundleKey = (u: string) => `bundle:${u}`;

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Persiste stato + operazione in un'unica transazione, POI aggiorna la UI:
 * quando l'atleta vede "✓ Registrata" il dato è già al sicuro anche se l'app viene chiusa subito dopo.
 */
async function commit(next: LocalWorkout | null, op?: Omit<OutboxOp, 'seq' | 'createdAt' | 'attempts' | 'userId'>): Promise<void> {
  if (userId) await atomicWrite(key(userId), next, op ? newOp(op) : null);
  // Prima il contatore della coda (stato di sync sempre veritiero), poi la UI.
  if (op) await notifyEnqueued();
  current = next;
  emit();
}

function update(next: LocalWorkout | null): Promise<void> {
  return commit(next);
}

export function useActiveWorkout(): { workout: LocalWorkout | null; loaded: boolean } {
  const w = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  const l = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => loaded,
  );
  return { workout: w, loaded: l };
}

export async function initWorkoutStore(uid: string): Promise<void> {
  userId = uid;
  current = (await kvGet<LocalWorkout>(key(uid))) ?? null;
  loaded = true;
  emit();
}

export function resetWorkoutStore(): void {
  userId = null;
  current = null;
  loaded = false;
  emit();
}

/**
 * Riconcilia con il server (es. nuovo accesso da un altro dispositivo):
 * - modifiche locali non ancora inviate → vince lo stato locale (verrà sincronizzato);
 * - altrimenti vince il server (unica fonte di verità), così i dati non compaiono mai due volte.
 */
export async function reconcileActive(server: WorkoutDto | null): Promise<void> {
  const local = current;
  if (local) {
    const pending = await pendingOps(local.id);
    if (pending.length) return;
    if (server && server.id === local.id) {
      await update({ ...server, rest: local.rest });
      return;
    }
    await update(server ? { ...server, rest: null } : null);
    return;
  }
  if (server) await update({ ...server, rest: null });
}

export async function startWorkout(program: ProgramSummaryDto, dayIndex: number): Promise<LocalWorkout> {
  if (!userId) throw new Error('Utente non pronto');
  if (current) return current;
  const day = program.content.days[dayIndex];
  if (!day) throw new Error('Giorno non valido');
  const w: LocalWorkout = {
    id: uuid(),
    athleteId: userId,
    programId: program.id,
    programVersionId: program.currentVersionId,
    versionNo: program.versionNo,
    programName: program.name,
    dayIndex,
    day: structuredClone(day),
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    endedAt: null,
    athleteNote: null,
    exerciseStates: {},
    sets: [],
    rest: null,
  };
  await commit(w, {
    method: 'PUT',
    path: `/workouts/${w.id}`,
    body: { programId: w.programId, programVersionId: w.programVersionId, dayIndex, startedAt: w.startedAt },
    workoutId: w.id,
  });
  return w;
}

/** Registra (o corregge) una serie. L'id è fissato alla prima registrazione: ripetere non duplica. */
export async function saveSet(input: Omit<SetInput, 'completedAt'> & { id?: string; completedAt?: string }, startRest?: RestTimer): Promise<SetDto> {
  const w = current;
  if (!w) throw new Error('Nessuna seduta in corso');
  const existing = input.id ? w.sets.find((s) => s.id === input.id) : undefined;
  const set: SetDto = {
    id: existing?.id ?? input.id ?? uuid(),
    workoutId: w.id,
    exerciseSlot: input.exerciseSlot,
    exerciseKey: input.exerciseKey,
    exerciseName: input.exerciseName,
    kind: input.kind,
    setIndex: input.setIndex,
    weightKg: input.weightKg,
    reps: input.reps,
    rir: input.rir,
    completedAt: existing?.completedAt ?? input.completedAt ?? new Date().toISOString(),
  };
  const sets = existing ? w.sets.map((s) => (s.id === set.id ? set : s)) : [...w.sets, set];
  const { id, workoutId, ...body } = set;
  void workoutId;
  await commit({ ...w, sets, rest: startRest ?? w.rest }, { method: 'PUT', path: `/workouts/${w.id}/sets/${id}`, body, workoutId: w.id });
  return set;
}

export async function deleteSet(setId: string): Promise<void> {
  const w = current;
  if (!w) return;
  await commit({ ...w, sets: w.sets.filter((s) => s.id !== setId) }, { method: 'DELETE', path: `/workouts/${w.id}/sets/${setId}`, body: undefined, workoutId: w.id });
}

export async function setExerciseState(slot: string, state: ExerciseState | null): Promise<void> {
  const w = current;
  if (!w) return;
  const states = { ...w.exerciseStates };
  if (state) states[slot] = state;
  else delete states[slot];
  await commit({ ...w, exerciseStates: states }, { method: 'PATCH', path: `/workouts/${w.id}/exercise-state`, body: { slot, state }, workoutId: w.id });
}

export async function setRest(rest: RestTimer | null): Promise<void> {
  if (!current) return;
  await update({ ...current, rest });
}

/** Salva la seduta (anche parziale) e aggiorna subito la rotazione nella cache locale, anche offline. */
export async function finishWorkout(note: string | null): Promise<void> {
  const w = current;
  if (!w || !userId) return;
  const endedAt = new Date().toISOString();
  // Prima la rotazione nella cache (la vista Oggi è corretta anche offline), poi chiusura atomica: stato rimosso + operazione in coda.
  const bundle = await kvGet<TodayBundleDto>(bundleKey(userId));
  if (bundle) {
    for (const p of bundle.programs) {
      if (p.id === w.programId && p.content.days.length) p.nextDayIndex = (w.dayIndex + 1) % p.content.days.length;
    }
    const byKey = new Map<string, SetDto[]>();
    for (const s of w.sets) byKey.set(s.exerciseKey, [...(byKey.get(s.exerciseKey) ?? []), s]);
    for (const [k, sets] of byKey) {
      const ctx = bundle.contexts[k] ?? { exerciseKey: k, lastSets: [], lastDate: null, machineSetup: null, feedback: [], questions: [] };
      bundle.contexts[k] = { ...ctx, lastSets: sets, lastDate: w.startedAt };
    }
    await kvSet(bundleKey(userId), bundle);
  }
  await commit(null, { method: 'POST', path: `/workouts/${w.id}/finish`, body: { athleteNote: note?.trim() || null, endedAt }, workoutId: w.id });
}

/** Scarta: nessun aggiornamento della rotazione. */
export async function discardWorkout(): Promise<void> {
  const w = current;
  if (!w) return;
  await commit(null, { method: 'POST', path: `/workouts/${w.id}/discard`, body: {}, workoutId: w.id });
}

export function slotExercise(w: WorkoutDto, slot: string): { name: string; key: string; substituted: boolean } {
  const ex = w.day.exercises.find((e) => e.id === slot);
  const st = w.exerciseStates[slot];
  const name = st?.state === 'substituted' ? st.name : ex?.name ?? '';
  return { name, key: exerciseKey(name), substituted: st?.state === 'substituted' };
}

// Se il server rifiuta l'avvio perché esiste già una seduta in corso altrove, lo stato locale va riallineato.
onOpSettled((op, result, err) => {
  if (result === 'rejected' && current && op.workoutId === current.id && (err?.code === 'active_exists' || err?.code === 'workout_closed')) {
    void update(null);
  }
});
