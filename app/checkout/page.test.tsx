// Checkout page — client feedback #2, both halves:
//   * the cart must be empty after a successful order
//   * the page needs a Home link, since it sits outside the bottom nav
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567', address: '123 Mabini St' },
    loading: false,
  }),
}));
// The kahati commitments the customer already holds. Mutable so a test can put
// the page in the "already committed, nothing to pay" state.
const kahatiCommitments: { current: unknown } = { current: undefined };
vi.mock('@/lib/queries', () => ({
  usePaymentMethods: () => ({
    data: [{ id: 'pm1', label: 'GCash', accountName: 'BBG', accountNumber: '0917', qrUrl: null }],
  }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiCommitments: () => ({ data: kahatiCommitments.current }),
  useCyclePackingFeePaid: () => ({ data: false }),
}));

const CheckoutPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const seedCart = () => {
  useCart.setState({
    items: [{
      key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
      spec: '10mg', unitPricePhp: 550, qty: 2, minQty: 1, unit: 'piece', stock: 100,
    }],
  });
};

// The page guards on having at least one proof, so a successful placement needs
// a file attached. `count` covers the customer who paid in several transfers.
const attachProof = async (count = 1) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const files = Array.from({ length: count }, (_, i) =>
    new File([Buffer.from(`proof-${i}`)], `proof-${i}.png`, { type: 'image/png' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  kahatiCommitments.current = undefined;
  useCart.getState().clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: { orderNo: 'BBG-2500' } }),
  })));
});

describe('CheckoutPage', () => {
  it('offers a Home link back to the storefront', () => {
    seedCart();
    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });

  it('empties the cart once the order is placed', async () => {
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(useCart.getState().items).toEqual([]));
    expect(useCart.getState().count()).toBe(0);
  });

  it('drops the cached commitment waivers, since this checkout is itself a commitment', async () => {
    // Both waivers turn on orders that existed BEFORE this checkout. Leaving
    // either cached lets the next cart price itself off a stale answer — quoting
    // a kahati downpayment already covered, or a group buy packing fee the
    // server will no longer charge.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    seedCart();
    render(<CheckoutPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kahati-commitments'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['campaign-commitments'] });
  });

  it('sends the customer to the success page for the new order', async () => {
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/success/BBG-2500'));
  });

  it('offers J&T and Lalamove as the only shipping methods', () => {
    seedCart();
    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('button', { name: 'J&T' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lalamove' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LBC' })).not.toBeInTheDocument();
  });

  it('sends the chosen shipping method with the order', async () => {
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();
    screen.getByRole('button', { name: 'Lalamove' }).click();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as FormData;
    expect(body.get('courier')).toBe('Lalamove');
  });

  it('sends every attached proof, so three transfers arrive as three files', async () => {
    // The customer whose bank capped each transfer at ₱2,000. All three
    // screenshots have to reach the server on the one submission — the route
    // reads them with getAll('proof').
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof(3);

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as FormData;
    expect(body.getAll('proof')).toHaveLength(3);
  });

  it('leaves a removed proof out of the submission', async () => {
    // §16's removal case. The file the customer took back out must not be
    // filed against the order they actually placed.
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof(3);

    screen.getByRole('button', { name: /remove proof 2/i }).click();
    await waitFor(() => expect(screen.queryByText('Proof #3')).not.toBeInTheDocument());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as FormData;
    const sent = body.getAll('proof') as File[];
    expect(sent.map((f) => f.name)).toEqual(['proof-0.png', 'proof-2.png']);
  });

  it('shields the customer from deploy jargon when uploads are unconfigured', async () => {
    // The order API answers a missing ImageKit config with a 503 whose message
    // names STORAGE_DRIVER / IMAGEKIT_*. The customer must never see that.
    useToast.setState({ message: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        error: 'File uploads are not configured: STORAGE_DRIVER=imagekit but IMAGEKIT_PRIVATE_KEY '
          + 'and/or IMAGEKIT_URL_ENDPOINT are missing.',
      }),
    })));
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(useToast.getState().message).not.toBe(''));
    const shown = useToast.getState().message;
    expect(shown).not.toMatch(/STORAGE_DRIVER|IMAGEKIT/);
    expect(shown).toMatch(/try again/i);
    // A failed upload must not discard the cart or navigate away.
    expect(useCart.getState().items).toHaveLength(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the cart intact when the order fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'Only 1 left in stock.' }),
    })));
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    // A rejected checkout must not discard what the customer was buying.
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
    expect(useCart.getState().items).toHaveLength(1);
  });

  it('sends one idempotency key and reuses it when retrying the same submission', async () => {
    // A retry of the same submission must be recognizable server-side, so the
    // key is minted once per submission and reused until the order succeeds.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'Only 1 left in stock.' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    seedCart();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const keys = fetchMock.mock.calls.map((c) => ((c as unknown[])[1] as { body: FormData }).body.get('idempotencyKey'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});

// A customer who already holds a live kahati commitment has paid their
// downpayment; joining another hatian must not ask for it a second time. That
// checkout owes nothing, so the whole payment apparatus — method, QR, proof —
// is beside the point and comes off the screen. What replaces it is the running
// total of what they already have on order.
describe('CheckoutPage with a kahati commitment already live', () => {
  const seedKahatiCart = () => {
    useCart.setState({
      items: [{
        key: 'gb:g2', kind: 'group_buy', refId: 'g2', name: 'Tirze 30mg — kahati',
        spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 2, minQty: 1,
      }],
    });
  };
  const alreadyCommitted = {
    paidThisCycle: true,
    commitments: [],
    summary: {
      groups: [{ kahatiName: 'Reta 20mg', vials: 5, totalPhp: 4500, orderNos: ['BBG-2418', 'BBG-2419'] }],
      vials: 5, totalPhp: 4500, orderCount: 2,
    },
  };

  beforeEach(() => {
    kahatiCommitments.current = alreadyCommitted;
    seedKahatiCart();
  });

  it('asks for no payment method and no proof of payment', () => {
    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByRole('button', { name: 'GCash' })).not.toBeInTheDocument();
    expect(screen.queryByText(/proof of payment/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('shows no downpayment due', () => {
    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByText(/downpayment due now/i)).not.toBeInTheDocument();
  });

  it('lists the orders the customer already holds on their hatians', () => {
    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText('Reta 20mg')).toBeInTheDocument();
    expect(screen.getByText(/BBG-2418/)).toBeInTheDocument();
    expect(screen.getByText(/BBG-2419/)).toBeInTheDocument();
  });

  it('places the order with no proof attached', async () => {
    render(<CheckoutPage />, { wrapper });

    const confirm = screen.getByRole('button', { name: /confirm order/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    confirm.click();

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as FormData;
    expect(body.get('proof')).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/success/BBG-2500'));
  });

  it('still collects payment when the cart also holds an on-hand item', () => {
    // The waiver covers the kahati downpayment only — on-hand stock is paid for
    // now, so the payment section has to stay.
    useCart.setState({
      items: [
        ...useCart.getState().items,
        {
          key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
          spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100,
        },
      ],
    });
    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('button', { name: 'GCash' })).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });
});

// A persisted cart can hold lines the shop can no longer sell — a delisted
// product, a deleted hatian, one that closed while the tab sat open. Retrying
// checkout with the dead line just loops the same 400 (seen live: six
// identical rejections). The page must drop the dead line and say so plainly,
// leaving the rest of the cart intact for a clean retry.
describe('CheckoutPage stale cart lines', () => {
  const seedTwoLines = () => {
    useCart.setState({
      items: [
        {
          key: 'gb:g1', kind: 'group_buy', refId: 'g1', name: 'Reta 20mg — kahati',
          spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 2, minQty: 1,
        },
        {
          key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
          spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100,
        },
      ],
    });
  };

  it('removes a dead line and explains, instead of looping the same rejection', async () => {
    useToast.setState({ message: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Group buy not found: g1' }),
    })));
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    // The dead kahati line is gone; the still-valid on-hand line survives.
    await waitFor(() => expect(useCart.getState().items.map((i) => i.key)).toEqual(['product:p1:piece']));
    expect(useToast.getState().message).toMatch(/no longer available/i);
    expect(useToast.getState().message).not.toMatch(/g1/); // no raw ids at the customer
  });

  it('drops a kahati line whose hatian closed, matched by name', async () => {
    useToast.setState({ message: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Kahati "Reta 20mg" has already closed and is no longer accepting commitments.' }),
    })));
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(useCart.getState().items.map((i) => i.key)).toEqual(['product:p1:piece']));
    expect(useToast.getState().message).toMatch(/no longer available/i);
  });
});

// The last stop before paying. A customer who added the wrong peptide four
// boards ago must be able to take it back out here — and add one more — without
// abandoning a checkout they have already filled in. Before this, checkout
// showed totals only: the sole way to fix a mistake was to walk back to the
// cart, and nothing on the screen said so.
describe('CheckoutPage — fixing the cart before paying', () => {
  const wrongLine = {
    key: 'gb:g1', kind: 'group_buy' as const, refId: 'g1', name: 'Reta 20mg — kahati',
    spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 2, minQty: 1,
  };
  const keeper = {
    key: 'product:p1:piece', kind: 'product' as const, refId: 'p1', name: 'Test Peptide',
    spec: '10mg', unitPricePhp: 550, qty: 2, minQty: 1, unit: 'piece' as const, stock: 100,
  };
  const seedTwoLines = () => useCart.setState({ items: [wrongLine, keeper] });

  it('lists every peptide in the cart, so the customer can check what they are paying for', () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText('Reta 20mg — kahati')).toBeInTheDocument();
    expect(screen.getByText('Test Peptide')).toBeInTheDocument();
  });

  it('removes the peptide added by mistake and keeps the rest of the cart', async () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /remove reta 20mg — kahati from cart/i }).click();

    await waitFor(() => expect(useCart.getState().items.map((i) => i.key)).toEqual(['product:p1:piece']));
    expect(screen.queryByText('Reta 20mg — kahati')).not.toBeInTheDocument();
  });

  it('leaves the removed peptide out of the order it places', async () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });
    await attachProof();

    screen.getByRole('button', { name: /remove reta 20mg — kahati from cart/i }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
    screen.getByRole('button', { name: /place order/i }).click();

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as FormData;
    const sent = JSON.parse(String(body.get('items'))) as { refId: string }[];
    expect(sent.map((i) => i.refId)).toEqual(['p1']);
  });

  it('asks before throwing the whole cart away', async () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /^clear cart$/i }).click();

    // One tap must not wipe a cart assembled across four boards.
    expect(await screen.findByRole('button', { name: /yes, clear cart/i })).toBeInTheDocument();
    expect(useCart.getState().items).toHaveLength(2);
  });

  it('clears the cart once the customer confirms', async () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /^clear cart$/i }).click();
    (await screen.findByRole('button', { name: /yes, clear cart/i })).click();

    await waitFor(() => expect(useCart.getState().items).toEqual([]));
  });

  it('keeps the cart when the customer backs out of clearing it', async () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /^clear cart$/i }).click();
    (await screen.findByRole('button', { name: /keep my items/i })).click();

    await waitFor(() => expect(screen.queryByRole('button', { name: /yes, clear cart/i })).not.toBeInTheDocument());
    expect(useCart.getState().items).toHaveLength(2);
  });

  it('sends the customer back to the boards to add another peptide', () => {
    seedTwoLines();
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /add more items/i }).click();

    expect(push).toHaveBeenCalledWith('/');
  });

  it('says the cart is empty once the last line is removed, instead of a dead payment form', async () => {
    useCart.setState({ items: [keeper] });
    render(<CheckoutPage />, { wrapper });

    screen.getByRole('button', { name: /remove test peptide from cart/i }).click();

    await waitFor(() => expect(screen.getByText(/wala nang laman/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^place order$/i })).not.toBeInTheDocument();
  });
});
