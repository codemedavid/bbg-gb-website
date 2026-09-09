// The COA page: every batch's lab certificate, in one place.
//
// What only this page can prove is that opening a certificate keeps the customer
// on bbgph.org. The API test proves the URL it is handed is one of ours; this
// proves the page renders THAT url and does not reach for a storage host of its
// own — so the tests assert the hrefs are site-relative rather than merely
// present.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/coa',
}));

const files = { current: [] as unknown[], isLoading: false };
vi.mock('@/lib/queries', () => ({
  useCoaFiles: () => ({ data: files.current, isLoading: files.isLoading }),
}));

const CoaPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const setup = (data: unknown[], isLoading = false) => {
  files.current = data;
  files.isLoading = isLoading;
  return render(<CoaPage />, { wrapper });
};

const coa = (over: Record<string, unknown> = {}) => ({
  id: 'c1', label: 'Retatrutide 10mg', batch: 'A24',
  productId: 'p1', productName: 'Retatrutide 10mg',
  fileUrl: '/api/files/coa-files/reta-a24.png', isImage: true,
  // Midday UTC so the rendered date is the same day in Manila and in CI.
  uploadedAt: '2026-09-01T12:00:00.000Z',
  ...over,
});

describe('COA page', () => {
  it('lists a certificate with its batch and the product it belongs to', () => {
    setup([coa({ label: 'Retatrutide 10mg', batch: 'A24' })]);

    expect(screen.getByText(/Retatrutide 10mg/)).toBeInTheDocument();
    expect(screen.getByText(/Batch A24/)).toBeInTheDocument();
  });

  it('shows the certificate itself, not just its name', () => {
    setup([coa({ fileUrl: '/api/files/coa-files/reta-a24.png' })]);

    expect(screen.getByRole('img', { name: /Retatrutide 10mg/ }))
      .toHaveAttribute('src', '/api/files/coa-files/reta-a24.png');
  });

  it('opens the certificate on this site — never on a storage host', () => {
    setup([
      coa({ id: 'c1', fileUrl: '/api/files/coa-files/reta-a24.png' }),
      coa({ id: 'c2', label: 'Tirzepatide 30mg', fileUrl: '/api/files/coa-files/tirz-b11.pdf', isImage: false }),
    ]);

    // Scoped to the certificate list rather than the whole page: the header's
    // chat shortcuts are wa.me and viber:// on purpose, and that is a different
    // question from where a lab result is served.
    const links = within(screen.getByRole('list')).getAllByRole('link');

    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/api/files/coa-files/reta-a24.png',
      '/api/files/coa-files/tirz-b11.pdf',
    ]);
    // No scheme and no host: relative, so the browser cannot leave bbgph.org.
    for (const a of links) expect(a.getAttribute('href')).not.toMatch(/:\/\//);
  });

  it('says when the batch was tested', () => {
    setup([coa({ uploadedAt: '2026-09-01T12:00:00.000Z' })]);

    expect(screen.getByText(/Sep 1, 2026/)).toBeInTheDocument();
  });

  it('renders a document tile for a PDF certificate instead of a broken image', () => {
    setup([coa({ fileUrl: '/api/files/coa-files/reta-a24.pdf', isImage: false })]);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/PDF/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retatrutide 10mg/ }))
      .toHaveAttribute('href', '/api/files/coa-files/reta-a24.pdf');
  });

  it('says so plainly when nothing has been published yet', () => {
    setup([]);

    expect(screen.getByText(/Wala pang COA/i)).toBeInTheDocument();
  });

  it('does not show the empty state while the list is still loading', () => {
    setup([], true);

    expect(screen.queryByText(/Wala pang COA/i)).not.toBeInTheDocument();
  });
});
