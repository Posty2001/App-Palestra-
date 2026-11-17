import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  defaultRestSeconds, exerciseKey, formatRest, plannedSetCount, workSetLabel,
  type ExerciseContextDto, type ExerciseSpec, type SetDto, type TodayBundleDto,
} from '@palestra/shared';
import { errorMessage, uuid } from '../lib/api';
import { useUser } from '../lib/auth';
import { fmtDuration, fmtSet, fmtShort, parseNum } from '../lib/format';
import { kvGet, kvSet } from '../lib/idb';
import { addStep, getStep, setStep, STEP_OPTIONS, type Step } from '../lib/prefs';
import { adjust, pause, remainingSec, REST_PRESETS, resume, setDuration, type RestTimer } from '../lib/rest';
import { beep, unlockAudio } from '../lib/sound';
import { enqueue } from '../lib/sync';
import {
  bundleKey, deleteSet, discardWorkout, finishWorkout, saveSet, setExerciseState, setRest, slotExercise, useActiveWorkout,
  type LocalWorkout,
} from '../lib/workoutStore';
import { ErrorText, Sheet, SyncBadge } from '../components/ui';
import { Icon } from '../components/icons';

type Contexts = Record<string, ExerciseContextDto>;
type SheetKind = null | 'actions' | 'chat' | 'rest' | 'finish';
interface Target { kind: 'work' | 'warmup'; index: number }
interface Draft { weight: string; reps: string; rir: number | null }

const emptyCtx = (key: string): ExerciseContextDto => ({ exerciseKey: key, lastSets: [], lastDate: null, machineSetup: null, feedback: [], questions: [] });
const fmtKgInput = (n: number | null | undefined): string => (n === null || n === undefined ? '' : n.toLocaleString('it-IT', { maximumFractionDigits: 2, useGrouping: false }));

function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [active, ms]);
  return now;
}

export function WorkoutPage() {
  const user = useUser();
  const nav = useNavigate();
  const { workout, loaded } = useActiveWorkout();
  const [contexts, setContexts] = useState<Contexts>({});
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [extraWork, setExtraWork] = useState<Record<string, number>>({});
  const [warmPending, setWarmPending] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft>({ weight: '', reps: '', rir: null });
  const [draftKey, setDraftKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new Map<string, string>());
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    void kvGet<TodayBundleDto>(bundleKey(user.id)).then((b) => setContexts(b?.contexts ?? {}));
  }, [user.id]);

  const updateContext = useCallback(async (key: string, patch: Partial<ExerciseContextDto>) => {
    setContexts((c) => ({ ...c, [key]: { ...(c[key] ?? emptyCtx(key)), ...patch } }));
    const b = await kvGet<TodayBundleDto>(bundleKey(user.id));
    if (b) {
      b.contexts[key] = { ...(b.contexts[key] ?? emptyCtx(key)), ...patch };
      await kvSet(bundleKey(user.id), b);
    }
  }, [user.id]);

  // ---- stato derivato per esercizio ----
  const info = useMemo(() => {
    if (!workout) return new Map<string, { planned: number; work: SetDto[]; warm: SetDto[]; target: Target | null; skipped: boolean; done: boolean }>();
    const m = new Map<string, { planned: number; work: SetDto[]; warm: SetDto[]; target: Target | null; skipped: boolean; done: boolean }>();
    for (const ex of workout.day.exercises) {
      const mine = workout.sets.filter((s) => s.exerciseSlot === ex.id);
      const work = mine.filter((s) => s.kind === 'work').sort((a, b) => a.setIndex - b.setIndex);
      const warm = mine.filter((s) => s.kind === 'warmup').sort((a, b) => a.setIndex - b.setIndex);
      const skipped = workout.exerciseStates[ex.id]?.state === 'skipped';
      const planned = Math.max(plannedSetCount(ex), work.length ? Math.max(...work.map((s) => s.setIndex)) + 1 : 0) + (extraWork[ex.id] ?? 0);
      let target: Target | null = null;
      if (!skipped) {
        if ((warmPending[ex.id] ?? 0) > 0) target = { kind: 'warmup', index: warm.length ? Math.max(...warm.map((s) => s.setIndex)) + 1 : 0 };
        else {
          const i = Array.from({ length: planned }, (_, k) => k).find((k) => !work.some((s) => s.setIndex === k));
          if (i !== undefined) target = { kind: 'work', index: i };
        }
      }
      m.set(ex.id, { planned, work, warm, target, skipped, done: !skipped && work.length >= plannedSetCount(ex) });
    }
    return m;
  }, [workout, extraWork, warmPending]);

  // Esercizio aperto di default: il primo non completato (deciso già al primo render, senza sfarfallio).
  if (workout && !(open && workout.day.exercises.some((e) => e.id === open))) {
    const first = workout.day.exercises.find((e) => { const i = info.get(e.id); return i && !i.done && !i.skipped; });
    const id = first?.id ?? workout.day.exercises[0]?.id ?? null;
    if (id !== open) setOpen(id);
  }

  const openEx = workout?.day.exercises.find((e) => e.id === open);
  const openInfo = open ? info.get(open) : undefined;
  const eff = workout && openEx ? slotExercise(workout, openEx.id) : null;
  const ctx = eff ? contexts[eff.key] : undefined;
  const lastWork = (ctx?.lastSets ?? []).filter((s) => s.kind === 'work').sort((a, b) => a.setIndex - b.setIndex);
  const target = openInfo?.target ?? null;
  const tKey = open && target ? `${open}:${target.kind}:${target.index}` : '';

  // Precompilazione dalla serie corrispondente dell'ultima seduta. Calcolata durante il render (stato derivato):
  // nessuna finestra in cui un effetto successivo possa sovrascrivere ciò che l'atleta ha già digitato.
  if (tKey && tKey !== draftKey && target) {
    const prev = target.kind === 'work' ? lastWork.find((s) => s.setIndex === target.index) ?? lastWork[target.index] : undefined;
    setDraftKey(tKey);
    setDraft({ weight: fmtKgInput(prev?.weightKg), reps: prev?.reps?.toString() ?? '', rir: null });
  }

  const rest = workout?.rest ?? null;
  const now = useNow(!!rest || !!workout);
  const remaining = rest ? remainingSec(rest, now) : 0;
  const notified = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!rest || rest.pausedAt) return;
    if (remaining <= 0 && notified.current !== rest.startedAt) {
      notified.current = rest.startedAt;
      // Avviso solo se il recupero è appena terminato con l'app aperta (niente suoni "arretrati" alla riapertura).
      if (remaining > -3) {
        beep();
        navigator.vibrate?.([180, 80, 180]);
        setFlash(true);
        setTimeout(() => setFlash(false), 3200);
      }
    }
  }, [rest, remaining]);

  if (!loaded) return null;
  if (!workout) return <Navigate to="/" replace />;

  function focusExercise(slot: string) {
    setOpen(slot);
    requestAnimationFrame(() => cardRefs.current.get(slot)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function nextIncomplete(after: string | null): string | null {
    const list = workout!.day.exercises;
    const start = after ? list.findIndex((e) => e.id === after) + 1 : 0;
    const order = [...list.slice(start), ...list.slice(0, start)];
    return order.find((e) => { const i = info.get(e.id); return i && !i.skipped && i.target; })?.id ?? null;
  }

  async function complete() {
    if (!openEx || !eff || !target || busy) return;
    unlockAudio();
    const reps = draft.reps ? Math.round(Number(draft.reps)) : null;
    if (reps === null || !Number.isFinite(reps)) return setError('Inserisci le ripetizioni');
    setBusy(true);
    setError(null);
    try {
      let id = ids.current.get(tKey);
      if (!id) {
        id = uuid();
        ids.current.set(tKey, id); // id stabile: un doppio tocco non crea due serie
      }
      const r: RestTimer | undefined = target.kind === 'work' ? { startedAt: Date.now(), durationSec: defaultRestSeconds(openEx), label: eff.name } : undefined;
      await saveSet({
        id, exerciseSlot: openEx.id, exerciseKey: eff.key || exerciseKey(eff.name), exerciseName: eff.name, kind: target.kind, setIndex: target.index,
        weightKg: parseNum(draft.weight), reps, rir: draft.rir,
      }, r);
      if (target.kind === 'warmup') setWarmPending((w) => ({ ...w, [openEx.id]: Math.max(0, (w[openEx.id] ?? 1) - 1) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const workCount = workout.sets.filter((s) => s.kind === 'work').length;
  const exList = workout.day.exercises;
  const openIdx = exList.findIndex((e) => e.id === open);
  const nextId = nextIncomplete(open);
  const dockLabel = target
    ? target.kind === 'warmup' ? `Registra riscaldamento ${target.index + 1}` : `Completa serie ${target.index + 1}`
    : nextId ? 'Prossimo esercizio' : 'Termina allenamento';

  return (
    <div className="session">
      <header className="session-top">
        <div className="row">
          <Link to="/" className="btn icon-btn" aria-label="Lascia in sospeso e torna a Oggi" data-testid="suspend"><Icon name="left" /></Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 26 }}>{workout.day.name}</h1>
            <p className="muted" style={{ fontSize: 14 }}>{fmtDuration(now - new Date(workout.startedAt).getTime())} · {workCount} serie · <SyncBadge /></p>
          </div>
          <button type="button" className="small-btn" onClick={() => setSheet('finish')} data-testid="finish-open">Termina</button>
        </div>
        <nav className="exnav" aria-label="Esercizi della seduta">
          {exList.map((ex, i) => {
            const st = info.get(ex.id);
            const name = slotExercise(workout, ex.id).name;
            const cls = st?.skipped ? 'skipped' : st?.done ? 'done' : '';
            return (
              <button key={ex.id} type="button" className={cls} aria-current={ex.id === open ? 'step' : undefined}
                aria-label={`${i + 1} ${name}${st?.done ? ', completato' : st?.skipped ? ', saltato' : ''}`} onClick={() => focusExercise(ex.id)} data-testid={`exnav-${i}`}>
                {st?.done && ex.id !== open ? <Icon name="check" size={18} /> : i + 1}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="page" style={{ paddingTop: 12 }} data-testid="session-list">
        {exList.map((ex, i) => {
          const st = info.get(ex.id)!;
          const e = slotExercise(workout, ex.id);
          const setRef = (el: HTMLElement | null) => { if (el) cardRefs.current.set(ex.id, el); };
          if (ex.id !== open) {
            return (
              <div key={ex.id} ref={setRef} data-testid={`exercise-${e.key}`}>
                <button type="button" className={`ex-row ${st.done || st.skipped ? 'done' : ''}`} onClick={() => focusExercise(ex.id)} aria-expanded="false">
                  <span style={{ flex: 1, minWidth: 0 }}>{i + 1} · {e.name}{st.skipped && <span className="muted"> · saltato</span>}</span>
                  <span className={st.done ? 'ok' : 'muted'} style={{ fontSize: 14 }}>{st.done ? `${st.work.length}/${plannedSetCount(ex)}` : `${ex.setsRaw.split(' ')[0]} × ${ex.repsRaw.split(/[ ;(]/)[0]}`}</span>
                </button>
              </div>
            );
          }
          return (
            <section key={ex.id} ref={setRef} className="ex-active" data-testid={`exercise-${e.key}`} aria-label={e.name}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="cap" style={{ color: 'var(--pri-ink)' }}>Esercizio {i + 1} di {exList.length}</p>
                  <h2 className="title-n" style={{ fontSize: 22, marginTop: 4, lineHeight: 1.2 }}>{e.name}</h2>
                  {e.substituted && <p className="muted">al posto di {ex.name}</p>}
                  <p className="muted" style={{ fontSize: 15, marginTop: 2 }}>{ex.setsRaw} · {ex.repsRaw}{ex.restRaw ? ` · rec ${ex.restRaw}` : ''}</p>
                </div>
                <button type="button" className="icon-btn" style={{ border: 0 }} aria-label="Azioni esercizio" onClick={() => setSheet('actions')} data-testid="exercise-menu"><Icon name="more" /></button>
              </div>

              <button type="button" className="inset" onClick={() => setSheet('chat')} style={{ display: 'grid', gap: 2, textAlign: 'left', border: 0, minHeight: 0, padding: '10px 12px', fontSize: 14, fontWeight: 500 }} data-testid="last-time">
                <span className="row"><span className="muted">Ultima volta{ctx?.lastDate ? ` · ${fmtShort(ctx.lastDate)}` : ''}</span>
                  <span className="num" style={{ fontWeight: 600 }}>{lastWork.length ? lastWork.map((s) => `${fmtKgInput(s.weightKg) || '—'}×${s.reps ?? '—'}`).join(' · ') : 'nessuno storico'}</span></span>
                {ctx?.machineSetup && <span className="muted" data-testid="machine-setup">Assetto: {ctx.machineSetup}</span>}
                {ctx?.feedback[0] && <span style={{ color: 'var(--pri-ink)' }} data-testid="exercise-feedback">Coach: {ctx.feedback[0].body}</span>}
                {ctx?.questions.find((q) => q.answer) && <span className="sub">Risposta: {ctx.questions.find((q) => q.answer)?.answer}</span>}
              </button>
              {ex.notes && <p className="muted">Nota: {ex.notes}</p>}

              {st.skipped ? (
                <div className="stack">
                  <p className="muted">Esercizio saltato.</p>
                  <button type="button" onClick={() => void setExerciseState(ex.id, null)}>Ripristina esercizio</button>
                </div>
              ) : (
                <>
                  {[...st.warm, ...st.work].map((s) => (
                    <RecordedSet key={s.id} set={s} ex={ex} userId={user.id} exKey={e.key} />
                  ))}
                  {target ? (
                    <SetEditor
                      label={target.kind === 'warmup' ? `Riscald. ${target.index + 1}` : target.index < plannedSetCount(ex) ? workSetLabel(ex, target.index).label : `Extra ${target.index - plannedSetCount(ex) + 1}`}
                      goal={target.kind === 'work' && target.index < plannedSetCount(ex) ? workSetLabel(ex, target.index).target : ''}
                      draft={draft} onChange={setDraft} step={getStep(user.id, e.key)} warm={target.kind === 'warmup'}
                    />
                  ) : (
                    <p className="ok" style={{ fontWeight: 600 }}>Esercizio completato</p>
                  )}
                  <div className="row-start">
                    <button type="button" className="quiet" onClick={() => setWarmPending((w) => ({ ...w, [ex.id]: (w[ex.id] ?? 0) + 1 }))} data-testid="add-warmup">+ Riscaldamento</button>
                    <button type="button" className="quiet" onClick={() => setExtraWork((x) => ({ ...x, [ex.id]: (x[ex.id] ?? 0) + 1 }))}>+ Serie</button>
                  </div>
                </>
              )}
            </section>
          );
        })}
        <ErrorText error={error} />
      </main>

      <div className="dock">
        <div className="inner">
          {rest && (
            <div className={`rest-mini ${remaining <= 0 ? 'over' : ''} ${flash ? 'flash' : ''}`} data-testid="rest-bar">
              <button type="button" onClick={() => setSheet('rest')} data-testid="rest-open"
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 0, padding: 0, minHeight: 50, justifyContent: 'flex-start' }}
                aria-label={`Recupero ${rest.pausedAt ? 'in pausa' : 'in corso'}, ${remaining > 0 ? formatRest(remaining) : 'terminato'}. Apri il timer`}>
                <RestRing rest={rest} remaining={remaining} size={26} />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 500 }} className={remaining <= 0 ? 'ok' : 'muted'}>{remaining <= 0 ? 'Recupero finito' : rest.pausedAt ? 'In pausa' : `Recupero · ${rest.label}`}</span>
                <span className="d" data-testid="rest-clock">{remaining > 0 ? formatRest(remaining) : `+${formatRest(-remaining)}`}</span>
              </button>
              <button type="button" className="small-btn quiet" data-testid="skip-rest" onClick={() => void setRest(null)}>Salta</button>
            </div>
          )}
          <button type="button" className="primary big" disabled={busy || (!!target && !draft.reps)} data-testid="complete-set"
            onClick={() => {
              if (target) void complete();
              else if (nextId) focusExercise(nextId);
              else setSheet('finish');
            }}>
            {dockLabel}
          </button>
        </div>
      </div>

      {openEx && eff && (
        <ActionsSheet open={sheet === 'actions'} onClose={() => setSheet(null)} workout={workout} ex={openEx} exIndex={openIdx} userId={user.id}
          ctx={ctx} hasCoach={!!user.coach} updateContext={updateContext}
          onWarmup={() => setWarmPending((w) => ({ ...w, [openEx.id]: (w[openEx.id] ?? 0) + 1 }))}
          onExtra={() => setExtraWork((x) => ({ ...x, [openEx.id]: (x[openEx.id] ?? 0) + 1 }))}
          onChat={() => setSheet('chat')} />
      )}
      {openEx && eff && (
        <ChatSheet open={sheet === 'chat'} onClose={() => setSheet(null)} name={eff.name} exKey={eff.key} ctx={ctx} hasCoach={!!user.coach}
          coachName={user.coach?.displayName ?? null} athleteId={workout.athleteId} updateContext={updateContext} />
      )}
      {rest && <RestSheet open={sheet === 'rest'} onClose={() => setSheet(null)} rest={rest} remaining={remaining} next={target && eff ? `${eff.name} · ${dockLabel.replace(/^Completa /, '')}` : null} />}
      <FinishSheet open={sheet === 'finish'} workout={workout} onClose={() => setSheet(null)} onDone={() => nav('/', { replace: true })} />
    </div>
  );
}

function RestRing({ rest, remaining, size }: { rest: RestTimer; remaining: number; size: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const frac = rest.durationSec > 0 ? Math.min(1, Math.max(0, 1 - remaining / rest.durationSec)) : 1;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#30343d" strokeWidth={size > 60 ? 10 : 3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={remaining <= 0 ? '#35c58b' : '#ff5265'} strokeWidth={size > 60 ? 10 : 3} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function NumberField({ id, label, aria, value, onChange, onStep, decimal }: {
  id: string; label: string; aria: string; value: string; onChange: (v: string) => void; onStep: (dir: 1 | -1) => void; decimal: boolean;
}) {
  return (
    <div className="numfield">
      <label htmlFor={id} className="cap">{label}</label>
      <input id={id} value={value} inputMode={decimal ? 'decimal' : 'numeric'} enterKeyHint="done" autoComplete="off" aria-label={aria}
        onChange={(e) => onChange(decimal ? e.target.value.replace(/[^\d.,]/g, '') : e.target.value.replace(/\D/g, ''))}
        onFocus={(e) => e.currentTarget.select()} />
      <div className="steps">
        <button type="button" aria-label={`Diminuisci ${aria}`} onClick={() => onStep(-1)}>−</button>
        <button type="button" aria-label={`Aumenta ${aria}`} onClick={() => onStep(1)}>+</button>
      </div>
    </div>
  );
}

function SetEditor({ label, goal, draft, onChange, step, warm }: { label: string; goal: string; draft: Draft; onChange: (d: Draft) => void; step: number; warm: boolean }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 10 }} data-testid="set-editor">
      <div className="row"><strong className={warm ? 'warn' : ''}>{label}</strong>{goal && <span className="muted">obiettivo {goal}</span>}</div>
      <div className="grid2">
        <NumberField id="kg" label="kg" aria={`${label} kg`} decimal value={draft.weight} onChange={(v) => onChange({ ...draft, weight: v })}
          onStep={(d) => onChange({ ...draft, weight: fmtKgInput(addStep(parseNum(draft.weight), d * step)) })} />
        <NumberField id="reps" label="Ripetizioni" aria={`${label} ripetizioni`} decimal={false} value={draft.reps} onChange={(v) => onChange({ ...draft, reps: v })}
          onStep={(d) => onChange({ ...draft, reps: String(Math.max(0, (Number(draft.reps) || 0) + d)) })} />
      </div>
      {!warm && (
        <div className="rir" role="group" aria-label="RIR facoltativo">
          <span className="muted" style={{ width: 34 }}>RIR</span>
          {[0, 1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={draft.rir === n} onClick={() => onChange({ ...draft, rir: draft.rir === n ? null : n })} aria-label={`RIR ${n}${n === 4 ? ' o più' : ''}`}>{n === 4 ? '4+' : n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Serie già registrata: riga compatta, tocco → modifica o annulla. */
function RecordedSet({ set, ex, userId, exKey }: { set: SetDto; ex: ExerciseSpec; userId: string; exKey: string }) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>({ weight: fmtKgInput(set.weightKg), reps: set.reps?.toString() ?? '', rir: set.rir });
  const label = set.kind === 'warmup' ? `Riscald. ${set.setIndex + 1}` : set.setIndex < plannedSetCount(ex) ? workSetLabel(ex, set.setIndex).label : `Extra ${set.setIndex - plannedSetCount(ex) + 1}`;
  if (!editing) {
    return (
      <button type="button" className="set-line" onClick={() => { setD({ weight: fmtKgInput(set.weightKg), reps: set.reps?.toString() ?? '', rir: set.rir }); setEditing(true); }}
        data-testid={`set-done-${set.kind}-${set.setIndex}`} aria-label={`${label} registrata: ${fmtSet(set)}. Tocca per modificare`}>
        <span className={`check-dot ${set.kind === 'warmup' ? 'warm' : ''}`}><Icon name="check" size={15} /></span>
        <span className="muted" style={{ flex: 1 }}>{label}</span>
        <span className="num" style={{ fontWeight: 600 }}>{fmtKgInput(set.weightKg) || '—'} × {set.reps ?? '—'}{set.rir !== null ? ` · RIR ${set.rir}` : ''}</span>
        <span className="muted" style={{ fontSize: 14 }}>Modifica</span>
      </button>
    );
  }
  return (
    <div className="inset stack">
      <SetEditor label={label} goal="" draft={d} onChange={setD} step={getStep(userId, exKey)} warm={set.kind === 'warmup'} />
      <div className="grid3">
        <button type="button" className="small-btn" onClick={() => setEditing(false)}>Chiudi</button>
        <button type="button" className="small-btn danger" onClick={() => void deleteSet(set.id)}>Annulla serie</button>
        <button type="button" className="small-btn light" disabled={!d.reps} onClick={() => {
          void saveSet({ id: set.id, exerciseSlot: set.exerciseSlot, exerciseKey: set.exerciseKey, exerciseName: set.exerciseName, kind: set.kind, setIndex: set.setIndex,
            weightKg: parseNum(d.weight), reps: Number(d.reps), rir: d.rir }).then(() => setEditing(false));
        }}>Aggiorna</button>
      </div>
    </div>
  );
}

function ActionsSheet({ open, onClose, workout, ex, exIndex, userId, ctx, hasCoach, updateContext, onWarmup, onExtra, onChat }: {
  open: boolean; onClose: () => void; workout: LocalWorkout; ex: ExerciseSpec; exIndex: number; userId: string; ctx: ExerciseContextDto | undefined; hasCoach: boolean;
  updateContext: (key: string, patch: Partial<ExerciseContextDto>) => Promise<void>; onWarmup: () => void; onExtra: () => void; onChat: () => void;
}) {
  const eff = slotExercise(workout, ex.id);
  const skipped = workout.exerciseStates[ex.id]?.state === 'skipped';
  const [panel, setPanel] = useState<null | 'swap' | 'setup' | 'step'>(null);
  const [text, setText] = useState('');
  const [step, setStepState] = useState<Step>(() => getStep(userId, eff.key));
  useEffect(() => {
    if (open) {
      setPanel(null);
      setStepState(getStep(userId, eff.key));
    }
  }, [open, userId, eff.key]);
  const close = () => { setPanel(null); onClose(); };

  return (
    <Sheet open={open} onClose={close} title={eff.name} kicker={`Esercizio ${exIndex + 1}`} testId="actions-sheet">
      {panel === 'swap' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void setExerciseState(ex.id, { state: 'substituted', name: text.trim() }).then(close); }}>
          <label>Esercizio eseguito al suo posto<input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} autoFocus /></label>
          <button className="primary" disabled={!text.trim()}>Sostituisci</button>
          {eff.substituted && <button type="button" onClick={() => void setExerciseState(ex.id, null).then(close)}>Torna a {ex.name}</button>}
        </form>
      ) : panel === 'setup' ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          void enqueue({ method: 'PUT', path: `/exercise-notes/${encodeURIComponent(eff.key)}`, body: { machineSetup: v }, workoutId: null })
            .then(() => updateContext(eff.key, { machineSetup: v || null })).then(close);
        }}>
          <label>Assetto macchina (es. sedile 4, schienale 2)<textarea value={text} maxLength={300} onChange={(e) => setText(e.target.value)} autoFocus /></label>
          <button className="primary">Salva assetto</button>
        </form>
      ) : panel === 'step' ? (
        <div className="stack">
          <p className="muted">Passo dei pulsanti − e + per {eff.name}. Il valore resta sempre digitabile a mano.</p>
          <div className="grid2" role="group" aria-label="Passo in kg">
            {STEP_OPTIONS.map((s) => (
              <button key={s} type="button" className="pill tint" style={{ borderRadius: 12 }} aria-pressed={step === s} onClick={() => { setStep(userId, eff.key, s); setStepState(s); close(); }}>
                {s.toLocaleString('it-IT')} kg
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {!skipped && <MenuItem icon="plus" title="Aggiungi riscaldamento" sub="Resta nello storico, non conta nei record" onClick={() => { onWarmup(); close(); }} />}
          {!skipped && <MenuItem icon="plus" title="Aggiungi serie extra" onClick={() => { onExtra(); close(); }} />}
          <MenuItem icon="swap" title={eff.substituted ? 'Cambia sostituzione' : 'Sostituisci esercizio'} sub={eff.substituted ? `Ora: ${eff.name}` : 'Registra quello eseguito davvero'} onClick={() => { setText(eff.substituted ? eff.name : ''); setPanel('swap'); }} />
          <MenuItem icon="sliders" title="Assetto macchina" sub={ctx?.machineSetup ?? 'Nessuna nota'} onClick={() => { setText(ctx?.machineSetup ?? ''); setPanel('setup'); }} />
          <MenuItem icon="sliders" title="Passo dei pulsanti ±" sub={`Ora ${step.toLocaleString('it-IT')} kg`} onClick={() => setPanel('step')} />
          {hasCoach && <MenuItem icon="chat" title="Chiedi al coach" sub={`${ctx?.questions.length ?? 0} domande · ${ctx?.feedback.length ?? 0} indicazioni`} onClick={() => { onClose(); onChat(); }} />}
          {skipped
            ? <MenuItem icon="skip" title="Ripristina esercizio" onClick={() => void setExerciseState(ex.id, null).then(close)} />
            : <MenuItem icon="skip" title="Salta esercizio" sub="Si può ripristinare" danger onClick={() => void setExerciseState(ex.id, { state: 'skipped' }).then(close)} />}
        </div>
      )}
    </Sheet>
  );
}

function MenuItem({ icon, title, sub, onClick, danger }: { icon: 'plus' | 'swap' | 'sliders' | 'chat' | 'skip'; title: string; sub?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className="menu-item" onClick={onClick} style={danger ? { color: 'var(--pri-ink)' } : undefined}>
      <span className="ic" style={danger ? { color: 'var(--pri-ink)' } : undefined}><Icon name={icon} /></span>
      <span style={{ flex: 1 }}>{title}{sub && <small className="muted">{sub}</small>}</span>
    </button>
  );
}

/** Domande e indicazioni come conversazione: riusa domande/risposte/feedback esistenti (nessuna chat in tempo reale). */
function ChatSheet({ open, onClose, name, exKey, ctx, hasCoach, coachName, athleteId, updateContext }: {
  open: boolean; onClose: () => void; name: string; exKey: string; ctx: ExerciseContextDto | undefined; hasCoach: boolean; coachName: string | null; athleteId: string;
  updateContext: (key: string, patch: Partial<ExerciseContextDto>) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const items = [
    ...(ctx?.questions ?? []).flatMap((q) => [
      { id: `q${q.id}`, at: q.createdAt, who: 'out' as const, meta: `Tu · ${fmtShort(q.createdAt)}`, body: q.body, pending: !q.answer },
      ...(q.answer && q.answeredAt ? [{ id: `a${q.id}`, at: q.answeredAt, who: 'in' as const, meta: `Coach · ${fmtShort(q.answeredAt)}`, body: q.answer, pending: false }] : []),
    ]),
    ...(ctx?.feedback ?? []).map((f) => ({ id: `f${f.id}`, at: f.createdAt, who: 'note' as const, meta: `Indicazione · ${fmtShort(f.createdAt)}`, body: f.body, pending: false })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  async function send() {
    const body = text.trim();
    if (!body) return;
    const id = uuid();
    await enqueue({ method: 'PUT', path: `/questions/${id}`, body: { exerciseName: name, body }, workoutId: null });
    await updateContext(exKey, { questions: [...(ctx?.questions ?? []), { id, athleteId, exerciseKey: exKey, exerciseName: name, body, answer: null, answeredAt: null, createdAt: new Date().toISOString(), context: null }] });
    setText('');
  }

  return (
    <Sheet open={open} onClose={onClose} title={name} kicker={coachName ?? 'Coach'} testId="chat-sheet">
      <div className="thread" aria-live="polite">
        {items.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Nessuna domanda o indicazione su questo esercizio.</p>}
        {items.map((m) => (
          <div key={m.id} className={`bubble ${m.who === 'out' ? 'out' : 'in'} ${m.who === 'note' ? 'note' : ''}`}>
            <span className="meta" style={m.who === 'note' ? { color: 'var(--pri-ink)' } : undefined}>{m.meta}</span>{m.body}
            {m.pending && <span className="meta" style={{ marginTop: 4 }}>In attesa di risposta</span>}
          </div>
        ))}
      </div>
      {hasCoach ? (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea value={text} maxLength={500} placeholder="Domanda breve al coach" aria-label={`Domanda breve su ${name}`} onChange={(e) => setText(e.target.value)} />
          <button className="primary" style={{ width: 'auto' }} disabled={!text.trim()}>Invia</button>
        </form>
      ) : <p className="muted">Collegati a un coach per fare domande.</p>}
    </Sheet>
  );
}

function RestSheet({ open, onClose, rest, remaining, next }: { open: boolean; onClose: () => void; rest: RestTimer; remaining: number; next: string | null }) {
  const paused = !!rest.pausedAt;
  return (
    <Sheet open={open} onClose={onClose} title="Recupero" kicker={rest.label} testId="rest-sheet">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', width: 250, height: 250, display: 'grid', placeItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0 }}><RestRing rest={rest} remaining={remaining} size={250} /></div>
          <div style={{ textAlign: 'center' }}>
            <p className={`d timer-big ${remaining <= 0 ? 'timer-over' : ''}`} data-testid="rest-sheet-clock">{remaining > 0 ? formatRest(remaining) : `+${formatRest(-remaining)}`}</p>
            <p className="muted" style={{ marginTop: 6 }}>{paused ? 'In pausa' : remaining <= 0 ? 'Recupero finito' : `su ${formatRest(rest.durationSec)}`}</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 1fr', gap: 12, width: '100%', alignItems: 'center' }}>
          <button type="button" onClick={() => void setRest(adjust(rest, -15))}>−15 s</button>
          <button type="button" className="light" style={{ width: 72, height: 72, borderRadius: '50%', padding: 0 }} aria-label={paused ? 'Riprendi' : 'Metti in pausa'} data-testid="rest-pause"
            onClick={() => void setRest(paused ? resume(rest, Date.now()) : pause(rest, Date.now()))}>
            {paused
              ? <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>
              : <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>}
          </button>
          <button type="button" onClick={() => void setRest(adjust(rest, 15))}>+15 s</button>
        </div>
        <div role="group" aria-label="Durata recupero" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6, width: '100%' }}>
          {REST_PRESETS.map((s) => (
            <button key={s} type="button" className="pill tint" style={{ padding: 0 }} aria-pressed={rest.durationSec === s} onClick={() => void setRest(setDuration(rest, s))}>{formatRest(s)}</button>
          ))}
        </div>
        <button type="button" className="wide" onClick={() => { void setRest(null); onClose(); }} data-testid="rest-sheet-skip">Salta recupero</button>
        {next && <p className="muted">Poi: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{next}</span></p>}
      </div>
    </Sheet>
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
    const doneEx = workout.day.exercises.filter((e) => work.some((s) => s.exerciseSlot === e.id)).length;
    return { work: work.length, warm: workout.sets.length - work.length, skipped, missing, doneEx };
  }, [workout]);

  return (
    <Sheet open={open} onClose={onClose} title="Termina allenamento" kicker={`${workout.day.name} · ${workout.programName ?? ''}`} testId="finish-summary">
      <div className="grid3">
        <div className="kpi"><span className="cap">Durata</span><span className="d">{fmtDuration(Date.now() - new Date(workout.startedAt).getTime()).replace(' min', '′')}</span></div>
        <div className="kpi"><span className="cap">Serie</span><span className="d" data-testid="finish-sets">{summary.work}</span>{summary.warm > 0 && <small>+ {summary.warm} di riscaldamento</small>}</div>
        <div className="kpi"><span className="cap">Esercizi</span><span className="d">{summary.doneEx}/{workout.day.exercises.length}</span></div>
      </div>
      {(summary.skipped.length > 0 || summary.missing.length > 0) && (
        <div className="card tight">
          {summary.skipped.map((e) => <div key={e.id} className="list-row"><span className="spacer">{slotExercise(workout, e.id).name}</span><span className="warn" style={{ fontSize: 14 }}>saltato</span></div>)}
          {summary.missing.map((m) => <div key={m.name} className="list-row"><span className="spacer">{m.name}</span><span className="warn" style={{ fontSize: 14 }}>{m.n === 1 ? '1 serie mancante' : `${m.n} serie mancanti`}</span></div>)}
        </div>
      )}
      <label>Nota per il coach (facoltativa)<textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Com'è andata?" /></label>
      <button className="primary big" onClick={() => void finishWorkout(note).then(onDone)} data-testid="save-workout">Salva allenamento</button>
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
    </Sheet>
  );
}
