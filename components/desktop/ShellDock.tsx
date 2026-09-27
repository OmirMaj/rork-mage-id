// components/desktop/ShellDock.tsx — the right-hand slot of the desktop shell.
//
// WHY (wave 6b). The desktop web app has one place for side content today —
// DesktopActionRail, a 300 px column that only the tab routes get and that
// sits on Settings, Subs and the Marketplace as well as Home. Ask MAGE, the
// Copilot and the action rail all want the same thing: a panel NEXT TO the
// page rather than a modal OVER it. The dock is that slot, owned by the shell
// so every route can open it:
//
//   const dock = useShellDock();
//   dock.open(<AskConversation variant="panel" />, { id: ASK_DOCK_ID, title: 'Ask MAGE' });
//
// It is 0 px wide when empty and 440 px (or opts.width) when open, and it is
// desktop-only: on a phone, on native and on web below 900 px the host renders
// nothing, so opening it there is a no-op the caller does not have to guard.
// hooks/useAskDock opens Ask in it; the sidebar's Action Required row docks
// the attention list (components/DesktopActionRail variant 'dock').
//
// The dock IS components/desktop/SidePanel — one right-panel implementation,
// one width source (utils/splitViewLayout SIDE_PANEL_*):
//   • resizable 360–560 by dragging its left edge, saved (mageid_panel_shell-dock);
//   • under a 1200 px content column it OVERLAYS the page's right edge instead
//     of squeezing it (on a 1366 laptop a docked 440 would leave the page 686);
//   • Esc closes it and Cmd/Ctrl+J hides / shows it, through the one shortcut
//     registry (hooks/useHotkeys) at GLOBAL scope: a page's own Esc (a
//     SplitView record, a table search) wins over the dock's, and an open
//     Sheet or menu (dialog scope) silences it. It used to be a raw window
//     listener, so one Esc closed a sheet AND the dock, and an Esc typed in
//     the dock's own field never reached it (react-native-web's TextInput
//     stops keydown propagation; the registry reads fields in capture phase).
//
// The content is per-session UI state held in memory only. RootLayoutNav
// closes it when the signed-in account changes, so one tenant's panel never
// survives into the next account's shell.
//
// WAVE 6d restore (d6r, lane K1) — the dock hosts Ask MAGE and the Action
// Required list, so it grew the API they stand on:
//   • `id` names what is docked (ASK_DOCK_ID / ATTENTION_DOCK_ID), so a caller
//     can ask "is Ask the thing in the dock?" and bring it back with show();
//   • the content stays MOUNTED while it is not drawn — hidden by Cmd+J,
//     suppressed on its own page (/ask suppresses the Ask dock), or on a
//     shell-exempt route (/copilot) — so a half-typed question and the turns
//     above it survive the trip (SidePanel keepMounted);
//   • `showing` is true only while the panel is actually on screen, and
//     `canShow(id)` says whether the host on THIS route would draw `id`. The
//     Brain FAB hides on `showing` (not on "something is docked": on an exempt
//     route the dock is not drawn, and the FAB is then the only way back to
//     Ask), useAskDock falls back to the /ask page where the dock cannot show,
//     and the host binds its Cmd+J only where the docked content can show — a
//     Cmd+J that flipped an invisible dock would bring it back hidden later.
//   • On a canvas route (utils/sidebarRail isCanvasRoute — Schedule Pro, the
//     plan viewer, the takeoff canvases) the dock FLOATS over the canvas's
//     right edge instead of docking beside it. Schedule Pro's width gate
//     (schedule-pro.tsx scheduleProContentWidth) and proFitsWindow read the
//     WINDOW, not the dock, so a docked 440 would squeeze a grid that had
//     already decided it fits (V-6c-runtime S4).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSegments } from 'expo-router';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { SidePanel } from '@/components/desktop/SidePanel';
import { isCanvasRoute } from '@/utils/sidebarRail';

/** What the Ask conversation docks under (hooks/useAskDock). */
export const ASK_DOCK_ID = 'ask';
/** What the Action Required list docks under (the sidebar's footer row). */
export const ATTENTION_DOCK_ID = 'attention';

export interface ShellDockOptions {
  /** Names the docked content (ASK_DOCK_ID, ATTENTION_DOCK_ID…). Absent → null. */
  id?: string;
  /** Initial width; clamped to SIDE_PANEL_MIN–SIDE_PANEL_MAX (360–560). A width
   *  he dragged to wins over it (saved per the dock, not per content). */
  width?: number;
  title?: string;
}

export interface ShellDockApi {
  content: React.ReactNode | null;
  /** options.id of what is docked; null when empty or docked without an id. */
  id: string | null;
  /** Cmd/Ctrl+J hid it; the content is kept (and stays mounted) so the same
   *  key — or show() — brings it back. */
  hidden: boolean;
  open(node: React.ReactNode, opts?: ShellDockOptions): void;
  close(): void;
  /** Hide ⇄ show, keeping the content. */
  toggle(): void;
  /** Un-hide, keeping the content. */
  show(): void;
  /** The panel is on screen right now: desktop web, the host visible on this
   *  route, something docked, not hidden, not suppressed on this route. */
  showing: boolean;
  /** Would the host on this route draw content docked under `id`? (visible
   *  here, and this route does not suppress `id`.) False with no host. */
  canShow(id: string): boolean;
}

/** What the mounted ShellDockHost reports about the current route. */
interface HostRecord { visible: boolean; suppressId: string | null }

interface ShellDockState {
  content: React.ReactNode | null;
  options: ShellDockOptions;
  hidden: boolean;
  host: HostRecord | null;
  open(node: React.ReactNode, opts?: ShellDockOptions): void;
  close(): void;
  toggle(): void;
  show(): void;
}

// A no-op default rather than a throw: a screen rendered outside the shell
// (a jest mount, a tokenised viewer) can still call useShellDock() safely.
const NOOP: ShellDockState = {
  content: null, options: {}, hidden: false, host: null,
  open: () => {}, close: () => {}, toggle: () => {}, show: () => {},
};
const ShellDockContext = createContext<ShellDockState>(NOOP);
/** The host's private channel to the provider — NOT on ShellDockApi, so the
 *  public API stays read-only about where the dock can show. */
const ShellDockHostContext = createContext<(host: HostRecord | null) => void>(() => {});

function sameHost(a: HostRecord | null, b: HostRecord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.visible === b.visible && a.suppressId === b.suppressId;
}

export function ShellDockProvider({ children, resetKey }: { children: React.ReactNode; resetKey?: string | null }) {
  const [content, setContent] = useState<React.ReactNode | null>(null);
  const [options, setOptions] = useState<ShellDockOptions>({});
  const [hidden, setHidden] = useState(false);
  const [host, setHostState] = useState<HostRecord | null>(null);

  const open = useCallback((node: React.ReactNode, opts?: ShellDockOptions) => {
    setContent(node);
    setOptions(opts ?? {});
    setHidden(false);
  }, []);
  const close = useCallback(() => {
    setContent(null);
    setOptions({});
    setHidden(false);
  }, []);
  const toggle = useCallback(() => { setHidden((h) => !h); }, []);
  const show = useCallback(() => { setHidden(false); }, []);
  // Written only when it differs, so the host's effect never loops a render.
  const setHost = useCallback((next: HostRecord | null) => {
    setHostState((prev) => (sameHost(prev, next) ? prev : next));
  }, []);

  // Tenant boundary: a new account (or signing out) empties the dock. Only on
  // a CHANGE of key — child effects run before this one, so closing on mount
  // would wipe anything a screen docked during its own first render.
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    close();
  }, [resetKey, close]);

  const value = useMemo(
    () => ({ content, options, hidden, host, open, close, toggle, show }),
    [content, options, hidden, host, open, close, toggle, show],
  );
  return (
    <ShellDockHostContext.Provider value={setHost}>
      <ShellDockContext.Provider value={value}>{children}</ShellDockContext.Provider>
    </ShellDockHostContext.Provider>
  );
}

export function useShellDock(): ShellDockApi {
  const { content, options, hidden, host, open, close, toggle, show } = useContext(ShellDockContext);
  const id = options.id ?? null;
  return useMemo(() => {
    const hostVisible = !!host?.visible;
    const suppressId = host?.suppressId ?? null;
    return {
      content,
      id,
      hidden,
      open,
      close,
      toggle,
      show,
      showing: hostVisible && content != null && !hidden && !(suppressId != null && id === suppressId),
      canShow: (target: string) => hostVisible && suppressId !== target,
    };
  }, [content, id, hidden, host, open, close, toggle, show]);
}

/**
 * The slot itself — mount it as the right-hand sibling of the Stack, inside
 * the shell's row. Renders nothing unless the shell is on desktop web AND
 * something is docked. The docked content stays mounted (display: none) while
 * it is hidden (Cmd+J), suppressed on this route (`suppressId` — the /ask page
 * suppresses the Ask dock) or not `visible` (a shell-exempt route).
 */
export function ShellDockHost({ visible = true, suppressId = null }: { visible?: boolean; suppressId?: string | null }) {
  const { content, options, hidden, close, toggle } = useContext(ShellDockContext);
  const setHost = useContext(ShellDockHostContext);
  const { width, sidebarWidth } = useResponsiveLayout();
  // Desktop WEB only (wave 6c): the dock is browser chrome. A native window
  // >= 1024 (an Android tablet) is "desktop" for layout but never gets it.
  const desktopWeb = useIsDesktopWeb();
  // S4: on a canvas the dock floats over the right edge instead of docking —
  // Schedule Pro's width gate (schedule-pro.tsx scheduleProContentWidth) and
  // proFitsWindow read the window, not the dock (V-6c-runtime S4).
  const segments = useSegments();
  const canvas = isCanvasRoute(segments[0]);

  // Tell the provider where the dock can show on this route (showing /
  // canShow). Above the early return: the record must exist while the dock is
  // EMPTY too — that is when useAskDock asks canShow before docking Ask.
  const hostVisible = desktopWeb && visible;
  useEffect(() => { setHost({ visible: hostVisible, suppressId }); }, [setHost, hostVisible, suppressId]);
  useEffect(() => () => setHost(null), [setHost]);

  if (!desktopWeb || content == null) return null;
  const suppressedNow = suppressId != null && options.id === suppressId;
  return (
    <SidePanel
      open={visible && !hidden && !suppressedNow}
      keepMounted
      onClose={close}
      // Cmd+J only where the docked content can show: on an exempt route or
      // on its own suppressing page a Cmd+J would flip an invisible dock, and
      // it would come back hidden later with no visible way to tell why.
      {...(visible && !suppressedNow ? { onToggle: toggle } : null)}
      title={options.title ?? 'Side panel'}
      panelId="shell-dock"
      defaultWidth={options.width}
      // The page's column: the window less the sidebar the shell is showing
      // (visible === the shell is up). sidebarWidth is rail-aware (64 on a
      // canvas route, wave 6c). Under 1200 → overlay, not squeeze.
      containerWidth={width - sidebarWidth}
      // Canvas routes always overlay (S4 above); undefined keeps SidePanel's
      // SIDE_PANEL_OVERLAY_BELOW default everywhere else.
      overlayBelow={canvas ? Number.POSITIVE_INFINITY : undefined}
      // Docked content (a chat, a list) manages its own scroll.
      scroll={false}
      hotkeyScope="global"
      nativeID="mage-shell-dock"
    >
      {content}
    </SidePanel>
  );
}
