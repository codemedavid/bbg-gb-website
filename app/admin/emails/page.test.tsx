// Admin → Emails. The screen that answers "did the reset link actually go out?"
//
// Nothing in the product could answer that before. The audit table recorded a
// row per notification and said nothing about delivery, there is no Vercel log
// access here, and so a two-week outage of the password reset was invisible
// until customers complained. This page exists to make the next one obvious.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

type Row = {
  id: string; toEmail: string; subject: string; kind: string;
  deliveredBy: string; status: string; error: string | null; sentAt: string;
};

const feed: { rows: Row[]; isLoading: boolean } = { rows: [], isLoading: false };
vi.mock('@/lib/admin-api', () => ({
  useAdminEmails: () => ({ data: feed.rows, isLoading: feed.isLoading }),
}));

const Page = (await import('./page')).default;

const row = (over: Partial<Row> = {}): Row => ({
  id: over.id ?? crypto.randomUUID(),
  toEmail: 'ana@bbg.test',
  subject: 'Reset your BBG Peptides password',
  kind: 'password_reset',
  deliveredBy: 'posthog',
  status: 'sent',
  error: null,
  sentAt: '2026-09-02T04:00:00.000Z',
  ...over,
});

beforeEach(() => { feed.rows = []; feed.isLoading = false; });

describe('AdminEmailsPage', () => {
  it('shows who each notification went to and what became of it', () => {
    feed.rows = [row()];
    render(<Page />);

    expect(screen.getByText('ana@bbg.test')).toBeInTheDocument();
    expect(screen.getByText(/sent/i)).toBeInTheDocument();
  });

  // The whole point: a failure must not read like a success at a glance.
  it('shows the reason a delivery failed', () => {
    feed.rows = [row({ status: 'failed', error: 'network down' })];
    render(<Page />);

    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it('names a kind that nothing delivers as undeliverable', () => {
    feed.rows = [row({ kind: 'settlement_confirmed', status: 'undeliverable', deliveredBy: 'none' })];
    render(<Page />);

    expect(screen.getByText(/undeliverable/i)).toBeInTheDocument();
  });

  // An admin lands here because something is wrong, so the count of what is
  // wrong is the first thing on the page.
  it('leads with how many deliveries are not confirmed', () => {
    feed.rows = [
      row({ status: 'sent' }),
      row({ status: 'failed', error: 'network down' }),
      row({ status: 'undeliverable' }),
      row({ status: 'skipped' }),
    ];
    render(<Page />);

    expect(screen.getByTestId('email-problem-count')).toHaveTextContent('3');
  });

  it('says so plainly when nothing has been logged yet', () => {
    render(<Page />);

    expect(screen.getByText(/no emails/i)).toBeInTheDocument();
  });
});
