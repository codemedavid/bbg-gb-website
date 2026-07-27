'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './api-client';
import type { PackingFees } from './pricing';
import type { Category, CheckoutPaymentMethod, GroupBuy, KahatiCommitments, MoqCampaign, MoqProduct, Order, Product, SettlementPreview } from './types';

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

// The kahati commitments this customer already holds, and whether that covers
// the reservation downpayment. Never cached stale: a hatian sealing flips the
// waiver, and showing "nothing to pay" for a checkout the server then charges
// for is the failure to avoid.
export const useKahatiCommitments = (enabled = true) =>
  useQuery({
    queryKey: ['kahati-commitments'],
    queryFn: () => apiGet<KahatiCommitments>('/kahati/commitments'),
    enabled,
    staleTime: 0,
  });

// Whether the MOQ page is live. The nav reads this to decide if the MOQ tab
// exists at all, so it must not advertise a route that 404s.
export const useMoqPageEnabled = () =>
  useQuery({
    queryKey: ['moq-page-enabled'],
    queryFn: () => apiGet<{ moqPageEnabled: boolean }>('/settings').then((d) => d.moqPageEnabled),
    staleTime: 5 * 60 * 1000,
  });

// The MOQ shelf. Unlike the kahati and campaign boards this is not shared,
// racing state — stock moves, but there is no counter filling up in real time —
// so it uses the global defaults rather than polling.
export const useMoqProducts = (enabled = true) =>
  useQuery({
    queryKey: ['moq-products'],
    queryFn: () => apiGet<MoqProduct[]>('/moq-products'),
    enabled,
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

// What the hatian final checkout would cost right now: the completed hatian
// orders still owing a balance, and the one packing fee that settles them all.
// Never cached stale — a hatian closing (or a settlement clearing) changes it,
// and quoting a fee the server no longer agrees with is the failure to avoid.
export const useSettlementPreview = (enabled = true) =>
  useQuery({
    queryKey: ['settlement-preview'],
    queryFn: () => apiGet<SettlementPreview>('/settlements/preview'),
    enabled,
    staleTime: 0,
  });

export const useOrders = (enabled = true) =>
  useQuery({ queryKey: ['orders'], queryFn: () => apiGet<Order[]>('/orders'), enabled });
