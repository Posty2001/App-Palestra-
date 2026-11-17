import { z } from 'zod';
import type { DaySpec, ProgramContent } from './program.js';

export type Role = 'coach' | 'athlete';

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isDemo: boolean;
  coach: { id: string; displayName: string } | null;
}

export interface ProgramSummaryDto {
  id: string;
  ownerId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  nextDayIndex: number;
  currentVersionId: string;
  versionNo: number;
  content: ProgramContent;
  hasDraft: boolean;
  createdBy: string;
  /** Versione pubblicata non ancora vista dal proprietario (riepilogo modifiche). */
  unseenChange: { versionNo: number; summary: string | null; publishedAt: string } | null;
  archived: boolean;
}

export interface ProgramDetailDto extends ProgramSummaryDto {
  draft: { name: string; startDate: string | null; endDate: string | null; content: ProgramContent; updatedAt: string } | null;
  versions: { id: string; versionNo: number; summary: string | null; publishedAt: string }[];
}

export type SetKind = 'warmup' | 'work';

export interface SetDto {
  id: string;
  workoutId: string;
  exerciseSlot: string;
  exerciseKey: string;
  exerciseName: string;
  kind: SetKind;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  completedAt: string;
}

export type ExerciseState =
  | { state: 'skipped' }
  | { state: 'substituted'; name: string };

export type WorkoutStatus = 'in_progress' | 'completed' | 'discarded';

export interface WorkoutDto {
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
  sets: SetDto[];
}

export interface ExerciseContextDto {
  exerciseKey: string;
  lastSets: SetDto[];
  lastDate: string | null;
  machineSetup: string | null;
  feedback: { id: string; body: string; createdAt: string; coachName: string }[];
  questions: QuestionDto[];
}

export interface QuestionDto {
  id: string;
  athleteId: string;
  exerciseKey: string;
  exerciseName: string;
  body: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  context: { lastDate: string | null; sets: { weightKg: number | null; reps: number | null }[] } | null;
}

export interface TodayBundleDto {
  user: UserDto;
  programs: ProgramSummaryDto[];
  activeWorkout: WorkoutDto | null;
  contexts: Record<string, ExerciseContextDto>;
  checkDue: { weekday: number; dueToday: boolean; doneToday: boolean } | null;
  generatedAt: string;
}

export type Pose = 'front' | 'side' | 'back';
export const POSES: readonly Pose[] = ['front', 'side', 'back'] as const;
export const POSE_LABEL: Record<Pose, string> = { front: 'Fronte', side: 'Lato', back: 'Retro' };

export interface CheckDto {
  id: string;
  athleteId: string;
  checkDate: string;
  weightKg: number | null;
  bicepsCm: number | null;
  chestCm: number | null;
  thighCm: number | null;
  waistCm: number | null;
  note: string | null;
  sharePhotos: boolean;
  reviewedAt: string | null;
  createdAt: string;
  /** Foto visibili al richiedente (il coach le riceve solo se condivise). */
  photos: { id: string; pose: Pose; width: number; height: number }[];
  /** Numero di foto presenti, anche se non visibili al richiedente. */
  photoCount: number;
  feedback: { id: string; body: string; createdAt: string; coachName: string }[];
}

export interface WeightDto {
  id: string;
  measuredOn: string;
  weightKg: number;
  source: 'entry' | 'check';
}

export type ReviewItemDto =
  | { type: 'check'; id: string; athleteId: string; athleteName: string; at: string; title: string; detail: string }
  | { type: 'question'; id: string; athleteId: string; athleteName: string; at: string; title: string; detail: string; exerciseKey: string }
  | { type: 'workout_note'; id: string; athleteId: string; athleteName: string; at: string; title: string; detail: string }
  | { type: 'program_expiry'; id: string; athleteId: string; athleteName: string; at: string; title: string; detail: string };

export interface AthleteSummaryDto {
  id: string;
  displayName: string;
  email: string;
  isDemo: boolean;
  linkedAt: string;
  checkWeekday: number | null;
  keyExercises: string[];
  activeProgram: { id: string; name: string; startDate: string | null; endDate: string | null } | null;
  lastWorkout: { id: string; dayName: string; endedAt: string | null } | null;
  lastCheck: { id: string; checkDate: string } | null;
  pendingReview: number;
}

export interface InviteDto {
  id: string;
  athleteName: string;
  email: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  url?: string;
}

export type InviteStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'invalid';

export interface PdfImportResultDto {
  status: 'ok' | 'partial' | 'unreadable';
  message: string;
  name: string;
  content: ProgramContent | null;
  /** Elementi dubbi: chiave "dayIndex:exerciseIndex" o "day:dayIndex" o "global". */
  doubts: { where: string; message: string }[];
}

// ---- schemi input condivisi (validazione client e server) ----

export const passwordSchema = z
  .string()
  .min(10, 'La password deve avere almeno 10 caratteri')
  .max(200, 'Password troppo lunga');

export const emailSchema = z.string().trim().toLowerCase().email('Email non valida').max(254);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida');

export const setInputSchema = z.object({
  exerciseSlot: z.string().min(1).max(64),
  exerciseKey: z.string().min(1).max(160),
  exerciseName: z.string().min(1).max(120),
  kind: z.enum(['warmup', 'work']),
  setIndex: z.number().int().min(0).max(50),
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(200).nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
  completedAt: z.string().datetime(),
});
export type SetInput = z.infer<typeof setInputSchema>;
