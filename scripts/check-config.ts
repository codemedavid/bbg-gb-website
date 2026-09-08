// Fails a production build that has no way to deliver customer email.
//
// Run before a deploy (`npm run config:check`), alongside the schema-drift gate.
// The test suite cannot catch this: vitest.config.ts pins POSTHOG_KEY to '' on
// purpose so a suite run never mails a real customer, so the suite is green in
// exactly the state that broke production. Only the deploying environment knows.
import 'dotenv/config';
import { env } from '../lib/env';
import { POSTHOG_KINDS } from '../lib/email-delivery';
import { decideDeliveryConfigOutcome } from '../lib/delivery-config';

function main(): 0 | 1 {
  const outcome = decideDeliveryConfigOutcome({
    // env.posthogKey already carries the NEXT_PUBLIC_POSTHOG_KEY fallback, so the
    // gate reads the key exactly as captureEvent will at runtime.
    hasPosthogKey: !!env.posthogKey,
    posthogDeliversMail: POSTHOG_KINDS.size > 0,
    isProductionDeploy: process.env.VERCEL_ENV === 'production',
  });

  if (outcome.blocksBuild) console.error(outcome.message);
  else if (outcome.skipped) console.warn(outcome.message);
  else console.log(outcome.message);

  return outcome.exitCode;
}

process.exitCode = main();
