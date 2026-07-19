// Storage adapter: 'local' writes to ./uploads (dev); 'supabase' uses Storage buckets (prod).
// Payment proofs are private; COA files are served through signed URLs too.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, BUCKETS } from './env';
import { describeDriverProblem } from './storage-driver';
import { ApiError } from './session';
import { uploadToImageKit, imagekitUrl, provisionImageKitFolders } from './imagekit';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

let supa: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!supa) {
    if (!env.supabaseUrl || !env.supabaseServiceKey) {
      throw new Error('Supabase storage selected but SUPABASE_URL / SUPABASE_SERVICE_KEY are missing.');
    }
    supa = createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
  }
  return supa;
}

// Idempotently ensure storage containers exist (called at startup).
export async function ensureBuckets(): Promise<void> {
  if (env.storageDriver === 'imagekit') {
    await provisionImageKitFolders();
    return;
  }
  if (env.storageDriver !== 'supabase') return;
  const client = supabase();
  for (const bucket of [BUCKETS.proofs, BUCKETS.coa, BUCKETS.qr]) {
    await ensureBucket(client, bucket);
  }
}

// Lazily create a single private bucket on first use, memoized per process. Startup
// hooks don't run reliably on serverless, so uploads self-provision their bucket here.
const ensuredBuckets = new Set<string>();
async function ensureBucket(client: SupabaseClient, bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;
  const { data } = await client.storage.getBucket(bucket);
  if (!data) {
    const { error } = await client.storage.createBucket(bucket, { public: false });
    // Tolerate the race where a concurrent request created it first.
    if (error && !/exist/i.test(error.message)) throw error;
  }
  ensuredBuckets.add(bucket);
}

export type StoredFile = { key: string };

export async function putFile(bucket: string, key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  // Catch a misconfigured backend here rather than letting it surface as an
  // EROFS deep inside fs.writeFile, which reached admins as "Something went wrong".
  const problem = describeDriverProblem(env.storageDriver, env.isProd);
  if (problem) throw new ApiError(503, problem);

  if (env.storageDriver === 'imagekit') {
    await uploadToImageKit(bucket, key, body, contentType);
    return { key };
  }
  if (env.storageDriver === 'supabase') {
    const client = supabase();
    await ensureBucket(client, bucket);
    const { error } = await client.storage.from(bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw error;
    return { key };
  }
  const dest = path.join(UPLOAD_DIR, bucket, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body);
  return { key };
}

// Returns a time-limited URL (supabase) or a local API path (dev).
export async function signedUrl(bucket: string, key: string, expiresSec = 3600): Promise<string> {
  if (env.storageDriver === 'imagekit') {
    return imagekitUrl(bucket, key, expiresSec);
  }
  if (env.storageDriver === 'supabase') {
    const { data, error } = await supabase().storage.from(bucket).createSignedUrl(key, expiresSec);
    if (error) throw error;
    return data.signedUrl;
  }
  return `/api/files/${bucket}/${key}`;
}

export async function readLocal(bucket: string, key: string): Promise<Buffer> {
  const src = path.join(UPLOAD_DIR, bucket, key);
  return fs.readFile(src);
}

export { UPLOAD_DIR };
