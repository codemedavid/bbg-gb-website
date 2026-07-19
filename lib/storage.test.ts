// The upload guard. A production deploy with no STORAGE_DRIVER used to reach
// fs.writeFile on a read-only filesystem, and the EROFS surfaced to the admin as
// a bare 500 "Something went wrong." — giving no hint that an env var was missing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeEnv = {
  storageDriver: 'local' as 'local' | 'supabase' | 'imagekit',
  isProd: false,
  supabaseUrl: '', supabaseServiceKey: '',
  imagekitPrivateKey: '', imagekitUrlEndpoint: '',
};

vi.mock('@/lib/env', () => ({
  env: fakeEnv,
  BUCKETS: { proofs: 'payment-proofs', coa: 'coa-files', qr: 'payment-qr' },
  IMAGEKIT_ROOT: 'bbg-groupbuy',
}));
vi.mock('./env', () => ({
  env: fakeEnv,
  BUCKETS: { proofs: 'payment-proofs', coa: 'coa-files', qr: 'payment-qr' },
  IMAGEKIT_ROOT: 'bbg-groupbuy',
}));

const { putFile } = await import('./storage');
const { ApiError } = await import('./session');

const qr = () => Buffer.from('fake-qr-bytes');

beforeEach(() => {
  fakeEnv.storageDriver = 'local';
  fakeEnv.isProd = false;
});

describe('putFile storage guard', () => {
  it('refuses to pretend local storage works in production', async () => {
    fakeEnv.isProd = true;

    await expect(putFile('payment-qr', 'a.png', qr(), 'image/png')).rejects.toThrow(ApiError);
  });

  it('names STORAGE_DRIVER so the operator knows what to set', async () => {
    fakeEnv.isProd = true;

    const err = await putFile('payment-qr', 'a.png', qr(), 'image/png').catch((e) => e);

    expect(err.status).toBe(503);
    expect(err.message).toMatch(/STORAGE_DRIVER/);
    expect(err.message).toMatch(/imagekit/);
  });

  it('still writes to the local filesystem in development', async () => {
    const stored = await putFile('payment-qr', `test-${Date.now()}.png`, qr(), 'image/png');

    expect(stored.key).toMatch(/\.png$/);
  });
});
