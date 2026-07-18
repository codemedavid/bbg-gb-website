'use client';
import type { ReactNode } from 'react';

export function OverlayShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-surface-mist">
      <div className="w-full max-w-app overflow-y-auto pb-10 md:max-w-2xl lg:max-w-4xl">{children}</div>
    </div>
  );
}
