// components/desktop/ShellHotkeys.tsx — the desktop web app's global keys.
//
// WHY (wave 6d restore, d6r lane K1). The keyboard shell a PM expects, on the
// one shortcut registry (hooks/useHotkeys) at GLOBAL scope, so every page's
// own keys (a record's Esc, a table's j/k, Schedule Pro's Cmd+J command
// field) still win on their route, and an open dialog silences all of it:
//
//   ⌘K   Search            listed only — the root layout's raw listener owns
//                           it (C10); the registry never fires it
//   ⌘J   Ask MAGE          opens the Ask dock when the dock is EMPTY and the
//                           host can show Ask here; with something docked the
//                           dock's own Cmd+J hides / shows it (ShellDockHost),
//                           and on a shell-exempt route or /ask nothing binds
//                           Cmd+J at the shell level at all
//   ?    Keyboard shortcuts the sheet listing all of this
//   g …  Go to             the 13 chords (utils/shellChords), routed through
//                           the sidebar's own rules; a client or property
//                           manager gets only Projects and Inbox
//
// Desktop web only: off it this renders null and runs no hooks at all (the
// phone tree is untouched — the root layout's SearchHotkeyListener returns
// <ShellHotkeys />, which is null there).

import React, { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { ASK_DOCK_ID, useShellDock } from '@/components/desktop/ShellDock';
import { ShortcutSheet, openShortcutSheet } from '@/components/desktop/ShortcutSheet';
import { routeHref } from '@/components/desktop/RowLink';
import { useAskDock } from '@/hooks/useAskDock';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { getSidebarRail } from '@/utils/sidebarRailStore';
import { SCHEDULE_PRO_FEATURE, proFitsWindow } from '@/utils/scheduleRoute';
import { chordTarget, chordsFor } from '@/utils/shellChords';

export function ShellHotkeys() {
  const isDesktopWeb = useIsDesktopWeb();
  return isDesktopWeb ? <SignedInGate /> : null;
}

// The root layout mounts this outside every auth gate, so on /login, /signup
// and onboarding there is no role yet: no '?' sheet, no g-chords (a 'g r'
// there would push /rfi and replay it after sign-in). Cmd+K is the root
// listener's and is unaffected.
function SignedInGate() {
  const { userRole } = useCoreData();
  return userRole ? <DesktopShellHotkeys /> : null;
}

function DesktopShellHotkeys() {
  const router = useRouter();
  const dock = useShellDock();
  const { openAsk } = useAskDock();
  const { activeProjectId } = useActiveProject();
  const { userRole } = useCoreData();
  const canPro = useProjectAccess(activeProjectId ?? undefined).canAccess(SCHEDULE_PRO_FEATURE);
  const { width } = useResponsiveLayout();
  const proFits = proFitsWindow(width, true, getSidebarRail().pref);

  const chords = useMemo(() => chordsFor(userRole), [userRole]);

  // Handlers and `when` are forwarded through useHotkeys' ref, so these fresh
  // closures read the current dock / job at key time without re-registering.
  const bindings = useMemo<HotkeyBinding[]>(() => [
    { combo: 'mod+k', label: 'Search', group: 'App' },
    {
      combo: 'mod+j', label: 'Ask MAGE', group: 'App',
      handler: () => openAsk(),
      when: () => dock.content == null && dock.canShow(ASK_DOCK_ID),
    },
    { combo: '?', label: 'Keyboard shortcuts', group: 'App', handler: openShortcutSheet },
    ...chords.map((c): HotkeyBinding => ({
      combo: c.combo,
      label: c.label,
      group: 'Go to',
      handler: () => {
        const t = chordTarget(c, { activeProjectId: activeProjectId ?? null, schedule: { canPro, proFits } });
        router.push(routeHref(t.pathname, t.params));
      },
    })),
  ], [chords, openAsk, dock, activeProjectId, canPro, proFits, router]);

  useHotkeys(bindings, { scope: 'global' });

  return <ShortcutSheet />;
}
