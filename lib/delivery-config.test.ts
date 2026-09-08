// Build-time gate for "is anything actually configured to deliver customer mail".
//
// Twice in three weeks a production deploy shipped with POSTHOG_KEY absent and
// nothing announced it: the app composed the mail, wrote an email_log row, and
// dropped it. The 2026-09-02 outage ran six days and swallowed 263 notifications
// — receipts, payment confirmations, password resets — before anyone looked at
// the table. Every test was green throughout, because the key is environment,
// not code. Only a check that runs against the deploying environment can catch
// it, which is why this sits in prebuild next to the schema-drift gate.
import { describe, it, expect } from 'vitest';
import { decideDeliveryConfigOutcome } from './delivery-config';

describe('decideDeliveryConfigOutcome', () => {
  it('passes when the key that delivers the mail is configured', () => {
    const outcome = decideDeliveryConfigOutcome({
      hasPosthogKey: true, posthogDeliversMail: true, isProductionDeploy: true,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.blocksBuild).toBe(false);
    expect(outcome.verified).toBe(true);
  });

  it('blocks a production deploy when the mail has no delivery key', () => {
    // The exact 2026-09-02 state. This is the assertion the outage is named for.
    const outcome = decideDeliveryConfigOutcome({
      hasPosthogKey: false, posthogDeliversMail: true, isProductionDeploy: true,
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.blocksBuild).toBe(true);
    expect(outcome.verified).toBe(false);
  });

  it('names the missing variable so the fix needs no archaeology', () => {
    const outcome = decideDeliveryConfigOutcome({
      hasPosthogKey: false, posthogDeliversMail: true, isProductionDeploy: true,
    });

    expect(outcome.message).toMatch(/POSTHOG_KEY/);
  });

  it('warns without blocking on a build that never mails a customer', () => {
    // Preview deploys, local builds and forks without secrets legitimately have
    // no key. Blocking them would only teach people to bypass the gate.
    const outcome = decideDeliveryConfigOutcome({
      hasPosthogKey: false, posthogDeliversMail: true, isProductionDeploy: false,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.blocksBuild).toBe(false);
    expect(outcome.skipped).toBe(true);
  });

  it('does not read a non-production skip as a verified configuration', () => {
    const skipped = decideDeliveryConfigOutcome({
      hasPosthogKey: false, posthogDeliversMail: true, isProductionDeploy: false,
    });

    expect(skipped.verified).toBe(false);
  });

  it('stands down when nothing routes through PostHog any more', () => {
    // SMTP_KINDS could yet take over delivery (lib/email-delivery.ts). A gate that
    // demanded a key no kind depends on would be a false alarm.
    const outcome = decideDeliveryConfigOutcome({
      hasPosthogKey: false, posthogDeliversMail: false, isProductionDeploy: true,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.blocksBuild).toBe(false);
  });
});
