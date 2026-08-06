// Canonical seed catalog for BBG Peptides.
// Sourced from the imported design (BBG Peptides App.html) + bbg Price list.xlsx
// (Pricelist, On Hand, and MOQ sheets).
//
// `pricePhp` is PER KIT, not per vial. The workbook heads that money column
// "PER KIT (10 VIALS) PRICE" and scripts/extract-pricelist.py copies the figure
// through verbatim. Anything deriving a vial price divides by the kit size; do
// not multiply this figure by ten (see shopKitPrice in lib/campaign-seed.ts).

export type SeedCategory = { name: string; slug: string; sortOrder: number };

export const CATEGORIES: SeedCategory[] = [
  { name: 'GLP-1', slug: 'glp-1', sortOrder: 1 },
  { name: 'Blends', slug: 'blends', sortOrder: 2 },
  { name: 'Recovery', slug: 'recovery', sortOrder: 3 },
  { name: 'Skin', slug: 'skin', sortOrder: 4 },
  { name: 'Wellness', slug: 'wellness', sortOrder: 5 },
  { name: 'BAC', slug: 'bac', sortOrder: 6 },
  { name: 'Aesthetics', slug: 'aesthetics', sortOrder: 7 },
];

export const CATEGORY_DESC: Record<string, string> = {
  'glp-1': 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.',
  blends: 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.',
  recovery: 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.',
  skin: 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.',
  wellness: 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.',
  bac: 'Bacteriostatic water (0.9% benzyl alcohol) for reconstituting lyophilized peptides.',
  aesthetics: 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.',
};

export type SeedProduct = {
  code: string | null;              // null for items with no CAT/Code (e.g. branded fillers)
  name: string;
  spec: string;
  cat: string;             // category slug
  pricePhp: number;
  priceUsd?: number | null;         // null/omitted for PHP-only items (e.g. aesthetics)
  arrival: 'white_powder' | 'salt_liquid';
  emoji?: string;
  isOnHand?: boolean;
  onHandKitPhp?: number;
  onHandPiecePhp?: number;
  stock?: number;
  soldCount?: number;
  // Units in a supplier pack, when it is not the ten-vial peptide kit. This is
  // the divisor behind the weekly report's Kits column, so a differently-packed
  // line has to state it or the batch order is placed at the wrong multiple.
  kitSize?: number;
  // Overrides the category blurb. For a series whose products differ only in
  // what they treat, the category text cannot tell them apart.
  description?: string;
  // Product-level group buy terms. `isGroupBuy` is the switch both bulk seeders
  // select on (kahati-seed-bulk, campaign-seed-bulk); the rest are the figures
  // a new hatian counter or campaign batch starts from. Counted in UNITS of the
  // product's own pack — pairs for the Skin Repair series, vials for peptides.
  isGroupBuy?: boolean;
  gbPricePerKitPhp?: number;
  gbPricePerPiecePhp?: number;
  gbVialsPerKit?: number;
  gbMinVials?: number;
  gbMaxVialsPerBatch?: number;
};

// arrival: salt forms, Bioglutide, TR+CGL / TR+RT blends, colored peptides and all
// liquid blends (incl. NAD+) arrive 3-5 days later => 'salt_liquid'. Others white_powder.
export const PRODUCTS: SeedProduct[] = [
  // ---- GLP-1 ----
  { code: 'BBG1000-15', name: 'Tirzepatide', spec: '15mg vial', cat: 'glp-1', pricePhp: 3200, priceUsd: 51.2, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 5000, onHandPiecePhp: 550, stock: 120, soldCount: 340 },
  { code: 'BBG1000-30', name: 'Tirzepatide', spec: '30mg vial', cat: 'glp-1', pricePhp: 4850, priceUsd: 77.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 6500, onHandPiecePhp: 700, stock: 90, soldCount: 280 },
  { code: 'BBG1000-40', name: 'Tirzepatide', spec: '40mg vial', cat: 'glp-1', pricePhp: 6250, priceUsd: 100, arrival: 'white_powder', stock: 60, soldCount: 150 },
  { code: 'BBG1000-60', name: 'Tirzepatide', spec: '60mg vial', cat: 'glp-1', pricePhp: 10625, priceUsd: 170, arrival: 'white_powder', stock: 40, soldCount: 95 },
  { code: 'BBG1000-100', name: 'Tirzepatide', spec: '100mg vial', cat: 'glp-1', pricePhp: 13437.5, priceUsd: 215, arrival: 'white_powder', stock: 25 },
  { code: 'TR30', name: 'Tirzepatide (Salt Form)', spec: '30mg vial', cat: 'glp-1', pricePhp: 6375, priceUsd: 102, arrival: 'salt_liquid', stock: 30, soldCount: 60 },
  // The workbook lists the Retatrutide line under Tirzepatide's codes
  // (BBG1000-10/-15/-30 appear twice, at two different prices). The catalog
  // mints BBG1000-R** for Retatrutide so the two lines cannot collide.
  { code: 'BBG1000-R10', name: 'Retatrutide', spec: '10mg vial', cat: 'glp-1', pricePhp: 4375, priceUsd: 70, arrival: 'white_powder', stock: 80, soldCount: 210 },
  { code: 'BBG1000-R15', name: 'Retatrutide', spec: '15mg vial', cat: 'glp-1', pricePhp: 5625, priceUsd: 90, arrival: 'white_powder', stock: 70, soldCount: 175 },
  { code: 'BBG1000-R20', name: 'Retatrutide', spec: '20mg vial', cat: 'glp-1', pricePhp: 6875, priceUsd: 110, arrival: 'white_powder', stock: 55, soldCount: 130 },
  { code: 'BBG1000-R30', name: 'Retatrutide', spec: '30mg vial', cat: 'glp-1', pricePhp: 9062.5, priceUsd: 145, arrival: 'white_powder', stock: 35 },
  { code: 'RT10', name: 'Retatrutide (Salt Form)', spec: '10mg vial', cat: 'glp-1', pricePhp: 4687.5, priceUsd: 75, arrival: 'salt_liquid', isOnHand: true, onHandKitPhp: 6300, onHandPiecePhp: 650, stock: 25, soldCount: 40 },
  { code: 'RT15', name: 'Retatrutide (Salt Form)', spec: '15mg vial', cat: 'glp-1', pricePhp: 5937.5, priceUsd: 95, arrival: 'salt_liquid', stock: 22 },
  { code: 'RT20', name: 'Retatrutide (Salt Form)', spec: '20mg vial', cat: 'glp-1', pricePhp: 7500, priceUsd: 120, arrival: 'salt_liquid', stock: 20 },
  { code: 'CGL5', name: 'Cagrilintide', spec: '5mg vial', cat: 'glp-1', pricePhp: 4050, priceUsd: 64.8, arrival: 'white_powder', stock: 45, soldCount: 88 },
  { code: 'CGL10', name: 'Cagrilintide', spec: '10mg vial', cat: 'glp-1', pricePhp: 7050, priceUsd: 112.8, arrival: 'white_powder', stock: 35, soldCount: 52 },
  { code: 'BBG-5AD', name: 'AOD9604 Pro Max', spec: '5mg vial', cat: 'glp-1', pricePhp: 5350, priceUsd: 85.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 7200, onHandPiecePhp: 750, stock: 30, soldCount: 70 },
  { code: 'TS5', name: 'Tesamorelin', spec: '5mg vial', cat: 'glp-1', pricePhp: 4875, priceUsd: 78, arrival: 'white_powder', stock: 40, soldCount: 65 },
  { code: 'TS10', name: 'Tesamorelin', spec: '10mg vial', cat: 'glp-1', pricePhp: 10312.5, priceUsd: 165, arrival: 'white_powder', stock: 20 },
  // ---- Blends (liquid, ready-to-use) ----
  { code: 'LC500', name: 'L-Carnitine', spec: '400mg', cat: 'blends', pricePhp: 3437.5, priceUsd: 55, arrival: 'salt_liquid', emoji: '🧴', stock: 40 },
  { code: 'LC600', name: 'L-Carnitine', spec: '600mg', cat: 'blends', pricePhp: 3750, priceUsd: 60, arrival: 'salt_liquid', emoji: '🧴', stock: 50, soldCount: 120 },
  { code: 'LC1200', name: 'L-Carnitine', spec: '1200mg', cat: 'blends', pricePhp: 4200, priceUsd: 67.2, arrival: 'salt_liquid', emoji: '🧴', stock: 45, soldCount: 98 },
  { code: 'LC120', name: 'Lipo C', spec: '10ml vial', cat: 'blends', pricePhp: 3750, priceUsd: 60, arrival: 'salt_liquid', emoji: '🧴', stock: 40, soldCount: 160 },
  { code: 'LC216', name: 'Lipo C with B12', spec: '10ml vial', cat: 'blends', pricePhp: 4375, priceUsd: 70, arrival: 'salt_liquid', emoji: '🧴', stock: 38, soldCount: 140 },
  { code: 'LC425', name: 'Lipo-C (Focus)', spec: '10ml vial', cat: 'blends', pricePhp: 4500, priceUsd: 72, arrival: 'salt_liquid', emoji: '🧴', stock: 30 },
  { code: 'LC526', name: 'Fat Blaster', spec: '10ml vial', cat: 'blends', pricePhp: 5937.5, priceUsd: 95, arrival: 'salt_liquid', emoji: '🧴', stock: 30, soldCount: 110 },
  { code: 'LC553', name: 'Supershred', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 32, soldCount: 90 },
  { code: 'SHB', name: 'Super Human Blend', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 28, soldCount: 76 },
  { code: 'HHB', name: 'Hair Skin & Nails', spec: '10ml vial', cat: 'blends', pricePhp: 4562.5, priceUsd: 73, arrival: 'salt_liquid', emoji: '🧴', stock: 26, soldCount: 64 },
  // Fat-contouring lipolysis solution. The workbook prices this one per kit
  // ("10 vials" in its notes column), not per vial like its neighbours — the
  // spec says so rather than silently dividing by ten.
  { code: null, name: 'Lemon Bottle (China)', spec: '50ml x 10 vials', cat: 'blends', pricePhp: 9500, priceUsd: 152, arrival: 'salt_liquid', emoji: '🧴', stock: 15 },
  // ---- Recovery ----
  { code: 'BPC157', name: 'BPC157', spec: '10mg vial', cat: 'recovery', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 70, soldCount: 300 },
  { code: 'TB500', name: 'TB500', spec: '10mg vial', cat: 'recovery', pricePhp: 7500, priceUsd: 120, arrival: 'white_powder', stock: 40, soldCount: 130 },
  { code: 'WOLV', name: 'Wolverine (TB500+BPC)', spec: '10mg vial', cat: 'recovery', pricePhp: 6300, arrival: 'white_powder', stock: 35, soldCount: 145 },
  { code: 'MS10', name: 'MOTS-C', spec: '10mg vial', cat: 'recovery', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 45, soldCount: 88 },
  { code: 'MS40', name: 'MOTS-C', spec: '40mg vial', cat: 'recovery', pricePhp: 11562.5, priceUsd: 185, arrival: 'white_powder', stock: 18 },
  { code: '2S10', name: 'SS31', spec: '10mg vial', cat: 'recovery', pricePhp: 4250, priceUsd: 68, arrival: 'white_powder', stock: 30, soldCount: 54 },
  { code: 'TA1', name: 'Thymosin Alpha 1', spec: '5mg vial', cat: 'recovery', pricePhp: 4475, priceUsd: 71.6, arrival: 'white_powder', stock: 28, soldCount: 47 },
  { code: 'TA1-10', name: 'Thymosin Alpha 1', spec: '10mg vial', cat: 'recovery', pricePhp: 8187.5, priceUsd: 131, arrival: 'white_powder', stock: 18 },
  { code: 'CJC-IPA', name: 'CJC w/o DAC + Ipamorelin', spec: '10mg vial', cat: 'recovery', pricePhp: 5812.5, priceUsd: 93, arrival: 'white_powder', stock: 25, soldCount: 60 },
  // ---- Skin ----
  { code: 'CU50', name: 'GHK-Cu', spec: '50mg vial', cat: 'skin', pricePhp: 2200, priceUsd: 35.2, arrival: 'white_powder', stock: 60, soldCount: 190 },
  { code: 'CU100', name: 'GHK-Cu', spec: '100mg vial', cat: 'skin', pricePhp: 2800, priceUsd: 44.8, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 4200, onHandPiecePhp: 450, stock: 50, soldCount: 160 },
  { code: 'KPV10', name: 'KPV', spec: '10mg vial', cat: 'skin', pricePhp: 3300, priceUsd: 52.8, arrival: 'white_powder', stock: 40, soldCount: 84 },
  { code: 'CUV60', name: 'GHK-Cu + KPV', spec: '60mg vial', cat: 'skin', pricePhp: 4100, priceUsd: 65.6, arrival: 'white_powder', isOnHand: true, onHandKitPhp: 6200, onHandPiecePhp: 650, stock: 30, soldCount: 72 },
  // Pharmagrade injectable; the workbook leaves its CAT/Code column blank.
  { code: null, name: 'AHK-Cu', spec: '100mg vial', cat: 'skin', pricePhp: 3625, priceUsd: 58, arrival: 'white_powder', stock: 25 },
  { code: 'KLOW', name: 'KLOW', spec: '80mg vial', cat: 'skin', pricePhp: 10625, priceUsd: 170, arrival: 'white_powder', stock: 20, soldCount: 44 },
  { code: 'CU-TOP', name: 'GHK-Cu Topical', spec: '1000mg', cat: 'skin', pricePhp: 4350, priceUsd: 69.6, arrival: 'salt_liquid', emoji: '🧴', stock: 25, soldCount: 58 },
  // ---- Skin Repair (SM) series ----
  // Six colour-coded hero peptides from the BBG price-list card. Each unit is a
  // 1g powder vial paired with its own 5mL solvent, and the pack is five of
  // those pairs at ₱1,975.00 — ₱395.00 a pair. `kitSize: 5` because the pack is
  // counted in pairs, not in the ten vials a peptide kit holds; the report's
  // Kits column divides by it. PHP only, as the card quotes no USD.
  { code: 'SM1', name: 'Skin Repair SM1 — Green', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '🟢', description: 'Whitens skin, fades dark spots, treats acne and reduces acne marks. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  { code: 'SM2', name: 'Skin Repair SM2 — Brown', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '🟤', description: 'Antibacterial and anti-inflammatory — repairs skin and provides deep hydration. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  { code: 'SM3', name: 'Skin Repair SM3 — Pink', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '🩷', description: 'Regulates oil production and supports anti-aging. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  { code: 'SM4', name: 'Skin Repair SM4 — Black', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '⚫', description: 'Deep cleansing — removes blackheads and purges impurities. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  { code: 'SM5', name: 'Skin Repair SM5 — Purple', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '🟣', description: 'Whitens skin, reduces wrinkles, restores elasticity and enhances radiance. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  { code: 'SM6', name: 'Skin Repair SM6 — Blue', spec: '1g + 5mL · 5 pairs', cat: 'skin', pricePhp: 1975, priceUsd: null, arrival: 'white_powder', kitSize: 5, isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395, gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5, emoji: '🔵', description: 'Treats mild hormonal skin issues and replenishes vitamins and proteins. 1g lyophilized powder paired with 5mL solvent; for research use only.' },
  // ---- Wellness ----
  { code: 'NJ100', name: 'NAD+', spec: '100mg vial', cat: 'wellness', pricePhp: 2500, priceUsd: 40, arrival: 'salt_liquid', stock: 40, soldCount: 96 },
  { code: 'NJ500', name: 'NAD+', spec: '500mg vial', cat: 'wellness', pricePhp: 2625, priceUsd: 42, arrival: 'salt_liquid', stock: 38, soldCount: 82 },
  { code: 'NJ1000', name: 'NAD+', spec: '1000mg vial', cat: 'wellness', pricePhp: 4500, priceUsd: 72, arrival: 'salt_liquid', stock: 30 },
  { code: 'XA10', name: 'Semax', spec: '10mg vial', cat: 'wellness', pricePhp: 3100, priceUsd: 49.6, arrival: 'white_powder', stock: 35, soldCount: 70 },
  { code: 'SK10', name: 'Selank', spec: '10mg vial', cat: 'wellness', pricePhp: 3100, priceUsd: 49.6, arrival: 'white_powder', stock: 34, soldCount: 66 },
  { code: 'EPI10', name: 'Epithalon', spec: '10mg vial', cat: 'wellness', pricePhp: 2812.5, priceUsd: 45, arrival: 'white_powder', stock: 30, soldCount: 58 },
  { code: 'OXY5', name: 'Oxytocin', spec: '5mg vial', cat: 'wellness', pricePhp: 2000, priceUsd: 32, arrival: 'white_powder', stock: 28, soldCount: 40 },
  { code: 'OXY10', name: 'Oxytocin', spec: '10mg vial', cat: 'wellness', pricePhp: 2937.5, priceUsd: 47, arrival: 'white_powder', stock: 24 },
  { code: 'DSIP5', name: 'DSIP', spec: '5mg vial', cat: 'wellness', pricePhp: 2625, priceUsd: 42, arrival: 'white_powder', stock: 26, soldCount: 36 },
  { code: 'DSIP10', name: 'DSIP', spec: '10mg vial', cat: 'wellness', pricePhp: 4312.5, priceUsd: 69, arrival: 'white_powder', stock: 22 },
  { code: 'GLU600', name: 'Glutathione', spec: '600mg vial', cat: 'wellness', pricePhp: 3125, priceUsd: 50, arrival: 'white_powder', stock: 30, soldCount: 62 },
  { code: 'PT141', name: 'PT141', spec: '10mg vial', cat: 'wellness', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 32, soldCount: 78 },
  { code: 'LL37', name: 'LL-37', spec: '5mg vial', cat: 'wellness', pricePhp: 5000, priceUsd: 80, arrival: 'white_powder', stock: 22, soldCount: 34 },
  { code: '5AM10', name: '5-Amino-1MQ', spec: '10mg vial', cat: 'wellness', pricePhp: 3125, priceUsd: 50, arrival: 'white_powder', stock: 30 },
  { code: '5AM50', name: '5-Amino-1MQ', spec: '50mg vial', cat: 'wellness', pricePhp: 4062.5, priceUsd: 65, arrival: 'white_powder', stock: 24 },
  { code: 'AR50', name: 'AICAR', spec: '50mg vial', cat: 'wellness', pricePhp: 3125, priceUsd: 50, arrival: 'white_powder', stock: 26 },
  // The workbook's CAT/Code cell for SLU-PP holds "322.0", which the extractor
  // flags as malformed (data/pricelist.json warnings). Left blank rather than
  // shipping a number that is not a code.
  { code: null, name: 'SLU-PP', spec: '5mg vial', cat: 'wellness', pricePhp: 5000, priceUsd: 80, arrival: 'white_powder', stock: 20 },
  { code: null, name: 'Pinealon', spec: '10mg vial', cat: 'wellness', pricePhp: 3750, priceUsd: 60, arrival: 'white_powder', stock: 24 },
  { code: null, name: 'Pinealon', spec: '20mg vial', cat: 'wellness', pricePhp: 6750, priceUsd: 108, arrival: 'white_powder', stock: 18 },
  // ---- BAC water ----
  { code: 'BBG0000-3ML', name: 'BAC Water', spec: '3ml', cat: 'bac', pricePhp: 475, priceUsd: 7.6, arrival: 'white_powder', emoji: '💦', isOnHand: true, onHandKitPhp: 500, onHandPiecePhp: 55, stock: 200, soldCount: 520 },
  { code: 'BBG0000-5ML', name: 'BAC Water', spec: '5ml', cat: 'bac', pricePhp: 625, priceUsd: 10, arrival: 'white_powder', emoji: '💦', isOnHand: true, onHandKitPhp: 730, onHandPiecePhp: 75, stock: 180, soldCount: 410 },
  { code: 'BBG0000-10ML', name: 'BAC Water', spec: '10ml', cat: 'bac', pricePhp: 875, priceUsd: 14, arrival: 'white_powder', emoji: '💦', stock: 160, soldCount: 360 },
  // ---- Aesthetics (injectables: skin boosters, dermal fillers, toxins) ----
  // Imported from bbg Price list.xlsx (right-block, PHP-only). Ready-to-use
  // liquid => arrival 'salt_liquid'. No USD list price; no reconstitution.
  { code: null, name: 'Rejuran i', spec: '1 prefilled syringe, 1ml', cat: 'aesthetics', pricePhp: 2300, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rejuran s', spec: '1 prefilled syringe, 1ml', cat: 'aesthetics', pricePhp: 2300, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rejuran hb', spec: '1 prefilled syringe, 1ml', cat: 'aesthetics', pricePhp: 2300, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rejuran Healer', spec: '2x2ml prefilled syringes', cat: 'aesthetics', pricePhp: 3450, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rejuran Essence', spec: '2x2ml prefilled syringes', cat: 'aesthetics', pricePhp: 3450, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rejuran Trueskin', spec: 'per piece', cat: 'aesthetics', pricePhp: 3450, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Profhilo', spec: '1x2ml', cat: 'aesthetics', pricePhp: 2300, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Hyaron Skin Booster', spec: '2.5mlx10 prefilled syringes', cat: 'aesthetics', pricePhp: 3250, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'NCTF135HA', spec: '3mlx5 vials', cat: 'aesthetics', pricePhp: 1375, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'NCTF135HA Plus', spec: '3mlx5 vials', cat: 'aesthetics', pricePhp: 1490, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Mesoestetic Mesohyal Organic Silicon', spec: 'per piece', cat: 'aesthetics', pricePhp: 3970, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Kiara Reju', spec: '2.2mlx3 prefilled syringes', cat: 'aesthetics', pricePhp: 2500, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Restylane Skin Booster', spec: '1x1ml prefilled syringe', cat: 'aesthetics', pricePhp: 1400, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'JUVEDERM Ultra 2', spec: '2x1ml prefilled syringes', cat: 'aesthetics', pricePhp: 3970, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'JUVEDERM Ultra 3', spec: '2x1ml prefilled syringes', cat: 'aesthetics', pricePhp: 3970, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'JUVEDERM Ultra 4', spec: '2x1ml prefilled syringes', cat: 'aesthetics', pricePhp: 3970, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'JUVEDERM Voluma', spec: '2x1ml prefilled syringes', cat: 'aesthetics', pricePhp: 3970, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'YSG01', name: 'Periocular Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 3437.5, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'ZSG02', name: 'Recombinant Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 3000, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'FSG03', name: 'Composite Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 2812.5, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'SSG04', name: 'Salmon Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 2500, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'WSG05', name: 'Vitamin C Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 3125, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'MSG06', name: 'Whitening Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 3000, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: 'QSG07', name: 'Blue Peptide', spec: '5ml', cat: 'aesthetics', pricePhp: 4062.5, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Nabota', spec: 'per piece', cat: 'aesthetics', pricePhp: 1200, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Rentox', spec: 'per piece', cat: 'aesthetics', pricePhp: 1200, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Botox Gas', spec: 'per piece', cat: 'aesthetics', pricePhp: 1400, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
  { code: null, name: 'Xeomin', spec: '100U', cat: 'aesthetics', pricePhp: 1400, priceUsd: null, arrival: 'salt_liquid', emoji: '💉' },
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

// Each hatian counter is one kit — 10 vials. It locks at 10 and auto-opens a
// fresh sibling; if the deadline passes short of 10 it is cancelled.
export const GROUP_BUYS: SeedGroupBuy[] = [
  { name: 'Tirzepatide + CGL 35mg', pricePerKitPhp: 9000, totalSlots: 10, claimedSlots: 7, minVials: 1, arrival: 'salt_liquid', closesInDays: 2, description: 'Hatian — 1 kit = 10 vials. TR+CGL blend arrives 3–5 days after white powders.' },
  { name: 'Bioglutide', pricePerKitPhp: 10400, totalSlots: 10, claimedSlots: 5, minVials: 1, arrival: 'salt_liquid', closesInDays: 4, description: 'Hatian — 1 kit = 10 vials. Bioglutide arrives 3–5 days after white powders.' },
  { name: 'Retatrutide 20mg', pricePerKitPhp: 6875, totalSlots: 10, claimedSlots: 9, minVials: 1, arrival: 'white_powder', closesInDays: 1, description: 'Hatian — 1 kit = 10 vials. White powder, ships first.' },
  { name: 'Tirzepatide 60mg', pricePerKitPhp: 10625, totalSlots: 10, claimedSlots: 3, minVials: 1, arrival: 'white_powder', closesInDays: 6, description: 'Hatian — 1 kit = 10 vials. White powder, ships first.' },
  { name: 'KLOW 80mg', pricePerKitPhp: 10625, totalSlots: 10, claimedSlots: 2, minVials: 1, arrival: 'white_powder', closesInDays: 7, description: 'Hatian — 1 kit = 10 vials. White powder, ships first.' },
];

// ---------------------------------------------------------------------------
// MOQ shelf seed.
//
// The three products the client named for the MOQ page. Prices and stock are
// deliberately placeholders (0) rather than guesses: the two blends are not
// priced as blends anywhere in data/pricelist.json, and shipping an invented
// price as if it were real is worse than shipping an obvious blank. The admin
// sets the real figures in /admin/moq-products before switching the page on.
// ---------------------------------------------------------------------------
export type SeedMoqProduct = {
  name: string;
  spec: string;
  arrival: 'white_powder' | 'salt_liquid';
  imageEmoji: string;
  sortOrder: number;
  description: string;
};

export const MOQ_PRODUCTS: SeedMoqProduct[] = [
  {
    name: 'FUAN GTT1500', spec: 'GTT1500', arrival: 'white_powder',
    imageEmoji: '🧪', sortOrder: 1,
    description: 'Bulk MOQ item. Set the price, stock and minimum order quantity in the admin panel.',
  },
  {
    // Blends arrive 3–5 days after white powders — see the arrival notes on the
    // Kahati board, which already calls out TR+CGL and TR+RT specifically.
    name: 'TR30 + CGL5 Blends', spec: 'TR30 + CGL5', arrival: 'salt_liquid',
    imageEmoji: '💧', sortOrder: 2,
    description: 'Tirzepatide 30mg + Cagrilintide 5mg blend. Salt/liquid — arrives 3–5 days after white powders.',
  },
  {
    name: 'TR20 + RT20 Blends', spec: 'TR20 + RT20', arrival: 'salt_liquid',
    imageEmoji: '💧', sortOrder: 3,
    description: 'Tirzepatide 20mg + Retatrutide 20mg blend. Salt/liquid — arrives 3–5 days after white powders.',
  },
];
