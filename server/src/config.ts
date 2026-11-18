import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url(),
  /** URL pubblico dell'app (per i link di invito e recupero). */
  APP_URL: z.string().url().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage/photos'),
  /** fs = disco persistente (predefinito); db = foto in PostgreSQL, per hosting gratuiti senza disco. */
  STORAGE_DRIVER: z.enum(['fs', 'db']).default('fs'),
  /** Imposta a "true" dietro HTTPS (produzione): cookie Secure. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  INVITE_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('APP PALESTRA <no-reply@localhost>'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configurazione non valida: ${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('In produzione COOKIE_SECURE deve essere true (servire l\'app via HTTPS).');
  }
  return parsed.data;
}
