import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  commonRepCounts, deltaAtReps,
  type AthleteSummaryDto, type CheckDto, type ExerciseContextDto, type InviteDto, type ProgramSummaryDto, type ReviewItemDto, type SetDto,
} from '@palestra/shared';
import { del, errorMessage, get, patch, post } from '../lib/api';
import { useUser } from '../lib/auth';
import { activityLabel, activityOf, type Activity } from '../lib/activity';
import { fmtDate, fmtKg, fmtSet, fmtShort, periodLabel, WEEKDAYS } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { getInactivityDays } from '../lib/prefs';
import { Empty, ErrorText, initials, Loading, Sheet, TopBar } from '../components/ui';
import { Icon } from '../components/icons';
import { AssignSheet } from '../components/AssignSheet';
import { CheckList, CompareView, MEASURES } from './Checks';
import { ExerciseDetail, ProgressView, type ExerciseListItem } from './Progress';

const TYPE_LABEL: Record<ReviewItemDto['type'], string> = { check: 'Check', question: 'Domanda', workout_note: 'Nota', program_expiry: 'Scheda' };

/** Destinazione diretta di ogni elemento "Da rivedere". */
function reviewHref(i: ReviewItemDto): string {
  if (i.type === 'question') return `/atleti/${i.athleteId}/esercizio/${encodeURIComponent(i.exerciseKey)}`;
  if (i.type === 'check') return `/atleti/${i.athleteId}/check/${i.id}`;
  if (i.type === 'workout_note') return `/atleti/${i.athleteId}?tab=sedute&item=${i.id}`;
  return `/atleti/${i.athleteId}?tab=scheda`;
}

function ActivityTag({ act }: { act: Activity }) {
  if (act.kind === 'active') return null;
  return <span className={`tag ${act.kind === 'inactive' ? 'warn' : ''}`} data-testid={`activity-${act.kind}`}>{activityLabel(act)}</span>;
}

// ------------------------------------------------------------------ dashboard

export function DashboardPage() {
  const user = useUser();
  const athletes = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const queue = useAsync(() => get<ReviewItemDto[]>('/coach/review'), []);
  const [invite, setInvite] = useState(false);
  const threshold = getInactivityDays(user.id);

  const groups = useMemo(() => {
    if (!athletes.data || !queue.data) return [];
    return athletes.data
      .map((a) => ({ a, items: queue.data!.filter((i) => i.athleteId === a.id), act: activityOf(a, threshold) }))
      .filter((g) => g.items.length || g.act.kind !== 'active')
      .sort((x, y) => y.items.length - x.items.length || (x.act.kind === 'inactive' ? -1 : 1));
  }, [athletes.data, queue.data, threshold]);

  const recent = useMemo(() => (athletes.data ?? []).flatMap((a) => [
    ...(a.lastWorkout?.endedAt ? [{ key: `w${a.lastWorkout.id}`, at: a.lastWorkout.endedAt, text: `${a.displayName} ha salvato ${a.lastWorkout.dayName}`, href: `/atleti/${a.id}?tab=sedute&item=${a.lastWorkout.id}` }] : []),
    ...(a.lastCheck ? [{ key: `c${a.lastCheck.id}`, at: `${a.lastCheck.checkDate}T12:00:00`, text: `${a.displayName} ha registrato un check`, href: `/atleti/${a.id}/check/${a.lastCheck.id}` }] : []),
  ]).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 5), [athletes.data]);

  const nChecks = queue.data?.filter((i) => i.type === 'check').length ?? 0;
  const nQuestions = queue.data?.filter((i) => i.type === 'question').length ?? 0;

  return (
    <>
      <TopBar title="Dashboard" action={<button type="button" className="small-btn primary" style={{ width: 'auto' }} onClick={() => setInvite(true)} data-testid="invite-open"><Icon name="plus" size={18} />Invita</button>} />
      <main className="page">
        <div className="grid3">
          <Link className="kpi" to="/atleti" data-testid="kpi-athletes"><span className="d">{athletes.data?.length ?? '–'}</span><span className="muted">Atleti</span></Link>
          <Link className={`kpi ${nChecks ? 'hot' : ''}`} to="/coach/check" data-testid="kpi-checks"><span className="d">{queue.data ? nChecks : '–'}</span><span className="muted">Check da rivedere</span></Link>
          <Link className={`kpi ${nQuestions ? 'hot' : ''}`} to="/atleti?filtro=rivedere" data-testid="kpi-questions"><span className="d">{queue.data ? nQuestions : '–'}</span><span className="muted">Richieste</span></Link>
        </div>
        <ErrorText error={athletes.error ?? queue.error} />
        <section>
          <h2 className="title-n" style={{ marginBottom: 4 }}>Da gestire</h2>
          {!athletes.data || !queue.data ? <Loading /> : groups.length === 0 ? <p className="muted">Niente da gestire. Tutti gli atleti sono attivi.</p> : (
            <div className="card tight">
              {groups.map(({ a, items, act }) => (
                <div key={a.id} data-testid="review-group">
                  <Link to={`/atleti/${a.id}`} className="list-row">
                    <span className={`av ${items.length ? 'hot' : ''}`}>{initials(a.displayName)}</span>
                    <span className="spacer" style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: 600 }}>{a.displayName}</strong>
                      <span className="row-start" style={{ marginTop: 4 }}>
                        {[...new Set(items.map((i) => i.type))].map((t) => <span key={t} className={`tag ${t === 'program_expiry' ? 'warn' : t === 'workout_note' ? '' : 'hot'}`}>{t === 'program_expiry' ? items.find((i) => i.type === t)?.title : TYPE_LABEL[t]}</span>)}
                        <ActivityTag act={act} />
                      </span>
                    </span>
                    <Icon name="right" className="chev" />
                  </Link>
                  {items.map((i) => (
                    <Link key={`${i.type}-${i.id}`} to={reviewHref(i)} className="list-row" style={{ paddingLeft: 52, minHeight: 48, borderTop: 0 }} data-testid="review-item">
                      <span className="spacer" style={{ minWidth: 0 }}><span style={{ fontSize: 15 }}>{i.title}</span><small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.detail}</small></span>
                      <small>{fmtShort(i.at)}</small>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
        {recent.length > 0 && (
          <section>
            <h2 className="title-n" style={{ marginBottom: 4 }}>Attività recenti</h2>
            <div className="card tight">
              {recent.map((r) => <Link key={r.key} to={r.href} className="list-row" style={{ fontSize: 15 }}><span className="spacer">{r.text}</span><small>{fmtShort(r.at)}</small></Link>)}
            </div>
          </section>
        )}
      </main>
      <InviteSheet open={invite} onClose={() => setInvite(false)} />
    </>
  );
}

// ------------------------------------------------------------------ atleti

type Filter = 'all' | 'review' | 'inactive' | 'never' | 'noprogram';

export function AthletesPage() {
  const user = useUser();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const athletes = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const invites = useAsync(() => get<InviteDto[]>('/coach/invites'), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(params.get('filtro') === 'rivedere' ? 'review' : 'all');
  const [invite, setInvite] = useState(false);
  const threshold = getInactivityDays(user.id);

  const rows = useMemo(() => (athletes.data ?? []).map((a) => ({ a, act: activityOf(a, threshold) })), [athletes.data, threshold]);
  const count = (f: Filter) => rows.filter((r) => match(r, f)).length;
  function match(r: { a: AthleteSummaryDto; act: Activity }, f: Filter): boolean {
    if (f === 'review') return r.a.pendingReview > 0;
    if (f === 'inactive') return r.act.kind === 'inactive';
    if (f === 'never') return r.act.kind === 'never';
    if (f === 'noprogram') return !r.a.activeProgram;
    return true;
  }
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => match(r, filter) && (!q || r.a.displayName.toLowerCase().includes(q) || r.a.email.toLowerCase().includes(q)));
  const pendingInvites = invites.data?.filter((i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date()) ?? [];

  return (
    <>
      <TopBar title="Atleti" action={<button type="button" className="icon-btn" aria-label="Invita atleta" onClick={() => setInvite(true)} data-testid="invite-open"><Icon name="userPlus" /></button>} />
      <main className="page">
        <label className="search"><Icon name="search" size={20} /><input type="search" placeholder="Cerca atleta" aria-label="Cerca atleta" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="athlete-search" /></label>
        <div className="scroller" role="group" aria-label="Filtri">
          {([['all', 'Tutti'], ['review', 'Da rivedere'], ['inactive', 'Inattivi'], ['never', 'Mai allenati'], ['noprogram', 'Senza scheda']] as [Filter, string][]).map(([f, l]) => (
            <button key={f} type="button" className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>{l} {athletes.data ? count(f) : ''}</button>
          ))}
        </div>
        <ErrorText error={athletes.error} />
        {!athletes.data && <Loading />}
        {athletes.data?.length === 0 && <Empty action={<button className="primary" onClick={() => setInvite(true)}>Invita il primo atleta</button>}>Nessun atleta collegato.</Empty>}
        {athletes.data && athletes.data.length > 0 && visible.length === 0 && <p className="muted">Nessun atleta per questo filtro.</p>}
        {visible.length > 0 && (
          <div className="card tight">
            {visible.map(({ a, act }) => (
              <button key={a.id} type="button" className="list-row" onClick={() => nav(`/atleti/${a.id}`)} data-testid="athlete-row">
                <span className={`av ${a.pendingReview ? 'hot' : ''}`}>{initials(a.displayName)}</span>
                <span className="spacer" style={{ minWidth: 0 }}>
                  <strong style={{ fontWeight: 600 }}>{a.displayName}</strong>
                  <small style={{ display: 'block' }}>{a.activeProgram?.name ?? 'Nessuna scheda'}{act.kind === 'active' ? ` · ${activityLabel(act).toLowerCase()}` : ''}</small>
                  {act.kind !== 'active' && <span style={{ display: 'block', marginTop: 4 }}><ActivityTag act={act} /></span>}
                </span>
                {a.pendingReview > 0 && <span className="tag hot">{a.pendingReview}</span>}
                <Icon name="right" className="chev" />
              </button>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 14 }}>Inattivo dopo <Link to="/account" style={{ fontWeight: 600 }}>{threshold} giorni</Link> senza allenamenti salvati.</p>
        {pendingInvites.length > 0 && (
          <details className="card">
            <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Inviti in attesa ({pendingInvites.length})</summary>
            {pendingInvites.map((i) => (
              <div key={i.id} className="list-row">
                <span className="spacer">{i.athleteName}<small style={{ display: 'block' }}>valido fino al {fmtShort(i.expiresAt)}</small></span>
                <button className="small-btn quiet" onClick={() => void del(`/coach/invites/${i.id}`).then(invites.reload)}>Annulla</button>
              </div>
            ))}
          </details>
        )}
      </main>
      <InviteSheet open={invite} onClose={() => { setInvite(false); invites.reload(); }} />
    </>
  );
}

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [inv, setInv] = useState<InviteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setInv(null);
      setCopied(false);
      setError(null);
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
    if (navigator.share) await navigator.share({ title: 'Invito APP PALESTRA', text: `Ciao ${inv.athleteName}, ecco il tuo invito personale:`, url: inv.url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(inv.url);
      setCopied(true);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Invita atleta" testId="invite-sheet">
      {inv ? (
        <div className="stack">
          <p>Invito personale per <strong>{inv.athleteName}</strong>, valido fino al {fmtDate(inv.expiresAt)} e utilizzabile una sola volta.</p>
          <input readOnly value={inv.url} onFocus={(e) => e.currentTarget.select()} data-testid="invite-url" aria-label="Link invito" />
          <button className="primary big" onClick={() => void share()}>{copied ? 'Link copiato' : 'Condividi link'}</button>
          <p className="muted" style={{ fontSize: 14 }}>Il link si vede solo ora: se lo perdi, annullalo e creane un altro.</p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>Nome atleta<input name="name" required maxLength={80} /></label>
          <label>Email (facoltativa)<input name="email" type="email" /></label>
          <ErrorText error={error} />
          <button className="primary big">Genera invito</button>
        </form>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ profilo atleta

type Tab = 'riepilogo' | 'scheda' | 'sedute' | 'progressi' | 'check';
const TABS: [Tab, string][] = [['riepilogo', 'Riepilogo'], ['scheda', 'Scheda'], ['sedute', 'Sedute'], ['progressi', 'Progressi'], ['check', 'Check']];

export function AthleteProfilePage() {
  const user = useUser();
  const { athleteId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'riepilogo') as Tab;
  const item = params.get('item');
  const { data: a, error, reload } = useAsync(() => get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`), [athleteId]);
  const queue = useAsync(() => get<ReviewItemDto[]>('/coach/review'), [athleteId]);
  const [sheet, setSheet] = useState<null | 'assign' | 'feedback' | 'settings'>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  if (!a) return <><TopBar title="Atleta" /><main className="page">{error ? <ErrorText error={error} /> : <Loading />}</main></>;
  const act = activityOf(a, getInactivityDays(user.id));
  const items = queue.data?.filter((i) => i.athleteId === a.id) ?? [];

  async function reviewed(i: ReviewItemDto) {
    await post(`/coach/review/${i.type}/${i.id}`);
    queue.reload();
    reload();
  }

  return (
    <>
      <header className="top" data-testid="athlete-banner">
        <div className="ctx-strip" aria-hidden="true" />
        <div className="top-row"><Link to="/atleti" className="back"><Icon name="left" size={18} />Atleti</Link></div>
        <div className="ctx">
          <span className="badge">{initials(a.displayName)}</span>
          <div className="spacer" style={{ minWidth: 0 }}>
            <p className="cap" style={{ color: 'var(--pri-ink)' }}>Profilo atleta</p>
            <h1 style={{ marginTop: 4, fontSize: 30 }}>{a.displayName}</h1>
          </div>
          <button type="button" className="icon-btn" aria-label="Impostazioni atleta: giorno del check, recupero accesso, scollega" onClick={() => setSheet('settings')} data-testid="athlete-settings"><Icon name="more" /></button>
        </div>
        <div className="scroller" role="tablist" aria-label="Sezioni profilo">
          {TABS.map(([t, l]) => <button key={t} type="button" role="tab" className="pill" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setParams({ tab: t })} data-testid={`tab-${t}`}>{l}</button>)}
        </div>
      </header>
      <main className="page">
        {msg && <p className="ok" role="status">{msg}</p>}
        {tab === 'riepilogo' && (
          <>
            <div className="grid2">
              <button className="primary" onClick={() => setSheet('assign')} data-testid="assign-open">Assegna scheda</button>
              <button onClick={() => setSheet('feedback')} data-testid="feedback-open">Lascia feedback</button>
            </div>
            <div className="grid3">
              <div className="kpi"><span className="cap">Scheda</span><strong style={{ fontSize: 15 }}>{a.activeProgram?.name ?? '—'}</strong>{a.activeProgram?.endDate && <small>fino {fmtShort(a.activeProgram.endDate)}</small>}</div>
              <div className="kpi"><span className="cap">Ultimo</span><strong style={{ fontSize: 15 }}>{a.lastWorkout?.dayName ?? '—'}</strong><small className={act.kind === 'inactive' ? 'warn' : undefined}>{act.kind === 'never' ? 'mai' : fmtShort(a.lastWorkout?.endedAt)}</small></div>
              <div className="kpi"><span className="cap">Check</span><strong style={{ fontSize: 15 }}>{fmtShort(a.lastCheck?.checkDate)}</strong>{a.checkWeekday !== null && <small>{WEEKDAYS[a.checkWeekday]?.toLowerCase()}</small>}</div>
            </div>
            {act.kind !== 'active' && <ActivityTag act={act} />}
            <section className="card tight">
              <p className="cap" style={{ padding: '12px 0 4px' }}>Da gestire · {items.length}</p>
              {items.length === 0 && <p className="muted" style={{ paddingBottom: 12 }}>Niente in sospeso.</p>}
              {items.map((i) => (
                <div key={`${i.type}-${i.id}`} className="list-row" data-testid="profile-review-item">
                  <span className={`dot ${i.type === 'workout_note' ? '' : 'hot'}`} />
                  <Link to={reviewHref(i)} className="spacer" style={{ color: 'var(--ink)', textDecoration: 'none', minWidth: 0 }}>
                    <span style={{ fontSize: 15 }}>{i.title}</span><small style={{ display: 'block' }}>{i.detail}</small>
                  </Link>
                  <button type="button" className="small-btn quiet" onClick={() => void reviewed(i)}>Visto</button>
                </div>
              ))}
            </section>
            <KeyExercises athlete={a} onChanged={reload} />
          </>
        )}
        {tab === 'scheda' && <ProfilePrograms key={version} athlete={a} />}
        {tab === 'sedute' && <ProgressView userId={a.id} highlight={item} />}
        {tab === 'progressi' && <ProgressView userId={a.id} />}
        {tab === 'check' && <ProfileChecks athlete={a} />}
      </main>
      <AssignSheet open={sheet === 'assign'} athlete={a} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); setVersion((v) => v + 1); setMsg('Scheda assegnata'); setParams({ tab: 'scheda' }); }} />
      <ExerciseFeedbackSheet open={sheet === 'feedback'} athlete={a} onClose={() => setSheet(null)} />
      <AthleteSettingsSheet open={sheet === 'settings'} athlete={a} onClose={() => setSheet(null)} onChanged={reload} />
    </>
  );
}

function ProfilePrograms({ athlete }: { athlete: AthleteSummaryDto }) {
  const { data, error } = useAsync(() => get<ProgramSummaryDto[]>(`/programs?userId=${athlete.id}`), [athlete.id]);
  const nav = useNavigate();
  if (error) return <ErrorText error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {data.length === 0 && <Empty>Nessuna scheda assegnata.</Empty>}
      {data.map((p) => (
        <div key={p.id} className="card stack">
          <div className="row"><strong style={{ fontSize: 17 }}>{p.name}</strong><span className="muted">v{p.versionNo}</span></div>
          <small>{periodLabel(p.startDate, p.endDate) ?? 'Senza periodo'} · prossimo {p.content.days[p.nextDayIndex]?.name}</small>
          <button className="small-btn" onClick={() => nav(`/atleti/${athlete.id}/scheda/${p.id}/modifica`)} data-testid="edit-athlete-program">Modifica scheda</button>
        </div>
      ))}
      <Link to={`/atleti/${athlete.id}/scheda`} className="btn">Tutte le schede · crea o importa</Link>
    </div>
  );
}

function ProfileChecks({ athlete }: { athlete: AthleteSummaryDto }) {
  const { data, error } = useAsync(() => get<CheckDto[]>(`/checks?userId=${athlete.id}`), [athlete.id]);
  if (error) return <ErrorText error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {data.length > 0 && <CompareView checks={data} />}
      <CheckList checks={data} base={`/atleti/${athlete.id}/check`} />
    </div>
  );
}

function KeyExercises({ athlete, onChanged }: { athlete: AthleteSummaryDto; onChanged: () => void }) {
  const { data: exercises } = useAsync(() => get<ExerciseListItem[]>(`/progress/exercises?userId=${athlete.id}`), [athlete.id]);
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<string[]>(athlete.keyExercises);
  const keyList = athlete.keyExercises.length ? athlete.keyExercises : (exercises ?? []).slice(0, 2).map((e) => e.exerciseKey);
  return (
    <section className="card tight">
      <div className="row" style={{ minHeight: 48 }}><span className="cap">Esercizi chiave · stesse ripetizioni</span><button className="small-btn quiet" onClick={() => setEditing(!editing)}>Scegli</button></div>
      {editing && exercises && (
        <div className="stack" style={{ paddingBottom: 12 }}>
          {exercises.map((e) => (
            <label key={e.exerciseKey} className="check-label">
              <input type="checkbox" checked={sel.includes(e.exerciseKey)} disabled={!sel.includes(e.exerciseKey) && sel.length >= 3}
                onChange={(ev) => setSel(ev.target.checked ? [...sel, e.exerciseKey] : sel.filter((k) => k !== e.exerciseKey))} />
              {e.exerciseName}
            </label>
          ))}
          <button className="small-btn" onClick={() => void patch(`/coach/athletes/${athlete.id}`, { keyExercises: sel }).then(() => { setEditing(false); onChanged(); })}>Salva (max 3)</button>
        </div>
      )}
      {keyList.length === 0 && <p className="muted" style={{ paddingBottom: 12 }}>Nessun dato ancora.</p>}
      {keyList.map((k) => <KeyExerciseDelta key={k} athleteId={athlete.id} exerciseKey={k} />)}
    </section>
  );
}

function KeyExerciseDelta({ athleteId, exerciseKey }: { athleteId: string; exerciseKey: string }) {
  const { data } = useAsync(() => get<{ sets: SetDto[] }>(`/progress/exercises/${encodeURIComponent(exerciseKey)}?userId=${athleteId}`), [athleteId, exerciseKey]);
  const sets = data?.sets ?? [];
  const reps = commonRepCounts(sets, 3);
  const name = sets[sets.length - 1]?.exerciseName ?? exerciseKey;
  return (
    <details className="list-row" style={{ display: 'block' }}>
      <summary className="row" style={{ cursor: 'pointer', minHeight: 44 }}>
        <span style={{ minWidth: 0 }}>{name}</span>
        <span className="row-start" style={{ justifyContent: 'flex-end' }}>
          {reps.map((r) => {
            const d = deltaAtReps(sets, r);
            return d ? <span key={r} className={`tag ${d.delta > 0 ? 'ok' : d.delta < 0 ? 'hot' : ''}`}>{r} rip {d.delta > 0 ? '+' : ''}{fmtKg(d.delta)}</span> : null;
          })}
          {!sets.length && <small>nessun dato</small>}
        </span>
      </summary>
      {sets.length > 0 && <ExerciseDetail exerciseKey={exerciseKey} userId={athleteId} compact />}
    </details>
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
    <Sheet open={open} onClose={() => { setStatus(null); onClose(); }} title="Lascia feedback" kicker={athlete.displayName}>
      <form className="stack" onSubmit={submit}>
        <label>Esercizio<select name="exercise" required data-testid="feedback-exercise">{names.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>Indicazione<textarea name="body" required maxLength={2000} data-testid="feedback-text" /></label>
        <ErrorText error={error} />
        {status && <p className="ok" role="status">{status}</p>}
        <button className="primary big">Invia indicazione</button>
        <p className="muted" style={{ fontSize: 14 }}>Per commentare un check apri la sezione Check del profilo.</p>
      </form>
    </Sheet>
  );
}

function AthleteSettingsSheet({ open, athlete, onClose, onChanged }: { open: boolean; athlete: AthleteSummaryDto; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  const [link, setLink] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={() => { setConfirmUnlink(false); onClose(); }} title="Impostazioni atleta" kicker={athlete.displayName}>
      <label>Giorno del check ricorrente
        <select value={athlete.checkWeekday ?? ''} data-testid="check-weekday" onChange={(e) => void patch(`/coach/athletes/${athlete.id}`, { checkWeekday: e.target.value === '' ? null : Number(e.target.value) }).then(onChanged).catch((x: unknown) => setErr(errorMessage(x)))}>
          <option value="">Nessuno</option>
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </label>
      <button onClick={() => void post<{ url: string }>(`/coach/athletes/${athlete.id}/recovery-link`).then((r) => setLink(r.url)).catch((x: unknown) => setErr(errorMessage(x)))}>Genera link di recupero accesso</button>
      {link && <><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link di recupero" /><small>Valido 1 ora, monouso. Consegnalo solo all'atleta.</small></>}
      {confirmUnlink ? (
        <div className="grid2">
          <button className="danger" onClick={() => void del(`/coach/athletes/${athlete.id}`).then(() => nav('/atleti'))}>Conferma</button>
          <button onClick={() => setConfirmUnlink(false)}>Annulla</button>
        </div>
      ) : (
        <button className="quiet" onClick={() => setConfirmUnlink(true)}>Scollega atleta (perdi subito l'accesso ai suoi dati)</button>
      )}
      <ErrorText error={err} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ domanda / indicazioni su un esercizio

export function ExerciseThreadPage() {
  const { athleteId = '', key = '' } = useParams();
  const exKey = decodeURIComponent(key);
  const nav = useNavigate();
  const athlete = useAsync(() => get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`), [athleteId]);
  const ctx = useAsync(() => get<ExerciseContextDto>(`/exercises/${encodeURIComponent(exKey)}/context?userId=${athleteId}`), [athleteId, exKey]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = ctx.data;
  const pending = c?.questions.filter((q) => !q.answer).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const name = c?.questions[0]?.exerciseName ?? exKey;
  const items = c ? [
    ...c.questions.flatMap((q) => [
      { id: `q${q.id}`, at: q.createdAt, who: 'in' as const, meta: `${athlete.data?.displayName ?? 'Atleta'} · ${fmtShort(q.createdAt)}${q.answer ? '' : ' · in attesa'}`, body: q.body, hot: !q.answer },
      ...(q.answer && q.answeredAt ? [{ id: `a${q.id}`, at: q.answeredAt, who: 'out' as const, meta: `Tu · ${fmtShort(q.answeredAt)}`, body: q.answer, hot: false }] : []),
    ]),
    ...c.feedback.map((f) => ({ id: `f${f.id}`, at: f.createdAt, who: 'note' as const, meta: `Tua indicazione · ${fmtShort(f.createdAt)}`, body: f.body, hot: false })),
  ].sort((a, b) => a.at.localeCompare(b.at)) : [];
  const lastWork = (c?.lastSets ?? []).filter((s) => s.kind === 'work');

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (pending) await post(`/questions/${pending.id}/answer`, { answer: text.trim() });
      else await post(`/coach/athletes/${athleteId}/exercise-feedback`, { exerciseName: name, body: text.trim() });
      setText('');
      ctx.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingBottom: 200 }}>
      <TopBar title={name} athlete={athlete.data ? { id: athlete.data.id, name: athlete.data.displayName } : null} />
      <main className="page">
        <div className="inset row" style={{ fontSize: 14 }}><span className="muted">Ultima prestazione{c?.lastDate ? ` · ${fmtShort(c.lastDate)}` : ''}</span><strong className="num">{lastWork.length ? lastWork.map(fmtSet).join(' · ') : 'nessuna'}</strong></div>
        {!c ? <Loading /> : (
          <div className="thread" data-testid="coach-thread">
            {items.length === 0 && <p className="muted">Nessun messaggio su questo esercizio.</p>}
            {items.map((m) => (
              <div key={m.id} className={`bubble ${m.who === 'in' ? 'in' : 'out'} ${m.hot || m.who === 'note' ? 'note' : ''}`} style={m.who === 'note' ? { background: 'var(--card)', border: '1px solid var(--pri)' } : undefined}>
                <span className="meta" style={m.hot ? { color: 'var(--pri-ink)' } : undefined}>{m.meta}</span>{m.body}
              </div>
            ))}
          </div>
        )}
        <ErrorText error={error ?? ctx.error} />
      </main>
      <div className="dock">
        <form className="inner" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label>{pending ? 'Risposta alla domanda' : 'Indicazione sull\'esercizio'}
            <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} data-testid="answer-text" style={{ minHeight: 72 }} />
          </label>
          <button className="primary big" disabled={busy || !text.trim()}>{pending ? 'Invia risposta' : 'Invia indicazione'}</button>
          {pending && <button type="button" className="quiet" onClick={() => void post(`/coach/review/question/${pending.id}`).then(() => nav(-1))}>Segna come vista senza rispondere</button>}
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ check

export function CoachChecksPage() {
  const queue = useAsync(() => get<ReviewItemDto[]>('/coach/review'), []);
  const athletes = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const checks = queue.data?.filter((i) => i.type === 'check') ?? [];
  return (
    <>
      <TopBar title="Check" />
      <main className="page">
        <ErrorText error={queue.error ?? athletes.error} />
        <section>
          <h2 className="title-n" style={{ marginBottom: 4 }}>Da rivedere · {queue.data ? checks.length : '–'}</h2>
          {!queue.data ? <Loading /> : checks.length === 0 ? <p className="muted">Nessun check da rivedere.</p> : (
            <div className="card tight">
              {checks.map((i) => (
                <Link key={i.id} to={reviewHref(i)} className="list-row" data-testid="review-item">
                  <span className="av hot">{initials(i.athleteName)}</span>
                  <span className="spacer"><strong style={{ fontWeight: 600 }}>{i.athleteName}</strong><small style={{ display: 'block' }}>{i.title} · {i.detail}</small></span>
                  <Icon name="right" className="chev" />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section>
          <h2 className="title-n" style={{ marginBottom: 4 }}>Ultimo check per atleta</h2>
          <div className="card tight">
            {athletes.data?.map((a) => (
              <Link key={a.id} to={a.lastCheck ? `/atleti/${a.id}/check/${a.lastCheck.id}` : `/atleti/${a.id}?tab=check`} className="list-row">
                <span className="av">{initials(a.displayName)}</span>
                <span className="spacer">{a.displayName}<small style={{ display: 'block' }}>{a.lastCheck ? fmtDate(a.lastCheck.checkDate) : 'nessun check'}{a.checkWeekday !== null ? ` · check il ${WEEKDAYS[a.checkWeekday]?.toLowerCase()}` : ''}</small></span>
                <Icon name="right" className="chev" />
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

/** Revisione di un check: foto solo se autorizzate (il server le filtra), confronto con il check precedente, feedback. */
export function CheckReviewPage() {
  const { athleteId = '', checkId = '' } = useParams();
  const nav = useNavigate();
  const athlete = useAsync(() => get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`), [athleteId]);
  const checks = useAsync(() => get<CheckDto[]>(`/checks?userId=${athleteId}`), [athleteId]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sorted = [...(checks.data ?? [])].sort((a, b) => a.checkDate.localeCompare(b.checkDate));
  const idx = sorted.findIndex((c) => c.id === checkId);
  const check = sorted[idx];
  const prev = idx > 0 ? sorted[idx - 1] : undefined;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await post(`/checks/${checkId}/feedback`, { body: text.trim() });
      setText('');
      checks.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingBottom: 220 }}>
      <TopBar title={check ? `Check ${fmtShort(check.checkDate)}` : 'Check'} athlete={athlete.data ? { id: athlete.data.id, name: athlete.data.displayName } : null}
        action={check ? <span className={`tag ${check.sharePhotos ? 'ok' : ''}`}>{check.sharePhotos ? 'foto condivise' : check.photoCount ? 'foto private' : 'senza foto'}</span> : undefined} />
      <main className="page" data-testid="coach-check">
        <ErrorText error={checks.error ?? error} />
        {!checks.data ? <Loading /> : !check ? <Empty>Check non trovato.</Empty> : (
          <>
            {prev ? <CompareView checks={sorted} initialA={prev.id} initialB={check.id} /> : (
              <div className="card stack">
                {check.photos.length ? <div className="photos3" data-testid="coach-check-photos">{check.photos.map((p) => <img key={p.id} className="photo" src={`/api/photos/${p.id}`} alt={p.pose} />)}</div>
                  : <p className="muted">{check.photoCount ? 'L\'atleta non ha condiviso le foto di questo check.' : 'Nessuna foto.'}</p>}
                <table><tbody>{MEASURES.map(([k, l, u]) => <tr key={k}><td className="muted">{l}</td><td style={{ textAlign: 'right' }}>{(check[k] as number | null)?.toLocaleString('it-IT') ?? '—'}{check[k] !== null ? u : ''}</td></tr>)}</tbody></table>
              </div>
            )}
            {prev && check.photoCount > 0 && !check.sharePhotos && <p className="muted">L'atleta non ha condiviso le foto di questo check.</p>}
            {prev && check.photos.length > 0 && (
              <section className="stack" data-testid="coach-check-photos">
                <p className="cap">Foto del check · condivise dall'atleta</p>
                <div className="photos3">{check.photos.map((p) => <img key={p.id} className="photo" src={`/api/photos/${p.id}`} alt={p.pose} loading="lazy" />)}</div>
              </section>
            )}
            {check.note && <p className="sub">«{check.note}»</p>}
            <div className="thread">
              {check.feedback.map((f) => <div key={f.id} className="bubble out"><span className="meta">Tu · {fmtShort(f.createdAt)}</span>{f.body}</div>)}
            </div>
          </>
        )}
      </main>
      {check && (
        <div className="dock">
          <form className="inner" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(); }}>
            <label>Feedback sul check · l'atleta lo vede dentro il check
              <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Scrivi un'indicazione…" data-testid="check-feedback-text" style={{ minHeight: 72 }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <button type="button" disabled={!!check.reviewedAt} onClick={() => void post(`/coach/review/check/${check.id}`).then(() => nav(-1))} data-testid="check-seen">{check.reviewedAt ? 'Rivisto' : 'Visto'}</button>
              <button className="primary" disabled={busy || !text.trim()}>Invia feedback</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
