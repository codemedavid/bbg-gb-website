// Fails loudly when the database behind DATABASE_URL is behind schema.ts.
//
// Run before a deploy (`npm run db:check`). The test suite cannot catch this:
// it builds pglite tables from schema.ts, so schema and database always agree
// there. Only a real connection can tell you the deployed one is stale.
import 'dotenv/config';
import postgres from 'postgres';
import { diffSchema, formatDrift, type SchemaShape } from '../lib/db/drift';
import { declaredShape } from '../lib/db/schema-shape';

async function liveShape(sql: postgres.Sql): Promise<SchemaShape> {
  const columns = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'`;
  const labels = await sql<{ typname: string; enumlabel: string }[]>`
    select t.typname, e.enumlabel from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' order by e.enumsortorder`;

  const shape: SchemaShape = { tables: {}, enums: {} };
  for (const { table_name, column_name } of columns) {
    (shape.tables[table_name] ??= []).push(column_name);
  }
  for (const { typname, enumlabel } of labels) {
    (shape.enums[typname] ??= []).push(enumlabel);
  }
  return shape;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set — cannot check schema drift.');
    process.exit(2);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const drift = diffSchema(declaredShape(), await liveShape(sql));
    console.log(formatDrift(drift));
    if (drift.hasDrift) process.exit(1);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Schema check failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});
