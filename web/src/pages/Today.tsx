import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProgramSummaryDto } from '@palestra/shared';
import { errorMessage, post } from '../lib/api';
import { useUser } from '../lib/auth';
import { daysUntil, fmtShort, periodLabel } from '../lib/format';
import { useBundle } from '../lib/hooks';
import { startWorkout, useActiveWorkout } from '../lib/workoutStore';
import { ErrorText, Loading, TopBar } from '../components/ui';
import { Icon } from '../components/icons';

const selKey = (uid: string) => `selectedProgram:${uid}`;
function readSel(uid: string): string | null {
  try {
    return localStorage.getItem(selKey(uid));
  } catch {
    return null;
  }
}

const today = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

export function TodayPage() {
  const user = useUser();
  const nav = useNavigate();
  const { bundle, offline, reload } = useBundle(user.id);
  const { workout } = useActiveWorkout();
  const [selected, setSelected] = useState<string | null>(() => readSel(user.id));
  const [dayOverride, setDayOverride] = useState<number | null>(null);
  const [pickDay, setPickDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const programs = bundle?.programs ?? [];
  const program: ProgramSummaryDto | undefined = programs.find((p) => p.id === selected) ?? programs[0];
  useEffect(() => setDayOverride(null), [program?.id]);
  const dayIndex = dayOverride ?? program?.nextDayIndex ?? 0;
  const day = program?.content.days[dayIndex];
  const totalSets = day?.exercises.reduce((n, e) => n + (e.sets ?? 1), 0) ?? 0;

  const lastFeedback = useMemo(() => {
    const all = Object.values(bundle?.contexts ?? {}).flatMap((c) => [
      ...c.feedback.map((f) => ({ name: c.exerciseKey, text: f.body, at: f.createdAt, kind: 'Indicazione' })),
      ...c.questions.filter((q) => q.answer && q.answeredAt).map((q) => ({ name: q.exerciseName, text: q.answer as string, at: q.answeredAt as string, kind: 'Risposta' })),
    ]);
    return all.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  }, [bundle]);

  function choose(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(selKey(user.id), id);
    } catch {
      /* preferenza non essenziale */
    }
  }

  async function begin() {
    if (!program) return;
    setBusy(true);
    setError(null);
    try {
      await startWorkout(program, dayIndex);
      nav('/seduta');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function ack(p: ProgramSummaryDto) {
    try {
      await post(`/programs/${p.id}/seen`);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const exp = program?.endDate ? daysUntil(program.endDate) : null;

  return (
    <>
      <TopBar title="Oggi" kicker={today} />
      <main className="page">
        {offline && <p className="tag warn" style={{ justifySelf: 'start' }}>Offline · dati dell'ultimo aggiornamento</p>}
        {programs.filter((p) => p.unseenChange).map((p) => (
          <div key={p.id} className="card accent stack" data-testid="program-update">
            <strong>{p.name} aggiornata · versione {p.unseenChange?.versionNo}</strong>
            <p className="sub" style={{ whiteSpace: 'pre-line', fontSize: 15 }}>{p.unseenChange?.summary ?? 'Modifiche del coach'}</p>
            <div className="row"><small>Vale dalla prossima seduta</small><button className="small-btn" onClick={() => void ack(p)}>Ho letto</button></div>
          </div>
        ))}

        {workout ? (
          <section className="card hero">
            <span className="muted">In sospeso · iniziato alle {new Date(workout.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
            <div>
              <h2 className="d" style={{ fontSize: 56 }}>{workout.day.name}</h2>
              <p className="muted" style={{ marginTop: 8 }}>{workout.programName} · {workout.sets.filter((s) => s.kind === 'work').length} serie registrate</p>
            </div>
            <button className="primary big" onClick={() => nav('/seduta')}>Riprendi allenamento</button>
          </section>
        ) : !bundle ? (
          <div className="card hero"><Loading /></div>
        ) : !program ? (
          <div className="card hero">
            <p>Nessuna scheda disponibile.</p>
            <Link to="/scheda" className="btn">Crea o importa una scheda</Link>
          </div>
        ) : (
          <section className="card hero">
            <div className="row">
              {programs.length > 1 ? (
                <label style={{ flex: 1 }}>
                  <span className="cap">Scheda</span>
                  <select value={program.id} onChange={(e) => choose(e.target.value)} data-testid="program-select" style={{ minHeight: 44 }}>
                    {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              ) : <span className="muted">{program.name} · v{program.versionNo}</span>}
              {periodLabel(program.startDate, program.endDate) && (
                <span className={`tag ${exp !== null && exp <= 7 ? 'warn' : ''}`} style={{ alignSelf: 'flex-end' }}>{exp !== null && exp < 0 ? 'Scaduta' : `fino ${fmtShort(program.endDate)}`}</span>
              )}
            </div>
            <div>
              <p className="cap">{dayOverride === null ? 'Prossimo allenamento' : 'Giorno scelto'}</p>
              <h2 className="d" style={{ fontSize: 60, marginTop: 6 }} data-testid="next-day">{day?.name}</h2>
              <div className="row" style={{ marginTop: 10 }}>
                <div className="segbar" aria-label={`Rotazione: ${day?.name}, ${dayIndex + 1} di ${program.content.days.length}`}>
                  {program.content.days.map((d, i) => <span key={d.id} className={i === dayIndex ? 'now' : i < program.nextDayIndex ? 'done' : ''} />)}
                </div>
                <span className="muted">{dayIndex + 1} di {program.content.days.length}</span>
              </div>
            </div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, fontSize: 15 }}>
              {day?.exercises.slice(0, 3).map((e) => (
                <li key={e.id} className="row"><span style={{ minWidth: 0 }}>{e.name}</span><span className="muted" style={{ whiteSpace: 'nowrap' }}>{e.sets ?? '?'} × {e.topReps ?? e.repsRaw}</span></li>
              ))}
              {day && day.exercises.length > 3 && <li className="muted">+ altri {day.exercises.length - 3} esercizi · {totalSets} serie</li>}
            </ol>
            <button className="primary big" disabled={busy || !day} onClick={() => void begin()}>Inizia allenamento</button>
            {pickDay ? (
              <label>Scegli il giorno
                <select value={dayIndex} onChange={(e) => setDayOverride(Number(e.target.value))} data-testid="day-select">
                  {program.content.days.map((d, i) => <option key={d.id} value={i}>{d.name}{i === program.nextDayIndex ? ' (prossimo)' : ''}</option>)}
                </select>
              </label>
            ) : (
              <button className="quiet" style={{ marginTop: -6 }} onClick={() => setPickDay(true)} data-testid="change-day">Scegli un altro giorno</button>
            )}
          </section>
        )}
        <ErrorText error={error} />

        {bundle?.checkDue?.dueToday && !bundle.checkDue.doneToday && (
          <Link to="/check/nuovo" className="link-card">
            <Icon name="camera" className="err" />
            <span className="spacer">Oggi è il giorno del check</span>
            <span className="err" style={{ fontWeight: 600 }}>Fai il check</span>
          </Link>
        )}
        {lastFeedback && (
          <div className="card" style={{ display: 'flex', gap: 12 }}>
            <span className="av hot" style={{ borderRadius: '50%', width: 36, height: 36 }}>{(user.coach?.displayName ?? 'C').replace(/\[.*?\]/g, '').trim().slice(0, 1)}</span>
            <div style={{ flex: 1 }}>
              <div className="row"><small>{lastFeedback.kind} del coach</small><small>{fmtShort(lastFeedback.at)}</small></div>
              <p style={{ fontSize: 15, marginTop: 2 }}>{lastFeedback.text}</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
