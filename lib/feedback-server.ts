// Server-side reads for the feedback gallery, shared by the admin and public
// routes so the two can never disagree about ordering.
//
// The ONE thing these functions exist to centralise is the visibility rule.
// `activeOnly` is not a convenience flag: it is the difference between what an
// admin manages and what a customer is allowed to see, and getting it wrong
// means publishing a screenshot somebody deliberately pulled. Keeping both
// reads here means the rule is written twice in one file instead of four times
// across four routes.
import { and, asc, eq } from 'drizzle-orm';
import { getDb, feedbackFolders, feedbackItems } from '@/lib/db';
import { serializeFeedbackFolder, serializeFeedbackItem } from '@/lib/feedback';

// Admin sort order first, then insertion order — the same tiebreak the payment
// methods and the MOQ shelf use, so an admin who never touches sortOrder still
// gets a stable list rather than whatever the database felt like returning.
const FOLDER_ORDER = [asc(feedbackFolders.sortOrder), asc(feedbackFolders.createdAt)] as const;
const ITEM_ORDER = [asc(feedbackItems.sortOrder), asc(feedbackItems.createdAt)] as const;

// Every folder, each with its item count and cover.
//
// Reads all the items once and groups them in memory rather than issuing a
// count query per folder. This is a hand-curated gallery — tens of rows, not
// thousands — so the N+1 is the only version of this worth avoiding.
export async function listFolders({ activeOnly }: { activeOnly: boolean }) {
  const db = await getDb();

  const folders = await db.select().from(feedbackFolders)
    .where(activeOnly ? eq(feedbackFolders.isActive, true) : undefined)
    .orderBy(...FOLDER_ORDER);

  const items = await db.select().from(feedbackItems)
    .where(activeOnly ? eq(feedbackItems.isActive, true) : undefined)
    .orderBy(...ITEM_ORDER);

  const byFolder = new Map<string, typeof items>();
  for (const item of items) {
    byFolder.set(item.folderId, [...(byFolder.get(item.folderId) ?? []), item]);
  }

  return Promise.all(folders.map((f) => serializeFeedbackFolder(f, byFolder.get(f.id) ?? [])));
}

// One folder and everything filed in it, or null when it does not exist — or,
// under activeOnly, when it is hidden. A hidden folder reads as absent on
// purpose: its URL must not survive the toggle that took it off the storefront.
export async function getFolderWithItems(id: string, { activeOnly }: { activeOnly: boolean }) {
  const db = await getDb();

  const [folder] = await db.select().from(feedbackFolders)
    .where(activeOnly
      ? and(eq(feedbackFolders.id, id), eq(feedbackFolders.isActive, true))
      : eq(feedbackFolders.id, id));
  if (!folder) return null;

  const items = await db.select().from(feedbackItems)
    .where(activeOnly
      ? and(eq(feedbackItems.folderId, id), eq(feedbackItems.isActive, true))
      : eq(feedbackItems.folderId, id))
    .orderBy(...ITEM_ORDER);

  return {
    ...(await serializeFeedbackFolder(folder, items)),
    items: await Promise.all(items.map(serializeFeedbackItem)),
  };
}
