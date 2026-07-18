'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './api-client';
import type { PackingFees } from './pricing';
import type { Category, CheckoutPaymentMethod, GroupBuy, Order, Product } from './types';

export const usePackingFees = () =>
  useQuery({
    queryKey: ['packing-fees'],
    queryFn: () => apiGet<{ packingFees: PackingFees }>('/settings').then((d) => d.packingFees),
    staleTime: 5 * 60 * 1000,
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => apiGet<Category[]>('/categories') });

export const useProducts = (p: { category?: string; q?: string; onHand?: boolean }) =>
  useQuery({ queryKey: ['products', p], queryFn: () => apiGet<Product[]>(`/products${qs(p)}`) });

export const useProduct = (id?: string) =>
  useQuery({ queryKey: ['product', id], queryFn: () => apiGet<Product>(`/products/${id}`), enabled: !!id });

export const useGroupBuys = () =>
  useQuery({ queryKey: ['groupbuys'], queryFn: () => apiGet<GroupBuy[]>('/groupbuys') });

export const usePaymentMethods = () =>
  useQuery({ queryKey: ['payment-methods'], queryFn: () => apiGet<CheckoutPaymentMethod[]>('/payment-methods') });

export const useOrders = (enabled = true) =>
  useQuery({ queryKey: ['orders'], queryFn: () => apiGet<Order[]>('/orders'), enabled });
