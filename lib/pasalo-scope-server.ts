import { getDb } from './db';
import { ApiError } from './session';
import { dateRangeBounds } from './report/week';
import type { BatchWindow } from './pasalo';

export async function pasaloScope(db: Awaited<ReturnType<typeof getDb>>, input: {
  from?: string; to?: string; cycleKey?: string;
}): Promise<BatchWindow | null> {
  if (Boolean(input.from) !== Boolean(input.to)) throw new ApiError(400, 'Provide both batch dates.');
  if (input.from && input.to && input.to < input.from) throw new ApiError(400, 'Invalid batch dates.');
  const dates = input.from && input.to ? dateRangeBounds(input.from, input.to) : null;
  const cycleKeys = input.cycleKey ? [input.cycleKey] : undefined;
  return cycleKeys ? { start: new Date(0), end: new Date('9999-01-01'), ...dates, cycleKeys } : dates;
}
