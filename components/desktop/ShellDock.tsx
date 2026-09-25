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
//   dock.open(<AskConversation />, { title: 'Ask MAGE' });
//
// It is 0 px wide when empty and 440 px (or opts.width) when open, and it is
// desktop-only: on a phone, on native and on web below 900 px the host renders
// nothing, so opening it there is a no-op the caller does not have to guard.
// Nothing opens it yet — wave 6c moves Ask / the action rail into it.
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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { SidePanel } from '@/components/desktop/SidePanel';

export interface ShellDockOptions {
  /** Initial width; clamped to SIDE_PANEL_MIN–SIDE_PANEL_MAX (360–560). A width
   *  he dragged to wins over it (saved per the dock, not per content). */
  width?: number;
  title?: string;
}

export interface ShellDockApi {
  content: React.ReactNode | null;
  open(node: React.ReactNode, opts?: ShellDockOptions): void;
  close(): void;
}

interface ShellDockState extends ShellDockApi {
  options: ShellDockOptions;
  /** Cmd/Ctrl+J hid it; the content is kept so the same key brings it back. */
  hidden: boolean;
  toggle(): void;
}

// A no-op default rather than a throw: a screen rendered outside the shell
// (a jest mount, a tokenised viewer) can still call useShellDock() safely.
const NOOP: ShellDockState = {
  content: null, options: {}, hidden: false, open: () => {}, close: () => {}, toggle: () => {},
};
const ShellDockContext = createContext<ShellDockState>(NOOP);

export function ShellDockProvider({ children, resetKey }: { children: React.ReactNode; resetKey?: string | null }) {
  const [content, setContent] = useState<React.ReactNode | null>(null);
  const [options, setOptions] = useState<ShellDockOptions>({});
  const [hidden, setHidden] = useState(false);

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
    () => ({ content, options, hidden, open, close, toggle }),
    [content, options, hidden, open, close, toggle],
  );
  return <ShellDockContext.Provider value={value}>{children}</ShellDockContext.Provider>;
}

export function useShellDock(): ShellDockApi {
  const { content, open, close } = useContext(ShellDockContext);
  return useMemo(() => ({ content, open, close }), [content, open, close]);
}

/**
 * The slot itself — mount it as the right-hand sibling of the Stack, inside
 * the shell's row. Renders nothing unless the shell is showing on desktop AND
 * something is docked.
 */
export function ShellDockHost({ visible = true }: { visible?: boolean }) {
  const { content, options, hidden, close, toggle } = useContext(ShellDockContext);
  const { width, sidebarWidth } = useResponsiveLayout();
  // Desktop WEB only (wave 6c): the dock is browser chrome. A native window
  // >= 1024 (an Android tablet) is "desktop" for layout but never gets it.
  const desktopWeb = useIsDesktopWeb();

  if (!desktopWeb || !visible || content == null) return null;
  return (
    <SidePanel
      open={!hidden}
      onClose={close}
      onToggle={toggle}
      title={options.title ?? 'Side panel'}
      panelId="shell-dock"
      defaultWidth={options.width}
      // The page's column: the window less the sidebar the shell is showing
      // (visible === the shell is up). sidebarWidth is rail-aware (64 on a
      // canvas route, wave 6c). Under 1200 → overlay, not squeeze.
      containerWidth={width - sidebarWidth}
      // Docked content (a chat, a list) manages its own scroll.
      scroll={false}
      hotkeyScope="global"
      nativeID="mage-shell-dock"
    >
      {content}
    </SidePanel>
  );
}
