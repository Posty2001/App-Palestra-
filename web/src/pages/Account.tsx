import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, post } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { ErrorText, TopBar } from '../components/ui';

export function AccountPage() {
  const user = useUser();
  const { logout } = useAuth();
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

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
      <main className="page stack">
        <div className="card">
          <strong>{user.displayName}</strong><br /><small>{user.email}{user.isDemo ? ' · account di prova' : ''}</small>
          {user.coach && <p>Coach: {user.coach.displayName}</p>}
        </div>
        <form className="card stack" onSubmit={changePw}>
          <strong>Cambia password</strong>
          <label>Password attuale<input name="current" type="password" required autoComplete="current-password" /></label>
          <label>Nuova password (min 10)<input name="next" type="password" minLength={10} required autoComplete="new-password" /></label>
          <ErrorText error={error} />
          {msg && <p className="ok">{msg}</p>}
          <button>Aggiorna password</button>
        </form>
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
