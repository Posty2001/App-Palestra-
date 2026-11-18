import type { ProgramDetailDto, ProgramSummaryDto, TodayBundleDto, WorkoutDto } from '@palestra/shared';
import { api } from '../lib/api';
import { createProfile } from '../local/profile';

export async function setupAthlete(withBase = true) {
  const profile = await createProfile({ displayName: 'Franco', role: 'athlete', withBaseProgram: withBase });
  const programs = await api<ProgramSummaryDto[]>('GET', '/programs');
  return { profile, programs };
}

export async function setupCoach() {
  return createProfile({ displayName: 'Coach Test', role: 'coach', withBaseProgram: true });
}

export const bundle = () => api<TodayBundleDto>('GET', '/bundle?today=2026-11-18');
export const program = (id: string) => api<ProgramDetailDto>('GET', `/programs/${id}`);

export async function start(p: ProgramSummaryDto, dayIndex: number, id: string = crypto.randomUUID()): Promise<WorkoutDto> {
  return api<WorkoutDto>('PUT', `/workouts/${id}`, { programId: p.id, programVersionId: p.currentVersionId, dayIndex, startedAt: new Date().toISOString() });
}

export function setBody(slot: string, name: string, setIndex: number, weightKg: number, reps: number) {
  return { exerciseSlot: slot, exerciseKey: name.toLowerCase(), exerciseName: name, kind: 'work' as const, setIndex, weightKg, reps, rir: null, completedAt: new Date().toISOString() };
}
