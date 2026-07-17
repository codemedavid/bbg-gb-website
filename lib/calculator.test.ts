import { describe, it, expect } from 'vitest';
import { reconstitution } from './calculator';

describe('reconstitution', () => {
  it('computes units for Tirzepatide 15mg in 2ml at 2.5mg dose', () => {
    const r = reconstitution(15, 2, 2.5);
    expect(r.concentration).toBe(7.5);       // 15 / 2
    expect(r.units).toBeCloseTo(33.3, 1);    // (2.5 / 7.5) * 100
    expect(r.dosesPerVial).toBe(6);          // floor(15 / 2.5)
  });
  it('returns zeros when BAC water is 0', () => {
    expect(reconstitution(10, 0, 1)).toMatchObject({ concentration: 0, units: 0 });
  });
  it('computes BPC157 10mg in 3ml at 0.25mg', () => {
    const r = reconstitution(10, 3, 0.25);
    expect(r.concentration).toBeCloseTo(3.33, 2);
    expect(r.dosesPerVial).toBe(40);
  });
});
