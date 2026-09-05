// END-TO-END: Kahati → Pasalo quantity lifecycle.
//
// Drives the real checkout, the real admin controls and the real board reads.
// An HTTP 200 is never the assertion — every scenario checks the resulting
// business state in the database: the counter's vials, the order's lines, the
// payment status, and the derived qualify/slots figures a customer is shown.
//
// Business rules under test:
//   7 vials  = minimum to proceed
//   10 vials = full box, and the hard ceiling
//   needed_to_qualify = MAX(7 - combined, 0)
//   slots_remaining   = MAX(10 - combined, 0)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TestSession } from '@/lib/test/pasalo-e2e';

const session = { current: null as TestSession };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: CHECKOUT } = await import('@/app/api/orders/route');
const { POST: OPEN_PASALO } = await import('@/app/api/admin/groupbuys/pasalo/route');
const { POST: CLOSE_PASALO } = await import('@/app/api/admin/groupbuys/pasalo/close/route');
const { GET: PASALO_BOARD } = await import('./route');
const { PATCH: SET_ORDER_STATUS } = await import('@/app/api/admin/orders/[id]/status/route');
const { resetDb } = await import('@/lib/test/harness');
const {
  makeCustomer, makeKahatiProduct, checkoutForm, checkoutRequest, openStorefront,
  counterRow, orderRow, allOrders, allRefunds, paymentConfirmedVials,
} = await import('@/lib/test/pasalo-e2e');
const { counterQuantities } = await import('@/lib/kahati-quantity');

beforeEach(async () => {
  await resetDb();
  await openStorefront();
  session.current = null;
});

type Customer = { id: string; email: string; role: 'customer' | 'admin' };

const asUser = (u: Customer) => { session.current = { sub: u.id, role: u.role, email: u.email }; };

async function asAdmin() {
  const admin = await makeCustomer('e2e-admin');
  const { getDb, users } = await import('@/lib/db');
  const { eq } = await import('drizzle-orm');
  const db = await getDb();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  return admin;
}

/** One customer's commitment, through the real checkout. */
async function join(user: Customer, counterId: string, qty: number) {
  asUser(user);
  const res = await CHECKOUT(checkoutRequest(
    checkoutForm([{ kind: 'group_buy', refId: counterId, qty }]),
  ));
  const body = await res.json();
  return { status: res.status, body, orderId: body?.data?.order?.id as string | undefined };
}

/** An admin verifying the money actually arrived. */
async function confirmPayment(orderId: string) {
  const prior = session.current;
  await asAdmin();
  const res = await SET_ORDER_STATUS(
    new Request(`http://localhost/api/admin/orders/${orderId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'payment_confirmed' }),
    }),
    { params: Promise.resolve({ id: orderId }) },
  );
  session.current = prior;
  return res.status;
}

/** Fill a counter to `vials` using as many distinct customers as needed. */
async function fillCounter(counterId: string, vials: number, perCustomer = 1) {
  const orderIds: string[] = [];
  let placed = 0;
  let n = 0;
  while (placed < vials) {
    const qty = Math.min(perCustomer, vials - placed);
    const buyer = await makeCustomer(`e2e-buyer-${n++}`);
    const { status, orderId } = await join(buyer, counterId, qty);
    expect(status).toBe(201);
    if (orderId) { orderIds.push(orderId); await confirmPayment(orderId); }
    placed += qty;
  }
  return orderIds;
}

const openPasalo = async (closesAt?: string) => {
  await asAdmin();
  return OPEN_PASALO(new Request('http://localhost/api/admin/groupbuys/pasalo', {
    method: 'POST', body: JSON.stringify(closesAt ? { closesAt } : {}),
  }));
};

const closePasalo = async () => { await asAdmin(); return CLOSE_PASALO(); };

const qty = async (counterId: string) => counterQuantities(await counterRow(counterId));

// ---------------------------------------------------------------------------

describe('SCENARIO 1 — exactly 7 from Kahati', () => {
  it('qualifies at 7 with 3 slots still open, and never becomes refundable', async () => {
    const { counterId } = await makeKahatiProduct('S1');
    await fillCounter(counterId, 7);

    const before = await qty(counterId);
    expect(before.combinedVials).toBe(7);
    expect(before.neededToQualify).toBe(0);
    expect(before.slotsRemaining).toBe(3);
    expect(before.state).toBe('qualified');

    await openPasalo();
    const staged = await qty(counterId);
    // Kahati 7, Pasalo 0 — the split is frozen at the close.
    expect(staged.kahatiVials).toBe(7);
    expect(staged.pasaloVials).toBe(0);
    // Top-up is allowed and bounded by the box, not by the minimum.
    expect(staged.slotsRemaining).toBe(3);

    await closePasalo();

    expect((await counterRow(counterId)).status).toBe('closed');
    expect(await allRefunds()).toHaveLength(0);
  });
});

describe('SCENARIO 2 — Kahati reaches 10', () => {
  it('is FULL at 10 with no slots left', async () => {
    const { counterId } = await makeKahatiProduct('S2');
    await fillCounter(counterId, 10);

    const q = await qty(counterId);
    expect(q.combinedVials).toBe(10);
    expect(q.slotsRemaining).toBe(0);
    expect(q.state).toBe('full');
  });

  it('seals the filled counter at exactly 10 — the row never exceeds the box', async () => {
    const { counterId } = await makeKahatiProduct('S2b');
    await fillCounter(counterId, 10);

    const sealed = await counterRow(counterId);
    expect(sealed.claimedSlots).toBe(10);
    expect(sealed.status).toBe('closed');
  });

  it('DOCUMENTED KAHATI BEHAVIOUR: an 11th vial opens a successor rather than being refused', async () => {
    // This is the pre-existing hatian design, not a Pasalo change: filling a kit
    // seals the counter and auto-opens a sibling, and the next vial joins THAT.
    // The invariant that matters is per-counter — no row ever holds 11 — and it
    // is asserted below. Recorded explicitly so the behaviour is a decision on
    // the record rather than a surprise.
    const { counterId, productId } = await makeKahatiProduct('S2c');
    await fillCounter(counterId, 10);

    const { getDb, groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    const rows = await db.select().from(groupBuys).where(eq(groupBuys.productId, productId));

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.claimedSlots).toBeLessThanOrEqual(row.totalSlots);
    expect(rows.find((r) => r.id === counterId)!.claimedSlots).toBe(10);
    expect(rows.find((r) => r.id !== counterId)!.status).toBe('open');
  });

  it('refuses an 11th vial on a PASALO counter — the stage has no successor', async () => {
    const { counterId } = await makeKahatiProduct('S2d');
    await fillCounter(counterId, 9);
    await openPasalo();
    // 9 -> 10 fills it.
    const filler = await makeCustomer('e2e-fill');
    expect((await join(filler, counterId, 1)).status).toBe(201);
    expect((await counterRow(counterId)).claimedSlots).toBe(10);

    const late = await makeCustomer('e2e-late');
    const refused = await join(late, counterId, 1);

    expect(refused.status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(10);
  });
});

describe('SCENARIO 3 — Kahati 6 + Pasalo 1', () => {
  it('needs exactly 1 more to qualify, and qualifies when it arrives', async () => {
    const { counterId } = await makeKahatiProduct('S3');
    await fillCounter(counterId, 6);
    await openPasalo();

    const staged = await qty(counterId);
    expect(staged.neededToQualify).toBe(1);
    expect(staged.slotsRemaining).toBe(4);
    expect(staged.state).toBe('short');
    expect((await counterRow(counterId)).status).toBe('pasalo');

    const rescuer = await makeCustomer('e2e-rescuer');
    expect((await join(rescuer, counterId, 1)).status).toBe(201);

    const after = await qty(counterId);
    expect(after.kahatiVials).toBe(6);
    expect(after.pasaloVials).toBe(1);
    expect(after.combinedVials).toBe(7);
    expect(after.state).toBe('qualified');

    await closePasalo();
    expect((await counterRow(counterId)).status).toBe('closed');
    expect(await allRefunds()).toHaveLength(0);
  });
});

describe('SCENARIO 4 — Kahati 3 + Pasalo 4', () => {
  it('asks for 4 to qualify, not 7 to fill the box', async () => {
    const { counterId } = await makeKahatiProduct('S4');
    await fillCounter(counterId, 3);
    await openPasalo();

    const staged = await qty(counterId);
    // The defect this whole feature exists around: at 3/10 the batch needs FOUR
    // more vials to proceed and has SEVEN slots to sell. Saying "7 more needed"
    // describes it as unreachable.
    expect(staged.neededToQualify).toBe(4);
    expect(staged.slotsRemaining).toBe(7);

    const helper = await makeCustomer('e2e-helper');
    expect((await join(helper, counterId, 4)).status).toBe(201);

    const after = await qty(counterId);
    expect(after.combinedVials).toBe(7);
    expect(after.neededToQualify).toBe(0);
    expect(after.state).toBe('qualified');

    await closePasalo();
    expect((await counterRow(counterId)).status).toBe('closed');
    expect(await allRefunds()).toHaveLength(0);
  });
});

describe('SCENARIO 5 — Pasalo fills to 10', () => {
  it('reaches FULL and refuses anything further', async () => {
    const { counterId } = await makeKahatiProduct('S5');
    await fillCounter(counterId, 3);
    await openPasalo();

    const filler = await makeCustomer('e2e-filler');
    expect((await join(filler, counterId, 7)).status).toBe(201);

    const after = await qty(counterId);
    expect(after.kahatiVials).toBe(3);
    expect(after.pasaloVials).toBe(7);
    expect(after.combinedVials).toBe(10);
    expect(after.slotsRemaining).toBe(0);
    expect(after.state).toBe('full');

    const late = await makeCustomer('e2e-late5');
    expect((await join(late, counterId, 1)).status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(10);
  });
});

describe('SCENARIO 6 — Pasalo fails', () => {
  it('cancels the counter at 6 and makes only its own lines refundable', async () => {
    const failing = await makeKahatiProduct('S6-fail');
    const surviving = await makeKahatiProduct('S6-ok');
    await fillCounter(failing.counterId, 4);
    await fillCounter(surviving.counterId, 8);
    await openPasalo();

    const topUp = await makeCustomer('e2e-topup');
    expect((await join(topUp, failing.counterId, 2)).status).toBe(201);

    const before = await qty(failing.counterId);
    expect(before.combinedVials).toBe(6);
    expect(before.neededToQualify).toBe(1);

    await closePasalo();

    expect((await counterRow(failing.counterId)).status).toBe('cancelled');
    expect((await counterRow(surviving.counterId)).status).toBe('closed');

    const refunds = await allRefunds();
    // Only the failed counter's lines: 4 Kahati joiners + 1 Pasalo joiner.
    expect(refunds).toHaveLength(5);
    expect(new Set(refunds.map((r) => r.groupBuyId))).toEqual(new Set([failing.counterId]));
  });
});

describe('SCENARIO 10 — same product joined several times', () => {
  it('counts every join once and refunds each line once', async () => {
    const { counterId } = await makeKahatiProduct('S10');
    const buyer = await makeCustomer('e2e-repeat');

    const first = await join(buyer, counterId, 2);
    const second = await join(buyer, counterId, 1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await confirmPayment(first.orderId!);
    await confirmPayment(second.orderId!);

    await openPasalo();
    const third = await join(buyer, counterId, 1);
    expect(third.status).toBe(201);
    await confirmPayment(third.orderId!);

    const after = await qty(counterId);
    expect(after.kahatiVials).toBe(3);
    expect(after.pasaloVials).toBe(1);
    expect(after.combinedVials).toBe(4);

    await closePasalo();

    const refunds = await allRefunds();
    // Three orders, one kahati line each -> three refund rows, no duplicates.
    expect(refunds).toHaveLength(3);
    expect(refunds.reduce((s, r) => s + r.qty, 0)).toBe(4);
    expect(new Set(refunds.map((r) => r.orderItemId)).size).toBe(3);
  });
});

describe('SCENARIO 11 — unpaid orders', () => {
  it('DESIGN: a vial counts at CHECKOUT, so an unverified payment does move the counter', async () => {
    // The agreed basis (client decision): commit-time counting, as the hatian
    // board has always worked, with the unverified gap surfaced rather than
    // silently deciding the batch. Asserted so the behaviour is pinned; the gap
    // itself is asserted in the next test.
    const { counterId } = await makeKahatiProduct('S11');
    await fillCounter(counterId, 6);
    const unpaid = await makeCustomer('e2e-unpaid');
    const { status, orderId } = await join(unpaid, counterId, 1);

    expect(status).toBe(201);
    expect((await orderRow(orderId!)).paymentStatus).toBe('proof_submitted');
    expect((await qty(counterId)).combinedVials).toBe(7);
  });

  it('reports payment-confirmed vials apart from committed vials', async () => {
    const { counterId } = await makeKahatiProduct('S11b');
    await fillCounter(counterId, 6);              // all confirmed
    const unpaid = await makeCustomer('e2e-unpaid2');
    await join(unpaid, counterId, 1);             // committed, unverified

    expect((await qty(counterId)).combinedVials).toBe(7);
    expect(await paymentConfirmedVials(counterId)).toBe(6);
  });

  it('releases the vial when the unverified order is cancelled', async () => {
    const { counterId } = await makeKahatiProduct('S11c');
    await fillCounter(counterId, 6);
    const unpaid = await makeCustomer('e2e-unpaid3');
    const { orderId } = await join(unpaid, counterId, 1);
    expect((await qty(counterId)).combinedVials).toBe(7);

    await asAdmin();
    await SET_ORDER_STATUS(
      new Request(`http://localhost/api/admin/orders/${orderId}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
      }),
      { params: Promise.resolve({ id: orderId! }) },
    );

    expect((await qty(counterId)).combinedVials).toBe(6);
  });

  it('releases a vial cancelled DURING the Pasalo stage', async () => {
    const { counterId } = await makeKahatiProduct('S11d');
    await fillCounter(counterId, 5);
    await openPasalo();
    const buyer = await makeCustomer('e2e-pasalo-cancel');
    const { orderId } = await join(buyer, counterId, 2);
    expect((await qty(counterId)).combinedVials).toBe(7);

    await asAdmin();
    await SET_ORDER_STATUS(
      new Request(`http://localhost/api/admin/orders/${orderId}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
      }),
      { params: Promise.resolve({ id: orderId! }) },
    );

    // A phantom vial here would RESCUE a batch and send it to the supplier.
    expect((await qty(counterId)).combinedVials).toBe(5);
  });
});

describe('SCENARIO 12 — two buyers race the final slot', () => {
  it('lets exactly one win, and never records 11', async () => {
    const { counterId } = await makeKahatiProduct('S12');
    await fillCounter(counterId, 9);
    await openPasalo();

    const a = await makeCustomer('e2e-race-a');
    const b = await makeCustomer('e2e-race-b');

    // Both submitted before either resolves. PGlite serialises writes, so this
    // exercises the guarded UPDATE rather than true OS-level parallelism — the
    // ceiling is enforced by `claimed_slots + n <= total_slots` in the WHERE
    // plus the group_buys_claimed_within_cap CHECK, so a loser is rejected
    // whichever order they arrive in.
    const results = await Promise.allSettled([
      join(a, counterId, 1),
      join(b, counterId, 1),
    ]);

    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 201)).toHaveLength(1);

    const row = await counterRow(counterId);
    expect(row.claimedSlots).toBe(10);
    expect(row.claimedSlots).toBeLessThanOrEqual(row.totalSlots);
  });
});

describe('SCENARIO 15 — admin closes Pasalo', () => {
  it('refuses commitments once the stage is closed', async () => {
    const { counterId } = await makeKahatiProduct('S15');
    await fillCounter(counterId, 8);
    await openPasalo();
    await closePasalo();

    const late = await makeCustomer('e2e-late15');
    const refused = await join(late, counterId, 1);

    expect(refused.status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(8);
  });

  it('refuses commitments once the Pasalo deadline has passed', async () => {
    const { counterId } = await makeKahatiProduct('S15b');
    await fillCounter(counterId, 5);
    await openPasalo(new Date(Date.now() - 60_000).toISOString());

    const late = await makeCustomer('e2e-late15b');
    const refused = await join(late, counterId, 1);

    expect(refused.status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(5);
  });
});

describe('SCENARIO 16 — already qualified at 8', () => {
  it('closes as a SUCCESS at 8 and is never failed for missing 10', async () => {
    const { counterId } = await makeKahatiProduct('S16');
    await fillCounter(counterId, 8);
    await openPasalo();

    const staged = await qty(counterId);
    expect(staged.neededToQualify).toBe(0);
    expect(staged.slotsRemaining).toBe(2);

    await closePasalo();

    expect((await counterRow(counterId)).status).toBe('closed');
    expect(await allRefunds()).toHaveLength(0);
  });
});

describe('SCENARIO 25 — variants are separate pools', () => {
  it('never merges two strengths of the same peptide', async () => {
    const ten = await makeKahatiProduct('S25-Tirzepatide-10mg');
    const fifteen = await makeKahatiProduct('S25-Tirzepatide-15mg');
    await fillCounter(ten.counterId, 7);
    await fillCounter(fifteen.counterId, 3);

    expect((await qty(ten.counterId)).combinedVials).toBe(7);
    expect((await qty(fifteen.counterId)).combinedVials).toBe(3);

    await openPasalo();
    await closePasalo();

    expect((await counterRow(ten.counterId)).status).toBe('closed');
    expect((await counterRow(fifteen.counterId)).status).toBe('cancelled');
  });
});

describe('SCENARIO 26/27 — stale clients and direct API calls', () => {
  it('refuses a quantity that would take a Pasalo counter past the box', async () => {
    // A stale tab, or a hand-built request: 8 + 7 = 15 must not happen.
    const { counterId } = await makeKahatiProduct('S27');
    await fillCounter(counterId, 8);
    await openPasalo();

    const attacker = await makeCustomer('e2e-oversell');
    const refused = await join(attacker, counterId, 7);

    expect(refused.status).toBe(400);
    // Nothing partially claimed: the whole transaction rolls back.
    expect((await counterRow(counterId)).claimedSlots).toBe(8);
  });

  it('rolls back completely, leaving no orphan order, when the claim is refused', async () => {
    const { counterId } = await makeKahatiProduct('S27b');
    await fillCounter(counterId, 8);
    const before = (await allOrders()).length;
    await openPasalo();

    const attacker = await makeCustomer('e2e-oversell2');
    await join(attacker, counterId, 7);

    expect((await allOrders()).length).toBe(before);
  });
});

describe('SCENARIO 28 — invalid quantities', () => {
  it.each([0, -1, -9999, 1.5])('refuses qty %s', async (bad) => {
    const { counterId } = await makeKahatiProduct(`S28-${bad}`);
    const buyer = await makeCustomer('e2e-badqty');
    asUser(buyer);

    const res = await CHECKOUT(checkoutRequest(
      checkoutForm([{ kind: 'group_buy', refId: counterId, qty: bad }]),
    ));

    expect(res.status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(0);
  });
});

describe('SCENARIO 29 — authorisation on the customer-facing board', () => {
  it('never exposes another customer\'s identity on the public Pasalo board', async () => {
    const { counterId } = await makeKahatiProduct('S29');
    await fillCounter(counterId, 3);
    await openPasalo();
    session.current = null;

    const res = await PASALO_BOARD();
    const { data } = await res.json();

    expect(res.status).toBe(200);
    const serialised = JSON.stringify(data);
    expect(serialised).not.toMatch(/@example\.com/);
    expect(serialised).not.toMatch(/09171234567/);
    expect(data[0]).toMatchObject({ neededToQualify: 4, slotsRemaining: 7 });
  });
});

describe('INVARIANTS — no impossible state after a full lifecycle', () => {
  it('holds every quantity and status invariant across a mixed batch', async () => {
    const full = await makeKahatiProduct('INV-full');
    const qualified = await makeKahatiProduct('INV-qualified');
    const failed = await makeKahatiProduct('INV-failed');
    await fillCounter(full.counterId, 10);
    await fillCounter(qualified.counterId, 7);
    await fillCounter(failed.counterId, 5);

    await openPasalo();
    await closePasalo();

    const { getDb, groupBuys } = await import('@/lib/db');
    const db = await getDb();
    for (const row of await db.select().from(groupBuys)) {
      const q = counterQuantities(row);
      // 0 <= combined <= 10
      expect(q.combinedVials).toBeGreaterThanOrEqual(0);
      expect(q.combinedVials).toBeLessThanOrEqual(q.maxVials);
      // A batch at or above its minimum must never be cancelled.
      if (q.combinedVials >= q.minRequired && q.combinedVials > 0) {
        expect(row.status).not.toBe('cancelled');
      }
      // A batch below its minimum must never be presented as proceeding, unless
      // nobody ever joined it (those keep running into the next cycle).
      if (q.combinedVials < q.minRequired && q.combinedVials > 0 && row.kahatiVials != null) {
        expect(row.status).not.toBe('closed');
      }
    }

    for (const refund of await allRefunds()) {
      expect(Number(refund.amountPhp)).toBeGreaterThanOrEqual(0);
      expect(refund.combinedVials).toBeLessThan(refund.minRequired);
    }
  });
});
