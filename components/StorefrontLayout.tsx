import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';

export function StorefrontLayout() {
  return (
    <div className="relative mx-auto min-h-screen max-w-app bg-surface-mist">
      <div className="pb-[92px]">
        <Outlet />
      </div>
      <BottomNav />
      <Toast />
    </div>
  );
}
