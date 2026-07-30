// QA-only: build an isolated PGlite database from drizzle/*.sql and seed it.
//
// Deliberately applies the migration FILES (like lib/test/harness.ts) rather
// than drizzle-kit migrate: drizzle/meta/_journal.json stops at 0010, so the
// journal-driven path silently skips 0011 and 0013.
//
// Never run against DATABASE_URL — it refuses if one is set.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb, closeDb } from '../../lib/db';

if (process.env.DATABASE_URL) {
  console.error('Refusing to bootstrap: DATABASE_URL is set. QA runs on PGlite only.');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');

async function main() {
  const db = await getDb();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  console.log(`Applying ${files.length} migration files from ${MIGRATIONS_DIR}`);
  for (const file of files) {
    const statements = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Re-running bootstrap over an existing QA db is a valid state.
        if (/already exists|duplicate/i.test(msg)) continue;
        console.error(`FAILED in ${file}: ${msg}`);
        throw err;
      }
    }
    console.log(`  ok ${file}`);
  }
  await closeDb();
}

main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
