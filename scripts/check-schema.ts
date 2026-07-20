// Fails loudly when the database behind DATABASE_URL is behind schema.ts.
//
// Run before a deploy (`npm run db:check`). The test suite cannot catch this:
// it builds pglite tables from schema.ts, so schema and database always agree
// there. Only a real connection can tell you the deployed one is stale.
import 'dotenv/config';
import postgres from 'postgres';
import { diffSchema, formatDrift, type SchemaShape } from '../lib/db/drift';
import { declaredShape } from '../lib/db/schema-shape';
import { decideCheckOutcome } from '../lib/db/check-outcome';

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

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;

  // No database configured: report the skip loudly and let the build through.
  // See decideCheckOutcome for why this is not treated as a clean check.
  if (!url) {
    const outcome = decideCheckOutcome({ hasDatabaseUrl: false, hasDrift: false });
    console.warn(outcome.message);
    return outcome.exitCode;
  }

  const sql = postgres(url, { max: 1 });
  try {
    let drift;
    try {
      drift = diffSchema(declaredShape(), await liveShape(sql));
    } catch (err) {
      const outcome = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: false, connectionFailed: true });
      console.error(outcome.message);
      console.error(err instanceof Error ? err.message : err);
      return outcome.exitCode;
    }

    const outcome = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: drift.hasDrift });
    if (drift.hasDrift) {
      console.error(outcome.message);
      console.error(formatDrift(drift));
    } else {
      console.log(outcome.message);
    }
    return outcome.exitCode;
  } finally {
    // Close the pool before exiting, rather than letting process.exit strand it.
    await sql.end();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('Schema check failed:', err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
