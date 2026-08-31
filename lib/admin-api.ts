'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, qs } from './api-client';
import { useToast } from './store/toast';
import type { AdminSettlement, CampaignPayload, Category, GroupBuy, HatianCommitment, MoqCampaign, MoqProduct, Order, OrderHistory, OrderItem, PaymentMethod, PaymentProof, Product } from './types';
import type { CampaignParticipant, summariseCampaignParticipants } from './campaign-participants';
import type { AccountRow } from './accounts';
import type { StatsRange } from './analytics-range';
import type { ReportSegment } from './report/segment';

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

type OrderAggregate = { count: number; revenue: number };

export type DashboardStats = {
  // `range` is present on the period figures only when a range was asked for.
  totals: { week: OrderAggregate; month: OrderAggregate; all: OrderAggregate; range?: OrderAggregate };
  packingFees: { week: number; month: number; all: number; range?: number };
  dailySummary: { day: string; count: number; revenue: number }[];
  fastMoving: { productId: string | null; name: string; unitsSold: number; revenue: number }[];
  pendingProofs: number;
  range: StatsRange | null;
};

// The range is part of the key, so switching dates reads a separate cache entry
// rather than overwriting the unfiltered dashboard the admin can clear back to.
export const useStats = (range: StatsRange | null = null) =>
  useQuery({
    queryKey: ['admin', 'stats', range?.from ?? '', range?.to ?? ''],
    queryFn: () => apiGet<DashboardStats>(`/admin/stats${qs({ from: range?.from, to: range?.to })}`),
    // Holding the previous figures keeps the page off "Loading dashboard…" while
    // a newly picked range is in flight.
    placeholderData: (prev) => prev,
  });
// Every registered account, for Admin → Accounts. The row shape is the server's
// own (lib/accounts.ts) so the table cannot drift from what the route returns.
export const useAdminAccounts = (search?: string, role?: string) =>
  useQuery({
    queryKey: ['admin', 'accounts', search ?? '', role ?? ''],
    queryFn: () => apiGet<AccountRow[]>(`/admin/accounts${qs({ search, role })}`),
    // The list is re-fetched on every keystroke of the search box; holding the
    // previous rows keeps the table from blinking to "Loading…" between them.
    placeholderData: (prev) => prev,
  });
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
// `segment` scopes the list to one board — on-hand, group buy or hatian — and is
// applied on the server: the list is unpaginated, so splitting it in the browser
// would still fetch every order to throw most of it away.
export const useAdminOrders = ({ status, segment }: { status?: string; segment?: ReportSegment } = {}) =>
  useQuery({
    queryKey: ['admin', 'orders', status, segment],
    queryFn: () => apiGet<(Order & { customerEmail: string })[]>(`/admin/orders${qs({ status, segment })}`),
  });
export const useAdminOrder = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => apiGet<{ order: Order; items: OrderItem[]; history: OrderHistory[]; customer: { name: string; email: string; phone: string }; proofUrl: string | null;
      // Every proof the customer attached, oldest first. proofUrl above is the
      // first of them, kept for readers that have not moved to the list.
      proofs: PaymentProof[] }>(`/admin/orders/${id}`),
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
    // Ends every hatian counter that has vials on it and opens each one's
    // successor — the board-level control, not the per-card Close.
    startKahatiCycle: useMutation({ mutationFn: () => apiSend('/admin/groupbuys/cycle', 'POST'), onSuccess: invalidate, onError: toastError('Could not start a new cycle.') }),
    // What one transfer was worth. Separate from setOrderStatus because it is a
    // different question — not "where is this order" but "has it been paid" —
    // and an admin types several of these against one order without ever
    // touching its status.
    setProofAmount: useMutation({ mutationFn: (v: { orderId: string; proofId: string; amountPhp: number | null; reference?: string | null }) => apiSend(`/admin/orders/${v.orderId}/proofs/${v.proofId}`, 'PATCH', { amountPhp: v.amountPhp, reference: v.reference }), onSuccess: invalidate, onError: toastError('Could not record the payment amount.') }),
    setOrderStatus: useMutation({ mutationFn: (v: { id: string; status: string; trackingNo?: string; note?: string; courier?: string; packedBy?: string; paymentMethod?: string }) => apiSend(`/admin/orders/${v.id}/status`, 'PATCH', v), onSuccess: invalidate, onError: toastError('Could not update the order.') }),
    editOrderItems: useMutation({
      mutationFn: (v: { id: string; items: { id?: string; nameSnapshot: string; specSnapshot?: string | null; qty: number; unitPricePhp: number; productId?: string; unit?: 'piece' | 'kit' }[] }) =>
        apiSend(`/admin/orders/${v.id}`, 'PATCH', { items: v.items }),
      onSuccess: invalidate,
      onError: toastError('Could not edit the order items.'),
    }),
    // Confirming a hatian final checkout is what flips the customer's packing fee
    // and balance to Paid; cancelling releases its orders to be settled again.
    setSettlementStatus: useMutation({ mutationFn: (v: { id: string; status: 'proof_review' | 'paid' | 'cancelled'; notes?: string }) => apiSend(`/admin/settlements/${v.id}`, 'PATCH', v), onSuccess: invalidate, onError: toastError('Could not update the settlement.') }),
    savePaymentMethod: useMutation({ mutationFn: (v: { id?: string; body: FormData }) => v.id ? apiSend(`/admin/payment-methods/${v.id}`, 'PATCH', v.body) : apiSend('/admin/payment-methods', 'POST', v.body), onSuccess: invalidate, onError: toastError('Could not save payment method.') }),
    deletePaymentMethod: useMutation({ mutationFn: (id: string) => apiSend(`/admin/payment-methods/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete payment method.') }),
    // Multipart so the product image rides along with the fields.
    saveMoqProduct: useMutation({ mutationFn: (v: { id?: string; body: FormData }) => v.id ? apiSend(`/admin/moq-products/${v.id}`, 'PATCH', v.body) : apiSend('/admin/moq-products', 'POST', v.body), onSuccess: invalidate, onError: toastError('Could not save MOQ product.') }),
    deleteMoqProduct: useMutation({ mutationFn: (id: string) => apiSend(`/admin/moq-products/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete MOQ product.') }),
    closeMoqCycle: useMutation({ mutationFn: (id: string) => apiSend(`/admin/moq-products/${id}/cycle`, 'POST'), onSuccess: invalidate, onError: toastError('Could not close the MOQ round.') }),
    saveCampaign: useMutation({ mutationFn: (c: CampaignPayload) => c.id ? apiSend(`/campaigns/${c.id}`, 'PATCH', c) : apiSend('/campaigns', 'POST', c), onSuccess: invalidate }),
    deleteCampaign: useMutation({ mutationFn: (id: string) => apiSend(`/campaigns/${id}`, 'DELETE'), onSuccess: invalidate, onError: toastError('Could not delete campaign.') }),
    campaignAction: useMutation({ mutationFn: (v: { id: string; action: 'approve' | 'extend' | 'cancel' | 'roll'; deadline?: string | null }) => apiSend(`/campaigns/${v.id}/action`, 'POST', v), onSuccess: invalidate, onError: toastError('Could not update campaign.') }),
    // Ends every running batch on the board and opens each one's successor.
    startCycle: useMutation({ mutationFn: () => apiSend('/campaigns/cycle', 'POST'), onSuccess: invalidate, onError: toastError('Could not start a new cycle.') }),
  };
}
