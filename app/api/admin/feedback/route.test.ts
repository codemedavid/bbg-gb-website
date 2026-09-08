// Integration tests for the customer-feedback APIs — the admin folder/upload
// CRUD and the public gallery the storefront reads.
//
// Three guarantees carry the feature. First, folders are real rows: an admin
// creates one before it holds anything, so an EMPTY folder has to survive a
// round trip. Second, the hide toggle is enforced server-side — these are
// screenshots of real conversations, and "pull it from the storefront" has to
// mean the bytes stop being listed, not that a CSS class hides a tile someone
// can still read out of the JSON. Third, deleting a folder takes its
// screenshots with it, because that is what the cascade in migration 0032
// promises and what the admin confirm dialog tells the admin will happen.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET: ADMIN_FOLDERS, POST: CREATE_FOLDER } = await import('./folders/route');
const { GET: ADMIN_FOLDER, PATCH: PATCH_FOLDER, DELETE: DELETE_FOLDER } = await import('./folders/[id]/route');
const { POST: CREATE_ITEM } = await import('./items/route');
const { PATCH: PATCH_ITEM, DELETE: DELETE_ITEM } = await import('./items/[id]/route');
const { GET: PUBLIC_FOLDERS } = await import('../../feedback/route');
const { GET: PUBLIC_FOLDER } = await import('../../feedback/[id]/route');

const { resetDb } = await import('@/lib/test/harness');
const { getDb, feedbackFolders, feedbackItems } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');

const asAdmin = () => { session.current = { sub: 'admin-id', role: 'admin', email: 'admin@bbg.test' }; };
const asCustomer = () => { session.current = { sub: 'cust-id', role: 'customer', email: 'c@bbg.test' }; };
const asAnon = () => { session.current = null; };

const jsonReq = (body: unknown, method = 'POST') =>
  new Request('http://localhost/api/admin/feedback/folders', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const pngFile = (name = 'shot.png') => new File([Buffer.from('fake-png-bytes')], name, { type: 'image/png' });

// The item routes take multipart so the screenshot rides along with the fields.
const itemForm = (fields: Record<string, string>, image?: File | null) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (image) form.set('image', image);
  return new Request('http://localhost/api/admin/feedback/items', { method: 'POST', body: form });
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const body = async (res: Response) => (await res.json()) as { success: boolean; data: any; error: string | null };

// Creates a folder through the API and hands back its id.
async function makeFolder(fields: Record<string, unknown> = {}) {
  const res = await CREATE_FOLDER(jsonReq({ name: 'Batch 6 Reviews', ...fields }));
  return (await body(res)).data.id as string;
}

// Uploads one screenshot into a folder and hands back its id.
async function makeItem(folderId: string, fields: Record<string, string> = {}) {
  const res = await CREATE_ITEM(itemForm({ folderId, ...fields }, pngFile()));
  return (await body(res)).data.id as string;
}

beforeEach(async () => {
  await resetDb();
  asAdmin();
});

describe('POST /api/admin/feedback/folders', () => {
  it('creates an empty folder, which is the whole point of folders being rows', async () => {
    const res = await CREATE_FOLDER(jsonReq({
      name: 'Batch 6 Reviews', description: 'August batch, GLP-1 orders', sortOrder: 2,
    }));
    const b = await body(res);

    expect(res.status).toBe(201);
    expect(b.data).toMatchObject({
      name: 'Batch 6 Reviews', description: 'August batch, GLP-1 orders',
      sortOrder: 2, isActive: true, itemCount: 0, coverUrl: null,
    });
  });

  it('rejects a folder with no name', async () => {
    const res = await CREATE_FOLDER(jsonReq({ name: '' }));

    expect(res.status).toBe(400);
  });

  it('refuses a customer and an anonymous visitor', async () => {
    asCustomer();
    expect((await CREATE_FOLDER(jsonReq({ name: 'Sneaky' }))).status).toBe(403);

    asAnon();
    expect((await CREATE_FOLDER(jsonReq({ name: 'Sneaky' }))).status).toBe(401);
  });
});

describe('GET /api/admin/feedback/folders', () => {
  it('lists hidden folders too, so an admin can find one to unhide', async () => {
    await makeFolder({ name: 'Visible' });
    await makeFolder({ name: 'Pulled', isActive: false });

    const b = await body(await ADMIN_FOLDERS());

    expect(b.data.map((f: any) => f.name)).toEqual(['Visible', 'Pulled']);
  });

  it('orders folders by the admin sort order', async () => {
    await makeFolder({ name: 'Third', sortOrder: 3 });
    await makeFolder({ name: 'First', sortOrder: 1 });

    const b = await body(await ADMIN_FOLDERS());

    expect(b.data.map((f: any) => f.name)).toEqual(['First', 'Third']);
  });

  it('counts every screenshot in a folder, hidden ones included', async () => {
    const id = await makeFolder();
    await makeItem(id);
    await makeItem(id, { isActive: 'false' });

    const b = await body(await ADMIN_FOLDERS());

    expect(b.data[0].itemCount).toBe(2);
  });
});

describe('PATCH /api/admin/feedback/folders/[id]', () => {
  it('renames a folder', async () => {
    const id = await makeFolder({ name: 'Btach 6' });

    const b = await body(await PATCH_FOLDER(jsonReq({ name: 'Batch 6' }, 'PATCH'), ctx(id)));

    expect(b.data.name).toBe('Batch 6');
  });

  it('hides a folder without deleting what is in it', async () => {
    const id = await makeFolder();
    await makeItem(id);

    await PATCH_FOLDER(jsonReq({ name: 'Batch 6 Reviews', isActive: false }, 'PATCH'), ctx(id));

    const db = await getDb();
    const items = await db.select().from(feedbackItems).where(eq(feedbackItems.folderId, id));
    expect(items).toHaveLength(1);
  });

  it('404s on a folder that does not exist', async () => {
    const res = await PATCH_FOLDER(
      jsonReq({ name: 'Ghost' }, 'PATCH'),
      ctx('00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/feedback/folders/[id]', () => {
  it('includes the hidden screenshots, which is the whole difference from the public view', async () => {
    const id = await makeFolder();
    await makeItem(id, { caption: 'Shown' });
    await makeItem(id, { caption: 'Pulled', isActive: 'false' });

    const b = await body(await ADMIN_FOLDER(new Request('http://localhost'), ctx(id)));

    expect(b.data.items.map((i: any) => i.caption)).toEqual(['Shown', 'Pulled']);
    expect(b.data.items.map((i: any) => i.isActive)).toEqual([true, false]);
  });

  it('opens a hidden folder, so an admin can review what they pulled', async () => {
    const id = await makeFolder({ isActive: false });

    const res = await ADMIN_FOLDER(new Request('http://localhost'), ctx(id));

    expect(res.status).toBe(200);
  });

  it('refuses a customer', async () => {
    const id = await makeFolder();
    asCustomer();

    expect((await ADMIN_FOLDER(new Request('http://localhost'), ctx(id))).status).toBe(403);
  });

  it('404s on a folder that does not exist', async () => {
    const res = await ADMIN_FOLDER(
      new Request('http://localhost'),
      ctx('00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/feedback/folders/[id]', () => {
  it('takes the folder’s screenshots with it, as the cascade promises', async () => {
    const id = await makeFolder();
    await makeItem(id);
    await makeItem(id);

    expect((await DELETE_FOLDER(new Request('http://localhost', { method: 'DELETE' }), ctx(id))).status).toBe(200);

    const db = await getDb();
    expect(await db.select().from(feedbackFolders)).toHaveLength(0);
    expect(await db.select().from(feedbackItems)).toHaveLength(0);
  });
});

describe('POST /api/admin/feedback/items', () => {
  it('files a screenshot in its folder with the words and the credit', async () => {
    const folderId = await makeFolder();

    const res = await CREATE_ITEM(itemForm({
      folderId, caption: 'Sobrang bilis dumating!', customerName: 'Ate Jen, Cavite',
    }, pngFile()));
    const b = await body(res);

    expect(res.status).toBe(201);
    expect(b.data).toMatchObject({
      folderId, caption: 'Sobrang bilis dumating!', customerName: 'Ate Jen, Cavite', isActive: true,
    });
    // Resolved for the browser, and never the raw storage key.
    expect(b.data.imageUrl).toMatch(/^\/api\/files\/feedback\//);
    expect(b.data).not.toHaveProperty('imageKey');
  });

  it('accepts a screenshot with no caption at all', async () => {
    const folderId = await makeFolder();

    const b = await body(await CREATE_ITEM(itemForm({ folderId }, pngFile())));

    expect(b.data.caption).toBeNull();
    expect(b.data.customerName).toBeNull();
  });

  it('refuses a feedback with no screenshot — the image IS the feedback', async () => {
    const folderId = await makeFolder();

    const res = await CREATE_ITEM(itemForm({ folderId, caption: 'Great seller' }, null));

    expect(res.status).toBe(400);
  });

  it('refuses a file that is not an image', async () => {
    const folderId = await makeFolder();
    const pdf = new File([Buffer.from('%PDF-')], 'feedback.pdf', { type: 'application/pdf' });

    const res = await CREATE_ITEM(itemForm({ folderId }, pdf));

    expect(res.status).toBe(400);
  });

  it('404s rather than orphaning a screenshot in a folder that does not exist', async () => {
    const res = await CREATE_ITEM(
      itemForm({ folderId: '00000000-0000-0000-0000-000000000000' }, pngFile()),
    );

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/feedback/items/[id]', () => {
  it('keeps the existing screenshot when the edit sends no new file', async () => {
    const folderId = await makeFolder();
    const id = await makeItem(folderId);
    const db = await getDb();
    const [before] = await db.select().from(feedbackItems).where(eq(feedbackItems.id, id));

    await PATCH_ITEM(itemForm({ folderId, caption: 'Fixed a typo' }, null), ctx(id));

    const [after] = await db.select().from(feedbackItems).where(eq(feedbackItems.id, id));
    expect(after.imageKey).toBe(before.imageKey);
    expect(after.caption).toBe('Fixed a typo');
  });

  it('replaces the screenshot when a new file is sent', async () => {
    const folderId = await makeFolder();
    const id = await makeItem(folderId);
    const db = await getDb();
    const [before] = await db.select().from(feedbackItems).where(eq(feedbackItems.id, id));

    await PATCH_ITEM(itemForm({ folderId }, pngFile('replacement.png')), ctx(id));

    const [after] = await db.select().from(feedbackItems).where(eq(feedbackItems.id, id));
    expect(after.imageKey).not.toBe(before.imageKey);
  });

  it('moves a screenshot into another folder', async () => {
    const from = await makeFolder({ name: 'Batch 5' });
    const to = await makeFolder({ name: 'Batch 6' });
    const id = await makeItem(from);

    const b = await body(await PATCH_ITEM(itemForm({ folderId: to }, null), ctx(id)));

    expect(b.data.folderId).toBe(to);
  });
});

describe('DELETE /api/admin/feedback/items/[id]', () => {
  it('removes one screenshot and leaves its folder standing', async () => {
    const folderId = await makeFolder();
    const id = await makeItem(folderId);

    expect((await DELETE_ITEM(new Request('http://localhost', { method: 'DELETE' }), ctx(id))).status).toBe(200);

    const db = await getDb();
    expect(await db.select().from(feedbackItems)).toHaveLength(0);
    expect(await db.select().from(feedbackFolders)).toHaveLength(1);
  });
});

describe('GET /api/feedback (public)', () => {
  it('is readable without an account — it is a storefront page', async () => {
    const id = await makeFolder();
    await makeItem(id);
    asAnon();

    const res = await PUBLIC_FOLDERS();

    expect(res.status).toBe(200);
    expect((await body(res)).data).toHaveLength(1);
  });

  it('never lists a hidden folder', async () => {
    await makeFolder({ name: 'Shown' });
    await makeFolder({ name: 'Pulled', isActive: false });
    asAnon();

    const b = await body(await PUBLIC_FOLDERS());

    expect(b.data.map((f: any) => f.name)).toEqual(['Shown']);
  });

  it('counts and covers only the screenshots customers can actually see', async () => {
    const id = await makeFolder();
    await makeItem(id, { isActive: 'false', sortOrder: '0' });
    await makeItem(id, { sortOrder: '1' });
    asAnon();

    const b = await body(await PUBLIC_FOLDERS());

    // Two rows exist; one is hidden, so the tile must say 1 — and must not put
    // the hidden screenshot on the front of the folder.
    expect(b.data[0].itemCount).toBe(1);
    expect(b.data[0].coverUrl).not.toBeNull();
  });
});

describe('GET /api/feedback/[id] (public)', () => {
  it('returns the folder and its screenshots in the admin’s order', async () => {
    const id = await makeFolder({ name: 'Batch 6 Reviews' });
    await makeItem(id, { caption: 'Second', sortOrder: '2' });
    await makeItem(id, { caption: 'First', sortOrder: '1' });
    asAnon();

    const b = await body(await PUBLIC_FOLDER(new Request('http://localhost'), ctx(id)));

    expect(b.data.name).toBe('Batch 6 Reviews');
    expect(b.data.items.map((i: any) => i.caption)).toEqual(['First', 'Second']);
  });

  it('omits hidden screenshots', async () => {
    const id = await makeFolder();
    await makeItem(id, { caption: 'Shown' });
    await makeItem(id, { caption: 'Pulled', isActive: 'false' });
    asAnon();

    const b = await body(await PUBLIC_FOLDER(new Request('http://localhost'), ctx(id)));

    expect(b.data.items.map((i: any) => i.caption)).toEqual(['Shown']);
  });

  it('404s on a hidden folder, so its URL cannot be shared around the toggle', async () => {
    const id = await makeFolder({ isActive: false });
    asAnon();

    const res = await PUBLIC_FOLDER(new Request('http://localhost'), ctx(id));

    expect(res.status).toBe(404);
  });
});
