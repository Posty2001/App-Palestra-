import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { DaySpec, ExerciseState, Pose, ProgramContent, SetKind, WorkoutStatus } from '@palestra/shared';

/**
 * APP PALESTRA 3.0 — archivio locale (IndexedDB).
 * Ogni operazione che tocca più store avviene in UNA transazione readwrite: o tutto o niente.
 * I record seguono i DTO di @palestra/shared (stessi nomi dei campi della 2.0).
 */

export const DB_NAME = 'palestra-v3';
export const SCHEMA_VERSION = 1;

/**
 * Chiavi dell'installazione. Le private sono CryptoKey NON estraibili salvate così come sono in IndexedDB:
 * nessun codice (nemmeno l'app) può leggerne i byte, quindi non finiscono mai in pacchetti o backup.
 * Le pubbliche sono JWK, condivise durante il collegamento coach ↔ atleta.
 */
export interface KeyMaterial {
  signPrivate: CryptoKey;
  signPublic: JsonWebKey;
  encPrivate: CryptoKey;
  encPublic: JsonWebKey;
  /** sha256 esadecimale delle due chiavi pubbliche in forma canonica. */
  keyId: string;
}

/** Profilo dell'installazione: nessun account, solo un'identità locale e le sue chiavi. */
export interface ProfileRec {
  id: string;
  displayName: string;
  role: 'athlete' | 'coach';
  createdAt: string;
  keys: KeyMaterial;
}

/** Persone conosciute da questo dispositivo: atleti (lato coach) o il proprio coach (lato atleta). */
export interface PersonRec {
  id: string; // id locale (lato coach: id dell'atleta usato nei record locali)
  role: 'athlete' | 'coach';
  displayName: string;
  remoteId: string | null; // id del profilo sull'altro dispositivo (noto dopo il collegamento)
  signPublic: JsonWebKey | null;
  encPublic: JsonWebKey | null;
  keyId: string | null; // impronta completa della chiave confermata
  keyConfirmedAt: string | null;
  pendingKey: { signPublic: JsonWebKey; encPublic: JsonWebKey; keyId: string; seenAt: string } | null;
  checkWeekday: number | null;
  keyExercises: string[];
  createdAt: string;
  lastReceivedAt: string | null;
  lastSentAt: string | null;
  /** Collegamento terminato («Rimuovi atleta»): i dati restano nel backup ma non sono più accessibili dall'app. */
  endedAt: string | null;
}

export interface ProgramRec {
  id: string;
  ownerId: string;
  createdBy: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  currentVersionId: string;
  draft: { name: string; startDate: string | null; endDate: string | null; content: ProgramContent } | null;
  draftUpdatedAt: string | null;
  nextDayIndex: number;
  ownerSeenVersionNo: number;
  sourceProgramId: string | null;
  expiryReviewedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionRec {
  id: string;
  programId: string;
  versionNo: number;
  content: ProgramContent;
  contentHash: string;
  changeSummary: string | null;
  publishedBy: string | null;
  publishedAt: string;
}

export interface WorkoutRec {
  id: string;
  athleteId: string;
  programId: string | null;
  programVersionId: string | null;
  versionNo: number | null;
  programName: string | null;
  dayIndex: number;
  day: DaySpec;
  status: WorkoutStatus;
  startedAt: string;
  endedAt: string | null;
  athleteNote: string | null;
  exerciseStates: Record<string, ExerciseState>;
  coachReviewedAt: string | null;
  updatedAt: string;
}

export interface SetRec {
  id: string;
  workoutId: string;
  athleteId: string;
  exerciseSlot: string;
  exerciseKey: string;
  exerciseName: string;
  kind: SetKind;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  completedAt: string;
  updatedAt: string;
}

export interface CheckRec {
  id: string;
  athleteId: string;
  checkDate: string;
  weightKg: number | null;
  bicepsCm: number | null;
  chestCm: number | null;
  thighCm: number | null;
  waistCm: number | null;
  note: string | null;
  /** 3.0: «includi le foto nel prossimo invio al coach». Sempre false per impostazione predefinita. */
  sharePhotos: boolean;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoRec {
  id: string;
  checkId: string;
  athleteId: string;
  pose: Pose;
  mime: 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  blob: Blob;
  createdAt: string;
}

export interface WeightRec { id: string; athleteId: string; measuredOn: string; weightKg: number; createdAt: string }
export interface NoteRec { athleteId: string; exerciseKey: string; machineSetup: string | null; updatedAt: string }

export interface FeedbackRec {
  id: string;
  athleteId: string;
  coachId: string;
  coachName: string;
  kind: 'exercise' | 'check';
  exerciseKey: string | null;
  exerciseName: string | null;
  checkId: string | null;
  body: string;
  createdAt: string;
}

export interface QuestionRec {
  id: string;
  athleteId: string;
  exerciseKey: string;
  exerciseName: string;
  body: string;
  context: { lastDate: string | null; sets: { weightKg: number | null; reps: number | null }[] } | null;
  answer: string | null;
  answeredAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface PackageLogRec {
  packId: string;
  type: string;
  direction: 'in' | 'out';
  peerId: string | null;
  sha256: string;
  at: string;
  summary: string;
}

export interface PalestraDB extends DBSchema {
  meta: { key: string; value: unknown };
  people: { key: string; value: PersonRec; indexes: { role: string; remoteId: string } };
  programs: { key: string; value: ProgramRec; indexes: { ownerId: string } };
  versions: { key: string; value: VersionRec; indexes: { programId: string; programVersion: [string, number] } };
  workouts: { key: string; value: WorkoutRec; indexes: { athleteId: string; status: string } };
  sets: { key: string; value: SetRec; indexes: { workoutId: string; athleteExercise: [string, string] } };
  checks: { key: string; value: CheckRec; indexes: { athleteId: string } };
  photos: { key: string; value: PhotoRec; indexes: { checkId: string } };
  weights: { key: string; value: WeightRec; indexes: { athleteId: string } };
  notes: { key: [string, string]; value: NoteRec };
  feedback: { key: string; value: FeedbackRec; indexes: { athleteId: string; checkId: string } };
  questions: { key: string; value: QuestionRec; indexes: { athleteId: string } };
  packages: { key: string; value: PackageLogRec };
}

export type Store = StoreNames<PalestraDB>;
export type Tx<M extends IDBTransactionMode = 'readwrite'> = IDBPTransaction<PalestraDB, Store[], M>;
export type DB = IDBPDatabase<PalestraDB>;

export const ALL_STORES: Store[] = ['meta', 'people', 'programs', 'versions', 'workouts', 'sets', 'checks', 'photos', 'weights', 'notes', 'feedback', 'questions', 'packages'];

let dbp: Promise<DB> | null = null;

export function openPalestraDB(name = DB_NAME): Promise<DB> {
  return openDB<PalestraDB>(name, SCHEMA_VERSION, {
    upgrade(db, oldVersion) {
      // Migrazioni incrementali: ogni versione aggiunge solo ciò che manca, mai cancellazioni di dati.
      if (oldVersion < 1) {
        db.createObjectStore('meta');
        const p = db.createObjectStore('people', { keyPath: 'id' });
        p.createIndex('role', 'role');
        p.createIndex('remoteId', 'remoteId');
        db.createObjectStore('programs', { keyPath: 'id' }).createIndex('ownerId', 'ownerId');
        const v = db.createObjectStore('versions', { keyPath: 'id' });
        v.createIndex('programId', 'programId');
        v.createIndex('programVersion', ['programId', 'versionNo'], { unique: true });
        const w = db.createObjectStore('workouts', { keyPath: 'id' });
        w.createIndex('athleteId', 'athleteId');
        w.createIndex('status', 'status');
        const s = db.createObjectStore('sets', { keyPath: 'id' });
        s.createIndex('workoutId', 'workoutId');
        s.createIndex('athleteExercise', ['athleteId', 'exerciseKey']);
        db.createObjectStore('checks', { keyPath: 'id' }).createIndex('athleteId', 'athleteId');
        db.createObjectStore('photos', { keyPath: 'id' }).createIndex('checkId', 'checkId');
        db.createObjectStore('weights', { keyPath: 'id' }).createIndex('athleteId', 'athleteId');
        db.createObjectStore('notes', { keyPath: ['athleteId', 'exerciseKey'] });
        const f = db.createObjectStore('feedback', { keyPath: 'id' });
        f.createIndex('athleteId', 'athleteId');
        f.createIndex('checkId', 'checkId');
        db.createObjectStore('questions', { keyPath: 'id' }).createIndex('athleteId', 'athleteId');
        db.createObjectStore('packages', { keyPath: 'packId' });
      }
    },
    blocked() {
      /* un'altra scheda tiene aperta una versione precedente: si chiuderà al suo ricaricamento */
    },
  });
}

export function db(): Promise<DB> {
  dbp ??= openPalestraDB();
  return dbp;
}

/** Solo per i test: usa un database diverso (fake-indexeddb) e azzera la connessione. */
export function setDbForTests(p: Promise<DB> | null): void {
  dbp = p;
}

/** Esegue fn in un'unica transazione readwrite su tutti gli store: commit solo se fn termina senza errori. */
export async function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, 'readwrite');
  try {
    const out = await fn(tx);
    await tx.done;
    return out;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* già chiusa */
    }
    await tx.done.catch(() => undefined);
    throw err;
  }
}

export async function readTx<T>(fn: (tx: Tx<'readonly'>) => Promise<T>): Promise<T> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, 'readonly');
  const out = await fn(tx);
  await tx.done;
  return out;
}

export const nowIso = (): string => new Date().toISOString();
export const uuid = (): string => crypto.randomUUID();

export async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
