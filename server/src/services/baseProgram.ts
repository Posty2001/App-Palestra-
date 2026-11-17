import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExercise, type ProgramContent } from '@palestra/shared';
import { importProgramPdf } from './pdfImport.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Funziona sia da sorgente (src/services) sia da build (dist). */
export async function readBasePdf(): Promise<Uint8Array> {
  for (const p of [path.resolve(here, '../../assets/scheda_allenamento_5_giorni.pdf'), path.resolve(here, '../assets/scheda_allenamento_5_giorni.pdf')]) {
    try { return new Uint8Array(await readFile(p)); } catch { /* prova il successivo */ }
  }
  throw new Error('assets/scheda_allenamento_5_giorni.pdf non trovato');
}

/**
 * Scheda personale del coach: importata dal PDF originale, con il Pendulum Squat
 * come terzo esercizio del Giorno 3 al posto di "RDL manubri" (2 serie, 7/5, 4’-5’).
 */
export async function buildBaseProgram(): Promise<{ name: string; content: ProgramContent }> {
  const res = await importProgramPdf(await readBasePdf(), 'scheda_allenamento_5_giorni.pdf');
  if (!res.content || res.content.days.length !== 5) throw new Error(`Import della scheda base fallito: ${res.message}`);
  const day3 = res.content.days[2]!;
  const idx = day3.exercises.findIndex((e) => /^rdl manubri$/i.test(e.name));
  if (idx !== 2) throw new Error('RDL manubri non trovato come terzo esercizio del Giorno 3');
  const old = day3.exercises[idx]!;
  day3.exercises[idx] = buildExercise({ id: old.id, name: 'Pendulum Squat', setsRaw: '2', repsRaw: '7/5', restRaw: '4’-5’' }).exercise;
  return { name: 'Scheda 5 giorni', content: res.content };
}
