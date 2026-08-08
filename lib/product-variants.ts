// Collapsing a catalogue of strengths into one card per peptide — pure rules,
// no I/O.
//
// Tirzepatide is five rows in `products` (15mg, 30mg, 40mg, 60mg, 100mg) and
// the Kahati board carries one counter per strength. Listing each as its own
// card makes a customer read the same peptide name five times and compare
// prices across cards. Grouping is presentation only: nothing here changes what
// is stocked, what anything costs, or which row is eventually added to a cart.
//
// Written generically over an accessor "view" for the same reason
// lib/board-filter.ts is: the shop groups `products` and the Kahati board
// groups counters by the product behind them. Two implementations of "which
// rows are the same peptide" is how the two boards get to disagree.

/** A magnitude and the unit it is expressed in, e.g. 15mg. */
export type Strength = { value: number; unit: string };

/**
 * Read the leading magnitude off a spec: '15mg vial' -> 15mg.
 *
 * Returns null when the spec does not start with a number — 'prefilled
 * syringe', or a blank spec on a legacy row. Null means "cannot be ranked",
 * which callers handle by falling back to label order rather than guessing.
 */
export function parseStrength(spec: string): Strength | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/.exec(spec ?? '');
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

/** How to read grouping and labelling off a board row. */
export type VariantView<T> = {
  /**
   * What makes two rows the same peptide. Null for a row with nothing to group
   * on — a legacy free-text hatian counter with no product behind it — which
   * gets a group to itself rather than joining a shared "no key" bucket.
   */
  key: (row: T) => string | null;
  /** The heading the group carries. Taken from the first row in the group. */
  name: (row: T) => string;
  /** What distinguishes this row from its siblings: '15mg vial'. */
  variantLabel: (row: T) => string;
};

export type VariantGroup<T> = {
  key: string;
  name: string;
  variants: T[];
  /** True when there is nothing to choose — render the spec, not a dropdown. */
  isSingle: boolean;
};

/**
 * Order two variants within a group.
 *
 * By magnitude when both parse and share a unit, because '100mg' sorting before
 * '15mg' — which is what a plain string comparison does — is the opposite of
 * what a customer reading a dose list expects. Mixed or unparseable units fall
 * back to the label: 10ml is neither more nor less than 5mg, and inventing a
 * comparison between them would just be an unstable order.
 */
function compareVariants(a: string, b: string): number {
  const sa = parseStrength(a);
  const sb = parseStrength(b);
  if (sa && sb && sa.unit === sb.unit) return sa.value - sb.value;
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Group rows into one entry per peptide, variants ordered by strength.
 *
 * Group order is the order the rows arrived in — the server already ranked the
 * catalogue (by category and sort order) or the board (by demand), and
 * re-deriving that ranking here is how the two get to disagree. Only the
 * variants WITHIN a group are reordered, because their order is a dose list and
 * nothing upstream established one.
 *
 * Returns new arrays; the caller's is left alone, because the pages group a
 * react-query result they do not own.
 */
export function groupVariants<T>(rows: readonly T[], view: VariantView<T>): VariantGroup<T>[] {
  const groups: VariantGroup<T>[] = [];
  const byKey = new Map<string, VariantGroup<T>>();

  rows.forEach((row, i) => {
    const key = view.key(row);
    // A keyless row is its own group. Bucketing them together would merge
    // unrelated legacy counters into a single card under one arbitrary name.
    const existing = key == null ? undefined : byKey.get(key);
    if (existing) {
      existing.variants.push(row);
      existing.isSingle = false;
      return;
    }
    const group: VariantGroup<T> = {
      key: key ?? `__ungrouped_${i}`,
      name: view.name(row),
      variants: [row],
      isSingle: true,
    };
    if (key != null) byKey.set(key, group);
    groups.push(group);
  });

  return groups.map((g) => ({
    ...g,
    variants: [...g.variants].sort((a, b) => compareVariants(view.variantLabel(a), view.variantLabel(b))),
  }));
}
