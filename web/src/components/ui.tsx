import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { subscribeSync, type SyncState } from '../lib/sync';
import { useAuth } from '../lib/auth';

export function SyncBadge() {
  const [s, setS] = useState<SyncState | null>(null);
  useEffect(() => subscribeSync(setS), []);
  if (!s) return null;
  const cls = !s.online ? 'offline' : s.pending > 0 ? 'pending' : '';
  const text = !s.online
    ? `Offline${s.pending ? ` · ${s.pending} da inviare` : ''}`
    : s.pending > 0
      ? `${s.syncing ? 'Sincronizzo' : 'In attesa'} · ${s.pending}`
      : 'Sincronizzato';
  return (
    <span className={`sync ${cls}`} role="status" aria-live="polite" data-testid="sync-status" title={s.lastError ?? undefined}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

/** Intestazione: distingue sempre lo spazio personale dal profilo di un atleta aperto dal coach. */
export function TopBar({ title, athleteName, children }: { title: string; athleteName?: string | null; children?: ReactNode }) {
  const { user } = useAuth();
  return (
    <>
      <header className="top">
        <div className="brand">
          <span>APP PALESTRA{user?.role === 'coach' ? ' / COACH' : ''}</span>
          <span className="row-start">
            {athleteName ? <span className="chip red">Profilo atleta</span> : user?.role === 'coach' ? <span className="chip self">Il mio spazio</span> : null}
            <SyncBadge />
          </span>
        </div>
        <h1>{title}</h1>
        {children}
      </header>
      {athleteName ? (
        <div className="athlete-banner" data-testid="athlete-banner">
          <div>
            <small>Stai gestendo</small>
            <br />
            <strong>{athleteName}</strong>
          </div>
          <Link to="/atleti" className="btn small-btn">‹ Atleti</Link>
        </div>
      ) : null}
    </>
  );
}

export function TabBar() {
  const { user } = useAuth();
  const tabs: [string, string, string][] = [
    ...(user?.role === 'coach' ? ([['/atleti', 'Atleti', '👥']] as [string, string, string][]) : []),
    ['/', 'Oggi', '●'],
    ['/scheda', 'Scheda', '☰'],
    ['/progressi', 'Progressi', '↗'],
    ['/check', 'Check fisico', '◐'],
  ];
  return (
    <nav className="tabbar" aria-label="Navigazione principale">
      {tabs.map(([to, label, ico]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico" aria-hidden="true">{ico}</span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{title}</h2>
          <button type="button" className="quiet" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return message ? <div className="toast" role="status">{message}</div> : null;
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p className="err" role="alert">{error}</p> : null;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export interface Series {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

/** Grafico a linee SVG senza dipendenze: asse x = date, una linea per numero di ripetizioni. */
export function LineChart({ series, unit = 'kg' }: { series: Series[]; unit?: string }) {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (xs.length === 0 || ys.length === 0) return <p className="muted">Servono almeno due sedute per vedere l'andamento.</p>;
  const W = 340, H = 180, L = 36, R = 10, T = 10, B = 24;
  const min = Math.min(...ys), max = Math.max(...ys);
  const pad = max === min ? 2.5 : (max - min) * 0.15;
  const y0 = min - pad, y1 = max + pad;
  const px = (x: string) => L + (xs.length === 1 ? (W - L - R) / 2 : (xs.indexOf(x) / (xs.length - 1)) * (W - L - R));
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Andamento in ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="#443740" strokeDasharray="3 4" />
            <text x={L - 4} y={py(t) + 4} fill="#cbbdc4" fontSize="10" textAnchor="end">{Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {[xs[0], xs[xs.length - 1]].map((x, i) => x && (
          <text key={i} x={px(x)} y={H - 6} fill="#cbbdc4" fontSize="10" textAnchor={i ? 'end' : 'start'}>{x.slice(8, 10)}/{x.slice(5, 7)}</text>
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
            {s.points.map((p) => <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r="3.5" fill={s.color} />)}
          </g>
        ))}
      </svg>
      <figcaption className="row-start">
        {series.map((s) => (
          <span key={s.label} className="chip"><i style={{ width: 10, height: 3, background: s.color, display: 'inline-block' }} />{s.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}

export const SERIES_COLORS = ['#ff5065', '#7ec8ff', '#ffc56b', '#7ee2a8'];
