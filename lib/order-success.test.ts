// Which orders the success screen names.
//
// Checkout splits a mixed cart into one order per mode, so the screen can be
// handed a primary invoice plus siblings. Getting this wrong means a customer
// who just paid for two orders is only told about one.
import { describe, it, expect } from 'vitest';
import { successOrderNos } from './order-success';

describe('successOrderNos', () => {
  it('returns just the primary order when nothing else was created', () => {
    expect(successOrderNos('BBG-2423', null)).toEqual(['BBG-2423']);
  });

  it('lists the primary order first, then its siblings', () => {
    expect(successOrderNos('BBG-2423', 'BBG-2424')).toEqual(['BBG-2423', 'BBG-2424']);
  });

  it('splits several siblings on commas', () => {
    expect(successOrderNos('BBG-1', 'BBG-2,BBG-3')).toEqual(['BBG-1', 'BBG-2', 'BBG-3']);
  });

  it('ignores an empty param rather than rendering a blank invoice line', () => {
    expect(successOrderNos('BBG-2423', '')).toEqual(['BBG-2423']);
  });

  it('drops blank entries from a trailing or doubled comma', () => {
    expect(successOrderNos('BBG-1', 'BBG-2,,')).toEqual(['BBG-1', 'BBG-2']);
  });

  it('trims whitespace a hand-edited URL may carry', () => {
    expect(successOrderNos('BBG-1', ' BBG-2 , BBG-3 ')).toEqual(['BBG-1', 'BBG-2', 'BBG-3']);
  });

  it('never repeats the primary order if it also appears in the siblings', () => {
    // A double-encoded redirect would otherwise show the same invoice twice.
    expect(successOrderNos('BBG-1', 'BBG-1,BBG-2')).toEqual(['BBG-1', 'BBG-2']);
  });

  it('reports a split only when there is genuinely more than one order', () => {
    expect(successOrderNos('BBG-1', null).length > 1).toBe(false);
    expect(successOrderNos('BBG-1', 'BBG-2').length > 1).toBe(true);
  });
});
