import { createInterface } from 'node:readline/promises';
import { emailSchema, passwordSchema } from '@palestra/shared';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { createCoach, purgeDemo, seedDemo } from './seed.js';

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();
const db = createPool(config.DATABASE_URL);

function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

try {
  switch (cmd) {
    case 'migrate': {
      const applied = await migrate(db);
      console.log(applied.length ? `OK (${applied.length} migrazioni)` : 'Schema già aggiornato');
      break;
    }
    case 'create-coach': {
      await migrate(db, () => undefined);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const email = emailSchema.parse(arg('email') ?? (await rl.question('Email coach: ')));
      const displayName = (arg('name') ?? (await rl.question('Nome visualizzato: '))).trim() || 'Coach';
      // Password da variabile d'ambiente o da prompt: mai come argomento (finirebbe nella history della shell).
      const password = passwordSchema.parse(process.env.COACH_PASSWORD ?? (await rl.question('Password (min 10 caratteri): ')));
      rl.close();
      const id = await createCoach(db, { email, password, displayName });
      console.log(`Coach creato (${id}) con la "Scheda 5 giorni" precaricata nel profilo personale.`);
      break;
    }
    case 'seed-demo': {
      if (config.NODE_ENV === 'production') throw new Error('seed-demo non è consentito con NODE_ENV=production');
      const pw = process.env.DEMO_PASSWORD;
      if (!pw) throw new Error('Imposta DEMO_PASSWORD (min 10 caratteri) nel file .env o nell\'ambiente');
      await migrate(db, () => undefined);
      await seedDemo(db, passwordSchema.parse(pw));
      break;
    }
    case 'purge-demo': {
      console.log(`Utenti demo eliminati: ${await purgeDemo(db)}. Avvia il server per completare la pulizia dei file.`);
      break;
    }
    default:
      console.log('Comandi: migrate | create-coach [--email x --name y] | seed-demo | purge-demo');
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
