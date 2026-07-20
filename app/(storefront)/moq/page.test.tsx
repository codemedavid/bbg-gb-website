// The MOQ route gate.
//
// The client asked that switching the page OFF hide it "even by entering the URL
// directly". Hiding the nav tab is not enough, so the route itself must 404.
// This runs as a Server Component precisely so the check happens before any
// markup is produced — a client-side redirect would still ship and flash the
// page.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound }));

const moqEnabled = { value: false };
vi.mock('@/lib/settings', () => ({ getMoqPageEnabled: async () => moqEnabled.value }));

vi.mock('./MoqBoard', () => ({ MoqBoard: () => 'moq-board' }));

const MoqPage = (await import('./page')).default;

beforeEach(() => {
  notFound.mockClear();
  moqEnabled.value = false;
});

describe('/moq route gating', () => {
  it('404s when the admin has the page switched off', async () => {
    await expect(MoqPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('renders the shelf once the admin switches the page on', async () => {
    moqEnabled.value = true;
    const el = await MoqPage();
    expect(notFound).not.toHaveBeenCalled();
    expect(el).toBeTruthy();
  });

  it('goes back to 404 the moment the page is switched off again', async () => {
    moqEnabled.value = true;
    await MoqPage();
    expect(notFound).not.toHaveBeenCalled();

    moqEnabled.value = false;
    await expect(MoqPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
