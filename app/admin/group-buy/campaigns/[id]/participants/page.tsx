'use client';
// Admin → Group Buy → Campaigns → Participants.
//
// The kahati board has had this screen; campaigns did not, so an admin could
// see that a batch held N kits but not who held them — and could not confirm
// the guarantee checkout makes, that a customer ordering three times in one
// group buy pays ONE packing fee (lib/campaign-commitment.ts).
//
// One row per customer, not per order. Showing three rows for three orders
// would read as three parcels and three fees owed, which is exactly the
// misreading the single-fee rule exists to prevent.
import { useParams } from 'next/navigation';
import { useCampaignParticipants } from '@/lib/admin-api';
import { php } from '@/lib/format';
import { Breadcrumb } from '../../../Breadcrumb';

const STATUS_LABEL: Record<string, string> = {
  proof_review: 'Proof under review', payment_confirmed: 'Payment confirmed',
  batch_filling: 'Batch filling', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

export default function CampaignParticipantsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useCampaignParticipants(id);

  return (
    <>
      <Breadcrumb trail={[
        { label: 'Admin', href: '/admin' },
        { label: 'Group Buy', href: '/admin/group-buy' },
        { label: 'Campaigns', href: '/admin/group-buy/campaigns' },
        { label: data?.campaign.name ?? 'Participants' },
      ]} />

      {isLoading ? (
        <div className="text-ink-muted">Loading participants…</div>
      ) : !data ? (
        <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
          <div className="mb-1 font-bold text-ink-body">Could not load participants</div>
          <div className="text-[13px] text-ink-muted">
            {error instanceof Error ? error.message : 'The campaign may have been deleted.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-10">
          <div className="rounded-[16px] bg-white p-5 shadow-card">
            <h1 className="m-0 font-display text-[20px] font-bold text-brand-navy">{data.campaign.name}</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              {data.campaign.committed} / {data.campaign.moq} kits committed · every batch of this series
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['Participants', String(data.summary.participantCount)],
                ['Kits committed', String(data.summary.kits)],
                ['Packing fees', php(data.summary.packingFeesPhp)],
                ['Order value', php(data.summary.totalPhp)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[12px] bg-surface-mist px-3.5 py-3">
                  <dt className="text-[11px] text-ink-muted">{k}</dt>
                  <dd className="m-0 font-display text-[18px] font-bold text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            {data.summary.doubleChargedCount > 0 && (
              <p role="alert" className="mt-4 rounded-[9px] bg-warn-bg px-3 py-2 text-[13px] font-semibold text-warn-fg">
                {data.summary.doubleChargedCount} customer(s) were charged more than one packing fee in this
                group buy. A second fee in the same group buy should not happen — refund the duplicate.
              </p>
            )}
          </div>

          {data.participants.length === 0 ? (
            <div className="rounded-[16px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center">
              <p className="m-0 text-[14px] font-bold text-ink">No commitments yet</p>
              <p className="mt-1 text-[12.5px] text-ink-muted">Participants appear here as customers commit kits.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <caption className="sr-only">Participants in {data.campaign.name}</caption>
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Customer</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Kits</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Orders</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Packing fee</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Order value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.participants.map((p) => (
                    <tr key={p.userId} className="border-b border-line-soft align-top last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{p.customerName}</div>
                        <div className="text-[12px] text-ink-muted">{p.customerEmail}</div>
                        <div className="text-[12px] text-ink-muted">{p.shipPhone} · {p.shipAddress}</div>
                      </td>
                      <td className="px-4 py-3 font-display text-[16px] font-bold text-ink">{p.kits}</td>
                      <td className="px-4 py-3">
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                          {p.orders.map((o) => (
                            <li key={o.orderId} className="text-[12.5px] text-ink-body">
                              <span className="font-semibold">{o.orderNo}</span>
                              {' · '}{o.kits} kit{o.kits === 1 ? '' : 's'}
                              {' · '}{STATUS_LABEL[o.orderStatus] ?? o.orderStatus}
                              {o.batchNos.length > 1 && (
                                <span className="text-ink-muted"> · batches {o.batchNos.join(', ')}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3">
                        <span className={p.chargedPackingFeeTwice ? 'font-bold text-warn-fg' : 'text-ink-body'}>
                          {php(p.packingFeePhp)}
                        </span>
                        {p.chargedPackingFeeTwice && (
                          <div className="text-[11px] font-semibold text-warn-fg">charged twice</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-body">{php(p.totalPhp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
