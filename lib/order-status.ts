export const STATUS_FLOW = ['proof_review', 'payment_confirmed', 'batch_filling', 'shipped', 'delivered'] as const;

export const STATUS_LABEL: Record<string, string> = {
  proof_review: 'Proof under review',
  payment_confirmed: 'Payment confirmed',
  batch_filling: 'Batch filling',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const STATUS_BADGE: Record<string, string> = {
  proof_review: 'bg-warn-bg text-warn-fg',
  payment_confirmed: 'bg-[#e0eafc] text-brand-blue',
  batch_filling: 'bg-[#e0eafc] text-brand-blue',
  shipped: 'bg-[#e0eafc] text-brand-blue',
  delivered: 'bg-[#e8f5db] text-brand-greendark',
  cancelled: 'bg-[#f6e0e0] text-[#b23b3b]',
};

export const statusIndex = (s: string) => STATUS_FLOW.indexOf(s as never);
