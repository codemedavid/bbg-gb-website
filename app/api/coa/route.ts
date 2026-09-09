import { ok, handler } from '@/lib/api-response';
import { listCoaFiles } from '@/lib/coa-server';

// Public: the certificates shown on /coa. No session on purpose — the people who
// most need to read a lab result are the ones still deciding whether to join the
// batch, and they do not have an account yet.
export const GET = handler(async () => ok(await listCoaFiles()));
