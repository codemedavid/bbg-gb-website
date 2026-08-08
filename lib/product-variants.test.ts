// Collapsing a catalogue of strengths into one card per peptide.
//
// Tirzepatide is five rows in `products` — 15mg, 30mg, 40mg, 60mg, 100mg — and
// the shop listed all five as separate cards. A customer scrolling for a
// peptide reads the same name five times and has to compare prices across
// cards. Grouping is a display concern only: nothing here changes what is
// stocked or what anything costs.
import { describe, it, expect } from 'vitest';
import { parseStrength, groupVariants } from './product-variants';

const p = (name: string, spec: string) => ({ name, spec });
const view = {
  key: (r: { name: string }) => r.name,
  name: (r: { name: string }) => r.name,
  variantLabel: (r: { spec: string }) => r.spec,
};

describe('parseStrength', () => {
  it('reads the leading magnitude and unit off a spec', () => {
    expect(parseStrength('15mg vial')).toEqual({ value: 15, unit: 'mg' });
    expect(parseStrength('100mg vial')).toEqual({ value: 100, unit: 'mg' });
    expect(parseStrength('10ml vial')).toEqual({ value: 10, unit: 'ml' });
  });

  it('is case- and space-insensitive about the unit', () => {
    expect(parseStrength('50mL x 10 vials')).toEqual({ value: 50, unit: 'ml' });
    expect(parseStrength('5 mg vial')).toEqual({ value: 5, unit: 'mg' });
  });

  it('gives up rather than guessing on a spec with no leading magnitude', () => {
    expect(parseStrength('prefilled syringe')).toBeNull();
    expect(parseStrength('')).toBeNull();
  });
});

describe('groupVariants', () => {
  it('collapses the strengths of one peptide into a single group', () => {
    const groups = groupVariants(
      [p('Tirzepatide', '15mg vial'), p('Tirzepatide', '30mg vial'), p('Retatrutide', '10mg vial')],
      view,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Tirzepatide');
    expect(groups[0].variants).toHaveLength(2);
    expect(groups[1].variants).toHaveLength(1);
  });

  // Character-code ordering puts "100mg" before "15mg" before "30mg", which is
  // the order a customer reading a dose dropdown least expects.
  it('orders strengths by magnitude, not by spelling', () => {
    const [group] = groupVariants(
      ['100mg vial', '15mg vial', '30mg vial', '60mg vial', '40mg vial']
        .map((s) => p('Tirzepatide', s)),
      view,
    );

    expect(group.variants.map((v) => v.spec))
      .toEqual(['15mg vial', '30mg vial', '40mg vial', '60mg vial', '100mg vial']);
  });

  // A salt form is a different product with a different price and a different
  // arrival group. Fuzzy prefix matching would fold it into the base peptide
  // and quietly sell one as the other.
  it('keeps a differently-named product out of the group', () => {
    const groups = groupVariants(
      [p('Tirzepatide', '15mg vial'), p('Tirzepatide (Salt Form)', '30mg vial')],
      view,
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name)).toEqual(['Tirzepatide', 'Tirzepatide (Salt Form)']);
  });

  it('preserves the order the rows arrived in', () => {
    const groups = groupVariants(
      [p('Zinc', '5mg vial'), p('Alpha', '5mg vial'), p('Zinc', '10mg vial')],
      view,
    );

    // The server already ranked the catalogue; re-sorting here is how the two
    // orderings get to disagree.
    expect(groups.map((g) => g.name)).toEqual(['Zinc', 'Alpha']);
  });

  it('leaves a lone product as a group of one', () => {
    const [group] = groupVariants([p('KLOW', '80mg vial')], view);

    expect(group.variants).toHaveLength(1);
    expect(group.isSingle).toBe(true);
  });

  it('marks a multi-strength group as needing a picker', () => {
    const [group] = groupVariants(
      [p('Cagrilintide', '5mg vial'), p('Cagrilintide', '10mg vial')],
      view,
    );

    expect(group.isSingle).toBe(false);
  });

  // Mixed units cannot be ranked against each other — 10ml is not more or less
  // than 5mg. Falling back to the label keeps the order stable and readable
  // rather than inventing a comparison.
  it('falls back to label order when the units differ', () => {
    const [group] = groupVariants(
      [p('Blend', '10ml vial'), p('Blend', '5mg vial'), p('Blend', 'prefilled syringe')],
      view,
    );

    expect(group.variants).toHaveLength(3);
    expect(group.variants.map((v) => v.spec))
      .toEqual(['10ml vial', '5mg vial', 'prefilled syringe']);
  });

  // Rows with no product behind them (a legacy free-text hatian counter) have
  // no group to join and must not all collapse into one "undefined" card.
  it('gives each keyless row a group of its own', () => {
    const groups = groupVariants(
      [{ name: 'Legacy A', spec: '' }, { name: 'Legacy B', spec: '' }],
      { ...view, key: () => null },
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name)).toEqual(['Legacy A', 'Legacy B']);
  });
});
