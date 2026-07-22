// Server rejections from admin mutations must reach the admin's eyes. The
// payment-method, MOQ and campaign mutations already toast their onError; these
// five were silent — most damaging for deleteGroupBuy, whose 409 explains that
// a joined hatian must be cancelled instead of deleted, an explanation the
// admin never saw.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./api-client', () => ({
  apiGet: vi.fn(),
  apiSend: vi.fn(() => Promise.reject(new Error('Cancel the hatian instead.'))),
  qs: () => '',
}));

const { useMutate } = await import('./admin-api');
const { useToast } = await import('./store/toast');

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => useToast.getState().hide());

type Mutations = ReturnType<typeof useMutate>;
const cases: [keyof Mutations, (m: Mutations) => void][] = [
  ['saveGroupBuy', (m) => m.saveGroupBuy.mutate({ id: 'g1', claimedSlots: 15 })],
  ['deleteGroupBuy', (m) => m.deleteGroupBuy.mutate('g1')],
  ['setOrderStatus', (m) => m.setOrderStatus.mutate({ id: 'o1', status: 'cancelled' })],
  ['saveProduct', (m) => m.saveProduct.mutate({ id: 'p1', name: 'X' })],
  ['archiveProduct', (m) => m.archiveProduct.mutate('p1')],
];

describe('useMutate error surfacing', () => {
  for (const [name, fire] of cases) {
    it(`${String(name)}: a rejected call shows the server reason as a toast`, async () => {
      const { result } = renderHook(() => useMutate(), { wrapper });

      act(() => fire(result.current));

      await waitFor(() => expect(useToast.getState().message).toMatch(/cancel the hatian instead/i));
    });
  }
});
