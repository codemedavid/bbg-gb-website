// An HTTP status carried on a thrown Error, so a route handler can map a failure
// deep in a helper onto the right response instead of a blanket 500.
//
// Its own module, and not part of lib/session, because lib/session opens with
// `import 'server-only'` — a guard that is correct for session code and fatal
// for anything else that wants to throw one of these. lib/storage does, and it
// is also reached from tsx scripts and tests that never run inside a Next
// request, where 'server-only' does not resolve at all. Re-exported from
// lib/session so the many existing `from '@/lib/session'` imports keep working.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
