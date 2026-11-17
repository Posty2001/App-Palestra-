import type { AthleteSummaryDto } from '@palestra/shared';

/**
 * Stato di attività calcolato dai dati già restituiti da /coach/athletes (ultimo allenamento salvato),
 * quindi nel rispetto del collegamento coach–atleta verificato dal server. Nessuna query aggiuntiva.
 */
export type Activity =
  | { kind: 'never' }
  | { kind: 'active'; days: number }
  | { kind: 'inactive'; days: number };

const DAY = 86_400_000;

export function activityOf(a: AthleteSummaryDto, thresholdDays: number, now: number = Date.now()): Activity {
  const last = a.lastWorkout?.endedAt ?? null;
  if (!a.lastWorkout || !last) return { kind: 'never' };
  const days = Math.max(0, Math.floor((now - new Date(last).getTime()) / DAY));
  return days > thresholdDays ? { kind: 'inactive', days } : { kind: 'active', days };
}

export function activityLabel(act: Activity): string {
  if (act.kind === 'never') return 'Nessun allenamento registrato';
  if (act.kind === 'inactive') return `Inattivo da ${act.days} giorni`;
  return act.days === 0 ? 'Attivo oggi' : act.days === 1 ? 'Attivo ieri' : `Attivo ${act.days} giorni fa`;
}
