// Email notifications. Uses SMTP when configured; otherwise logs to console and the
// email_log table so the flow works offline. Triggered on order placement + status changes.
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';
import { getDb, emailLog } from './db';

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!env.smtpHost) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transport;
}

export async function sendEmail(opts: { to: string; subject: string; html: string; kind: string }): Promise<void> {
  const t = getTransport();
  try {
    if (t) {
      await t.sendMail({ from: env.mailFrom, to: opts.to, subject: opts.subject, html: opts.html });
    } else {
      console.log(`\n[email:${opts.kind}] -> ${opts.to}\n  ${opts.subject}`);
    }
  } catch (err) {
    console.error('[email] send failed:', err);
  }
  // Always record the notification for auditing/history.
  const db = await getDb();
  await db.insert(emailLog).values({
    toEmail: opts.to, subject: opts.subject, body: opts.html, kind: opts.kind,
  }).catch(() => {});
}

const php = (n: number) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: n % 1 ? 2 : 0 });
const wrap = (title: string, body: string) => `
  <div style="font-family:Barlow,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c2b26">
    <div style="background:#0a1f44;padding:18px 20px;border-radius:12px 12px 0 0">
      <span style="color:#fff;font-weight:700;font-size:18px">BBG Peptides</span>
    </div>
    <div style="background:#f4f7f1;padding:22px 20px;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 10px;font-size:18px">${title}</h2>${body}
      <p style="color:#7a877f;font-size:12px;margin-top:20px">This is an automated update from BBG Peptides.</p>
    </div>
  </div>`;

export function orderPlacedEmail(o: { name: string; orderNo: string; total: number }) {
  return {
    subject: `Order ${o.orderNo} received - payment under review`,
    html: wrap(`Salamat, ${o.name}!`, `
      <p>We received order <strong>${o.orderNo}</strong> for <strong>${php(o.total)}</strong>.</p>
      <p>Our team will verify your payment proof within 24 hours. You'll get another email once it's confirmed.</p>`),
  };
}

const STATUS_COPY: Record<string, { title: string; line: string }> = {
  payment_confirmed: { title: 'Payment confirmed', line: 'Your payment is verified. Your order is now queued for batch filling.' },
  batch_filling: { title: 'Batch filling', line: 'Your vials are being filled and prepared for shipment.' },
  shipped: { title: 'Shipped', line: 'Your order is on its way!' },
  delivered: { title: 'Delivered', line: 'Your order has been delivered. Salamat sa pagtitiwala!' },
  cancelled: { title: 'Order cancelled', line: 'Your order has been cancelled. Contact us if this is unexpected.' },
};

export function orderStatusEmail(o: { name: string; orderNo: string; status: string; trackingNo?: string | null }) {
  const c = STATUS_COPY[o.status] || { title: 'Order update', line: `Your order status is now: ${o.status}.` };
  const track = o.trackingNo ? `<p style="background:#e8f5db;padding:10px 12px;border-radius:8px">Tracking: <strong>${o.trackingNo}</strong></p>` : '';
  return { subject: `Order ${o.orderNo} - ${c.title}`, html: wrap(c.title, `<p>Hi ${o.name},</p><p>${c.line}</p>${track}<p>Order: <strong>${o.orderNo}</strong></p>`) };
}
