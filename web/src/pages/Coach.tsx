import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  deltaAtReps, commonRepCounts, type AthleteSummaryDto, type CheckDto, type InviteDto, type ProgramSummaryDto, type QuestionDto,
  type ReviewItemDto, type SetDto,
} from '@palestra/shared';
import { del, errorMessage, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtKg, fmtSet, fmtShort, periodLabel, WEEKDAYS } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { ErrorText, Segmented, Sheet, TopBar } from '../components/ui';
import { CompareView } from './Checks';
import { ExerciseDetail, HistoryView, type ExerciseListItem } from './Progress';

const initials = (n: string) => n.replace(/\[.*?\]/g, '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

export function AthletesPage() {
  const nav = useNavigate();
  const { logout } = useAuth();
  const athletes = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const queue = useAsync(() => get<ReviewItemDto[]>('/coach/review'), []);
  const invites = useAsync(() => get<InviteDto[]>('/coach/invites'), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [answer, setAnswer] = useState<ReviewItemDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reviewed(i: ReviewItemDto) {
    try {
      await post(`/coach/review/${i.type}/${i.id}`);
      queue.reload();
      athletes.reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  function openItem(i: ReviewItemDto) {
    if (i.type === 'question') return setAnswer(i);
    const tab = i.type === 'check' ? 'check' : i.type === 'workout_note' ? 'allenamenti' : 'scheda';
    nav(`/atleti/${i.athleteId}?tab=${tab}&item=${i.id}`);
  }

  return (
    <>
      <TopBar title="Atleti" />
      <main className="page stack">
        <button className="primary" onClick={() => setInviteOpen(true)} data-testid="invite-open">+ Invita atleta</button>
        <section className="stack" aria-label="Da rivedere">
          <h3>Da rivedere {queue.data?.length ? `(${queue.data.length})` : ''}</h3>
          {queue.data?.length === 0 && <p className="muted">Niente da rivedere.</p>}
          {queue.data?.map((i) => (
            <div key={`${i.type}-${i.id}`} className="card" data-testid="review-item">
              <button className="list-btn quiet" style={{ width: '100%', textAlign: 'left', color: 'inherit' }} onClick={() => openItem(i)}>
                <span><small>{i.athleteName} · {fmtShort(i.at)}</small><br /><strong>{i.title}</strong><br /><span className="muted">{i.detail}</span></span>
                <span aria-hidden="true">›</span>
              </button>
              <button className="small-btn quiet" onClick={() => void reviewed(i)}>Segna come rivisto</button>
            </div>
          ))}
        </section>
        <section className="roster stack" aria-label="Chi segui">
          <h3>Chi segui</h3>
          {athletes.data?.length === 0 && <p className="muted">Nessun atleta collegato: invia un invito.</p>}
          {athletes.data?.map((a) => (
            <button key={a.id} type="button" onClick={() => nav(`/atleti/${a.id}`)} data-testid="athlete-row">
              <span className="initials">{initials(a.displayName)}</span>
              <span><strong>{a.displayName}</strong><br /><small>{a.lastWorkout ? `${a.lastWorkout.dayName} · ${fmtShort(a.lastWorkout.endedAt)}` : 'Nessun allenamento'}{a.activeProgram ? ` · ${a.activeProgram.name}` : ''}</small></span>
              {a.pendingReview ? <span className="chip red">{a.pendingReview} da vedere</span> : <span aria-hidden="true">›</span>}
            </button>
          ))}
        </section>
        {!!invites.data?.length && (
          <details className="card">
            <summary>Inviti ({invites.data.length})</summary>
            {invites.data.map((i) => {
              const st = i.usedAt ? 'Usato' : i.revokedAt ? 'Annullato' : new Date(i.expiresAt) < new Date() ? 'Scaduto' : `Valido fino al ${fmtShort(i.expiresAt)}`;
              return (
                <div key={i.id} className="row line">
                  <span>{i.athleteName}<br /><small>{st}</small></span>
                  {!i.usedAt && !i.revokedAt && <button className="small-btn quiet" onClick={() => void del(`/coach/invites/${i.id}`).then(invites.reload)}>Annulla</button>}
                </div>
              );
            })}
          </details>
        )}
        <ErrorText error={err ?? athletes.error ?? queue.error} />
        <button className="quiet" onClick={() => void logout().then((r) => !r.ok && setErr(`Ci sono ${r.pending} modifiche non sincronizzate: riconnettiti prima di uscire.`))}>Esci</button>
      </main>
      <InviteSheet open={inviteOpen} onClose={() => { setInviteOpen(false); invites.reload(); }} />
      <AnswerSheet item={answer} onClose={() => setAnswer(null)} onDone={() => { setAnswer(null); queue.reload(); athletes.reload(); }} />
    </>
  );
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [inv, setInv] = useState<InviteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setInv(null);
      setCopied(false);
    }
  }, [open]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      setInv(await post<InviteDto>('/coach/invites', { athleteName: f.get('name'), email: String(f.get('email') ?? '').trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function share() {
    if (!inv?.url) return;
    if (navigator.share) {
      await navigator.share({ title: 'Invito APP PALESTRA', text: `Ciao ${inv.athleteName}, ecco il tuo invito personale:`, url: inv.url }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(inv.url);
      setCopied(true);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Invita atleta">
      {inv ? (
        <div className="stack">
          <p>Invito personale per <strong>{inv.athleteName}</strong>, valido fino al {fmtDate(inv.expiresAt)} e utilizzabile una sola volta.</p>
          <input readOnly value={inv.url} onFocus={(e) => e.currentTarget.select()} data-testid="invite-url" aria-label="Link invito" />
          <button className="primary" onClick={() => void share()}>{copied ? 'Link copiato' : 'Condividi link'}</button>
          <p className="muted">Il link viene mostrato solo ora: se lo perdi, annullalo e creane un altro.</p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>Nome atleta<input name="name" required maxLength={80} /></label>
          <label>Email (facoltativa, precompila la registrazione)<input name="email" type="email" /></label>
          <ErrorText error={error} />
          <button className="primary">Genera invito</button>
        </form>
      )}
    </Sheet>
  );
}

function AnswerSheet({ item, onClose, onDone }: { item: ReviewItemDto | null; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState<QuestionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQ(null);
    if (item?.type === 'question') void get<QuestionDto[]>(`/questions?userId=${item.athleteId}`).then((qs) => setQ(qs.find((x) => x.id === item.id) ?? null));
  }, [item]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await post(`/questions/${item?.id}/answer`, { answer: new FormData(e.currentTarget).get('answer') });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Sheet open={!!item} onClose={onClose} title="Domanda">
      {item && (
        <form className="stack" onSubmit={submit}>
          <p><strong>{item.athleteName}</strong> · {q?.exerciseName}</p>
          <p className="card">{item.detail}</p>
          {q?.context && (
            <p className="muted">Ultima prestazione{q.context.lastDate ? ` (${fmtShort(q.context.lastDate)})` : ''}: {q.context.sets.length ? q.context.sets.map(fmtSet).join(' · ') : 'nessuna'}</p>
          )}
          <label>Risposta<textarea name="answer" required maxLength={2000} data-testid="answer-text" /></label>
          <ErrorText error={error} />
          <button className="primary">Invia risposta</button>
          <Link to={`/atleti/${item.athleteId}?tab=allenamenti`} onClick={onClose}>Apri profilo atleta</Link>
        </form>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ profilo atleta

type Tab = 'scheda' | 'allenamenti' | 'check';

export function AthleteProfilePage() {
  const { athleteId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'scheda';
  const item = params.get('item');
  const { data: a, error, reload } = useAsync(() => get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`), [athleteId]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [version, setVersion] = useState(0);

  if (!a) return <><TopBar title="Atleta" /><main className="page"><ErrorText error={error} /></main></>;
  return (
    <>
      <TopBar title={a.displayName} athleteName={a.displayName} />
      <main className="page stack">
        <div className="grid3">
          <div className="card"><small>Scheda attiva</small><br /><strong>{a.activeProgram?.name ?? '—'}</strong><br /><small>{a.activeProgram ? periodLabel(a.activeProgram.startDate, a.activeProgram.endDate) : ''}</small></div>
          <div className="card"><small>Ultimo allenamento</small><br /><strong>{a.lastWorkout?.dayName ?? '—'}</strong><br /><small>{fmtShort(a.lastWorkout?.endedAt)}</small></div>
          <div className="card"><small>Ultimo check</small><br /><strong>{fmtShort(a.lastCheck?.checkDate)}</strong></div>
        </div>
        <div className="grid2">
          <button className="primary" onClick={() => setAssignOpen(true)} data-testid="assign-open">Assegna scheda</button>
          <button onClick={() => setFeedbackOpen(true)} data-testid="feedback-open">Lascia feedback</button>
        </div>
        <Segmented label="Profilo atleta" value={tab} onChange={(t) => setParams({ tab: t })} options={[['scheda', 'Scheda'], ['allenamenti', 'Allenamenti'], ['check', 'Check']]} />
        {tab === 'scheda' && <ProfileProgramTab key={version} athlete={a} onChanged={reload} />}
        {tab === 'allenamenti' && <ProfileWorkoutsTab athlete={a} highlight={item} onChanged={reload} />}
        {tab === 'check' && <ProfileChecksTab athlete={a} highlight={item} />}
        <ProfileSettings athlete={a} onChanged={reload} />
      </main>
      <AssignSheet open={assignOpen} athlete={a} onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); reload(); setVersion((v) => v + 1); setParams({ tab: 'scheda' }); }} />
      <ExerciseFeedbackSheet open={feedbackOpen} athlete={a} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}

function ProfileProgramTab({ athlete }: { athlete: AthleteSummaryDto; onChanged: () => void }) {
  const { data } = useAsync(() => get<ProgramSummaryDto[]>(`/programs?userId=${athlete.id}`), [athlete.id]);
  const nav = useNavigate();
  if (!data) return <p className="muted">Carico…</p>;
  return (
    <div className="stack">
      {data.length === 0 && <p className="empty">Nessuna scheda assegnata.</p>}
      {data.map((p) => (
        <div key={p.id} className="card">
          <div className="row"><strong>{p.name}</strong><span className="chip">v{p.versionNo}</span></div>
          <small>{periodLabel(p.startDate, p.endDate) ?? 'Senza periodo'} · prossimo {p.content.days[p.nextDayIndex]?.name}</small>
          <div className="row-start" style={{ marginTop: 8 }}>
            <button className="small-btn" onClick={() => nav(`/atleti/${athlete.id}/scheda/${p.id}/modifica`)} data-testid="edit-athlete-program">Modifica scheda</button>
          </div>
        </div>
      ))}
      <Link to={`/atleti/${athlete.id}/scheda`} className="btn">Tutte le schede dell'atleta</Link>
    </div>
  );
}

function ProfileWorkoutsTab({ athlete, highlight, onChanged }: { athlete: AthleteSummaryDto; highlight: string | null; onChanged: () => void }) {
  const { data: exercises } = useAsync(() => get<ExerciseListItem[]>(`/progress/exercises?userId=${athlete.id}`), [athlete.id]);
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<string[]>(athlete.keyExercises);
  const keyList = athlete.keyExercises.length ? athlete.keyExercises : (exercises ?? []).slice(0, 2).map((e) => e.exerciseKey);
  async function saveKeys() {
    await patch(`/coach/athletes/${athlete.id}`, { keyExercises: sel });
    setEditing(false);
    onChanged();
  }
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row"><strong>Esercizi chiave</strong><button className="small-btn quiet" onClick={() => setEditing(!editing)}>Scegli (max 3)</button></div>
        {editing && exercises && (
          <div className="stack">
            {exercises.map((e) => (
              <label key={e.exerciseKey} className="check-label">
                <input type="checkbox" checked={sel.includes(e.exerciseKey)} disabled={!sel.includes(e.exerciseKey) && sel.length >= 3}
                  onChange={(ev) => setSel(ev.target.checked ? [...sel, e.exerciseKey] : sel.filter((k) => k !== e.exerciseKey))} />
                {e.exerciseName}
              </label>
            ))}
            <button className="small-btn" onClick={() => void saveKeys()}>Salva esercizi chiave</button>
          </div>
        )}
        {keyList.map((k) => <KeyExerciseDelta key={k} athleteId={athlete.id} exerciseKey={k} />)}
      </section>
      <HistoryView userId={athlete.id} highlight={highlight} />
    </div>
  );
}

/** Variazione a parità di ripetizioni (prima → ultima rilevazione) per un esercizio chiave. */
function KeyExerciseDelta({ athleteId, exerciseKey }: { athleteId: string; exerciseKey: string }) {
  const { data } = useAsync(() => get<{ sets: SetDto[] }>(`/progress/exercises/${encodeURIComponent(exerciseKey)}?userId=${athleteId}`), [athleteId, exerciseKey]);
  const sets = data?.sets ?? [];
  const reps = commonRepCounts(sets, 3);
  const name = sets[sets.length - 1]?.exerciseName ?? exerciseKey;
  return (
    <details className="line">
      <summary><strong>{name}</strong>{' '}
        {reps.map((r) => {
          const d = deltaAtReps(sets, r);
          return d ? <span key={r} className={`chip ${d.delta > 0 ? 'self' : d.delta < 0 ? 'red' : ''}`}>{r} rip: {d.delta > 0 ? '+' : ''}{fmtKg(d.delta)}</span> : null;
        })}
        {!sets.length && <small className="muted"> nessun dato</small>}
      </summary>
      {sets.length > 0 && <ExerciseDetail exerciseKey={exerciseKey} userId={athleteId} compact />}
    </details>
  );
}

function ProfileChecksTab({ athlete, highlight }: { athlete: AthleteSummaryDto; highlight: string | null }) {
  const { data, reload } = useAsync(() => get<CheckDto[]>(`/checks?userId=${athlete.id}`), [athlete.id]);
  const [open, setOpen] = useState<string | null>(highlight);
  const current = data?.find((c) => c.id === open);
  if (!data) return <p className="muted">Carico…</p>;
  return (
    <div className="stack">
      {data.length > 0 && <CompareView checks={data} />}
      {current && <CoachCheckCard check={current} onSaved={reload} onClose={() => setOpen(null)} />}
      <div className="stack">
        {data.map((c) => (
          <button key={c.id} className="list-btn" onClick={() => setOpen(c.id)} data-testid="coach-check-item">
            <span>{fmtDate(c.checkDate)} · {fmtKg(c.weightKg)}<br /><small>{c.sharePhotos ? `${c.photos.length} foto condivise` : c.photoCount ? 'Foto private dell\'atleta' : 'Senza foto'}{c.feedback.length ? ' · feedback inviato' : ''}</small></span>
            {!c.reviewedAt && <span className="chip red">Da vedere</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function CoachCheckCard({ check, onSaved, onClose }: { check: CheckDto; onSaved: () => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await post(`/checks/${check.id}/feedback`, { body: new FormData(form).get('body') });
      form.reset();
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <section className="card highlight stack" data-testid="coach-check">
      <div className="row"><strong>Check del {fmtDate(check.checkDate)}</strong><button className="quiet" onClick={onClose}>Chiudi</button></div>
      <p className="num">Peso {fmtKg(check.weightKg)} · Bicipite {check.bicepsCm ?? '—'} · Petto {check.chestCm ?? '—'} · Coscia {check.thighCm ?? '—'} · Addome {check.waistCm ?? '—'}</p>
      {check.note && <p>«{check.note}»</p>}
      {check.photos.length ? (
        <div className="grid3">{check.photos.map((p) => <img key={p.id} className="photo" src={`/api/photos/${p.id}`} alt={p.pose} />)}</div>
      ) : (
        <p className="muted">{check.photoCount ? 'L\'atleta non ha condiviso le foto di questo check.' : 'Nessuna foto.'}</p>
      )}
      {check.feedback.map((f) => <p key={f.id} className="feedback"><small>{fmtShort(f.createdAt)}</small><br />{f.body}</p>)}
      <form className="stack" onSubmit={submit}>
        <label>Commento sul check<textarea name="body" required maxLength={2000} placeholder="Scrivi un'indicazione…" data-testid="check-feedback-text" /></label>
        <ErrorText error={error} />
        <button className="primary">Invia feedback</button>
      </form>
    </section>
  );
}

function AssignSheet({ open, athlete, onClose, onDone }: { open: boolean; athlete: AthleteSummaryDto; onClose: () => void; onDone: () => void }) {
  const { data: mine } = useAsync(() => (open ? get<ProgramSummaryDto[]>('/programs') : Promise.resolve([])), [open]);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const from = String(f.get('from') || '') || null;
    const to = String(f.get('to') || '') || null;
    if (from && to && to < from) return setError('La data finale deve essere uguale o successiva a quella iniziale.');
    try {
      await post(`/programs/${f.get('program')}/duplicate`, { ownerId: athlete.id, name: String(f.get('name') || '').trim() || undefined, startDate: from, endDate: to });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Assegna scheda">
      <form className="stack" onSubmit={submit}>
        <p className="muted">Viene creata una copia per {athlete.displayName}: potrai personalizzarla senza toccare l'originale né le schede di altri atleti.</p>
        <label>Scegli scheda<select name="program" required data-testid="assign-program">{mine?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Nome per l'atleta (facoltativo)<input name="name" maxLength={80} /></label>
        <div className="grid2">
          <label>Inizio<input type="date" name="from" /></label>
          <label>Fine<input type="date" name="to" /></label>
        </div>
        <ErrorText error={error} />
        <button className="primary" data-testid="assign-confirm">Conferma assegnazione</button>
      </form>
    </Sheet>
  );
}

function ExerciseFeedbackSheet({ open, athlete, onClose }: { open: boolean; athlete: AthleteSummaryDto; onClose: () => void }) {
  const { data: programs } = useAsync(() => (open ? get<ProgramSummaryDto[]>(`/programs?userId=${athlete.id}`) : Promise.resolve([])), [open, athlete.id]);
  const names = useMemo(() => [...new Set((programs ?? []).flatMap((p) => p.content.days.flatMap((d) => d.exercises.map((e) => e.name))))], [programs]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await post(`/coach/athletes/${athlete.id}/exercise-feedback`, { exerciseName: f.get('exercise'), body: f.get('body') });
      setStatus(`Inviato: ${athlete.displayName} lo vedrà sotto «Ultima volta» di ${String(f.get('exercise'))}.`);
      form.reset();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Sheet open={open} onClose={() => { setStatus(null); onClose(); }} title="Lascia feedback">
      <form className="stack" onSubmit={submit}>
        <label>Esercizio<select name="exercise" required data-testid="feedback-exercise">{names.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>Indicazione<textarea name="body" required maxLength={2000} data-testid="feedback-text" /></label>
        <ErrorText error={error} />
        {status && <p className="ok" role="status">{status}</p>}
        <button className="primary">Invia indicazione</button>
        <p className="muted">Per un commento su un check apri la sezione Check e seleziona il check.</p>
      </form>
    </Sheet>
  );
}

function ProfileSettings({ athlete, onChanged }: { athlete: AthleteSummaryDto; onChanged: () => void }) {
  const nav = useNavigate();
  const [link, setLink] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="card">
      <summary>Impostazioni atleta</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <label>Giorno del check ricorrente
          <select value={athlete.checkWeekday ?? ''} data-testid="check-weekday" onChange={(e) => void patch(`/coach/athletes/${athlete.id}`, { checkWeekday: e.target.value === '' ? null : Number(e.target.value) }).then(onChanged).catch((x: unknown) => setErr(errorMessage(x)))}>
            <option value="">Nessuno</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <button className="small-btn" onClick={() => void post<{ url: string }>(`/coach/athletes/${athlete.id}/recovery-link`).then((r) => setLink(r.url)).catch((x: unknown) => setErr(errorMessage(x)))}>Genera link di recupero accesso</button>
        {link && <><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link di recupero" /><small>Valido 1 ora, monouso. Consegnalo solo all'atleta.</small></>}
        {confirmUnlink ? (
          <div className="grid2">
            <button className="danger" onClick={() => void del(`/coach/athletes/${athlete.id}`).then(() => nav('/atleti'))}>Conferma scollegamento</button>
            <button onClick={() => setConfirmUnlink(false)}>Annulla</button>
          </div>
        ) : (
          <button className="small-btn quiet" onClick={() => setConfirmUnlink(true)}>Scollega atleta (perdi subito l'accesso ai suoi dati)</button>
        )}
        <ErrorText error={err} />
      </div>
    </details>
  );
}
