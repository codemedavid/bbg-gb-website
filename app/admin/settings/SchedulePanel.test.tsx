// The admin card that configures the ONE shared Group Buy + Hatian schedule.
//
// Three things make this card easy to get wrong, and all three are pinned here.
//
// First, the schedule must be a WEEKLY recurrence the admin states in their own
// terms — opening day, opening time, closing day, closing time. Anything that
// makes them re-enter a window each week is a storefront one forgotten edit
// away from being dark.
//
// Second, the card must never imply a schedule that is not in force. An unset
// recurrence means BOTH boards are shut, and an admin who cannot see that will
// assume the storefront is trading when nothing is.
//
// Third, "Wednesday to Wednesday" is a claim the admin cannot check on its own,
// so the card shows the instants it actually resolves to.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.fn();
const apiSend = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiSend: (...a: unknown[]) => apiSend(...a),
}));

const { SchedulePanel } = await import('./SchedulePanel');

const WED = 3;
const UNSET = { openDay: null, openTime: null, closeDay: null, closeTime: null };
const WED_TO_WED = { openDay: WED, openTime: '20:00', closeDay: WED, closeTime: '18:00' };
// The instants Wednesday 8:00 PM -> Wednesday 6:00 PM PHT resolves to.
const CYCLE = { opensAt: '2026-08-05T12:00:00.000Z', closesAt: '2026-08-12T10:00:00.000Z' };

const settings = (over: Record<string, unknown> = {}) => ({
  scheduleRecurrence: UNSET, schedulePausedUntil: null, scheduleCycle: null, ...over,
});

const openDay = () => screen.getByLabelText(/opening day/i) as HTMLSelectElement;
const openTime = () => screen.getByLabelText(/opening time/i) as HTMLInputElement;
const closeDay = () => screen.getByLabelText(/closing day/i) as HTMLSelectElement;
const closeTime = () => screen.getByLabelText(/closing time/i) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save|update/i });

const savedBody = () => apiSend.mock.calls.at(-1)?.[2] as Record<string, unknown>;

beforeEach(() => {
  apiGet.mockReset();
  apiSend.mockReset();
  apiGet.mockResolvedValue(settings());
  apiSend.mockResolvedValue(settings());
});

describe('SchedulePanel — reading the schedule back', () => {
  it('shows the stored recurrence in its four fields', async () => {
    apiGet.mockResolvedValue(settings({ scheduleRecurrence: WED_TO_WED, scheduleCycle: CYCLE }));

    render(<SchedulePanel />);

    await waitFor(() => expect(openDay().value).toBe(String(WED)));
    expect(openTime().value).toBe('20:00');
    expect(closeDay().value).toBe(String(WED));
    expect(closeTime().value).toBe('18:00');
  });

  it('shows the instants the recurrence resolves to, in Philippine time', async () => {
    // Wed Aug 5 2026 8:00 PM PHT and Wed Aug 12 6:00 PM PHT. Rendering these as
    // UTC would show Aug 5 12:00 PM and quietly claim a different window.
    apiGet.mockResolvedValue(settings({ scheduleRecurrence: WED_TO_WED, scheduleCycle: CYCLE }));

    render(<SchedulePanel />);

    const preview = await screen.findByTestId('schedule-cycle-preview');
    expect(preview).toHaveTextContent(/Aug 5, 2026/);
    expect(preview).toHaveTextContent(/8:00\s*PM/i);
    expect(preview).toHaveTextContent(/Aug 12, 2026/);
    expect(preview).toHaveTextContent(/6:00\s*PM/i);
  });

  it('says both boards are closed when nothing is configured', async () => {
    render(<SchedulePanel />);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/closed/i);
  });

  it('names the timezone the times are in', async () => {
    // The admin types 8:00 PM meaning Manila. If the card never says so, the
    // eight-hour error is invisible until customers cannot reach the boards.
    render(<SchedulePanel />);

    expect(await screen.findByText(/PHT|Philippine/i)).toBeInTheDocument();
  });
});

describe('SchedulePanel — saving the schedule', () => {
  it('posts the four fields the admin chose', async () => {
    render(<SchedulePanel />);
    await waitFor(() => expect(openDay()).toBeInTheDocument());

    await userEvent.selectOptions(openDay(), String(WED));
    await userEvent.clear(openTime());
    await userEvent.type(openTime(), '20:00');
    await userEvent.selectOptions(closeDay(), String(WED));
    await userEvent.clear(closeTime());
    await userEvent.type(closeTime(), '18:00');
    await userEvent.click(saveButton());

    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    expect(savedBody()).toEqual({ scheduleRecurrence: WED_TO_WED });
  });

  it('refuses to post a half-set schedule', async () => {
    // A half-set recurrence closes both boards, so the card catches it rather
    // than letting the save look like it worked.
    render(<SchedulePanel />);
    await waitFor(() => expect(openDay()).toBeInTheDocument());

    await userEvent.selectOptions(openDay(), String(WED));
    await userEvent.clear(openTime());
    await userEvent.type(openTime(), '20:00');
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('clears the schedule when every field is emptied', async () => {
    // Emptying all four is a real instruction: take the boards offline until a
    // new schedule is set.
    apiGet.mockResolvedValue(settings({ scheduleRecurrence: WED_TO_WED, scheduleCycle: CYCLE }));
    render(<SchedulePanel />);
    await waitFor(() => expect(openTime().value).toBe('20:00'));

    await userEvent.selectOptions(openDay(), '');
    await userEvent.clear(openTime());
    await userEvent.selectOptions(closeDay(), '');
    await userEvent.clear(closeTime());
    await userEvent.click(saveButton());

    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    expect(savedBody()).toEqual({ scheduleRecurrence: UNSET });
  });

  it('renders what the server confirmed rather than what was typed', async () => {
    // The server normalises; a card showing an entry the server did not store
    // is a card lying about when the storefront trades.
    apiSend.mockResolvedValue(settings({
      scheduleRecurrence: { ...WED_TO_WED, openTime: '21:00' }, scheduleCycle: CYCLE,
    }));
    render(<SchedulePanel />);
    await waitFor(() => expect(openDay()).toBeInTheDocument());

    await userEvent.selectOptions(openDay(), String(WED));
    await userEvent.clear(openTime());
    await userEvent.type(openTime(), '20:00');
    await userEvent.selectOptions(closeDay(), String(WED));
    await userEvent.clear(closeTime());
    await userEvent.type(closeTime(), '18:00');
    await userEvent.click(saveButton());

    await waitFor(() => expect(openTime().value).toBe('21:00'));
  });

  it('surfaces a rejected save instead of showing it as applied', async () => {
    apiSend.mockRejectedValue(new Error('The schedule must close after it opens.'));
    render(<SchedulePanel />);
    await waitFor(() => expect(openDay()).toBeInTheDocument());

    await userEvent.selectOptions(openDay(), String(WED));
    await userEvent.clear(openTime());
    await userEvent.type(openTime(), '20:00');
    await userEvent.selectOptions(closeDay(), String(WED));
    await userEvent.clear(closeTime());
    await userEvent.type(closeTime(), '18:00');
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/close after it opens/i);
  });
});

describe('SchedulePanel — pausing', () => {
  it('offers to pause while the boards are open', async () => {
    apiGet.mockResolvedValue(settings({
      scheduleRecurrence: WED_TO_WED,
      // A cycle around this instant, so the card reads as open whenever it runs.
      scheduleCycle: {
        opensAt: new Date(Date.now() - 3_600_000).toISOString(),
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    }));

    render(<SchedulePanel />);

    expect(await screen.findByRole('button', { name: /close now|pause/i })).toBeInTheDocument();
  });

  it('pauses to the end of the running cycle', async () => {
    const closesAt = new Date(Date.now() + 3_600_000).toISOString();
    apiGet.mockResolvedValue(settings({
      scheduleRecurrence: WED_TO_WED,
      scheduleCycle: { opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt },
    }));
    render(<SchedulePanel />);

    await userEvent.click(await screen.findByRole('button', { name: /close now|pause/i }));

    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    // The pause ends with the cycle: next week opens on schedule as usual.
    expect(savedBody()).toEqual({ schedulePausedUntil: closesAt });
  });

  it('offers to resume while paused, and lifts the pause with a null', async () => {
    apiGet.mockResolvedValue(settings({
      scheduleRecurrence: WED_TO_WED,
      scheduleCycle: CYCLE,
      schedulePausedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    render(<SchedulePanel />);

    await userEvent.click(await screen.findByRole('button', { name: /resume|reopen/i }));

    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    expect(savedBody()).toEqual({ schedulePausedUntil: null });
  });

  it('says the boards are paused rather than reporting the cycle they are inside', async () => {
    apiGet.mockResolvedValue(settings({
      scheduleRecurrence: WED_TO_WED,
      scheduleCycle: {
        opensAt: new Date(Date.now() - 3_600_000).toISOString(),
        closesAt: new Date(Date.now() + 7_200_000).toISOString(),
      },
      schedulePausedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    }));

    render(<SchedulePanel />);

    expect(await screen.findByRole('status')).toHaveTextContent(/paused/i);
  });
});
