// U-100 insulin syringe: 100 units = 1 ml. Mirrors server/src/lib/calculator.ts.
export function reconstitution(vialMg: number, bacMl: number, doseMg: number) {
  const concentration = bacMl > 0 ? vialMg / bacMl : 0;
  const units = concentration > 0 ? (doseMg / concentration) * 100 : 0;
  const dosesPerVial = doseMg > 0 && vialMg > 0 ? Math.floor(vialMg / doseMg) : 0;
  return {
    concentration: Math.round(concentration * 100) / 100,
    units: Math.round(units * 10) / 10,
    dosesPerVial,
  };
}
