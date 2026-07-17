// Canonical seed catalog for BBG Peptides.
// Sourced from the imported design (BBG Peptides App.html) + bbg Price list.xlsx
// (Pricelist, On Hand, and MOQ sheets). PHP prices are per-vial unless noted.

export type SeedCategory = { name: string; slug: string; sortOrder: number };

export const CATEGORIES: SeedCategory[] = [
  { name: 'GLP-1', slug: 'glp-1', sortOrder: 1 },
  { name: 'Blends', slug: 'blends', sortOrder: 2 },
  { name: 'Recovery', slug: 'recovery', sortOrder: 3 },
  { name: 'Skin', slug: 'skin', sortOrder: 4 },
  { name: 'Wellness', slug: 'wellness', sortOrder: 5 },
  { name: 'BAC', slug: 'bac', sortOrder: 6 },
];

export const CATEGORY_DESC: Record<string, string> = {
  'glp-1': 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.',
  blends: 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.',
  recovery: 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.',
  skin: 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.',
  wellness: 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.',
  bac: 'Bacteriostatic water (0.9% benzyl alcohol) for reconstituting lyophilized peptides.',
};

export type SeedProduct = {
  code: string;
  name: string;
  spec: string;
  cat: string;             // category slug
  pricePhp: number;
  priceUsd?: number;
  arrival: 'white_powder' | 'salt_liquid';
  emoji?: string;
  isOnHand?: boolean;
  onHandKitPhp?: number;
  onHandPiecePhp?: number;
  stock?: number;
  soldCount?: number;
};

// arrival: salt forms, Bioglutide, TR+CGL / TR+RT blends, colored peptides and all
// liquid blends (incl. NAD+) arrive 3-5 days later => 'salt_liquid'. Others white_powder.
export const PRODUCTS: SeedProduct[] = [
  // ---- GLP-1 ----
  { code: 'BBG1000-15', name: 'Tirzepatide', spec: '15mg vial', cat: 'glp-1', pricePhp: 3200, priceUsd: 51.2, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 5000, onHandPiecePhp: 550, stock: 120, soldCount: 340 },
  { code: 'BBG1000-30', name: 'Tirzepatide', spec: '30mg vial', cat: 'glp-1', pricePhp: 4850, priceUsd: 77.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 6500, onHandPiecePhp: 700, stock: 90, soldCount: 280 },
  { code: 'BBG1000-40', name: 'Tirzepatide', spec: '40mg vial', cat: 'glp-1', pricePhp: 6250, priceUsd: 100, arrival: 'white_powder', stock: 60, soldCount: 150 },
  { code: 'BBG1000-60', name: 'Tirzepatide', spec: '60mg vial', cat: 'glp-1', pricePhp: 10625, priceUsd: 170, arrival: 'white_powder', stock: 40, soldCount: 95 },
  { code: 'TR30', name: 'Tirzepatide (Salt Form)', spec: '30mg vial', cat: 'glp-1', pricePhp: 6375, priceUsd: 102, arrival: 'salt_liquid', stock: 30, soldCount: 60 },
  { code: 'BBG1000-R10', name: 'Retatrutide', spec: '10mg vial', cat: 'glp-1', pricePhp: 4375, priceUsd: 70, arrival: 'white_powder', stock: 80, soldCount: 210 },
  { code: 'BBG1000-R15', name: 'Retatrutide', spec: '15mg vial', cat: 'glp-1', pricePhp: 5625, priceUsd: 90, arrival: 'white_powder', stock: 70, soldCount: 175 },
  { code: 'BBG1000-R20', name: 'Retatrutide', spec: '20mg vial', cat: 'glp-1', pricePhp: 6875, priceUsd: 110, arrival: 'white_powder', stock: 55, soldCount: 130 },
  { code: 'RT10', name: 'Retatrutide (Salt Form)', spec: '10mg vial', cat: 'glp-1', pricePhp: 4687.5, priceUsd: 75, arrival: 'salt_liquid', isOnHand: true, onHandKitPhp: 6300, onHandPiecePhp: 650, stock: 25, soldCount: 40 },
  { code: 'CGL5', name: 'Cagrilintide', spec: '5mg vial', cat: 'glp-1', pricePhp: 4050, priceUsd: 64.8, arrival: 'white_powder', stock: 45, soldCount: 88 },
  { code: 'CGL10', name: 'Cagrilintide', spec: '10mg vial', cat: 'glp-1', pricePhp: 7050, priceUsd: 112.8, arrival: 'white_powder', stock: 35, soldCount: 52 },
  { code: 'BBG-5AD', name: 'AOD9604 Pro Max', spec: '5mg vial', cat: 'glp-1', pricePhp: 5350, priceUsd: 85.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 7200, onHandPiecePhp: 750, stock: 30, soldCount: 70 },
  { code: 'TS5', name: 'Tesamorelin', spec: '5mg vial', cat: 'glp-1', pricePhp: 4875, priceUsd: 78, arrival: 'white_powder', stock: 40, soldCount: 65 },
  // ---- Blends (liquid, ready-to-use) ----
  { code: 'LC600', name: 'L-Carnitine', spec: '600mg', cat: 'blends', pricePhp: 3750, priceUsd: 60, arrival: 'salt_liquid', emoji: '🧴', stock: 50, soldCount: 120 },
  { code: 'LC1200', name: 'L-Carnitine', spec: '1200mg', cat: 'blends', pricePhp: 4200, priceUsd: 67.2, arrival: 'salt_liquid', emoji: '🧴', stock: 45, soldCount: 98 },
  { code: 'LC120', name: 'Lipo C', spec: '10ml vial', cat: 'blends', pricePhp: 3750, priceUsd: 60, arrival: 'salt_liquid', emoji: '🧴', stock: 40, soldCount: 160 },
  { code: 'LC216', name: 'Lipo C with B12', spec: '10ml vial', cat: 'blends', pricePhp: 4375, priceUsd: 70, arrival: 'salt_liquid', emoji: '🧴', stock: 38, soldCount: 140 },
  { code: 'LC526', name: 'Fat Blaster', spec: '10ml vial', cat: 'blends', pricePhp: 5937.5, priceUsd: 95, arrival: 'salt_liquid', emoji: '🧴', stock: 30, soldCount: 110 },
  { code: 'LC553', name: 'Supershred', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 32, soldCount: 90 },
  { code: 'SHB', name: 'Super Human Blend', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 28, soldCount: 76 },
  { code: 'HHB', name: 'Hair Skin & Nails', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 26, soldCount: 64 },
  // ---- Recovery ----
  { code: 'BPC157', name: 'BPC157', spec: '10mg vial', cat: 'recovery', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 70, soldCount: 300 },
  { code: 'TB500', name: 'TB500', spec: '10mg vial', cat: 'recovery', pricePhp: 7500, priceUsd: 120, arrival: 'white_powder', stock: 40, soldCount: 130 },
  { code: 'WOLV', name: 'Wolverine (TB500+BPC)', spec: '10mg vial', cat: 'recovery', pricePhp: 6300, arrival: 'white_powder', stock: 35, soldCount: 145 },
  { code: 'MS10', name: 'MOTS-C', spec: '10mg vial', cat: 'recovery', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 45, soldCount: 88 },
  { code: '2S10', name: 'SS31', spec: '10mg vial', cat: 'recovery', pricePhp: 4250, priceUsd: 68, arrival: 'white_powder', stock: 30, soldCount: 54 },
  { code: 'TA1', name: 'Thymosin Alpha 1', spec: '5mg vial', cat: 'recovery', pricePhp: 4475, priceUsd: 71.6, arrival: 'white_powder', stock: 28, soldCount: 47 },
  { code: 'CJC-IPA', name: 'CJC w/o DAC + Ipamorelin', spec: '10mg vial', cat: 'recovery', pricePhp: 5812.5, priceUsd: 93, arrival: 'white_powder', stock: 25, soldCount: 60 },
  // ---- Skin ----
  { code: 'CU50', name: 'GHK-Cu', spec: '50mg vial', cat: 'skin', pricePhp: 2200, priceUsd: 35.2, arrival: 'white_powder', stock: 60, soldCount: 190 },
  { code: 'CU100', name: 'GHK-Cu', spec: '100mg vial', cat: 'skin', pricePhp: 2800, priceUsd: 44.8, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 4200, onHandPiecePhp: 450, stock: 50, soldCount: 160 },
  { code: 'KPV10', name: 'KPV', spec: '10mg vial', cat: 'skin', pricePhp: 3300, priceUsd: 52.8, arrival: 'white_powder', stock: 40, soldCount: 84 },
  { code: 'CUV60', name: 'GHK-Cu + KPV', spec: '60mg vial', cat: 'skin', pricePhp: 4100, priceUsd: 65.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 6200, onHandPiecePhp: 650, stock: 30, soldCount: 72 },
  { code: 'KLOW', name: 'KLOW', spec: '80mg vial', cat: 'skin', pricePhp: 10625, priceUsd: 170, arrival: 'white_powder', stock: 20, soldCount: 44 },
  { code: 'CU-TOP', name: 'GHK-Cu Topical', spec: '1000mg', cat: 'skin', pricePhp: 4350, priceUsd: 69.6, arrival: 'salt_liquid', emoji: '🧴', stock: 25, soldCount: 58 },
  // ---- Wellness ----
  { code: 'NJ100', name: 'NAD+', spec: '100mg vial', cat: 'wellness', pricePhp: 2500, priceUsd: 40, arrival: 'salt_liquid', stock: 40, soldCount: 96 },
  { code: 'NJ500', name: 'NAD+', spec: '500mg vial', cat: 'wellness', pricePhp: 2625, priceUsd: 42, arrival: 'salt_liquid', stock: 38, soldCount: 82 },
  { code: 'XA10', name: 'Semax', spec: '10mg vial', cat: 'wellness', pricePhp: 3100, priceUsd: 49.6, arrival: 'white_powder', stock: 35, soldCount: 70 },
  { code: 'SK10', name: 'Selank', spec: '10mg vial', cat: 'wellness', pricePhp: 3100, priceUsd: 49.6, arrival: 'white_powder', stock: 34, soldCount: 66 },
  { code: 'EPI10', name: 'Epithalon', spec: '10mg vial', cat: 'wellness', pricePhp: 2812.5, priceUsd: 45, arrival: 'white_powder', stock: 30, soldCount: 58 },
  { code: 'OXY5', name: 'Oxytocin', spec: '5mg vial', cat: 'wellness', pricePhp: 2000, priceUsd: 32, arrival: 'white_powder', stock: 28, soldCount: 40 },
  { code: 'DSIP5', name: 'DSIP', spec: '5mg vial', cat: 'wellness', pricePhp: 2625, priceUsd: 42, arrival: 'white_powder', stock: 26, soldCount: 36 },
  { code: 'GLU600', name: 'Glutathione', spec: '600mg vial', cat: 'wellness', pricePhp: 3125, priceUsd: 50, arrival: 'white_powder', stock: 30, soldCount: 62 },
  { code: 'PT141', name: 'PT141', spec: '10mg vial', cat: 'wellness', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 32, soldCount: 78 },
  { code: 'LL37', name: 'LL-37', spec: '5mg vial', cat: 'wellness', pricePhp: 5000, priceUsd: 80, arrival: 'white_powder', stock: 22, soldCount: 34 },
  // ---- BAC water ----
  { code: 'BBG0000-3ML', name: 'BAC Water', spec: '3ml', cat: 'bac', pricePhp: 475, priceUsd: 7.6, arrival: 'white_powder', emoji: '💦', isOnHand: true, onHandKitPhp: 500, onHandPiecePhp: 55, stock: 200, soldCount: 520 },
  { code: 'BBG0000-5ML', name: 'BAC Water', spec: '5ml', cat: 'bac', pricePhp: 625, priceUsd: 10, arrival: 'white_powder', emoji: '💦', isOnHand: true, onHandKitPhp: 730, onHandPiecePhp: 75, stock: 180, soldCount: 410 },
  { code: 'BBG0000-10ML', name: 'BAC Water', spec: '10ml', cat: 'bac', pricePhp: 875, priceUsd: 14, arrival: 'white_powder', emoji: '💦', stock: 160, soldCount: 360 },
];

export type SeedGroupBuy = {
  name: string;
  pricePerKitPhp: number;
  totalSlots: number;
  claimedSlots: number;
  minVials: number;
  arrival: 'white_powder' | 'salt_liquid';
  closesInDays: number;
  description?: string;
};

export const GROUP_BUYS: SeedGroupBuy[] = [
  { name: 'Tirzepatide + CGL 35mg', pricePerKitPhp: 9000, totalSlots: 100, claimedSlots: 72, minVials: 7, arrival: 'salt_liquid', closesInDays: 2, description: 'MOQ kahati — 1 kit = 10 vials. TR+CGL blend arrives 3–5 days after white powders.' },
  { name: 'Bioglutide', pricePerKitPhp: 10400, totalSlots: 100, claimedSlots: 58, minVials: 7, arrival: 'salt_liquid', closesInDays: 4, description: 'MOQ kahati — 1 kit = 10 vials. Bioglutide arrives 3–5 days after white powders.' },
  { name: 'Retatrutide 20mg', pricePerKitPhp: 6875, totalSlots: 100, claimedSlots: 93, minVials: 7, arrival: 'white_powder', closesInDays: 1, description: 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.' },
  { name: 'Tirzepatide 60mg', pricePerKitPhp: 10625, totalSlots: 100, claimedSlots: 25, minVials: 7, arrival: 'white_powder', closesInDays: 6, description: 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.' },
  { name: 'KLOW 80mg', pricePerKitPhp: 10625, totalSlots: 100, claimedSlots: 14, minVials: 7, arrival: 'white_powder', closesInDays: 7, description: 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.' },
];
