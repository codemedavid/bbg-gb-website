import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeeklyReport } from '@/lib/report/build';
import { OrderSummaryReport } from './OrderSummaryReport';

const report: WeeklyReport = {
  weekNo: 21,
  rangeLabel: 'Mon May 25 – Sun May 31',
  orderCount: 2,
  counts: { paid: 1, pending: 1, cancelled: 0 },
  totals: { usd: 100, php: 5000 },
  rows: [
    {
      index: 1, invoice: 'BBG-2500', date: '5/25/2025', customer: 'Ana Reyes', contact: '',
      phone: '09171234567', email: 'ana@example.com', address: 'QC',
      products: ['Retatrutide x5 @ $6.80'], courier: 'Lalamove', packedBy: 'Cza',
      payment: 'GCash', paymentStatus: 'Paid', orderStatus: 'Shipped', status: 'Shipped', usd: 100, php: 5000,
    },
  ],
};

describe('OrderSummaryReport', () => {
  it('renders rollup tiles and a detail row per order', () => {
    render(<OrderSummaryReport report={report} />);

    expect(screen.getByText('BBG-2500')).toBeInTheDocument();
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Retatrutide x5 @ $6.80')).toBeInTheDocument();
    expect(screen.getByText('Lalamove')).toBeInTheDocument();
    // Rollup tiles present (unique labels).
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Revenue (PHP)')).toBeInTheDocument();
    expect(screen.getAllByText('Paid').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an empty state when there are no orders', () => {
    render(<OrderSummaryReport report={{ ...report, orderCount: 0, rows: [] }} />);
    expect(screen.getByText(/no orders in this period/i)).toBeInTheDocument();
  });
});
