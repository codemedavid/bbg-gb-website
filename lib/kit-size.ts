// Deriving a product's supplier pack size from its spec text.
//
// `products.kit_size` is the divisor behind the weekly report's Kits column, so
// a wrong value under-orders a batch by exactly the factor it is wrong by. The
// original backfill keyed on price-list codes (LB10, CK-PRF, …), but the live
// catalogue carries no codes on those rows, so it matched nothing. The specs do
// state the pack size, and every pattern here comes from a real spec string.
//
// Pure and read-only: this proposes a value for a human to approve, it does not
// decide anything on its own. Products whose pack size the spec does not state
// keep the catalogue default.

/** Vials in a peptide supplier kit — the default for anything not stated otherwise. */
export const VIALS_PER_PEPTIDE_KIT = 10;

// A number written against a unit is a dose, not a count: "2ml" is how much is
// in each syringe, never how many syringes there are.
const UNIT = String.raw`(?:ml|mg|mcg|g|iu|u)`;

// "A x B" where exactly one side carries a unit. The bare side is the count:
// "2x1ml" is two 1ml syringes, "2.5mlx10" is ten 2.5ml ones. Same shape,
// opposite answers, which is why the unit has to decide rather than position.
const COUNT_THEN_DOSE = new RegExp(String.raw`(?:^|[^\d.])(\d+)\s*[x×]\s*\d+(?:\.\d+)?\s*${UNIT}\b`, 'i');
const DOSE_THEN_COUNT = new RegExp(String.raw`\d+(?:\.\d+)?\s*${UNIT}\s*[x×]\s*(\d+)\b`, 'i');

// A count stated in words rather than as a product: "10 vials", "3 syringes",
// "1 prefilled syringe". Up to two describing words may sit between the number
// and the noun. The lookahead is what keeps a dose out: in "15mg vial" the 15
// is followed by a unit, so it is how big the vial is, not how many there are.
// `pairs` is here because the Skin Repair series ships a powder vial bundled
// with its own solvent and the price list counts the bundle, not the vials in
// it — "5 pairs" is five units to order, not ten.
const COUNTED_UNITS = new RegExp(
  String.raw`(\d+)(?!\s*${UNIT}\b)\s*(?:x\s*)?(?:[a-z-]+\s+){0,2}(?:vials?|syringes?|pcs?|pieces?|ampoules?|pairs?)\b`,
  'i',
);

// Explicitly sold one at a time.
const PER_PIECE = /\bper\s*(?:piece|pc)\b/i;

/**
 * The supplier pack size a spec states, or the peptide kit when it states none.
 *
 * Never returns 0 or a fraction — the caller divides by this, so a 0 would put
 * Infinity on a supplier order and a fraction would invent partial vials.
 */
export function kitSizeFromSpec(spec: string | null | undefined): number {
  const text = (spec ?? '').trim();
  if (!text) return VIALS_PER_PEPTIDE_KIT;

  if (PER_PIECE.test(text)) return 1;

  // Dose-then-count is checked first: "2.5mlx10" also matches the counted-units
  // shape further along the string ("10 prefilled syringes"), and both agree,
  // but reading the explicit pair keeps the answer anchored to the pack itself.
  for (const pattern of [DOSE_THEN_COUNT, COUNT_THEN_DOSE, COUNTED_UNITS]) {
    const found = text.match(pattern);
    if (!found) continue;
    const count = Math.trunc(Number(found[1]));
    // A spec that parses to nothing usable (0, NaN) is treated as unstated
    // rather than trusted — the default is wrong far less often than 0 is.
    if (Number.isFinite(count) && count > 0) return count;
  }

  return VIALS_PER_PEPTIDE_KIT;
}
