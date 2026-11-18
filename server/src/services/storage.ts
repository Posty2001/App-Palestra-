import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Archivio privato dei file. I file NON sono mai serviti staticamente: l'unico accesso
 * passa da GET /api/photos/:id, che verifica proprietà, collegamento e condivisione correnti.
 * L'interfaccia consente di sostituire il filesystem con un bucket S3 privato.
 */
export interface PrivateStorage {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-f0-9]{2}\/[a-f0-9-]{36}$/;

export class FsStorage implements PrivateStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('storage key non valida');
    return path.join(this.root, key);
  }

  async put(data: Buffer): Promise<string> {
    const id = randomUUID();
    const key = `${id.slice(0, 2)}/${id}`;
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, file);
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/**
 * Variante per hosting senza disco persistente (piani gratuiti): i file vivono in PostgreSQL (tabella photo_blobs).
 * Stesse garanzie di FsStorage: nessun URL pubblico, accesso solo tramite /api/photos/:id con i controlli di sempre.
 * Vantaggio collaterale: il backup del database include anche le foto.
 */
export class DbStorage implements PrivateStorage {
  constructor(private readonly db: Pick<import('pg').Pool, 'query'>) {}

  async put(data: Buffer): Promise<string> {
    const id = randomUUID();
    const key = `${id.slice(0, 2)}/${id}`;
    await this.db.query('insert into photo_blobs(storage_key, data) values ($1, $2)', [key, data]);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (!KEY_RE.test(key)) throw new Error('storage key non valida');
    const r = await this.db.query<{ data: Buffer }>('select data from photo_blobs where storage_key = $1', [key]);
    const row = r.rows[0];
    if (!row) throw Object.assign(new Error('file non trovato'), { code: 'ENOENT' });
    return row.data;
  }

  async delete(key: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new Error('storage key non valida');
    await this.db.query('delete from photo_blobs where storage_key = $1', [key]);
  }
}
