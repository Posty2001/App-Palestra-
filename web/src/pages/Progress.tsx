import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  bestLoadByReps, commonRepCounts, repsImprovementsAtSameLoad, trendAtReps, weeklyAverages, workSets,
  type AthleteSummaryDto, type CheckDto, type SetDto, type WeightDto, type WorkoutDto,
} from '@palestra/shared';
import { get } from '../lib/api';
import { fmtDate, fmtDuration, fmtKg, fmtNum, fmtSet, fmtShort } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { Empty, ErrorText, LineChart, Loading, Segmented, SERIES_STYLES, TopBar } from '../components/ui';

export interface ExerciseListItem { exerciseKey: string; exerciseName: string; lastAt: string; sessions: number; workSets: number }
type View = 'loads' | 'sessions' | 'body';
const q = (userId: string | null) => (userId ? `?userId=${userId}` : '');

/** Progressi riutilizzabili: atleta per sé, coach per un atleta alla volta (userId). */
export function ProgressView({ userId, highlight }: { userId: string | null; highlight?: string | null }) {
  const [view, setView] = useState<View>(highlight ? 'sessions' : 'loads');
  return (
    <div className="stack">
      <Segmented label="Sezioni progressi" value={view} onChange={setView} options={[['loads', 'Carichi'], ['sessions', 'Sedute'], ['body', 'Corpo']]} />
      {view === 'loads' && <ExercisesView userId={userId} />}
      {view === 'sessions' && <HistoryView userId={userId} highlight={highlight} />}
      {view === 'body' && <BodyView userId={userId} />}
    </div>
  );
}

export function ProgressPage() {
  return (
    <>
      <TopBar title="Progressi" />
      <main className="page"><ProgressView userId={null} /></main>
    </>
  );
}

/** Area coach → Progressi: un atleta alla volta, con il contesto sempre evidente. */
export function CoachProgressPage() {
  const [params, setParams] = useSearchParams();
  const { data: athletes, error } = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const selected = athletes?.find((a) => a.id === params.get('atleta')) ?? athletes?.[0];
  return (
    <>
      <TopBar title="Progressi" athlete={selected ? { id: selected.id, name: selected.displayName } : null}>
        {athletes && athletes.length > 0 && (
          <label>Atleta
            <select value={selected?.id ?? ''} onChange={(e) => setParams({ atleta: e.target.value })} data-testid="progress-athlete">
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
          </label>
        )}
      </TopBar>
      <main className="page">
        <ErrorText error={error} />
        {!athletes && <Loading />}
        {athletes?.length === 0 && <Empty>Nessun atleta collegato.</Empty>}
        {selected && <ProgressView key={selected.id} userId={selected.id} />}
      </main>
    </>
  );
}

export function ExercisesView({ userId }: { userId: string | null }) {
  const { data, error } = useAsync(() => get<ExerciseListItem[]>(`/progress/exercises${q(userId)}`), [userId]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel && data?.[0]) setSel(data[0].exerciseKey);
  }, [data, sel]);
  if (error) return <ErrorText error={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Nessuna seduta salvata: i progressi compariranno dopo il primo allenamento.</Empty>;
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
  if (!data) return <Loading />;
  const name = sets[sets.length - 1]?.exerciseName ?? exerciseKey;
  const series = shown.map((r, i) => ({ label: `${r} rip.`, ...SERIES_STYLES[i % SERIES_STYLES.length]!, points: trendAtReps(sets, r).map((p) => ({ x: p.date, y: p.weightKg })) }));
  const firstShown = series[0];
  const delta = firstShown && firstShown.points.length >= 2 ? firstShown.points[firstShown.points.length - 1]!.y - firstShown.points[0]!.y : null;
  return (
    <div className="stack" data-testid="exercise-progress">
      {compact && <h3 className="title-n">{name}</h3>}
      <section className="card stack">
        <div className="row"><strong>A parità di ripetizioni</strong>{delta !== null && <span className={delta > 0 ? 'ok' : 'muted'}>{delta > 0 ? '+' : ''}{fmtKg(delta)} a {shown[0]} rip.</span>}</div>
        <LineChart series={series} />
        <div className="row-start" role="group" aria-label="Linee per ripetizioni">
          {reps.map((r) => {
            const i = shown.indexOf(r);
            const st = i >= 0 ? SERIES_STYLES[i % SERIES_STYLES.length]! : null;
            return (
              <button key={r} type="button" className="pill" aria-pressed={i >= 0}
                style={st ? { background: 'transparent', color: st.color, borderColor: st.color, borderStyle: st.dashed ? 'dashed' : 'solid' } : undefined}
                onClick={() => setLines(i >= 0 ? shown.filter((x) => x !== r) : [...shown, r].sort((a, b) => a - b))}>{r} rip.</button>
            );
          })}
        </div>
      </section>
      {!compact && (
        <section className="card tight">
          <p className="cap" style={{ paddingTop: 12 }}>Ultima seduta · {fmtDate(lastWorkout[0]?.completedAt)}</p>
          <table><tbody>
            {lastWorkout.map((s) => <tr key={s.id}><td className="muted">{s.kind === 'warmup' ? 'Riscaldamento' : `Serie ${s.setIndex + 1}`}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtSet(s)}{s.rir !== null ? ` · RIR ${s.rir}` : ''}</td></tr>)}
          </tbody></table>
        </section>
      )}
      {!compact && (
        <section className="card tight">
          <p className="cap" style={{ paddingTop: 12 }}>Migliori carichi · {workSets(sets).length} serie allenanti</p>
          <table data-testid="best-table"><tbody>
            {best.map((b) => <tr key={b.reps}><td className="muted">{b.reps} rip.</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(b.weightKg)}</td><td style={{ textAlign: 'right' }} className="muted">{fmtShort(b.date)}</td></tr>)}
          </tbody></table>
        </section>
      )}
      {improvements.length > 0 && (
        <section className="card tight">
          <p className="cap" style={{ paddingTop: 12 }}>Più ripetizioni a parità di carico</p>
          <table><tbody>
            {improvements.slice(0, 5).map((i) => <tr key={i.weightKg}><td className="num">{fmtKg(i.weightKg)}</td><td className="ok" style={{ fontWeight: 600 }}>{i.fromReps} → {i.toReps} rip.</td><td className="muted" style={{ textAlign: 'right' }}>{fmtShort(i.toDate)}</td></tr>)}
          </tbody></table>
        </section>
      )}
    </div>
  );
}

export function HistoryView({ userId, highlight }: { userId: string | null; highlight?: string | null }) {
  const { data, error } = useAsync(() => get<WorkoutDto[]>(`/workouts${q(userId)}${userId ? '&' : '?'}limit=50`), [userId]);
  if (error) return <ErrorText error={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Ancora nessun allenamento salvato.</Empty>;
  return (
    <div className="stack" data-testid="history">
      {data.map((w) => {
        const groups = new Map<string, SetDto[]>();
        for (const s of w.sets) groups.set(s.exerciseSlot + s.exerciseName, [...(groups.get(s.exerciseSlot + s.exerciseName) ?? []), s]);
        const skipped = w.day.exercises.filter((e) => w.exerciseStates[e.id]?.state === 'skipped');
        return (
          <details key={w.id} className={`card ${highlight === w.id ? 'accent' : ''}`} open={highlight === w.id}>
            <summary className="row" style={{ cursor: 'pointer', minHeight: 44 }}>
              <span><strong>{w.day.name}</strong> <small>{w.programName} v{w.versionNo}</small></span>
              <small>{fmtShort(w.startedAt)}</small>
            </summary>
            <small>{w.endedAt ? fmtDuration(new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) : ''} · {w.sets.filter((s) => s.kind === 'work').length} serie</small>
            {[...groups.values()].map((g) => (
              <div key={g[0]!.id} className="list-row" style={{ display: 'grid', gap: 2, alignItems: 'start' }}>
                <strong style={{ fontWeight: 600 }}>{g[0]!.exerciseName}</strong>
                <span className="num sub" style={{ fontSize: 15 }}>{g.map((s) => `${s.kind === 'warmup' ? 'R ' : ''}${fmtSet(s)}`).join(' · ')}</span>
              </div>
            ))}
            {skipped.length > 0 && <p className="muted">Saltati: {skipped.map((e) => e.name).join(', ')}</p>}
            {w.athleteNote && <p className="feedback" style={{ marginTop: 8 }}><small>Nota atleta</small><br />{w.athleteNote}</p>}
          </details>
        );
      })}
    </div>
  );
}

const MEASURES: [keyof CheckDto, string, string][] = [['weightKg', 'Peso', ' kg'], ['bicepsCm', 'Bicipite', ' cm'], ['chestCm', 'Petto', ' cm'], ['thighCm', 'Coscia', ' cm'], ['waistCm', 'Addome', ' cm']];

/** Andamento del peso e delle misure: solo dati registrati, grafico solo con almeno due settimane. */
export function BodyView({ userId }: { userId: string | null }) {
  const weights = useAsync(() => get<WeightDto[]>(`/weights${q(userId)}`), [userId]);
  const checks = useAsync(() => get<CheckDto[]>(`/checks${q(userId)}`), [userId]);
  if (weights.error || checks.error) return <ErrorText error={weights.error ?? checks.error} />;
  if (!weights.data || !checks.data) return <Loading />;
  const weeks = weeklyAverages(weights.data);
  const sorted = [...checks.data].sort((a, b) => a.checkDate.localeCompare(b.checkDate));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!weeks.length && !sorted.length) return <Empty action={userId ? undefined : <Link to="/check" className="btn">Vai a Check</Link>}>Nessun peso o check registrato.</Empty>;
  return (
    <div className="stack">
      {weeks.length > 0 && (
        <section className="card stack">
          <strong>Peso · media settimanale</strong>
          {weeks.length >= 2 && <LineChart series={[{ label: 'Peso', color: '#ff5265', points: [...weeks].reverse().map((w) => ({ x: w.weekStart, y: w.avg })) }]} />}
          <table><tbody>
            {weeks.slice(0, 6).map((w) => <tr key={w.weekStart}><td className="muted">Sett. del {fmtShort(w.weekStart)}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtKg(w.avg)}</td><td style={{ textAlign: 'right' }} className="muted">{w.n} rilev.</td></tr>)}
          </tbody></table>
        </section>
      )}
      {first && last && (
        <section className="card tight">
          <p className="cap" style={{ paddingTop: 12 }}>Misure · {fmtShort(first.checkDate)} → {fmtShort(last.checkDate)}</p>
          <table><tbody>
            {MEASURES.map(([k, label, unit]) => {
              const a = first[k] as number | null;
              const b = last[k] as number | null;
              const d = a !== null && b !== null && first !== last ? Math.round((b - a) * 10) / 10 : null;
              return <tr key={k}><td className="muted">{label}</td><td style={{ textAlign: 'right' }}>{fmtNum(b, unit)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{d === null ? '—' : `${d > 0 ? '+' : ''}${d.toLocaleString('it-IT')}${unit}`}</td></tr>;
            })}
          </tbody></table>
        </section>
      )}
      {!userId && <Link to="/check" className="btn">Check precedenti e confronto foto</Link>}
    </div>
  );
}
