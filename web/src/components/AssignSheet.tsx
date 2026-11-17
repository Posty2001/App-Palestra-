import { useEffect, useState, type FormEvent } from 'react';
import type { AthleteSummaryDto, ProgramSummaryDto } from '@palestra/shared';
import { errorMessage, get, post } from '../lib/api';
import { ErrorText, Sheet } from './ui';

/**
 * Assegna = copia indipendente della scheda all'atleta (endpoint esistente /duplicate con ownerId).
 * Due ingressi: dal profilo atleta (si sceglie la scheda) o da una scheda (si sceglie l'atleta).
 */
export function AssignSheet({ open, onClose, onDone, athlete, program }: {
  open: boolean; onClose: () => void; onDone: () => void; athlete?: AthleteSummaryDto; program?: ProgramSummaryDto;
}) {
  const [programs, setPrograms] = useState<ProgramSummaryDto[] | null>(null);
  const [athletes, setAthletes] = useState<AthleteSummaryDto[] | null>(null);
  const [programId, setProgramId] = useState<string>('');
  const [athleteId, setAthleteId] = useState<string>('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!program) void get<ProgramSummaryDto[]>('/programs').then((p) => { setPrograms(p); setProgramId(p[0]?.id ?? ''); setName(p[0]?.name ?? ''); }).catch((e: unknown) => setError(errorMessage(e)));
    else { setProgramId(program.id); setName(program.name); }
    if (!athlete) void get<AthleteSummaryDto[]>('/coach/athletes').then((a) => { setAthletes(a); setAthleteId(a[0]?.id ?? ''); }).catch((e: unknown) => setError(errorMessage(e)));
    else setAthleteId(athlete.id);
  }, [open, program, athlete]);

  const target = athlete ?? athletes?.find((a) => a.id === athleteId);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const from = String(f.get('from') || '') || null;
    const to = String(f.get('to') || '') || null;
    if (from && to && to < from) return setError('La data finale deve essere uguale o successiva a quella iniziale.');
    if (!programId || !athleteId) return setError('Scegli scheda e atleta');
    setBusy(true);
    try {
      await post(`/programs/${programId}/duplicate`, { ownerId: athleteId, name: name.trim() || undefined, startDate: from, endDate: to });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Assegna scheda" kicker={target?.displayName ?? program?.name} testId="assign-sheet">
      <form className="stack" onSubmit={submit}>
        {!program && (
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            <legend className="muted" style={{ marginBottom: 8 }}>Parti da</legend>
            {programs?.length === 0 && <p className="muted">Non hai ancora schede: creane una in Schede.</p>}
            {programs?.map((p) => (
              <label key={p.id} className="link-card" style={{ borderColor: p.id === programId ? 'var(--pri)' : undefined, color: 'var(--ink)' }}>
                <input type="radio" name="program" value={p.id} checked={p.id === programId} onChange={() => { setProgramId(p.id); setName(p.name); }} data-testid="assign-program-option" />
                <span className="spacer"><strong style={{ fontWeight: 600 }}>{p.name}</strong><small style={{ display: 'block' }}>{p.content.days.length} giorni · v{p.versionNo}</small></span>
              </label>
            ))}
          </fieldset>
        )}
        {!athlete && (
          <label>Atleta
            <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} data-testid="assign-athlete">
              {athletes?.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
          </label>
        )}
        <label>Nome per l'atleta<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="assign-name" /></label>
        <div className="grid2">
          <label>Inizio<input type="date" name="from" /></label>
          <label>Fine<input type="date" name="to" /></label>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>L'atleta riceve una copia: puoi personalizzarla senza toccare l'originale né le schede degli altri. Le sue schede attuali restano disponibili.</p>
        <ErrorText error={error} />
        <button className="primary big" disabled={busy || !programId || !athleteId} data-testid="assign-confirm">Assegna{target ? ` a ${target.displayName}` : ''}</button>
      </form>
    </Sheet>
  );
}
