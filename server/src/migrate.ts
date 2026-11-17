import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { withTx, type Db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../migrations');

/** Migrazioni SQL in ordine lessicografico, ciascuna in transazione, con lock advisory contro esecuzioni concorrenti. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  return withTx(db, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(727274)');
    await tx.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await tx.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await tx.query(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
      await tx.query('insert into schema_migrations(name) values ($1)', [f]);
      applied.push(f);
      log(`migrazione applicata: ${f}`);
    }
    return applied;
  });
}
