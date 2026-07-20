// The admin MOQ product form's payload.
//
// Extracted from the admin page so the contract test can post the exact body the
// screen sends, rather than restating it. Restating a payload in a test is what
// let the cart/checkout kinds drift apart while both suites stayed green — a
// PATCH that silently drops a field does not error, it just fails to save.
import type { MoqProduct } from '@/lib/types';

export type MoqDraft = {
  id?: string;
  name: string;
  spec: string;
  description: string;
  pricePhp: string;
  stock: string;
  minOrderQty: string;
  packingFeePhp: string;
  imageEmoji: string;
  sortOrder: string;
  isActive: boolean;
};

export const emptyMoqDraft: MoqDraft = {
  name: '', spec: '', description: '', pricePhp: '0', stock: '0', minOrderQty: '1',
  packingFeePhp: '', imageEmoji: '📦', sortOrder: '0', isActive: true,
};

// Prefills the form from an existing product.
export const moqDraftFrom = (p: MoqProduct): MoqDraft => ({
  id: p.id,
  name: p.name,
  spec: p.spec,
  description: p.description ?? '',
  pricePhp: p.pricePhp,
  stock: String(p.stock),
  minOrderQty: String(p.minOrderQty),
  packingFeePhp: p.packingFeePhp ?? '',
  imageEmoji: p.imageEmoji ?? '📦',
  sortOrder: String(p.sortOrder),
  isActive: p.isActive,
});

// Builds the multipart body for POST/PATCH /api/admin/moq-products.
// Field names here are the wire contract with lib/admin-schemas.parseMoqProductForm.
export function moqProductFormData(draft: MoqDraft, image: File | null): FormData {
  const body = new FormData();
  body.set('name', draft.name);
  body.set('spec', draft.spec);
  body.set('description', draft.description);
  body.set('pricePhp', draft.pricePhp || '0');
  body.set('stock', draft.stock || '0');
  body.set('minOrderQty', draft.minOrderQty || '1');
  // Blank means "use the global MOQ packing fee", so the field is omitted
  // entirely. Sending '0' would price the packing fee as genuinely free.
  if (draft.packingFeePhp !== '') body.set('packingFeePhp', draft.packingFeePhp);
  body.set('imageEmoji', draft.imageEmoji);
  body.set('sortOrder', draft.sortOrder || '0');
  body.set('isActive', String(draft.isActive));
  // Omitting the image part is what tells the server to keep the current image.
  if (image) body.set('image', image);
  return body;
}
