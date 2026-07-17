import { create } from 'zustand';

type ToastState = { message: string; show: (m: string) => void; hide: () => void };
let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: '',
  show: (message) => {
    if (timer) clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: '' }), 2200);
  },
  hide: () => set({ message: '' }),
}));
