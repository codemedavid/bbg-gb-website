import { describe, expect, it } from 'vitest';
import { reportProductCode } from './product-codes';

describe('reportProductCode', () => {
  it('uses the supplied Cat. No. instead of an older stored code', () => {
    expect(reportProductCode('Retatrutide', '10mg vial', 'BBG1000-R10')).toBe('RT10');
    expect(reportProductCode('Retatrutide (Salt Form)', '10mg vial', 'RT10')).toBe('SALT-RETA10');
    expect(reportProductCode('Tirzepatide', '15mg vial', 'BBG1000-15')).toBe('TR15');
  });

  it('fills codes that were previously blank', () => {
    expect(reportProductCode('BAC Water', '3ml', null)).toBe('BA03');
    expect(reportProductCode('SLU-PP', '5mg vial', null)).toBe('322');
    expect(reportProductCode('Pinealon', '20mg vial', null)).toBe('PIN20');
  });

  it('keeps a stored code when the supplied list has no replacement', () => {
    expect(reportProductCode('Custom Product', '5mg', 'CUSTOM-5')).toBe('CUSTOM-5');
  });

  it('leaves genuinely uncoded free-text products blank', () => {
    expect(reportProductCode('Custom Product', '5mg', null)).toBeNull();
  });
});
