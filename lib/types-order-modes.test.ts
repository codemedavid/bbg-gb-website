// The client-facing order types must admit every value the API really returns.
//
// These are compile-time assertions: `npx tsc --noEmit` covers test files, so a
// narrowed union fails the typecheck rather than waiting to surface as a wrong
// badge or a broken switch in the admin UI. Nothing here can fail at runtime —
// the guarantee is the compilation itself.
import { describe, it, expect } from 'vitest';
import { orderItemKindEnum, buyTypeEnum } from '@/lib/db/schema';
import type { Order, OrderItem } from '@/lib/types';

describe('order types cover every database value', () => {
  it('admits every buy_type the database can store', () => {
    // Fails to compile if Order['buyType'] is narrower than the enum.
    const all: Order['buyType'][] = ['solo', 'kahati', 'group_buy', 'moq'];
    expect([...all].sort()).toEqual([...buyTypeEnum.enumValues].sort());
  });

  it('admits every order_item_kind the database can store', () => {
    const all: OrderItem['kind'][] = ['product', 'group_buy', 'moq_campaign', 'moq_product'];
    expect([...all].sort()).toEqual([...orderItemKindEnum.enumValues].sort());
  });
});
