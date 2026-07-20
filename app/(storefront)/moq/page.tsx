import { notFound } from 'next/navigation';
import { getMoqPageEnabled } from '@/lib/settings';
import { MoqBoard } from './MoqBoard';

// The MOQ page is a Server Component purely so the visibility toggle can be
// enforced before anything renders. A client-side redirect would still ship the
// page and flash it on screen; notFound() means a customer who types the URL
// while the page is switched off gets a real 404, exactly like a route that
// does not exist. The public API enforces the same rule independently.
export const dynamic = 'force-dynamic';

export default async function MoqPage() {
  if (!(await getMoqPageEnabled())) notFound();
  return <MoqBoard />;
}
