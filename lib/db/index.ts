import { env } from '../env';
import * as schema from './schema';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type DB = PgDatabase<any, typeof schema>;

let _db: DB | null = null;
let _close: (() => Promise<void>) | null = null;
let _init: Promise<DB> | null = null;

async function init(): Promise<DB> {
  if (env.databaseUrl) {
    // Real Postgres (Supabase). Transaction pooler requires prepare:false.
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const client = postgres(env.databaseUrl, { prepare: false });
    _close = () => client.end();
    _db = drizzle(client, { schema }) as unknown as DB;
  } else {
    // Dev fallback: embedded Postgres (PGlite), persisted at env.pglitePath.
    const { drizzle } = await import('drizzle-orm/pglite');
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite(env.pglitePath);
    _close = async () => { await client.close(); };
    _db = drizzle(client, { schema }) as unknown as DB;
  }
  return _db;
}

export async function getDb(): Promise<DB> {
  if (_db) return _db;
  if (!_init) _init = init();
  return _init;
}

export async function closeDb(): Promise<void> {
  if (_close) await _close();
  _db = null; _init = null; _close = null;
}

export * from './schema';
