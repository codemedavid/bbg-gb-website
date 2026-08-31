'use client';
import { OrdersBoard } from './OrdersBoard';

// Every order, whatever it was bought through. The three per-segment boards live
// one level down — see SEGMENT_TABS in OrdersBoard.
export default function AdminOrdersPage() {
  return <OrdersBoard />;
}
