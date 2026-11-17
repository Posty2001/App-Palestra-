/**
 * Server per i test end-to-end: azzera il database di TEST, applica le migrazioni, crea i 3 utenti sintetici
 * e serve la PWA compilata. Rifiuta di partire su un database il cui URL non contiene "test".
 */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { seedDemo } from './seed.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/test/i.test(url)) throw new Error('TEST_DATABASE_URL mancante o non di test');
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('DEMO_PASSWORD mancante');
const port = Number(process.env.E2E_PORT ?? 3100);
const config = loadConfig({
  ...process.env, NODE_ENV: 'test', DATABASE_URL: url, PORT: String(port), APP_URL: `http://127.0.0.1:${port}`,
  STORAGE_DIR: await mkdtemp(path.join(os.tmpdir(), 'palestra-e2e-')), WEB_DIST: path.resolve(import.meta.dirname, '../../web/dist'),
});
const db = createPool(url);
await db.query('drop schema public cascade; create schema public;');
await migrate(db, () => undefined);
await seedDemo(db, password);
const app = await buildApp({ config, db });
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server su http://127.0.0.1:${port}`);
