// The route that keeps a file on this site.
//
// Two things stopped it serving the public galleries. It reads LOCAL DISK only,
// so under the production ImageKit driver it 404s on every file; and it demands
// a session, because it was written for payment proofs. A logged-out visitor
// looking at reviews or a COA is the normal case, not an intrusion.
//
// Opening it up is the part worth testing hardest: proofs are screenshots of
// people's bank apps and they live behind the same route.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { current: null as { sub: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    requireSession: async () => {
      if (!session.current) throw new ApiError(401, 'Authentication required.');
      return session.current;
    },
  };
});

const readFile = vi.fn<(bucket: string, key: string) => Promise<Buffer>>();
vi.mock('@/lib/storage', () => ({
  readFile: (bucket: string, key: string) => readFile(bucket, key),
  readLocal: (bucket: string, key: string) => readFile(bucket, key),
}));

const { GET } = await import('./route');

const get = (bucket: string, key: string[]) =>
  GET(new Request(`http://localhost/api/files/${bucket}/${key.join('/')}`), {
    params: Promise.resolve({ bucket, key }),
  });

beforeEach(() => {
  session.current = null;
  readFile.mockReset();
  readFile.mockResolvedValue(Buffer.from('file-bytes'));
});

describe('public galleries', () => {
  it('serves a review image to a visitor who is not logged in', async () => {
    const res = await get('feedback', ['abc-123.png']);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(await res.text()).toBe('file-bytes');
  });

  it('serves a COA to a visitor who is not logged in', async () => {
    const res = await get('coa-files', ['batch-7.pdf']);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  // Reads through the storage driver, not off local disk — production stores
  // these in ImageKit, where readLocal finds nothing.
  it('reads through the storage driver', async () => {
    await get('feedback', ['nested', 'abc-123.png']);

    expect(readFile).toHaveBeenCalledWith('feedback', 'nested/abc-123.png');
  });
});

describe('private files stay private', () => {
  it('refuses a payment proof to a visitor who is not logged in', async () => {
    const res = await get('payment-proofs', ['ana.png']);

    expect(res.status).toBe(401);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('serves that same proof once there is a session', async () => {
    session.current = { sub: 'u1' };

    const res = await get('payment-proofs', ['ana.png']);

    expect(res.status).toBe(200);
  });

  it('refuses a bucket nobody published', async () => {
    const res = await get('payment-qr', ['gotyme.png']);

    expect(res.status).toBe(401);
  });
});

describe('when the file is not there', () => {
  // A storage miss is a missing file, not a broken server. It must not surface
  // to a customer scrolling a gallery as "Something went wrong."
  it('answers 404 rather than failing', async () => {
    readFile.mockRejectedValue(new Error('Storage returned 404'));

    const res = await get('feedback', ['gone.png']);

    expect(res.status).toBe(404);
  });
});

describe('path safety', () => {
  it('refuses a traversal attempt even on a public bucket', async () => {
    const res = await get('feedback', ['..', '..', '.env']);

    expect(res.status).toBe(400);
    expect(readFile).not.toHaveBeenCalled();
  });
});
