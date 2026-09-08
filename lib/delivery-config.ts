// Whether the deploying environment can actually deliver customer mail.
//
// Split from the script the way lib/db/check-outcome.ts is: the script gathers
// facts (is the key present, does any kind route through PostHog, is this the
// production deploy) and this decides what they mean for the build.
//
// The gate exists because the failure it catches is invisible everywhere else.
// captureEvent deliberately never throws — a PostHog outage must not fail an
// order — so a missing key produces a normal-looking checkout, an email_log row,
// and no mail. Twice that shipped to production unnoticed. The environment is
// the only place the truth lives, so the build is the only place to ask.

export type DeliveryConfigInputs = {
  hasPosthogKey: boolean;
  /** Any notification kind still routes through PostHog (lib/email-delivery.ts). */
  posthogDeliversMail: boolean;
  /** This build's env is the one customers receive mail from — VERCEL_ENV=production. */
  isProductionDeploy: boolean;
};

export type DeliveryConfigOutcome = {
  exitCode: 0 | 1;
  blocksBuild: boolean;
  /** The check did not apply to this build, so it proves nothing. */
  skipped: boolean;
  /** True only when mail delivery was confirmed configured. */
  verified: boolean;
  message: string;
};

export function decideDeliveryConfigOutcome(
  { hasPosthogKey, posthogDeliversMail, isProductionDeploy }: DeliveryConfigInputs,
): DeliveryConfigOutcome {
  // Nothing depends on PostHog any more, so a missing key is not a defect. If
  // SMTP_KINDS ever takes delivery over, this gate stands down on its own rather
  // than demanding a key no kind reads.
  if (!posthogDeliversMail) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: true,
      verified: false,
      message: 'Email delivery check SKIPPED — no notification kind routes through PostHog, '
        + 'so POSTHOG_KEY is not required by this build.',
    };
  }

  if (hasPosthogKey) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: false,
      verified: true,
      message: 'POSTHOG_KEY is set — customer email has a configured deliverer.',
    };
  }

  // A preview deploy, a local build or a fork without secrets never mails a
  // customer. Blocking those would only teach people to bypass the gate.
  if (!isProductionDeploy) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: true,
      verified: false,
      message: 'Email delivery check SKIPPED — POSTHOG_KEY is not set, but this is not the '
        + 'production deploy, so no customer mail depends on it. This is not a clean bill of '
        + 'health for production.',
    };
  }

  return {
    exitCode: 1,
    blocksBuild: true,
    skipped: false,
    verified: false,
    message: 'Email delivery check FAILED — POSTHOG_KEY is not set in the production '
      + 'environment, and PostHog delivers every customer email (receipts, payment '
      + 'confirmations, password resets). Deploying now would compose each one, write its '
      + 'email_log row, and send nothing — exactly the 2026-09-02 outage, which ran six days '
      + 'and dropped 263 notifications.\n'
      + 'Fix: set POSTHOG_KEY (Vercel -> Settings -> Environment Variables -> Production), '
      + 'then redeploy. Verify in PostHog\'s Activity feed — its ingest endpoint answers '
      + '{"status":"Ok"} even for a bogus key, so curl cannot confirm it.',
  };
}
