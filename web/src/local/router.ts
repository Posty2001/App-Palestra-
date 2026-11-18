import { z, ZodError } from 'zod';
import { exerciseKey, isoDateSchema, POSES, type Pose } from '@palestra/shared';
import { ApiError, badRequest, notFound } from '../lib/errors';
import { readTx, sha256Hex, uuid, writeTx, type Tx } from './db';
import { processPhoto } from './photo';
import { assertCanView, getProfile, viewerOf, type AnyTx, type Viewer } from './services/access';
import * as A from './services/athlete';
import * as C from './services/checks';
import * as K from './services/coach';
import * as P from './services/programs';
import * as W from './services/workouts';

/**
 * Router locale: riproduce i percorsi e i DTO dell'API 2.0 sopra IndexedDB, così le schermate restano invariate.
 * Ogni richiesta che scrive è UNA transazione: o si applica tutta, o nulla.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Req {
  params: string[];
  query: URLSearchParams;
  body: unknown;
}
type ReadHandler = (tx: AnyTx, v: Viewer, r: Req) => Promise<unknown>;
type WriteHandler = (tx: Tx, v: Viewer, r: Req) => Promise<unknown>;
/** Lavoro asincrono non-IndexedDB (elaborazione foto, hash) da completare PRIMA di aprire la transazione. */
type Prepare = (r: Req) => Promise<unknown>;

interface Route {
  method: Method;
  re: RegExp;
  read?: ReadHandler;
  write?: WriteHandler;
  prepare?: Prepare;
}

const routes: Route[] = [];
const seg = '([^/]+)';
function route(method: Method, pattern: string, h: { read?: ReadHandler; write?: WriteHandler; prepare?: Prepare }): void {
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:\w+/g, seg)}$`), ...h });
}

const today = (r: Req): string => {
  const t = r.query.get('today');
  return t ? isoDateSchema.parse(t) : localToday();
};
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function subject(tx: AnyTx, v: Viewer, r: Req): Promise<string> {
  const id = r.query.get('userId') ?? v.id;
  await assertCanView(tx, v, id);
  return id;
}
const p0 = (r: Req): string => r.params[0]!;
const p1 = (r: Req): string => r.params[1]!;
const poseOf = (s: string): Pose => z.enum(POSES as unknown as [Pose, ...Pose[]]).parse(s);
const idSchema = z.string().min(1).max(64);

// ---------- profilo / pacchetto Oggi ----------
route('GET', '/auth/me', { read: (tx, v) => A.userDto(tx, v) });
route('GET', '/bundle', { read: (tx, v, r) => A.bundle(tx, v, today(r)) });

// ---------- schede ----------
route('GET', '/programs', { read: async (tx, v, r) => P.listPrograms(tx, await subject(tx, v, r), v.id, r.query.get('archived') === '1') });
route('POST', '/programs', {
  write: async (tx, v, r) => {
    const b = z.intersection(P.programInputSchema, z.object({ ownerId: z.string().min(1).optional() })).parse(r.body);
    const ownerId = b.ownerId ?? v.id;
    await P.assertCanOwn(tx, v, ownerId);
    return P.getProgramDetail(tx, v, await P.createProgram(tx, { ownerId, createdBy: v.id, input: b }));
  },
});
route('GET', '/programs/:id', { read: (tx, v, r) => P.getProgramDetail(tx, v, p0(r)) });
route('PUT', '/programs/:id/draft', { write: async (tx, v, r) => (await P.saveDraft(tx, v, p0(r), P.programInputSchema.parse(r.body)), P.getProgramDetail(tx, v, p0(r))) });
route('DELETE', '/programs/:id/draft', { write: async (tx, v, r) => (await P.discardDraft(tx, v, p0(r)), P.getProgramDetail(tx, v, p0(r))) });
route('POST', '/programs/:id/publish', {
  write: async (tx, v, r) => {
    const b = z.intersection(P.programInputSchema, z.object({ summary: z.string().max(2000).nullable().optional() })).parse(r.body);
    const res = await P.publishVersion(tx, v, p0(r), b, b.summary ?? null);
    return { ...res, program: await P.getProgramDetail(tx, v, p0(r)) };
  },
});
route('POST', '/programs/:id/duplicate', { write: async (tx, v, r) => P.getProgramDetail(tx, v, await P.duplicateProgram(tx, v, p0(r), P.duplicateSchema.parse(r.body ?? {}))) });
route('POST', '/programs/:id/archive', { write: async (tx, v, r) => (await P.setArchived(tx, v, p0(r), z.object({ archived: z.boolean() }).parse(r.body).archived), { ok: true }) });
route('POST', '/programs/:id/seen', { write: async (tx, v, r) => (await P.markSeen(tx, v, p0(r)), { ok: true }) });
route('POST', '/programs/:id/rotation', {
  write: async (tx, v, r) => (await P.setRotation(tx, v, p0(r), z.object({ nextDayIndex: z.number().int().min(0).max(20) }).parse(r.body).nextDayIndex), { ok: true }),
});
route('GET', '/program-versions/:id', { read: (tx, v, r) => P.getVersion(tx, v, p0(r)) });

// ---------- sedute ----------
route('GET', '/workouts', {
  read: async (tx, v, r) => {
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(r.query.get('limit') ?? undefined);
    const before = r.query.get('before');
    return W.listWorkouts(tx, await subject(tx, v, r), limit, before ? z.string().datetime().parse(before) : null);
  },
});
route('GET', '/workouts/active', { read: async (tx, v) => { const w = await W.activeWorkout(tx, v.id); return w ? W.toWorkoutDto(tx, w) : null; } });
route('GET', '/workouts/:id', {
  read: async (tx, v, r) => {
    const w = await tx.objectStore('workouts').get(p0(r));
    if (!w) throw notFound();
    await assertCanView(tx, v, w.athleteId);
    return W.toWorkoutDto(tx, w);
  },
});
route('PUT', '/workouts/:id', {
  write: async (tx, v, r) => {
    await W.startWorkout(tx, v, idSchema.parse(p0(r)), W.startSchema.parse(r.body));
    return W.toWorkoutDto(tx, (await tx.objectStore('workouts').get(p0(r)))!);
  },
});
route('PUT', '/workouts/:id/sets/:setId', { write: async (tx, v, r) => (await W.putSet(tx, v, p0(r), idSchema.parse(p1(r)), r.body as never), { ok: true, id: p1(r) }) });
route('DELETE', '/workouts/:id/sets/:setId', { write: async (tx, v, r) => (await W.deleteSet(tx, v, p0(r), p1(r)), { ok: true }) });
route('PATCH', '/workouts/:id/exercise-state', {
  write: async (tx, v, r) => {
    const b = W.exerciseStateSchema.parse(r.body);
    await W.setExerciseState(tx, v, p0(r), b.slot, b.state);
    return { ok: true };
  },
});
route('POST', '/workouts/:id/finish', {
  write: async (tx, v, r) => {
    await W.finishWorkout(tx, v, p0(r), W.finishSchema.parse(r.body));
    return W.toWorkoutDto(tx, (await tx.objectStore('workouts').get(p0(r)))!);
  },
});
route('POST', '/workouts/:id/discard', { write: async (tx, v, r) => (await W.discardWorkout(tx, v, p0(r)), { ok: true }) });

// ---------- esercizi, domande, progressi ----------
route('GET', '/exercises/:key/context', {
  read: async (tx, v, r) => {
    const key = exerciseKey(A.keySchema.parse(p0(r)));
    return (await W.exerciseContexts(tx, await subject(tx, v, r), [key]))[key];
  },
});
route('PUT', '/exercise-notes/:key', { write: async (tx, v, r) => (await A.putExerciseNote(tx, v, p0(r), z.object({ machineSetup: z.string() }).parse(r.body).machineSetup), { ok: true }) });
route('PUT', '/questions/:id', { write: (tx, v, r) => A.putQuestion(tx, v, idSchema.parse(p0(r)), A.questionSchema.parse(r.body)) });
route('GET', '/questions', { read: async (tx, v, r) => W.questionsOf(tx, await subject(tx, v, r)) });
route('POST', '/questions/:id/answer', { write: (tx, v, r) => K.answerQuestion(tx, v, p0(r), z.object({ answer: z.string().trim().min(1, 'Scrivi la risposta').max(2000) }).parse(r.body).answer) });
route('GET', '/progress/exercises', { read: async (tx, v, r) => A.progressExercises(tx, await subject(tx, v, r)) });
route('GET', '/progress/exercises/:key', { read: async (tx, v, r) => A.progressExercise(tx, await subject(tx, v, r), p0(r)) });

// ---------- check, foto, peso ----------
route('GET', '/checks', { read: async (tx, v, r) => C.listChecks(tx, v, await subject(tx, v, r)) });
route('GET', '/checks/:id', { read: (tx, v, r) => C.getCheck(tx, v, p0(r)) });
route('PUT', '/checks/:id', { write: (tx, v, r) => C.putCheck(tx, v, idSchema.parse(p0(r)), C.checkSchema.parse(r.body)) });
route('PATCH', '/checks/:id/sharing', { write: (tx, v, r) => C.setSharing(tx, v, p0(r), z.object({ sharePhotos: z.boolean() }).parse(r.body).sharePhotos) });
route('DELETE', '/checks/:id', { write: async (tx, v, r) => (await C.deleteCheck(tx, v, p0(r)), { ok: true }) });
route('PUT', '/checks/:id/photos/:pose', {
  prepare: async (r) => {
    poseOf(r.params[1]!);
    const file = r.body instanceof FormData ? r.body.get('file') : r.body;
    if (!(file instanceof Blob)) throw badRequest('Nessuna foto ricevuta');
    const img = await processPhoto(file);
    return { ...img, id: uuid(), sha256: await sha256Hex(await img.blob.arrayBuffer()) } satisfies C.ProcessedPhoto;
  },
  write: (tx, v, r) => C.putPhoto(tx, v, p0(r), poseOf(p1(r)), (r as Req & { prepared: C.ProcessedPhoto }).prepared),
});
route('DELETE', '/checks/:id/photos/:pose', { write: (tx, v, r) => C.deletePhoto(tx, v, p0(r), poseOf(p1(r))) });
route('GET', '/photos/:id', { read: (tx, v, r) => C.photoBlob(tx, v, p0(r)) });
route('POST', '/checks/:id/feedback', { write: (tx, v, r) => C.addCheckFeedback(tx, v, p0(r), z.object({ body: z.string().trim().min(1, 'Scrivi un commento').max(2000) }).parse(r.body).body, uuid()) });
route('GET', '/weights', { read: async (tx, v, r) => A.weights(tx, await subject(tx, v, r)) });
route('PUT', '/weights/:id', { write: async (tx, v, r) => (await A.putWeight(tx, v, idSchema.parse(p0(r)), A.weightSchema.parse(r.body)), { ok: true }) });
route('DELETE', '/weights/:id', { write: async (tx, v, r) => (await A.deleteWeight(tx, v, p0(r)), { ok: true }) });

// ---------- coach ----------
route('GET', '/coach/athletes', { read: (tx, v) => K.listAthletes(tx, v) });
route('POST', '/coach/athletes', { write: async (tx, v, r) => K.getAthlete(tx, v, await K.addAthlete(tx, v, K.newAthleteSchema.parse(r.body).displayName)) });
route('GET', '/coach/athletes/:id', { read: (tx, v, r) => K.getAthlete(tx, v, p0(r)) });
route('PATCH', '/coach/athletes/:id', { write: (tx, v, r) => K.patchAthlete(tx, v, p0(r), K.patchAthleteSchema.parse(r.body)) });
route('DELETE', '/coach/athletes/:id', { write: async (tx, v, r) => (await K.endAthlete(tx, v, p0(r)), { ok: true }) });
route('POST', '/coach/athletes/:id/exercise-feedback', { write: async (tx, v, r) => ({ id: await K.addExerciseFeedback(tx, v, p0(r), K.feedbackSchema.parse(r.body)) }) });
route('GET', '/coach/review', { read: (tx, v, r) => K.reviewQueue(tx, v, today(r)) });
route('POST', '/coach/review/:type/:id', { write: async (tx, v, r) => (await K.markReviewed(tx, v, K.reviewTypeSchema.parse(p0(r)), p1(r)), { ok: true }) });

function toApiError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return new ApiError(400, 'validation', err.issues[0]?.message ?? 'Dati non validi');
  const name = (err as { name?: string } | null)?.name;
  if (name === 'ConstraintError') return new ApiError(409, 'conflict', 'Elemento già presente');
  if (name === 'QuotaExceededError') return new ApiError(507, 'quota', 'Spazio di archiviazione del dispositivo esaurito: esegui un backup ed elimina foto non necessarie.');
  return err;
}

export async function handle(method: Method, rawPath: string, body: unknown): Promise<unknown> {
  const [path = '', qs = ''] = rawPath.split('?');
  const r0 = routes.find((r) => r.method === method && r.re.test(path));
  if (!r0) throw notFound();
  const params = (r0.re.exec(path) ?? []).slice(1).map((s) => decodeURIComponent(s));
  const req: Req & { prepared?: unknown } = { params, query: new URLSearchParams(qs), body };
  try {
    if (r0.prepare) req.prepared = await r0.prepare(req);
    const run = async (tx: AnyTx, h: (tx: never, v: Viewer, r: Req) => Promise<unknown>) => {
      const profile = await getProfile(tx);
      if (!profile) throw new ApiError(401, 'no_profile', 'Profilo non configurato');
      return h(tx as never, viewerOf(profile), req);
    };
    if (r0.write) return await writeTx((tx) => run(tx, r0.write!));
    return await readTx((tx) => run(tx, r0.read!));
  } catch (err) {
    throw toApiError(err);
  }
}
