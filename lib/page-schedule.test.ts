// The weekly open/close window for a storefront page, in Philippine time.
//
// Every instant here is written as a UTC literal with its PHT meaning in the
// comment, so the suite proves the same thing whatever TZ the machine running it
// happens to be in. Asia/Manila has been a flat UTC+8 with no DST since 1978,
// but the engine still resolves through Intl rather than adding 8 hours — a
// hardcoded offset is a silent bug the day that stops being true, and it would
// not be caught by tests that hardcode the same assumption.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SCHEDULE,
  manilaWeekMinute,
  timeToMinutes,
  isWithinWindow,
  resolvePageVisibility,
  nextTransition,
  type PageSchedule,
} from './page-schedule';

// Sunday 00:00 PHT is minute 0.
const SUN = 0, WED = 3 * 1440, SAT = 6 * 1440;

// The business default: opens Wednesday 00:00 PHT, closes Saturday 12:00 PHT.
const schedule = (o: Partial<PageSchedule> = {}): PageSchedule => ({
  autoEnabled: true,
  visible: true,
  override: 'none',
  openDay: 3, openTime: '00:00',
  closeDay: 6, closeTime: '12:00',
  ...o,
});

// Instants, named by what they are in Manila.
const WED_MIDNIGHT = new Date('2026-07-28T16:00:00Z');   // Wed Jul 29 00:00 PHT
const TUE_2359 = new Date('2026-07-28T15:59:00Z');       // Tue Jul 28 23:59 PHT
const FRI_NOON = new Date('2026-07-31T04:00:00Z');       // Fri Jul 31 12:00 PHT
const SAT_1159 = new Date('2026-08-01T03:59:00Z');       // Sat Aug  1 11:59 PHT
const SAT_NOON = new Date('2026-08-01T04:00:00Z');       // Sat Aug  1 12:00 PHT

describe('manilaWeekMinute', () => {
  it('reads the Manila weekday and clock, not the machine timezone', () => {
    // 16:00Z on a Tuesday is already Wednesday in Manila. A resolver that used
    // the host clock would call this Tuesday everywhere west of UTC+8.
    expect(manilaWeekMinute(WED_MIDNIGHT)).toBe(WED);
  });

  it('places Saturday noon at its week minute', () => {
    expect(manilaWeekMinute(SAT_NOON)).toBe(SAT + 720);
  });

  it('wraps Sunday 00:00 PHT back to minute zero', () => {
    // Sat Aug 1 16:00Z = Sun Aug 2 00:00 PHT — the start of the week, not its end.
    expect(manilaWeekMinute(new Date('2026-08-01T16:00:00Z'))).toBe(SUN);
  });

  it('stays inside the week', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-06-15T12:34:00Z', '2026-12-31T23:59:00Z']) {
      const m = manilaWeekMinute(new Date(iso));
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(7 * 1440);
    }
  });
});

describe('timeToMinutes', () => {
  it('reads a 24-hour clock string', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('12:00')).toBe(720);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(timeToMinutes('9:05')).toBe(545);
  });

  it('reads an unparseable time as midnight rather than NaN', () => {
    // These reach the engine from a hand-edited settings row, not from the admin
    // form. NaN would poison every comparison downstream and leave the window
    // neither open nor closed; midnight is wrong but coherent, and the admin
    // sees a status badge that plainly disagrees with what they meant.
    for (const bad of ['', 'noon', '12', '12:00:00', 'aa:bb']) {
      expect(timeToMinutes(bad)).toBe(0);
    }
  });

  it('clamps a time outside the clock instead of overflowing the day', () => {
    // 99:99 would otherwise be minute 6039 — nearly halfway into the next day,
    // silently moving the boundary to a different weekday.
    expect(timeToMinutes('99:99')).toBe(23 * 60 + 59);
  });
});

describe('isWithinWindow', () => {
  it('includes the opening minute and excludes the closing minute', () => {
    // A window that included both ends would leave the page live for one minute
    // after it was meant to shut.
    expect(isWithinWindow(WED, SAT + 720, WED)).toBe(true);
    expect(isWithinWindow(WED, SAT + 720, SAT + 720)).toBe(false);
  });

  it('is closed on either side of the window', () => {
    expect(isWithinWindow(WED, SAT + 720, WED - 1)).toBe(false);
    expect(isWithinWindow(WED, SAT + 720, SAT + 721)).toBe(false);
  });

  it('spans the week boundary when the window wraps', () => {
    // Saturday noon through Wednesday midnight: open across Sunday, which is
    // week minute 0. A plain `open <= now && now < close` reads this as closed
    // for the whole weekend.
    const open = SAT + 720, close = WED;
    expect(isWithinWindow(open, close, SAT + 800)).toBe(true);  // Saturday evening
    expect(isWithinWindow(open, close, SUN + 60)).toBe(true);   // Sunday 01:00
    expect(isWithinWindow(open, close, 2 * 1440)).toBe(true);   // Tuesday 00:00
    expect(isWithinWindow(open, close, WED + 60)).toBe(false);  // Wednesday 01:00
  });

  it('treats an empty window as always open', () => {
    // open === close describes no boundary at all. Read as "never open" it would
    // silently hide a page whose admin only meant to leave the times untouched,
    // which is the failure this module is built to avoid.
    expect(isWithinWindow(WED, WED, SAT)).toBe(true);
    expect(isWithinWindow(WED, WED, WED)).toBe(true);
  });
});

describe('resolvePageVisibility', () => {
  it('opens the page inside the configured window', () => {
    expect(resolvePageVisibility(schedule(), FRI_NOON)).toEqual({ open: true, reason: 'schedule' });
  });

  it('closes the page outside the configured window', () => {
    expect(resolvePageVisibility(schedule(), TUE_2359)).toEqual({ open: false, reason: 'schedule' });
  });

  it('opens exactly at the opening minute and closes exactly at the closing minute', () => {
    expect(resolvePageVisibility(schedule(), WED_MIDNIGHT).open).toBe(true);
    expect(resolvePageVisibility(schedule(), SAT_1159).open).toBe(true);
    expect(resolvePageVisibility(schedule(), SAT_NOON).open).toBe(false);
  });

  it('lets a show override beat a schedule that says closed', () => {
    // The late-orders case: the window shut at noon and the admin wants the page
    // back without editing the schedule everyone else relies on.
    expect(resolvePageVisibility(schedule({ override: 'show' }), SAT_NOON))
      .toEqual({ open: true, reason: 'override' });
  });

  it('lets a hide override beat a schedule that says open', () => {
    expect(resolvePageVisibility(schedule({ override: 'hide' }), FRI_NOON))
      .toEqual({ open: false, reason: 'override' });
  });

  it('resumes the schedule when the override is released', () => {
    const overridden = schedule({ override: 'show' });
    expect(resolvePageVisibility(overridden, SAT_NOON).open).toBe(true);
    expect(resolvePageVisibility({ ...overridden, override: 'none' }, SAT_NOON))
      .toEqual({ open: false, reason: 'schedule' });
  });

  it('falls back to the plain visibility flag when automatic scheduling is off', () => {
    // Scheduling off is not "always open" — it hands control back to the ON/OFF
    // switch, exactly like the MOQ page.
    expect(resolvePageVisibility(schedule({ autoEnabled: false, visible: true }), TUE_2359))
      .toEqual({ open: true, reason: 'manual' });
    expect(resolvePageVisibility(schedule({ autoEnabled: false, visible: false }), FRI_NOON))
      .toEqual({ open: false, reason: 'manual' });
  });

  it('ignores the plain visibility flag while the schedule is in charge', () => {
    // Otherwise an admin who left the switch off months ago would find the
    // schedule silently doing nothing.
    expect(resolvePageVisibility(schedule({ visible: false }), FRI_NOON).open).toBe(true);
  });

  it('resolves the same instant identically for every customer', () => {
    // Same Date, therefore same answer — a customer in Los Angeles and one in
    // Manila see the page open and shut at the same moment.
    const s = schedule();
    expect(resolvePageVisibility(s, SAT_1159).open).toBe(true);
    expect(resolvePageVisibility(s, new Date(SAT_1159.toISOString())).open).toBe(true);
  });
});

describe('DEFAULT_PAGE_SCHEDULE', () => {
  it('leaves the page visible with automatic scheduling off', () => {
    // What an empty settings table yields. /groupbuy and /kahati are live pages
    // today, so the absent-config state has to be the state they are already in;
    // anything else means shipping this feature hides two working pages.
    expect(DEFAULT_PAGE_SCHEDULE.autoEnabled).toBe(false);
    expect(DEFAULT_PAGE_SCHEDULE.visible).toBe(true);
    expect(DEFAULT_PAGE_SCHEDULE.override).toBe('none');
    expect(resolvePageVisibility(DEFAULT_PAGE_SCHEDULE, TUE_2359))
      .toEqual({ open: true, reason: 'manual' });
  });

  it('carries the business window ready to be switched on', () => {
    expect(DEFAULT_PAGE_SCHEDULE.openDay).toBe(3);
    expect(DEFAULT_PAGE_SCHEDULE.openTime).toBe('00:00');
    expect(DEFAULT_PAGE_SCHEDULE.closeDay).toBe(6);
    expect(DEFAULT_PAGE_SCHEDULE.closeTime).toBe('12:00');
  });
});

describe('nextTransition', () => {
  it('returns the closing instant while the page is open', () => {
    expect(nextTransition(schedule(), FRI_NOON)?.toISOString()).toBe(SAT_NOON.toISOString());
  });

  it('returns the opening instant while the page is closed', () => {
    expect(nextTransition(schedule(), TUE_2359)?.toISOString()).toBe(WED_MIDNIGHT.toISOString());
  });

  it('reports the next opening when called exactly on the closing minute', () => {
    // At the closing minute the page has just shut, so the transition to report
    // is the following Wednesday — not this instant, which would render as a
    // countdown frozen at zero.
    expect(nextTransition(schedule(), SAT_NOON)?.toISOString())
      .toBe('2026-08-04T16:00:00.000Z'); // Wed Aug 5 00:00 PHT
  });

  it('reports the closing when called exactly on the opening minute', () => {
    // The mirror case: at the opening minute the page has just opened, so the
    // boundary ahead is its close. Between the two, a transition is never zero
    // minutes away and the countdown never stalls.
    expect(nextTransition(schedule(), WED_MIDNIGHT)?.toISOString())
      .toBe('2026-08-01T04:00:00.000Z'); // Sat Aug 1 12:00 PHT
  });

  it('ignores seconds within the current minute', () => {
    // The boundary lands on a whole PHT minute; carrying the caller's seconds
    // through would put every transition seconds late.
    const withSeconds = new Date('2026-07-31T04:00:37Z'); // Fri 12:00:37 PHT
    expect(nextTransition(schedule(), withSeconds)?.toISOString()).toBe(SAT_NOON.toISOString());
  });

  it('has nothing to report while an override is in force', () => {
    // The schedule is not driving, so naming a moment it would flip would be a
    // countdown to something that will not happen.
    expect(nextTransition(schedule({ override: 'show' }), FRI_NOON)).toBeNull();
  });

  it('has nothing to report when automatic scheduling is off', () => {
    expect(nextTransition(schedule({ autoEnabled: false }), FRI_NOON)).toBeNull();
  });

  it('has nothing to report for a window with no boundary', () => {
    // open === close is always open (see isWithinWindow), so there is no moment
    // at which it flips — a countdown here would be counting to nothing.
    const empty = schedule({ openDay: 3, openTime: '00:00', closeDay: 3, closeTime: '00:00' });
    expect(resolvePageVisibility(empty, TUE_2359).open).toBe(true);
    expect(nextTransition(empty, FRI_NOON)).toBeNull();
  });
});
