'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './api-client';
import type { PackingFees } from './pricing';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY, type KahatiDownpaymentPolicy } from './kahati-downpayment';
import type { Category, CheckoutPaymentMethod, GroupBuy, KahatiCommitments, MoqCampaign, MoqProduct, Order, OrderDetail, Product, SettlementPreview } from './types';

export const usePackingFees = () =>
  useQuery({
    queryKey: ['packing-fees'],
    queryFn: () => apiGet<{ packingFees: PackingFees }>('/settings').then((d) => d.packingFees),
    staleTime: 5 * 60 * 1000,
  });

// The hatian deposit rule, so the cart and the checkout quote the same figure
// the server will charge. Same endpoint and cache window as the packing fees —
// the two are read together everywhere they are read at all.
//
// A response from a deploy that predates the setting carries no policy; falling
// back to the packing-fee rule keeps the quote correct for that deploy rather
// than rendering a blank "due now".
export const useKahatiDownpaymentPolicy = () =>
  useQuery({
    queryKey: ['kahati-downpayment-policy'],
    queryFn: () => apiGet<{ kahatiDownpayment?: KahatiDownpaymentPolicy }>('/settings')
      .then((d) => d.kahatiDownpayment ?? DEFAULT_KAHATI_DOWNPAYMENT_POLICY),
    staleTime: 5 * 60 * 1000,
  });

// The kahati commitments this customer already holds, and whether this cycle's
// packing fee is already paid. Never cached stale: a cycle turning over flips
// the answer, and showing "nothing to pay" for a checkout the server then
// charges for is the failure to avoid.
export const useKahatiCommitments = (enabled = true) =>
  useQuery({
    queryKey: ['kahati-commitments'],
    queryFn: () => apiGet<KahatiCommitments>('/kahati/commitments'),
    enabled,
    staleTime: 0,
  });

// Whether this customer has already paid to have this cycle's parcel packed, so
// the cart can show ₱0 packing fee exactly where the server will charge none.
// Never cached stale, for the same reason as the kahati commitments above.
export const useCyclePackingFeePaid = (enabled = true) =>
  useQuery({
    queryKey: ['cycle-packing-fee'],
    queryFn: () => apiGet<{ paidThisCycle: boolean }>('/campaigns/commitments')
      .then((d) => d.paidThisCycle),
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

// The live boards are shared state, but polling them too aggressively sends the
// same small reads across the Supabase/Vercel boundary all day. One minute keeps
// unattended boards current without making every open storefront tab query the
// database four times a minute. Mutations still invalidate these queries
// immediately, and returning to a backgrounded tab refreshes stale data.
export const KAHATI_POLL_MS = 60_000;

export const useGroupBuys = () =>
  useQuery({
    queryKey: ['groupbuys'],
    queryFn: () => apiGet<GroupBuy[]>('/groupbuys'),
    staleTime: KAHATI_POLL_MS,
    refetchInterval: KAHATI_POLL_MS,
    // Pause polling on a backgrounded tab; the refocus refetch covers the return.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

// Group Buy (MOQ) campaigns are shared state in the same way the hatian board is
// — other customers commit kits while this page sits open — so the MOQ counter
// polls on the same cadence rather than freezing until a reload.
export const useCampaigns = () =>
  useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiGet<MoqCampaign[]>('/campaigns'),
    staleTime: KAHATI_POLL_MS,
    refetchInterval: KAHATI_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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

// One order in full, for the details page. Keyed by id so opening a second
// order does not serve the first one's cached body.
export const useOrderDetail = (id?: string) =>
  useQuery({
    queryKey: ['order', id],
    queryFn: () => apiGet<OrderDetail>(`/orders/${id}`),
    enabled: !!id,
  });
