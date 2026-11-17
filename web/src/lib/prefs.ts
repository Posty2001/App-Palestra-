/**
 * Preferenze locali al dispositivo (mai dati di dominio): passo dei pulsanti ± per esercizio,
 * soglia di inattività del coach, ultima modalità del coach. Accesso sempre protetto da try/catch.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modalità privata / storage pieno: la preferenza non è essenziale */
  }
}

export const STEP_OPTIONS = [1, 1.25, 2.5, 5] as const;
export type Step = (typeof STEP_OPTIONS)[number];

export function getStep(userId: string, exerciseKey: string): Step {
  const v = Number(read(`step:${userId}:${exerciseKey}`));
  return (STEP_OPTIONS as readonly number[]).includes(v) ? (v as Step) : 2.5;
}
export function setStep(userId: string, exerciseKey: string, step: Step): void {
  write(`step:${userId}:${exerciseKey}`, String(step));
}

/**
 * Somma senza errori di virgola mobile: si lavora in centesimi di kg (1,25 → 125).
 * Risultato mai negativo, al massimo 2 decimali.
 */
export function addStep(value: number | null, delta: number): number {
  const cents = Math.round((value ?? 0) * 100) + Math.round(delta * 100);
  return Math.max(0, cents) / 100;
}

export const DEFAULT_INACTIVITY_DAYS = 7;
export function getInactivityDays(userId: string): number {
  const v = Number(read(`inactivity:${userId}`));
  return Number.isInteger(v) && v >= 1 && v <= 90 ? v : DEFAULT_INACTIVITY_DAYS;
}
export function setInactivityDays(userId: string, days: number): void {
  write(`inactivity:${userId}`, String(Math.min(90, Math.max(1, Math.round(days)))));
}

export type CoachMode = 'coach' | 'personal';
export function getLastMode(userId: string): CoachMode {
  return read(`mode:${userId}`) === 'personal' ? 'personal' : 'coach';
}
export function setLastMode(userId: string, mode: CoachMode): void {
  write(`mode:${userId}`, mode);
}
