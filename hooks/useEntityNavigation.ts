// ============================================================================
// hooks/useEntityNavigation.ts
//
// One-line navigation from an EntityRef to its detail screen. Wraps
// `utils/entityResolver.getEntityRoute` with the project store and the
// expo-router push/replace calls.
//
// Handles the iOS pageSheet-modal-blocks-navigation bug via the `fromSheet`
// option — set it when calling from inside a presentationStyle="pageSheet"
// Modal (e.g. the tile modal in app/project-detail.tsx). The hook will wait
// 350ms on iOS to let the sheet dismiss before pushing so the destination
// screen doesn't mount underneath. Matches the existing `navigateFromTile`
// helper pattern.
//
// Usage:
//   const { navigateTo } = useEntityNavigation();
//   navigateTo({ kind: 'project', id: project.id });
//   navigateTo({ kind: 'rfi', id: rfi.id, projectId: rfi.projectId },
//              { fromSheet: true, onBeforeNavigate: () => setActiveTile(null) });
// ============================================================================

import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { EntityRef } from '@/types';
import { getEntityRoute } from '@/utils/entityResolver';

export interface NavigateOptions {
  /**
   * Use `replace` instead of `push`. Appropriate when moving between
   * top-level tabs or when the current screen shouldn't stay on the stack.
   */
  mode?: 'push' | 'replace';
  /**
   * Set to true when calling from inside a presentationStyle="pageSheet"
   * Modal. Adds a 350ms delay on iOS so the sheet dismisses before the
   * destination mounts (otherwise it stacks behind the sheet).
   */
  fromSheet?: boolean;
  /**
   * Optional side-effect to run synchronously before the delay/navigate.
   * Typically used to close a sheet (e.g. `setActiveTile(null)`).
   */
  onBeforeNavigate?: () => void;
}

export function useEntityNavigation() {
  const router = useRouter();

  const navigateTo = useCallback(
    (ref: EntityRef, opts: NavigateOptions = {}) => {
      const { mode = 'push', fromSheet = false, onBeforeNavigate } = opts;

      const route = getEntityRoute(ref);
      if (!route) {
        console.warn(
          `[useEntityNavigation] No route for kind=${ref.kind} id=${ref.id}`,
        );
        return;
      }

      onBeforeNavigate?.();

      const go = () => {
        if (mode === 'replace') {
          router.replace(route as never);
        } else {
          router.push(route as never);
        }
      };

      if (fromSheet && Platform.OS === 'ios') {
        setTimeout(go, 350);
      } else {
        go();
      }
    },
    [router],
  );

  return { navigateTo };
}
