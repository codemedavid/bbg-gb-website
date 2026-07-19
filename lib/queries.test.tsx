// The hatian board is shared state: other customers claim vials while the page
// sits open. useGroupBuys previously inherited the app-wide query defaults
// (staleTime 30s, refetchOnWindowFocus false, no interval), so the counter and
// progress bar stayed frozen until a hard reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
vi.mock('./api-client', () => ({
  apiGet: (path: string) => apiGet(path),
  qs: () => '',
}));

const { useGroupBuys, useProducts, KAHATI_POLL_MS } = await import('./queries');

// Mirrors app/providers.tsx so the test exercises the real defaults the hook
// has to override, not a permissive test-only client.
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useGroupBuys', () => {
  it('polls on an interval so other customers\' joins appear without a reload', async () => {
    renderHook(() => useGroupBuys(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(KAHATI_POLL_MS + 100);

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('keeps polling for as long as the board is open', async () => {
    renderHook(() => useGroupBuys(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(KAHATI_POLL_MS * 3 + 100);

    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThanOrEqual(4));
  });

  it('surfaces an updated vial count on the next poll', async () => {
    apiGet.mockResolvedValueOnce([{ id: 'g1', claimedSlots: 4 }])
      .mockResolvedValueOnce([{ id: 'g1', claimedSlots: 7 }]);

    const { result } = renderHook(() => useGroupBuys(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]).toMatchObject({ claimedSlots: 4 }));

    await vi.advanceTimersByTimeAsync(KAHATI_POLL_MS + 100);

    await waitFor(() => expect(result.current.data?.[0]).toMatchObject({ claimedSlots: 7 }));
  });

  it('requests the public board endpoint', async () => {
    renderHook(() => useGroupBuys(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/groupbuys'));
  });

  it('does not turn every other query into a poller', async () => {
    renderHook(() => useProducts({}), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(KAHATI_POLL_MS * 2 + 100);

    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
