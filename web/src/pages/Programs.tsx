import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  buildExercise, newId, summarizeChanges,
  type AthleteSummaryDto, type DaySpec, type ExerciseSpec, type PdfImportResultDto, type ProgramContent, type ProgramDetailDto, type ProgramSummaryDto,
} from '@palestra/shared';
import { api, del, errorMessage, get, post, put } from '../lib/api';
import { daysUntil, fmtShort, periodLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { Empty, ErrorText, Loading, Segmented, Sheet, TopBar } from '../components/ui';
import { Icon } from '../components/icons';
import { AssignSheet } from '../components/AssignSheet';

/** Contesto: scheda personale (/scheda), libreria coach (/schede) o scheda di un atleta (/atleti/:id/scheda). */
export function useAthleteContext(): { athleteId: string | undefined; athlete: AthleteSummaryDto | undefined; base: string } {
  const { athleteId } = useParams();
  const loc = useLocation();
  const { data } = useAsync(() => (athleteId ? get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`) : Promise.resolve(undefined)), [athleteId]);
  const base = athleteId ? `/atleti/${athleteId}/scheda` : loc.pathname.startsWith('/schede') ? '/schede' : '/scheda';
  return { athleteId, athlete: data, base };
}

const athleteRef = (a: AthleteSummaryDto | undefined) => (a ? { id: a.id, name: a.displayName } : null);

function CreateSheet({ open, onClose, base }: { open: boolean; onClose: () => void; base: string }) {
  return (
    <Sheet open={open} onClose={onClose} title="Nuova scheda">
      <Link className="btn wide" to={`${base}/nuova`}><Icon name="edit" />Creala a mano</Link>
      <Link className="btn wide" to={`${base}/importa`}><Icon name="file" />Importa PDF</Link>
    </Sheet>
  );
}

function ExerciseLine({ e }: { e: ExerciseSpec }) {
  const tb = e.topSets !== null && e.backoffSets ? `${e.topSets} top set ${e.topReps ?? ''} · ${e.backoffSets} back-off${e.backoffPct !== null ? ` −${e.backoffPct}%` : ''}${e.backoffReps ? ` × ${e.backoffReps}` : ''}` : null;
  return (
    <div className="list-row" style={{ display: 'grid', gap: 2, alignItems: 'start' }}>
      <div className="row"><strong style={{ fontWeight: 600 }}>{e.name}</strong><span className="muted" style={{ whiteSpace: 'nowrap' }}>rec {e.restRaw || '—'}</span></div>
      <span className="sub" style={{ fontSize: 15 }}>{tb ?? `${e.sets ?? '?'} serie · ${e.repsRaw}`}</span>
      {tb && <small>Originale: {e.setsRaw} · {e.repsRaw}</small>}
      {e.notes && <small>Nota: {e.notes}</small>}
    </div>
  );
}

/** Scheda (atleta e "Il mio allenamento") e schede di un atleta aperte dal coach. */
export function ProgramsPage() {
  const { athleteId, athlete, base } = useAthleteContext();
  const q = athleteId ? `?userId=${athleteId}` : '';
  const { data, error, loading, reload } = useAsync(() => get<ProgramSummaryDto[]>(`/programs${q}`), [q]);
  const [sel, setSel] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const current = data?.find((p) => p.id === sel) ?? data?.[0];
  const dayIdx = day ?? current?.nextDayIndex ?? 0;

  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Scheda" athlete={athleteRef(athlete)}
        action={<button type="button" className="icon-btn" aria-label="Nuova scheda: creala a mano o importa PDF" onClick={() => setCreating(true)} data-testid="new-program"><Icon name="plus" /></button>} />
      <main className="page">
        <ErrorText error={error ?? err} />
        {loading && !data && <Loading />}
        {data?.length === 0 && <Empty action={<button className="primary" onClick={() => setCreating(true)}>Crea la prima scheda</button>}>Nessuna scheda ancora.</Empty>}
        {data?.map((p) => {
          const isOpen = p.id === current?.id;
          const exp = p.endDate ? daysUntil(p.endDate) : null;
          return (
            <article key={p.id} className={`card ${isOpen ? '' : ''}`} style={{ display: 'grid', gap: 12, padding: isOpen ? 16 : '4px 16px' }} data-testid="program-card">
              <button type="button" className="list-row" style={{ borderTop: 0, padding: 0 }} aria-expanded={isOpen} onClick={() => { setSel(p.id); setDay(null); }}>
                <span className="spacer">
                  <strong style={{ fontSize: 18 }}>{p.name}</strong>
                  <span className="row-start" style={{ marginTop: 6 }}>
                    <span className="muted">v{p.versionNo}</span>
                    {periodLabel(p.startDate, p.endDate) && <span className={`tag ${exp !== null && exp <= 7 ? 'warn' : ''}`}>{periodLabel(p.startDate, p.endDate)}{exp !== null && exp < 0 ? ' · scaduta' : ''}</span>}
                    {p.hasDraft && <span className="tag warn">Bozza non pubblicata</span>}
                  </span>
                </span>
                <Icon name={isOpen ? 'up' : 'down'} className="chev" />
              </button>
              {isOpen && (
                <>
                  <div className="scroller" role="group" aria-label="Giorni">
                    {p.content.days.map((d, i) => (
                      <button key={d.id} type="button" className="pill" aria-pressed={i === dayIdx} onClick={() => setDay(i)}>
                        {d.name}{i === p.nextDayIndex ? ' ●' : ''}
                      </button>
                    ))}
                  </div>
                  <div>{p.content.days[dayIdx]?.exercises.map((e) => <ExerciseLine key={e.id} e={e} />)}</div>
                  <div className="grid3">
                    <button className="small-btn" onClick={() => nav(`${base}/${p.id}/modifica`)} data-testid="edit-program">Modifica</button>
                    <button className="small-btn" disabled={busy} onClick={() => void action(() => post(`/programs/${p.id}/duplicate`, athleteId ? { ownerId: athleteId } : {}))}>Duplica</button>
                    <button className="small-btn" disabled={busy} onClick={() => void action(() => post(`/programs/${p.id}/archive`, { archived: true }))}>Archivia</button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </main>
      <CreateSheet open={creating} onClose={() => setCreating(false)} base={base} />
    </>
  );
}

/** Area coach → Schede: le proprie (usate anche in "Il mio allenamento") e quelle degli atleti. */
export function CoachProgramsPage() {
  const [view, setView] = useState<'mine' | 'athletes'>('mine');
  const mine = useAsync(() => get<ProgramSummaryDto[]>('/programs'), []);
  const athletes = useAsync(() => get<AthleteSummaryDto[]>('/coach/athletes'), []);
  const [assign, setAssign] = useState<ProgramSummaryDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const nav = useNavigate();
  return (
    <>
      <TopBar title="Schede" action={<button type="button" className="icon-btn" aria-label="Nuova scheda" onClick={() => setCreating(true)} data-testid="new-program"><Icon name="plus" /></button>} />
      <main className="page">
        <Segmented label="Elenco schede" value={view} onChange={setView} options={[['mine', `Le mie${mine.data ? ` · ${mine.data.length}` : ''}`], ['athletes', 'Degli atleti']]} />
        {msg && <p className="ok" role="status">{msg}</p>}
        <ErrorText error={mine.error ?? athletes.error} />
        {view === 'mine' ? (
          <>
            {!mine.data && <Loading />}
            {mine.data?.length === 0 && <Empty action={<button className="primary" onClick={() => setCreating(true)}>Crea una scheda</button>}>Nessuna scheda.</Empty>}
            {mine.data?.map((p) => (
              <article key={p.id} className="card stack" data-testid="program-card">
                <div className="row"><strong style={{ fontSize: 17 }}>{p.name}</strong><span className="muted">v{p.versionNo}</span></div>
                <div className="row-start">
                  <span className="tag">{p.content.days.length} giorni</span>
                  <span className="tag ok">usata nel mio allenamento</span>
                  {p.hasDraft && <span className="tag warn">bozza non pubblicata</span>}
                </div>
                <div className="grid3">
                  <button className="small-btn" onClick={() => setAssign(p)} data-testid="assign-from-program">Assegna</button>
                  <button className="small-btn" onClick={() => nav(`/schede/${p.id}/modifica`)}>Modifica</button>
                  <button className="small-btn" disabled={busy} onClick={() => { setBusy(true); void post(`/programs/${p.id}/duplicate`, {}).then(() => { mine.reload(); setMsg('Copia creata'); }).finally(() => setBusy(false)); }}>Duplica</button>
                </div>
              </article>
            ))}
          </>
        ) : (
          <div className="card tight">
            {!athletes.data && <Loading />}
            {athletes.data?.length === 0 && <p className="muted" style={{ padding: 12 }}>Nessun atleta collegato.</p>}
            {athletes.data?.map((a) => {
              const exp = a.activeProgram?.endDate ? daysUntil(a.activeProgram.endDate) : null;
              return (
                <Link key={a.id} to={`/atleti/${a.id}/scheda`} className="list-row">
                  <span className="spacer"><strong style={{ fontWeight: 600 }}>{a.displayName}</strong>
                    <small style={{ display: 'block' }}>{a.activeProgram ? `${a.activeProgram.name}${a.activeProgram.endDate ? ` · fino ${fmtShort(a.activeProgram.endDate)}` : ''}` : 'Nessuna scheda'}</small></span>
                  {exp !== null && exp <= 7 && <span className="tag warn">{exp < 0 ? 'scaduta' : 'in scadenza'}</span>}
                  <Icon name="right" className="chev" />
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <CreateSheet open={creating} onClose={() => setCreating(false)} base="/schede" />
      <AssignSheet open={!!assign} program={assign ?? undefined} onClose={() => setAssign(null)} onDone={() => { setAssign(null); setMsg('Scheda assegnata'); athletes.reload(); }} />
    </>
  );
}

// ------------------------------------------------------------------- editor

interface EditorValue { name: string; startDate: string | null; endDate: string | null; content: ProgramContent }

function rebuild(ex: ExerciseSpec, patch: Partial<Pick<ExerciseSpec, 'name' | 'setsRaw' | 'repsRaw' | 'restRaw' | 'notes'>>): ExerciseSpec {
  const n = { ...ex, ...patch };
  return buildExercise({ id: ex.id, name: n.name, setsRaw: n.setsRaw, repsRaw: n.repsRaw, restRaw: n.restRaw, notes: n.notes }).exercise;
}

function blankExercise(): ExerciseSpec {
  return { ...buildExercise({ name: 'x', setsRaw: '3', repsRaw: '10-6', restRaw: '2’-3’' }).exercise, name: '' };
}

const FIELDS: (keyof ExerciseSpec)[] = ['name', 'setsRaw', 'repsRaw', 'restRaw', 'notes'];

/** Stato rispetto alla versione pubblicata (solo in Modifica scheda): nuovo / modificato / invariato. */
function changeOf(ex: ExerciseSpec, dayId: string, idx: number, base: ProgramContent | null): 'new' | 'changed' | null {
  if (!base) return null;
  const bDay = base.days.find((d) => d.id === dayId);
  const bIdx = bDay?.exercises.findIndex((e) => e.id === ex.id) ?? -1;
  const b = bDay?.exercises[bIdx];
  if (!b) return 'new';
  return FIELDS.some((k) => b[k] !== ex[k]) || bIdx !== idx ? 'changed' : null;
}

function restLabel(ex: ExerciseSpec): string {
  return ex.restSeconds ? `timer ${Math.floor(ex.restSeconds.max / 60)}:${String(ex.restSeconds.max % 60).padStart(2, '0')}` : 'recupero libero';
}

function ProgramEditor({ value, onChange, doubts, baseline }: { value: EditorValue; onChange: (v: EditorValue) => void; doubts: Record<string, string[]>; baseline: ProgramContent | null }) {
  const days = value.content.days;
  const [dayIdx, setDayIdx] = useState(0);
  const [openEx, setOpenEx] = useState<string | null>(null);
  const [dayMenu, setDayMenu] = useState(false);
  const [rename, setRename] = useState('');
  const di = Math.min(dayIdx, days.length - 1);
  const d = days[di];
  const setDays = (next: DaySpec[]) => onChange({ ...value, content: { days: next } });
  const updDay = (nd: DaySpec) => setDays(days.map((x, j) => (j === di ? nd : x)));
  const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const c = [...arr];
    [c[i], c[j]] = [c[j] as T, c[i] as T];
    return c;
  };
  const dayChanged = (day: DaySpec, i: number) => !!baseline && (baseline.days[i]?.id !== day.id || day.exercises.some((e, k) => changeOf(e, day.id, k, baseline)) || (baseline.days.find((b) => b.id === day.id)?.exercises.length ?? -1) !== day.exercises.length || baseline.days.find((b) => b.id === day.id)?.name !== day.name);
  const dayDoubt = (i: number) => Object.keys(doubts).some((k) => k === `day:${i}` || k.startsWith(`${i}:`));

  return (
    <div className="stack">
      <div className="card stack">
        <label>Nome scheda<input value={value.name} maxLength={80} required onChange={(e) => onChange({ ...value, name: e.target.value })} data-testid="program-name" /></label>
        <div className="grid2">
          <label>Inizio<input type="date" value={value.startDate ?? ''} onChange={(e) => onChange({ ...value, startDate: e.target.value || null })} /></label>
          <label>Fine<input type="date" value={value.endDate ?? ''} onChange={(e) => onChange({ ...value, endDate: e.target.value || null })} /></label>
        </div>
      </div>
      {doubts.global?.map((m) => <p key={m} className="doubt">{m}</p>)}
      <div className="row" style={{ gap: 8 }}>
        <div className="scroller" role="group" aria-label="Giorni" style={{ flex: 1, margin: 0, padding: 0 }}>
          {days.map((x, i) => (
            <button key={x.id} type="button" className="pill" aria-pressed={i === di} onClick={() => { setDayIdx(i); setOpenEx(null); }} data-testid={`editor-daytab-${i}`}>
              {x.name}{dayChanged(x, i) ? ' •' : ''}{dayDoubt(i) ? ' !' : ''}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Giorni: aggiungi, rinomina, sposta, rimuovi" onClick={() => { setRename(d?.name ?? ''); setDayMenu(true); }} data-testid="day-menu"><Icon name="more" /></button>
      </div>
      {d && (
        <section className="stack" data-testid={`editor-day-${di}`} aria-label={d.name}>
          {doubts[`day:${di}`]?.map((m) => <p key={m} className="doubt">{m}</p>)}
          {d.exercises.map((ex, ei) => {
            const ch = changeOf(ex, d.id, ei, baseline);
            const exDoubts = doubts[`${di}:${ei}`];
            const isOpen = openEx === ex.id || !ex.name;
            const upd = (patch: Parameters<typeof rebuild>[1]) => updDay({ ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, patch) : x)) });
            return (
              <div key={ex.id} className={`ed-card ${isOpen ? 'open' : ''}`} data-testid={`editor-ex-${di}-${ei}`}>
                <button type="button" className="ed-head" aria-expanded={isOpen} onClick={() => setOpenEx(isOpen && ex.name ? null : ex.id)}>
                  <span className="muted" style={{ width: 22 }}>{ei + 1}</span>
                  <span className="spacer" style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontWeight: 600 }}>{ex.name || 'Nuovo esercizio'}</strong>
                    <span className={exDoubts ? 'warn' : 'muted'} style={{ fontSize: 14 }}>{ex.setsRaw || '?'} × {ex.repsRaw || '?'} · {ex.restRaw || 'rec —'}{exDoubts ? ' · da verificare' : ''}</span>
                  </span>
                  {ch && <span className="tag hot" data-testid="change-label">{ch === 'new' ? 'Nuovo' : 'Modificato'}</span>}
                  <Icon name={isOpen ? 'up' : 'down'} className="chev" />
                </button>
                {isOpen && (
                  <div className="ed-body">
                    <label>Esercizio {ei + 1}<input value={ex.name} maxLength={120} placeholder="Nome esercizio" onChange={(e) => upd({ name: e.target.value })} /></label>
                    <div className="grid3">
                      <label>Serie<input value={ex.setsRaw} maxLength={120} onChange={(e) => upd({ setsRaw: e.target.value })} /></label>
                      <label>Ripetizioni<input value={ex.repsRaw} maxLength={120} onChange={(e) => upd({ repsRaw: e.target.value })} /></label>
                      <label>Recupero<input value={ex.restRaw} maxLength={60} onChange={(e) => upd({ restRaw: e.target.value })} /></label>
                    </div>
                    <label>Note e tecnica<input value={ex.notes} maxLength={500} onChange={(e) => upd({ notes: e.target.value })} /></label>
                    <p className="muted" style={{ fontSize: 14 }}>
                      L'atleta vedrà: {ex.sets ?? '?'} serie{ex.topSets !== null && ex.backoffSets ? ` (${ex.topSets} top + ${ex.backoffSets} back-off${ex.backoffPct !== null ? ` −${ex.backoffPct}%` : ''})` : ''} · «{ex.repsRaw}» · {restLabel(ex)}
                    </p>
                    {exDoubts?.map((m) => <p key={m} className="doubt">Da verificare: {m}</p>)}
                    <div className="row-start">
                      <button type="button" className="small-btn icon-btn" onClick={() => updDay({ ...d, exercises: move(d.exercises, ei, -1) })} aria-label="Sposta su"><Icon name="up" /></button>
                      <button type="button" className="small-btn icon-btn" onClick={() => updDay({ ...d, exercises: move(d.exercises, ei, 1) })} aria-label="Sposta giù"><Icon name="down" /></button>
                      <span className="spacer" />
                      <button type="button" className="small-btn danger" onClick={() => updDay({ ...d, exercises: d.exercises.filter((x) => x.id !== ex.id) })}>Rimuovi esercizio</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="dashed" onClick={() => { const nx = blankExercise(); updDay({ ...d, exercises: [...d.exercises, nx] }); setOpenEx(nx.id); }} data-testid="add-exercise">+ Aggiungi esercizio</button>
        </section>
      )}
      <Sheet open={dayMenu} onClose={() => setDayMenu(false)} title={d?.name ?? 'Giorno'} kicker="Giorno">
        <form className="composer" onSubmit={(e) => { e.preventDefault(); if (d && rename.trim()) { updDay({ ...d, name: rename.trim() }); setDayMenu(false); } }}>
          <label style={{ flex: 1 }}>Nome del giorno<input value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} /></label>
          <button className="small-btn">Rinomina</button>
        </form>
        <div className="grid2">
          <button type="button" disabled={di === 0} onClick={() => { setDays(move(days, di, -1)); setDayIdx(di - 1); setDayMenu(false); }}>← Sposta prima</button>
          <button type="button" disabled={di >= days.length - 1} onClick={() => { setDays(move(days, di, 1)); setDayIdx(di + 1); setDayMenu(false); }}>Sposta dopo →</button>
        </div>
        <button type="button" onClick={() => { setDays([...days, { id: newId(), name: `Giorno ${days.length + 1}`, exercises: [blankExercise()] }]); setDayIdx(days.length); setDayMenu(false); }} data-testid="add-day">+ Aggiungi giorno</button>
        <button type="button" className="danger" disabled={days.length <= 1} onClick={() => { setDays(days.filter((x) => x.id !== d?.id)); setDayIdx(Math.max(0, di - 1)); setDayMenu(false); }} data-testid="remove-day">Rimuovi {d?.name}</button>
      </Sheet>
    </div>
  );
}

function validate(v: EditorValue): string | null {
  if (!v.name.trim()) return 'Dai un nome alla scheda';
  if (!v.content.days.length) return 'Serve almeno un giorno';
  if (v.startDate && v.endDate && v.endDate < v.startDate) return 'La data finale deve essere uguale o successiva a quella iniziale';
  for (const d of v.content.days) {
    if (!d.name.trim()) return 'Ogni giorno deve avere un nome';
    for (const e of d.exercises) if (!e.name.trim()) return `${d.name}: un esercizio non ha nome`;
  }
  return null;
}

function Dock({ children }: { children: React.ReactNode }) {
  return <div className="dock"><div className="inner">{children}</div></div>;
}

export function NewProgramPage({ mode }: { mode: 'manual' | 'pdf' }) {
  const { athleteId, athlete, base } = useAthleteContext();
  const nav = useNavigate();
  const [value, setValue] = useState<EditorValue | null>(
    mode === 'manual' ? { name: '', startDate: null, endDate: null, content: { days: [{ id: newId(), name: 'Giorno 1', exercises: [blankExercise()] }] } } : null,
  );
  const [imp, setImp] = useState<PdfImportResultDto | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doubts = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const d of imp?.doubts ?? []) (m[d.where] ??= []).push(d.message);
    return m;
  }, [imp]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<PdfImportResultDto>('POST', '/import/pdf', fd, { timeoutMs: 60_000 });
      setImp(r);
      if (r.content) setValue({ name: r.name, startDate: null, endDate: null, content: r.content });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!value) return;
    const v = validate(value);
    if (v) return setError(v);
    if (imp?.doubts.length && !confirmed) return setError('Conferma di aver controllato gli elementi segnalati');
    setBusy(true);
    setError(null);
    try {
      await post('/programs', { ...value, ownerId: athleteId });
      nav(base);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingBottom: value ? 120 : 0 }}>
      <TopBar title={mode === 'pdf' ? 'Importa PDF' : 'Nuova scheda'} athlete={athleteRef(athlete)} />
      <main className="page">
        {mode === 'pdf' && !value && (
          <div className="card stack">
            <p>Serve un PDF con testo selezionabile e tabelle <em>Esercizio · Serie · Ripetizioni · Recupero</em>. Otterrai una bozza da controllare prima del salvataggio.</p>
            <label className="btn primary">Scegli PDF
              <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="pdf-input" />
            </label>
            {busy && <Loading lines={2} />}
            {imp && imp.status === 'unreadable' && (
              <div className="doubt stack" role="alert">
                <p>{imp.message}</p>
                <Link to={`${base}/nuova`} className="btn small-btn">Inserisci a mano</Link>
              </div>
            )}
            <ErrorText error={error} />
          </div>
        )}
        {imp?.content && <p className={imp.status === 'ok' ? 'ok' : 'warn'} data-testid="import-message">{imp.message}</p>}
        {value && <ProgramEditor value={value} onChange={setValue} doubts={doubts} baseline={null} />}
        {value && !!imp?.doubts.length && (
          <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="confirm-review" /> Ho controllato gli elementi segnalati</label>
        )}
        {value && <ErrorText error={error} />}
      </main>
      {value && <Dock><button className="primary big" disabled={busy} onClick={() => void save()} data-testid="save-program">Salva scheda</button></Dock>}
    </div>
  );
}

export function EditProgramPage() {
  const { programId } = useParams();
  const { athlete, base } = useAthleteContext();
  const nav = useNavigate();
  const { data, error: loadError, setData } = useAsync(() => get<ProgramDetailDto>(`/programs/${programId}`), [programId]);
  const [value, setValue] = useState<EditorValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !value) setValue(data.draft ? { ...data.draft } : { name: data.name, startDate: data.startDate, endDate: data.endDate, content: data.content });
  }, [data, value]);

  const changes = useMemo(() => (data && value ? summarizeChanges(data.content, value.content) : []), [data, value]);

  async function run(fn: () => Promise<void>) {
    if (!value) return;
    const v = validate(value);
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data || !value) return <><TopBar title="Modifica scheda" athlete={athleteRef(athlete)} /><main className="page">{loadError ? <ErrorText error={loadError} /> : <Loading />}</main></>;
  return (
    <div style={{ paddingBottom: 150 }}>
      <TopBar title="Modifica scheda" athlete={athleteRef(athlete)} kicker={data.name}>
        <p className="muted">Pubblicata v{data.versionNo}{data.draft ? ` · bozza salvata ${fmtShort(data.draft.updatedAt)}` : ''}</p>
      </TopBar>
      <main className="page">
        <ProgramEditor value={value} onChange={setValue} doubts={{}} baseline={data.content} />
        <ErrorText error={error} />
        {status && <p className="ok" role="status">{status}</p>}
        {data.draft && <button className="quiet" onClick={() => void run(async () => { const d = await del<ProgramDetailDto>(`/programs/${data.id}/draft`); setData(d); setValue({ name: d.name, startDate: d.startDate, endDate: d.endDate, content: d.content }); setStatus('Bozza scartata'); })}>Scarta bozza</button>}
      </main>
      <Dock>
        <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>{changes.length ? `${changes.length} modifiche non pubblicate · valgono dalla prossima seduta` : 'Nessuna modifica rispetto alla versione pubblicata'}</p>
        <div className="grid2">
          <button disabled={busy} onClick={() => void run(async () => { setData(await put<ProgramDetailDto>(`/programs/${data.id}/draft`, value)); setStatus('Bozza salvata: non è ancora visibile nelle sedute.'); })} data-testid="save-draft">Salva bozza</button>
          <button className="primary" disabled={busy} onClick={() => { setSummary(''); setPublishOpen(true); }} data-testid="open-publish">Pubblica modifica</button>
        </div>
      </Dock>
      <Sheet open={publishOpen} onClose={() => setPublishOpen(false)} title="Pubblica modifica" kicker={`Versione ${data.versionNo + 1}`}>
        <p className="sub">Vale dalla prossima seduta: le sedute in corso e lo storico restano sulla versione eseguita.</p>
        <div className="card">
          <p className="cap">Riepilogo per l'atleta</p>
          {changes.length ? <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{changes.slice(0, 12).map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted">Nessuna modifica agli esercizi.</p>}
        </div>
        <label>Messaggio (facoltativo, sostituisce il riepilogo)<textarea value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} /></label>
        <button className="primary big" disabled={busy} data-testid="confirm-publish" onClick={() => void run(async () => {
          await post(`/programs/${data.id}/publish`, { ...value, summary: summary.trim() || null });
          setPublishOpen(false);
          nav(base);
        })}>Pubblica versione {data.versionNo + 1}</button>
      </Sheet>
    </div>
  );
}
