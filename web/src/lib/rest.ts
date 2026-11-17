/**
 * Timer di recupero basato sull'orologio reale (Date.now): lo stato persistito è solo
 * {inizio, durata, pause accumulate}, quindi il tempo resta corretto dopo background,
 * blocco schermo o riapertura dell'app.
 */
export interface RestTimer {
  startedAt: number;
  durationSec: number;
  label: string;
  /** Istante d'inizio della pausa in corso (epoch ms), null se il timer scorre. */
  pausedAt?: number | null;
  /** Millisecondi totali trascorsi in pausa. */
  pausedMs?: number;
}

export function elapsedMs(r: RestTimer, now: number): number {
  const paused = (r.pausedMs ?? 0) + (r.pausedAt ? now - r.pausedAt : 0);
  return Math.max(0, now - r.startedAt - paused);
}

/** Secondi rimanenti (negativi = oltre il recupero previsto). */
export function remainingSec(r: RestTimer, now: number): number {
  return r.durationSec - Math.floor(elapsedMs(r, now) / 1000);
}

export function pause(r: RestTimer, now: number): RestTimer {
  return r.pausedAt ? r : { ...r, pausedAt: now };
}

export function resume(r: RestTimer, now: number): RestTimer {
  if (!r.pausedAt) return r;
  return { ...r, pausedAt: null, pausedMs: (r.pausedMs ?? 0) + (now - r.pausedAt) };
}

export function adjust(r: RestTimer, deltaSec: number): RestTimer {
  return { ...r, durationSec: Math.max(0, Math.min(3600, r.durationSec + deltaSec)) };
}

export function setDuration(r: RestTimer, sec: number): RestTimer {
  return { ...r, durationSec: sec };
}

export const REST_PRESETS = [60, 90, 120, 180, 240, 300] as const;
