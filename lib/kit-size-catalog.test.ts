// The approved pack sizes, and the two things that must stay true about them.
//
// These 19 products were reviewed against the live catalogue on 2026-08-05 and
// signed off by the client. They are the only rows in the catalogue that do not
// order in a 10-vial peptide kit, so they are the only rows where a wrong
// divisor silently under-orders a batch.
//
// Two seams are pinned here: the parser must still derive each approved value
// from the spec text, and the migration must still carry an UPDATE for every
// approved product. Either drifting is a silent supplier-order error, which is
// exactly the failure this feature exists to prevent.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { kitSizeFromSpec, VIALS_PER_PEPTIDE_KIT } from './kit-size';
import { APPROVED_KIT_SIZES } from './kit-size-catalog';

const MIGRATION = path.resolve(__dirname, '../drizzle/0014_product_kit_size_backfill.sql');

describe('the approved kit sizes', () => {
  it('covers the 19 products reviewed against the live catalogue', () => {
    expect(APPROVED_KIT_SIZES).toHaveLength(19);
  });

  it('never approves a divisor that would corrupt the Kits column', () => {
    for (const p of APPROVED_KIT_SIZES) {
      expect(Number.isInteger(p.kitSize)).toBe(true);
      expect(p.kitSize).toBeGreaterThan(0);
    }
  });

  // Every approved row is a departure from the default. A row that agrees with
  // the default does not belong here — it would be an UPDATE that changes
  // nothing, hiding the fact that the list no longer says anything.
  it('only lists products that differ from the peptide kit default', () => {
    for (const p of APPROVED_KIT_SIZES) {
      expect(p.kitSize, `${p.name} matches the default and should not be listed`)
        .not.toBe(VIALS_PER_PEPTIDE_KIT);
    }
  });

  // The seam that matters: if someone widens a regex in kit-size.ts and Juvederm
  // starts reading 1 instead of 2, this fails rather than the supplier order.
  it('is exactly what the parser derives from each spec', () => {
    for (const p of APPROVED_KIT_SIZES) {
      expect(kitSizeFromSpec(p.spec), `${p.name} — "${p.spec}"`).toBe(p.kitSize);
    }
  });

  it('holds the specific values signed off, not merely self-consistent ones', () => {
    const bySize = (n: number) => APPROVED_KIT_SIZES.filter((p) => p.kitSize === n).length;
    expect(bySize(1)).toBe(10);
    expect(bySize(2)).toBe(6);
    expect(bySize(3)).toBe(1);
    expect(bySize(5)).toBe(2);
  });
});

describe('the backfill migration', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  it('carries an UPDATE for every approved product', () => {
    for (const p of APPROVED_KIT_SIZES) {
      // Names are matched, not ids: a migration that hard-codes production UUIDs
      // cannot run against a local database or the test harness.
      expect(sql, `no UPDATE for ${p.name}`).toContain(p.name.replace(/'/g, "''"));
    }
  });

  it('sets each product to the kit size that was approved for it', () => {
    for (const p of APPROVED_KIT_SIZES) {
      const stanza = sql.split('UPDATE "products"')
        .find((s) => s.includes(p.name.replace(/'/g, "''")));
      expect(stanza, `no UPDATE stanza for ${p.name}`).toBeDefined();
      expect(stanza, `${p.name} is not set to ${p.kitSize}`)
        .toMatch(new RegExp(String.raw`SET\s+"kit_size"\s*=\s*${p.kitSize}\b`));
    }
  });

  it('touches nothing outside the approved list', () => {
    const updates = sql.match(/UPDATE "products"/g) ?? [];
    // One statement per distinct kit size, not per product — products sharing a
    // size are matched together, so the statement count is the size count.
    const sizes = new Set(APPROVED_KIT_SIZES.map((p) => p.kitSize));
    expect(updates).toHaveLength(sizes.size);
  });
});
