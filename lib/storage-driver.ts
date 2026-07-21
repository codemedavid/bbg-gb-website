// Which backend receives uploaded files (QR codes, payment proofs, COA files).
//
// This used to be a bare `process.env.STORAGE_DRIVER || 'local'`. When the
// variable was missing in the deployed environment it resolved to 'local',
// which writes to the server filesystem — read-only on serverless hosts. Every
// QR upload (and therefore every "add payment method", since a new method
// requires a QR) failed with an opaque 500.
//
// So: an explicit driver still wins, an unknown one is rejected loudly rather
// than silently downgraded, and an unset one is inferred from whichever
// credentials are actually present.

export type StorageDriver = 'local' | 'supabase' | 'imagekit';

const DRIVERS: readonly StorageDriver[] = ['local', 'supabase', 'imagekit'];

export type DriverInputs = {
  /** Raw STORAGE_DRIVER value, if any. */
  explicit?: string;
  /** IMAGEKIT_PRIVATE_KEY + IMAGEKIT_URL_ENDPOINT are both set. */
  hasImageKit: boolean;
  /** SUPABASE_URL + SUPABASE_SERVICE_KEY are both set. */
  hasSupabase: boolean;
};

export function resolveStorageDriver({ explicit, hasImageKit, hasSupabase }: DriverInputs): StorageDriver {
  const named = (explicit ?? '').trim().toLowerCase();
  if (named) {
    const match = DRIVERS.find((d) => d === named);
    if (!match) {
      throw new Error(`STORAGE_DRIVER must be one of ${DRIVERS.join(', ')} — got "${explicit}".`);
    }
    return match;
  }
  // Nothing declared: prefer a real backend over the local filesystem. ImageKit
  // wins over Supabase because it is the media-serving one (CDN + signed URLs).
  if (hasImageKit) return 'imagekit';
  if (hasSupabase) return 'supabase';
  return 'local';
}

// Non-null when the resolved driver cannot actually store files in this
// environment. Callers surface this at upload time instead of at import time, so
// a misconfigured deploy still serves pages and reports one clear cause.
//
// `credsPresent` says whether the *selected* driver's credentials are set. It
// defaults to true so legacy two-arg callers behave as before; a remote driver
// chosen without its keys is a config error in every environment, not just prod.
export function describeDriverProblem(driver: StorageDriver, isProd: boolean, credsPresent = true): string | null {
  if (driver === 'local' && isProd) {
    return 'File uploads are not configured: STORAGE_DRIVER is unset, so uploads fall back to the local '
      + 'filesystem, which is read-only in production. Set STORAGE_DRIVER=imagekit (with IMAGEKIT_PRIVATE_KEY '
      + 'and IMAGEKIT_URL_ENDPOINT) or STORAGE_DRIVER=supabase (with SUPABASE_SERVICE_KEY).';
  }
  if (driver === 'imagekit' && !credsPresent) {
    return 'File uploads are not configured: STORAGE_DRIVER=imagekit but IMAGEKIT_PRIVATE_KEY '
      + 'and/or IMAGEKIT_URL_ENDPOINT are missing. Set both (locally in .env and in the deploy env).';
  }
  if (driver === 'supabase' && !credsPresent) {
    return 'File uploads are not configured: STORAGE_DRIVER=supabase but SUPABASE_SERVICE_KEY '
      + '(and/or SUPABASE_URL) is missing. Set the service key in the deploy env.';
  }
  return null;
}
