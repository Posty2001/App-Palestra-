import pg from 'pg';

// numeric → number (precisione sufficiente per kg/cm), date → stringa ISO YYYY-MM-DD.
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 15_000 } as pg.PoolConfig);
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
