import { useToast } from '../store/toast';

export function Toast() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div className="fixed bottom-[100px] left-1/2 z-[70] -translate-x-1/2 animate-toastup whitespace-nowrap rounded-full bg-ink px-[18px] py-[11px] text-[13px] font-semibold text-white shadow-toast">
      {message}
    </div>
  );
}
