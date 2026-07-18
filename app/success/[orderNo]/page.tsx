'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';

export default function SuccessPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-surface-mist">
      <div className="flex w-full max-w-app flex-col items-center justify-center px-8 text-center">
        <div className="mb-4 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-brand-green text-[34px] text-white">✓</div>
        <div className="mb-2 font-display text-[22px] font-bold text-ink">Salamat{user ? `, ${user.name.split(' ')[0]}` : ''}!</div>
        <div className="mb-1.5 text-[14px] leading-relaxed text-ink-body">Order <strong>{orderNo}</strong> received.</div>
        <div className="mb-6 text-[13px] leading-relaxed text-ink-muted">We&apos;ll verify your payment proof within 24 hours. You&apos;ll get an email when it&apos;s confirmed.</div>
        <button onClick={() => router.push('/orders')} className="block w-full rounded-[12px] bg-brand-blue py-[15px] text-[15px] font-bold text-white">Track my order</button>
        <button onClick={() => router.push('/')} className="mt-2.5 block w-full rounded-[12px] border-[1.5px] border-line py-3 text-[14px] font-semibold text-ink-body">Back to home</button>
      </div>
    </div>
  );
}
