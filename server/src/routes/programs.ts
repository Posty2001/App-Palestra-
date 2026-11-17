import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDateSchema, type ProgramContent } from '@palestra/shared';
import { requireViewer } from '../app.js';
import { withTx } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertCanView, assertCoachOf, type Viewer } from '../services/access.js';
import { importProgramPdf } from '../services/pdfImport.js';
import {
  createProgram, getProgramDetail, listPrograms, loadProgramForViewer, programInputSchema, publishVersion,
} from '../services/programs.js';
import type { Queryable } from '../db.js';

const uuid = z.string().uuid();

/** Il proprietario di una nuova scheda può essere il richiedente o un atleta collegato al coach richiedente. */
async function assertCanOwn(db: Queryable, viewer: Viewer, ownerId: string): Promise<void> {
  if (ownerId === viewer.id) return;
  await assertCoachOf(db, viewer, ownerId);
}

export async function programRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get<{ Querystring: { userId?: string; archived?: string } }>('/programs', async (req) => {
    const viewer = requireViewer(req);
    const ownerId = req.query.userId ? uuid.parse(req.query.userId) : viewer.id;
    await assertCanView(db, viewer, ownerId);
    return listPrograms(db, ownerId, viewer.id, req.query.archived === '1');
  });

  app.post('/programs', async (req, reply) => {
    const viewer = requireViewer(req);
    const body = z.intersection(programInputSchema, z.object({ ownerId: uuid.optional() })).parse(req.body);
    const ownerId = body.ownerId ?? viewer.id;
    await assertCanOwn(db, viewer, ownerId);
    const id = await withTx(db, (tx) => createProgram(tx, { ownerId, createdBy: viewer.id, input: body }));
    return reply.status(201).send(await getProgramDetail(db, viewer, id));
  });

  app.get<{ Params: { id: string } }>('/programs/:id', async (req) => getProgramDetail(db, requireViewer(req), req.params.id));

  app.put<{ Params: { id: string } }>('/programs/:id/draft', async (req) => {
    const viewer = requireViewer(req);
    const input = programInputSchema.parse(req.body);
    const row = await loadProgramForViewer(db, viewer, req.params.id);
    if (row.archived_at) throw badRequest('Scheda archiviata');
    await db.query('update programs set draft = $2, draft_updated_at = now(), updated_at = now() where id = $1', [row.id, JSON.stringify(input)]);
    return getProgramDetail(db, viewer, row.id);
  });

  app.delete<{ Params: { id: string } }>('/programs/:id/draft', async (req) => {
    const viewer = requireViewer(req);
    const row = await loadProgramForViewer(db, viewer, req.params.id);
    await db.query('update programs set draft = null, draft_updated_at = null where id = $1', [row.id]);
    return getProgramDetail(db, viewer, row.id);
  });

  app.post<{ Params: { id: string } }>('/programs/:id/publish', async (req) => {
    const viewer = requireViewer(req);
    const body = z.intersection(programInputSchema, z.object({ summary: z.string().max(2000).nullable().optional() })).parse(req.body);
    const result = await withTx(db, (tx) => publishVersion(tx, viewer, req.params.id, body, body.summary ?? null));
    return { ...result, program: await getProgramDetail(db, viewer, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/programs/:id/duplicate', async (req, reply) => {
    const viewer = requireViewer(req);
    const body = z
      .object({ ownerId: uuid.optional(), name: z.string().trim().min(1).max(80).optional(), startDate: isoDateSchema.nullable().optional(), endDate: isoDateSchema.nullable().optional() })
      .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: 'La data finale deve essere uguale o successiva a quella iniziale', path: ['endDate'] })
      .parse(req.body ?? {});
    const src = await loadProgramForViewer(db, viewer, req.params.id);
    const ownerId = body.ownerId ?? viewer.id;
    await assertCanOwn(db, viewer, ownerId);
    const id = await withTx(db, (tx) =>
      createProgram(tx, {
        ownerId,
        createdBy: viewer.id,
        sourceProgramId: src.id,
        summary: ownerId === viewer.id ? `Copia di ${src.name}` : `Assegnata da ${viewer.displayName}`,
        input: {
          name: body.name ?? (ownerId === src.owner_id ? `${src.name} (copia)` : src.name).slice(0, 80),
          startDate: body.startDate !== undefined ? body.startDate : src.start_date,
          endDate: body.endDate !== undefined ? body.endDate : src.end_date,
          content: src.content,
        },
      }),
    );
    return reply.status(201).send(await getProgramDetail(db, viewer, id));
  });

  app.post<{ Params: { id: string } }>('/programs/:id/archive', async (req) => {
    const viewer = requireViewer(req);
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    const row = await loadProgramForViewer(db, viewer, req.params.id);
    await db.query('update programs set archived_at = case when $2 then now() else null end, updated_at = now() where id = $1', [row.id, archived]);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/programs/:id/seen', async (req) => {
    const viewer = requireViewer(req);
    const row = await loadProgramForViewer(db, viewer, req.params.id);
    if (row.owner_id !== viewer.id) throw notFound();
    await db.query('update programs set owner_seen_version_no = $2 where id = $1', [row.id, row.version_no]);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/programs/:id/rotation', async (req) => {
    const viewer = requireViewer(req);
    const { nextDayIndex } = z.object({ nextDayIndex: z.number().int().min(0).max(20) }).parse(req.body);
    const row = await loadProgramForViewer(db, viewer, req.params.id);
    if (nextDayIndex >= row.content.days.length) throw badRequest('Giorno inesistente');
    await db.query('update programs set next_day_index = $2 where id = $1', [row.id, nextDayIndex]);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/program-versions/:id', async (req) => {
    const viewer = requireViewer(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound();
    const r = await db.query<{ id: string; version_no: number; content: ProgramContent; owner_id: string; program_id: string }>(
      'select v.id, v.version_no, v.content, p.owner_id, p.id as program_id from program_versions v join programs p on p.id = v.program_id where v.id = $1',
      [id.data],
    );
    const row = r.rows[0];
    if (!row) throw notFound();
    await assertCanView(db, viewer, row.owner_id);
    return { id: row.id, programId: row.program_id, versionNo: row.version_no, content: row.content };
  });

  app.post('/import/pdf', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    requireViewer(req);
    const file = await req.file();
    if (!file) throw badRequest('Nessun file ricevuto');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('File troppo grande (max 12 MB)');
    return importProgramPdf(new Uint8Array(buf), file.filename);
  });
}
