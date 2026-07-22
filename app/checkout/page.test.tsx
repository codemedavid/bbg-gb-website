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
vi.mock('@/lib/queries', () => ({
  usePaymentMethods: () => ({
    data: [{ id: 'pm1', label: 'GCash', accountName: 'BBG', accountNumber: '0917', qrUrl: null }],
  }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiDownpayment: () => ({ data: 150 }),
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

// The page guards on `proof`, so a successful placement needs a file attached.
const attachProof = async () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([Buffer.from('proof')], 'proof.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  replace.mockReset();
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
});
