import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  buildExercise, newId, summarizeChanges,
  type AthleteSummaryDto, type DaySpec, type ExerciseSpec, type PdfImportResultDto, type ProgramContent, type ProgramDetailDto, type ProgramSummaryDto,
} from '@palestra/shared';
import { api, errorMessage, get, post, put, del } from '../lib/api';
import { useUser } from '../lib/auth';
import { daysUntil, periodLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { ErrorText, Sheet, TopBar } from '../components/ui';

/** Contesto atleta (coach che lavora sul profilo di un atleta) dalla route /atleti/:athleteId/... */
export function useAthleteContext(): { athleteId: string | undefined; athlete: AthleteSummaryDto | undefined; base: string } {
  const { athleteId } = useParams();
  const { data } = useAsync(() => (athleteId ? get<AthleteSummaryDto>(`/coach/athletes/${athleteId}`) : Promise.resolve(undefined)), [athleteId]);
  return { athleteId, athlete: data, base: athleteId ? `/atleti/${athleteId}/scheda` : '/scheda' };
}

export function ProgramsPage() {
  const user = useUser();
  const { athleteId, athlete, base } = useAthleteContext();
  const q = athleteId ? `?userId=${athleteId}` : '';
  const { data, error, reload } = useAsync(() => get<ProgramSummaryDto[]>(`/programs${q}`), [q]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  async function action(fn: () => Promise<unknown>, id: string) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar title="Scheda" athleteName={athlete?.displayName} />
      <main className="page stack">
        <div className="grid2">
          <Link className="btn" to={`${base}/nuova`}>Creala a mano</Link>
          <Link className="btn" to={`${base}/importa`}>Importa PDF</Link>
        </div>
        <ErrorText error={error ?? err} />
        {data?.length === 0 && <p className="empty">Nessuna scheda. Creane una o importa un PDF.</p>}
        {data?.map((p) => {
          const exp = p.endDate ? daysUntil(p.endDate) : null;
          return (
            <article key={p.id} className="card" data-testid="program-card">
              <div className="row">
                <h3>{p.name}</h3>
                <span className="chip">v{p.versionNo}</span>
              </div>
              <div className="row-start">
                {periodLabel(p.startDate, p.endDate) && <span className={`chip ${exp !== null && exp <= 7 ? 'warn' : ''}`}>{periodLabel(p.startDate, p.endDate)}{exp !== null && exp < 0 ? ' · scaduta' : ''}</span>}
                {p.hasDraft && <span className="chip warn">Bozza non pubblicata</span>}
                <span className="chip">Prossimo: {p.content.days[p.nextDayIndex]?.name}</span>
              </div>
              <details style={{ marginTop: 8 }}>
                <summary>{p.content.days.length} giorni</summary>
                {p.content.days.map((d) => (
                  <div key={d.id} className="line">
                    <strong>{d.name}</strong>
                    <table><tbody>
                      {d.exercises.map((e) => <tr key={e.id}><td>{e.name}</td><td>{e.setsRaw}</td><td>{e.repsRaw}</td><td>{e.restRaw}</td></tr>)}
                    </tbody></table>
                  </div>
                ))}
              </details>
              <div className="row-start" style={{ marginTop: 8 }}>
                <button className="small-btn" onClick={() => nav(`${base}/${p.id}/modifica`)}>Modifica scheda</button>
                <button className="small-btn" disabled={busy === p.id} onClick={() => void action(() => post(`/programs/${p.id}/duplicate`, athleteId ? { ownerId: athleteId } : {}), p.id)}>Duplica</button>
                <button className="small-btn quiet" disabled={busy === p.id} onClick={() => void action(() => post(`/programs/${p.id}/archive`, { archived: true }), p.id)}>Archivia</button>
              </div>
            </article>
          );
        })}
        {user.role === 'coach' && !athleteId && <p className="muted">Per assegnare una scheda a un atleta apri il suo profilo da Atleti → Assegna scheda.</p>}
      </main>
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
  return { ...buildExercise({ name: 'Nuovo esercizio', setsRaw: '3', repsRaw: '10-6', restRaw: '2’-3’' }).exercise, name: '' };
}

function ProgramEditor({ value, onChange, doubts }: { value: EditorValue; onChange: (v: EditorValue) => void; doubts: Record<string, string[]> }) {
  const setDays = (days: DaySpec[]) => onChange({ ...value, content: { days } });
  const days = value.content.days;
  const updDay = (i: number, d: DaySpec) => setDays(days.map((x, j) => (j === i ? d : x)));
  const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const c = [...arr];
    [c[i], c[j]] = [c[j] as T, c[i] as T];
    return c;
  };
  return (
    <div className="stack">
      <label>Nome scheda<input value={value.name} maxLength={80} required onChange={(e) => onChange({ ...value, name: e.target.value })} data-testid="program-name" /></label>
      <div className="grid2">
        <label>Inizio (facoltativo)<input type="date" value={value.startDate ?? ''} onChange={(e) => onChange({ ...value, startDate: e.target.value || null })} /></label>
        <label>Fine (facoltativa)<input type="date" value={value.endDate ?? ''} onChange={(e) => onChange({ ...value, endDate: e.target.value || null })} /></label>
      </div>
      {doubts.global?.map((m) => <p key={m} className="doubt">{m}</p>)}
      {days.map((d, di) => (
        <section key={d.id} className="card" data-testid={`editor-day-${di}`}>
          <div className="row">
            <input value={d.name} maxLength={60} aria-label="Nome giorno" onChange={(e) => updDay(di, { ...d, name: e.target.value })} style={{ fontWeight: 700 }} />
          </div>
          {doubts[`day:${di}`]?.map((m) => <p key={m} className="doubt">{m}</p>)}
          {d.exercises.map((ex, ei) => {
            const exDoubts = doubts[`${di}:${ei}`];
            return (
              <div key={ex.id} className="line stack" data-testid={`editor-ex-${di}-${ei}`}>
                <label>Esercizio {ei + 1}<input value={ex.name} maxLength={120} placeholder="Nome esercizio" onChange={(e) => updDay(di, { ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, { name: e.target.value }) : x)) })} /></label>
                <div className="grid3">
                  <label>Serie<input value={ex.setsRaw} maxLength={120} onChange={(e) => updDay(di, { ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, { setsRaw: e.target.value }) : x)) })} /></label>
                  <label>Ripetizioni<input value={ex.repsRaw} maxLength={120} onChange={(e) => updDay(di, { ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, { repsRaw: e.target.value }) : x)) })} /></label>
                  <label>Recupero<input value={ex.restRaw} maxLength={60} onChange={(e) => updDay(di, { ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, { restRaw: e.target.value }) : x)) })} /></label>
                </div>
                <label>Note<input value={ex.notes} maxLength={500} onChange={(e) => updDay(di, { ...d, exercises: d.exercises.map((x) => (x.id === ex.id ? rebuild(x, { notes: e.target.value }) : x)) })} /></label>
                <small className="muted">
                  {ex.sets ?? '?'} serie{ex.topSets !== null && ex.backoffSets ? ` · ${ex.topSets} top + ${ex.backoffSets} back-off${ex.backoffPct !== null ? ` −${ex.backoffPct}%` : ''}` : ''}
                  {ex.restSeconds ? ` · timer ${Math.round(ex.restSeconds.max / 60 * 10) / 10}′` : ' · recupero libero'}
                </small>
                {exDoubts?.map((m) => <p key={m} className="doubt">Da verificare: {m}</p>)}
                <div className="row-start">
                  <button type="button" className="small-btn" onClick={() => updDay(di, { ...d, exercises: move(d.exercises, ei, -1) })} aria-label="Sposta su">↑</button>
                  <button type="button" className="small-btn" onClick={() => updDay(di, { ...d, exercises: move(d.exercises, ei, 1) })} aria-label="Sposta giù">↓</button>
                  <button type="button" className="small-btn danger" onClick={() => updDay(di, { ...d, exercises: d.exercises.filter((x) => x.id !== ex.id) })}>Rimuovi esercizio</button>
                </div>
              </div>
            );
          })}
          <div className="row-start line">
            <button type="button" className="small-btn" onClick={() => updDay(di, { ...d, exercises: [...d.exercises, blankExercise()] })}>+ Esercizio</button>
            <button type="button" className="small-btn" onClick={() => setDays(move(days, di, -1))} aria-label="Sposta giorno su">↑</button>
            <button type="button" className="small-btn" onClick={() => setDays(move(days, di, 1))} aria-label="Sposta giorno giù">↓</button>
            <button type="button" className="small-btn danger" disabled={days.length <= 1} onClick={() => setDays(days.filter((x) => x.id !== d.id))}>Rimuovi giorno</button>
          </div>
        </section>
      ))}
      <button type="button" onClick={() => setDays([...days, { id: newId(), name: `Giorno ${days.length + 1}`, exercises: [blankExercise()] }])} data-testid="add-day">+ Aggiungi giorno</button>
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
    <>
      <TopBar title={mode === 'pdf' ? 'Importa PDF' : 'Nuova scheda'} athleteName={athlete?.displayName} />
      <main className="page stack">
        {mode === 'pdf' && !value && (
          <div className="card stack">
            <p>Il PDF deve avere testo selezionabile e tabelle con colonne <em>Esercizio · Serie · Ripetizioni · Recupero</em>. Otterrai una bozza da controllare prima del salvataggio.</p>
            <label className="btn primary">Scegli PDF
              <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="pdf-input" />
            </label>
            {busy && <p className="muted">Analizzo il PDF…</p>}
            {imp && imp.status === 'unreadable' && (
              <div className="doubt" role="alert">
                <p>{imp.message}</p>
                <Link to={`${base}/nuova`} className="btn small-btn">Inserisci a mano</Link>
              </div>
            )}
          </div>
        )}
        {imp?.content && <p className={imp.status === 'ok' ? 'ok' : 'warn'} data-testid="import-message">{imp.message}</p>}
        {value && (
          <>
            <ProgramEditor value={value} onChange={setValue} doubts={doubts} />
            {!!imp?.doubts.length && (
              <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="confirm-review" /> Ho controllato gli elementi segnalati</label>
            )}
            <ErrorText error={error} />
            <button className="primary" disabled={busy} onClick={() => void save()} data-testid="save-program">Salva scheda</button>
          </>
        )}
        {!value && <ErrorText error={error} />}
      </main>
    </>
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

  if (!data || !value) return <><TopBar title="Modifica scheda" athleteName={athlete?.displayName} /><main className="page"><ErrorText error={loadError} /></main></>;
  return (
    <>
      <TopBar title="Modifica scheda" athleteName={athlete?.displayName}>
        <small>Versione pubblicata: v{data.versionNo}{data.draft ? ' · bozza in corso' : ''}</small>
      </TopBar>
      <main className="page stack">
        <ProgramEditor value={value} onChange={setValue} doubts={{}} />
        <ErrorText error={error} />
        {status && <p className="ok" role="status">{status}</p>}
        <button className="primary" disabled={busy} onClick={() => { setSummary(''); setPublishOpen(true); }} data-testid="open-publish">Pubblica modifica</button>
        <button disabled={busy} onClick={() => void run(async () => { setData(await put<ProgramDetailDto>(`/programs/${data.id}/draft`, value)); setStatus('Bozza salvata: non è ancora visibile nelle sedute.'); })}>Salva bozza</button>
        {data.draft && <button className="quiet" onClick={() => void run(async () => { const d = await del<ProgramDetailDto>(`/programs/${data.id}/draft`); setData(d); setValue({ name: d.name, startDate: d.startDate, endDate: d.endDate, content: d.content }); setStatus('Bozza scartata'); })}>Scarta bozza</button>}
      </main>
      <Sheet open={publishOpen} onClose={() => setPublishOpen(false)} title="Pubblica modifica">
        <div className="stack">
          <p>Verrà creata la versione {data.versionNo + 1}. Vale dalla prossima seduta: le sedute in corso e lo storico restano sulla versione eseguita.</p>
          <div className="card">
            <strong>Riepilogo per l'atleta</strong>
            {changes.length ? <ul>{changes.slice(0, 12).map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted">Nessuna modifica agli esercizi.</p>}
          </div>
          <label>Messaggio (facoltativo, sostituisce il riepilogo)<textarea value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} /></label>
          <button className="primary" disabled={busy} data-testid="confirm-publish" onClick={() => void run(async () => {
            await post(`/programs/${data.id}/publish`, { ...value, summary: summary.trim() || null });
            setPublishOpen(false);
            nav(base);
          })}>Pubblica versione {data.versionNo + 1}</button>
        </div>
      </Sheet>
    </>
  );
}
