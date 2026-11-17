import type { SetDto } from './api.js';

/** Solo serie allenanti valide: il riscaldamento è escluso da contatori e record. */
export function workSets(sets: readonly SetDto[]): SetDto[] {
  return sets.filter((s) => s.kind === 'work' && s.weightKg !== null && s.reps !== null && s.reps > 0);
}

export interface BestByReps {
  reps: number;
  weightKg: number;
  date: string;
}

/** Miglior carico per ciascun numero di ripetizioni. */
export function bestLoadByReps(sets: readonly SetDto[]): BestByReps[] {
  const best = new Map<number, BestByReps>();
  for (const s of workSets(sets)) {
    const reps = s.reps as number;
    const w = s.weightKg as number;
    const cur = best.get(reps);
    if (!cur || w > cur.weightKg || (w === cur.weightKg && s.completedAt < cur.date)) {
      best.set(reps, { reps, weightKg: w, date: s.completedAt });
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  weightKg: number;
}

/** Andamento a parità di ripetizioni: per ogni seduta il carico massimo eseguito con esattamente `reps`. */
export function trendAtReps(sets: readonly SetDto[], reps: number): TrendPoint[] {
  const byDay = new Map<string, number>();
  for (const s of workSets(sets)) {
    if (s.reps !== reps) continue;
    const day = s.completedAt.slice(0, 10);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, s.weightKg as number));
  }
  return [...byDay.entries()].map(([date, weightKg]) => ({ date, weightKg })).sort((a, b) => a.date.localeCompare(b.date));
}

export interface RepsImprovement {
  weightKg: number;
  fromReps: number;
  toReps: number;
  fromDate: string;
  toDate: string;
}

/** Miglioramenti di ripetizioni a parità di carico (prima vs migliore successiva). */
export function repsImprovementsAtSameLoad(sets: readonly SetDto[]): RepsImprovement[] {
  const byWeight = new Map<number, SetDto[]>();
  for (const s of workSets(sets)) {
    const w = s.weightKg as number;
    const list = byWeight.get(w) ?? [];
    list.push(s);
    byWeight.set(w, list);
  }
  const out: RepsImprovement[] = [];
  for (const [weightKg, list] of byWeight) {
    list.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const first = list[0];
    if (!first) continue;
    let best = first;
    for (const s of list) if ((s.reps as number) > (best.reps as number)) best = s;
    if (best !== first && (best.reps as number) > (first.reps as number)) {
      out.push({
        weightKg,
        fromReps: first.reps as number,
        toReps: best.reps as number,
        fromDate: first.completedAt.slice(0, 10),
        toDate: best.completedAt.slice(0, 10),
      });
    }
  }
  return out.sort((a, b) => b.weightKg - a.weightKg);
}

/** Variazione a parità di ripetizioni tra la prima e l'ultima rilevazione. */
export function deltaAtReps(sets: readonly SetDto[], reps: number): { first: TrendPoint; last: TrendPoint; delta: number } | null {
  const t = trendAtReps(sets, reps);
  const first = t[0];
  const last = t[t.length - 1];
  if (!first || !last || t.length < 2) return null;
  return { first, last, delta: Math.round((last.weightKg - first.weightKg) * 100) / 100 };
}

/** Rep count più frequenti (per proporre le linee da confrontare, es. 5 e 7 sul Pendulum). */
export function commonRepCounts(sets: readonly SetDto[], limit = 3): number[] {
  const count = new Map<number, number>();
  for (const s of workSets(sets)) count.set(s.reps as number, (count.get(s.reps as number) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([r]) => r)
    .sort((a, b) => a - b);
}

/** Media settimanale (lunedì-domenica ISO) del peso corporeo. */
export function weeklyAverages(entries: readonly { measuredOn: string; weightKg: number }[]): { weekStart: string; avg: number; n: number }[] {
  const weeks = new Map<string, { sum: number; n: number }>();
  for (const e of entries) {
    const d = new Date(`${e.measuredOn}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    const key = d.toISOString().slice(0, 10);
    const w = weeks.get(key) ?? { sum: 0, n: 0 };
    w.sum += e.weightKg;
    w.n += 1;
    weeks.set(key, w);
  }
  return [...weeks.entries()]
    .map(([weekStart, { sum, n }]) => ({ weekStart, avg: Math.round((sum / n) * 10) / 10, n }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}
