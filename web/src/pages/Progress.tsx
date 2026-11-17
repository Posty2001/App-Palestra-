import { useEffect, useMemo, useState } from 'react';
import {
  bestLoadByReps, commonRepCounts, repsImprovementsAtSameLoad, trendAtReps, workSets, type SetDto, type WorkoutDto,
} from '@palestra/shared';
import { get } from '../lib/api';
import { fmtDate, fmtDuration, fmtKg, fmtSet, fmtShort } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { ErrorText, LineChart, Segmented, SERIES_COLORS, TopBar } from '../components/ui';

export interface ExerciseListItem { exerciseKey: string; exerciseName: string; lastAt: string; sessions: number; workSets: number }

export function ProgressPage() {
  const [view, setView] = useState<'ex' | 'hist'>('ex');
  return (
    <>
      <TopBar title="Progressi" />
      <main className="page">
        <Segmented label="Vista" value={view} onChange={setView} options={[['ex', 'Esercizi'], ['hist', 'Storico sedute']]} />
        {view === 'ex' ? <ExercisesView userId={null} /> : <HistoryView userId={null} />}
      </main>
    </>
  );
}

const q = (userId: string | null) => (userId ? `?userId=${userId}` : '');

export function ExercisesView({ userId }: { userId: string | null }) {
  const { data, error } = useAsync(() => get<ExerciseListItem[]>(`/progress/exercises${q(userId)}`), [userId]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel && data?.[0]) setSel(data[0].exerciseKey);
  }, [data, sel]);
  if (error) return <ErrorText error={error} />;
  if (!data) return <p className="muted">Carico…</p>;
  if (!data.length) return <p className="empty">Nessuna seduta salvata: i progressi compariranno dopo il primo allenamento.</p>;
  return (
    <div className="stack">
      <label>Esercizio
        <select value={sel ?? ''} onChange={(e) => setSel(e.target.value)} data-testid="progress-exercise">
          {data.map((x) => <option key={x.exerciseKey} value={x.exerciseKey}>{x.exerciseName} · {x.sessions} sedute</option>)}
        </select>
      </label>
      {sel && <ExerciseDetail key={sel} exerciseKey={sel} userId={userId} />}
    </div>
  );
}

export function ExerciseDetail({ exerciseKey, userId, compact }: { exerciseKey: string; userId: string | null; compact?: boolean }) {
  const { data } = useAsync(() => get<{ sets: SetDto[] }>(`/progress/exercises/${encodeURIComponent(exerciseKey)}${q(userId)}`), [exerciseKey, userId]);
  const sets = data?.sets ?? [];
  const reps = useMemo(() => commonRepCounts(sets, 4), [sets]);
  const [lines, setLines] = useState<number[] | null>(null);
  const shown = lines ?? reps.slice(0, 2);
  const best = useMemo(() => bestLoadByReps(sets), [sets]);
  const improvements = useMemo(() => repsImprovementsAtSameLoad(sets), [sets]);
  const lastWorkout = useMemo(() => {
    const last = sets[sets.length - 1];
    return last ? sets.filter((s) => s.workoutId === last.workoutId) : [];
  }, [sets]);
  if (!data) return <p className="muted">Carico…</p>;
  const name = sets[sets.length - 1]?.exerciseName ?? exerciseKey;
  return (
    <div className="stack" data-testid="exercise-progress">
      {compact && <h3>{name}</h3>}
      <div className="card">
        <strong>Ultima seduta</strong> <small>{fmtDate(lastWorkout[0]?.completedAt)}</small>
        {lastWorkout.map((s) => (
          <p key={s.id} className="row"><small>{s.kind === 'warmup' ? 'Riscaldamento' : `Serie ${s.setIndex + 1}`}</small><span className="num">{fmtSet(s)}{s.rir !== null ? ` · RIR ${s.rir}` : ''}</span></p>
        ))}
        <small>{workSets(sets).length} serie allenanti registrate in totale (riscaldamento escluso)</small>
      </div>
      <div className="card">
        <strong>Andamento a parità di ripetizioni</strong>
        <div className="chips" role="group" aria-label="Linee ripetizioni" style={{ margin: '8px 0' }}>
          {reps.map((r) => (
            <button key={r} type="button" aria-pressed={shown.includes(r)} onClick={() => setLines(shown.includes(r) ? shown.filter((x) => x !== r) : [...shown, r].sort((a, b) => a - b))}>{r} rip.</button>
          ))}
        </div>
        <LineChart series={shown.map((r, i) => ({ label: `${r} ripetizioni`, color: SERIES_COLORS[i % SERIES_COLORS.length] as string, points: trendAtReps(sets, r).map((p) => ({ x: p.date, y: p.weightKg })) }))} />
      </div>
      {!compact && (
        <div className="card">
          <strong>Migliori carichi per ripetizioni</strong>
          <table data-testid="best-table"><thead><tr><th>Rip.</th><th>Carico</th><th>Data</th></tr></thead><tbody>
            {best.map((b) => <tr key={b.reps}><td>{b.reps}</td><td className="num">{fmtKg(b.weightKg)}</td><td>{fmtShort(b.date)}</td></tr>)}
          </tbody></table>
        </div>
      )}
      {improvements.length > 0 && (
        <div className="card">
          <strong>Più ripetizioni a parità di carico</strong>
          {improvements.slice(0, 5).map((i) => (
            <p key={i.weightKg} className="row"><span className="num">{fmtKg(i.weightKg)}</span><span className="ok">{i.fromReps} → {i.toReps} rip.</span><small>{fmtShort(i.fromDate)} → {fmtShort(i.toDate)}</small></p>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryView({ userId, highlight }: { userId: string | null; highlight?: string | null }) {
  const { data, error } = useAsync(() => get<WorkoutDto[]>(`/workouts${q(userId)}${userId ? '&' : '?'}limit=50`), [userId]);
  if (error) return <ErrorText error={error} />;
  if (!data) return <p className="muted">Carico…</p>;
  if (!data.length) return <p className="empty">Ancora nessun allenamento salvato.</p>;
  return (
    <div className="stack" data-testid="history">
      {data.map((w) => {
        const groups = new Map<string, SetDto[]>();
        for (const s of w.sets) groups.set(s.exerciseSlot + s.exerciseName, [...(groups.get(s.exerciseSlot + s.exerciseName) ?? []), s]);
        const skipped = w.day.exercises.filter((e) => w.exerciseStates[e.id]?.state === 'skipped');
        return (
          <details key={w.id} className={`card ${highlight === w.id ? 'highlight' : ''}`} open={highlight === w.id}>
            <summary className="row">
              <span><strong>{w.day.name}</strong> <small>{w.programName} v{w.versionNo}</small></span>
              <small>{fmtDate(w.startedAt)}</small>
            </summary>
            <small>{w.endedAt ? fmtDuration(new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) : ''} · {w.sets.filter((s) => s.kind === 'work').length} serie</small>
            {[...groups.values()].map((g) => (
              <div key={g[0]!.id} className="line">
                <strong>{g[0]!.exerciseName}</strong>
                <p className="num">{g.map((s) => `${s.kind === 'warmup' ? 'R ' : ''}${fmtSet(s)}`).join(' · ')}</p>
              </div>
            ))}
            {skipped.length > 0 && <p className="muted">Saltati: {skipped.map((e) => e.name).join(', ')}</p>}
            {w.athleteNote && <p className="feedback"><small>Nota atleta</small><br />{w.athleteNote}</p>}
          </details>
        );
      })}
    </div>
  );
}
