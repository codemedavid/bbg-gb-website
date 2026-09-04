// Which files count as a payment proof.
//
// The uploader offers `accept="image/*,application/pdf"`, so the browser lets
// through anything it calls an image. The server then matched a much shorter
// list — jpeg, png, webp, heic, pdf — and refused everything else with "Proof
// must be an image or PDF". A customer holding a screenshot that IS an image
// reads that as nonsense, retries the same file, and gets the same refusal.
// There is no way out of it from the checkout screen, and nothing about it
// reaches us: a rejected upload leaves no row, which is why the live proofs
// table shows only the formats that happen to pass.
//
// Two gaps produced it. Formats phones and share sheets genuinely emit — heif,
// avif, and the gif/bmp a screenshot tool may hand over — were simply missing.
// And a file picked through some Android file managers arrives with an EMPTY
// `type`, which matched nothing at all however ordinary the file was.
//
// So: accept what the browser is allowed to offer, and when the browser tells us
// nothing, fall back to the name. Both halves live here rather than in
// lib/proof.ts because the uploader has to apply the same rule before the
// customer waits out an upload that was never going to be accepted — and that
// module is server-only.
import { describe, it, expect } from 'vitest';
import { isAcceptableProof, MAX_PROOF_BYTES } from './proof-limits';

const file = (name: string, type: string) => ({ name, type });

describe('isAcceptableProof', () => {
  it('accepts the formats that already worked', () => {
    // Every extension present in the live proofs table today. Nothing here may
    // regress: these are what customers actually send.
    expect(isAcceptableProof(file('gcash.png', 'image/png'))).toBe(true);
    expect(isAcceptableProof(file('bdo.jpg', 'image/jpeg'))).toBe(true);
    expect(isAcceptableProof(file('bpi.jpeg', 'image/jpeg'))).toBe(true);
    expect(isAcceptableProof(file('receipt.pdf', 'application/pdf'))).toBe(true);
    expect(isAcceptableProof(file('shot.webp', 'image/webp'))).toBe(true);
  });

  it('accepts an iPhone photo in its native container', () => {
    expect(isAcceptableProof(file('IMG_0421.heic', 'image/heic'))).toBe(true);
    // Safari and some share sheets report the HEIF spelling for the same thing.
    expect(isAcceptableProof(file('IMG_0421.heif', 'image/heif'))).toBe(true);
  });

  it('accepts the newer formats Android screenshot tools emit', () => {
    expect(isAcceptableProof(file('Screenshot_2026.avif', 'image/avif'))).toBe(true);
    expect(isAcceptableProof(file('capture.gif', 'image/gif'))).toBe(true);
    expect(isAcceptableProof(file('capture.bmp', 'image/bmp'))).toBe(true);
  });

  it('accepts image/jpg, which is not a real MIME type but is what some pickers send', () => {
    expect(isAcceptableProof(file('transfer.jpg', 'image/jpg'))).toBe(true);
  });

  it('is not confused by an upper-case MIME type', () => {
    expect(isAcceptableProof(file('transfer.JPG', 'IMAGE/JPEG'))).toBe(true);
  });

  it('falls back to the file name when the browser reports no type at all', () => {
    // The Android file-manager case. The file is an ordinary screenshot; only
    // the metadata went missing, and refusing it told the customer their image
    // was not an image.
    expect(isAcceptableProof(file('Screenshot_20260904.jpg', ''))).toBe(true);
    expect(isAcceptableProof(file('receipt.PDF', ''))).toBe(true);
    // .jfif is a real jpeg by another name, and seven are already filed.
    expect(isAcceptableProof(file('download.jfif', ''))).toBe(true);
  });

  it('rejects an untyped file whose name promises nothing either', () => {
    // With no MIME type and no known extension there is nothing to go on, and
    // guessing would put arbitrary uploads in front of whoever reviews proofs.
    expect(isAcceptableProof(file('payment', ''))).toBe(false);
    expect(isAcceptableProof(file('notes.txt', ''))).toBe(false);
    expect(isAcceptableProof(file('archive.zip', ''))).toBe(false);
  });

  it('rejects a declared type outside the list, whatever the name says', () => {
    // A stated type is the browser's own answer and is trusted over the
    // extension — renaming a video to .png must not smuggle it through.
    expect(isAcceptableProof(file('clip.png', 'video/mp4'))).toBe(false);
    expect(isAcceptableProof(file('page.png', 'text/html'))).toBe(false);
  });

  it('keeps the size cap where the server enforces it', () => {
    // Asserted so the browser-side check and the route cannot drift apart into
    // an upload the uploader allows and the route refuses.
    expect(MAX_PROOF_BYTES).toBe(8 * 1024 * 1024);
  });
});
