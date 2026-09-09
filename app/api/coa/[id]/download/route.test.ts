// Downloading a COA must not hand the customer off to a storage host.
//
// The route redirected to signedUrl(), which under the production ImageKit
// driver is an ik.imagekit.io URL — so tapping "Download COA" navigated a
// customer off bbgph.org. A certificate of analysis is the document that says
// the batch was third-party tested; a link to it has to look like it came from
// us.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, storageDriver: 'imagekit' } };
});

const { GET } = await import('./route');
const { getDb, coaFiles } = await import('@/lib/db');
const { resetDb, makeProduct } = await import('@/lib/test/harness');

beforeEach(async () => { await resetDb(); });

const seedCoa = async () => {
  const product = await makeProduct({});
  const db = await getDb();
  const [row] = await db.insert(coaFiles).values({
    productId: product.id, batch: 'B7', fileName: 'batch-7.pdf', storageKey: 'coa/batch-7.pdf',
  }).returning();
  return row;
};

const download = async (id: string) =>
  GET(new Request('http://localhost/api/coa/' + id + '/download'), {
    params: Promise.resolve({ id }),
  });

describe('GET /api/coa/[id]/download', () => {
  it('keeps the customer on this site', async () => {
    const coa = await seedCoa();

    const res = await download(coa.id);
    const location = res.headers.get('Location') ?? '';

    expect(location).not.toMatch(/imagekit/i);
    expect(new URL(location, 'http://localhost').pathname)
      .toBe('/api/files/coa-files/coa/batch-7.pdf');
  });

  it('still says so plainly when a batch has no COA yet', async () => {
    const res = await download('00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
  });
});
