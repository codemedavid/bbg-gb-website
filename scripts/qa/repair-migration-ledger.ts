// drizzle.__drizzle_migrations in production records 5 migrations; the schema is
// actually at 0012. `drizzle-kit migrate` would therefore re-run 0005..0012 and
// fail on objects that already exist — which is why every deploy so far has had
// to use `db:push`.
//
// This backfills the ledger so the recorded history matches the schema that is
// really there. It writes ONLY to drizzle.__drizzle_migrations; it never runs
// migration SQL. Refuses unless drizzle's own hash algorithm reproduces the
// rows already present, because a backfill computed a different way would
// silently mark the wrong migrations as applied.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

// drizzle-kit hashes the raw file contents with sha256.
const hashOf = (tag: string) =>
  createHash('sha256').update(readFileSync(`drizzle/${tag}.sql`, 'utf8')).digest('hex');

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<{ id: number; hash: string; created_at: string }[]>`
      select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`;
    console.log(`ledger rows: ${rows.length} | journal entries: ${journal.entries.length}`);

    // Verify the algorithm against what is already recorded.
    const mismatched = rows.filter((r, i) => journal.entries[i] && hashOf(journal.entries[i].tag) !== r.hash);
    if (mismatched.length) {
      console.error('ABORT: recomputed hashes do not match the existing ledger rows.');
      mismatched.forEach((r, i) => console.error(`  row ${r.id}: db=${r.hash.slice(0, 12)} computed=${hashOf(journal.entries[i].tag).slice(0, 12)}`));
      process.exitCode = 1;
      return;
    }
    console.log(`hash algorithm verified against all ${rows.length} existing rows.`);

    const missing = journal.entries.slice(rows.length);
    console.log(`missing from the ledger: ${missing.length}`);
    missing.forEach((e) => console.log(`   + ${e.tag}`));
    if (!missing.length) return;

    if (!APPLY) { console.log('\nDRY RUN — pass --apply to backfill.'); return; }

    await sql.begin(async (tx) => {
      for (const e of missing) {
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at)
                 values (${hashOf(e.tag)}, ${String(e.when)})`;
      }
    });
    const after = await sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    console.log(`\nledger backfilled — now ${after[0].n} rows.`);
  } finally {
    await sql.end();
  }
}
main();
