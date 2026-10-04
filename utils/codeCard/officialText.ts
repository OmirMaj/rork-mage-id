// utils/codeCard/officialText.ts — "Read the official text (free)": copy the
// section number, THEN open the governing volume in ICC's free viewer, so the
// contractor pastes it into the viewer's own search.
//
// Pure planning + an injected runner. The default runner binds utils/clipboard
// and React Native's Linking LAZILY (required inside the function), so bun can
// import this file and scripts/validate-code-cards.ts can drive the order with
// a recording double.
//
// WHY COPY-THEN-OPEN AND NOT A SECTION LINK. utils/codeAmendments.ts bans
// section-level ICC links: /content/<id>/<anything> returns HTTP 200 whether
// the chapter exists or not, so a link built from a recalled section number
// opens, looks authoritative and points at nothing. The volume link is the
// most this app may build, and every URL that reaches the opener goes through
// viewerUrlToOpen, which rebuilds it from the bare volume id — a path, query
// or fragment cannot ride along.

import { viewerUrlToOpen } from '../codeJurisdiction';
import type { CodeCardItem, CodeJurisdictionInfo } from './types';

export interface OfficialTextPlan {
  /** True when there is a volume to open. */
  available: boolean;
  /** What step 1 copies: the section number, exactly as the card shows it. */
  copyText: string;
  /** The volume URL, already rebuilt by viewerUrlToOpen. Null = nothing to open. */
  viewerUrl: string | null;
  /** ICC's own title for the volume. */
  viewerLabel: string | null;
  /** Short name for step 2: "2025 RCNYS" out of ICC's "(2025 RCNYS)". */
  viewerShort: string | null;
  /** Why the button is blocked, in plain words. Null when available. */
  blockedReason: string | null;
}

export const OFFICIAL_TEXT_BLOCKED =
  'No free viewer link for this address. MAGE has no verified edition here, so ask your building department which code applies.';

export const NO_SECTION_TO_COPY = 'No section to copy';
export const NO_SECTION_TOAST = 'Opened the code. This card has no section number, so search the viewer by topic.';

/** "2025 RCNYS" from "2025 Residential Code of New York State (2025 RCNYS)". */
export function viewerShortLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim();
  if (!t) return null;
  const paren = /\(([^)]+)\)\s*$/.exec(t);
  return paren ? paren[1].trim() : t;
}

/**
 * Plan the three steps for one card.
 *
 * The item's own evidence link (the ONE volume its citation names) wins over
 * the answer's jurisdiction link; both pass viewerUrlToOpen or are dropped.
 */
export function officialTextPlan(
  item: Pick<CodeCardItem, 'section' | 'evidence'>,
  info: Pick<CodeJurisdictionInfo, 'viewerUrl' | 'viewerLabel'> | null | undefined,
): OfficialTextPlan {
  const copyText = (item.section ?? '').trim();
  const fromItem = viewerUrlToOpen(item.evidence?.viewerUrl ?? null);
  const fromInfo = viewerUrlToOpen(info?.viewerUrl ?? null);
  const viewerUrl = fromItem ?? fromInfo;
  const viewerLabel = fromItem ? item.evidence?.viewerLabel ?? null : fromInfo ? info?.viewerLabel ?? null : null;
  const available = !!viewerUrl;
  return {
    available,
    copyText,
    viewerUrl,
    viewerLabel,
    viewerShort: viewerShortLabel(viewerLabel),
    blockedReason: available ? null : OFFICIAL_TEXT_BLOCKED,
  };
}

/** The three steps, in our words, for the opened card's Official text button. */
export function officialTextSteps(plan: OfficialTextPlan): { copies: string; opens: string; paste: string } {
  return {
    // A card with no section copies nothing, and says so (never "copied").
    copies: plan.copyText ? `“${plan.copyText}”` : NO_SECTION_TO_COPY,
    opens: plan.viewerShort ? `${plan.viewerShort} in ICC’s free viewer` : 'ICC’s free viewer',
    paste: plan.copyText ? 'Into its search' : 'Search it by topic',
  };
}

export interface OfficialTextDeps {
  copy: (text: string) => Promise<boolean>;
  open: (url: string) => Promise<unknown>;
}

export interface OfficialTextResult {
  copied: boolean;
  opened: boolean;
}

/**
 * Run the plan: copy FIRST, wait for it, THEN open. A failed copy still opens
 * the volume (the caller tells him to type the number instead); a blocked plan
 * does nothing at all.
 */
export async function runOfficialText(plan: OfficialTextPlan, deps: OfficialTextDeps): Promise<OfficialTextResult> {
  if (!plan.available || !plan.viewerUrl) return { copied: false, opened: false };
  // The last gate, again, at the opener: whatever reached here is rebuilt.
  const url = viewerUrlToOpen(plan.viewerUrl);
  if (!url) return { copied: false, opened: false };
  let copied = false;
  try {
    copied = plan.copyText ? await deps.copy(plan.copyText) : false;
  } catch {
    copied = false;
  }
  let opened = false;
  try {
    await deps.open(url);
    opened = true;
  } catch {
    opened = false;
  }
  return { copied, opened };
}

/** The app's real clipboard + external browser. Required lazily (see header). */
export function defaultOfficialTextDeps(): OfficialTextDeps {
  return {
    copy: async (text) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../clipboard') as { copyToClipboard: (t: string) => Promise<boolean> };
      return mod.copyToClipboard(text);
    },
    open: async (url) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rn = require('react-native') as { Linking: { openURL: (u: string) => Promise<unknown> } };
      return rn.Linking.openURL(url);
    },
  };
}

/** What the card says after a run. */
export function officialTextToast(plan: OfficialTextPlan, result: OfficialTextResult): string {
  if (!plan.available) return plan.blockedReason ?? OFFICIAL_TEXT_BLOCKED;
  if (!result.opened) return 'The viewer could not be opened. Try again, or open codes.iccsafe.org yourself.';
  if (!plan.copyText) return NO_SECTION_TOAST;
  if (!result.copied) return `Copy did not work. Type ${plan.copyText} into the viewer’s search.`;
  return `Copied ${plan.copyText}. Paste it into the viewer’s search.`;
}
