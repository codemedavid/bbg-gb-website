// Cat. Nos. used in operational reports. Some catalog rows still carry codes
// from an older price list, so reporting resolves by product name + spec first
// and uses the stored catalog code only when this list has no match.
const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9+]/g, '');

const key = (name: string, spec: string): string => `${normalize(name)}|${normalize(spec)}`;

const REPORT_CODES = new Map<string, string>([
  [key('Tirzepatide', '15mg vial'), 'TR15'],
  [key('Tirzepatide', '30mg vial'), 'TR30'],
  [key('Tirzepatide', '40mg vial'), 'TR40'],
  [key('Tirzepatide', '60mg vial'), 'TR60'],
  [key('Tirzepatide', '100mg vial'), 'TR100'],
  [key('Tirzepatide (Salt Form)', '30mg vial'), 'SALT-TR30'],
  [key('Retatrutide', '10mg vial'), 'RT10'],
  [key('Retatrutide', '15mg vial'), 'RT15'],
  [key('Retatrutide', '20mg vial'), 'RT20'],
  [key('Retatrutide', '30mg vial'), 'RT30'],
  [key('Retatrutide (Salt Form)', '10mg vial'), 'SALT-RETA10'],
  [key('Retatrutide (Salt Form)', '15mg vial'), 'SALT-RETA15'],
  [key('Retatrutide (Salt Form)', '20mg vial'), 'SALT-RETA20'],
  [key('AOD9604 Pro Max', '5mg vial'), '5AD'],
  [key('Tesamorelin', '5mg vial'), 'TSM5'],
  [key('Tesamorelin', '10mg vial'), 'TSM10'],
  [key('L-Carnitine', '400mg'), 'LC400'],
  [key('Lemon Bottle (China)', '50ml x10 vials'), 'LB50'],
  [key('BPC157', '10mg vial'), 'BC10'],
  [key('Wolverine (TB500+BPC)', '10mg vial'), 'BB10'],
  [key('Thymosin Alpha 1', '5mg vial'), 'TA5'],
  [key('Thymosin Alpha 1', '10mg vial'), 'TA10'],
  [key('CJC w/o DAC + Ipamorelin', '10mg vial'), 'CP10'],
  [key('AHK-Cu', '100mg vial'), 'AU100'],
  [key('KLOW', '80mg vial'), 'Klow'],
  [key('GHK-Cu Topical', '1000mg'), 'TCU-W'],
  [key('Epithalon', '10mg vial'), 'ET10'],
  [key('Oxytocin', '5mg vial'), 'OT5'],
  [key('Oxytocin', '10mg vial'), 'OT10'],
  [key('DSIP', '5mg vial'), 'DS5'],
  [key('DSIP', '10mg vial'), 'DS10'],
  [key('Glutathione', '600mg vial'), 'GTT600'],
  [key('PT141', '10mg vial'), 'P41'],
  [key('LL-37', '5mg vial'), 'LL37-5'],
  [key('5-Amino-1MQ', '50mg vial'), '50AM'],
  [key('SLU-PP', '5mg vial'), '322'],
  [key('Pinealon', '10mg vial'), 'PIN10'],
  [key('Pinealon', '20mg vial'), 'PIN20'],
  [key('BAC Water', '3ml'), 'BA03'],
  [key('BAC Water', '5ml'), 'BA05'],
  [key('BAC Water', '10ml'), 'BA10'],
  [key('Rejuran i', '1 prefilled syringe, 1ml'), 'Rejuran I (White)'],
  [key('Rejuran s', '1 prefilled syringe, 1ml'), 'Rejuran Blue'],
  [key('Rejuran hb', '1 prefilled syringe, 1ml'), 'Rejuran HB (Red)'],
  [key('Rejuran Healer', '2x2ml prefilled syringes'), 'Rejuran Healer'],
  [key('Rejuran Essence', '2x2ml prefilled syringes'), 'Rejuran EE'],
  [key('Rejuran Trueskin', 'per piece'), 'Rejuran True'],
  [key('Profhilo', '1x2ml'), 'Profihlo'],
  [key('NCTF135HA', '3mlx5 vials'), 'FILLMED'],
  [key('Kiara Reju', '2.2mlx3 prefilled syringes'), 'Kiara'],
  [key('Rentox', 'per piece'), 'Rentox'],
  [key('Xeomin', '100U'), 'Xeomin'],
]);

export function reportProductCode(
  name: string | null | undefined,
  spec: string | null | undefined,
  storedCode: string | null | undefined,
): string | null {
  const reportCode = REPORT_CODES.get(key(name ?? '', spec ?? ''));
  if (reportCode) return reportCode;
  return storedCode?.trim() || null;
}
