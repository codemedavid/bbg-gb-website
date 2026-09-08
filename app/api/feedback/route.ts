import { ok, handler } from '@/lib/api-response';
import { listFolders } from '@/lib/feedback-server';

// Public: the folders shown on /feedback, each with the count and cover of the
// screenshots a customer is allowed to see. No session — this is a storefront
// page, and the hide toggle is what controls what appears here.
export const GET = handler(async () => {
  const folders = await listFolders({ activeOnly: true });
  // isActive and sortOrder are admin bookkeeping; every folder here is active
  // by construction, so saying so again would only invite a client to filter.
  return ok(folders.map(({ isActive, sortOrder, ...f }) => f));
});
