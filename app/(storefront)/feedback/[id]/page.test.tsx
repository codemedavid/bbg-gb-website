// One folder's screenshots.
//
// The screenshot is the evidence and the caption is the readable version of it,
// so both have to reach the page — a gallery that drops the caption is a wall
// of 11px chat text on a phone.
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/feedback/f1',
}));

const folder = { current: undefined as unknown, isLoading: false, isError: false };
vi.mock('@/lib/queries', () => ({
  useFeedbackFolder: () => ({ data: folder.current, isLoading: folder.isLoading, isError: folder.isError }),
}));

const FolderPage = (await import('./page')).default;

// The page reads its route param with `use(params)`, so it suspends on first
// render. Next's router supplies the boundary in the real app; the test has to
// supply its own or every assertion races an empty tree.
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Suspense fallback={null}>{children}</Suspense>
  </QueryClientProvider>
);

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', folderId: 'f1', imageUrl: '/api/files/feedback/a.png',
  caption: null, customerName: null, ...over,
});

/**
 * Render and let the suspended params settle.
 *
 * The act() wrapper is not optional: use() suspends on the params promise, and
 * React will not commit the resolved tree until that resolution happens inside
 * an awaited act scope. Without it the page stays on the fallback all test.
 */
const setup = async (data: unknown, flags: { isLoading?: boolean; isError?: boolean } = {}) => {
  folder.current = data;
  folder.isLoading = flags.isLoading ?? false;
  folder.isError = flags.isError ?? false;
  await act(async () => {
    render(<FolderPage params={Promise.resolve({ id: 'f1' })} />, { wrapper });
  });
};

describe('Feedback folder page', () => {
  it('names the folder it is showing', async () => {
    await setup({ id: 'f1', name: 'Batch 6 Reviews', description: null, itemCount: 1, coverUrl: null, items: [item()] });

    expect(await screen.findByRole('heading', { name: 'Batch 6 Reviews' })).toBeInTheDocument();
  });

  it('renders every screenshot with what the customer said and who said it', async () => {
    await setup({
      id: 'f1', name: 'Batch 6 Reviews', description: null, itemCount: 2, coverUrl: null,
      items: [
        item({ id: 'i1', imageUrl: '/api/files/feedback/a.png', caption: 'Sobrang bilis dumating!', customerName: 'Ate Jen, Cavite' }),
        item({ id: 'i2', imageUrl: '/api/files/feedback/b.png', caption: 'Legit seller!' }),
      ],
    });

    expect(await screen.findByText('Sobrang bilis dumating!')).toBeInTheDocument();
    expect(screen.getByText(/Ate Jen, Cavite/)).toBeInTheDocument();
    expect(screen.getByText('Legit seller!')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('lazy-loads the screenshots — a gallery of phone shots is the page weight', async () => {
    await setup({
      id: 'f1', name: 'Batch 6', description: null, itemCount: 1, coverUrl: null,
      items: [item()],
    });

    expect((await screen.findAllByRole('img'))[0]).toHaveAttribute('loading', 'lazy');
  });

  it('opens a screenshot full-size when tapped — a chat shot is unreadable as a tile', async () => {
    await setup({
      id: 'f1', name: 'Batch 6', description: null, itemCount: 1, coverUrl: null,
      items: [item({ imageUrl: '/api/files/feedback/a.png', caption: 'Sobrang bilis!' })],
    });

    await userEvent.click(await screen.findByRole('button', { name: /Sobrang bilis/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The full-size copy loads eagerly: it is the thing the customer just asked for.
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/api/files/feedback/a.png');
  });

  // Coverage backfill: the close paths existed but nothing exercised them, and
  // a lightbox that covers the whole screen with no way out is a trap on a
  // phone, where there is no Escape key.
  it('closes the full-size view from the button', async () => {
    await setup({
      id: 'f1', name: 'Batch 6', description: null, itemCount: 1, coverUrl: null,
      items: [item({ caption: 'Sobrang bilis!' })],
    });
    await userEvent.click(await screen.findByRole('button', { name: /Sobrang bilis/ }));

    await userEvent.click(screen.getByRole('button', { name: /Isara/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the full-size view by tapping the backdrop', async () => {
    await setup({
      id: 'f1', name: 'Batch 6', description: null, itemCount: 1, coverUrl: null,
      items: [item({ caption: 'Sobrang bilis!' })],
    });
    await userEvent.click(await screen.findByRole('button', { name: /Sobrang bilis/ }));

    await userEvent.click(screen.getByRole('dialog'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the folder is empty rather than rendering nothing', async () => {
    await setup({ id: 'f1', name: 'Batch 7', description: null, itemCount: 0, coverUrl: null, items: [] });

    expect(await screen.findByText(/wala pang feedback/i)).toBeInTheDocument();
  });

  it('tells the customer when the folder is gone instead of hanging on a spinner', async () => {
    await setup(undefined, { isError: true });

    expect(await screen.findByText(/hindi mahanap/i)).toBeInTheDocument();
  });
});
