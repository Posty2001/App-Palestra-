import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { subscribeSync, type SyncState } from '../lib/sync';
import { useAuth } from '../lib/auth';
import { setLastMode } from '../lib/prefs';
import { Icon, type IconName } from './icons';

/** Percorsi dell'Area coach: tutto il resto è "Il mio allenamento" (stesse schermate dell'atleta). */
export function isCoachArea(path: string): boolean {
  return path === '/coach' || path.startsWith('/coach/') || path.startsWith('/atleti') || path === '/schede' || path.startsWith('/schede/');
}

export function initials(name: string): string {
  return name.replace(/\[.*?\]/g, '').trim().split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

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

export function ModeSwitch() {
  const { user } = useAuth();
  const loc = useLocation();
  if (user?.role !== 'coach') return null;
  const coach = isCoachArea(loc.pathname);
  return (
    <nav className="mode" aria-label="Modalità" data-testid="mode-switch">
      <Link to="/coach" className={coach ? 'on' : ''} aria-current={coach ? 'page' : undefined} onClick={() => setLastMode(user.id, 'coach')}>Coach</Link>
      <Link to="/" className={coach ? '' : 'on'} aria-current={coach ? undefined : 'page'} onClick={() => setLastMode(user.id, 'personal')}>Il mio allenamento</Link>
    </nav>
  );
}

function Avatar() {
  const { user } = useAuth();
  return <Link to="/account" className="avatar" aria-label="Profilo e impostazioni" data-testid="account-link">{initials(user?.displayName ?? '')}</Link>;
}

/**
 * Intestazione standard. Con `athlete` il coach sta lavorando sul profilo di un atleta:
 * striscia corallo in alto + nome dell'atleta sempre visibile.
 */
export function TopBar({ title, kicker, athlete, action, children }: {
  title: string; kicker?: string; athlete?: { id: string; name: string } | null; action?: ReactNode; children?: ReactNode;
}) {
  const { user } = useAuth();
  if (athlete) {
    return (
      <header className="top" data-testid="athlete-banner">
        <div className="ctx-strip" aria-hidden="true" />
        <div className="top-row">
          <Link to={`/atleti/${athlete.id}`} className="back"><Icon name="left" size={18} />{athlete.name}</Link>
          <SyncBadge />
        </div>
        <div className="top-row">
          <div>
            <p className="cap" style={{ color: 'var(--pri-ink)' }}>Profilo atleta · {athlete.name}</p>
            <h1 style={{ marginTop: 6 }}>{title}</h1>
          </div>
          {action}
        </div>
        {children}
      </header>
    );
  }
  return (
    <header className="top">
      {user?.role === 'coach' ? (
        <div className="top-row"><ModeSwitch /><Avatar /></div>
      ) : null}
      <div className="top-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {kicker && <p className="cap">{kicker}</p>}
          <h1 style={{ marginTop: kicker ? 6 : 0 }}>{title}</h1>
        </div>
        {action}
        {user?.role !== 'coach' && <Avatar />}
      </div>
      <SyncBadge />
      {children}
    </header>
  );
}

const PERSONAL_TABS: [string, string, IconName][] = [
  ['/', 'Oggi', 'dumbbell'],
  ['/scheda', 'Scheda', 'clipboard'],
  ['/progressi', 'Progressi', 'trend'],
  ['/check', 'Check', 'camera'],
];
const COACH_TABS: [string, string, IconName][] = [
  ['/coach', 'Dashboard', 'grid'],
  ['/atleti', 'Atleti', 'users'],
  ['/schede', 'Schede', 'clipboard'],
  ['/coach/progressi', 'Progressi', 'trend'],
  ['/coach/check', 'Check', 'camera'],
];

export function TabBar() {
  const { user } = useAuth();
  const loc = useLocation();
  const tabs = user?.role === 'coach' && isCoachArea(loc.pathname) ? COACH_TABS : PERSONAL_TABS;
  return (
    <nav className="tabbar" aria-label="Navigazione principale" data-testid="tabbar">
      {tabs.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === '/' || to === '/coach'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={icon} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sheet({ open, onClose, title, kicker, children, testId }: { open: boolean; onClose: () => void; title: string; kicker?: string; children: ReactNode; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="grab" aria-hidden="true" />
        <div className="row">
          <div style={{ minWidth: 0 }}>
            {kicker && <p className="cap">{kicker}</p>}
            <h2 style={{ marginTop: kicker ? 6 : 0 }}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return message ? <div className="toast" role="status">{message}</div> : null;
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p className="err" role="alert">{error}</p> : null;
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Caricamento">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><p>{children}</p>{action}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export interface Series {
  label: string;
  color: string;
  dashed?: boolean;
  points: { x: string; y: number }[];
}

/** Grafico a linee SVG senza dipendenze. Mostrato solo con almeno due rilevazioni. */
export function LineChart({ series, unit = 'kg' }: { series: Series[]; unit?: string }) {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (xs.length < 2 || ys.length === 0) return <p className="muted">Servono almeno due sedute con le stesse ripetizioni per vedere l'andamento.</p>;
  const W = 340, H = 170, L = 38, R = 10, T = 10, B = 24;
  const min = Math.min(...ys), max = Math.max(...ys);
  const pad = max === min ? 2.5 : (max - min) * 0.15;
  const y0 = min - pad, y1 = max + pad;
  const px = (x: string) => L + (xs.indexOf(x) / (xs.length - 1)) * (W - L - R);
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('it-IT');
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Andamento in ${unit}: ${series.map((s) => `${s.label} da ${fmt(s.points[0]?.y ?? 0)} a ${fmt(s.points[s.points.length - 1]?.y ?? 0)}`).join('; ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="#30343d" />
            <text x={L - 6} y={py(t) + 4} fill="#a7adb8" fontSize="11" textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {[xs[0], xs[xs.length - 1]].map((x, i) => x && (
          <text key={i} x={px(x)} y={H - 6} fill="#a7adb8" fontSize="11" textAnchor={i ? 'end' : 'start'}>{x.slice(8, 10)}/{x.slice(5, 7)}</text>
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth="3" strokeLinejoin="round" strokeDasharray={s.dashed ? '6 4' : undefined} points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
            {s.points.map((p) => <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r="3.5" fill={s.color} />)}
          </g>
        ))}
      </svg>
    </figure>
  );
}

export const SERIES_STYLES: { color: string; dashed: boolean }[] = [
  { color: '#ff5265', dashed: false },
  { color: '#b9dcff', dashed: true },
  { color: '#f2b84b', dashed: false },
  { color: '#35c58b', dashed: true },
];
