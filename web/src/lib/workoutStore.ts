import { useSyncExternalStore } from 'react';
import { exerciseKey, type ExerciseState, type ProgramSummaryDto, type SetDto, type SetInput, type WorkoutDto } from '@palestra/shared';
import { api, uuid } from './api';
import { kvDel, kvGet, kvSet } from './idb';
import type { RestTimer } from './rest';
import { reportSaved, reportSaveError } from './sync';

/**
 * Seduta in corso — 3.0 local-first.
 * Ogni modifica è UNA transazione IndexedDB (router locale): la UI si aggiorna solo DOPO il commit,
 * quindi quando l'atleta vede «✓ Registrata» il dato è già salvato, anche se l'app viene chiusa subito dopo.
 * Il timer di recupero è stato di interfaccia: salvato a parte (kv), non fa parte dei dati della seduta.
 */

export type { RestTimer } from './rest';

export interface LocalWorkout extends WorkoutDto {
  rest: RestTimer | null;
}

let userId: string | null = null;
let current: LocalWorkout | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const restKey = (workoutId: string) => `rest:${workoutId}`;

/** Compatibilità 2.0: la chiave non indica più una copia in cache (il pacchetto Oggi è sempre calcolato dall'archivio). */
export const bundleKey = (u: string) => `bundle:${u}`;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useActiveWorkout(): { workout: LocalWorkout | null; loaded: boolean } {
  const w = useSyncExternalStore(subscribe, () => current);
  const l = useSyncExternalStore(subscribe, () => loaded);
  return { workout: w, loaded: l };
}

async function persist<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    reportSaved();
    return out;
  } catch (err) {
    reportSaveError(err instanceof Error ? err.message : 'Salvataggio non riuscito');
    throw err;
  }
}

function set(next: LocalWorkout | null): void {
  current = next;
  emit();
}

export async function initWorkoutStore(uid: string): Promise<void> {
  userId = uid;
  const w = await api<WorkoutDto | null>('GET', '/workouts/active');
  current = w ? { ...w, rest: (await kvGet<RestTimer>(restKey(w.id))) ?? null } : null;
  loaded = true;
  emit();
}

export function resetWorkoutStore(): void {
  userId = null;
  current = null;
  loaded = false;
  emit();
}

/** Riallinea la memoria con l'archivio (es. dopo un ripristino o un'importazione). */
export async function reconcileActive(fromDb?: WorkoutDto | null): Promise<void> {
  const w = fromDb === undefined ? await api<WorkoutDto | null>('GET', '/workouts/active') : fromDb;
  if (!w) return set(null);
  set({ ...w, rest: current?.id === w.id ? current.rest : ((await kvGet<RestTimer>(restKey(w.id))) ?? null) });
}

export async function startWorkout(program: ProgramSummaryDto, dayIndex: number): Promise<LocalWorkout> {
  if (!userId) throw new Error('Profilo non pronto');
  if (current) return current;
  if (!program.content.days[dayIndex]) throw new Error('Giorno non valido');
  const id = uuid();
  const w = await persist(() =>
    api<WorkoutDto>('PUT', `/workouts/${id}`, { programId: program.id, programVersionId: program.currentVersionId, dayIndex, startedAt: new Date().toISOString() }),
  );
  const lw: LocalWorkout = { ...w, rest: null };
  set(lw);
  return lw;
}

/** Registra (o corregge) una serie. L'id è fissato alla prima registrazione: ripetere non duplica. */
export async function saveSet(input: Omit<SetInput, 'completedAt'> & { id?: string; completedAt?: string }, startRest?: RestTimer): Promise<SetDto> {
  const w = current;
  if (!w) throw new Error('Nessuna seduta in corso');
  const existing = input.id ? w.sets.find((s) => s.id === input.id) : undefined;
  const set_: SetDto = {
    id: existing?.id ?? input.id ?? uuid(),
    workoutId: w.id,
    exerciseSlot: existing?.exerciseSlot ?? input.exerciseSlot,
    exerciseKey: input.exerciseKey,
    exerciseName: input.exerciseName,
    kind: existing?.kind ?? input.kind,
    setIndex: existing?.setIndex ?? input.setIndex,
    weightKg: input.weightKg,
    reps: input.reps,
    rir: input.rir,
    completedAt: existing?.completedAt ?? input.completedAt ?? new Date().toISOString(),
  };
  const { id, workoutId: _w, ...body } = set_;
  await persist(() => api('PUT', `/workouts/${w.id}/sets/${id}`, body));
  if (startRest) await kvSet(restKey(w.id), startRest);
  const latest = current?.id === w.id ? current : w;
  const sets = latest.sets.some((s) => s.id === id) ? latest.sets.map((s) => (s.id === id ? set_ : s)) : [...latest.sets, set_];
  set({ ...latest, sets, rest: startRest ?? latest.rest });
  return set_;
}

export async function deleteSet(setId: string): Promise<void> {
  const w = current;
  if (!w) return;
  await persist(() => api('DELETE', `/workouts/${w.id}/sets/${setId}`));
  const latest = current?.id === w.id ? current : w;
  set({ ...latest, sets: latest.sets.filter((s) => s.id !== setId) });
}

export async function setExerciseState(slot: string, state: ExerciseState | null): Promise<void> {
  const w = current;
  if (!w) return;
  await persist(() => api('PATCH', `/workouts/${w.id}/exercise-state`, { slot, state }));
  const latest = current?.id === w.id ? current : w;
  const states = { ...latest.exerciseStates };
  if (state) states[slot] = state;
  else delete states[slot];
  set({ ...latest, exerciseStates: states });
}

export async function setRest(rest: RestTimer | null): Promise<void> {
  const w = current;
  if (!w) return;
  if (rest) await kvSet(restKey(w.id), rest);
  else await kvDel(restKey(w.id));
  if (current?.id === w.id) set({ ...current, rest });
}

/** Salva la seduta (anche parziale): la rotazione della scheda avanza nella stessa transazione. */
export async function finishWorkout(note: string | null): Promise<void> {
  const w = current;
  if (!w) return;
  await persist(() => api('POST', `/workouts/${w.id}/finish`, { athleteNote: note?.trim() || null, endedAt: new Date().toISOString() }));
  await kvDel(restKey(w.id));
  set(null);
}

/** Scarta: nessun aggiornamento della rotazione. */
export async function discardWorkout(): Promise<void> {
  const w = current;
  if (!w) return;
  await persist(() => api('POST', `/workouts/${w.id}/discard`, {}));
  await kvDel(restKey(w.id));
  set(null);
}

export function slotExercise(w: WorkoutDto, slot: string): { name: string; key: string; substituted: boolean } {
  const ex = w.day.exercises.find((e) => e.id === slot);
  const st = w.exerciseStates[slot];
  const name = st?.state === 'substituted' ? st.name : ex?.name ?? '';
  return { name, key: exerciseKey(name), substituted: st?.state === 'substituted' };
}
