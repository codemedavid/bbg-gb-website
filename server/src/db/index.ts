import { env } from '../lib/env.js';
import * as schema from './schema.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

let db: PgDatabase<any, typeof schema>;
let closeDb: () => Promise<void>;

if (env.databaseUrl) {
  // Production / real Postgres (Supabase). Transaction pooler needs prepare:false.
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  const client = postgres(env.databaseUrl, { prepare: false });
  db = drizzle(client, { schema }) as unknown as PgDatabase<any, typeof schema>;
  closeDb = () => client.end();
} else {
  // Dev fallback: embedded Postgres (PGlite), persisted under server/.pglite.
  const { drizzle } = await import('drizzle-orm/pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite('./.pglite');
  db = drizzle(client, { schema }) as unknown as PgDatabase<any, typeof schema>;
  closeDb = async () => { await client.close(); };
}

export { db, closeDb };
export * from './schema.js';
