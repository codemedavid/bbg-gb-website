import { useNavigate } from 'react-router-dom';
import { CartButton } from './BottomNav';

const LOGO_TEXT = (
  <span className="font-display text-[17px] font-bold tracking-tight text-brand-navy">
    BBG<span className="text-brand-green"> Peptides</span>
  </span>
);

export function AppHeader({ greeting }: { greeting?: string }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-brand-green bg-white px-4 py-2.5">
      {LOGO_TEXT}
      <div className="ml-auto flex items-center gap-2.5">
        {greeting && <span className="text-[13px] font-semibold text-ink-body">{greeting}</span>}
        <CartButton onClick={() => nav('/cart')} />
      </div>
    </header>
  );
}

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b-2 border-brand-green bg-white px-4 py-3.5">
      <div className="font-display text-[18px] font-bold text-ink">{title}</div>
      {sub && <div className="text-[12px] text-ink-muted">{sub}</div>}
    </header>
  );
}

export function BackHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-[5] flex items-center gap-3 border-b border-line-mist bg-white px-4 py-3">
      <button onClick={onBack ?? (() => nav(-1))}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-[16px] text-ink-body">
        ←
      </button>
      <span className="text-[15px] font-bold text-ink">{title}</span>
    </header>
  );
}
