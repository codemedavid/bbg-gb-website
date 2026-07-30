// Draft preservation for the Group Buy campaign form.
//
// The client asked that entered data survive navigating back. Create and Edit
// are now real routes rather than a modal, so leaving the screen unmounts the
// form and React state is gone — the draft has to outlive the component.
//
// sessionStorage, not localStorage: an abandoned campaign draft should not
// follow the admin into next week. Keyed per campaign so editing batch #2 can
// never resurrect what was typed into batch #1.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emptyCampaignDraft, type CampaignDraft } from './campaign-form';
import { useCampaignDraft, readCampaignDraft, campaignDraftKey } from './campaign-draft';

const typed = (o: Partial<CampaignDraft> = {}): CampaignDraft =>
  ({ ...emptyCampaignDraft, name: 'Retatrutide 30mg', ...o });

beforeEach(() => sessionStorage.clear());

describe('with nothing stored', () => {
  it('starts from the supplied initial draft', () => {
    const { result } = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    expect(result.current.draft).toEqual(emptyCampaignDraft);
    expect(result.current.restored).toBe(false);
  });

  it('persists what was entered', () => {
    const { result } = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    act(() => result.current.setDraft(typed()));
    expect(readCampaignDraft('new')?.name).toBe('Retatrutide 30mg');
  });
});

describe('returning to the form', () => {
  // The headline guarantee: type, leave, come back, it is still there.
  it('restores what was entered before the form unmounted', () => {
    const first = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    act(() => first.result.current.setDraft(typed({ pricePerKitPhp: '5200' })));
    first.unmount();

    const second = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    expect(second.result.current.draft.name).toBe('Retatrutide 30mg');
    expect(second.result.current.draft.pricePerKitPhp).toBe('5200');
    expect(second.result.current.restored).toBe(true);
  });

  // Mounting must not write the blank initial over the stored draft before the
  // restore pass has read it — that would silently eat the admin's work.
  it('does not overwrite the stored draft with the blank initial on mount', () => {
    sessionStorage.setItem(campaignDraftKey('new'), JSON.stringify(typed()));
    renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    expect(readCampaignDraft('new')?.name).toBe('Retatrutide 30mg');
  });

  it('keeps drafts for different campaigns apart', () => {
    const one = renderHook(() => useCampaignDraft('c1', emptyCampaignDraft));
    act(() => one.result.current.setDraft(typed({ name: 'Batch one' })));

    const two = renderHook(() => useCampaignDraft('c2', emptyCampaignDraft));
    expect(two.result.current.draft).toEqual(emptyCampaignDraft);
    expect(two.result.current.restored).toBe(false);
  });
});

describe('clearing', () => {
  it('discard() drops the stored draft and returns the form to its initial state', () => {
    const { result } = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    act(() => result.current.setDraft(typed()));
    act(() => result.current.discard());

    expect(result.current.draft).toEqual(emptyCampaignDraft);
    expect(result.current.restored).toBe(false);
    expect(readCampaignDraft('new')).toBeNull();
  });

  // Called once the campaign is saved: the draft has become the record, so the
  // next visit must start from the server's copy, not the stale form.
  it('clear() drops the stored draft', () => {
    const { result } = renderHook(() => useCampaignDraft('c1', emptyCampaignDraft));
    act(() => result.current.setDraft(typed()));
    act(() => result.current.clear());
    expect(readCampaignDraft('c1')).toBeNull();
  });
});

describe('damaged storage', () => {
  it('ignores an unreadable draft instead of crashing the form', () => {
    sessionStorage.setItem(campaignDraftKey('new'), '{not json');
    expect(readCampaignDraft('new')).toBeNull();

    const { result } = renderHook(() => useCampaignDraft('new', emptyCampaignDraft));
    expect(result.current.draft).toEqual(emptyCampaignDraft);
    expect(result.current.restored).toBe(false);
  });
});
