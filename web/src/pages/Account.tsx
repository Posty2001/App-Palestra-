import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, post } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { getInactivityDays, setInactivityDays } from '../lib/prefs';
import { ErrorText, TopBar } from '../components/ui';

export function AccountPage() {
  const user = useUser();
  const { logout } = useAuth();
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [days, setDays] = useState(() => getInactivityDays(user.id));

  async function changePw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await post('/auth/password', { currentPassword: f.get('current'), newPassword: f.get('next') });
      setMsg('Password aggiornata. Gli altri dispositivi sono stati disconnessi.');
      form.reset();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function out(force: boolean) {
    const r = await logout(force);
    if (r.ok) nav('/login', { replace: true });
    else setPending(r.pending);
  }

  return (
    <>
      <TopBar title="Account" />
      <main className="page">
        <div className="card">
          <strong style={{ fontSize: 18 }}>{user.displayName}</strong>
          <p className="muted">{user.email}{user.isDemo ? ' · account di prova' : ''}</p>
          {user.coach && <p style={{ marginTop: 6 }}>Coach: {user.coach.displayName}</p>}
        </div>
        {user.role === 'coach' && (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); setInactivityDays(user.id, days); setDays(getInactivityDays(user.id)); setMsg('Soglia di inattività salvata su questo dispositivo.'); }}>
            <strong>Impostazioni coach</strong>
            <label>Atleta inattivo dopo (giorni senza allenamenti salvati)
              <input type="number" min={1} max={90} inputMode="numeric" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="inactivity-days" />
            </label>
            <small>Salvata su questo dispositivo. Predefinita: 7 giorni.</small>
            <button className="small-btn">Salva soglia</button>
          </form>
        )}
        <form className="card stack" onSubmit={changePw}>
          <strong>Cambia password</strong>
          <label>Password attuale<input name="current" type="password" required autoComplete="current-password" /></label>
          <label>Nuova password (min 10)<input name="next" type="password" minLength={10} required autoComplete="new-password" /></label>
          <button className="small-btn">Aggiorna password</button>
        </form>
        <ErrorText error={error} />
        {msg && <p className="ok" role="status">{msg}</p>}
        {pending > 0 ? (
          <div className="card stack">
            <p className="warn">Hai {pending} modifiche non ancora sincronizzate. Uscendo ora andranno perse.</p>
            <button className="danger" onClick={() => void out(true)}>Esci comunque</button>
          </div>
        ) : (
          <button onClick={() => void out(false)} data-testid="logout">Esci</button>
        )}
      </main>
    </>
  );
}
