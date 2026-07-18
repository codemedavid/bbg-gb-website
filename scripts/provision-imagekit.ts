// Creates the ImageKit folder structure for this website so the dashboard shows
// which file is what. Idempotent — safe to run repeatedly. Run once after adding
// the IMAGEKIT_* keys to .env:
//
//   npm run imagekit:setup
//
// Result in the ImageKit dashboard:
//   /bbg-groupbuy/payment-proofs   private  — bank-transfer screenshots
//   /bbg-groupbuy/payment-qr       public   — checkout QR codes
//   /bbg-groupbuy/coa-files        public   — certificate-of-analysis documents
import { env, IMAGEKIT_ROOT } from '../lib/env';
import { provisionImageKitFolders, folderFor } from '../lib/imagekit';

async function main(): Promise<void> {
  if (!env.imagekitPrivateKey || !env.imagekitUrlEndpoint) {
    throw new Error('Set IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT in .env first.');
  }
  await provisionImageKitFolders();
  const buckets = ['payment-proofs', 'payment-qr', 'coa-files'] as const;
  console.log(`ImageKit folders ready under /${IMAGEKIT_ROOT}:`);
  for (const b of buckets) console.log(`  ${folderFor(b)}`);
}

main().catch((err) => {
  console.error('ImageKit provisioning failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
