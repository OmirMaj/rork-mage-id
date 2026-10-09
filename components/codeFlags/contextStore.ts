// components/codeFlags/contextStore.ts — Code Flags: what the chips on a
// screen know about the project (its place, the building's year, the kind of
// job). CodeFlagsProbe, mounted ONCE per screen, works it out and publishes it
// here; every chip on that screen reads it. That keeps the building-record
// hooks to one instance per screen instead of one per line.
//
// A chip whose project has no published context reads the default: no place,
// no year, residential. That is the general flag, with no section number and
// no local link.
import { useSyncExternalStore } from 'react';
import { DEFAULT_CODE_FLAG_CONTEXT, type CodeFlagContext } from '@/utils/codeFlags/match';

const contexts = new Map<string, CodeFlagContext>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

function same(a: CodeFlagContext | undefined, b: CodeFlagContext): boolean {
  return !!a && a.yearBuilt === b.yearBuilt && a.jobKind === b.jobKind && a.place.id === b.place.id
    && a.place.name === b.place.name && a.place.hasAddress === b.place.hasAddress
    && a.place.unsettledBaltimore === b.place.unsettledBaltimore && a.place.state === b.place.state;
}

export function publishCodeFlagContext(projectId: string, ctx: CodeFlagContext): void {
  if (same(contexts.get(projectId), ctx)) return;
  contexts.set(projectId, ctx);
  emit();
}

export function clearCodeFlagContext(projectId: string): void {
  if (contexts.delete(projectId)) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCodeFlagContext(projectId: string | null | undefined): CodeFlagContext {
  const read = () => (projectId ? contexts.get(projectId) : undefined) ?? DEFAULT_CODE_FLAG_CONTEXT;
  return useSyncExternalStore(subscribe, read, read);
}

/** Tests only. */
export function resetCodeFlagContextsForTest(): void {
  contexts.clear();
  listeners.clear();
}
