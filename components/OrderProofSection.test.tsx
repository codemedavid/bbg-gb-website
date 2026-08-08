// The customer's own view of what they have paid, and the way to add more.
//
// Someone paying a ₱4,500 order across three transfers needs two things this
// screen gives them: sight of what already landed, so they are not guessing
// whether last night's upload worked, and a way to attach tonight's without
// placing a second order.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { OrderProofSection } from './OrderProofSection';
import { MAX_PROOFS } from '@/lib/proof';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const proof = (i: number, amountPhp: string | null = null) => ({
  id: `p${i}`, url: `https://files.example/proof-${i}.png`,
  sortOrder: i - 1, amountPhp, reference: null,
});

const show = (props: Partial<Parameters<typeof OrderProofSection>[0]> = {}) =>
  render(
    <OrderProofSection orderId="o1" status="proof_review" proofs={[proof(1)]} {...props} />,
    { wrapper },
  );

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;

const attach = (count: number) => {
  const files = Array.from({ length: count }, (_, i) =>
    new File([Buffer.from(`later-${i}`)], `later-${i}.png`, { type: 'image/png' }));
  fireEvent.change(fileInput()!, { target: { files } });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 201, json: async () => ({ success: true, data: { added: 1, total: 2 } }),
  })));
});

describe('OrderProofSection — what the customer has already sent', () => {
  it('shows a numbered thumbnail per proof', () => {
    show({ proofs: [proof(1), proof(2)] });

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
  });

  it('says how many of the five are used', () => {
    show({ proofs: [proof(1), proof(2)] });

    expect(screen.getByText(`2 of ${MAX_PROOFS} attached`)).toBeInTheDocument();
  });

  it('opens each proof full size', () => {
    show({ proofs: [proof(1)] });

    const link = screen.getByRole('link', { name: /proof #1/i });
    expect(link).toHaveAttribute('href', 'https://files.example/proof-1.png');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows an amount the admin has recorded against a proof', () => {
    show({ proofs: [proof(1, '2000.00')] });

    expect(screen.getByText('₱2,000')).toBeInTheDocument();
  });
});

describe('OrderProofSection — adding one later', () => {
  it('offers an uploader while the order still takes payment', () => {
    show({ status: 'proof_review' });

    expect(fileInput()).not.toBeNull();
  });

  it('explains why a customer would add another', () => {
    // Without a reason on screen this reads as "we lost your proof".
    show();

    expect(screen.getByText(/paid in several transfers/i)).toBeInTheDocument();
  });

  it('posts the attached files to this order', async () => {
    show({ orderId: 'o42' });
    attach(2);

    fireEvent.click(screen.getByRole('button', { name: /add proof/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/orders/o42/proofs');
    expect((init.body as FormData).getAll('proof')).toHaveLength(2);
  });

  it('does nothing until a file is chosen', () => {
    show();

    expect(screen.queryByRole('button', { name: /add proof/i })).not.toBeInTheDocument();
  });

  it('clears the picked files once they are filed', async () => {
    show();
    attach(1);

    fireEvent.click(screen.getByRole('button', { name: /add proof/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /add proof/i })).not.toBeInTheDocument());
  });

  it('shows the server\'s reason when the upload is refused', async () => {
    // The cap is enforced server-side across visits, so its refusal is the one
    // the customer must actually read.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ success: false, error: 'You can add 1 more payment proof — 3 were submitted.' }),
    })));
    show();
    attach(3);

    fireEvent.click(screen.getByRole('button', { name: /add proof/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/1 more payment proof/i);
  });

  it('keeps the picked files when the upload is refused, so nothing is retyped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ success: false, error: 'Nope.' }),
    })));
    show();
    attach(1);

    fireEvent.click(screen.getByRole('button', { name: /add proof/i }));

    await screen.findByRole('alert');
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
  });
});

describe('OrderProofSection — when adding is not offered', () => {
  it('hides the uploader once five are filed', () => {
    show({ proofs: Array.from({ length: MAX_PROOFS }, (_, i) => proof(i + 1)) });

    expect(fileInput()).toBeNull();
  });

  it('hides the uploader on a shipped order', () => {
    // The parcel has gone; there is no further payment to evidence.
    show({ status: 'shipped' });

    expect(fileInput()).toBeNull();
  });

  it('hides the uploader on a cancelled order', () => {
    show({ status: 'cancelled' });

    expect(fileInput()).toBeNull();
  });

  it('still shows the proofs of a shipped order', () => {
    // Read-only, not hidden. The customer's record of what they paid does not
    // disappear because the parcel arrived.
    show({ status: 'delivered', proofs: [proof(1), proof(2)] });

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
  });

  it('offers the uploader on a confirmed order, for a customer topping up', () => {
    show({ status: 'payment_confirmed' });

    expect(fileInput()).not.toBeNull();
  });

  it('says no proof is attached when there is none', () => {
    show({ proofs: [] });

    expect(screen.getByText(/no proof of payment attached/i)).toBeInTheDocument();
  });
});
