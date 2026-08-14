// Searching and sorting a storefront board.
//
// One rule for both boards. The Group Buy board lists campaign batches and the
// Kahati board lists vial counters, but a customer looking for "reta 20mg"
// means the same thing on either — so the matching and the ordering live here
// rather than being written twice and drifting apart.
import { describe, it, expect } from 'vitest';
import { BOARD_SORTS, filterAndSortBoard, matchesBoardSearch, sortBoardRows } from '@/lib/board-filter';

type Row = { id: string; name: string; spec?: string; progress: number };

const row = (id: string, name: string, progress = 0, spec?: string): Row => ({ id, name, progress, spec });
const idsOf = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

const fieldsOf = (r: Row): (string | null | undefined)[] => [r.name, r.spec];
const nameOf = (r: Row): string => r.name;
const progressOf = (r: Row): number => r.progress;

describe('matchesBoardSearch', () => {
  it('matches on the product name, case-insensitively', () => {
    // Arrange
    const fields = ['Retatrutide 20mg vial', null];

    // Act / Assert
    expect(matchesBoardSearch(fields, 'RETA')).toBe(true);
    expect(matchesBoardSearch(fields, 'semaglutide')).toBe(false);
  });

  it('matches on the variant/specification, not only the name', () => {
    // The customer searching "5ml" is naming the variant they want, and on the
    // Kahati board the spec is a separate field from the counter's name.
    expect(matchesBoardSearch(['Salmon Peptide', '5ml ampoule'], '5ml')).toBe(true);
  });

  it('requires every word to appear, so two terms narrow rather than widen', () => {
    // "reta 20" must not surface Retatrutide 10mg alongside the 20mg the
    // customer actually asked for.
    const twenty = ['Retatrutide 20mg vial'];
    const ten = ['Retatrutide 10mg vial'];

    expect(matchesBoardSearch(twenty, 'reta 20')).toBe(true);
    expect(matchesBoardSearch(ten, 'reta 20')).toBe(false);
  });

  it('matches words found across different fields', () => {
    // One term from the name, one from the spec — the row still answers the query.
    expect(matchesBoardSearch(['Rejuran Healer', '2x2ml prefilled syringes'], 'rejuran 2ml')).toBe(true);
  });

  it('treats an empty or whitespace-only query as "show everything"', () => {
    expect(matchesBoardSearch(['anything'], '')).toBe(true);
    expect(matchesBoardSearch(['anything'], '   ')).toBe(true);
  });

  it('ignores null and undefined fields instead of throwing', () => {
    // A counter with no description carries null, and the board must still search.
    expect(matchesBoardSearch([null, undefined, 'Tirzepatide'], 'tirze')).toBe(true);
    expect(matchesBoardSearch([null, undefined], 'tirze')).toBe(false);
  });
});

describe('sortBoardRows', () => {
  const rows = [
    row('b', 'Bacteriostatic Water', 0.2),
    row('a', 'AOD9604 Pro Max', 0.9),
    row('c', 'Cagrilintide', 0.5),
  ];

  it('leaves the board in the order the server sent it under "default"', () => {
    // Default is the admin-configured ordering — demand rank on Kahati, the
    // admin's campaign order on Group Buy. The client must not second-guess it.
    expect(idsOf(sortBoardRows(rows, 'default', { name: nameOf, progress: progressOf }))).toEqual(['b', 'a', 'c']);
  });

  it('sorts A-Z by name', () => {
    expect(idsOf(sortBoardRows(rows, 'az', { name: nameOf, progress: progressOf }))).toEqual(['a', 'b', 'c']);
  });

  it('sorts Z-A by name', () => {
    expect(idsOf(sortBoardRows(rows, 'za', { name: nameOf, progress: progressOf }))).toEqual(['c', 'b', 'a']);
  });

  it('leads with the highest progress under "progress"', () => {
    expect(idsOf(sortBoardRows(rows, 'progress', { name: nameOf, progress: progressOf }))).toEqual(['a', 'c', 'b']);
  });

  it('breaks a progress tie alphabetically so the order is stable across reloads', () => {
    const tied = [row('z', 'Zinc Thymulin', 0.5), row('m', 'MOTS-c', 0.5)];
    expect(idsOf(sortBoardRows(tied, 'progress', { name: nameOf, progress: progressOf }))).toEqual(['m', 'z']);
  });

  it('compares names the way a person reads them, not by character code', () => {
    // A plain `<` puts every capital ahead of every lowercase, so "apple" would
    // sort after "Zebra". Locale comparison is what makes A-Z mean A-Z.
    const mixed = [row('z', 'Zebra Peptide'), row('a', 'apple Peptide')];
    expect(idsOf(sortBoardRows(mixed, 'az', { name: nameOf, progress: progressOf }))).toEqual(['a', 'z']);
  });

  it('does not mutate the array it was given', () => {
    const input = [row('b', 'B'), row('a', 'A')];
    const before = idsOf(input);

    sortBoardRows(input, 'az', { name: nameOf, progress: progressOf });

    expect(idsOf(input)).toEqual(before);
  });

  it('offers exactly the four sort options the storefront advertises', () => {
    expect(BOARD_SORTS.map((s) => s.value)).toEqual(['default', 'az', 'za', 'progress']);
  });
});

describe('filterAndSortBoard', () => {
  const board = [
    row('reta20', 'Retatrutide 20mg vial', 0.9),
    row('reta10', 'Retatrutide 10mg vial', 0.1),
    row('sema', 'Semaglutide 5mg vial', 0.5),
  ];

  it('searches and sorts together rather than one replacing the other', () => {
    // The requirement is explicit that the two compose: search narrows to the
    // Retatrutides, then Z-A orders what is left.
    const result = filterAndSortBoard(board, {
      query: 'retatrutide',
      sort: 'za',
      fields: fieldsOf,
      name: nameOf,
      progress: progressOf,
    });

    expect(idsOf(result)).toEqual(['reta20', 'reta10']);
  });

  it('returns only matching rows', () => {
    const result = filterAndSortBoard(board, {
      query: 'sema', sort: 'default', fields: fieldsOf, name: nameOf, progress: progressOf,
    });

    expect(idsOf(result)).toEqual(['sema']);
  });

  it('returns an empty board when nothing matches, rather than falling back to everything', () => {
    // Falling back to the full list would tell the customer their search worked
    // and that we stock the thing they asked for. Both would be false.
    const result = filterAndSortBoard(board, {
      query: 'insulin', sort: 'az', fields: fieldsOf, name: nameOf, progress: progressOf,
    });

    expect(result).toEqual([]);
  });
});
