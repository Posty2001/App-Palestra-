import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { InviteStatus, UserDto } from '@palestra/shared';
import { errorMessage, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getLastMode } from '../lib/prefs';
import { ErrorText, Segmented } from '../components/ui';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="center-page">
      <p className="brand">APP PALESTRA</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function LoginPage() {
  const { signedIn } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const u = await post<UserDto>('/auth/login', { email: f.get('email'), password: f.get('password') });
      await signedIn(u);
      nav(u.role === 'coach' && getLastMode(u.id) === 'coach' ? '/coach' : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Accedi">
      <form className="stack" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" required inputMode="email" /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>Accedi</button>
        <Link to="/recupera">Password dimenticata?</Link>
        <p className="muted">Sei un atleta? Apri il link di invito ricevuto dal tuo coach.</p>
      </form>
    </Shell>
  );
}

export function ForgotPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await post('/auth/forgot', { email: new FormData(e.currentTarget).get('email') });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Shell title="Recupera accesso">
      {sent ? (
        <div className="card stack">
          <p>Se l'email è registrata riceverai un link valido per un'ora.</p>
          <p className="muted">Non arriva? Chiedi al tuo coach di generare un link di recupero dal tuo profilo.</p>
          <Link to="/login">Torna all'accesso</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>Email<input name="email" type="email" required autoComplete="username" /></label>
          <ErrorText error={error} />
          <button className="primary">Invia link di recupero</button>
          <Link to="/login">Torna all'accesso</Link>
        </form>
      )}
    </Shell>
  );
}

function tokenFromHash(): string {
  return decodeURIComponent(window.location.hash.replace(/^#/, ''));
}

export function ResetPage() {
  const { signedIn } = useAuth();
  const nav = useNavigate();
  const [token] = useState(tokenFromHash);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Il token non resta nella barra degli indirizzi né nella cronologia.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) return setError('Le password non coincidono');
    try {
      const u = await post<UserDto>('/auth/reset', { token, password: f.get('password') });
      await signedIn(u);
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Shell title="Nuova password">
      {!token ? (
        <p className="err">Link non valido. <Link to="/recupera">Richiedine uno nuovo</Link>.</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>Nuova password (min 10 caratteri)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
          <label>Ripeti password<input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>
          <ErrorText error={error} />
          <button className="primary">Salva e accedi</button>
          <p className="muted">Gli altri dispositivi verranno disconnessi.</p>
        </form>
      )}
    </Shell>
  );
}

interface InviteInfo { status: InviteStatus; message: string | null; coachName: string | null; athleteName: string | null; email: string | null }

export function InvitePage() {
  const { user, signedIn } = useAuth();
  const nav = useNavigate();
  const [token] = useState(tokenFromHash);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setInfo({ status: 'invalid', message: 'Invito non valido. Controlla il link o chiedine uno nuovo al coach.', coachName: null, athleteName: null, email: null });
      return;
    }
    get<InviteInfo>(`/invites/${encodeURIComponent(token)}`).then(setInfo).catch((e: unknown) => setError(errorMessage(e)));
  }, [token]);

  async function accept(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const u = await post<UserDto>(`/invites/${encodeURIComponent(token)}/accept`, body);
      await signedIn(u);
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (mode === 'register' && f.password !== f.confirm) return setError('Le password non coincidono');
    void accept(mode === 'register' ? { mode, displayName: f.displayName, email: f.email, password: f.password } : { mode, email: f.email, password: f.password });
  }

  if (!info) return <Shell title="Invito"><p className="muted">Verifico l'invito…</p><ErrorText error={error} /></Shell>;
  if (info.status !== 'valid') {
    return (
      <Shell title="Invito">
        <div className="card stack" data-testid="invite-status">
          <p className="err">{info.message}</p>
          <Link to="/login">Vai all'accesso</Link>
        </div>
      </Shell>
    );
  }
  return (
    <Shell title="Unisciti">
      <p><strong>{info.coachName}</strong> ti ha invitato come atleta.</p>
      {user ? (
        <div className="stack">
          <p className="muted">Hai già effettuato l'accesso come {user.email}.</p>
          <button className="primary" disabled={busy} onClick={() => void accept({ mode: 'current' })}>Collega questo account</button>
          <ErrorText error={error} />
        </div>
      ) : (
        <>
          <Segmented label="Account" value={mode} onChange={setMode} options={[['register', 'Crea account'], ['login', 'Ho già un account']]} />
          <form className="stack" onSubmit={submit}>
            {mode === 'register' && <label>Nome<input name="displayName" required maxLength={80} defaultValue={info.athleteName ?? ''} autoComplete="name" /></label>}
            <label>Email<input name="email" type="email" required defaultValue={info.email ?? ''} autoComplete="username" /></label>
            <label>Password{mode === 'register' ? ' (min 10 caratteri)' : ''}<input name="password" type="password" required minLength={mode === 'register' ? 10 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></label>
            {mode === 'register' && <label>Ripeti password<input name="confirm" type="password" required minLength={10} autoComplete="new-password" /></label>}
            <ErrorText error={error} />
            <button className="primary" disabled={busy}>{mode === 'register' ? 'Crea account e collegati' : 'Accedi e collegati'}</button>
          </form>
        </>
      )}
    </Shell>
  );
}
