import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

export type ApiEnvelope<T> = { success: boolean; data: T; error: string | null };

// Unwrap the {success,data,error} envelope; throw a friendly message on failure.
export async function unwrap<T>(p: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  try {
    const res = await p;
    return res.data.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new Error(err.response?.data?.error || err.message || 'Request failed');
    }
    throw err;
  }
}

// Order status flow mirrored from the server, with display labels + badge colors.
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
