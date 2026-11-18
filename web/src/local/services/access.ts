import { notFound, forbidden } from '../../lib/errors';
import type { PersonRec, ProfileRec, Tx } from '../db';

/** Chi sta usando l'app: sempre e solo il profilo di questa installazione. */
export interface Viewer {
  id: string;
  role: 'coach' | 'athlete';
  displayName: string;
}

export type AnyTx = Tx<'readonly'> | Tx<'readwrite'>;
export type Access = 'self' | 'coach';

export const viewerOf = (p: ProfileRec): Viewer => ({ id: p.id, role: p.role, displayName: p.displayName });

export async function getProfile(tx: AnyTx): Promise<ProfileRec | undefined> {
  return (await tx.objectStore('meta').get('profile')) as ProfileRec | undefined;
}

/** Atleta seguito da questo dispositivo (solo profilo coach). */
export async function athleteOf(tx: AnyTx, viewer: Viewer, athleteId: string): Promise<PersonRec | null> {
  if (viewer.role !== 'coach') return null;
  const p = await tx.objectStore('people').get(athleteId);
  return p && p.role === 'athlete' && !p.endedAt ? p : null;
}

/** Il coach dell'atleta (lato atleta), se collegato. */
export async function myCoach(tx: AnyTx): Promise<PersonRec | null> {
  const all = (await tx.objectStore('people').index('role').getAll('coach')).filter((c) => !c.endedAt);
  return all.find((c) => c.keyConfirmedAt) ?? all[0] ?? null;
}

/** Stessa semantica della 2.0: 404 per ciò che non appartiene al richiedente né a un suo atleta. */
export async function assertCanView(tx: AnyTx, viewer: Viewer, subjectId: string): Promise<Access> {
  if (subjectId === viewer.id) return 'self';
  if (await athleteOf(tx, viewer, subjectId)) return 'coach';
  throw notFound();
}

export async function assertCoachOf(tx: AnyTx, viewer: Viewer, athleteId: string): Promise<PersonRec> {
  const a = await athleteOf(tx, viewer, athleteId);
  if (!a) throw notFound();
  return a;
}

export function requireCoach(viewer: Viewer): void {
  if (viewer.role !== 'coach') throw forbidden('Funzione riservata al coach');
}
