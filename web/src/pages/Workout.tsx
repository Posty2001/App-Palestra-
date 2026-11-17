import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  defaultRestSeconds, exerciseKey, formatRest, plannedSetCount, workSetLabel,
  type ExerciseContextDto, type ExerciseSpec, type SetDto, type TodayBundleDto,
} from '@palestra/shared';
import { uuid } from '../lib/api';
import { useUser } from '../lib/auth';
import { fmtDuration, fmtSet, fmtShort, parseNum } from '../lib/format';
import { kvGet, kvSet } from '../lib/idb';
import { enqueue } from '../lib/sync';
import {
  bundleKey, deleteSet, discardWorkout, finishWorkout, saveSet, setExerciseState, setRest, slotExercise, useActiveWorkout,
  type LocalWorkout, type RestTimer,
} from '../lib/workoutStore';
import { Sheet, TopBar } from '../components/ui';

type Contexts = Record<string, ExerciseContextDto>;

export function WorkoutPage() {
  const user = useUser();
  const nav = useNavigate();
  const { workout, loaded } = useActiveWorkout();
  const [contexts, setContexts] = useState<Contexts>({});
  const [finishing, setFinishing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void kvGet<TodayBundleDto>(bundleKey(user.id)).then((b) => setContexts(b?.contexts ?? {}));
  }, [user.id]);

  // Esercizio aperto di default: il primo non completato.
  useEffect(() => {
    if (!workout || open !== null) return;
    const first = workout.day.exercises.find((e) => {
      if (workout.exerciseStates[e.id]?.state === 'skipped') return false;
      return workout.sets.filter((s) => s.exerciseSlot === e.id && s.kind === 'work').length < plannedSetCount(e);
    });
    setOpen(first?.id ?? workout.day.exercises[0]?.id ?? null);
  }, [workout, open]);

  const updateContext = useCallback(async (key: string, patch: Partial<ExerciseContextDto>) => {
    setContexts((c) => ({ ...c, [key]: { ...(c[key] ?? emptyCtx(key)), ...patch } }));
    const b = await kvGet<TodayBundleDto>(bundleKey(user.id));
    if (b) {
      b.contexts[key] = { ...(b.contexts[key] ?? emptyCtx(key)), ...patch };
      await kvSet(bundleKey(user.id), b);
    }
  }, [user.id]);

  if (!loaded) return null;
  if (!workout) return <Navigate to="/" replace />;

  return (
    <>
      <TopBar title={workout.day.name}>
        <div className="row">
          <small>{workout.programName} · v{workout.versionNo ?? '—'}</small>
          <button className="quiet" onClick={() => nav('/')} data-testid="suspend">Lascia in sospeso</button>
        </div>
      </TopBar>
      <main className="page" data-testid="session-list">
        {workout.day.exercises.map((ex) => (
          <ExerciseCard
            key={ex.id}
            workout={workout}
            ex={ex}
            ctx={contexts[slotExercise(workout, ex.id).key]}
            open={open === ex.id}
            onToggle={() => setOpen(open === ex.id ? '' : ex.id)}
            hasCoach={!!user.coach}
            updateContext={updateContext}
          />
        ))}
      </main>
      <RestBar workout={workout} onFinish={() => setFinishing(true)} />
      <FinishSheet open={finishing} workout={workout} onClose={() => setFinishing(false)} onDone={() => nav('/', { replace: true })} />
    </>
  );
}

const emptyCtx = (key: string): ExerciseContextDto => ({ exerciseKey: key, lastSets: [], lastDate: null, machineSetup: null, feedback: [], questions: [] });

interface RowDraft { weight: string; reps: string; rir: string }

function ExerciseCard({ workout, ex, ctx, open, onToggle, hasCoach, updateContext }: {
  workout: LocalWorkout; ex: ExerciseSpec; ctx: ExerciseContextDto | undefined; open: boolean; onToggle: () => void; hasCoach: boolean;
  updateContext: (key: string, patch: Partial<ExerciseContextDto>) => Promise<void>;
}) {
  const state = workout.exerciseStates[ex.id];
  const eff = slotExercise(workout, ex.id);
  const mine = workout.sets.filter((s) => s.exerciseSlot === ex.id);
  const work = mine.filter((s) => s.kind === 'work');
  const warm = mine.filter((s) => s.kind === 'warmup');
  const planned = plannedSetCount(ex);
  const [extraWork, setExtraWork] = useState(0);
  const [extraWarm, setExtraWarm] = useState(0);
  const [panel, setPanel] = useState<'none' | 'setup' | 'ask' | 'swap'>('none');
  const lastWork = (ctx?.lastSets ?? []).filter((s) => s.kind === 'work').sort((a, b) => a.setIndex - b.setIndex);
  const workRows = Math.max(planned, work.length ? Math.max(...work.map((s) => s.setIndex)) + 1 : 0) + extraWork;
  const warmRows = Math.max(warm.length ? Math.max(...warm.map((s) => s.setIndex)) + 1 : 0) + extraWarm;
  const skipped = state?.state === 'skipped';
  const done = !skipped && work.length >= planned;
  const restSec = defaultRestSeconds(ex);
  const nextIndex = Array.from({ length: workRows }, (_, i) => i).find((i) => !work.some((s) => s.setIndex === i));

  return (
    <section className={`ex ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}`} data-testid={`exercise-${eff.key}`}>
      <button type="button" className="ex-head" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{eff.name}</strong>
          {eff.substituted && <small>al posto di {ex.name} · </small>}
          <small>{ex.setsRaw} × {ex.repsRaw}{ex.restRaw ? ` · rec ${ex.restRaw}` : ''}</small>
        </span>
        <span className={`chip ${done ? 'self' : ''}`}>{skipped ? 'Saltato' : `${work.length}/${planned}`}</span>
      </button>
      {open && (
        <div className="ex-body">
          <div className="last-time">
            <strong>Ultima volta</strong>{ctx?.lastDate ? <small> · {fmtShort(ctx.lastDate)}</small> : null}
            {lastWork.length ? (
              <p className="num">{lastWork.map(fmtSet).join(' · ')}</p>
            ) : (
              <p className="muted">Nessuno storico: compila i campi.</p>
            )}
            {ctx?.machineSetup && <p data-testid="machine-setup"><small>Assetto macchina:</small> {ctx.machineSetup}</p>}
          </div>
          {ctx?.feedback[0] && (
            <div className="feedback" data-testid="exercise-feedback"><small>Coach · {fmtShort(ctx.feedback[0].createdAt)}</small><br />{ctx.feedback[0].body}</div>
          )}
          {ctx?.questions.filter((q) => q.answer).slice(0, 2).map((q) => (
            <div key={q.id} className="feedback"><small>Tu: {q.body}</small><br />{q.answer}</div>
          ))}
          {ex.notes && <p className="muted">Nota: {ex.notes}</p>}

          {!skipped && (
            <>
              {Array.from({ length: warmRows }, (_, i) => (
                <SetRow key={`w${i}`} workout={workout} slot={ex.id} effName={eff.name} effKey={eff.key} kind="warmup" index={i}
                  label={`Riscald. ${i + 1}`} target="" recorded={warm.find((s) => s.setIndex === i)} prefill={undefined} restSec={0} primary={false} />
              ))}
              {Array.from({ length: workRows }, (_, i) => {
                const lab = i < planned ? workSetLabel(ex, i) : { label: `Extra ${i - planned + 1}`, target: '' };
                return (
                  <SetRow key={`s${i}`} workout={workout} slot={ex.id} effName={eff.name} effKey={eff.key} kind="work" index={i}
                    label={lab.label} target={lab.target} recorded={work.find((s) => s.setIndex === i)}
                    prefill={lastWork.find((s) => s.setIndex === i) ?? lastWork[i]} restSec={restSec} primary={i === nextIndex} />
                );
              })}
              <div className="row-start">
                <button type="button" className="quiet" onClick={() => setExtraWarm((n) => n + 1)} data-testid="add-warmup">+ Riscaldamento</button>
                <button type="button" className="quiet" onClick={() => setExtraWork((n) => n + 1)}>+ Serie</button>
              </div>
            </>
          )}

          <div className="row-start">
            {skipped ? (
              <button type="button" className="small-btn" onClick={() => void setExerciseState(ex.id, null)}>Ripristina esercizio</button>
            ) : (
              <button type="button" className="small-btn" onClick={() => void setExerciseState(ex.id, { state: 'skipped' })}>Salta</button>
            )}
            <button type="button" className="small-btn" onClick={() => setPanel(panel === 'swap' ? 'none' : 'swap')}>Sostituisci</button>
            <button type="button" className="small-btn" onClick={() => setPanel(panel === 'setup' ? 'none' : 'setup')}>Assetto macchina</button>
            {hasCoach && <button type="button" className="small-btn" onClick={() => setPanel(panel === 'ask' ? 'none' : 'ask')}>Chiedi al coach</button>}
          </div>
          {panel === 'swap' && (
            <InlineForm label="Esercizio eseguito al suo posto" initial={eff.substituted ? eff.name : ''} submit="Sostituisci"
              onCancel={eff.substituted ? () => { void setExerciseState(ex.id, null); setPanel('none'); } : undefined} cancelLabel="Torna all'originale"
              onSubmit={async (v) => { await setExerciseState(ex.id, { state: 'substituted', name: v }); setPanel('none'); }} />
          )}
          {panel === 'setup' && (
            <InlineForm label="Assetto macchina (es. sedile 4, schienale 2)" initial={ctx?.machineSetup ?? ''} submit="Salva assetto" multiline allowEmpty
              onSubmit={async (v) => {
                await enqueue({ method: 'PUT', path: `/exercise-notes/${encodeURIComponent(eff.key)}`, body: { machineSetup: v }, workoutId: null });
                await updateContext(eff.key, { machineSetup: v || null });
                setPanel('none');
              }} />
          )}
          {panel === 'ask' && (
            <InlineForm label={`Domanda breve su ${eff.name}`} initial="" submit="Invia domanda" multiline max={500}
              onSubmit={async (v) => {
                const id = uuid();
                await enqueue({ method: 'PUT', path: `/questions/${id}`, body: { exerciseName: eff.name, body: v }, workoutId: null });
                await updateContext(eff.key, { questions: [{ id, athleteId: workout.athleteId, exerciseKey: eff.key, exerciseName: eff.name, body: v, answer: null, answeredAt: null, createdAt: new Date().toISOString(), context: null }, ...(ctx?.questions ?? [])] });
                setPanel('none');
              }} />
          )}
          {ctx?.questions.filter((q) => !q.answer).slice(0, 1).map((q) => <p key={q.id} className="muted">Domanda inviata: «{q.body}» — in attesa di risposta</p>)}
        </div>
      )}
    </section>
  );
}

function SetRow({ workout, slot, effName, effKey, kind, index, label, target, recorded, prefill, restSec, primary }: {
  workout: LocalWorkout; slot: string; effName: string; effKey: string; kind: 'work' | 'warmup'; index: number; label: string; target: string;
  recorded: SetDto | undefined; prefill: SetDto | undefined; restSec: number; primary: boolean;
}) {
  const initial = (): RowDraft => {
    const src = recorded ?? (kind === 'work' ? prefill : undefined);
    return { weight: src?.weightKg?.toString().replace('.', ',') ?? '', reps: src?.reps?.toString() ?? '', rir: recorded?.rir?.toString() ?? '' };
  };
  const [d, setD] = useState<RowDraft>(initial);
  const [busy, setBusy] = useState(false);
  const idRef = useRef<string>(recorded?.id ?? uuid()); // id stabile: un doppio tocco non crea due serie
  useEffect(() => {
    if (recorded) idRef.current = recorded.id;
  }, [recorded]);
  // Lo storico può arrivare dopo il primo render (cache IndexedDB): precompila solo campi ancora vuoti.
  useEffect(() => {
    if (!recorded && prefill) setD((cur) => (cur.weight || cur.reps ? cur : initial()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.id]);
  const dirty = recorded && (parseNum(d.weight) !== recorded.weightKg || parseNum(d.reps) !== recorded.reps || (d.rir ? Number(d.rir) : null) !== recorded.rir);

  async function complete() {
    if (busy) return;
    setBusy(true);
    try {
      const rest: RestTimer | undefined = !recorded && kind === 'work' ? { startedAt: Date.now(), durationSec: restSec, label: effName } : undefined;
      await saveSet({
        id: idRef.current, exerciseSlot: slot, exerciseKey: effKey || exerciseKey(effName), exerciseName: effName, kind, setIndex: index,
        weightKg: parseNum(d.weight), reps: d.reps ? Math.round(Number(d.reps)) : null, rir: d.rir ? Number(d.rir) : null,
      }, rest);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`set-row ${recorded ? 'is-done' : ''} ${kind === 'warmup' ? 'warmup' : ''}`} data-testid={`set-${kind}-${index}`}>
      <span className="lbl">{label}{target ? <><br /><small>{target}</small></> : null}</span>
      <label>kg<input inputMode="decimal" value={d.weight} onChange={(e) => setD({ ...d, weight: e.target.value })} aria-label={`${label} kg`} /></label>
      <label>rip.<input inputMode="numeric" value={d.reps} onChange={(e) => setD({ ...d, reps: e.target.value.replace(/\D/g, '') })} aria-label={`${label} ripetizioni`} /></label>
      <label>RIR<select value={d.rir} onChange={(e) => setD({ ...d, rir: e.target.value })} aria-label={`${label} RIR`}>
        <option value="">–</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <div style={{ gridColumn: '1 / -1' }} className="row">
        {recorded ? (
          <>
            <span className="ok">✓ Registrata</span>
            <span className="row-start">
              {dirty && <button type="button" className="small-btn" disabled={busy} onClick={() => void complete()}>Aggiorna</button>}
              <button type="button" className="quiet small-btn" onClick={() => void deleteSet(recorded.id)} aria-label={`Annulla ${label}`}>Annulla</button>
            </span>
          </>
        ) : (
          <button type="button" className={primary && kind === 'work' ? 'primary' : 'wide'} disabled={busy || !d.reps} onClick={() => void complete()}>
            {kind === 'warmup' ? 'Registra riscaldamento' : 'Completa serie'}
          </button>
        )}
      </div>
    </div>
  );
}

function InlineForm({ label, initial, submit, onSubmit, onCancel, cancelLabel, multiline, allowEmpty, max = 300 }: {
  label: string; initial: string; submit: string; onSubmit: (v: string) => Promise<void>; onCancel?: () => void; cancelLabel?: string; multiline?: boolean; allowEmpty?: boolean; max?: number;
}) {
  const [v, setV] = useState(initial);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSubmit(v.trim()); }}>
      <label>{label}
        {multiline ? <textarea value={v} maxLength={max} onChange={(e) => setV(e.target.value)} /> : <input value={v} maxLength={120} onChange={(e) => setV(e.target.value)} />}
      </label>
      <div className="row-start">
        <button className="small-btn" disabled={!allowEmpty && !v.trim()}>{submit}</button>
        {onCancel && <button type="button" className="quiet" onClick={onCancel}>{cancelLabel}</button>}
      </div>
    </form>
  );
}

const DURATIONS = [60, 90, 120, 180, 240, 300];

/** Barra fissa: recupero calcolato sul tempo reale (Date.now − inizio), quindi corretto anche dopo cambio schermata o riapertura. */
function RestBar({ workout, onFinish }: { workout: LocalWorkout; onFinish: () => void }) {
  const [now, setNow] = useState(Date.now());
  const rest = workout.rest;
  const vibrated = useRef<number | null>(null);
  useEffect(() => {
    document.querySelector('.app')?.classList.add('with-timer');
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(t);
      document.querySelector('.app')?.classList.remove('with-timer');
    };
  }, []);
  const remaining = rest ? rest.durationSec - Math.floor((now - rest.startedAt) / 1000) : 0;
  useEffect(() => {
    if (rest && remaining <= 0 && vibrated.current !== rest.startedAt) {
      vibrated.current = rest.startedAt;
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [rest, remaining]);

  return (
    <div className="timerbar" data-testid="rest-bar">
      <div className="inner">
        {rest ? (
          <>
            <div className="row">
              <div>
                <small>Recupero · {rest.label}</small>
                <div className={`clock ${remaining <= 0 ? 'over' : ''}`} data-testid="rest-clock">{remaining > 0 ? formatRest(remaining) : `+${formatRest(-remaining)}`}</div>
              </div>
              <button type="button" onClick={() => void setRest(null)} data-testid="skip-rest">Salta recupero</button>
            </div>
            <div className="progress"><i style={{ width: `${Math.min(100, Math.max(0, (1 - remaining / rest.durationSec) * 100))}%` }} /></div>
            <div className="chips" role="group" aria-label="Durata recupero">
              {DURATIONS.map((s) => (
                <button key={s} type="button" aria-pressed={rest.durationSec === s} onClick={() => void setRest({ ...rest, durationSec: s })}>{formatRest(s)}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="row"><small>Nessun recupero in corso</small></div>
        )}
        <button type="button" className="wide small-btn" onClick={onFinish}>Termina allenamento</button>
      </div>
    </div>
  );
}

function FinishSheet({ open, workout, onClose, onDone }: { open: boolean; workout: LocalWorkout; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const summary = useMemo(() => {
    const work = workout.sets.filter((s) => s.kind === 'work');
    const skipped = workout.day.exercises.filter((e) => workout.exerciseStates[e.id]?.state === 'skipped');
    const missing = workout.day.exercises
      .filter((e) => workout.exerciseStates[e.id]?.state !== 'skipped')
      .map((e) => ({ name: slotExercise(workout, e.id).name, n: Math.max(0, plannedSetCount(e) - work.filter((s) => s.exerciseSlot === e.id).length) }))
      .filter((m) => m.n > 0);
    return { work: work.length, warm: workout.sets.length - work.length, skipped, missing };
  }, [workout]);

  return (
    <Sheet open={open} onClose={onClose} title="Termina allenamento">
      <div className="stack" data-testid="finish-summary">
        <div className="grid2">
          <div className="card"><small>Durata</small><div className="big">{fmtDuration(Date.now() - new Date(workout.startedAt).getTime())}</div></div>
          <div className="card"><small>Serie registrate</small><div className="big" data-testid="finish-sets">{summary.work}</div>{summary.warm > 0 && <small>+ {summary.warm} di riscaldamento</small>}</div>
        </div>
        {summary.skipped.length > 0 && <p><strong>Esercizi saltati:</strong> {summary.skipped.map((e) => e.name).join(', ')}</p>}
        {summary.missing.length > 0 && <p><strong>Serie mancanti:</strong> {summary.missing.map((m) => `${m.name} (${m.n})`).join(', ')}</p>}
        <label>Nota per il coach (facoltativa)<textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="primary" onClick={() => void finishWorkout(note).then(onDone)} data-testid="save-workout">Salva allenamento</button>
        <button onClick={onClose}>Torna alla seduta</button>
        {confirmDiscard ? (
          <div className="card stack">
            <p>Scartare la seduta? Le serie registrate verranno eliminate e la rotazione resterà a {workout.day.name}.</p>
            <div className="grid2">
              <button className="danger" onClick={() => void discardWorkout().then(onDone)}>Sì, scarta</button>
              <button onClick={() => setConfirmDiscard(false)}>Annulla</button>
            </div>
          </div>
        ) : (
          <button className="quiet" onClick={() => setConfirmDiscard(true)}>Scarta seduta</button>
        )}
      </div>
    </Sheet>
  );
}
