'use client';
import { statusSteps, isCancelledStatus, STATUS_LABEL } from '@/lib/order-status';

// Where an order has got to, drawn as a trail.
//
// Extracted from My Orders so the order details page shows the same trail from
// the same source. Two hand-rolled copies of "which step am I on" is how one
// screen ends up saying Shipped while the other still says Processing.
//
// Presentational only — it derives everything from the status it is handed and
// holds no state of its own.

const DOT = {
  done: { fill: '#57a814', rail: '#a9c88f' },
  active: { fill: '#0b46b8', rail: '#e6ece4' },
  pending: { fill: '#d3ddd2', rail: '#e6ece4' },
} as const;

const TEXT = {
  done: { color: '#33413d', weight: 600 },
  active: { color: '#0b46b8', weight: 700 },
  pending: { color: '#98a29b', weight: 400 },
} as const;

// Said out loud rather than drawn. A sighted customer reads the state off the
// colour of the dot; a screen-reader user gets nothing from it, so each step
// carries the word too.
const STATE_NOTE = {
  done: 'completed',
  active: 'in progress',
  pending: 'not started',
} as const;

export function OrderStatusTrail({ status }: { status: string }) {
  const cancelled = isCancelledStatus(status);
  const steps = statusSteps(status);

  return (
    <div>
      {/* Stated before the trail, not instead of it: the customer still wants to
          see how far the order had got before it was called off. */}
      {cancelled && (
        <div className="mb-2.5 rounded-[10px] bg-[#f6e0e0] px-3 py-2 text-[12.5px] font-bold text-[#b23b3b]">
          ✕ {STATUS_LABEL.cancelled} — this order is no longer being processed.
        </div>
      )}
      <ol className="m-0 list-none p-0">
        {steps.map((step, i) => (
          <li
            key={step.key}
            aria-current={step.state === 'active' ? 'step' : undefined}
            className="flex items-start gap-2.5"
          >
            <span aria-hidden className="flex flex-col items-center">
              <span className="mt-0.5 block h-3 w-3 rounded-full" style={{ background: DOT[step.state].fill }} />
              {i < steps.length - 1 && (
                <span className="block h-4 w-0.5" style={{ background: DOT[step.state].rail }} />
              )}
            </span>
            <span
              className="text-[12.5px]"
              style={{ color: TEXT[step.state].color, fontWeight: TEXT[step.state].weight }}
            >
              {step.label}
              <span className="sr-only"> — {STATE_NOTE[step.state]}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
