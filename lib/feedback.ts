import { siteFileUrl } from '@/lib/file-url';
import { BUCKETS } from '@/lib/env';

export type FeedbackItemRow = {
  id: string; folderId: string; imageKey: string;
  caption: string | null; customerName: string | null;
  isActive: boolean; sortOrder: number;
};

export type FeedbackFolderRow = {
  id: string; name: string; description: string | null;
  isActive: boolean; sortOrder: number;
};

// One uploaded screenshot, resolved for the browser. The storage key never
// leaves the server: it is a storage detail, and on the private buckets it is
// the input to a signed URL rather than something a client could use.
export async function serializeFeedbackItem(i: FeedbackItemRow) {
  return {
    id: i.id,
    folderId: i.folderId,
    imageUrl: siteFileUrl(BUCKETS.feedback, i.imageKey),
    caption: i.caption ?? null,
    customerName: i.customerName ?? null,
    isActive: i.isActive,
    sortOrder: i.sortOrder,
  };
}

// A folder plus the arithmetic the storefront tile needs: how many screenshots
// are in it, and which one to show on the front.
//
// It counts and covers exactly the items it is handed, and does no filtering of
// its own. That is deliberate: the public route passes active items and the
// admin route passes all of them, so "customers must not see hidden feedback"
// stays a property proven against a real database in the route tests, rather
// than a rule duplicated in a pure function.
//
// The caller also owns the ORDER, so the cover is simply the first item — the
// same `sortOrder, createdAt` the gallery itself will render in, which means
// the tile can never advertise a screenshot that appears somewhere else in the
// folder than first.
export async function serializeFeedbackFolder(f: FeedbackFolderRow, items: FeedbackItemRow[]) {
  const [cover] = items;
  return {
    id: f.id,
    name: f.name,
    description: f.description ?? null,
    itemCount: items.length,
    coverUrl: cover ? siteFileUrl(BUCKETS.feedback, cover.imageKey) : null,
    isActive: f.isActive,
    sortOrder: f.sortOrder,
  };
}
