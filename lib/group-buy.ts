// Group Buy (MOQ campaign) lifecycle — pure state machine.
//
// A campaign is 'open' while it accepts commitments. The admin may approve it
// (proceed below MOQ), extend it (new deadline, stays open), or cancel it (release
// commitments, refund). Only open campaigns can be acted on. Whether an order
// proceeds is derived from status + committed vs. MOQ (SRS §3.3, §7).

export type MoqCampaignStatus = 'open' | 'approved' | 'cancelled';
export type MoqCampaignAction = 'approve' | 'extend' | 'cancel';

const ACTION_RESULT: Record<MoqCampaignAction, MoqCampaignStatus> = {
  approve: 'approved',
  cancel: 'cancelled',
  extend: 'open', // deadline change is handled by the caller; status stays open
};

export function applyCampaignAction(
  current: MoqCampaignStatus,
  action: MoqCampaignAction,
): { ok: true; status: MoqCampaignStatus } | { ok: false; message: string } {
  if (current !== 'open') {
    return { ok: false, message: `Campaign is ${current}; only open campaigns can be modified.` };
  }
  return { ok: true, status: ACTION_RESULT[action] };
}

// Customers may commit only while the campaign is open.
export function canCommit(status: MoqCampaignStatus): boolean {
  return status === 'open';
}

export type CampaignOutcome = 'awaiting_moq' | 'processing' | 'refunded';

// The customer-facing outcome for a campaign's held commitments.
export function campaignOutcome(
  status: MoqCampaignStatus,
  committed: number,
  moq: number,
): CampaignOutcome {
  if (status === 'cancelled') return 'refunded';
  if (status === 'approved') return 'processing';
  return committed >= moq ? 'processing' : 'awaiting_moq';
}
