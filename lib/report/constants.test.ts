import { describe, it, expect } from 'vitest';
import { PACKERS, COURIERS, SHIPPING_OPTIONS, DEFAULT_COURIER } from './constants';

// The "Admin" handler column in the weekly report and the order editor's Admin
// dropdown both read PACKERS. The client asked for these three names.
describe('report handler names', () => {
  it('lists the three current order handlers', () => {
    expect(PACKERS).toEqual(['Cza', 'Ruth', 'Richme']);
  });
});

// Customers may only choose J&T or Lalamove at checkout.
describe('shipping options', () => {
  it('offers exactly J&T and Lalamove to customers', () => {
    expect(SHIPPING_OPTIONS).toEqual(['J&T', 'Lalamove']);
  });

  it('keeps both customer options available to the admin courier list', () => {
    expect(COURIERS).toContain('J&T');
    expect(COURIERS).toContain('Lalamove');
  });

  it('defaults to J&T', () => {
    expect(DEFAULT_COURIER).toBe('J&T');
  });
});
