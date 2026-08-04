// The admin card that configures the ONE shared Group Buy + Hatian window.
//
// Two things make this card easy to get wrong, and both are pinned here.
//
// First, the timezone. The admin types 09:00 meaning 9am Manila. If the entry is
// posted as-typed the server stores 9am UTC — five in the afternoon here, and
// the boards open eight hours late every single week. So the test asserts on the
// exact instant that leaves the card, not merely that a save happened.
//
// Second, the card must never imply a schedule that is not in force. An unset
// window means BOTH boards are shut, and an admin who cannot see that will
// assume the storefront is trading when nothing is.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.fn();
const apiSend = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiSend: (...a: unknown[]) => apiSend(...a),
}));

const { SchedulePanel } = await import('./SchedulePanel');

const OPENS = '2026-08-04T01:00:00.000Z'; // Aug 4, 09:00 PHT
const CLOSES = '2026-08-11T15:59:00.000Z'; // Aug 11, 23:59 PHT

const opensField = () => screen.getByLabelText(/opens/i) as HTMLInputElement;
const closesField = () => screen.getByLabelText(/closes/i) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save|update/i });

beforeEach(() => {
  apiGet.mockReset();
  apiSend.mockReset();
  apiGet.mockResolvedValue({ groupBuySchedule: { opensAt: null, closesAt: null } });
  apiSend.mockResolvedValue({ groupBuySchedule: { opensAt: null, closesAt: null } });
});

describe('SchedulePanel', () => {
  it('shows a stored window as Philippine local time, not as UTC', async () => {
    apiGet.mockResolvedValue({ groupBuySchedule: { opensAt: OPENS, closesAt: CLOSES } });

    render(<SchedulePanel />);

    await waitFor(() => expect(opensField().value).toBe('2026-08-04T09:00'));
    expect(closesField().value).toBe('2026-08-11T23:59');
  });

  it('says both boards are closed while no window is configured', async () => {
    render(<SchedulePanel />);

    // Not "no schedule" in the abstract — the consequence, which is what the
    // admin actually needs to know.
    expect(await screen.findByText(/both .*closed|closed.*both/i)).toBeInTheDocument();
    expect(opensField().value).toBe('');
  });

  it('posts the instant the admin meant, converted from Philippine time', async () => {
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    fireEvent.change(opensField(), { target: { value: '2026-08-04T09:00' } });
    fireEvent.change(closesField(), { target: { value: '2026-08-11T23:59' } });
    await userEvent.click(saveButton());

    await waitFor(() => expect(apiSend).toHaveBeenCalledWith(
      '/admin/settings', 'PATCH',
      { groupBuySchedule: { opensAt: OPENS, closesAt: CLOSES } },
    ));
  });

  it('refuses a window that closes before it opens, without calling the server', async () => {
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    fireEvent.change(opensField(), { target: { value: '2026-08-11T23:59' } });
    fireEvent.change(closesField(), { target: { value: '2026-08-04T09:00' } });
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('refuses a half-configured window, which would silently shut both boards', async () => {
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    fireEvent.change(opensField(), { target: { value: '2026-08-04T09:00' } });
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('clears the window when both entries are emptied', async () => {
    apiGet.mockResolvedValue({ groupBuySchedule: { opensAt: OPENS, closesAt: CLOSES } });
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField().value).toBe('2026-08-04T09:00'));

    fireEvent.change(opensField(), { target: { value: '' } });
    fireEvent.change(closesField(), { target: { value: '' } });
    await userEvent.click(saveButton());

    await waitFor(() => expect(apiSend).toHaveBeenCalledWith(
      '/admin/settings', 'PATCH',
      { groupBuySchedule: { opensAt: null, closesAt: null } },
    ));
  });

  it('renders what the server confirmed rather than what was typed', async () => {
    // The server normalises; the card must not keep showing an entry the server
    // did not actually store.
    apiSend.mockResolvedValue({ groupBuySchedule: { opensAt: OPENS, closesAt: CLOSES } });
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    fireEvent.change(opensField(), { target: { value: '2026-08-04T09:00' } });
    fireEvent.change(closesField(), { target: { value: '2026-08-11T23:59' } });
    await userEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
    expect(closesField().value).toBe('2026-08-11T23:59');
  });

  it('surfaces a save failure instead of reporting success', async () => {
    apiSend.mockRejectedValue(new Error('Nope.'));
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    fireEvent.change(opensField(), { target: { value: '2026-08-04T09:00' } });
    fireEvent.change(closesField(), { target: { value: '2026-08-11T23:59' } });
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/nope/i);
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    apiGet.mockRejectedValue(new Error('Could not load.'));
    render(<SchedulePanel />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('states that the one window governs both modules', async () => {
    // The requirement an admin must not have to infer: this is not the Group Buy
    // schedule with Hatian following along, it is one window for both.
    render(<SchedulePanel />);
    await waitFor(() => expect(opensField()).toBeEnabled());

    expect(screen.getByText(/group buy/i)).toBeInTheDocument();
    expect(screen.getByText(/hatian|kahati/i)).toBeInTheDocument();
  });
});
