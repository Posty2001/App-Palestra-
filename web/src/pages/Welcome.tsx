import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorText, Segmented } from '../components/ui';

/** Primo avvio: nessun account né password. Si crea solo il profilo locale di questo telefono. */
export function WelcomePage() {
  const { create, storageError } = useAuth();
  const nav = useNavigate();
  const [role, setRole] = useState<'athlete' | 'coach'>('athlete');
  const [withBase, setWithBase] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '');
    setBusy(true);
    setError(null);
    try {
      await create({ displayName: name, role, withBaseProgram: withBase });
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (storageError) {
    return (
      <main className="center-page">
        <p className="brand">APP PALESTRA</p>
        <h1>Archivio non disponibile</h1>
        <p className="warn">Il browser non permette di salvare dati su questo dispositivo ({storageError}).</p>
        <p className="muted">Apri l'app da Safari in una finestra normale (non privata) oppure dall'icona nella schermata Home.</p>
      </main>
    );
  }

  return (
    <main className="center-page">
      <p className="brand">APP PALESTRA</p>
      <h1>Benvenuto</h1>
      <p className="muted">Nessun account: i tuoi dati restano su questo telefono. Potrai condividerli con il coach con un file e fare un backup quando vuoi.</p>
      <form className="stack" onSubmit={submit} data-testid="welcome-form">
        <label>Come ti chiami?<input name="name" required maxLength={80} autoComplete="given-name" data-testid="welcome-name" /></label>
        <Segmented<'athlete' | 'coach'> label="Uso dell'app" value={role} onChange={setRole} options={[['athlete', 'Mi alleno'], ['coach', 'Sono un coach']]} />
        <small className="muted">{role === 'coach' ? 'Area coach per seguire più atleti, più «Il mio allenamento» per le tue sedute.' : 'Allenamenti, progressi e check. Potrai collegarti al tuo coach in seguito.'}</small>
        <label className="check-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={withBase} onChange={(e) => setWithBase(e.target.checked)} style={{ width: 22, height: 22 }} data-testid="welcome-base" />
          Parti dalla scheda base (5 giorni)
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy} data-testid="welcome-start">Inizia</button>
        <small className="muted">Consiglio: aggiungi l'app alla schermata Home (Condividi → Aggiungi alla schermata Home). Così Safari conserva i dati in modo più affidabile.</small>
      </form>
    </main>
  );
}
