import { describe, it, expect, vi } from 'vitest';

// Capture what would be persisted without touching the filesystem/Supabase.
const stored: { bucket: string; key: string; type: string }[] = [];
vi.mock('@/lib/storage', () => ({
  putFile: async (bucket: string, key: string, _body: Buffer, contentType: string) => {
    stored.push({ bucket, key, type: contentType });
    return { key };
  },
}));

vi.mock('@/lib/session', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const { validateAndStoreImage, MAX_IMAGE_BYTES } = await import('./uploads');

const png = (name = 'qr.png', type = 'image/png', bytes = 10) =>
  new File([Buffer.alloc(bytes, 1)], name, { type });

describe('validateAndStoreImage', () => {
  it('stores a valid image and returns a keyed filename', async () => {
    const key = await validateAndStoreImage(png(), 'payment-qr');
    expect(key).toMatch(/\.png$/);
    expect(stored.at(-1)).toMatchObject({ bucket: 'payment-qr', type: 'image/png' });
  });

  it('rejects a missing file', async () => {
    await expect(validateAndStoreImage(null, 'payment-qr')).rejects.toThrow(/required/i);
  });

  it('rejects a non-image type', async () => {
    await expect(validateAndStoreImage(png('doc.pdf', 'application/pdf'), 'payment-qr')).rejects.toThrow(/JPG|PNG/i);
  });

  it('rejects an oversized file', async () => {
    await expect(validateAndStoreImage(png('big.png', 'image/png', MAX_IMAGE_BYTES + 1), 'payment-qr')).rejects.toThrow(/5MB/i);
  });
});
