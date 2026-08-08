'use client';
import { formatPht } from '@/lib/schedule';
import type { Cycle } from '@/lib/schedule-recurrence';
import { formatTimeLeft, type ScheduleState, type ScheduleStatus } from '@/lib/schedule-controls';

// What the shared Group Buy + Hatian schedule is doing, right now.
//
// Its own component because it is the one line on the settings card that is not
// about editing: everything else says what the schedule WILL be, and this says
// what customers are seeing while the admin reads it. Each state names the
// consequence — "closed to customers" rather than "scheduled" alone — because
// the failure this card exists to prevent is an admin believing the storefront
// is trading when both boards are dark.

const TONE: Record<ScheduleState, string> = {
  open: 'bg-[#e8f5db] text-brand-greendark',
  scheduled: 'bg-[#dbe8f5] text-brand-navy',
  paused: 'bg-warn-bg text-warn-fg',
  unset: 'bg-warn-bg text-warn-fg',
};

type Props = {
  status: ScheduleStatus;
  /** The resolved cycle, for the absolute instants alongside the countdown. */
  cycle: Cycle | null;
};

/** The headline and the sentence after it, for one state. */
function describe(status: ScheduleStatus, cycle: Cycle | null): [string, string] {
  // A relative countdown answers "do I need to act now"; the absolute instant
  // answers "is that the schedule I set". Neither alone is enough to trust.
  const left = status.msUntil != null ? formatTimeLeft(status.msUntil) : '';
  switch (status.state) {
    case 'open':
      return ['● Open now', ` — both boards close in ${left} (${formatPht(cycle?.closesAt ?? null)}).`];
    case 'scheduled':
      return ['○ Closed', ` — opens in ${left} (${formatPht(cycle?.opensAt ?? null)}).`];
    case 'paused':
      return ['○ Paused', ` — closed to customers by hand; the next cycle opens on schedule in ${left}.`];
    case 'unset':
      return ['○ Closed', ' — no schedule is configured, so both boards are closed to customers right now.'];
  }
}

export function ScheduleStatusLine({ status, cycle }: Props) {
  const [headline, detail] = describe(status, cycle);
  return (
    <div role="status" aria-live="polite"
      className={`rounded-[10px] px-3 py-2 text-[13px] ${TONE[status.state]}`}>
      <span className="font-bold">{headline}</span>{detail}
    </div>
  );
}
