// The feedback index: folders, not screenshots.
//
// What only this page can prove is that the folder is the unit a customer
// browses. A folder an admin created but has not filled yet still has to render
// as a tile they can open — the alternative is a folder that silently does not
// exist until somebody uploads into it, which is not what the admin was shown
// when they made it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/feedback',
}));

const folders = { current: [] as unknown[], isLoading: false };
vi.mock('@/lib/queries', () => ({
  useFeedbackFolders: () => ({ data: folders.current, isLoading: folders.isLoading }),
}));

const FeedbackPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const setup = (data: unknown[], isLoading = false) => {
  folders.current = data;
  folders.isLoading = isLoading;
  return render(<FeedbackPage />, { wrapper });
};

const folder = (over: Record<string, unknown> = {}) => ({
  id: 'f1', name: 'Batch 6 Reviews', description: null,
  itemCount: 3, coverUrl: '/api/files/feedback/cover.png', ...over,
});

describe('Feedback page', () => {
  it('lists a folder with its name and how much is inside', async () => {
    setup([folder({ name: 'Batch 6 Reviews', itemCount: 3 })]);

    expect(screen.getByText('Batch 6 Reviews')).toBeInTheDocument();
    expect(screen.getByText(/3 feedbacks/i)).toBeInTheDocument();
  });

  it('opens the folder when tapped', async () => {
    setup([folder({ id: 'abc' })]);

    expect(screen.getByRole('link', { name: /Batch 6 Reviews/ })).toHaveAttribute('href', '/feedback/abc');
  });

  it('shows the cover screenshot', async () => {
    setup([folder({ coverUrl: '/api/files/feedback/cover.png' })]);

    expect(screen.getByRole('img', { name: /Batch 6 Reviews/ })).toHaveAttribute(
      'src', '/api/files/feedback/cover.png',
    );
  });

  it('still renders a folder nobody has uploaded into yet', async () => {
    setup([folder({ name: 'Batch 7 Reviews', itemCount: 0, coverUrl: null })]);

    expect(screen.getByText('Batch 7 Reviews')).toBeInTheDocument();
    expect(screen.getByText(/wala pang feedback/i)).toBeInTheDocument();
  });

  it('shows the folder description when the admin wrote one', async () => {
    setup([folder({ description: 'August batch, GLP-1 orders' })]);

    expect(screen.getByText('August batch, GLP-1 orders')).toBeInTheDocument();
  });

  it('says so plainly when there is nothing published at all', async () => {
    setup([]);

    expect(screen.getByText(/wala pang feedback/i)).toBeInTheDocument();
  });
});
