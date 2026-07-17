// Storage adapter: 'local' writes to ./uploads (dev); 'supabase' uses Storage buckets (prod).
// Payment proofs are private; COA files are served through signed URLs too.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, BUCKETS } from './env';

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

// Idempotently ensure both buckets exist (called at startup when driver=supabase).
export async function ensureBuckets(): Promise<void> {
  if (env.storageDriver !== 'supabase') return;
  const client = supabase();
  for (const bucket of [BUCKETS.proofs, BUCKETS.coa]) {
    const { data } = await client.storage.getBucket(bucket);
    if (!data) await client.storage.createBucket(bucket, { public: false });
  }
}

export type StoredFile = { key: string };

export async function putFile(bucket: string, key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  if (env.storageDriver === 'supabase') {
    const { error } = await supabase().storage.from(bucket).upload(key, body, { contentType, upsert: true });
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
