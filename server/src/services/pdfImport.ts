import { buildExercise, newId, type DaySpec, type PdfImportResultDto, type ProgramContent } from '@palestra/shared';

interface TextItem {
  page: number;
  x: number;
  y: number;
  h: number;
  str: string;
}

type ColKind = 'name' | 'sets' | 'reps' | 'rest' | 'notes';

const HEADER_WORDS: Record<ColKind, RegExp> = {
  name: /^(esercizi[oa]?|exercise|movimento)$/i,
  sets: /^(serie|sets?)$/i,
  reps: /^(ripetizioni|rip\.?|reps?|repetitions)$/i,
  rest: /^(recupero|rec\.?|rest|pausa)$/i,
  notes: /^(note|notes|tecnica)$/i,
};
const DAY_RE = /^(giorno|day|seduta|allenamento)\s*([0-9]+|[a-e])\b/i;
const FOOTER_RE = /^(pagina|page)\s*\d+(\s*(di|of)\s*\d+)?$/i;

const MAX_PAGES = 20;

export async function extractItems(data: Uint8Array): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const items: TextItem[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const str = it.str.replace(/\s+/g, ' ').trim();
        if (!str) continue;
        items.push({ page: p, x: it.transform[4] as number, y: it.transform[5] as number, h: Math.abs(it.height) || 8, str });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await doc.destroy();
  }
}

interface Line {
  page: number;
  y: number;
  items: TextItem[];
}

/** Raggruppa per riga visiva (stessa y entro tolleranza) in ordine di lettura. */
function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(1.5, it.h * 0.25)) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function headerColumns(line: Line): { kind: ColKind; x: number }[] | null {
  const cols: { kind: ColKind; x: number }[] = [];
  for (const it of line.items) {
    for (const [kind, re] of Object.entries(HEADER_WORDS) as [ColKind, RegExp][]) {
      if (re.test(it.str)) cols.push({ kind, x: it.x });
    }
  }
  const kinds = new Set(cols.map((c) => c.kind));
  if (!kinds.has('name') || !(kinds.has('sets') || kinds.has('reps'))) return null;
  return cols.sort((a, b) => a.x - b.x);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 8;
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/**
 * Converte un PDF con testo selezionabile e layout tabellare (Esercizio | Serie | Ripetizioni | Recupero)
 * in una bozza di scheda. Non salva nulla: restituisce bozza + elementi dubbi da confermare.
 */
export function parseProgramFromItems(items: TextItem[], fallbackName: string): PdfImportResultDto {
  if (items.length === 0) {
    return {
      status: 'unreadable', name: fallbackName, content: null, doubts: [],
      message: 'Il PDF non contiene testo selezionabile (probabilmente è una scansione o un\'immagine). Inserisci la scheda a mano.',
    };
  }
  const lines = toLines(items.filter((i) => !FOOTER_RE.test(i.str)));
  const lineGap = 1.75 * median(items.map((i) => i.h));

  const days: DaySpec[] = [];
  const doubts: PdfImportResultDto['doubts'] = [];
  const titleParts: string[] = [];
  let currentDay: DaySpec | null = null;
  let cols: { kind: ColKind; x: number }[] | null = null;
  let block: Line[] = [];

  const flush = (): void => {
    if (!block.length || !cols) { block = []; return; }
    const columns = cols;
    if (!currentDay) {
      currentDay = { id: newId(), name: `Giorno ${days.length + 1}`, exercises: [] };
      days.push(currentDay);
      doubts.push({ where: `day:${days.length - 1}`, message: 'Intestazione del giorno non trovata: nome assegnato automaticamente' });
    }
    const cells: Record<ColKind, string[]> = { name: [], sets: [], reps: [], rest: [], notes: [] };
    for (const line of block) {
      for (const it of line.items) {
        let kind: ColKind = columns[0]?.kind ?? 'name';
        for (const c of columns) if (it.x + 3 >= c.x) kind = c.kind;
        cells[kind].push(it.str);
      }
    }
    const name = cells.name.join(' ').trim();
    const dayIdx = days.length - 1;
    if (!name) {
      doubts.push({ where: `day:${dayIdx}`, message: `Riga senza nome esercizio ignorata: "${[...cells.sets, ...cells.reps, ...cells.rest].join(' ')}"` });
      block = [];
      return;
    }
    const { exercise, doubts: exDoubts } = buildExercise({
      name, setsRaw: cells.sets.join(' '), repsRaw: cells.reps.join(' '), restRaw: cells.rest.join(' '), notes: cells.notes.join(' '),
    });
    const exIdx = currentDay.exercises.length;
    currentDay.exercises.push(exercise);
    for (const m of exDoubts) doubts.push({ where: `${dayIdx}:${exIdx}`, message: m });
    block = [];
  };

  for (const line of lines) {
    const first = line.items[0];
    if (!first) continue;
    const joined = line.items.map((i) => i.str).join(' ');
    const dayMatch = DAY_RE.exec(joined);
    if (dayMatch && line.items.length <= 3) {
      flush();
      currentDay = { id: newId(), name: titleCase(joined.trim()).slice(0, 60), exercises: [] };
      days.push(currentDay);
      cols = null;
      continue;
    }
    const hdr = headerColumns(line);
    if (hdr) {
      flush();
      cols = hdr;
      continue;
    }
    if (!cols) {
      if (!days.length) titleParts.push(titleCase(joined.trim()));
      continue;
    }
    const prev = block[block.length - 1];
    if (prev && (prev.page !== line.page || prev.y - line.y > lineGap)) flush();
    block.push(line);
  }
  flush();

  const exerciseCount = days.reduce((n, d) => n + d.exercises.length, 0);
  if (!days.length || exerciseCount === 0) {
    return {
      status: 'unreadable', name: fallbackName, content: null, doubts,
      message: 'Layout non riconosciuto: servono una o più tabelle con colonne Esercizio, Serie, Ripetizioni, Recupero. Inserisci la scheda a mano.',
    };
  }
  days.forEach((d, i) => {
    if (!d.exercises.length) doubts.push({ where: `day:${i}`, message: 'Giorno senza esercizi riconosciuti' });
  });
  const content: ProgramContent = { days };
  const name = (titleParts.filter(Boolean).join(' – ') || fallbackName).slice(0, 80);
  return {
    status: doubts.length ? 'partial' : 'ok',
    name,
    content,
    doubts,
    message: `Trovati ${days.length} giorni e ${exerciseCount} esercizi. Controlla la bozza${doubts.length ? ` e i ${doubts.length} elementi da verificare` : ''} prima di salvare.`,
  };
}

export async function importProgramPdf(data: Uint8Array, fileName: string): Promise<PdfImportResultDto> {
  const fallbackName = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Scheda importata';
  if (data.length < 5 || Buffer.from(data.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    return { status: 'unreadable', name: fallbackName, content: null, doubts: [], message: 'Il file non è un PDF valido.' };
  }
  let items: TextItem[];
  try {
    items = await extractItems(data);
  } catch {
    return { status: 'unreadable', name: fallbackName, content: null, doubts: [], message: 'Impossibile leggere il PDF (file danneggiato o protetto). Inserisci la scheda a mano.' };
  }
  return parseProgramFromItems(items, fallbackName);
}
