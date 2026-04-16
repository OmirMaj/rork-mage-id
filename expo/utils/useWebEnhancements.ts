import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : true;
        const shiftMatch = shortcut.shift ? e.shiftKey : true;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (ctrlMatch && shiftMatch && keyMatch) {
          if (shortcut.ctrl || shortcut.meta) {
            e.preventDefault();
          }
          shortcut.handler();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.title = title;
  }, [title]);
}

export function useWebCursor(ref: React.RefObject<any>, cursor: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return;
    const element = ref.current as unknown as HTMLElement;
    if (element && element.style) {
      element.style.cursor = cursor;
    }
  }, [ref, cursor]);
}

export function getHoverProps(onHoverIn?: () => void, onHoverOut?: () => void) {
  if (Platform.OS !== 'web') return {};
  return {
    onMouseEnter: onHoverIn,
    onMouseLeave: onHoverOut,
  } as any;
}
