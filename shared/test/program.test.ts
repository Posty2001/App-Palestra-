import { describe, expect, it } from 'vitest';
import { buildExercise, exerciseKey, parseRest, parseSets, parseReps, workSetLabel } from '../src/index.js';
import { bestLoadByReps, repsImprovementsAtSameLoad, trendAtReps, weeklyAverages, type SetDto } from '../src/index.js';

describe('notazioni', () => {
  it('recuperi', () => {
    expect(parseRest('3’')).toEqual({ min: 180, max: 180 });
    expect(parseRest('2’-3’')).toEqual({ min: 120, max: 180 });
    expect(parseRest('4’-5’')).toEqual({ min: 240, max: 300 });
    expect(parseRest('90"')).toEqual({ min: 90, max: 90 });
    expect(parseRest('—')).toBeNull();
    expect(parseRest('')).toBeNull();
  });
  it('serie con top set e back-off', () => {
    expect(parseSets('3 (2 top set + 1 back off del 20%)')).toMatchObject({ sets: 3, topSets: 2, backoffSets: 1, backoffPct: 20, doubts: [] });
    expect(parseSets('3 (2 top + back off 20%)')).toMatchObject({ sets: 3, topSets: 2, backoffSets: 1, backoffPct: 20 });
    const p = parseSets('3 (2 top set + back off)');
    expect(p).toMatchObject({ sets: 3, topSets: 2, backoffSets: 1, backoffPct: null });
    expect(p.doubts).toContain('Percentuale del back-off non indicata');
    expect(parseSets('2')).toMatchObject({ sets: 2, topSets: null, backoffSets: null });
  });
  it('ripetizioni: conserva 10-6 e 10/6, separa top/back-off', () => {
    expect(parseReps('10-6')).toEqual({ topReps: null, backoffReps: null });
    expect(parseReps('7-5 (top set); 10 reps (back off)')).toEqual({ topReps: '7-5', backoffReps: '10' });
    const { exercise } = buildExercise({ name: 'Pulley stretto', setsRaw: '2', repsRaw: '10/6', restRaw: '—' });
    expect(exercise.repsRaw).toBe('10/6');
    expect(exercise.restSeconds).toBeNull();
  });
  it('etichette serie', () => {
    const { exercise } = buildExercise({ name: 'T Bar', setsRaw: '3 (2 top set + 1 back off del 20%)', repsRaw: '7-5 (top set); 10 reps (back off)', restRaw: '3’' });
    expect(workSetLabel(exercise, 0)).toEqual({ label: 'Top set 1', target: '7-5' });
    expect(workSetLabel(exercise, 2)).toEqual({ label: 'Back-off −20%', target: '10' });
  });
  it('chiave esercizio: maiuscole uguali, varianti separate', () => {
    expect(exerciseKey('Bayesian Curl')).toBe(exerciseKey('bayesian  curl'));
    expect(exerciseKey('Leg curl seduto')).not.toBe(exerciseKey('Leg curl sdraiato'));
  });
});

const set = (d: string, w: number, r: number, kind: 'work' | 'warmup' = 'work'): SetDto => ({
  id: `${d}-${w}-${r}-${kind}`, workoutId: d, exerciseSlot: 's', exerciseKey: 'pendulum squat', exerciseName: 'Pendulum Squat',
  kind, setIndex: 0, weightKg: w, reps: r, rir: null, completedAt: `${d}T10:00:00.000Z`,
});

describe('progressi', () => {
  const sets = [set('2026-11-01', 60, 7), set('2026-11-01', 65, 5), set('2026-11-08', 62.5, 7), set('2026-11-08', 67.5, 5), set('2026-11-08', 100, 5, 'warmup'), set('2026-11-15', 62.5, 8)];
  it('migliori carichi per ripetizioni escludono il riscaldamento', () => {
    expect(bestLoadByReps(sets)).toEqual([
      { reps: 5, weightKg: 67.5, date: '2026-11-08T10:00:00.000Z' },
      { reps: 7, weightKg: 62.5, date: '2026-11-08T10:00:00.000Z' },
      { reps: 8, weightKg: 62.5, date: '2026-11-15T10:00:00.000Z' },
    ]);
  });
  it('linee 5 e 7 ripetizioni', () => {
    expect(trendAtReps(sets, 5).map((p) => p.weightKg)).toEqual([65, 67.5]);
    expect(trendAtReps(sets, 7).map((p) => p.weightKg)).toEqual([60, 62.5]);
  });
  it('miglioramento ripetizioni a parità di carico', () => {
    expect(repsImprovementsAtSameLoad(sets)).toEqual([{ weightKg: 62.5, fromReps: 7, toReps: 8, fromDate: '2026-11-08', toDate: '2026-11-15' }]);
  });
  it('media settimanale', () => {
    expect(weeklyAverages([{ measuredOn: '2026-11-16', weightKg: 75 }, { measuredOn: '2026-11-18', weightKg: 76 }, { measuredOn: '2026-11-15', weightKg: 74 }])).toEqual([
      { weekStart: '2026-11-16', avg: 75.5, n: 2 },
      { weekStart: '2026-11-09', avg: 74, n: 1 },
    ]);
  });
});
