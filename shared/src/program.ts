import { z } from 'zod';

/**
 * Modello di una scheda. Le notazioni originali (es. "10-6", "10/6", "2’-3’")
 * sono SEMPRE conservate nei campi *Raw: i campi strutturati sono derivati
 * e servono solo dove il significato è esplicito (timer, top set/back-off).
 */

export const restRangeSchema = z
  .object({ min: z.number().int().min(0).max(3600), max: z.number().int().min(0).max(3600) })
  .refine((r) => r.max >= r.min, 'Recupero: massimo inferiore al minimo');

export const exerciseSpecSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Nome esercizio obbligatorio').max(120),
  sets: z.number().int().min(1).max(20).nullable(),
  setsRaw: z.string().max(120),
  repsRaw: z.string().max(120),
  restRaw: z.string().max(60),
  restSeconds: restRangeSchema.nullable(),
  topSets: z.number().int().min(0).max(20).nullable(),
  backoffSets: z.number().int().min(0).max(20).nullable(),
  backoffPct: z.number().min(0).max(100).nullable(),
  topReps: z.string().max(60).nullable(),
  backoffReps: z.string().max(60).nullable(),
  notes: z.string().max(500),
});

export const daySpecSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  exercises: z.array(exerciseSpecSchema).max(40),
});

export const programContentSchema = z.object({
  days: z.array(daySpecSchema).min(1, 'La scheda deve avere almeno un giorno').max(14),
});

export type RestRange = z.infer<typeof restRangeSchema>;
export type ExerciseSpec = z.infer<typeof exerciseSpecSchema>;
export type DaySpec = z.infer<typeof daySpecSchema>;
export type ProgramContent = z.infer<typeof programContentSchema>;

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Chiave stabile dell'esercizio: varianti/attrezzi con nome diverso restano separati. */
export function exerciseKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const APOS = /[’'′`´]/g;

/** "3’" → 180s, "2’-3’" → 120-180, "90''" o "90s" → 90, "—" → null. */
export function parseRest(raw: string): RestRange | null {
  const s = raw.replace(APOS, "'").replace(/\s+/g, '').toLowerCase();
  if (!s || /^[-–—]+$/.test(s)) return null;
  const unit = (v: string, u: string | undefined): number | null => {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    if (u === "''" || u === 's' || u === 'sec' || u === '"') return Math.round(n);
    return Math.round(n * 60); // default: minuti (notazione ’)
  };
  const m = s.match(/^(\d+(?:[.,]\d+)?)('{1,2}|"|s|sec|min|m)?(?:[-–/](\d+(?:[.,]\d+)?)('{1,2}|"|s|sec|min|m)?)?$/);
  if (!m) return null;
  const [, a, ua, b, ub] = m;
  if (a === undefined) return null;
  const first = unit(a, ua ?? ub);
  const second = b !== undefined ? unit(b, ub ?? ua) : first;
  if (first === null || second === null) return null;
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

export interface ParsedSets {
  sets: number | null;
  topSets: number | null;
  backoffSets: number | null;
  backoffPct: number | null;
  doubts: string[];
}

/** "3 (2 top set + 1 back off del 20%)", "3 (2 top + back off 20%)", "3 (2 top set + back off)", "2". */
export function parseSets(raw: string): ParsedSets {
  const s = raw.replace(/\s+/g, ' ').trim();
  const doubts: string[] = [];
  const total = s.match(/^(\d{1,2})\b/);
  const sets = total?.[1] ? Number(total[1]) : null;
  if (sets === null) doubts.push('Numero di serie non riconosciuto');
  const top = s.match(/(\d{1,2})\s*top/i);
  const hasBackoff = /back[\s-]?off/i.test(s);
  let topSets: number | null = top?.[1] ? Number(top[1]) : null;
  let backoffSets: number | null = null;
  let backoffPct: number | null = null;
  if (hasBackoff) {
    const bo = s.match(/(\d{1,2})\s*back[\s-]?off/i);
    backoffSets = bo?.[1] ? Number(bo[1]) : sets !== null && topSets !== null ? sets - topSets : 1;
    const pct = s.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    backoffPct = pct?.[1] ? Number(pct[1].replace(',', '.')) : null;
    if (backoffPct === null) doubts.push('Percentuale del back-off non indicata');
    if (topSets === null && sets !== null) topSets = sets - backoffSets;
  }
  if (sets !== null && topSets !== null && backoffSets !== null && topSets + backoffSets !== sets) {
    doubts.push('Top set + back-off non corrisponde al totale serie');
  }
  return { sets, topSets, backoffSets, backoffPct, doubts };
}

/** "7-5 (top set); 10 reps (back off)" → top "7-5", back-off "10". Il testo originale resta in repsRaw. */
export function parseReps(raw: string): { topReps: string | null; backoffReps: string | null } {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!/back[\s-]?off/i.test(s)) return { topReps: null, backoffReps: null };
  const parts = s.split(';').map((p) => p.trim());
  const clean = (p: string | undefined): string | null =>
    p ? p.replace(/\((?:top set|top|back[\s-]?off)\)/gi, '').replace(/\breps?\b/gi, '').trim() || null : null;
  return { topReps: clean(parts[0]), backoffReps: clean(parts[1]) };
}

export function buildExercise(input: {
  name: string;
  setsRaw: string;
  repsRaw: string;
  restRaw: string;
  notes?: string;
  id?: string;
}): { exercise: ExerciseSpec; doubts: string[] } {
  const ps = parseSets(input.setsRaw);
  const pr = parseReps(input.repsRaw);
  const rest = parseRest(input.restRaw);
  const doubts = [...ps.doubts];
  if (!input.repsRaw.trim()) doubts.push('Ripetizioni mancanti');
  if (rest === null) doubts.push(input.restRaw.trim() && !/^[-–—\s]+$/.test(input.restRaw) ? 'Recupero non interpretabile' : 'Recupero non indicato');
  return {
    exercise: {
      id: input.id ?? newId(),
      name: input.name.replace(/\s+/g, ' ').trim(),
      sets: ps.sets,
      setsRaw: input.setsRaw.replace(/\s+/g, ' ').trim(),
      repsRaw: input.repsRaw.replace(/\s+/g, ' ').trim(),
      restRaw: input.restRaw.replace(/\s+/g, ' ').trim(),
      restSeconds: rest,
      topSets: ps.topSets,
      backoffSets: ps.backoffSets,
      backoffPct: ps.backoffPct,
      topReps: pr.topReps,
      backoffReps: pr.backoffReps,
      notes: input.notes ?? '',
    },
    doubts,
  };
}

/** Etichetta della serie allenante i-esima (0-based) secondo top set / back-off. */
export function workSetLabel(ex: ExerciseSpec, index: number): { label: string; target: string } {
  if (ex.topSets !== null && ex.backoffSets !== null && ex.backoffSets > 0) {
    if (index < ex.topSets) return { label: `Top set ${index + 1}`, target: ex.topReps ?? ex.repsRaw };
    const pct = ex.backoffPct !== null ? ` −${ex.backoffPct}%` : '';
    return { label: `Back-off${pct}`, target: ex.backoffReps ?? ex.repsRaw };
  }
  return { label: `Serie ${index + 1}`, target: ex.repsRaw };
}

export function plannedSetCount(ex: ExerciseSpec): number {
  return ex.sets ?? 1;
}

export function defaultRestSeconds(ex: ExerciseSpec | undefined): number {
  return ex?.restSeconds?.max ?? 180;
}

export function formatRest(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
