// Whether the deploying environment can sign a session cookie nobody else can forge.
//
// Companion to lib/delivery-config.ts, and it exists for the same reason: the
// failure is invisible everywhere else. lib/env.ts falls back to a constant
// committed in this repository when JWT_SECRET is unset, so a production deploy
// missing the variable boots cleanly, logs in cleanly, and issues tokens that
// anyone who has read the source can mint — including `role: 'admin'`. Nothing
// errors and no test goes red, because the suite runs on that same fallback on
// purpose. The environment is the only place the truth lives, so the build is
// the only place to ask.

/**
 * The fallback lib/env.ts uses when JWT_SECRET is unset.
 *
 * Exported so there is one literal rather than two that can drift apart, and so
 * the gate below can recognise it. Its value is public by construction — that
 * is the whole point of rejecting it in production.
 */
export const DEV_JWT_SECRET = 'dev-insecure-secret-change-me';

/**
 * Shortest secret accepted in production.
 *
 * HS256 keys the length of a password are brute-forceable offline: an attacker
 * needs one expired cookie and no access to anything. 32 bytes matches the
 * output width of SHA-256, which is the floor RFC 7518 §3.2 sets for HS256.
 */
export const MIN_JWT_SECRET_LENGTH = 32;

export type JwtSecretInputs = {
  /** Raw process.env.JWT_SECRET, before lib/env.ts applies any fallback. */
  secret: string | undefined;
  /** This build's env is the one customers log into — VERCEL_ENV=production. */
  isProductionDeploy: boolean;
};

export type JwtSecretOutcome = {
  exitCode: 0 | 1;
  blocksBuild: boolean;
  /** The check did not apply to this build, so it proves nothing. */
  skipped: boolean;
  /** True only when a real signing key was confirmed present. */
  verified: boolean;
  message: string;
};

/** A usable production signing key, or the reason it is not one. */
function rejectionReason(secret: string | undefined): string | null {
  const value = (secret ?? '').trim();
  if (!value) return 'JWT_SECRET is not set';
  if (value === DEV_JWT_SECRET) {
    return 'JWT_SECRET is still the development fallback committed in this repository';
  }
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET is ${value.length} characters, below the ${MIN_JWT_SECRET_LENGTH} an HS256 key needs`;
  }
  return null;
}

export function decideJwtSecretOutcome({ secret, isProductionDeploy }: JwtSecretInputs): JwtSecretOutcome {
  const reason = rejectionReason(secret);

  if (!reason) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: false,
      verified: true,
      message: 'JWT_SECRET is set to a key of usable length — session cookies are signed with a private secret.',
    };
  }

  // A preview deploy, a local build or a fork without secrets issues tokens
  // nobody trusts. Blocking those would only teach people to bypass the gate.
  if (!isProductionDeploy) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: true,
      verified: false,
      message: `Session signing check SKIPPED — ${reason}, but this is not the production `
        + 'deploy, so no customer session depends on it. This is not a clean bill of health '
        + 'for production.',
    };
  }

  return {
    exitCode: 1,
    blocksBuild: true,
    skipped: false,
    verified: false,
    message: `Session signing check FAILED — ${reason}, and this is the production deploy.\n`
      + 'Every session cookie is an HS256 JWT signed with that value (lib/auth.ts), so anyone '
      + 'who can guess or read it can mint a token for any account, including one carrying '
      + "role: 'admin'. No request fails and nothing is logged when this happens.\n"
      + 'Fix: generate one with `openssl rand -base64 48`, set it as JWT_SECRET '
      + '(Vercel -> Settings -> Environment Variables -> Production), then redeploy.\n'
      + 'Note: changing this value invalidates every session signed with the old one, so all '
      + 'signed-in users are logged out once and sign in again. Nothing else is affected — '
      + 'passwords, orders and carts are untouched.',
  };
}
