// ImageKit.io storage client.
//
// Every file this website uploads lands under a single root folder (IMAGEKIT_ROOT)
// with one sub-folder per bucket, so the ImageKit dashboard shows at a glance which
// file is what:
//
//   /bbg-groupbuy/
//     ├── payment-proofs/   private  — bank-transfer screenshots (signed URLs only)
//     ├── payment-qr/       public   — checkout QR codes
//     └── coa-files/        public   — certificate-of-analysis documents
//
// The `key` handed in/out stays an opaque filename (e.g. `<uuid>.jpg`) exactly like
// the local/supabase drivers, so no call site or DB column changes.
import ImageKit, { toFile } from '@imagekit/nodejs';
import { env, BUCKETS, IMAGEKIT_ROOT } from './env';

let client: ImageKit | null = null;

function ik(): ImageKit {
  if (!client) {
    if (!env.imagekitPrivateKey || !env.imagekitUrlEndpoint) {
      throw new Error(
        'ImageKit storage selected but IMAGEKIT_PRIVATE_KEY / IMAGEKIT_URL_ENDPOINT are missing.',
      );
    }
    client = new ImageKit({ privateKey: env.imagekitPrivateKey });
  }
  return client;
}

// Absolute ImageKit folder for a bucket, e.g. `/bbg-groupbuy/payment-qr`.
export function folderFor(bucket: string): string {
  return `/${IMAGEKIT_ROOT}/${bucket}`;
}

function pathFor(bucket: string, key: string): string {
  return `${folderFor(bucket)}/${key}`;
}

// Payment proofs are sensitive (bank screenshots): store private, serve via
// short-lived signed URLs. QR codes and COA files are public CDN assets.
function isPrivate(bucket: string): boolean {
  return bucket === BUCKETS.proofs;
}

// Uploads bytes into the bucket's folder under the exact filename `key`,
// overwriting any existing object with the same key.
export async function uploadToImageKit(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ik().files.upload({
    file: await toFile(body, key, { type: contentType }),
    fileName: key,
    folder: folderFor(bucket),
    useUniqueFileName: false,
    overwriteFile: true,
    isPrivateFile: isPrivate(bucket),
  });
}

// Builds a delivery URL. Private buckets get a signed URL that expires; public
// buckets get a plain CDN URL.
export function imagekitUrl(bucket: string, key: string, expiresSec: number): string {
  const priv = isPrivate(bucket);
  return ik().helper.buildSrc({
    urlEndpoint: env.imagekitUrlEndpoint,
    src: pathFor(bucket, key),
    signed: priv,
    ...(priv ? { expiresIn: expiresSec } : {}),
  });
}

// Idempotently creates the site folder structure. Uploads auto-create folders too,
// but running this once makes the layout visible in the dashboard up front.
// `parentFolderPath` auto-creates the missing root folder as well.
export async function provisionImageKitFolders(): Promise<void> {
  const c = ik();
  for (const bucket of [BUCKETS.proofs, BUCKETS.qr, BUCKETS.coa]) {
    try {
      await c.folders.create({ folderName: bucket, parentFolderPath: `/${IMAGEKIT_ROOT}` });
    } catch (err) {
      // A pre-existing folder is fine; rethrow anything else.
      if (!(err instanceof Error) || !/exist/i.test(err.message)) throw err;
    }
  }
}
