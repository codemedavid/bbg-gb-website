import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api';
import type { Category, GroupBuy, Order, OrderHistory, OrderItem, Product } from '../../lib/types';

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

export const useStats = () => useQuery({ queryKey: ['admin', 'stats'], queryFn: () => unwrap<DashboardStats>(api.get('/admin/stats')) });
export const useAdminProducts = () => useQuery({ queryKey: ['admin', 'products'], queryFn: () => unwrap<Product[]>(api.get('/admin/products')) });
export const useAdminCategories = () => useQuery({ queryKey: ['admin', 'categories'], queryFn: () => unwrap<Category[]>(api.get('/admin/categories')) });
export const useAdminGroupBuys = () => useQuery({ queryKey: ['admin', 'groupbuys'], queryFn: () => unwrap<GroupBuy[]>(api.get('/admin/groupbuys')) });
export const useAdminOrders = (status?: string) =>
  useQuery({ queryKey: ['admin', 'orders', status], queryFn: () => unwrap<(Order & { customerEmail: string })[]>(api.get('/admin/orders', { params: status ? { status } : {} })) });
export const useAdminOrder = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => unwrap<{ order: Order; items: OrderItem[]; history: OrderHistory[]; customer: { name: string; email: string; phone: string }; proofUrl: string | null }>(api.get(`/admin/orders/${id}`)),
    enabled: !!id,
  });

export function useMutate() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin'] });
  return {
    saveProduct: useMutation({ mutationFn: (p: Partial<Product> & { id?: string }) => unwrap(p.id ? api.patch(`/admin/products/${p.id}`, p) : api.post('/admin/products', p)), onSuccess: invalidate }),
    archiveProduct: useMutation({ mutationFn: (id: string) => unwrap(api.delete(`/admin/products/${id}`)), onSuccess: invalidate }),
    saveGroupBuy: useMutation({ mutationFn: (g: Partial<GroupBuy> & { id?: string }) => unwrap(g.id ? api.patch(`/admin/groupbuys/${g.id}`, g) : api.post('/admin/groupbuys', g)), onSuccess: invalidate }),
    deleteGroupBuy: useMutation({ mutationFn: (id: string) => unwrap(api.delete(`/admin/groupbuys/${id}`)), onSuccess: invalidate }),
    setOrderStatus: useMutation({ mutationFn: (v: { id: string; status: string; trackingNo?: string; note?: string }) => unwrap(api.patch(`/admin/orders/${v.id}/status`, v)), onSuccess: invalidate }),
  };
}
