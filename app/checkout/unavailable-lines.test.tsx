// The checkout page, handed a refusal that names several dead cart lines.
//
// Reported 2026-09-14: the customer's Reta SF 20mg vanished from her cart after
// a checkout that "hung", and it kept happening. The page used to drop ONE line
// per failed attempt and say so in a toast that disappears after 2.2 seconds, so
// what she saw was items silently going missing and an order that never landed.
//
// Asserted here: every line the server names is removed at once, the
// explanation stays on the screen, and the proof she already attached stays
// attached so the retry is one tap rather than a fresh upload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart, type CartItem } from '@/lib/store/cart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567', address: '123 Mabini St' },
    loading: false,
  }),
}));
vi.mock('@/lib/queries', () => ({
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true }),
  usePaymentMethods: () => ({
    data: [{ id: 'pm1', label: 'GCash', accountName: 'BBG', accountNumber: '0917', qrUrl: null }],
  }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiCommitments: () => ({ data: undefined }),
  useCyclePackingFeePaid: () => ({ data: false }),
}));

const CheckoutPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const kahati: CartItem = {
  key: 'gb:old-reta-sf-20', kind: 'group_buy', refId: 'old-reta-sf-20',
  name: 'Retatrutide (Salt Form) 20mg vial — kahati', spec: 'Kahati · min 1 vials',
  unitPricePhp: 750, qty: 1, minQty: 1,
};
const batch: CartItem = {
  key: 'gbuy:old-reta-10', kind: 'moq_campaign', refId: 'old-reta-10',
  name: 'Retatrutide 10mg vial — group buy', spec: 'Group buy · batch #2',
  unitPricePhp: 4375, qty: 1, minQty: 1,
};
const onHand: CartItem = {
  key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
  spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100,
};

const refusal = {
  ok: false,
  status: 400,
  json: async () => ({
    success: false,
    error: 'Group buy not found: old-reta-sf-20',
    data: {
      unavailable: [
        { refId: 'old-reta-sf-20', kind: 'group_buy', name: 'Retatrutide (Salt Form) 20mg vial' },
        { refId: 'old-reta-10', kind: 'moq_campaign', name: 'Retatrutide 10mg vial' },
      ],
    },
  }),
};

const attachProof = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([Buffer.from('proof')], 'proof.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

async function placeAgainstRefusal() {
  vi.stubGlobal('fetch', vi.fn(async () => refusal));
  useCart.setState({ items: [kahati, onHand, batch], note: '' });
  render(<CheckoutPage />, { wrapper });
  attachProof();
  const button = await screen.findByRole('button', { name: /place order/i });
  await waitFor(() => expect(button).toBeEnabled());
  button.click();
}

beforeEach(() => {
  useCart.getState().clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('CheckoutPage — a refusal naming several dead lines', () => {
  it('removes every named line in one go and keeps the rest', async () => {
    await placeAgainstRefusal();

    await waitFor(() => expect(useCart.getState().items.map((i) => i.key)).toEqual(['product:p1:piece']));
  });

  it('explains on the page, naming each removed item, without raw ids', async () => {
    await placeAgainstRefusal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Retatrutide (Salt Form) 20mg vial');
    expect(alert).toHaveTextContent('Retatrutide 10mg vial');
    expect(alert).not.toHaveTextContent('old-reta');
  });

  it('says the order was not placed, so the customer is not left guessing', async () => {
    await placeAgainstRefusal();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not placed/i);
  });

  it('keeps the attached proof, so placing again is one tap', async () => {
    await placeAgainstRefusal();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(await screen.findByRole('button', { name: /^place order$/i })).toBeEnabled();
  });
});
