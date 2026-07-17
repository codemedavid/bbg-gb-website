import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/auth';
import { ok, handler } from '@/lib/api-response';

export const POST = handler(async () => {
  (await cookies()).delete(COOKIE_NAME);
  return ok({ loggedOut: true });
});
