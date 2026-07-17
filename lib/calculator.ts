// Peptide reconstitution math, shared shape with the client calculator.
// U-100 insulin syringe: 100 units = 1 ml.
export function reconstitution(vialMg: number, bacMl: number, doseMg: number) {
  const concentration = bacMl > 0 ? vialMg / bacMl : 0;        // mg per ml
  const units = concentration > 0 ? (doseMg / concentration) * 100 : 0;
  const dosesPerVial = doseMg > 0 && vialMg > 0 ? Math.floor(vialMg / doseMg) : 0;
  return {
    concentration: Math.round(concentration * 100) / 100,
    units: Math.round(units * 10) / 10,
    dosesPerVial,
  };
}
