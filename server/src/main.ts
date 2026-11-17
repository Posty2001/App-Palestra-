import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db, () => undefined);
const app = await buildApp({ config, db });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'arresto');
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
