// The migration journal must describe the migration files exactly.
//
// This is the invariant whose breach cost a production outage: 0013 existed on
// disk, was absent from drizzle/meta/_journal.json, and so was never applied by
// any journal-driven path. Admin > Product Management 500'd on the missing
// column while every test stayed green, because tests build their schema from
// schema.ts and the migration FILES — the two places that cannot disagree.
//
// Asserted against the directory itself so the next dropped entry goes red here
// rather than in production.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../drizzle/', import.meta.url));

const journal = JSON.parse(readFileSync(`${dir}meta/_journal.json`, 'utf8')) as {
  entries: { idx: number; tag: string; when: number; breakpoints: boolean; version: string }[];
};

const sqlTags = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const journalTags = journal.entries.map((e) => e.tag);

describe('migration journal', () => {
  it('has an entry for every migration file on disk', () => {
    const missing = sqlTags.filter((t) => !journalTags.includes(t));
    expect(missing).toEqual([]);
  });

  it('has a file on disk for every entry', () => {
    const orphaned = journalTags.filter((t) => !sqlTags.includes(t));
    expect(orphaned).toEqual([]);
  });

  it('numbers its entries contiguously from zero', () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  // drizzle-kit names the next migration from the journal's LENGTH. If an idx
  // and its filename prefix disagree, the next `db:generate` writes a file whose
  // name already exists and silently overwrites a real migration.
  it('keeps each entry index equal to its filename prefix', () => {
    const mismatched = journal.entries
      .filter((e) => e.idx !== Number(e.tag.slice(0, 4)))
      .map((e) => `idx ${e.idx} -> ${e.tag}`);
    expect(mismatched).toEqual([]);
  });

  it('leaves no gap in the migration filenames', () => {
    const prefixes = sqlTags.map((t) => Number(t.slice(0, 4)));
    expect(prefixes).toEqual(prefixes.map((_, i) => i));
  });

  // The name the next `npm run db:generate` would take must not already exist.
  it('would not overwrite an existing migration on the next generate', () => {
    const next = String(journal.entries.length).padStart(4, '0');
    const collision = sqlTags.filter((t) => t.startsWith(`${next}_`));
    expect(collision).toEqual([]);
  });
});
