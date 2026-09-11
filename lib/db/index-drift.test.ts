// Every index a migration created must also be declared in schema.ts.
//
// schema.ts is the input to `drizzle-kit generate`, so an index that exists only
// in a migration is invisible to it: the next generated migration drops the
// index as "removed from the schema". Nothing fails, no test goes red, and a
// query that was fast becomes a sequential scan on a table that only grows.
//
// scripts/check-schema.ts cannot catch this — lib/db/drift.ts compares columns
// and enum labels, not indexes, and the pglite suite builds its tables from
// schema.ts, so schema and database agree there by construction.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './schema';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

/** Index names any migration in drizzle/ has created. */
function indexesInMigrations(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const match of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)) {
      names.add(match[1]);
    }
  }
  return names;
}

/** Index names schema.ts declares, across every exported table. */
function indexesInSchema(): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    let config;
    try {
      config = getTableConfig(value as never);
    } catch {
      continue; // not a pgTable — enums, helpers, constants
    }
    // Drizzle types both names as optional — an index or constraint may be left
    // unnamed, in which case Postgres picks one and no migration can name it.
    for (const idx of config.indexes) if (idx.config.name) names.add(idx.config.name);
    // A unique() on a column produces an index too, under the constraint's name.
    for (const uq of config.uniqueConstraints) if (uq.name) names.add(uq.name);
  }
  return names;
}

describe('migration and schema index parity', () => {
  it('declares every migrated index in schema.ts', () => {
    const declared = indexesInSchema();
    const orphaned = [...indexesInMigrations()].filter((name) => !declared.has(name)).sort();

    // Each name here is an index the next `drizzle-kit generate` will emit a
    // DROP for, because schema.ts does not know it exists.
    expect(orphaned).toEqual([]);
  });

  it('reads a non-empty set from both sides, so a passing run means something', () => {
    // Guards the guard: a broken regex or a moved directory would otherwise make
    // this file pass by comparing two empty sets forever.
    expect(indexesInMigrations().size).toBeGreaterThan(10);
    expect(indexesInSchema().size).toBeGreaterThan(10);
  });
});
