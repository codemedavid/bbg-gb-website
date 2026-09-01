import { and, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, emailLog } from '@/lib/db';

// Admin → Emails. The only place in the product where the delivery of a
// notification can be seen.
//
// This project has no Vercel log access, so the console.error a failed send
// writes goes to nobody. That is why 144 undelivered password resets between
// 2026-08-17 and 2026-08-31 produced no signal anywhere a human would look.

// Enough to read an incident, small enough to stay one query.
const LIMIT = 200;

const query = z.object({
  status: z.string().max(20).optional(),
  kind: z.string().max(60).optional(),
  search: z.string().max(200).optional(),
});

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const q = query.parse({
    status: searchParams.get('status') || undefined,
    kind: searchParams.get('kind') || undefined,
    search: searchParams.get('search') || undefined,
  });

  const where: SQL[] = [];
  if (q.status) where.push(eq(emailLog.status, q.status));
  if (q.kind) where.push(eq(emailLog.kind, q.kind));
  if (q.search) where.push(ilike(emailLog.toEmail, `%${q.search}%`));

  const db = await getDb();
  // `body` is deliberately not selected. For a password_reset it is the rendered
  // mail, which contains a live single-use token — an admin list is no place to
  // hand those out. This screen answers "did it arrive", not "what did it say".
  return ok(
    await db.select({
      id: emailLog.id,
      toEmail: emailLog.toEmail,
      subject: emailLog.subject,
      kind: emailLog.kind,
      deliveredBy: emailLog.deliveredBy,
      status: emailLog.status,
      error: emailLog.error,
      sentAt: emailLog.sentAt,
    })
      .from(emailLog)
      .where(where.length ? and(...where) : undefined)
      // Newest first: an outage is read from the top.
      .orderBy(desc(emailLog.sentAt))
      .limit(LIMIT),
  );
});
