'use client';
// Draft preservation for the routed campaign form.
//
// Create and Edit are pages now, not a modal, so leaving the screen unmounts the
// form and React state goes with it. The client asked that entered data survive
// navigating back, which means the draft has to outlive the component.
//
// sessionStorage, not localStorage: an abandoned campaign draft should not
// follow the admin into next week the way the cart deliberately does. Keyed per
// campaign so editing batch #2 can never resurrect what was typed into batch #1.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CampaignDraft } from './campaign-form';

const PREFIX = 'bbg-campaign-draft:';

// `id` is the campaign's id, or 'new' while creating.
export const campaignDraftKey = (id: string): string => `${PREFIX}${id}`;

export function readCampaignDraft(id: string): CampaignDraft | null {
  // Server render and older browsers both have no sessionStorage; a missing
  // draft is the correct answer, not a crash on the way to the form.
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(campaignDraftKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CampaignDraft;
  } catch {
    // A half-written or hand-edited entry is not worth failing the screen over.
    sessionStorage.removeItem(campaignDraftKey(id));
    return null;
  }
}

export function writeCampaignDraft(id: string, draft: CampaignDraft): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(campaignDraftKey(id), JSON.stringify(draft));
  } catch {
    // Private mode and full quotas both throw here. Losing the safety net is
    // survivable; losing the form the admin is typing into is not.
  }
}

export function clearCampaignDraft(id: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(campaignDraftKey(id));
}

export type CampaignDraftState = {
  draft: CampaignDraft;
  setDraft: (next: CampaignDraft) => void;
  /** A previous visit's draft was picked up — the form says so rather than appearing filled by magic. */
  restored: boolean;
  /** Throw the stored draft away and return the form to `initial`. */
  discard: () => void;
  /** Drop the stored draft without touching the form — used once the campaign is saved. */
  clear: () => void;
};

export function useCampaignDraft(id: string, initial: CampaignDraft): CampaignDraftState {
  const [draft, setDraft] = useState<CampaignDraft>(initial);
  const [restored, setRestored] = useState(false);
  // Storage is read after mount, never during render: on the server there is no
  // sessionStorage, and a first render that disagreed with the client's would
  // hydrate wrong. Until that pass has run, nothing may be written back —
  // otherwise the blank initial state overwrites the stored draft before it is
  // read, which loses exactly the work this hook exists to keep.
  const [hydrated, setHydrated] = useState(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    const saved = readCampaignDraft(id);
    if (saved) {
      setDraft(saved);
      setRestored(true);
    } else {
      setDraft(initialRef.current);
      setRestored(false);
    }
    setHydrated(true);
  }, [id]);

  // A draft is stored only while it differs from what the form started with. An
  // untouched form leaves nothing behind, and a draft edited back to the
  // original — or discarded — drops its entry rather than lingering as a
  // "restored draft" banner over identical values.
  useEffect(() => {
    if (!hydrated) return;
    if (JSON.stringify(draft) === JSON.stringify(initialRef.current)) clearCampaignDraft(id);
    else writeCampaignDraft(id, draft);
  }, [id, draft, hydrated]);

  const discard = useCallback(() => {
    clearCampaignDraft(id);
    setDraft(initialRef.current);
    setRestored(false);
  }, [id]);

  const clear = useCallback(() => {
    clearCampaignDraft(id);
    setRestored(false);
  }, [id]);

  return { draft, setDraft, restored, discard, clear };
}
