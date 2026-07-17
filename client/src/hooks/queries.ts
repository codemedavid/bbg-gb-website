import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';
import type { Category, GroupBuy, Order, Product } from '../lib/types';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => unwrap<Category[]>(api.get('/categories')) });
}
export function useProducts(params: { category?: string; q?: string; onHand?: boolean }) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: () => unwrap<Product[]>(api.get('/products', { params })),
  });
}
export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => unwrap<Product>(api.get(`/products/${id}`)),
    enabled: !!id,
  });
}
export function useGroupBuys() {
  return useQuery({ queryKey: ['groupbuys'], queryFn: () => unwrap<GroupBuy[]>(api.get('/groupbuys')) });
}
export function useOrders(enabled: boolean) {
  return useQuery({ queryKey: ['orders'], queryFn: () => unwrap<Order[]>(api.get('/orders')), enabled });
}
