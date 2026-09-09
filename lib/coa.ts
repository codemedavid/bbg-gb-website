// One stored certificate of analysis, resolved for the browser.
//
// The whole feature turns on the URL this builds. A COA is the document that
// says the batch was third-party tested — it is the reason a customer trusts
// what they are about to inject — so the link to it has to look like it came
// from BBG. signedUrl() (lib/storage.ts) would answer with an ik.imagekit.io URL
// under the production driver; siteFileUrl() answers with one of this site's own
// paths, and lib/file-url.ts is where the reasoning lives in full.
import { siteFileUrl } from '@/lib/file-url';
import { BUCKETS } from '@/lib/env';

export type CoaFileRow = {
  id: string;
  productId: string | null;
  batch: string | null;
  // The label an admin typed, or the uploaded file's own name when they typed
  // none. The column is called file_name because it predates this page, when a
  // COA was only ever the PDF attached to a product.
  fileName: string;
  storageKey: string;
  uploadedAt: Date | string;
};

// What the browser can render inline. Everything else — a scanned PDF, which is
// what the lab actually emails — gets a document tile instead of an <img> that
// would resolve to a broken image icon over the one document a customer came to
// read.
const IMAGE_EXT = /\.(jpe?g|png|webp|heic)$/i;
export const isImageKey = (key: string): boolean => IMAGE_EXT.test(key);

export function serializeCoaFile(row: CoaFileRow, productName: string | null = null) {
  return {
    id: row.id,
    label: row.fileName,
    batch: row.batch ?? null,
    productId: row.productId ?? null,
    productName,
    fileUrl: siteFileUrl(BUCKETS.coa, row.storageKey),
    isImage: isImageKey(row.storageKey),
    uploadedAt: new Date(row.uploadedAt).toISOString(),
  };
}
