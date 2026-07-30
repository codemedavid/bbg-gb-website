// Guards the import of "Price list.xlsx" into the seed catalog.
//
// The catalog is what an admin picks from when building a Group Buy campaign's
// "Included products" list (app/admin/campaigns/page.tsx), so a row that never
// made it out of the spreadsheet is a product nobody can group-buy. This file
// asserts the Pricelist sheet and the catalog agree, and that the one product
// the client excluded — the FUAN GTT — stays off the catalog.
import { describe, it, expect } from 'vitest';
import { PRODUCTS, MOQ_PRODUCTS } from './catalog';
import pricelist from '../../../data/pricelist.json';

type Row = {
  category: string; name: string; size: string | null;
  code: string | null; usd: number | null; php: number | null;
  block: string; row: number;
};

const ROWS = pricelist.sheets.pricelist as Row[];

// ---- Normalisation -------------------------------------------------------
// The spreadsheet packs packaging, size and code into the product label
// ("Rejuran i (1 prefilled Syringe) 1ml", "Periocular Peptide YSG01/5ML");
// the catalog splits those into name + spec + code. Reduce both to a bare
// product name so the two forms are comparable.
const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9+]/g, '');

function baseName(label: string): string {
  return label
    // Packaging parentheticals only — those carrying a digit or a packaging
    // noun. Qualifier parentheticals stay: "(Salt Form)", "(Focus)",
    // "(Topical)" name a different product from their unqualified sibling,
    // and dropping them would let Retatrutide (Salt Form) 15mg "match" plain
    // Retatrutide 15mg at a different price.
    .replace(/\((?=[^)]*(?:\d|syringe|vial|prefilled))[^)]*\)/gi, ' ')
    // Trailing catalogue code + size on the skin-booster peptides, e.g.
    // "Periocular Peptide YSG01/5ML". Deliberately narrow: a broader
    // "letters+digits" rule would eat product names like BPC157 and TB500.
    .replace(/\b[A-Z]{3}\d{2}\/[\d.]*\s*ml\b/gi, ' ')
    .replace(/\b[\d.]+\s*(?:ml|mg|u)\b/gi, ' ')  // trailing 5ml / 100U / 1 ml
    .replace(/\//g, ' ')
    .trim();
}

// Numeric part of a size/spec: "15.0" -> 15, "15mg vial" -> 15, "" -> null.
function sizeOf(s: string | null | undefined): number | null {
  const m = (s ?? '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

// Genuine renames the catalog applies on import — spreadsheet typos and
// abbreviations that no amount of normalisation can bridge. Keyed by the
// normalised spreadsheet label, valued by the normalised catalog name.
const ALIASES: Record<string, string> = {
  vitmaincpeptide: 'vitamincpeptide',            // workbook typo: "Vitmain"
  ta1: 'thymosinalpha1',
  'cjcwodac+ipa': 'cjcwodac+ipamorelin',
  glutathione600: 'glutathione',
  'tb500+bpc157': 'wolverinetb500+bpc',
  lcar: 'lcarnitine',
  healthyhairskinandnailsblend: 'hairskinnails',
  tirzepatidesaltformmounjaro: 'tirzepatidesaltform',
  '5amino1': '5amino1mq',
};

const aliasOf = (n: string) => ALIASES[n] ?? n;

// ---- Deliberate exclusions ----------------------------------------------
const EXCLUSIONS: { why: string; match: (r: Row) => boolean }[] = [
  {
    // The client's instruction for this import: everything except the GTT.
    // It stays on the MOQ shelf (MOQ_PRODUCTS) and must not become a
    // catalog product an admin could add to a Group Buy campaign.
    why: 'FUAN GTT1500 is MOQ-shelf only — excluded from the group buy catalog',
    match: (r) => /gtt/i.test(r.name),
  },
  {
    // Listed at PHP 0 in the workbook. Importing it would mean inventing a
    // price; an absent product is better than a fictional one.
    why: 'L Carnitine 5000 is priced 0 in the source workbook',
    match: (r) => r.code === 'LC5000',
  },
];

const excluded = (r: Row) => EXCLUSIONS.find((e) => e.match(r));

// ---- Catalog index -------------------------------------------------------
const catalogEntries = PRODUCTS.map((p) => ({
  key: norm(p.name),
  size: sizeOf(p.spec),
  product: p,
}));

// Matching is on name + size, never on the workbook's CAT/Code. The Retatrutide
// block reuses Tirzepatide's codes verbatim — Retatrutide 15mg is listed as
// BBG1000-15, the same code Tirzepatide 15mg carries at a different price — so a
// code lookup returns the wrong product with full confidence. The catalog mints
// BBG1000-R** for the Retatrutide line precisely to break that collision.
function findInCatalog(r: Row) {
  const wanted = aliasOf(norm(baseName(r.name)));
  const rowSize = sizeOf(r.size);
  const hits = catalogEntries.filter((c) => c.key === wanted);
  if (hits.length === 0) return null;
  // A sizeless row (the aesthetics block) matches the single entry of that
  // name; a sized row must match on size too, or a 40mg vial would silently
  // "match" the 10mg one already in the catalog.
  if (rowSize === null) return hits[0].product;
  return hits.find((c) => c.size === rowSize)?.product ?? null;
}

const describeRow = (r: Row) =>
  `${r.name} | size=${r.size ?? '-'} | code=${r.code ?? '-'} | ₱${r.php} (${r.block} row ${r.row})`;

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
