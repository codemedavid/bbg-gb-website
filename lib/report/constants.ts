// Shared constants for the weekly order report (BRS-style PDF).

// Fulfilment handlers shown in the report's "Admin" column and offered in the
// admin order editor. Editable here as the team changes.
export const PACKERS = ['Nova', 'Thunder', 'Twinkle'] as const;

// Couriers offered in the order editor. J&T is the current default.
export const COURIERS = ['J&T', 'LBC', 'Flash', 'Ninja Van'] as const;
export const DEFAULT_COURIER = 'J&T';

// Report brand palette — matched to the BioRhythm Weekly Order Report sample.
export const REPORT_COLORS = {
  headerFill: [47, 125, 51] as [number, number, number], // forest green header row
  headerText: [255, 255, 255] as [number, number, number],
  title: [47, 125, 51] as [number, number, number],
  stripe: [241, 248, 238] as [number, number, number], // very light green alt row
  totalFill: [223, 240, 214] as [number, number, number], // total footer row
  bodyText: [34, 34, 34] as [number, number, number],
  muted: [90, 90, 90] as [number, number, number],
};

// Report-facing status wording, matched to the sample PDF. Falls back to the raw
// status for any value not listed.
export const REPORT_STATUS_LABEL: Record<string, string> = {
  proof_review: 'Payment Verification',
  payment_confirmed: 'Payment Verified',
  batch_filling: 'In Batch Order',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// Which raw statuses roll up into the header's paid / pending / cancelled counts.
export const PAID_STATUSES = new Set(['payment_confirmed', 'batch_filling', 'shipped', 'delivered']);
export const PENDING_STATUSES = new Set(['proof_review']);

// The report exports payment state and fulfilment state as separate columns.
// One order status implies both: 'shipped' means the money cleared *and* the
// parcel left, and collapsing that into a single cell (as the PDF did) loses the
// question the team actually asks the sheet — who still owes us money.
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  proof_review: 'Pending',
  payment_confirmed: 'Paid',
  batch_filling: 'Paid',
  shipped: 'Paid',
  delivered: 'Paid',
  cancelled: 'Refunded',
};
