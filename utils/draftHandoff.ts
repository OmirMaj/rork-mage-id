// utils/draftHandoff.ts — hands a drafted title and description to the RFI and
// punch forms without putting the text in the route (lane ATTPORTAL).
//
// Why: route params are the URL's query string on the web app, so text in them
// lands in browser history and in the navigation breadcrumbs of an error
// report. What MAGE read out of a client's files must not travel that way, and
// a text param would also let a crafted link prefill a form. The route carries
// a random id; the text stays here.
//
// In memory only: nothing is persisted, so it is gone when the app restarts.
// At most three drafts are held and each one lasts ten minutes. A draft can be
// read more than once, because a form can remount. Nothing here logs.

import { generateUUID } from '@/utils/generateId';

export interface DraftHandoff { title: string; description: string }

export const DRAFT_HANDOFF_MAX_ENTRIES = 3;
export const DRAFT_HANDOFF_TTL_MS = 10 * 60 * 1000;
export const DRAFT_HANDOFF_TITLE_MAX = 80;
export const DRAFT_HANDOFF_DESCRIPTION_MAX = 1000;

const held = new Map<string, { draft: DraftHandoff; at: number }>();

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').slice(0, max);

/** Keeps a clipped copy and returns the id the route carries. */
export function stashDraftHandoff(d: DraftHandoff, now: number = Date.now()): string {
  const id = generateUUID();
  held.set(id, {
    draft: {
      title: clip(d?.title, DRAFT_HANDOFF_TITLE_MAX),
      description: clip(d?.description, DRAFT_HANDOFF_DESCRIPTION_MAX),
    },
    at: now,
  });
  // A Map keeps insertion order, so the first key is the oldest.
  while (held.size > DRAFT_HANDOFF_MAX_ENTRIES) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
  return id;
}

/** The draft for an id that is still held and younger than ten minutes, else null. */
export function readDraftHandoff(id: unknown, now: number = Date.now()): DraftHandoff | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  const entry = held.get(id);
  if (!entry) return null;
  if (now - entry.at >= DRAFT_HANDOFF_TTL_MS) {
    held.delete(id);
    return null;
  }
  return { title: entry.draft.title, description: entry.draft.description };
}

/** Drops every held draft (tests, and anything that ends the session). */
export function clearDraftHandoffs(): void {
  held.clear();
}
