// Verifying a Supabase access token locally.
//
// The project signs with ES256 (ECC P-256), so verification needs the public
// JWKS, not a shared secret. Doing it in-process rather than calling
// auth.getUser() is what keeps a network round trip off all 51 authenticated
// routes — and what lets this suite run at all, since PGlite has no auth schema.
//
// The key set is injectable for exactly that reason: production resolves the
// remote JWKS, these tests mint their own keypair and never touch the network.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  SignJWT, generateKeyPair, exportJWK, createLocalJWKSet,
  type JWTVerifyGetKey, type KeyLike,
} from 'jose';
import { verifySupabaseToken } from './supabase-jwt';

const KID = 'test-key';
const ISSUER = 'https://project.supabase.co/auth/v1';

let privateKey: KeyLike;
let keys: JWTVerifyGetKey;
let otherPrivateKey: KeyLike;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig' }] });

  // A second, unrelated keypair — stands in for a forged token.
  otherPrivateKey = (await generateKeyPair('ES256')).privateKey;
});

type Claims = Record<string, unknown>;

const sign = async (claims: Claims, opts: { key?: KeyLike; alg?: string; expired?: boolean } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ aud: 'authenticated', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: KID })
    .setIssuer(ISSUER)
    .setIssuedAt(opts.expired ? now - 7200 : now)
    .setExpirationTime(opts.expired ? now - 3600 : now + 3600)
    .sign(opts.key ?? privateKey);
};

const valid = (over: Claims = {}) => ({
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'ana@example.com',
  app_metadata: { role: 'customer' },
  ...over,
});

describe('verifySupabaseToken', () => {
  it('accepts a well-formed token and returns the session shape the app already uses', async () => {
    const token = await sign(valid());

    const session = await verifySupabaseToken(token, keys);

    expect(session).toEqual({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'ana@example.com',
      role: 'customer',
    });
  });

  it('reads the role from app_metadata, which only the service role can write', async () => {
    const token = await sign(valid({ app_metadata: { role: 'admin' } }));

    expect((await verifySupabaseToken(token, keys)).role).toBe('admin');
  });

  it('IGNORES a role in user_metadata — the customer can edit that themselves', async () => {
    const token = await sign(valid({
      app_metadata: { role: 'customer' },
      user_metadata: { role: 'admin' },
    }));

    // The whole admin surface hangs off this. A self-service privilege
    // escalation would be one editable claim away.
    expect((await verifySupabaseToken(token, keys)).role).toBe('customer');
  });

  it('falls back to customer when no role claim is present, never to admin', async () => {
    const token = await sign(valid({ app_metadata: {} }));

    expect((await verifySupabaseToken(token, keys)).role).toBe('customer');
  });

  it('rejects an unrecognised role rather than passing it through', async () => {
    const token = await sign(valid({ app_metadata: { role: 'superuser' } }));

    expect((await verifySupabaseToken(token, keys)).role).toBe('customer');
  });

  it('rejects a token signed by a key outside the JWKS', async () => {
    const token = await sign(valid(), { key: otherPrivateKey });

    await expect(verifySupabaseToken(token, keys)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await sign(valid(), { expired: true });

    await expect(verifySupabaseToken(token, keys)).rejects.toThrow();
  });

  it('rejects a token with no subject — there is no account to act as', async () => {
    const token = await sign({ email: 'ana@example.com', app_metadata: { role: 'customer' } });

    await expect(verifySupabaseToken(token, keys)).rejects.toThrow(/subject/i);
  });

  it('rejects garbage', async () => {
    await expect(verifySupabaseToken('not-a-token', keys)).rejects.toThrow();
    await expect(verifySupabaseToken('', keys)).rejects.toThrow();
  });

  it('pins ES256 — an HS256 token must not verify against a public key', async () => {
    // Algorithm confusion: the JWKS public key is public, so if HS256 were
    // accepted anyone could use that public key as an HMAC secret and mint a
    // valid admin token. jose is handed an explicit algorithm list to stop it.
    const jwk = await exportJWK((await generateKeyPair('ES256')).publicKey);
    const secret = new TextEncoder().encode(JSON.stringify(jwk));
    const forged = await new SignJWT(valid())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifySupabaseToken(forged, keys)).rejects.toThrow();
  });
});
