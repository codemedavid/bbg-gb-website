'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, qs } from './api-client';
import { useToast } from './store/toast';
import type { AdminSettlement, CampaignPayload, Category, GroupBuy, HatianCommitment, MoqCampaign, MoqProduct, Order, OrderHistory, OrderItem, PaymentMethod, Product } from './types';
import type { CampaignParticipant, summariseCampaignParticipants } from './campaign-participants';

const toastError = (fallback: string) => (err: unknown) =>
  useToast.getState().show(err instanceof Error ? err.message : fallback);

// The Group Buy participants screen's payload. The row shapes are the server's
// own (lib/campaign-participants.ts) so the table cannot drift from what the
// route computes.
export type CampaignParticipantsResponse = {
  campaign: { id: string; name: string; seriesId: string; batchNo: number; moq: number; committed: number };
  participants: CampaignParticipant[];
  summary: ReturnType<typeof summariseCampaignParticipants>;
};

export type DashboardStats = {
  totals: {
    week: { count: number; revenue: number };
    month: { count: number; revenue: number };
    all: { count: number; revenue: number };
  };
  weeklySummary: { day: string; count: number; revenue: number }[];
  fastMoving: { productId: string | null; name: string; unitsSold: number; revenue: number }[];
  pendingProofs: number;
};

export const useStats = () => useQuery({ queryKey: ['admin', 'stats'], queryFn: () => apiGet<DashboardStats>('/admin/stats') });
export const useAdminProducts = () => useQuery({ queryKey: ['admin', 'products'], queryFn: () => apiGet<Product[]>('/admin/products') });
export const useAdminCategories = () => useQuery({ queryKey: ['admin', 'categories'], queryFn: () => apiGet<Category[]>('/admin/categories') });
export const useAdminGroupBuys = () => useQuery({ queryKey: ['admin', 'groupbuys'], queryFn: () => apiGet<GroupBuy[]>('/admin/groupbuys') });
// Hatian final checkouts awaiting verification. Without this the settlement API
// has no caller and a customer's payment can never be confirmed in-product.
export const useAdminSettlements = (status?: string) =>
  useQuery({
    queryKey: ['admin', 'settlements', status ?? 'all'],
    queryFn: () => apiGet<AdminSettlement[]>(`/admin/settlements${qs({ status })}`),
  });

// Participants in one hatian, with their three payments kept apart — see
// app/api/admin/groupbuys/[id]/commitments/route.ts.
export const useAdminGroupBuyCommitments = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'groupbuys', id, 'commitments'],
    queryFn: () => apiGet<HatianCommitment[]>(`/admin/groupbuys/${id}/commitments`),
    enabled: !!id,
  });

export const useAdminPaymentMethods = () => useQuery({ queryKey: ['admin', 'payment-methods'], queryFn: () => apiGet<PaymentMethod[]>('/admin/payment-methods') });
// The MOQ shelf, admin view — includes archived rows, unlike the public list.
export const useAdminMoqProducts = () =>
  useQuery({ queryKey: ['admin', 'moq-products'], queryFn: () => apiGet<MoqProduct[]>('/admin/moq-products') });
export const useCampaigns = () => useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => apiGet<MoqCampaign[]>('/campaigns') });
// One campaign, for the Edit screen at /admin/group-buy/campaigns/:id. That URL
// can be typed, bookmarked or reloaded, so the page cannot assume the list is
// already in cache. Retry stays off: a 404 here means the campaign is gone, and
// re-asking three times only delays telling the admin so.
export const useCampaign = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'campaign', id],
    queryFn: () => apiGet<MoqCampaign>(`/campaigns/${id}`),
    enabled: !!id,
    retry: false,
  });
// Who is in a Group Buy campaign, grouped one row per customer. Same retry
// policy and reasoning as useCampaign above.
export const useCampaignParticipants = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'campaign', id, 'commitments'],
    queryFn: () => apiGet<CampaignParticipantsResponse>(`/admin/campaigns/${id}/commitments`),
    enabled: !!id,
    retry: false,
  });
export const useAdminOrders = (status?: string) =>
  useQuery({ queryKey: ['admin', 'orders', status], queryFn: () => apiGet<(Order & { customerEmail: string })[]>(`/admin/orders${qs({ status })}`) });
export const useAdminOrder = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => apiGet<{ order: Order; items: OrderItem[]; history: OrderHistory[]; customer: { name: string; email: string; phone: string }; proofUrl: string | null }>(`/admin/orders/${id}`),
    enabled: !!id,
  });

export function useMutate() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin'] });
  return {
    saveProduct: useMutation({ mutationFn: (p: any) => p.id ? apiSend(`/admin/products/${p.id}`, 'PATCH', p) : apiSend('/admin/products', 'POST', p), onSuccess: invalidate, onError: toastError('Could not save product.') }),
    archiveProduct: useMutation({ mutationFn: (id: string) => apiSend(`/admin/products/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not archive product.') }),
    saveGroupBuy: useMutation({ mutationFn: (g: any) => g.id ? apiSend(`/admin/groupbuys/${g.id}`, 'PATCH', g) : apiSend('/admin/groupbuys', 'POST', g), onSuccess: invalidate, onError: toastError('Could not save group buy.') }),
    deleteGroupBuy: useMutation({ mutationFn: (id: string) => apiSend(`/admin/groupbuys/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete group buy.') }),
    setOrderStatus: useMutation({ mutationFn: (v: { id: string; status: string; trackingNo?: string; note?: string; courier?: string; packedBy?: string; paymentMethod?: string }) => apiSend(`/admin/orders/${v.id}/status`, 'PATCH', v), onSuccess: invalidate, onError: toastError('Could not update the order.') }),
    // Confirming a hatian final checkout is what flips the customer's packing fee
    // and balance to Paid; cancelling releases its orders to be settled again.
    setSettlementStatus: useMutation({ mutationFn: (v: { id: string; status: 'proof_review' | 'paid' | 'cancelled'; notes?: string }) => apiSend(`/admin/settlements/${v.id}`, 'PATCH', v), onSuccess: invalidate, onError: toastError('Could not update the settlement.') }),
    savePaymentMethod: useMutation({ mutationFn: (v: { id?: string; body: FormData }) => v.id ? apiSend(`/admin/payment-methods/${v.id}`, 'PATCH', v.body) : apiSend('/admin/payment-methods', 'POST', v.body), onSuccess: invalidate, onError: toastError('Could not save payment method.') }),
    deletePaymentMethod: useMutation({ mutationFn: (id: string) => apiSend(`/admin/payment-methods/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete payment method.') }),
    // Multipart so the product image rides along with the fields.
    saveMoqProduct: useMutation({ mutationFn: (v: { id?: string; body: FormData }) => v.id ? apiSend(`/admin/moq-products/${v.id}`, 'PATCH', v.body) : apiSend('/admin/moq-products', 'POST', v.body), onSuccess: invalidate, onError: toastError('Could not save MOQ product.') }),
    deleteMoqProduct: useMutation({ mutationFn: (id: string) => apiSend(`/admin/moq-products/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete MOQ product.') }),
    saveCampaign: useMutation({ mutationFn: (c: CampaignPayload) => c.id ? apiSend(`/campaigns/${c.id}`, 'PATCH', c) : apiSend('/campaigns', 'POST', c), onSuccess: invalidate }),
    deleteCampaign: useMutation({ mutationFn: (id: string) => apiSend(`/campaigns/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete campaign.') }),
    campaignAction: useMutation({ mutationFn: (v: { id: string; action: 'approve' | 'extend' | 'cancel'; deadline?: string | null }) => apiSend(`/campaigns/${v.id}/action`, 'POST', v), onSuccess: invalidate, onError: toastError('Could not update campaign.') }),
  };
}
