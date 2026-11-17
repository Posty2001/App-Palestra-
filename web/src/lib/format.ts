const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const dowFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long' });

/** Accetta 'YYYY-MM-DD' (data locale) o ISO completo. */
function toDate(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
}
export const fmtDate = (v: string | null | undefined): string => (v ? dateFmt.format(toDate(v)) : '—');
export const fmtShort = (v: string | null | undefined): string => (v ? shortFmt.format(toDate(v)) : '—');
export const fmtKg = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `${n.toLocaleString('it-IT', { maximumFractionDigits: 2 })} kg`);
export const fmtNum = (n: number | null | undefined, unit = ''): string => (n === null || n === undefined ? '—' : `${n.toLocaleString('it-IT', { maximumFractionDigits: 1 })}${unit}`);
export const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
export const fmtWeekday = (v: string): string => dowFmt.format(toDate(v));

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export function fmtSet(s: { weightKg: number | null; reps: number | null }): string {
  return `${s.weightKg === null ? '—' : s.weightKg.toLocaleString('it-IT')} kg × ${s.reps ?? '—'}`;
}

/** Parsing numeri italiani ("62,5"). */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function periodLabel(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  return `${fmtShort(start)} – ${fmtDate(end)}`;
}

export function daysUntil(date: string): number {
  const d = new Date(`${date}T00:00:00`).getTime();
  const t = new Date(`${todayLocal()}T00:00:00`).getTime();
  return Math.round((d - t) / 86400000);
}
