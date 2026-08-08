'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { field, label, btnPrimary, btnGhost } from '@/components/admin-ui';
import { formatPht } from '@/lib/schedule';
import type { Cycle, ScheduleRecurrence } from '@/lib/schedule-recurrence';
import { scheduleStatus } from '@/lib/schedule-controls';
import { ScheduleStatusLine } from './ScheduleStatusLine';
import { MANILA_TZ_LABEL } from '@/lib/timezone';

// The one shared Group Buy + Hatian schedule.
//
// Four fields, stated the way the business states them: opening day, opening
// time, closing day, closing time. A weekly recurrence rather than a one-off
// window, because the business trades every week and a window that has to be
// re-entered by hand is a storefront one forgotten edit away from being dark.
//
// Nothing is sent that the card has not checked, because a half-set recurrence
// reads as CLOSED everywhere downstream: a save that dropped one field would
// take the whole storefront down while looking like a successful edit.

type Settings = {
  scheduleRecurrence: ScheduleRecurrence;
  schedulePausedUntil: string | null;
  scheduleCycle: Cycle | null;
};

const DAYS = [
  { value: '0', name: 'Sunday' },
  { value: '1', name: 'Monday' },
  { value: '2', name: 'Tuesday' },
  { value: '3', name: 'Wednesday' },
  { value: '4', name: 'Thursday' },
  { value: '5', name: 'Friday' },
  { value: '6', name: 'Saturday' },
] as const;

// How often the live status re-reads the clock. The countdown is shown in
// minutes at its finest, so this is twice the resolution it renders.
const TICK_MS = 30_000;

/** The four fields as the form holds them: strings, empty when unset. */
type Form = { openDay: string; openTime: string; closeDay: string; closeTime: string };

const toForm = (r: ScheduleRecurrence): Form => ({
  openDay: r.openDay == null ? '' : String(r.openDay),
  openTime: r.openTime ?? '',
  closeDay: r.closeDay == null ? '' : String(r.closeDay),
  closeTime: r.closeTime ?? '',
});

export function SchedulePanel() {
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const apply = (s: Settings): void => {
    setSaved(s);
    setForm(toForm(s.scheduleRecurrence));
  };

  useEffect(() => {
    apiGet<Settings>('/admin/settings')
      .then(apply)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the schedule.'));
  }, []);

  // The status is a fact about the clock, not about the last save. Without this
  // the card would go on saying "closes in 2h" long after the boards shut.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { value } = e.target;
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDone(false);
    setError(null);
  };

  // The one way anything reaches the server. The pause controls and the form
  // differ only in what they send; sharing the save means a control cannot skip
  // the error handling or leave the card showing what it hoped for.
  const save = async (body: Record<string, unknown>): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      // Render what the server confirmed, not what was typed: it normalises,
      // and a card showing an entry the server did not store is a card lying.
      apply(await apiSend<Settings>('/admin/settings', 'PATCH', body));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setDone(false);

    const entries = [form.openDay, form.openTime, form.closeDay, form.closeTime].map((v) => v.trim());
    const filled = entries.filter((v) => v !== '').length;

    // Emptying all four is how an admin takes the boards offline — a real
    // instruction, distinct from leaving one field blank by accident.
    if (filled !== 0 && filled !== 4) {
      setError('Set an opening day and time and a closing day and time — a half-set schedule closes both boards.');
      return;
    }

    await save({
      scheduleRecurrence: filled === 0
        ? { openDay: null, openTime: null, closeDay: null, closeTime: null }
        : {
          openDay: Number(form.openDay), openTime: form.openTime,
          closeDay: Number(form.closeDay), closeTime: form.closeTime,
        },
    });
  };

  const status = scheduleStatus(
    { cycle: saved?.scheduleCycle ?? null, pausedUntil: saved?.schedulePausedUntil ?? null },
    now,
  );
  const cycle = saved?.scheduleCycle ?? null;

  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-card">
      <h2 className="mb-1 font-display text-[16px] font-bold text-ink">Storefront schedule</h2>
      <p className="mb-4 text-[13px] text-ink-muted">
        One weekly schedule for both modules — Group Buy and Hatian open and close together,
        automatically, with no manual switch. Times are {MANILA_TZ_LABEL}.
      </p>

      {!form && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}

      {form && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <ScheduleStatusLine status={status} cycle={cycle} />

          {/* What the four fields actually resolve to. "Wednesday to Wednesday"
              is otherwise a claim nobody can check until customers either can
              or cannot reach the boards. */}
          {cycle && (
            <p data-testid="schedule-cycle-preview" className="text-[12px] text-ink-body">
              This cycle: <strong className="font-semibold">{formatPht(cycle.opensAt)}</strong>
              {' → '}
              <strong className="font-semibold">{formatPht(cycle.closesAt)}</strong>
            </p>
          )}

          {/* Taking the boards dark for the rest of THIS cycle is the one
              instruction editing the recurrence cannot express. */}
          <div className="flex flex-wrap items-center gap-2">
            {status.state === 'paused' ? (
              <button type="button" disabled={busy} className={btnGhost}
                onClick={() => save({ schedulePausedUntil: null })}>
                Resume now
              </button>
            ) : status.state === 'open' && cycle && (
              <button type="button" disabled={busy} className={btnGhost}
                onClick={() => save({ schedulePausedUntil: cycle.closesAt })}>
                Close now
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="schedule-open-day">Opening day</label>
              <select id="schedule-open-day" className={field} disabled={busy}
                value={form.openDay} onChange={set('openDay')}>
                <option value="">—</option>
                {DAYS.map((d) => <option key={d.value} value={d.value}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="schedule-open-time">Opening time</label>
              <input id="schedule-open-time" type="time" step={60} className={field}
                disabled={busy} value={form.openTime} onChange={set('openTime')} />
            </div>
            <div>
              <label className={label} htmlFor="schedule-close-day">Closing day</label>
              <select id="schedule-close-day" className={field} disabled={busy}
                value={form.closeDay} onChange={set('closeDay')}>
                <option value="">—</option>
                {DAYS.map((d) => <option key={d.value} value={d.value}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="schedule-close-time">Closing time</label>
              <input id="schedule-close-time" type="time" step={60} className={field}
                disabled={busy} value={form.closeTime} onChange={set('closeTime')} />
            </div>
          </div>

          <span className="text-[12px] text-ink-muted">
            Closing on the same day it opens runs a full week — Wednesday to Wednesday is a
            seven-day cycle. Clear all four fields to take the boards offline.
          </span>

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
