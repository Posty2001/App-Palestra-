import { LocalPhoto } from '../components/LocalPhoto';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POSE_LABEL, POSES, type CheckDto, type Pose } from '@palestra/shared';
import { api, del, errorMessage, get, patch, put, uuid } from '../lib/api';
import { fmtDate, fmtKg, fmtNum, fmtShort, parseNum, todayLocal } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { Empty, ErrorText, Loading, Segmented, Sheet, TopBar } from '../components/ui';
import { Icon } from '../components/icons';

export const MEASURES: [keyof CheckDto, string, string][] = [
  ['weightKg', 'Peso', ' kg'],
  ['bicepsCm', 'Bicipite', ' cm'],
  ['chestCm', 'Petto', ' cm'],
  ['thighCm', 'Coscia', ' cm'],
  ['waistCm', 'Addome', ' cm'],
];

export function ChecksPage() {
  const nav = useNavigate();
  const { data: checks, error, reload } = useAsync(() => get<CheckDto[]>('/checks'), []);
  const [weightOpen, setWeightOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <TopBar title="Check fisico" action={<button type="button" className="small-btn" onClick={() => setWeightOpen(true)} data-testid="add-weight">+ Peso</button>} />
      <main className="page">
        <button className="primary big" onClick={() => nav('/check/nuovo')}>Nuovo check</button>
        {msg && <p className="ok" role="status">{msg}</p>}
        <ErrorText error={error} />
        {!checks && !error && <Loading />}
        {checks && checks.length >= 1 && <CompareView checks={checks} />}
        {checks && <CheckList checks={checks} base="/check" />}
      </main>
      <AddWeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} onSaved={() => { reload(); setMsg('Peso salvato'); }} />
    </>
  );
}

export function CheckList({ checks, base }: { checks: CheckDto[]; base: string }) {
  if (!checks.length) return <Empty>Nessun check ancora. Il primo check sarà il punto di partenza dei confronti.</Empty>;
  return (
    <section className="stack">
      <h3 className="title-n">Tutti i check</h3>
      {checks.map((c) => (
        <Link key={c.id} to={`${base}/${c.id}`} className="link-card" data-testid="check-item">
          <span className="spacer"><strong>{fmtShort(c.checkDate)} · {fmtKg(c.weightKg)}</strong>
            <small style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{!c.sharePhotos && <Icon name="lock" size={14} />}{c.photoCount} foto · {c.sharePhotos ? 'condivise col coach' : 'private'}</small></span>
          {c.feedback.length > 0 && <span className="tag hot">Feedback</span>}
          <Icon name="right" className="chev" />
        </Link>
      ))}
    </section>
  );
}

/** Confronto: due date (di default primo e ultimo check), stessa posa affiancata, poi misure e differenze. */
export function CompareView({ checks, initialA, initialB }: { checks: CheckDto[]; initialA?: string; initialB?: string }) {
  const sorted = useMemo(() => [...checks].sort((a, b) => a.checkDate.localeCompare(b.checkDate)), [checks]);
  const [aId, setA] = useState(initialA ?? sorted[0]?.id ?? '');
  const [bId, setB] = useState(initialB ?? sorted[sorted.length - 1]?.id ?? '');
  const [pose, setPose] = useState<Pose>('front');
  useEffect(() => {
    setA(initialA ?? sorted[0]?.id ?? '');
    setB(initialB ?? sorted[sorted.length - 1]?.id ?? '');
  }, [sorted, initialA, initialB]);
  const a = sorted.find((c) => c.id === aId);
  const b = sorted.find((c) => c.id === bId);
  if (!a || !b) return null;
  return (
    <section className="card stack" data-testid="compare">
      <div className="grid2">
        <label>Da<select value={aId} onChange={(e) => setA(e.target.value)}>{sorted.map((c) => <option key={c.id} value={c.id}>{fmtDate(c.checkDate)}</option>)}</select></label>
        <label>A<select value={bId} onChange={(e) => setB(e.target.value)}>{sorted.map((c) => <option key={c.id} value={c.id}>{fmtDate(c.checkDate)}</option>)}</select></label>
      </div>
      <Segmented label="Posa" value={pose} onChange={setPose} options={POSES.map((p) => [p, POSE_LABEL[p]] as [Pose, string])} />
      <div className="photos2">
        {[a, b].map((c, i) => {
          const ph = c.photos.find((p) => p.pose === pose);
          return ph ? (
            <LocalPhoto key={i} className="photo" photoId={ph.id} alt={`${POSE_LABEL[pose]} ${fmtDate(c.checkDate)}`} loading="lazy" />
          ) : (
            <div key={i} className="photo-empty">{c.photoCount ? 'Foto non condivisa' : 'Nessuna foto'}<br />{fmtShort(c.checkDate)}</div>
          );
        })}
      </div>
      <table>
        <thead><tr><th /><th>{fmtShort(a.checkDate)}</th><th>{fmtShort(b.checkDate)}</th><th style={{ textAlign: 'right' }}>Diff.</th></tr></thead>
        <tbody>
          {MEASURES.map(([k, label, unit]) => {
            const va = a[k] as number | null;
            const vb = b[k] as number | null;
            const d = va !== null && vb !== null ? Math.round((vb - va) * 10) / 10 : null;
            return (
              <tr key={k}><td className="muted">{label}</td><td>{fmtNum(va)}</td><td>{fmtNum(vb)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{d === null ? '—' : `${d > 0 ? '+' : ''}${d.toLocaleString('it-IT')}${unit}`}</td></tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function AddWeightSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const w = parseNum(String(f.get('weight')));
    if (w === null) return setError('Inserisci il peso');
    try {
      await put(`/weights/${uuid()}`, { measuredOn: f.get('date'), weightKg: w });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Aggiungi peso">
      <form className="stack" onSubmit={submit}>
        <label>Data<input type="date" name="date" defaultValue={todayLocal()} max={todayLocal()} required /></label>
        <label>Peso (kg)<input name="weight" inputMode="decimal" required /></label>
        <ErrorText error={error} />
        <button className="primary big">Salva peso</button>
      </form>
    </Sheet>
  );
}

function shareText(sharePhotos: boolean, photoCount: number): string {
  return `Il coach vedrà: data, peso, misure e nota. Foto: ${sharePhotos ? (photoCount ? `incluse (${photoCount})` : 'incluse quando le aggiungi') : 'non incluse (restano private)'}.`;
}

export function CheckFormPage() {
  const { checkId } = useParams();
  const nav = useNavigate();
  const editing = !!checkId;
  const { data: existing } = useAsync(() => (checkId ? get<CheckDto>(`/checks/${checkId}`) : Promise.resolve(undefined)), [checkId]);
  const [files, setFiles] = useState<Partial<Record<Pose, File>>>({});
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (existing) setShare(existing.sharePhotos);
  }, [existing]);
  if (editing && !existing) return <><TopBar title="Modifica check" /><main className="page"><Loading /></main></>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => parseNum(String(f.get(k) ?? ''));
    const id = checkId ?? uuid();
    setError(null);
    try {
      setBusy('Salvo il check…');
      await put(`/checks/${id}`, {
        checkDate: f.get('date'), weightKg: n('weightKg'), bicepsCm: n('bicepsCm'), chestCm: n('chestCm'), thighCm: n('thighCm'), waistCm: n('waistCm'),
        note: String(f.get('note') ?? '').trim() || null, sharePhotos: share,
      });
      for (const pose of POSES) {
        const file = files[pose];
        if (!file) continue;
        setBusy(`Carico foto ${POSE_LABEL[pose].toLowerCase()}…`);
        const fd = new FormData();
        fd.append('file', file);
        await api('PUT', `/checks/${id}/photos/${pose}`, fd, { timeoutMs: 120_000 });
      }
      nav(`/check/${id}`, { replace: true });
    } catch (err) {
      setError(`${errorMessage(err)}. I dati già salvati restano; puoi riprovare dal check.`);
    } finally {
      setBusy(null);
    }
  }

  const count = Object.keys(files).length + (existing?.photoCount ?? 0);
  return (
    <div style={{ paddingBottom: 110 }}>
      <TopBar title={editing ? 'Modifica check' : 'Nuovo check'} />
      <main className="page">
        <form id="check-form" className="stack" onSubmit={submit}>
          <label>Data (puoi retrodatare)<input type="date" name="date" required max={todayLocal()} defaultValue={existing?.checkDate ?? todayLocal()} /></label>
          <div className="grid2">
            {MEASURES.map(([k, label, unit]) => (
              <label key={k}>{label}{unit}<input name={k} inputMode="decimal" defaultValue={(existing?.[k] as number | null)?.toString().replace('.', ',') ?? ''} /></label>
            ))}
          </div>
          <label>Nota<textarea name="note" maxLength={2000} defaultValue={existing?.note ?? ''} /></label>
          <div className="grid3">
            {POSES.map((p) => (
              <label key={p} className="photo-empty" style={{ cursor: 'pointer', color: files[p] ? 'var(--ok)' : 'var(--sub)', borderStyle: files[p] ? 'solid' : 'dashed', borderColor: files[p] ? 'var(--ok)' : undefined }}>
                <span><Icon name={files[p] ? 'check' : 'camera'} /><br />{POSE_LABEL[p]}{!files[p] && existing?.photos.some((x) => x.pose === p) ? <><br />(presente)</> : null}</span>
                <input type="file" accept="image/*" hidden data-testid={`photo-${p}`} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setFiles((cur) => ({ ...cur, [p]: file }));
                }} />
              </label>
            ))}
          </div>
          <div className="card stack">
            <label className="check-label"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} data-testid="share-photos" /> Condividi le foto di questo check con il coach</label>
            <small data-testid="share-preview">{shareText(share, count)}</small>
          </div>
          <ErrorText error={error} />
          {busy && <p className="muted" role="status">{busy}</p>}
        </form>
      </main>
      <div className="dock"><div className="inner"><button form="check-form" className="primary big" disabled={!!busy} data-testid="save-check">Salva check</button></div></div>
    </div>
  );
}

export function CheckDetailPage() {
  const { checkId } = useParams();
  const nav = useNavigate();
  const { data: c, error, setData } = useAsync(() => get<CheckDto>(`/checks/${checkId}`), [checkId]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return <><TopBar title="Check" /><main className="page">{error ? <ErrorText error={error} /> : <Loading />}</main></>;

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <>
      <TopBar title={`Check ${fmtShort(c.checkDate)}`} action={<Link to="/check" className="btn icon-btn" aria-label="Torna ai check"><Icon name="left" /></Link>} />
      <main className="page">
        {c.feedback.length > 0 && (
          <div className="thread">
            {c.feedback.map((f) => (
              <div key={f.id} className="bubble in note" data-testid="check-feedback"><span className="meta" style={{ color: 'var(--pri-ink)' }}>{f.coachName} · {fmtShort(f.createdAt)}</span>{f.body}</div>
            ))}
          </div>
        )}
        <div className="card tight">
          <table><tbody>
            {MEASURES.map(([k, label, unit]) => <tr key={k}><td className="muted">{label}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(c[k] as number | null, unit)}</td></tr>)}
          </tbody></table>
          {c.note && <p style={{ padding: '8px 0 12px' }}>{c.note}</p>}
        </div>
        <div className="photos3">
          {POSES.map((p) => {
            const ph = c.photos.find((x) => x.pose === p);
            return (
              <div key={p} className="stack" style={{ gap: 4 }}>
                {ph ? <LocalPhoto className="photo" photoId={ph.id} alt={POSE_LABEL[p]} /> : <div className="photo-empty">{POSE_LABEL[p]}</div>}
                {ph && <button className="quiet small-btn" onClick={() => void run(async () => setData(await del<CheckDto>(`/checks/${c.id}/photos/${p}`)))} data-testid={`delete-photo-${p}`}>Elimina</button>}
              </div>
            );
          })}
        </div>
        <div className="card stack">
          <label className="check-label">
            <input type="checkbox" checked={c.sharePhotos} data-testid="share-toggle" onChange={(e) => {
              // Aggiornamento ottimistico: il tocco ha effetto subito; se il server rifiuta si torna allo stato precedente.
              const next = e.target.checked;
              const prev = c;
              setData({ ...c, sharePhotos: next });
              void run(async () => {
                try {
                  setData(await patch<CheckDto>(`/checks/${c.id}/sharing`, { sharePhotos: next }));
                } catch (err2) {
                  setData(prev);
                  throw err2;
                }
              });
            }} />
            Foto visibili al coach
          </label>
          <small>{shareText(c.sharePhotos, c.photoCount)}</small>
        </div>
        <ErrorText error={err} />
        <Link className="btn" to={`/check/${c.id}/modifica`}>Modifica dati o foto</Link>
        {confirmDel ? (
          <div className="card stack">
            <p>Eliminare definitivamente il check e le sue foto?</p>
            <div className="grid2">
              <button className="danger" onClick={() => void run(async () => { await del(`/checks/${c.id}`); nav('/check', { replace: true }); })}>Elimina</button>
              <button onClick={() => setConfirmDel(false)}>Annulla</button>
            </div>
          </div>
        ) : (
          <button className="quiet" onClick={() => setConfirmDel(true)}>Elimina check</button>
        )}
      </main>
    </>
  );
}
