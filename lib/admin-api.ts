'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, qs } from './api-client';
import { useToast } from './store/toast';
import type { CampaignPayload, Category, GroupBuy, MoqCampaign, MoqProduct, Order, OrderHistory, OrderItem, PaymentMethod, Product } from './types';

const toastError = (fallback: string) => (err: unknown) =>
  useToast.getState().show(err instanceof Error ? err.message : fallback);

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
export const useAdminPaymentMethods = () => useQuery({ queryKey: ['admin', 'payment-methods'], queryFn: () => apiGet<PaymentMethod[]>('/admin/payment-methods') });
// The MOQ shelf, admin view — includes archived rows, unlike the public list.
export const useAdminMoqProducts = () =>
  useQuery({ queryKey: ['admin', 'moq-products'], queryFn: () => apiGet<MoqProduct[]>('/admin/moq-products') });
export const useCampaigns = () => useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => apiGet<MoqCampaign[]>('/campaigns') });
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
