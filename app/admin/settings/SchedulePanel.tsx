'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { field, label, btnPrimary, btnGhost } from '@/components/admin-ui';
import { isoToPhtLocal, phtLocalToIso, type GroupBuySchedule } from '@/lib/schedule';
import {
  scheduleStatus, windowOpeningNow, windowStartedNow, windowClosedNow,
} from '@/lib/schedule-controls';
import { ScheduleStatusLine } from './ScheduleStatusLine';
import { MANILA_TZ_LABEL } from '@/lib/timezone';

// The one shared Group Buy + Hatian window.
//
// The entries are Philippine time and the wire is UTC instants, so the
// conversion happens at this boundary and nowhere else — lib/schedule.ts owns
// it, and the card never does date arithmetic of its own. The single most
// expensive bug available here is posting the admin's "09:00" as 9am UTC, which
// opens both boards eight hours late every week without ever looking broken.
//
// Nothing is sent that the card has not checked, because a half-written window
// reads as CLOSED everywhere downstream: a save that dropped one end would take
// the whole storefront down while looking like a successful edit.

/** A `datetime-local` value, tolerating a browser that appends seconds. */
const entry = (value: string): string => value.slice(0, 16);

type Loaded = { opens: string; closes: string };

// How often the live status re-reads the clock. The countdown is shown in
// minutes at its finest, so this is twice the resolution it renders — enough
// that "under a minute" turns into "closed" promptly without re-rendering the
// card every second for a line that would not change.
const TICK_MS = 30_000;

/** The runs offered by the one-tap presets, in days. */
const PRESET_DAYS = [3, 7, 14] as const;

export function SchedulePanel() {
  const [form, setForm] = useState<Loaded | null>(null);
  const [saved, setSaved] = useState<GroupBuySchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const apply = (schedule: GroupBuySchedule): void => {
    setSaved(schedule);
    setForm({ opens: isoToPhtLocal(schedule.opensAt), closes: isoToPhtLocal(schedule.closesAt) });
  };

  useEffect(() => {
    apiGet<{ groupBuySchedule: GroupBuySchedule }>('/admin/settings')
      .then((d) => apply(d.groupBuySchedule))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the schedule.'));
  }, []);

  // The status is a fact about the clock, not about the last save. Without this
  // the card would go on saying "closes in 2h" long after the boards shut, and
  // the admin would read a live storefront off a stale render.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const set = (key: keyof Loaded) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = entry(e.target.value);
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDone(false);
    setError(null);
  };

  // The one way a window reaches the server. The quick controls and the form
  // differ only in how they arrive at `next`; sharing the save means a control
  // cannot skip the error handling or leave the card showing what it hoped for.
  const save = async (next: GroupBuySchedule): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const d = await apiSend<{ groupBuySchedule: GroupBuySchedule }>(
        '/admin/settings', 'PATCH', { groupBuySchedule: next },
      );
      // Render what the server confirmed, not what was typed: it normalises,
      // and a card showing an entry the server did not store is a card lying.
      apply(d.groupBuySchedule);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  };

  // A control acts on the window as stored, at the instant it is pressed —
  // never on the entries, which may hold an edit the admin has not saved.
  const runControl = (build: (schedule: GroupBuySchedule) => GroupBuySchedule) => async () => {
    if (busy) return;
    setDone(false);
    try {
      await save(build(saved ?? { opensAt: null, closesAt: null }));
    } catch (err) {
      // The controls refuse to build a window the server would reject; that
      // refusal is the message, and nothing is sent.
      setError(err instanceof Error ? err.message : 'That is not a window we can set.');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setDone(false);

    const opens = form.opens.trim();
    const closes = form.closes.trim();

    // Emptying both is how an admin unsets the schedule — a real instruction,
    // distinct from leaving one end blank by accident.
    let next: GroupBuySchedule;
    if (!opens && !closes) {
      next = { opensAt: null, closesAt: null };
    } else {
      if (!opens || !closes) {
        setError('Set both an opening and a closing time — a half-set window closes both boards.');
        return;
      }
      const opensAt = phtLocalToIso(opens);
      const closesAt = phtLocalToIso(closes);
      if (!opensAt || !closesAt) {
        setError('Enter both times as a valid date and time.');
        return;
      }
      if (Date.parse(opensAt) >= Date.parse(closesAt)) {
        setError('The closing time must come after the opening time.');
        return;
      }
      next = { opensAt, closesAt };
    }

    await save(next);
  };

  const status = saved ? scheduleStatus(saved, now) : null;

  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-card">
      <h2 className="mb-1 font-display text-[16px] font-bold text-ink">Storefront schedule</h2>
      <p className="mb-4 text-[13px] text-ink-muted">
        One window for both modules — Group Buy and Hatian open and close together, automatically, with no
        manual switch. Times are {MANILA_TZ_LABEL}.
      </p>

      {!form && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}

      {form && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {status && saved && <ScheduleStatusLine status={status} schedule={saved} />}

          {/* The fast path. Absolute times are the precise way to say when both
              boards trade; these are for the admin who means "today" or "stop",
              and who should not have to reach that through a date picker. */}
          <div className="flex flex-wrap items-center gap-2">
            {status?.state === 'scheduled' && (
              <button type="button" disabled={busy} className={btnGhost}
                onClick={runControl((s) => windowStartedNow(s, new Date()))}>
                Open now
              </button>
            )}
            {(status?.state === 'open' || status?.state === 'scheduled') && (
              <button type="button" disabled={busy} className={btnGhost}
                onClick={runControl((s) => windowClosedNow(s, new Date()))}>
                Close now
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-ink-body">
              {status?.state === 'open' ? 'Replace with a run of:' : 'Start a window running for:'}
            </span>
            {PRESET_DAYS.map((days) => (
              <button key={days} type="button" disabled={busy} className={btnGhost}
                onClick={runControl(() => windowOpeningNow(days, new Date()))}>
                {days} days
              </button>
            ))}
          </div>

          <div>
            <label className={label} htmlFor="schedule-opens">Opens</label>
            <input id="schedule-opens" type="datetime-local" step={60} className={field}
              disabled={busy} value={form.opens} onChange={set('opens')} />
          </div>
          <div>
            <label className={label} htmlFor="schedule-closes">Closes</label>
            <input id="schedule-closes" type="datetime-local" step={60} className={field}
              disabled={busy} value={form.closes} onChange={set('closes')} />
            <span className="mt-0.5 block text-[12px] text-ink-muted">
              Clear both fields to take the boards offline until the next window is set.
            </span>
          </div>

          {done && (
            <p className="rounded-[10px] bg-[#e8f5db] px-3 py-2 text-[13px] text-brand-greendark">
              Schedule saved ✓
            </p>
          )}
          <button type="submit" disabled={busy} className={`mt-1 ${btnPrimary}`}>
            {busy ? 'Saving…' : 'Update schedule'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>
      )}
    </div>
  );
}
