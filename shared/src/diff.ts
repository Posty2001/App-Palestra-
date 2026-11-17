import type { ExerciseSpec, ProgramContent } from './program.js';

const fields: [keyof ExerciseSpec, string][] = [
  ['setsRaw', 'serie'],
  ['repsRaw', 'ripetizioni'],
  ['restRaw', 'recupero'],
  ['notes', 'note'],
];

/** Riepilogo leggibile delle differenze tra due versioni (mostrato all'atleta dopo "Pubblica modifica"). */
export function summarizeChanges(before: ProgramContent, after: ProgramContent): string[] {
  const out: string[] = [];
  const beforeDays = new Map(before.days.map((d, i) => [d.id, { d, i }]));
  const afterIds = new Set(after.days.map((d) => d.id));
  for (const d of before.days) if (!afterIds.has(d.id)) out.push(`Rimosso ${d.name}`);
  after.days.forEach((d, i) => {
    const prev = beforeDays.get(d.id);
    if (!prev) {
      out.push(`Aggiunto ${d.name} (${d.exercises.length} esercizi)`);
      return;
    }
    if (prev.d.name !== d.name) out.push(`${prev.d.name} rinominato in ${d.name}`);
    if (prev.i !== i) out.push(`${d.name} spostato in posizione ${i + 1}`);
    const prevEx = new Map(prev.d.exercises.map((e, j) => [e.id, { e, j }]));
    const curIds = new Set(d.exercises.map((e) => e.id));
    for (const e of prev.d.exercises) if (!curIds.has(e.id)) out.push(`${d.name}: rimosso ${e.name}`);
    d.exercises.forEach((e, j) => {
      const p = prevEx.get(e.id);
      if (!p) {
        out.push(`${d.name}: aggiunto ${e.name} (${e.setsRaw} × ${e.repsRaw})`);
        return;
      }
      if (p.e.name !== e.name) out.push(`${d.name}: ${p.e.name} sostituito con ${e.name}`);
      const changes = fields.filter(([k]) => p.e[k] !== e[k]).map(([k, label]) => `${label} ${String(p.e[k] || '—')} → ${String(e[k] || '—')}`);
      if (changes.length) out.push(`${d.name}, ${e.name}: ${changes.join(', ')}`);
      if (p.j !== j && p.e.name === e.name) out.push(`${d.name}: ${e.name} spostato in posizione ${j + 1}`);
    });
  });
  return out;
}
