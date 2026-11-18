import { z } from 'zod';
import { isoDateSchema, programContentSchema, summarizeChanges, type ProgramContent, type ProgramDetailDto, type ProgramSummaryDto } from '@palestra/shared';
import { badRequest, notFound } from '../../lib/errors';
import { canonicalJson } from '../canonical';
import { nowIso, uuid, type ProgramRec, type Tx, type VersionRec } from '../db';
import { sha256Sync } from '../sha256';
import { assertCanView, assertCoachOf, type AnyTx, type Viewer } from './access';

export const programMetaSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome scheda obbligatorio').max(80),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'La data finale deve essere uguale o successiva a quella iniziale',
    path: ['endDate'],
  });
export const programInputSchema = z.intersection(programMetaSchema, z.object({ content: programContentSchema }));
export type ProgramInput = z.infer<typeof programInputSchema>;

/** Garantisce id univoci di giorni ed esercizi (chiave per storico e diff). */
export function normalizeContent(content: ProgramContent): ProgramContent {
  const seen = new Set<string>();
  const uniq = (id: string): string => {
    let out = id;
    while (seen.has(out)) out = uuid();
    seen.add(out);
    return out;
  };
  return { days: content.days.map((d) => ({ ...d, id: uniq(d.id), exercises: d.exercises.map((e) => ({ ...e, id: uniq(e.id) })) })) };
}

/** Impronta di una versione: identica su ogni dispositivo per lo stesso contenuto (base dell'anti-conflitto nei pacchetti). */
export const contentHash = (c: ProgramContent): string => sha256Sync(canonicalJson(c));

interface Loaded {
  p: ProgramRec;
  v: VersionRec;
}

async function load(tx: AnyTx, id: string): Promise<Loaded | null> {
  const p = await tx.objectStore('programs').get(id);
  if (!p) return null;
  const v = await tx.objectStore('versions').get(p.currentVersionId);
  if (!v) throw new Error(`Integrità: versione corrente mancante per la scheda ${id}`);
  return { p, v };
}

export async function loadForViewer(tx: AnyTx, viewer: Viewer, id: string): Promise<Loaded> {
  const l = await load(tx, id);
  if (!l) throw notFound();
  await assertCanView(tx, viewer, l.p.ownerId);
  return l;
}

function toSummary({ p, v }: Loaded, viewerId: string): ProgramSummaryDto {
  const days = v.content.days.length;
  return {
    id: p.id, ownerId: p.ownerId, name: p.name, startDate: p.startDate, endDate: p.endDate,
    nextDayIndex: days ? p.nextDayIndex % days : 0,
    currentVersionId: p.currentVersionId, versionNo: v.versionNo, content: v.content, hasDraft: p.draft !== null, createdBy: p.createdBy,
    unseenChange: viewerId === p.ownerId && v.versionNo > p.ownerSeenVersionNo ? { versionNo: v.versionNo, summary: v.changeSummary, publishedAt: v.publishedAt } : null,
    archived: p.archivedAt !== null,
  };
}

export async function listPrograms(tx: AnyTx, ownerId: string, viewerId: string, includeArchived = false): Promise<ProgramSummaryDto[]> {
  const ps = (await tx.objectStore('programs').index('ownerId').getAll(ownerId)).filter((p) => includeArchived || !p.archivedAt);
  ps.sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || a.createdAt.localeCompare(b.createdAt));
  const out: ProgramSummaryDto[] = [];
  for (const p of ps) {
    const v = await tx.objectStore('versions').get(p.currentVersionId);
    if (v) out.push(toSummary({ p, v }, viewerId));
  }
  return out;
}

export async function getProgramDetail(tx: AnyTx, viewer: Viewer, id: string): Promise<ProgramDetailDto> {
  const l = await loadForViewer(tx, viewer, id);
  const versions = (await tx.objectStore('versions').index('programId').getAll(id)).sort((a, b) => b.versionNo - a.versionNo);
  return {
    ...toSummary(l, viewer.id),
    draft: l.p.draft && l.p.draftUpdatedAt ? { ...l.p.draft, updatedAt: l.p.draftUpdatedAt } : null,
    versions: versions.map((v) => ({ id: v.id, versionNo: v.versionNo, summary: v.changeSummary, publishedAt: v.publishedAt })),
  };
}

export async function assertCanOwn(tx: AnyTx, viewer: Viewer, ownerId: string): Promise<void> {
  if (ownerId !== viewer.id) await assertCoachOf(tx, viewer, ownerId);
}

export async function createProgram(
  tx: Tx,
  args: { ownerId: string; createdBy: string; input: ProgramInput; sourceProgramId?: string | null; summary?: string; id?: string },
): Promise<string> {
  const content = normalizeContent(args.input.content);
  const now = nowIso();
  const id = args.id ?? uuid();
  const v: VersionRec = { id: uuid(), programId: id, versionNo: 1, content, contentHash: contentHash(content), changeSummary: args.summary ?? null, publishedBy: args.createdBy, publishedAt: now };
  const p: ProgramRec = {
    id, ownerId: args.ownerId, createdBy: args.createdBy, name: args.input.name, startDate: args.input.startDate, endDate: args.input.endDate,
    currentVersionId: v.id, draft: null, draftUpdatedAt: null, nextDayIndex: 0, ownerSeenVersionNo: 1,
    sourceProgramId: args.sourceProgramId ?? null, expiryReviewedAt: null, archivedAt: null, createdAt: now, updatedAt: now,
  };
  await tx.objectStore('programs').add(p);
  await tx.objectStore('versions').add(v);
  return id;
}

/** Pubblica una nuova versione immutabile. Le sedute già iniziate conservano la copia del giorno (nessun effetto retroattivo). */
export async function publishVersion(tx: Tx, viewer: Viewer, id: string, input: ProgramInput, summaryOverride: string | null): Promise<{ versionNo: number; changes: string[] }> {
  const { p, v } = await loadForViewer(tx, viewer, id);
  if (p.archivedAt) throw badRequest('Scheda archiviata');
  const content = normalizeContent(input.content);
  const changes = summarizeChanges(v.content, content);
  const metaChanged = p.name !== input.name || p.startDate !== input.startDate || p.endDate !== input.endDate;
  if (!changes.length && !metaChanged) throw badRequest('Nessuna modifica da pubblicare', 'no_changes');
  if (metaChanged) changes.push(`Nome/periodo: ${input.name}${input.startDate ? ` · ${input.startDate} → ${input.endDate ?? '…'}` : ''}`);
  const summary = (summaryOverride?.trim() || changes.slice(0, 12).join('\n')).slice(0, 2000);
  const now = nowIso();
  const nv: VersionRec = { id: uuid(), programId: id, versionNo: v.versionNo + 1, content, contentHash: contentHash(content), changeSummary: summary, publishedBy: viewer.id, publishedAt: now };
  await tx.objectStore('versions').add(nv); // indice univoco (programId, versionNo): due pubblicazioni concorrenti non possono collidere
  const days = content.days.length;
  await tx.objectStore('programs').put({
    ...p, currentVersionId: nv.id, name: input.name, startDate: input.startDate, endDate: input.endDate, draft: null, draftUpdatedAt: null,
    nextDayIndex: days > 0 ? p.nextDayIndex % days : 0,
    ownerSeenVersionNo: p.ownerId === viewer.id ? nv.versionNo : p.ownerSeenVersionNo,
    expiryReviewedAt: p.endDate !== input.endDate ? null : p.expiryReviewedAt,
    updatedAt: now,
  });
  return { versionNo: nv.versionNo, changes };
}

export async function saveDraft(tx: Tx, viewer: Viewer, id: string, input: ProgramInput): Promise<void> {
  const { p } = await loadForViewer(tx, viewer, id);
  if (p.archivedAt) throw badRequest('Scheda archiviata');
  const now = nowIso();
  await tx.objectStore('programs').put({ ...p, draft: input, draftUpdatedAt: now, updatedAt: now });
}

export async function discardDraft(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const { p } = await loadForViewer(tx, viewer, id);
  await tx.objectStore('programs').put({ ...p, draft: null, draftUpdatedAt: null });
}

export const duplicateSchema = z
  .object({ ownerId: z.string().min(1).optional(), name: z.string().trim().min(1).max(80).optional(), startDate: isoDateSchema.nullable().optional(), endDate: isoDateSchema.nullable().optional() })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: 'La data finale deve essere uguale o successiva a quella iniziale', path: ['endDate'] });

export async function duplicateProgram(tx: Tx, viewer: Viewer, srcId: string, body: z.infer<typeof duplicateSchema>): Promise<string> {
  const { p: src, v } = await loadForViewer(tx, viewer, srcId);
  const ownerId = body.ownerId ?? viewer.id;
  await assertCanOwn(tx, viewer, ownerId);
  return createProgram(tx, {
    ownerId, createdBy: viewer.id, sourceProgramId: src.id,
    summary: ownerId === viewer.id ? `Copia di ${src.name}` : `Assegnata da ${viewer.displayName}`,
    input: {
      name: body.name ?? (ownerId === src.ownerId ? `${src.name} (copia)` : src.name).slice(0, 80),
      startDate: body.startDate !== undefined ? body.startDate : src.startDate,
      endDate: body.endDate !== undefined ? body.endDate : src.endDate,
      content: v.content,
    },
  });
}

export async function setArchived(tx: Tx, viewer: Viewer, id: string, archived: boolean): Promise<void> {
  const { p } = await loadForViewer(tx, viewer, id);
  await tx.objectStore('programs').put({ ...p, archivedAt: archived ? nowIso() : null, updatedAt: nowIso() });
}

export async function markSeen(tx: Tx, viewer: Viewer, id: string): Promise<void> {
  const { p, v } = await loadForViewer(tx, viewer, id);
  if (p.ownerId !== viewer.id) throw notFound();
  await tx.objectStore('programs').put({ ...p, ownerSeenVersionNo: v.versionNo });
}

export async function setRotation(tx: Tx, viewer: Viewer, id: string, nextDayIndex: number): Promise<void> {
  const { p, v } = await loadForViewer(tx, viewer, id);
  if (nextDayIndex >= v.content.days.length) throw badRequest('Giorno inesistente');
  await tx.objectStore('programs').put({ ...p, nextDayIndex });
}

export async function getVersion(tx: AnyTx, viewer: Viewer, versionId: string): Promise<{ id: string; programId: string; versionNo: number; content: ProgramContent }> {
  const v = await tx.objectStore('versions').get(versionId);
  if (!v) throw notFound();
  const p = await tx.objectStore('programs').get(v.programId);
  if (!p) throw notFound();
  await assertCanView(tx, viewer, p.ownerId);
  return { id: v.id, programId: v.programId, versionNo: v.versionNo, content: v.content };
}
