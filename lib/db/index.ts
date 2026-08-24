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
    // Claim it first: PGlite is single-writer, and a second dev server sharing
    // the directory diverges silently rather than failing.
    const { claimPgliteLock, recordPgliteOwner } = await import('./pglite-lock');
    claimPgliteLock(env.pglitePath);
    const { drizzle } = await import('drizzle-orm/pglite');
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite(env.pglitePath);
    // Recorded AFTER the open, because on a fresh worktree the directory does
    // not exist until PGlite makes it — and a first server that leaves no lock
    // behind lets the second one in unchallenged.
    //
    // Awaited, and it has to be: the constructor only kicks the init off, and
    // the directory appears inside it. Recording on the next line runs before
    // there is anywhere to record into, so recordPgliteOwner's own
    // does-it-exist guard silently swallows the write and the lock is never
    // written at all — exactly the first-run hole it was added to close.
    await client.waitReady;
    recordPgliteOwner(env.pglitePath);
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
