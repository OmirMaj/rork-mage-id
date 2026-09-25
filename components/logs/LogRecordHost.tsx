// components/logs/LogRecordHost.tsx — how an editor behaves when it is the
// record pane of a log (wave 6c, lane G). DESKTOP WEB ONLY in effect.
//
// The four editors (RFI, submittal, change order, invoice) were written as
// full screens: Save ends in router.back(), a new record's save ends in
// router.replace(…same route, ?rfiId=…). Beside a log those would pop the
// whole log off the stack. Inside a LogShell split the editor reads this
// context instead:
//
//   useLogAwareRouter()  — back() closes the record (the list stays);
//                          replace(same route + record id) opens that record
//                          in place (setParams); any other replace is the real
//                          router's.
//   useLogAwareBack(fb)  — the change order's useSafeBack, same idea.
//   useLogRecordDirty(g) — the editor tells the host it has unsaved edits, so
//                          opening another row, j/k and Esc ask first.
//
// PHONE IDENTICAL: the context is null everywhere except inside a LogShell,
// and LogShell only mounts on desktop web. With no host, useLogAwareRouter
// returns useRouter()'s own object (the same reference), useLogAwareBack
// returns its fallback, and useLogRecordDirty registers nothing.

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import { recordIdFromHref, type LogKind } from '@/utils/logs/logRoutes';

type AppRouter = ReturnType<typeof useRouter>;

export interface LogRecordHost {
  kind: LogKind;
  /** Close the open record (no dirty check: the editor saved or chose to leave). */
  close(): void;
  /** Open another record of this kind in the pane (after a create saved). */
  replaceRecord(id: string): void;
  /** The editor's "has unsaved edits" probe, or null. */
  setDirtyProbe(fn: (() => boolean) | null): void;
}

/** null outside a log's record pane — always null on a phone. */
export const LogRecordContext = createContext<LogRecordHost | null>(null);

export function useLogRecordHost(): LogRecordHost | null {
  return useContext(LogRecordContext);
}

/**
 * The router an editor should use. Without a host this IS useRouter() (the
 * same object), so a phone — which never has a host — is unchanged.
 */
export function useLogAwareRouter(): AppRouter {
  const router = useRouter();
  const host = useContext(LogRecordContext);
  return useMemo(() => {
    if (!host) return router;
    const replace: AppRouter['replace'] = (href, options) => {
      const id = recordIdFromHref(host.kind, href);
      if (id) {
        host.replaceRecord(id);
        return;
      }
      router.replace(href, options);
    };
    return {
      ...router,
      back: () => host.close(),
      canGoBack: () => true,
      replace,
    };
  }, [router, host]);
}

/** `fallback` (the screen's own back) outside a log; close-the-record inside. */
export function useLogAwareBack(fallback: () => void): () => void {
  const host = useContext(LogRecordContext);
  return host ? host.close : fallback;
}

/** Tell the host whether the editor holds unsaved edits. A no-op without one. */
export function useLogRecordDirty(getter: () => boolean): void {
  const host = useContext(LogRecordContext);
  const ref = useRef(getter);
  ref.current = getter;
  useEffect(() => {
    if (!host) return undefined;
    host.setDirtyProbe(() => ref.current());
    return () => host.setDirtyProbe(null);
  }, [host]);
}

export function LogRecordProvider({ host, children }: { host: LogRecordHost; children?: React.ReactNode }) {
  return <LogRecordContext.Provider value={host}>{children}</LogRecordContext.Provider>;
}
