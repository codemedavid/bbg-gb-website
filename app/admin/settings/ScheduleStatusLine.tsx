'use client';
import { formatPht, type GroupBuySchedule } from '@/lib/schedule';
import { formatTimeLeft, type ScheduleState, type ScheduleStatus } from '@/lib/schedule-controls';

// What the shared Group Buy + Hatian window is doing, right now.
//
// Its own component because it is the one line on the settings card that is not
// about editing: everything else says what the window WILL be, and this says
// what customers are seeing while the admin reads it. Each state names the
// consequence — "closed to customers" rather than "scheduled" alone — because
// the failure this card exists to prevent is an admin believing the storefront
// is trading when both boards are dark.

const TONE: Record<ScheduleState, string> = {
  open: 'bg-[#e8f5db] text-brand-greendark',
  scheduled: 'bg-[#dbe8f5] text-brand-navy',
  closed: 'bg-warn-bg text-warn-fg',
  unset: 'bg-warn-bg text-warn-fg',
};

type Props = {
  status: ScheduleStatus;
  /** The window as stored, for the absolute times alongside the countdown. */
  schedule: GroupBuySchedule;
};

/** The headline and the sentence after it, for one state. */
function describe(status: ScheduleStatus, schedule: GroupBuySchedule): [string, string] {
  // A relative countdown answers "do I need to act now"; the absolute instant
  // answers "is that the window I set". Neither alone is enough to trust.
  const left = status.msUntil != null ? formatTimeLeft(status.msUntil) : '';
  switch (status.state) {
    case 'open':
      return ['● Open now', ` — both boards close in ${left} (${formatPht(schedule.closesAt)}).`];
    case 'scheduled':
      return ['○ Scheduled', ` — closed to customers; opens in ${left} (${formatPht(schedule.opensAt)}).`];
    case 'closed':
      return ['○ Closed', ` — the window ended ${formatPht(schedule.closesAt)}. Set the next one below.`];
    case 'unset':
      return ['○ Closed', ' — no window is configured, so both boards are closed to customers right now.'];
  }
}

export function ScheduleStatusLine({ status, schedule }: Props) {
  const [headline, detail] = describe(status, schedule);
  return (
    <div role="status" aria-live="polite"
      className={`rounded-[10px] px-3 py-2 text-[13px] ${TONE[status.state]}`}>
      <span className="font-bold">{headline}</span>{detail}
    </div>
  );
}
