import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProgramSummaryDto } from '@palestra/shared';
import { errorMessage, post } from '../lib/api';
import { useUser } from '../lib/auth';
import { daysUntil, fmtShort, periodLabel } from '../lib/format';
import { useBundle } from '../lib/hooks';
import { startWorkout, useActiveWorkout } from '../lib/workoutStore';
import { ErrorText, TopBar } from '../components/ui';

const selKey = (uid: string) => `selectedProgram:${uid}`;

function readSel(uid: string): string | null {
  try {
    return localStorage.getItem(selKey(uid));
  } catch {
    return null;
  }
}

export function TodayPage() {
  const user = useUser();
  const nav = useNavigate();
  const { bundle, offline, reload } = useBundle(user.id);
  const { workout } = useActiveWorkout();
  const [selected, setSelected] = useState<string | null>(() => readSel(user.id));
  const [dayOverride, setDayOverride] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const programs = bundle?.programs ?? [];
  const program: ProgramSummaryDto | undefined = programs.find((p) => p.id === selected) ?? programs[0];
  useEffect(() => setDayOverride(null), [program?.id]);

  const dayIndex = dayOverride ?? program?.nextDayIndex ?? 0;
  const day = program?.content.days[dayIndex];

  const recentFeedback = useMemo(() => {
    const since = Date.now() - 14 * 86400_000;
    return Object.values(bundle?.contexts ?? {})
      .flatMap((c) => [
        ...c.feedback.map((f) => ({ key: c.exerciseKey, text: f.body, at: f.createdAt, kind: 'Indicazione' })),
        ...c.questions.filter((q) => q.answer && q.answeredAt).map((q) => ({ key: c.exerciseKey, text: q.answer as string, at: q.answeredAt as string, kind: 'Risposta' })),
      ])
      .filter((f) => new Date(f.at).getTime() > since)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 3);
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
      <TopBar title="Oggi" />
      <main className="page stack">
        {offline && <p className="chip warn">Offline: dati dell'ultimo aggiornamento</p>}
        {bundle?.checkDue?.dueToday && !bundle.checkDue.doneToday && (
          <Link to="/check/nuovo" className="card highlight row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span><strong>È il giorno del check</strong><br /><small>Peso, misure e foto (private finché non scegli di condividerle)</small></span>
            <span className="btn small-btn">Fai il check</span>
          </Link>
        )}
        {programs.filter((p) => p.unseenChange).map((p) => (
          <div key={p.id} className="card highlight" data-testid="program-update">
            <strong>{p.name} aggiornata · versione {p.unseenChange?.versionNo}</strong>
            <p style={{ whiteSpace: 'pre-line' }}>{p.unseenChange?.summary ?? 'Modifiche del coach'}</p>
            <small>Vale dalla prossima seduta.</small>
            <button className="wide small-btn" style={{ marginTop: 8 }} onClick={() => void ack(p)}>Ho letto</button>
          </div>
        ))}

        {workout ? (
          <div className="card stack">
            <small>Allenamento in sospeso · iniziato {new Date(workout.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</small>
            <h2>{workout.day.name}</h2>
            <p className="muted">{workout.programName} · {workout.sets.filter((s) => s.kind === 'work').length} serie registrate</p>
            <button className="primary" onClick={() => nav('/seduta')}>Riprendi allenamento</button>
          </div>
        ) : !bundle ? (
          <p className="muted">Carico…</p>
        ) : !program ? (
          <div className="card empty">
            <p>Nessuna scheda disponibile.</p>
            <Link to="/scheda" className="btn">Vai a Scheda</Link>
          </div>
        ) : (
          <div className="card stack">
            {programs.length > 1 && (
              <label>Scheda da eseguire
                <select value={program.id} onChange={(e) => choose(e.target.value)} data-testid="program-select">
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            <div className="row">
              <small>{program.name} · v{program.versionNo}</small>
              {periodLabel(program.startDate, program.endDate) && (
                <span className={`chip ${exp !== null && exp <= 7 ? 'warn' : ''}`}>{periodLabel(program.startDate, program.endDate)}</span>
              )}
            </div>
            <div>
              <small>{dayOverride === null ? 'Prossimo giorno' : 'Giorno scelto'}</small>
              <h2 data-testid="next-day">{day?.name}</h2>
              <p className="muted">{day?.exercises.map((e) => e.name).join(' · ')}</p>
            </div>
            <button className="primary" disabled={busy || !day} onClick={() => void begin()}>Inizia allenamento</button>
            <label>Cambia giorno
              <select value={dayIndex} onChange={(e) => setDayOverride(Number(e.target.value))} data-testid="day-select">
                {program.content.days.map((d, i) => <option key={d.id} value={i}>{d.name}{i === program.nextDayIndex ? ' (prossimo)' : ''}</option>)}
              </select>
            </label>
          </div>
        )}
        <ErrorText error={error} />

        {recentFeedback.length > 0 && (
          <section className="card">
            <strong>Indicazioni del coach</strong>
            {recentFeedback.map((f) => (
              <p key={f.at + f.text} className="feedback"><small>{f.kind} · {fmtShort(f.at)}</small><br />{f.text}</p>
            ))}
          </section>
        )}
        {user.coach && <p className="muted">Coach: {user.coach.displayName}</p>}
      </main>
    </>
  );
}
