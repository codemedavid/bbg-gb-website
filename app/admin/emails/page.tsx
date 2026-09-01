'use client';
import { useState } from 'react';
import { useAdminEmails } from '@/lib/admin-api';
import { PROBLEM_STATUSES, type DeliveryStatus } from '@/lib/email-delivery';

// Admin → Emails: what became of every notification the shop composed.
//
// The screen exists because nothing else could answer "did the reset link go
// out?". email_log recorded that a mail had been written and nothing about
// whether it was delivered; this project has no Vercel log access, so a failed
// send's console.error reached nobody. 144 password resets went undelivered for
// two weeks and the first signal was customers complaining.
//
// So the page opens on the problems, not on a tidy chronological list.

const STATUS_STYLE: Record<string, { chip: string; label: string }> = {
  sent: { chip: 'bg-[#e8f5db] text-[#2c6b1f]', label: 'Sent' },
  queued: { chip: 'bg-[#e4ecff] text-[#0b46b8]', label: 'Queued' },
  failed: { chip: 'bg-[#f6e0e0] text-[#b23b3b]', label: 'Failed' },
  skipped: { chip: 'bg-[#fdf0d5] text-[#8a5a00]', label: 'Skipped' },
  undeliverable: { chip: 'bg-[#f6e0e0] text-[#b23b3b]', label: 'Undeliverable' },
  unknown: { chip: 'bg-line text-ink-body', label: 'Unknown' },
};

const FILTERS = [
  ['', 'All'],
  ['failed', 'Failed'],
  ['undeliverable', 'Undeliverable'],
  ['skipped', 'Skipped'],
  ['sent', 'Sent'],
] as const;

const isProblem = (status: string) => PROBLEM_STATUSES.has(status as DeliveryStatus);

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminEmailsPage() {
  const [status, setStatus] = useState('');
  const { data: emails = [], isLoading } = useAdminEmails(status || undefined);

  const problems = emails.filter((e) => isProblem(e.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-[24px] font-bold">Emails</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Every notification the shop composed, and whether it was actually delivered.
        </p>
      </div>

      {/* The count leads because an admin arrives here when something is wrong. */}
      <div className={`rounded-[12px] px-4 py-3.5 text-[13px] ${problems ? 'bg-[#f6e0e0] text-[#b23b3b]' : 'bg-[#e8f5db] text-[#2c6b1f]'}`}>
        <strong data-testid="email-problem-count">{problems}</strong>
        {problems === 1 ? ' delivery is' : ' deliveries are'} not confirmed
        {problems > 0 && ' — those customers may never have received their email.'}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([val, lbl]) => (
          <button key={val} onClick={() => setStatus(val)}
            aria-pressed={status === val}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${status === val ? 'bg-brand-navy text-white' : 'bg-white text-ink-body'}`}>{lbl}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-[13px] text-ink-muted">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="rounded-[12px] bg-white px-4 py-8 text-center text-[13px] text-ink-muted">
          No emails logged yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] bg-white">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold">Notification</th>
                <th className="px-4 py-3 font-semibold">Delivery</th>
                <th className="px-4 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => {
                const style = STATUS_STYLE[e.status] ?? STATUS_STYLE.unknown;
                return (
                  <tr key={e.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-4 py-3 font-semibold text-ink-body">{e.toEmail}</td>
                    <td className="px-4 py-3">
                      <div className="text-ink-body">{e.subject}</div>
                      <div className="mt-0.5 text-[12px] text-ink-muted">{e.kind}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-bold ${style.chip}`}>
                        {style.label}
                      </span>
                      <div className="mt-0.5 text-[12px] text-ink-muted">via {e.deliveredBy}</div>
                      {/* The reason is the whole value of the row when it failed. */}
                      {e.error && <div className="mt-1 max-w-[320px] text-[12px] text-[#b23b3b]">{e.error}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{stamp(e.sentAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
