// The feedback serializers: stored rows in, client shapes out.
//
// The one thing only this layer can get wrong is the image. A feedback row
// stores an opaque storage key, exactly like a payment-method QR does, and the
// browser cannot render a key — so a folder whose cover never resolves to a URL
// is a gallery of broken tiles.
//
// The visibility rule deliberately does NOT live here. The serializer counts
// and covers exactly the items it is handed, and the route decides which items
// those are: the public one passes active items, the admin one passes all. That
// keeps "customers must not see hidden feedback" a property of a route test
// against a real database, rather than of a pure function nobody deploys.
import { describe, it, expect } from 'vitest';
import { serializeFeedbackFolder, serializeFeedbackItem } from './feedback';

const item = (over: Partial<Parameters<typeof serializeFeedbackItem>[0]> = {}) => ({
  id: 'item-1',
  folderId: 'folder-1',
  imageKey: 'abc-123.png',
  caption: null,
  customerName: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

const folder = (over: Partial<Parameters<typeof serializeFeedbackFolder>[0]> = {}) => ({
  id: 'folder-1',
  name: 'Batch 6 Reviews',
  description: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

describe('serializeFeedbackItem', () => {
  it('resolves the stored image key into a URL the browser can render', async () => {
    const out = await serializeFeedbackItem(item({ imageKey: 'shot-9.png' }));

    expect(out.imageUrl).toBe('/api/files/feedback/shot-9.png');
    // The raw key never reaches the client: it is a storage detail, and on the
    // private buckets it is the input to a signed URL.
    expect(out).not.toHaveProperty('imageKey');
  });

  it('carries the caption and customer name through', async () => {
    const out = await serializeFeedbackItem(item({
      caption: 'Sobrang bilis dumating!', customerName: 'Ate Jen, Cavite',
    }));

    expect(out.caption).toBe('Sobrang bilis dumating!');
    expect(out.customerName).toBe('Ate Jen, Cavite');
  });

  it('keeps an uncaptioned screenshot null rather than empty', async () => {
    const out = await serializeFeedbackItem(item());

    expect(out.caption).toBeNull();
    expect(out.customerName).toBeNull();
  });
});

describe('serializeFeedbackFolder', () => {
  it('counts the items it is given', async () => {
    const out = await serializeFeedbackFolder(folder(), [item({ id: 'a' }), item({ id: 'b' })]);

    expect(out.itemCount).toBe(2);
  });

  it('takes its cover from the first item, which the caller has already ordered', async () => {
    const out = await serializeFeedbackFolder(folder(), [
      item({ id: 'a', imageKey: 'first.png' }),
      item({ id: 'b', imageKey: 'second.png' }),
    ]);

    expect(out.coverUrl).toBe('/api/files/feedback/first.png');
  });

  it('has no cover and no count when the folder is empty', async () => {
    // A folder an admin has created but not filled yet. The storefront renders
    // it as an empty tile rather than crashing on a missing first element.
    const out = await serializeFeedbackFolder(folder(), []);

    expect(out.coverUrl).toBeNull();
    expect(out.itemCount).toBe(0);
  });

  it('carries the folder name, description and admin fields through', async () => {
    const out = await serializeFeedbackFolder(
      folder({ name: 'GLP-1 Feedback', description: 'Tirzepatide & Reta', isActive: false, sortOrder: 3 }),
      [],
    );

    expect(out.name).toBe('GLP-1 Feedback');
    expect(out.description).toBe('Tirzepatide & Reta');
    expect(out.isActive).toBe(false);
    expect(out.sortOrder).toBe(3);
  });
});
