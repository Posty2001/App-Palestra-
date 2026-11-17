import type { Queryable } from '../db.js';
import { notFound } from '../lib/errors.js';

export interface Viewer {
  id: string;
  role: 'coach' | 'athlete';
  displayName: string;
  email: string;
  isDemo: boolean;
}

/** true se `coachId` segue `athleteId` con collegamento attivo (verifica sempre lato DB, mai cache). */
export async function isActiveCoachOf(db: Queryable, coachId: string, athleteId: string): Promise<boolean> {
  const r = await db.query('select 1 from coach_links where coach_id = $1 and athlete_id = $2 and ended_at is null', [coachId, athleteId]);
  return (r.rowCount ?? 0) > 0;
}

export type Access = 'self' | 'coach';

/** Può leggere i dati di `subjectId`? Rispondere 404 evita di rivelare l'esistenza di utenti non collegati. */
export async function assertCanView(db: Queryable, viewer: Viewer, subjectId: string): Promise<Access> {
  if (viewer.id === subjectId) return 'self';
  if (viewer.role === 'coach' && (await isActiveCoachOf(db, viewer.id, subjectId))) return 'coach';
  throw notFound();
}

export async function assertCoachOf(db: Queryable, viewer: Viewer, athleteId: string): Promise<void> {
  if (viewer.role !== 'coach' || !(await isActiveCoachOf(db, viewer.id, athleteId))) throw notFound();
}

export function assertSelf(viewer: Viewer, ownerId: string): void {
  if (viewer.id !== ownerId) throw notFound();
}
