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

export const PROOF_TYPES = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/;
