import { BottomNav } from '@/components/BottomNav';
import { Toast } from '@/components/Toast';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto min-h-screen max-w-app bg-surface-mist md:max-w-2xl lg:max-w-4xl">
      <div className="pb-[92px]">{children}</div>
      <BottomNav />
      <Toast />
    </div>
  );
}
