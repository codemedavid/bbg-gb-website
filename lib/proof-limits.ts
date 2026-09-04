// What a payment proof may be — shared by the browser and the server.
//
// Deliberately import-free. lib/proof.ts does the validating and storing, which
// needs ApiError from lib/session.ts, and that module is `server-only`; a client
// component reaching for MAX_PROOFS through it drags the whole server session
// module into the browser bundle and the build fails on it.
//
// The same split as lib/product-channels.ts (pure, client-safe) against
// lib/channel-guard.ts (touches the database): the rule is shared, the
// machinery around it is not.
//
// Nothing here is enforcement. lib/proof.ts re-exports these and applies them
// on the server, because a limit the browser respects is a courtesy and a limit
// the route applies is a rule.

// How many proofs one order or settlement may carry.
//
// Banks cap a single transfer, so a ₱4,500 order is often paid in three: the
// customer ends up with three screenshots and, before this, one slot. Five is
// the client's number and it is generous — it exists so nobody has to choose
// which of their own payments to leave unevidenced.
export const MAX_PROOFS = 5;

export const MAX_PROOF_BYTES = 8 * 1024 * 1024;

// What the browser may call a payment proof.
//
// Wider than it looks it needs to be, on purpose: the uploader offers
// `accept="image/*,application/pdf"`, so anything narrower refuses a file the
// customer was invited to pick, with a message ("must be an image or PDF") that
// makes no sense about an image. heif is Safari's other spelling of heic; avif,
// gif and bmp are what various Android screenshot and share paths emit; image/jpg
// is not a registered type but several pickers send it anyway.
export const PROOF_TYPES = /^(image\/(jpe?g|png|webp|heic|heif|gif|bmp|avif)|application\/pdf)$/;

// The same list by file name, for when the browser reports no type at all.
// Files picked through some Android file managers arrive with an empty `type`,
// and matching that against the list above refuses every one of them however
// ordinary the file is. jfif is a jpeg under another extension — seven are
// already filed against real orders.
export const PROOF_EXTENSIONS = /\.(jpe?g|jfif|png|webp|heic|heif|gif|bmp|avif|pdf)$/i;

/**
 * Whether this file may be attached as a payment proof.
 *
 * A stated type is the browser's own answer and settles it either way — a video
 * renamed to .png is still refused. The extension is consulted only when there
 * is no type to consult, which is the one case that was failing customers; a
 * file with neither is refused, because guessing would put arbitrary uploads in
 * front of whoever reviews proofs.
 */
export function isAcceptableProof(file: { name: string; type: string }): boolean {
  const type = file.type.trim().toLowerCase();
  if (type) return PROOF_TYPES.test(type);
  return PROOF_EXTENSIONS.test(file.name);
}
