import { z } from 'zod';
import { isoDateSchema, type CheckDto, type Pose } from '@palestra/shared';
import { notFound } from '../../lib/errors';
import { nowIso, type CheckRec, type PhotoRec, type Tx } from '../db';
import { assertCanView, assertCoachOf, type Access, type AnyTx, type Viewer } from './access';

const num = (min: number, max: number) => z.number().min(min).max(max).nullable();
export const checkSchema = z.object({
  checkDate: isoDateSchema,
  weightKg: num(20, 400),
  bicepsCm: num(10, 100),
  chestCm: num(40, 250),
  thighCm: num(20, 150),
  waistCm: num(30, 250),
  note: z.string().trim().max(2000).nullable(),
  sharePhotos: z.boolean(),
});

async function toDto(tx: AnyTx, c: CheckRec, access: Access): Promise<CheckDto> {
  const photos = await tx.objectStore('photos').index('checkId').getAll(c.id);
  const fb = (await tx.objectStore('feedback').index('checkId').getAll(c.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Lato coach esistono solo le foto ricevute perché condivise; la regola resta comunque esplicita.
  const visible = access === 'self' || c.sharePhotos;
  return {
    id: c.id, athleteId: c.athleteId, checkDate: c.checkDate, weightKg: c.weightKg, bicepsCm: c.bicepsCm, chestCm: c.chestCm, thighCm: c.thighCm,
    waistCm: c.waistCm, note: c.note, sharePhotos: c.sharePhotos, reviewedAt: c.reviewedAt, createdAt: c.createdAt,
    photos: visible ? photos.map((p) => ({ id: p.id, pose: p.pose, width: p.width, height: p.height })) : [],
    photoCount: photos.length,
    feedback: fb.map((f) => ({ id: f.id, body: f.body, createdAt: f.createdAt, coachName: f.coachName })),
  };
}

export async function listChecks(tx: AnyTx, viewer: Viewer, athleteId: string): Promise<CheckDto[]> {
  const access = await assertCanView(tx, viewer, athleteId);
  const cs = (await tx.objectStore('checks').index('athleteId').getAll(athleteId)).sort((a, b) => b.checkDate.localeCompare(a.checkDate) || b.createdAt.localeCompare(a.createdAt));
  const out: CheckDto[] = [];
  for (const c of cs.slice(0, 200)) out.push(await toDto(tx, c, access));
  return out;
}

export async function getCheck(tx: AnyTx, viewer: Viewer, id: string): Promise<CheckDto> {
  const c = await tx.objectStore('checks').get(id);
  if (!c) throw notFound();
  return toDto(tx, c, await assertCanView(tx, viewer, c.athleteId));
}

async function ownCheck(tx: AnyTx, viewer: Viewer, id: string): Promise<CheckRec> {
  const c = await tx.objectStore('checks').get(id);
  if (!c || c.athleteId !== viewer.id) throw notFound();
  return c;
}

export async function putCheck(tx: Tx, viewer: Viewer, id: string, b: z.infer<typeof checkSchema>): Promise<CheckDto> {
  const prev = await tx.objectStore('checks').get(id);
  if (prev && prev.athleteId !== viewer.id) throw notFound();
  const now = nowIso();
  const rec: CheckRec = {
    id, athleteId: viewer.id, checkDate: b.checkDate, weightKg: b.weightKg, bicepsCm: b.bicepsCm, chestCm: b.chestCm, thighCm: b.thighCm, waistCm: b.waistCm,
    note: b.note || null, sharePhotos: b.sharePhotos, reviewedAt: prev?.reviewedAt ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
  await tx.objectStore('checks').put(rec);
  return toDto(tx, rec, 'self');
}

export async function setSharing(tx: Tx, viewer: Viewer, id: string, sharePhotos: boolean): Promise<CheckDto> {
  const c = await ownCheck(tx, viewer, id);
  const rec = { ...c, sharePhotos, updatedAt: nowIso() };
  await tx.objectStore('checks').put(rec);
  return toDto(tx, rec, 'self');
}

/** Elimina il check con foto e commenti, nella stessa transazione: nessun file orfano. */
export async function deleteCheck(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const c = await ownCheck(tx, viewer, id);
  for (const p of await tx.objectStore('photos').index('checkId').getAllKeys(c.id)) await tx.objectStore('photos').delete(p);
  for (const f of await tx.objectStore('feedback').index('checkId').getAllKeys(c.id)) await tx.objectStore('feedback').delete(f);
  await tx.objectStore('checks').delete(c.id);
}

export interface ProcessedPhoto {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
}

/** Sostituisce la foto della posa: la precedente viene rimossa nella stessa transazione. */
export async function putPhoto(tx: Tx, viewer: Viewer, checkId: string, pose: Pose, img: ProcessedPhoto): Promise<CheckDto> {
  const c = await ownCheck(tx, viewer, checkId);
  for (const p of await tx.objectStore('photos').index('checkId').getAll(c.id)) if (p.pose === pose) await tx.objectStore('photos').delete(p.id);
  const rec: PhotoRec = { id: img.id, checkId: c.id, athleteId: viewer.id, pose, mime: 'image/jpeg', bytes: img.blob.size, width: img.width, height: img.height, sha256: img.sha256, blob: img.blob, createdAt: nowIso() };
  await tx.objectStore('photos').add(rec);
  await tx.objectStore('checks').put({ ...c, updatedAt: nowIso() });
  return toDto(tx, c, 'self');
}

export async function deletePhoto(tx: Tx, viewer: Viewer, checkId: string, pose: Pose): Promise<CheckDto> {
  const c = await ownCheck(tx, viewer, checkId);
  for (const p of await tx.objectStore('photos').index('checkId').getAll(c.id)) if (p.pose === pose) await tx.objectStore('photos').delete(p.id);
  return toDto(tx, c, 'self');
}

/** Unico accesso ai byte di una foto: proprietario, oppure coach dell'atleta solo se la condivisione è attiva. */
export async function photoBlob(tx: AnyTx, viewer: Viewer, id: string): Promise<Blob> {
  const p = await tx.objectStore('photos').get(id);
  if (!p) throw notFound();
  const c = await tx.objectStore('checks').get(p.checkId);
  if (!c) throw notFound();
  const access = await assertCanView(tx, viewer, p.athleteId);
  if (access === 'coach' && !c.sharePhotos) throw notFound();
  return p.blob;
}

export async function addCheckFeedback(tx: Tx, viewer: Viewer, checkId: string, body: string, id: string): Promise<CheckDto> {
  const c = await tx.objectStore('checks').get(checkId);
  if (!c) throw notFound();
  await assertCoachOf(tx, viewer, c.athleteId);
  const now = nowIso();
  await tx.objectStore('feedback').add({ id, athleteId: c.athleteId, coachId: viewer.id, coachName: viewer.displayName, kind: 'check', exerciseKey: null, exerciseName: null, checkId, body, createdAt: now });
  const rec = { ...c, reviewedAt: c.reviewedAt ?? now };
  await tx.objectStore('checks').put(rec);
  return toDto(tx, rec, 'coach');
}
