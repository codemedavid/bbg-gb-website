// Drizzle hands `numeric` columns back as strings, and several of them are
// nullable (an item with no USD price, an order with no USD total). Both report
// builders need the same coercion, and both need it to yield 0 rather than NaN —
// one NaN anywhere in a spreadsheet poisons every total downstream of it.

export const num = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

/** Round to centavos. Keeps float drift (10×6.8 + 9×6.8) out of money cells. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
