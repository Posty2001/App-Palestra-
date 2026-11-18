import { z } from 'zod';
import type { ProgramContent } from '@palestra/shared';
import { readTx, writeTx, nowIso, uuid, type ProfileRec } from './db';
import { generateIdentity } from './keys';
import { getProfile } from './services/access';
import { createProgram } from './services/programs';
import base from './baseProgram.json';

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Scrivi il tuo nome').max(80),
  role: z.enum(['athlete', 'coach']),
  withBaseProgram: z.boolean(),
});

export function loadProfile(): Promise<ProfileRec | undefined> {
  return readTx((tx) => getProfile(tx));
}

/** Primo avvio: crea l'identità locale (chiavi generate sul dispositivo) e, se richiesto, la scheda base. */
export async function createProfile(input: z.infer<typeof profileInputSchema>): Promise<ProfileRec> {
  const b = profileInputSchema.parse(input);
  const keys = await generateIdentity(); // fuori dalla transazione: crypto.subtle non è una richiesta IndexedDB
  return writeTx(async (tx) => {
    const existing = await getProfile(tx);
    if (existing) return existing; // doppio tocco o seconda scheda aperta: mai un secondo profilo
    const profile: ProfileRec = { id: uuid(), displayName: b.displayName, role: b.role, createdAt: nowIso(), keys };
    await tx.objectStore('meta').put(profile, 'profile');
    if (b.withBaseProgram) {
      await createProgram(tx, { ownerId: profile.id, createdBy: profile.id, input: { name: base.name, startDate: null, endDate: null, content: base.content as ProgramContent } });
    }
    return profile;
  });
}

export async function updateProfile(patch: { displayName?: string; role?: 'athlete' | 'coach' }): Promise<ProfileRec> {
  const name = patch.displayName !== undefined ? z.string().trim().min(1).max(80).parse(patch.displayName) : undefined;
  return writeTx(async (tx) => {
    const p = await getProfile(tx);
    if (!p) throw new Error('Profilo assente');
    const next = { ...p, ...(name ? { displayName: name } : {}), ...(patch.role ? { role: patch.role } : {}) };
    await tx.objectStore('meta').put(next, 'profile');
    return next;
  });
}
