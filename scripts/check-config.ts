// Fails a production build that cannot deliver customer email, or cannot sign a
// session cookie nobody else can forge.
//
// Run before a deploy (`npm run config:check`), alongside the schema-drift gate.
// The test suite cannot catch this: vitest.config.ts pins POSTHOG_KEY to '' on
// purpose so a suite run never mails a real customer, so the suite is green in
// exactly the state that broke production. Only the deploying environment knows.
import 'dotenv/config';
import { env } from '../lib/env';
import { POSTHOG_KINDS } from '../lib/email-delivery';
import { decideDeliveryConfigOutcome } from '../lib/delivery-config';
import { decideJwtSecretOutcome } from '../lib/jwt-config';

function report(outcome: { blocksBuild: boolean; skipped: boolean; message: string; exitCode: 0 | 1 }): 0 | 1 {
  if (outcome.blocksBuild) console.error(outcome.message);
  else if (outcome.skipped) console.warn(outcome.message);
  else console.log(outcome.message);
  return outcome.exitCode;
}

function main(): 0 | 1 {
  const isProductionDeploy = process.env.VERCEL_ENV === 'production';

  // Both gates always run, so one failure never hides the other — a deploy
  // blocked twice should say so twice rather than send someone round again.
  const delivery = decideDeliveryConfigOutcome({
    // env.posthogKey already carries the NEXT_PUBLIC_POSTHOG_KEY fallback, so the
    // gate reads the key exactly as captureEvent will at runtime.
    hasPosthogKey: !!env.posthogKey,
    posthogDeliversMail: POSTHOG_KINDS.size > 0,
    isProductionDeploy,
  });

  // Read from process.env rather than env.jwtSecret, which has already applied
  // the fallback the gate exists to reject.
  const signing = decideJwtSecretOutcome({ secret: process.env.JWT_SECRET, isProductionDeploy });

  // Both reported before either return value is consulted: `||` short-circuits,
  // and a deploy blocked on mail would otherwise never be told about its
  // signing key, sending someone round the loop a second time.
  const deliveryCode = report(delivery);
  const signingCode = report(signing);
  return (deliveryCode || signingCode) as 0 | 1;
}

process.exitCode = main();
