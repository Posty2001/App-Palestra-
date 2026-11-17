import type { Db } from './db.js';
import { withTx } from './db.js';
import { hashPassword } from './lib/crypto.js';
import { buildBaseProgram } from './services/baseProgram.js';
import { createProgram } from './services/programs.js';

export async function createCoach(db: Db, args: { email: string; password: string; displayName: string; isDemo?: boolean }): Promise<string> {
  const hash = await hashPassword(args.password);
  const base = await buildBaseProgram();
  return withTx(db, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into users(email, password_hash, display_name, role, is_demo) values ($1, $2, $3, 'coach', $4) returning id`,
      [args.email.toLowerCase(), hash, args.displayName, args.isDemo ?? false],
    );
    const id = r.rows[0]!.id;
    await createProgram(tx, { ownerId: id, createdBy: id, input: { name: base.name, startDate: null, endDate: null, content: base.content }, summary: 'Importata da scheda_allenamento_5_giorni.pdf (Pendulum Squat al posto di RDL manubri)' });
    return id;
  });
}

export const DEMO = {
  domain: 'demo.app-palestra.test',
  coach: { email: 'coach@demo.app-palestra.test', name: '[DEMO] Coach Prova' },
  a: { email: 'atleta.a@demo.app-palestra.test', name: '[DEMO] Atleta A' },
  b: { email: 'atleta.b@demo.app-palestra.test', name: '[DEMO] Atleta B' },
};

/**
 * Ambiente di prova: tre utenti sintetici riconoscibili ([DEMO], dominio .test, is_demo = true).
 * La password arriva da variabile d'ambiente: nessuna credenziale nel repository.
 */
export async function seedDemo(db: Db, password: string): Promise<void> {
  const exists = await db.query('select 1 from users where email = $1', [DEMO.coach.email]);
  if (exists.rowCount) {
    console.log('Dati demo già presenti: nessuna modifica.');
    return;
  }
  const coachId = await createCoach(db, { email: DEMO.coach.email, password, displayName: DEMO.coach.name, isDemo: true });
  const hash = await hashPassword(password);
  await withTx(db, async (tx) => {
    for (const a of [DEMO.a, DEMO.b]) {
      const r = await tx.query<{ id: string }>(
        `insert into users(email, password_hash, display_name, role, is_demo) values ($1, $2, $3, 'athlete', true) returning id`,
        [a.email, hash, a.name],
      );
      await tx.query('insert into coach_links(coach_id, athlete_id) values ($1, $2)', [coachId, r.rows[0]!.id]);
    }
  });
  console.log(`Creati: ${DEMO.coach.email}, ${DEMO.a.email}, ${DEMO.b.email} (password: valore di DEMO_PASSWORD).`);
}

/** Rimuove TUTTI i dati sintetici (cascade su schede, sedute, check, foto → file accodati in storage_gc). */
export async function purgeDemo(db: Db): Promise<number> {
  const r = await db.query('delete from users where is_demo = true');
  return r.rowCount ?? 0;
}
