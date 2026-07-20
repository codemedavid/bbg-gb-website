// Committing to a Group Buy campaign is not "add to cart".
//
// A hatian vial goes through the cart and the shared checkout. A campaign
// commitment posts straight to /api/campaigns/:id/commit with its own shipping
// details and payment proof, because the commitment IS the order — that is the
// separate business logic the client asked for in feedback #2.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitSheet } from './CommitSheet';
import type { MoqCampaign } from '@/lib/types';

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 20mg', pricePerKitPhp: '9000.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  progress: 0.4, remaining: 6, reached: false, outcome: 'awaiting_moq',
  ...o,
});

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Reyes', email: 'ana@example.com', phone: '09171234567', address: '12 Mabini St' },
    loading: false,
  }),
}));

const attachProof = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([Buffer.from('proof')], 'proof.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const okFetch = () => vi.fn(async () => ({
  ok: true,
  json: async () => ({ success: true, data: { order: { orderNo: 'BBG-3001' } } }),
})) as unknown as typeof fetch;

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  vi.stubGlobal('fetch', okFetch());
});

describe('CommitSheet', () => {
  it('prefills the buyer’s saved shipping details', () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);

    expect(screen.getByPlaceholderText(/full name/i)).toHaveValue('Ana Reyes');
    expect(screen.getByPlaceholderText(/mobile/i)).toHaveValue('09171234567');
  });

  it('starts at the campaign’s per-customer minimum', () => {
    render(<CommitSheet c={campaign({ perCustomerMin: 3 })} onClose={vi.fn()} onCommitted={vi.fn()} />);

    expect(screen.getByTestId('commit-qty')).toHaveTextContent('3');
  });

  it('will not go below the per-customer minimum', async () => {
    render(<CommitSheet c={campaign({ perCustomerMin: 2 })} onClose={vi.fn()} onCommitted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /decrease/i }));

    expect(screen.getByTestId('commit-qty')).toHaveTextContent('2');
  });

  it('prices the commitment as kits × price plus the packing fee', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /increase/i }));

    // 2 kits × ₱9,000 + ₱300 packing = ₱18,300
    expect(screen.getByText(/18,300/)).toBeInTheDocument();
  });

  it('blocks submission until a payment proof is attached', () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);

    expect(screen.getByRole('button', { name: /upload proof/i })).toBeDisabled();
  });

  it('posts the commitment to the campaign commit endpoint', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);
    attachProof();

    await userEvent.click(await screen.findByRole('button', { name: /commit/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/campaigns/c1/commit');
    expect(init.method).toBe('POST');

    const body = init.body as FormData;
    expect(body.get('qty')).toBe('1');
    expect(body.get('shipName')).toBe('Ana Reyes');
    expect(body.get('shipAddress')).toBe('12 Mabini St');
    expect(body.get('proof')).toBeInstanceOf(File);
  });

  it('reports the campaign’s own rejection rather than a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'This campaign is cancelled and no longer accepting commitments.' }),
    })));
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);
    attachProof();

    await userEvent.click(await screen.findByRole('button', { name: /commit/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer accepting/i);
  });

  it('hands the placed order back to the page on success', async () => {
    const onCommitted = vi.fn();
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={onCommitted} />);
    attachProof();

    await userEvent.click(await screen.findByRole('button', { name: /commit/i }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith('BBG-3001'));
  });

  it('does not fire a second request while the first is in flight', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onCommitted={vi.fn()} />);
    attachProof();

    const button = await screen.findByRole('button', { name: /commit/i });
    await userEvent.click(button);
    await userEvent.click(button);

    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
  });
});
