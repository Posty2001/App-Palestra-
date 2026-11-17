import { z } from 'zod';
import {
  isoDateSchema, programContentSchema, summarizeChanges,
  type ProgramContent, type ProgramDetailDto, type ProgramSummaryDto,
} from '@palestra/shared';
import type { Queryable } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertCanView, type Viewer } from './access.js';

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
    while (seen.has(out)) out = crypto.randomUUID();
    seen.add(out);
    return out;
  };
  return {
    days: content.days.map((d) => ({
      ...d,
      id: uniq(d.id),
      exercises: d.exercises.map((e) => ({ ...e, id: uniq(e.id) })),
    })),
  };
}

interface ProgramRow {
  id: string;
  owner_id: string;
  created_by: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  next_day_index: number;
  current_version_id: string;
  version_no: number;
  content: ProgramContent;
  change_summary: string | null;
  published_at: Date;
  owner_seen_version_no: number;
  draft: { name: string; startDate: string | null; endDate: string | null; content: ProgramContent } | null;
  draft_updated_at: Date | null;
  archived_at: Date | null;
}

const SELECT = `
  select p.id, p.owner_id, p.created_by, p.name, p.start_date, p.end_date, p.next_day_index, p.current_version_id,
         v.version_no, v.content, v.change_summary, v.published_at, p.owner_seen_version_no, p.draft, p.draft_updated_at, p.archived_at
    from programs p join program_versions v on v.id = p.current_version_id`;

function toSummary(r: ProgramRow, viewerId: string): ProgramSummaryDto {
  const days = r.content.days.length;
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    nextDayIndex: days ? r.next_day_index % days : 0,
    currentVersionId: r.current_version_id,
    versionNo: r.version_no,
    content: r.content,
    hasDraft: r.draft !== null,
    createdBy: r.created_by,
    unseenChange:
      viewerId === r.owner_id && r.version_no > r.owner_seen_version_no
        ? { versionNo: r.version_no, summary: r.change_summary, publishedAt: r.published_at.toISOString() }
        : null,
    archived: r.archived_at !== null,
  };
}

export async function listPrograms(db: Queryable, ownerId: string, viewerId: string, includeArchived = false): Promise<ProgramSummaryDto[]> {
  const r = await db.query<ProgramRow>(
    `${SELECT} where p.owner_id = $1 ${includeArchived ? '' : 'and p.archived_at is null'} order by p.archived_at nulls first, p.created_at`,
    [ownerId],
  );
  return r.rows.map((row) => toSummary(row, viewerId));
}

/** Carica la scheda verificando che il richiedente possa vederla (proprietario o coach collegato). */
export async function loadProgramForViewer(db: Queryable, viewer: Viewer, programId: string, lock = false): Promise<ProgramRow> {
  if (!z.string().uuid().safeParse(programId).success) throw notFound();
  const r = await db.query<ProgramRow>(`${SELECT} where p.id = $1 ${lock ? 'for update of p' : ''}`, [programId]);
  const row = r.rows[0];
  if (!row) throw notFound();
  await assertCanView(db, viewer, row.owner_id);
  return row;
}

export async function getProgramDetail(db: Queryable, viewer: Viewer, programId: string): Promise<ProgramDetailDto> {
  const row = await loadProgramForViewer(db, viewer, programId);
  const versions = await db.query<{ id: string; version_no: number; change_summary: string | null; published_at: Date }>(
    'select id, version_no, change_summary, published_at from program_versions where program_id = $1 order by version_no desc',
    [programId],
  );
  return {
    ...toSummary(row, viewer.id),
    draft: row.draft && row.draft_updated_at ? { ...row.draft, updatedAt: row.draft_updated_at.toISOString() } : null,
    versions: versions.rows.map((v) => ({ id: v.id, versionNo: v.version_no, summary: v.change_summary, publishedAt: v.published_at.toISOString() })),
  };
}

export async function createProgram(
  tx: Queryable,
  args: { ownerId: string; createdBy: string; input: ProgramInput; sourceProgramId?: string | null; summary?: string },
): Promise<string> {
  const content = normalizeContent(args.input.content);
  const p = await tx.query<{ id: string }>(
    `insert into programs(owner_id, created_by, name, start_date, end_date, source_program_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [args.ownerId, args.createdBy, args.input.name, args.input.startDate, args.input.endDate, args.sourceProgramId ?? null],
  );
  const programId = p.rows[0]!.id;
  const v = await tx.query<{ id: string }>(
    `insert into program_versions(program_id, version_no, content, change_summary, published_by) values ($1, 1, $2, $3, $4) returning id`,
    [programId, JSON.stringify(content), args.summary ?? null, args.createdBy],
  );
  await tx.query('update programs set current_version_id = $2 where id = $1', [programId, v.rows[0]!.id]);
  return programId;
}

/** Pubblica una nuova versione. Le sedute già iniziate mantengono il proprio snapshot del giorno. */
export async function publishVersion(
  tx: Queryable,
  viewer: Viewer,
  programId: string,
  input: ProgramInput,
  summaryOverride: string | null,
): Promise<{ versionNo: number; changes: string[] }> {
  const row = await loadProgramForViewer(tx, viewer, programId, true);
  if (row.archived_at) throw badRequest('Scheda archiviata');
  const content = normalizeContent(input.content);
  const changes = summarizeChanges(row.content, content);
  const metaChanged = row.name !== input.name || row.start_date !== input.startDate || row.end_date !== input.endDate;
  if (!changes.length && !metaChanged) throw badRequest('Nessuna modifica da pubblicare', 'no_changes');
  if (metaChanged) changes.push(`Nome/periodo: ${input.name}${input.startDate ? ` · ${input.startDate} → ${input.endDate ?? '…'}` : ''}`);
  const summary = (summaryOverride?.trim() || changes.slice(0, 12).join('\n')).slice(0, 2000);
  const versionNo = row.version_no + 1;
  const v = await tx.query<{ id: string }>(
    `insert into program_versions(program_id, version_no, content, change_summary, published_by) values ($1, $2, $3, $4, $5) returning id`,
    [programId, versionNo, JSON.stringify(content), summary, viewer.id],
  );
  await tx.query(
    `update programs set current_version_id = $2, name = $3, start_date = $4, end_date = $5, draft = null, draft_updated_at = null,
            next_day_index = case when $6::int > 0 then next_day_index % $6::int else 0 end,
            owner_seen_version_no = case when owner_id = $7 then $8 else owner_seen_version_no end,
            expiry_reviewed_at = case when end_date is distinct from $5 then null else expiry_reviewed_at end,
            updated_at = now()
      where id = $1`,
    [programId, v.rows[0]!.id, input.name, input.startDate, input.endDate, content.days.length, viewer.id, versionNo],
  );
  return { versionNo, changes };
}
