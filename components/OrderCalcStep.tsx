// The numbered card the order calculator's two steps share.
//
// The design gives both steps the same frame — a numbered badge, a title and an
// optional right-hand count — so it is one component rather than the same
// header pasted into two files and drifting apart on the next tweak.
export function StepCard({ step, title, aside, children }: {
  step: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] bg-white p-4 shadow-card">
      <div className="mb-2.5 flex items-center gap-2">
        <span aria-hidden
          className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-brand-green text-[12px] font-bold text-white">
          {step}
        </span>
        <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
        {aside && <span className="ml-auto text-[12px] font-semibold text-ink-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
