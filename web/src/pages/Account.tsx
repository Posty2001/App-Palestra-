import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { getInactivityDays, setInactivityDays } from '../lib/prefs';
import { loadProfile } from '../local/profile';
import { formatFingerprint } from '../local/keys';
import { ErrorText, TopBar } from '../components/ui';

interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

const mb = (n: number): string => `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;

export function AccountPage() {
  const user = useUser();
  const { update } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(() => getInactivityDays(user.id));
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });

  useEffect(() => {
    void loadProfile().then((p) => setFingerprint(p ? formatFingerprint(p.keys.keyId) : null));
    void (async () => {
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
      const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
      setStorage({ persisted, usage: est?.usage ?? null, quota: est?.quota ?? null });
    })();
  }, []);

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await update({ displayName: String(new FormData(e.currentTarget).get('name') ?? '') });
      setMsg('Nome aggiornato.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function askPersist() {
    const ok = navigator.storage?.persist ? await navigator.storage.persist().catch(() => false) : false;
    setStorage((s) => ({ ...s, persisted: ok }));
    setMsg(ok ? 'Il browser conserverà i dati in modo persistente.' : 'Il browser non ha concesso l\'archiviazione persistente: aggiungi l\'app alla schermata Home e fai backup regolari.');
  }

  return (
    <>
      <TopBar title="Profilo" />
      <main className="page">
        <form className="card stack" onSubmit={rename}>
          <label>Nome<input name="name" defaultValue={user.displayName} required maxLength={80} data-testid="profile-name" /></label>
          {user.coach && <p>Coach: {user.coach.displayName}</p>}
          <button className="small-btn">Salva nome</button>
        </form>

        <div className="card stack">
          <strong>Modalità coach</strong>
          <p className="muted">{user.role === 'coach' ? 'Attiva: Area coach + Il mio allenamento.' : 'Non attiva: solo il tuo allenamento.'}</p>
          <button className="small-btn" data-testid="toggle-coach" onClick={() => void update({ role: user.role === 'coach' ? 'athlete' : 'coach' }).catch((e: unknown) => setError(errorMessage(e)))}>
            {user.role === 'coach' ? 'Disattiva modalità coach' : 'Attiva modalità coach'}
          </button>
          {user.role === 'coach' && <small className="muted">Disattivandola gli atleti restano salvati: riattivala per ritrovarli.</small>}
        </div>

        {user.role === 'coach' && (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); setInactivityDays(user.id, days); setDays(getInactivityDays(user.id)); setMsg('Soglia di inattività salvata su questo dispositivo.'); }}>
            <strong>Impostazioni coach</strong>
            <label>Atleta inattivo dopo (giorni senza allenamenti ricevuti)
              <input type="number" min={1} max={90} inputMode="numeric" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="inactivity-days" />
            </label>
            <small>Salvata su questo dispositivo. Predefinita: 7 giorni.</small>
            <button className="small-btn">Salva soglia</button>
          </form>
        )}

        <div className="card stack">
          <strong>Questo dispositivo</strong>
          <p className="muted">Tutti i dati sono salvati solo qui. Senza backup, cancellare i dati di Safari o perdere il telefono significa perderli.</p>
          <p data-testid="storage-persisted">Archiviazione persistente: {storage.persisted === null ? 'non verificabile' : storage.persisted ? 'sì' : 'no'}</p>
          {storage.usage !== null && <p className="muted">Spazio usato: {mb(storage.usage)}{storage.quota ? ` su ${mb(storage.quota)} disponibili` : ''}</p>}
          {storage.persisted === false && <button className="small-btn" onClick={() => void askPersist()}>Chiedi archiviazione persistente</button>}
          {fingerprint && (
            <p>Impronta di sicurezza: <code data-testid="my-fingerprint" style={{ letterSpacing: '.05em' }}>{fingerprint}</code></p>
          )}
          <small className="muted">L'impronta serve a confermare il collegamento con il coach o con un atleta: confrontatela di persona o al telefono.</small>
        </div>
        <ErrorText error={error} />
        {msg && <p className="ok" role="status">{msg}</p>}
      </main>
    </>
  );
}
