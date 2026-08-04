// Guards the import of "Price list.xlsx" into the seed catalog.
//
// The catalog is what an admin picks from when building a Group Buy campaign's
// "Included products" list, so a row that never made it out of the spreadsheet
// is a product nobody can group-buy. This file asserts the Pricelist sheet and
// the catalog agree, and that the one product the client excluded — the FUAN
// GTT — stays off the catalog.
//
// The normalisation, aliases and exclusions live in lib/pricelist-match.ts so
// the QA audit of the live products table applies exactly these rules; see the
// header there for why matching is on name + size and never on CAT/Code.
import { describe, it, expect } from 'vitest';
import { PRODUCTS, MOQ_PRODUCTS } from './catalog';
import {
  excluded, findMatch, describeRow, type PricelistRow,
} from '../../pricelist-match';
import pricelist from '../../../data/pricelist.json';

const ROWS = pricelist.sheets.pricelist as PricelistRow[];

const findInCatalog = (r: PricelistRow) => findMatch(r, PRODUCTS);

// ---- Tests ---------------------------------------------------------------
describe('price list -> catalog coverage', () => {
  it('imports every priced Pricelist row into the seed catalog', () => {
    const missing = ROWS
      .filter((r) => !excluded(r))
      .filter((r) => r.php != null && r.php > 0)
      .filter((r) => findInCatalog(r) === null)
      .map(describeRow);
    expect(missing).toEqual([]);
  });

  it('carries the workbook PHP price through unchanged', () => {
    const drifted = ROWS
      .filter((r) => !excluded(r) && r.php != null && r.php > 0)
      .flatMap((r) => {
        const p = findInCatalog(r);
        if (!p || p.pricePhp === r.php) return [];
        return [`${describeRow(r)} -> catalog ₱${p.pricePhp}`];
      });
    expect(drifted).toEqual([]);
  });

  it('carries the workbook USD price through unchanged', () => {
    const drifted = ROWS
      .filter((r) => !excluded(r) && r.usd != null && r.usd > 0)
      .flatMap((r) => {
        const p = findInCatalog(r);
        if (!p || p.priceUsd == null || p.priceUsd === r.usd) return [];
        return [`${describeRow(r)} -> catalog $${p.priceUsd}`];
      });
    expect(drifted).toEqual([]);
  });
});

describe('GTT exclusion', () => {
  it('keeps the FUAN GTT out of the group buy catalog', () => {
    const leaked = PRODUCTS.filter((p) => /gtt/i.test(p.name) || /gtt/i.test(p.code ?? ''));
    expect(leaked).toEqual([]);
  });

  it('leaves the FUAN GTT on the MOQ shelf where it already lives', () => {
    expect(MOQ_PRODUCTS.some((m) => /gtt/i.test(m.name))).toBe(true);
  });
});
