// File hatian balances that were paid through the order uploader as
// settlements awaiting review, against a real database.
//
// DRY RUN BY DEFAULT. Lists every candidate and writes nothing.
//
//   DATABASE_URL="<url>" npx tsx scripts/settle-from-order-proof.ts
//   DATABASE_URL="<url>" npx tsx scripts/settle-from-order-proof.ts --apply KH-2794,KH-2726
//
// --apply takes an explicit list of order numbers and will not run without one.
// Look at each order's proofs in the admin first: the screenshots carry no
// amount, and one may be a top-up of the checkout payment rather than the
// balance. Approved settlements are then confirmed in Admin → Settlements, the
// same as any other.
//
// The rules live in lib/balance-proof-settlement-server.ts and are covered by
// its tests; this only prints and passes arguments through.
import 'dotenv/config';
import { inArray } from 'drizzle-orm';
import { getDb, users } from '@/lib/db';
import { findBalanceProofOrders, recordBalanceProofSettlements } from '@/lib/balance-proof-settlement-server';

const applyAt = process.argv.indexOf('--apply');
const APPLY = applyAt !== -1;
const orderNos = APPLY ? (process.argv[applyAt + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];

async function main() {
  if (APPLY && orderNos.length === 0) {
    console.error('--apply needs the order numbers to file, e.g. --apply KH-2794,KH-2726');
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const candidates = await findBalanceProofOrders(db);
  const emails = new Map((candidates.length
    ? await db.select({ id: users.id, email: users.email }).from(users)
      .where(inArray(users.id, [...new Set(candidates.map((c) => c.userId))]))
    : []).map((u) => [u.id, u.email]));

  console.log(`candidates: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`  ${c.orderNo.padEnd(9)} balance ₱${c.balancePhp.toFixed(2).padStart(10)}  late proofs: ${c.lateProofKeys.length}  ${emails.get(c.userId) ?? c.userId}`);
  }

  if (!APPLY) { console.log('\nDRY RUN — pass --apply <order numbers> to file them.'); return; }

  const recorded = await recordBalanceProofSettlements(db, orderNos);
  for (const r of recorded) {
    console.log(`filed settlement ${r.settlementId} (proof_review) for ${r.orderNos.join(', ')}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
