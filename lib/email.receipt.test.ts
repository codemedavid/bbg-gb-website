import { describe, expect, it } from 'vitest';
import { orderPlacedEmail, orderUpdatedEmail } from './email';

describe('order receipt email', () => {
  it('includes an itemized receipt and totals', () => {
    const email = orderPlacedEmail({
      name: 'Ana', orderNo: 'BBG-2501', subtotal: 1000, packingFee: 150, total: 1150,
      items: [
        { name: 'Tirzepatide 15mg', qty: 2, unitPrice: 500, lineTotal: 1000 },
      ],
    });

    expect(email.html).toContain('Receipt');
    expect(email.html).toContain('Tirzepatide 15mg × 2');
    expect(email.html).toContain('₱1,000');
    expect(email.html).toContain('₱150');
    expect(email.html).toContain('₱1,150');
  });

  it('escapes item names before inserting them into HTML', () => {
    const email = orderPlacedEmail({
      name: 'Ana', orderNo: 'BBG-2502', total: 100,
      items: [{ name: '<script>alert(1)</script>', qty: 1, unitPrice: 100, lineTotal: 100 }],
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('produces a revised receipt after an admin changes an order', () => {
    const email = orderUpdatedEmail({
      name: 'Ana', orderNo: 'BBG-2503', subtotal: 800, packingFee: 150, total: 950,
      items: [{ name: 'Corrected item', qty: 2, unitPrice: 400, lineTotal: 800 }],
    });

    expect(email.subject).toContain('Updated receipt');
    expect(email.html).toContain('Corrected item × 2');
    expect(email.html).toContain('₱950');
  });
});
