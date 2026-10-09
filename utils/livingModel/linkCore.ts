// utils/livingModel/linkCore.ts — rooms and the schedule tasks that happen in them (pure).
//
// The Living Model, Phase 1. A schedule task carries no room. The lightest
// honest link is a tick: for each room the person ticks the tasks that happen
// in it, and the ticks are kept with the job model (JobModel.links).
//
// A SUGGESTION IS NOT A LINK. `suggestLinks` only returns a list for the
// screen to show as "Suggested". Nothing in this file writes a suggestion into
// the model by itself: `confirmSuggestions` does, and it is called only from
// the person's tap on Confirm Suggested. Every reader of links
// (modelCore.linkedTaskIds, replayInput) reads JobModel.links and nothing else,
// so an unconfirmed suggestion never colours a room.
// scripts/validate-living-model.ts plants a version that applies suggestions
// on its own and must go red.

import type { TradeKey } from '@/types';
import { setRoomTaskLink } from './modelCore';
import type { JobModel, PlacedRoom, RoomKind } from './types';

export interface LinkTask {
  id: string;
  title: string;
  trade: TradeKey;
}

export type SuggestionReason =
  /** The task's title has the room's name in it. */
  | 'room_name'
  /** The task's title has a word for this kind of room in it. */
  | 'room_kind'
  /** The task's trade usually works in this kind of room. */
  | 'trade';

export interface LinkSuggestion {
  taskId: string;
  reason: SuggestionReason;
}

/** Words in a task title that point at a kind of room. */
export const KIND_WORDS: Readonly<Record<RoomKind, RegExp | null>> = {
  kitchen: /kitchen|cabinet|countertop|backsplash|appliance|range hood/i,
  bathroom: /\bbath|shower|\btub\b|toilet|vanity|powder room/i,
  bedroom: /bedroom|\bbed\b/i,
  living: /living room|family room|great room|\bden\b/i,
  dining: /dining/i,
  hall: /hall|corridor|foyer|entry/i,
  closet: /closet|pantry/i,
  laundry: /laundry|washer|dryer|utility room/i,
  garage: /garage/i,
  basement: /basement|cellar/i,
  office: /office|study/i,
  other: null,
};

/** The kinds of room a trade usually works in. A trade left out here suggests nothing. */
export const TRADE_ROOM_KINDS: Readonly<Partial<Record<TradeKey, readonly RoomKind[]>>> = {
  plumbing: ['kitchen', 'bathroom', 'laundry'],
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tasks the app thinks may happen in a room. A list to show, never a link. Tasks already ticked are left out. */
export function suggestLinks(room: PlacedRoom, tasks: readonly LinkTask[], ticked: readonly string[]): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const name = room.name.trim();
  const nameRe = name.length >= 3 ? new RegExp(`(^|[^a-z0-9])${escapeRe(name)}([^a-z0-9]|$)`, 'i') : null;
  const kindRe = KIND_WORDS[room.kind];
  for (const t of tasks) {
    if (ticked.includes(t.id)) continue;
    if (nameRe && nameRe.test(t.title)) { out.push({ taskId: t.id, reason: 'room_name' }); continue; }
    if (kindRe && kindRe.test(t.title)) { out.push({ taskId: t.id, reason: 'room_kind' }); continue; }
    if ((TRADE_ROOM_KINDS[t.trade] ?? []).includes(room.kind)) out.push({ taskId: t.id, reason: 'trade' });
  }
  return out;
}

/** Tick the suggested tasks for one room. Called ONLY from the person's tap on Confirm Suggested. */
export function confirmSuggestions(model: JobModel, roomId: string, taskIds: readonly string[]): JobModel {
  let next = model;
  for (const id of taskIds) next = setRoomTaskLink(next, roomId, id, true);
  return next;
}

/** The ticked task ids for a room that are still in the schedule, and how many are not. */
export function liveLinks(model: JobModel, roomId: string, scheduleTaskIds: ReadonlySet<string>): { ids: string[]; gone: number } {
  const all = model.links[roomId] ?? [];
  const ids = all.filter((id) => scheduleTaskIds.has(id));
  return { ids, gone: all.length - ids.length };
}

/** How many rooms have at least one ticked task that is still in the schedule. */
export function linkedRoomCount(model: JobModel, scheduleTaskIds: ReadonlySet<string>): number {
  return model.rooms.filter((r) => liveLinks(model, r.id, scheduleTaskIds).ids.length > 0).length;
}
