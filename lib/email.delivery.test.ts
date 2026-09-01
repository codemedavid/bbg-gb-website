// What `sendEmail` records about a notification's fate.
//
// The old behaviour wrote one email_log row per notification with `sent_at` set
// and nothing else, whether the mail was transmitted, refused by the SMTP
// server, handed to a PostHog workflow, or dropped because no workflow existed.
// Every one of those looked identical in the table. That is why 144 undelivered
// password resets read as 144 successful sends for two weeks.
//
// PostHog delivers every customer email here, the reset included, so for those
// kinds the *capture* is the send — the caller passes its outcome in and the row
// records that, rather than inventing a success nobody observed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn();
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

const values = vi.fn();
vi.mock('./db', () => ({
  getDb: async () => ({ insert: () => ({ values }) }),
  emailLog: {},
}));

const fakeEnv = {
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  mailFrom: 'BBG Peptides <noreply@bbgph.org>',
  posthogKey: '',
};
vi.mock('./env', () => ({ env: fakeEnv }));

const mail = (kind: string, delivery?: { ok: boolean; error?: string }) => ({
  to: 'ana@example.com', subject: 'Subject', html: '<p>Body</p>', kind, delivery,
});

const loggedRow = () => values.mock.calls[0][0];

beforeEach(() => {
  sendMail.mockReset(); createTransport.mockReset(); values.mockReset();
  sendMail.mockResolvedValue(undefined);
  createTransport.mockReturnValue({ sendMail });
  values.mockResolvedValue(undefined);
  fakeEnv.smtpHost = '';
  fakeEnv.posthogKey = '';
  // The module memoises its transport; drop it between tests.
  vi.resetModules();
});

describe('sendEmail delivery routing', () => {
  // SMTP_KINDS is empty: PostHog owns every customer email. Transmitting one
  // from here as well would put two copies of it in the inbox.
  it('transmits nothing itself, even for the reset, even with SMTP configured', async () => {
    fakeEnv.smtpHost = 'smtp.gmail.com';
    const { sendEmail } = await import('./email');

    await sendEmail(mail('password_reset'));
    await sendEmail(mail('order_receipt'));

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('records every email in the log whether or not it was transmitted', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(mail('password_reset'));
    await sendEmail(mail('order_receipt'));

    expect(values).toHaveBeenCalledTimes(2);
    expect(loggedRow()).toMatchObject({
      toEmail: 'ana@example.com', kind: 'password_reset', subject: 'Subject',
    });
  });
});

describe('sendEmail delivery status', () => {
  it('records a PostHog-delivered mail as sent when the capture succeeded', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(mail('password_reset', { ok: true }));

    expect(loggedRow()).toMatchObject({
      kind: 'password_reset', deliveredBy: 'posthog', status: 'sent', error: null,
    });
  });

  // The failure this whole change exists to surface. A reset the customer never
  // got must not read the same as one they did.
  it('records the capture failure, with its reason, when PostHog refused the event', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(mail('password_reset', { ok: false, error: 'network down' }));

    expect(loggedRow()).toMatchObject({
      kind: 'password_reset', deliveredBy: 'posthog', status: 'failed',
    });
    expect(loggedRow().error).toContain('network down');
  });

  // A caller that emits its event separately hands nothing in. The row says the
  // mail was handed to PostHog and stops there — it does not claim delivery.
  it('records a hand-off as queued when PostHog is configured and no outcome was given', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { sendEmail } = await import('./email');

    await sendEmail(mail('order_receipt'));

    expect(loggedRow()).toMatchObject({ deliveredBy: 'posthog', status: 'queued' });
  });

  // POSTHOG_KEY unset is the local/dev state — and also what production looked
  // like the whole time nobody could work out why no mail arrived.
  it('records nothing-was-sent as skipped when PostHog is unconfigured', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(mail('order_receipt'));

    expect(loggedRow()).toMatchObject({ deliveredBy: 'posthog', status: 'skipped' });
  });

  // settlement_confirmed writes a row and emits no event, so no workflow can
  // ever send it. The row now says so out loud instead of looking delivered.
  it('records a kind with no delivery route as undeliverable, naming the kind', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(mail('settlement_confirmed'));

    expect(loggedRow()).toMatchObject({ deliveredBy: 'none', status: 'undeliverable' });
    expect(loggedRow().error).toContain('settlement_confirmed');
  });

  it('never throws — /api/auth/forgot-password answers every address identically', async () => {
    const { sendEmail } = await import('./email');

    await expect(sendEmail(mail('password_reset', { ok: false, error: 'boom' })))
      .resolves.toBeUndefined();
    expect(values).toHaveBeenCalledTimes(1);
  });
});
