// The products that do NOT order in a 10-vial peptide kit.
//
// Derived by kitSizeFromSpec from each product's own spec text, then reviewed
// against the live catalogue and signed off on 2026-08-05. 76 of the 95 live
// products are peptide vials and keep the column default of 10; these 19 are
// every exception.
//
// This list exists as data rather than as a regex in the migration because the
// values are supplier facts, not string patterns — a human approved each one,
// and lib/kit-size-catalog.test.ts pins them against both the parser and the
// backfill migration so neither can drift away from what was approved.
export type ApprovedKitSize = {
  name: string;
  /** The spec text the size was read from — the evidence for the number. */
  spec: string;
  kitSize: number;
};

export const APPROVED_KIT_SIZES: readonly ApprovedKitSize[] = [
  // Sold one at a time.
  { name: 'Botox Gas', spec: 'per piece', kitSize: 1 },
  { name: 'Mesoestetic Mesohyal Organic Silicon', spec: 'per piece', kitSize: 1 },
  { name: 'Nabota', spec: 'per piece', kitSize: 1 },
  { name: 'Rejuran Trueskin', spec: 'per piece', kitSize: 1 },
  { name: 'Rentox', spec: 'per piece', kitSize: 1 },
  { name: 'Profhilo', spec: '1x2ml', kitSize: 1 },
  { name: 'Rejuran hb', spec: '1 prefilled syringe, 1ml', kitSize: 1 },
  { name: 'Rejuran i', spec: '1 prefilled syringe, 1ml', kitSize: 1 },
  { name: 'Rejuran s', spec: '1 prefilled syringe, 1ml', kitSize: 1 },
  { name: 'Restylane Skin Booster', spec: '1x1ml prefilled syringe', kitSize: 1 },

  // Boxed in pairs.
  { name: 'JUVEDERM Ultra 2', spec: '2x1ml prefilled syringes', kitSize: 2 },
  { name: 'JUVEDERM Ultra 3', spec: '2x1ml prefilled syringes', kitSize: 2 },
  { name: 'JUVEDERM Ultra 4', spec: '2x1ml prefilled syringes', kitSize: 2 },
  { name: 'JUVEDERM Voluma', spec: '2x1ml prefilled syringes', kitSize: 2 },
  { name: 'Rejuran Essence', spec: '2x2ml prefilled syringes', kitSize: 2 },
  { name: 'Rejuran Healer', spec: '2x2ml prefilled syringes', kitSize: 2 },

  { name: 'Kiara Reju', spec: '2.2mlx3 prefilled syringes', kitSize: 3 },

  { name: 'NCTF135HA', spec: '3mlx5 vials', kitSize: 5 },
  { name: 'NCTF135HA Plus', spec: '3mlx5 vials', kitSize: 5 },
];
