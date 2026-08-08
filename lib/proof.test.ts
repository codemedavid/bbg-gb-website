// Up to five payment proofs per order.
//
// Bank transfer limits mean a ₱4,500 order is often paid in three transfers, so
// the customer has three screenshots and nowhere to put two of them. The cap is
// five, and it is enforced HERE rather than only by the file input: the count
// arrives from a multipart body that anyone can hand-build.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const put = vi.fn(async (..._args: unknown[]) => ({ key: 'stored' }));
vi.mock('@/lib/storage', () => ({ putFile: (...args: unknown[]) => put(...args) }));

const { validateAndStoreProofs, MAX_PROOFS, MAX_PROOF_BYTES } = await import('@/lib/proof');

const image = (name = 'proof.png') =>
  new File([Buffer.from('fake-image-bytes')], name, { type: 'image/png' });

const files = (n: number) => Array.from({ length: n }, (_, i) => image(`proof-${i + 1}.png`));

beforeEach(() => { put.mockClear(); });

describe('MAX_PROOFS', () => {
  it('is five, the number the requirement names', () => {
    expect(MAX_PROOFS).toBe(5);
  });
});

describe('validateAndStoreProofs', () => {
  it('stores a single proof and returns its key', async () => {
    const keys = await validateAndStoreProofs([image()]);

    expect(keys).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('stores three proofs as three distinct keys', async () => {
    // The customer who split one payment across three transfers. Distinct keys,
    // or the second upload silently overwrites the first in the bucket.
    const keys = await validateAndStoreProofs(files(3));

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('stores the full five', async () => {
    const keys = await validateAndStoreProofs(files(5));

    expect(keys).toHaveLength(5);
  });

  it('refuses a sixth proof rather than silently dropping it', async () => {
    // Truncating to five would take the customer's money for a payment whose
    // proof we then discarded, and tell them nothing.
    await expect(validateAndStoreProofs(files(6))).rejects.toMatchObject({ status: 400 });
  });

  it('names the limit when it refuses', async () => {
    await expect(validateAndStoreProofs(files(6))).rejects.toThrow(/5/);
  });

  it('stores nothing at all when the count is refused', async () => {
    // The count is knowable before any upload, so a refused submission must not
    // leave five orphaned objects in the bucket.
    await validateAndStoreProofs(files(6)).catch(() => {});

    expect(put).not.toHaveBeenCalled();
  });

  it('requires at least one proof', async () => {
    await expect(validateAndStoreProofs([])).rejects.toMatchObject({ status: 400 });
  });

  it('ignores empty file slots rather than storing them', async () => {
    // An untouched <input type="file"> submits a zero-byte entry. Five empty
    // slots plus one real upload is one proof, not six.
    const keys = await validateAndStoreProofs([
      new File([], '', { type: 'application/octet-stream' }),
      image(),
      new File([], '', { type: 'application/octet-stream' }),
    ]);

    expect(keys).toHaveLength(1);
  });

  it('refuses when every slot is empty', async () => {
    await expect(validateAndStoreProofs([
      new File([], '', { type: 'application/octet-stream' }),
    ])).rejects.toThrow(/required/i);
  });

  it('refuses a file that is not an image or PDF', async () => {
    const bad = new File([Buffer.from('#!/bin/sh')], 'run.sh', { type: 'application/x-sh' });

    await expect(validateAndStoreProofs([bad])).rejects.toThrow(/image or PDF/i);
  });

  it('refuses an oversized file', async () => {
    const huge = new File([Buffer.alloc(MAX_PROOF_BYTES + 1)], 'big.png', { type: 'image/png' });

    await expect(validateAndStoreProofs([huge])).rejects.toThrow(/8MB/i);
  });

  it('refuses the whole batch when one file among several is invalid', async () => {
    // Accepting the good ones would leave the customer believing a proof they
    // can see in the list was filed, when it was not.
    const bad = new File([Buffer.from('x')], 'run.sh', { type: 'application/x-sh' });

    await expect(validateAndStoreProofs([image(), bad, image()])).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a PDF alongside images', async () => {
    const pdf = new File([Buffer.from('%PDF-1.4')], 'receipt.pdf', { type: 'application/pdf' });

    const keys = await validateAndStoreProofs([image(), pdf]);

    expect(keys).toHaveLength(2);
  });

  it('keeps each file extension on its stored key', async () => {
    // The admin opens these in a browser; a .pdf served as an extensionless
    // blob downloads instead of previewing.
    const pdf = new File([Buffer.from('%PDF-1.4')], 'receipt.pdf', { type: 'application/pdf' });

    const keys = await validateAndStoreProofs([image('shot.png'), pdf]);

    expect(keys[0]).toMatch(/\.png$/);
    expect(keys[1]).toMatch(/\.pdf$/);
  });
});
