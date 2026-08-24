// Email notifications. Uses SMTP when configured; otherwise logs to console and the
// email_log table so the flow works offline. Triggered on order placement + status changes.
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';
import { getDb, emailLog } from './db';
import { collectedAmountLabel } from './kahati-downpayment';

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
const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
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

// The forgotten-password link. Unlike every other mail here this one carries a
// credential, so it says plainly how long it lives and what to do if the
// customer did not ask for it — an unexpected reset mail is the first sign
// someone else is trying the account.
export function passwordResetEmail(o: { name: string; resetUrl: string; expiresInMinutes: number }) {
  const href = escapeHtml(o.resetUrl);
  return {
    subject: 'Reset your BBG Peptides password',
    html: wrap('Reset your password', `
      <p>Hi ${escapeHtml(o.name)},</p>
      <p>We got a request to reset the password for this account. Tap the button below to choose a new one.</p>
      <p style="margin:18px 0">
        <a href="${href}" style="background:#1f7a4d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">Reset password</a>
      </p>
      <p style="font-size:12.5px;color:#7a877f">Or paste this link into your browser:<br><span style="word-break:break-all">${href}</span></p>
      <p>This link works once and expires in <strong>${o.expiresInMinutes} minutes</strong>.</p>
      <p>Hindi ikaw ang humiling? Ignore this email — your password stays as it is.</p>`),
  };
}

// `confirmed` marks a commitment that owed nothing at checkout, because the
// customer already had a kahati commitment in progress. Promising to "verify
// your payment proof" there would be a review of a payment nobody made.
export function orderPlacedEmail(o: {
  name: string; orderNo: string; total: number; downpayment?: number; confirmed?: boolean;
  subtotal?: number; packingFee?: number;
  items?: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
}) {
  // Named for what it actually was. A commitment that paid only the cycle's
  // packing fee says so; one that paid a configured deposit says "Downpayment",
  // because a receipt calling a ₱500 deposit a "packing fee" is a receipt the
  // customer will query.
  const downpaymentLine = o.downpayment && o.downpayment > 0
    ? `<p>${collectedAmountLabel(o.downpayment, o.packingFee ?? 0).replace(' paid', ' received')}: <strong>${php(o.downpayment)}</strong> · Balance after the kahati ends: <strong>${php(o.total - o.downpayment)}</strong></p>`
    : '';
  const receipt = o.items?.length ? `
    <div style="margin:16px 0;padding:12px;background:#fff;border-radius:8px">
      <div style="font-weight:700;margin-bottom:8px">Receipt</div>
      ${o.items.map((item) => `<div style="display:flex;justify-content:space-between;gap:12px;margin:5px 0">
        <span>${escapeHtml(item.name)} × ${item.qty}</span><strong>${php(item.lineTotal)}</strong>
      </div>`).join('')}
      ${o.subtotal != null ? `<div style="display:flex;justify-content:space-between;border-top:1px solid #dfe6dc;padding-top:7px;margin-top:7px"><span>Subtotal</span><span>${php(o.subtotal)}</span></div>` : ''}
      ${o.packingFee ? `<div style="display:flex;justify-content:space-between"><span>Packing fee</span><span>${php(o.packingFee)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:5px"><span>Total</span><span>${php(o.total)}</span></div>
    </div>` : '';
  if (o.confirmed) {
    return {
      subject: `Order ${o.orderNo} confirmed - no payment needed now`,
      html: wrap(`Salamat, ${o.name}!`, `
        <p>Order <strong>${escapeHtml(o.orderNo)}</strong> for <strong>${php(o.total)}</strong> is confirmed.</p>${receipt}
        <p>Walang bayad muna: may kahati ka nang ongoing, kaya hindi na kailangan ng panibagong downpayment.
        Isang bayad na lang sa huling checkout kapag tapos na ang lahat ng hatian mo.</p>`),
    };
  }
  return {
    subject: `Order ${o.orderNo} received - payment under review`,
    html: wrap(`Salamat, ${o.name}!`, `
      <p>We received order <strong>${escapeHtml(o.orderNo)}</strong> for <strong>${php(o.total)}</strong>.</p>${receipt}${downpaymentLine}
      <p>Our team will verify your payment proof within 24 hours. You'll get another email once it's confirmed.</p>`),
  };
}

export function orderUpdatedEmail(o: {
  name: string; orderNo: string; subtotal: number; packingFee: number; total: number;
  items: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
}) {
  const rows = o.items.map((item) => `<div style="display:flex;justify-content:space-between;gap:12px;margin:5px 0">
    <span>${escapeHtml(item.name)} × ${item.qty}</span><strong>${php(item.lineTotal)}</strong>
  </div>`).join('');
  const fee = o.packingFee > 0
    ? `<div style="display:flex;justify-content:space-between"><span>Packing fee</span><span>${php(o.packingFee)}</span></div>`
    : '';
  return {
    subject: `Updated receipt for order ${o.orderNo}`,
    html: wrap('Your order was updated', `
      <p>Hi ${escapeHtml(o.name)},</p>
      <p>Our team updated order <strong>${escapeHtml(o.orderNo)}</strong>. Here is the revised receipt:</p>
      <div style="margin:16px 0;padding:12px;background:#fff;border-radius:8px">
        ${rows}
        <div style="display:flex;justify-content:space-between;border-top:1px solid #dfe6dc;padding-top:7px;margin-top:7px"><span>Subtotal</span><span>${php(o.subtotal)}</span></div>
        ${fee}
        <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:5px"><span>Total</span><span>${php(o.total)}</span></div>
      </div>
      <p>If you have already transferred payment, please check the revised total and contact us if an adjustment is needed.</p>`),
  };
}

// The hatian final checkout: one payment settling every completed hatian, with
// the single packing fee spelled out — customers who joined several batches
// need to see they were charged one fee, not one per hatian.
export function settlementPlacedEmail(s: {
  name: string; orderCount: number; balance: number; packingFee: number; total: number;
}) {
  const feeLine = s.packingFee > 0
    ? `<p>Packing fee (isang beses lang, local shipping included): <strong>${php(s.packingFee)}</strong></p>`
    : '';
  return {
    subject: `Final payment received - ${s.orderCount} hatian order${s.orderCount === 1 ? '' : 's'} under review`,
    html: wrap(`Salamat, ${s.name}!`, `
      <p>We received your final payment of <strong>${php(s.total)}</strong> covering
      <strong>${s.orderCount}</strong> completed hatian order${s.orderCount === 1 ? '' : 's'}.</p>
      <p>Balance settled: <strong>${php(s.balance)}</strong></p>${feeLine}
      <p>Our team will verify your payment proof within 24 hours. You'll get another email once it's confirmed.</p>`),
  };
}

export function settlementConfirmedEmail(s: { name: string; total: number }) {
  return {
    subject: 'Final payment confirmed - salamat!',
    html: wrap(`Confirmed, ${s.name}!`, `
      <p>Your final payment of <strong>${php(s.total)}</strong> is verified. Wala nang
      balance ang mga hatian order mo — kasama na ang packing fee.</p>
      <p>We'll update you as each batch ships.</p>`),
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

// A hatian that expired under the 7-vial minimum. The batch is never ordered, so
// the order is cancelled outright and the downpayment goes back. Refunds are
// manual (GCash/bank transfer) — this email is what tells the customer to expect one.
export function kahatiCancelledEmail(o: {
  name: string; orderNo: string; kahatiName: string; claimedSlots: number; minVials: number;
  downpayment: number;
  // What the configured downpayment policy says happens now, phrased for a
  // cancellation that has already happened (lib/kahati-downpayment.ts
  // cancellationRefundNoticeFor — NOT refundNoticeFor, whose sentences are
  // written for the screens before the customer commits and read as false
  // here). Optional so a caller that has not read the policy still sends the
  // historical refund promise rather than nothing.
  refundNotice?: string | null;
}) {
  const refundLine = o.downpayment > 0
    ? `<p>Your <strong>${php(o.downpayment)}</strong> downpayment: ${escapeHtml(o.refundNotice ?? 'will be refunded to the account you paid from. Please allow 1-3 banking days.')}</p>`
    : '<p>No payment was collected for this order, so there is nothing to refund.</p>';
  return {
    subject: `Order ${o.orderNo} cancelled - "${o.kahatiName}" did not reach ${o.minVials} vials`,
    html: wrap(`Sorry, ${o.name} 😔`, `
      <p>The hatian <strong>${o.kahatiName}</strong> closed with only <strong>${o.claimedSlots} of ${o.minVials}</strong> vials needed, so we could not place the batch order.</p>
      <p>Order <strong>${o.orderNo}</strong> has been cancelled and nothing will be shipped.</p>${refundLine}
      <p>Salamat sa pag-intindi — sali ka ulit sa susunod na hatian!</p>`),
  };
}
