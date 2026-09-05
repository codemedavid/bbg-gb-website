// Local verification of a Supabase access token.
//
// The project signs with ES256 (ECC P-256), so the app verifies against the
// public JWKS rather than a shared secret — there is no symmetric
// SUPABASE_JWT_SECRET to leak or rotate. createRemoteJWKSet caches the key set
// in-process and only refetches on an unknown `kid`, so this costs one HTTP
// request per cold start, not one per request.
//
// Deliberately not auth.getUser(): that is a network round trip to Supabase on
// every authenticated request across 51 routes, and it would make the test suite
// depend on a live project.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { env } from './env';

/** The session shape the rest of the app already speaks (lib/auth.ts JwtPayload). */
export type SupabaseSession = {
  sub: string;
  email: string;
  role: 'customer' | 'admin';
};

// Anything outside this list is treated as a plain customer. An unrecognised
// value must never widen access — a typo in app_metadata is not an admin.
const ROLES = new Set(['customer', 'admin']);

let cached: JWTVerifyGetKey | null = null;

/** The project's published signing keys. Memoised for the life of the process. */
export function remoteKeySet(): JWTVerifyGetKey {
  if (!cached) {
    if (!env.supabaseUrl) throw new Error('SUPABASE_URL is not set — cannot verify access tokens.');
    cached = createRemoteJWKSet(new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return cached;
}

function readRole(payload: Record<string, unknown>): 'customer' | 'admin' {
  // app_metadata ONLY. raw_user_meta_data is writable by the account it belongs
  // to, so a role read from there would let any customer promote themselves.
  const appMetadata = payload.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object') return 'customer';
  const role = (appMetadata as Record<string, unknown>).role;
  return typeof role === 'string' && ROLES.has(role) ? (role as 'customer' | 'admin') : 'customer';
}

export async function verifySupabaseToken(
  token: string,
  keys: JWTVerifyGetKey = remoteKeySet(),
): Promise<SupabaseSession> {
  // The algorithm list is pinned, not inferred from the token header. The JWKS
  // public key is public by definition, so accepting HS256 here would let anyone
  // use it as an HMAC secret and mint whatever claims they liked.
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['ES256'],
    audience: 'authenticated',
  });

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Access token has no subject.');
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    role: readRole(payload as Record<string, unknown>),
  };
}
