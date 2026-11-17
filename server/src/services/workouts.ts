import type { DaySpec, ExerciseContextDto, ExerciseState, QuestionDto, SetDto, WorkoutDto, WorkoutStatus } from '@palestra/shared';
import type { Queryable } from '../db.js';

interface WorkoutRow {
  id: string;
  athlete_id: string;
  program_id: string | null;
  program_version_id: string | null;
  version_no: number | null;
  program_name: string | null;
  day_index: number;
  day_snapshot: DaySpec;
  status: WorkoutStatus;
  started_at: Date;
  ended_at: Date | null;
  athlete_note: string | null;
  exercise_states: Record<string, ExerciseState>;
}

interface SetRow {
  id: string;
  workout_id: string;
  exercise_slot: string;
  exercise_key: string;
  exercise_name: string;
  kind: 'warmup' | 'work';
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  completed_at: Date;
}

export const SET_COLUMNS = 'id, workout_id, exercise_slot, exercise_key, exercise_name, kind, set_index, weight_kg, reps, rir, completed_at';

export function toSetDto(r: SetRow): SetDto {
  return {
    id: r.id, workoutId: r.workout_id, exerciseSlot: r.exercise_slot, exerciseKey: r.exercise_key, exerciseName: r.exercise_name,
    kind: r.kind, setIndex: r.set_index, weightKg: r.weight_kg, reps: r.reps, rir: r.rir, completedAt: r.completed_at.toISOString(),
  };
}

const WORKOUT_COLUMNS = `id, athlete_id, program_id, program_version_id, version_no, program_name, day_index, day_snapshot, status,
  started_at, ended_at, athlete_note, exercise_states`;

function toWorkoutDto(w: WorkoutRow, sets: SetDto[]): WorkoutDto {
  return {
    id: w.id, athleteId: w.athlete_id, programId: w.program_id, programVersionId: w.program_version_id, versionNo: w.version_no,
    programName: w.program_name, dayIndex: w.day_index, day: w.day_snapshot, status: w.status, startedAt: w.started_at.toISOString(),
    endedAt: w.ended_at?.toISOString() ?? null, athleteNote: w.athlete_note, exerciseStates: w.exercise_states, sets,
  };
}

export async function loadWorkouts(db: Queryable, where: string, params: unknown[], limit = 50): Promise<WorkoutDto[]> {
  const w = await db.query<WorkoutRow>(`select ${WORKOUT_COLUMNS} from workouts where ${where} order by started_at desc limit ${Math.min(limit, 200)}`, params);
  if (!w.rows.length) return [];
  const s = await db.query<SetRow>(
    `select ${SET_COLUMNS} from workout_sets where workout_id = any($1) order by completed_at, set_index`,
    [w.rows.map((r) => r.id)],
  );
  const byWorkout = new Map<string, SetDto[]>();
  for (const row of s.rows) {
    const list = byWorkout.get(row.workout_id) ?? [];
    list.push(toSetDto(row));
    byWorkout.set(row.workout_id, list);
  }
  return w.rows.map((row) => toWorkoutDto(row, byWorkout.get(row.id) ?? []));
}

export async function loadWorkout(db: Queryable, id: string): Promise<WorkoutDto | null> {
  return (await loadWorkouts(db, 'id = $1', [id], 1))[0] ?? null;
}

/** Contesto per esercizio: serie dell'ultima seduta completata, assetto macchina, feedback del coach, domande. */
export async function exerciseContexts(db: Queryable, athleteId: string, keys: string[]): Promise<Record<string, ExerciseContextDto>> {
  const out: Record<string, ExerciseContextDto> = {};
  if (!keys.length) return out;
  for (const k of keys) out[k] = { exerciseKey: k, lastSets: [], lastDate: null, machineSetup: null, feedback: [], questions: [] };

  const [last, notes, feedback, questions] = await Promise.all([
    db.query<SetRow & { started_at: Date }>(
      `with last as (
         select distinct on (s.exercise_key) s.exercise_key, s.workout_id
           from workout_sets s join workouts w on w.id = s.workout_id
          where s.athlete_id = $1 and w.status = 'completed' and s.exercise_key = any($2)
          order by s.exercise_key, w.started_at desc)
       select s.id, s.workout_id, s.exercise_slot, s.exercise_key, s.exercise_name, s.kind, s.set_index, s.weight_kg, s.reps, s.rir,
              s.completed_at, w.started_at
         from workout_sets s join last l on l.workout_id = s.workout_id and l.exercise_key = s.exercise_key
         join workouts w on w.id = s.workout_id
        order by s.kind desc, s.set_index, s.completed_at`,
      [athleteId, keys],
    ),
    db.query<{ exercise_key: string; machine_setup: string | null }>(
      'select exercise_key, machine_setup from exercise_notes where user_id = $1 and exercise_key = any($2)',
      [athleteId, keys],
    ),
    db.query<{ id: string; exercise_key: string; body: string; created_at: Date; coach_name: string }>(
      `select f.id, f.exercise_key, f.body, f.created_at, u.display_name as coach_name
         from exercise_feedback f join users u on u.id = f.coach_id
        where f.athlete_id = $1 and f.exercise_key = any($2) order by f.created_at desc`,
      [athleteId, keys],
    ),
    loadQuestions(db, 'athlete_id = $1 and exercise_key = any($2)', [athleteId, keys]),
  ]);
  for (const r of last.rows) {
    const ctx = out[r.exercise_key];
    if (!ctx) continue;
    ctx.lastSets.push(toSetDto(r));
    ctx.lastDate = r.started_at.toISOString();
  }
  for (const r of notes.rows) {
    const ctx = out[r.exercise_key];
    if (ctx) ctx.machineSetup = r.machine_setup;
  }
  for (const r of feedback.rows) {
    out[r.exercise_key]?.feedback.push({ id: r.id, body: r.body, createdAt: r.created_at.toISOString(), coachName: r.coach_name });
  }
  for (const q of questions) out[q.exerciseKey]?.questions.push(q);
  return out;
}

export async function loadQuestions(db: Queryable, where: string, params: unknown[]): Promise<QuestionDto[]> {
  const r = await db.query<{
    id: string; athlete_id: string; exercise_key: string; exercise_name: string; body: string; answer: string | null;
    answered_at: Date | null; created_at: Date; context: QuestionDto['context'];
  }>(`select id, athlete_id, exercise_key, exercise_name, body, answer, answered_at, created_at, context from questions where ${where} order by created_at desc limit 200`, params);
  return r.rows.map((q) => ({
    id: q.id, athleteId: q.athlete_id, exerciseKey: q.exercise_key, exerciseName: q.exercise_name, body: q.body, answer: q.answer,
    answeredAt: q.answered_at?.toISOString() ?? null, createdAt: q.created_at.toISOString(), context: q.context,
  }));
}
