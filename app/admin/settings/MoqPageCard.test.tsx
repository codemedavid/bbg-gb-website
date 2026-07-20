// The admin switch for MOQ page visibility.
//
// The client asked for a toggle that shows the current status and persists it,
// so this card must reflect what the server says (never an optimistic guess)
// and must surface a failed save rather than leaving a switch that looks on
// while the page is still off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.fn();
const apiSend = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiGet: (...a: unknown[]) => apiGet(...a), apiSend: (...a: unknown[]) => apiSend(...a) }));

const { MoqPageCard } = await import('./MoqPageCard');

beforeEach(() => {
  apiGet.mockReset();
  apiSend.mockReset();
});

describe('MoqPageCard', () => {
  it('shows the page as OFF when the server says it is disabled', async () => {
    apiGet.mockResolvedValue({ moqPageEnabled: false });
    render(<MoqPageCard />);

    const toggle = await screen.findByRole('switch', { name: /moq page/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/hidden from customers/i)).toBeInTheDocument();
  });

  it('shows the page as ON when the server says it is enabled', async () => {
    apiGet.mockResolvedValue({ moqPageEnabled: true });
    render(<MoqPageCard />);

    const toggle = await screen.findByRole('switch', { name: /moq page/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/visible to customers/i)).toBeInTheDocument();
  });

  it('persists the new value when switched on', async () => {
    apiGet.mockResolvedValue({ moqPageEnabled: false });
    apiSend.mockResolvedValue({ moqPageEnabled: true });
    render(<MoqPageCard />);

    await userEvent.click(await screen.findByRole('switch', { name: /moq page/i }));

    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('/admin/settings', 'PATCH', { moqPageEnabled: true }));
  });

  it('reflects the server response rather than the optimistic guess', async () => {
    apiGet.mockResolvedValue({ moqPageEnabled: false });
    // Server refuses the change and reports it is still off.
    apiSend.mockResolvedValue({ moqPageEnabled: false });
    render(<MoqPageCard />);

    await userEvent.click(await screen.findByRole('switch', { name: /moq page/i }));

    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    expect(screen.getByRole('switch', { name: /moq page/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('surfaces a save failure instead of showing a switch that lies', async () => {
    apiGet.mockResolvedValue({ moqPageEnabled: false });
    apiSend.mockRejectedValue(new Error('Nope.'));
    render(<MoqPageCard />);

    await userEvent.click(await screen.findByRole('switch', { name: /moq page/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nope/i);
    expect(screen.getByRole('switch', { name: /moq page/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports a load failure', async () => {
    apiGet.mockRejectedValue(new Error('Could not load.'));
    render(<MoqPageCard />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
