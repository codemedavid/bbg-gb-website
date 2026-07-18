import { randomUUID } from 'node:crypto';
import { putFile } from '@/lib/storage';
import { ApiError } from '@/lib/session';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = /^image\/(jpe?g|png|webp|heic)$/;

// Validates an uploaded image (e.g. a payment-method QR) and stores it in the
// given bucket, returning the storage key. Image-only — unlike payment proofs,
// QR codes are never PDFs.
export async function validateAndStoreImage(file: FormDataEntryValue | null, bucket: string): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'An image file is required.');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, 'Image must be 5MB or smaller.');
  if (!IMAGE_TYPES.test(file.type)) throw new ApiError(400, 'Image must be a JPG, PNG, WebP, or HEIC file.');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const key = `${randomUUID()}.${ext}`;
  await putFile(bucket, key, Buffer.from(await file.arrayBuffer()), file.type);
  return key;
}
