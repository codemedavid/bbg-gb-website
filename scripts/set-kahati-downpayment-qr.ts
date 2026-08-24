// Points the hatian downpayment at a QR image and sets the amount it encodes.
//
//   npx tsx scripts/set-kahati-downpayment-qr.ts <image> --amount 150 \
//     [--label MariBank] [--account-name "BBG Peptides"] \
//     [--account-number "Scan the QR (InstaPay)"] [--instructions "..."]
//
// Idempotent: re-running with the same --label re-points that same method
// rather than adding a second downpayment QR to the checkout screen.
//
// Which database and storage it writes to is whatever DATABASE_URL and
// STORAGE_DRIVER say — the local PGlite + ./uploads by default, Supabase +
// ImageKit when pointed at production. The admin screen at
// /admin/payment-methods does the same job through the browser; this exists for
// the first install, before that screen is deployed.
import { installKahatiDownpaymentQr } from '../lib/kahati-downpayment-qr';
import { describeKahatiDownpayment } from '../lib/kahati-downpayment';
import { php } from '../lib/format';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  if (!imagePath || imagePath.startsWith('--')) {
    throw new Error('Usage: tsx scripts/set-kahati-downpayment-qr.ts <image> --amount <php> [--label <name>]');
  }
  const amountPhp = Number(flag('amount'));
  if (!Number.isFinite(amountPhp) || amountPhp <= 0) {
    throw new Error('Pass --amount with the peso figure the QR is locked to, e.g. --amount 150');
  }

  const result = await installKahatiDownpaymentQr({
    imagePath,
    amountPhp,
    label: flag('label') ?? 'MariBank',
    accountName: flag('account-name') ?? 'BBG Peptides',
    accountNumber: flag('account-number') ?? 'Scan the QR (InstaPay)',
    instructions: flag('instructions') ?? `Send exactly ${php(amountPhp)} — this QR is locked to that amount.`,
  });

  console.log('Kahati downpayment QR installed.');
  console.log(`  method   ${result.methodId}`);
  console.log(`  qr key   ${result.qrKey}`);
  console.log(`  collects ${describeKahatiDownpayment(result.policy)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Could not install the downpayment QR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
