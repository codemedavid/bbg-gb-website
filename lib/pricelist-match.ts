// Matching a "Price list.xlsx" row to a product.
//
// Extracted from lib/db/data/pricelist-coverage.test.ts so the same rules serve
// both the seed-catalog assertion and the QA audit that checks the live
// products table. Two copies of this normalisation would drift, and a drifted
// matcher reports phantom gaps — the one failure mode an import audit must not
// have.
//
// Matching is on name + size, NEVER on the workbook's CAT/Code: the Retatrutide
// block reuses Tirzepatide's BBG1000-** codes at different prices, so a code
// lookup returns the wrong product with full confidence.

/** One row of the workbook's `Pricelist` sheet, as data/pricelist.json stores it. */
export type PricelistRow = {
  category: string;
  name: string;
  size: string | null;
  code: string | null;
  usd: number | null;
  php: number | null;
  block: string;
  row: number;
};

/** The minimum a product must expose to be matched — seed entry or database row. */
export type MatchableProduct = { name: string; spec: string };

/** Strips everything but letters, digits and '+' so labels are comparable. */
export const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9+]/g, '');

/**
 * Reduces a spreadsheet label to a bare product name. The workbook packs
 * packaging, size and code into it ("Rejuran i (1 prefilled Syringe) 1ml",
 * "Periocular Peptide YSG01/5ML"); products split those into name + spec + code.
 */
export function baseName(label: string): string {
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

/** Numeric part of a size/spec: "15.0" -> 15, "15mg vial" -> 15, "" -> null. */
export function sizeOf(s: string | null | undefined): number | null {
  const m = (s ?? '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Genuine renames applied on import — spreadsheet typos and abbreviations that
 * no amount of normalisation can bridge. Keyed by the normalised spreadsheet
 * label, valued by the normalised product name.
 */
export const ALIASES: Record<string, string> = {
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

export const aliasOf = (n: string): string => ALIASES[n] ?? n;

/** The normalised key a workbook row and a product are matched on. */
export const rowKey = (r: PricelistRow): string => aliasOf(norm(baseName(r.name)));
export const productKey = (p: MatchableProduct): string => norm(p.name);

/** Rows the import deliberately leaves out. */
export const EXCLUSIONS: { why: string; match: (r: PricelistRow) => boolean }[] = [
  {
    // The client's instruction for this import: everything except the GTT.
    // It stays on the MOQ shelf and must not become a catalog product an admin
    // could add to a Group Buy campaign.
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

export const excluded = (r: PricelistRow) => EXCLUSIONS.find((e) => e.match(r));

/**
 * The products a workbook row matches, in catalog order. Returns every hit
 * rather than the first so callers can tell "missing" from "duplicated" — one
 * row matching two products is a duplicate, not a success.
 *
 * A sizeless row (the aesthetics block) matches on name alone; a sized row must
 * match on size too, or a 40mg vial would silently "match" the 10mg one.
 */
export function findMatches<T extends MatchableProduct>(r: PricelistRow, products: readonly T[]): T[] {
  const wanted = rowKey(r);
  const rowSize = sizeOf(r.size);
  const hits = products.filter((p) => productKey(p) === wanted);
  if (rowSize === null) return hits;
  return hits.filter((p) => sizeOf(p.spec) === rowSize);
}

/** The single product a row maps to, or null when it maps to none. */
export function findMatch<T extends MatchableProduct>(r: PricelistRow, products: readonly T[]): T | null {
  return findMatches(r, products)[0] ?? null;
}

export const describeRow = (r: PricelistRow): string =>
  `${r.name} | size=${r.size ?? '-'} | code=${r.code ?? '-'} | ₱${r.php} (${r.block} row ${r.row})`;
