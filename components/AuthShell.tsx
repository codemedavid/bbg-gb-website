'use client';
import type { ReactNode } from 'react';

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-app flex-col bg-surface-mist">
      <div className="bg-gradient-to-br from-brand-navy to-brand-blue px-6 pb-8 pt-14 text-white">
        <div className="font-display text-[26px] font-bold">BBG<span className="text-brand-green"> Peptides</span></div>
        <div className="mt-1 text-[13px] opacity-85">Kahati tayo — research peptides, delivered PH-wide.</div>
      </div>
      <div className="-mt-4 flex-1 rounded-t-[20px] bg-surface-mist px-5 pt-6">
        <h1 className="m-0 font-display text-[22px] text-ink">{title}</h1>
        <p className="mb-5 mt-1 text-[13px] text-ink-muted">{sub}</p>
        {children}
      </div>
    </div>
  );
}

export const inputCls = 'w-full rounded-[10px] border-[1.5px] border-line bg-white px-3.5 py-3 text-[14px] outline-none focus:border-brand-green';
