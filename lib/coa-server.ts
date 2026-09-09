// Server-side read for the COA gallery, shared by the public list and the admin
// screen so the two can never disagree about what is published or in what order.
//
// There is deliberately no `activeOnly` here, unlike the feedback gallery. A COA
// has no hidden state: an admin who uploads one is publishing a lab result, and
// the way to unpublish it is to delete it. Half-published test results are worse
// than none — a hidden COA is a batch whose paperwork exists but cannot be
// produced, which is the situation this page was built to end.
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, coaFiles, products } from '@/lib/db';
import { serializeCoaFile } from '@/lib/coa';

// Newest first: the batch that just landed is the one people are deciding about.
// The label breaks ties, so two certificates uploaded in the same instant still
// come back in a stable order rather than whatever the database felt like.
const COA_ORDER = [desc(coaFiles.uploadedAt), asc(coaFiles.fileName)] as const;

// Every certificate, each with the name of the product it was filed against.
// LEFT joined: a COA may belong to no product at all — the lab sheet for a batch
// often arrives before the shelf row for it does.
export async function listCoaFiles() {
  const db = await getDb();
  const rows = await db.select({
    id: coaFiles.id,
    productId: coaFiles.productId,
    batch: coaFiles.batch,
    fileName: coaFiles.fileName,
    storageKey: coaFiles.storageKey,
    uploadedAt: coaFiles.uploadedAt,
    productName: products.name,
  })
    .from(coaFiles)
    .leftJoin(products, eq(coaFiles.productId, products.id))
    .orderBy(...COA_ORDER);

  return rows.map(({ productName, ...row }) => serializeCoaFile(row, productName));
}
