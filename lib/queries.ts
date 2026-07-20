'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './api-client';
import type { PackingFees } from './pricing';
import type { Category, CheckoutPaymentMethod, GroupBuy, MoqCampaign, Order, Product } from './types';

export const usePackingFees = () =>
  useQuery({
    queryKey: ['packing-fees'],
    queryFn: () => apiGet<{ packingFees: PackingFees }>('/settings').then((d) => d.packingFees),
    staleTime: 5 * 60 * 1000,
  });

export const useKahatiDownpayment = () =>
  useQuery({
    queryKey: ['kahati-downpayment'],
    queryFn: () => apiGet<{ kahatiDownpayment: number }>('/settings').then((d) => d.kahatiDownpayment),
    staleTime: 5 * 60 * 1000,
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => apiGet<Category[]>('/categories') });

export const useProducts = (p: { category?: string; q?: string; onHand?: boolean }) =>
  useQuery({ queryKey: ['products', p], queryFn: () => apiGet<Product[]>(`/products${qs(p)}`) });

export const useProduct = (id?: string) =>
  useQuery({ queryKey: ['product', id], queryFn: () => apiGet<Product>(`/products/${id}`), enabled: !!id });

// The hatian board is shared state: other customers claim vials while this page
// sits open. The global defaults (30s stale, no refocus refetch) left the counter
// and progress bar frozen until a hard reload, so this query opts into polling.
export const KAHATI_POLL_MS = 15_000;

export const useGroupBuys = () =>
  useQuery({
    queryKey: ['groupbuys'],
    queryFn: () => apiGet<GroupBuy[]>('/groupbuys'),
    staleTime: 0,
    refetchInterval: KAHATI_POLL_MS,
    // Pause polling on a backgrounded tab; the refocus refetch covers the return.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

// Group Buy (MOQ) campaigns are shared state in the same way the hatian board is
// — other customers commit kits while this page sits open — so the MOQ counter
// polls on the same cadence rather than freezing until a reload.
export const useCampaigns = () =>
  useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiGet<MoqCampaign[]>('/campaigns'),
    staleTime: 0,
    refetchInterval: KAHATI_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

export const usePaymentMethods = () =>
  useQuery({ queryKey: ['payment-methods'], queryFn: () => apiGet<CheckoutPaymentMethod[]>('/payment-methods') });

export const useOrders = (enabled = true) =>
  useQuery({ queryKey: ['orders'], queryFn: () => apiGet<Order[]>('/orders'), enabled });
