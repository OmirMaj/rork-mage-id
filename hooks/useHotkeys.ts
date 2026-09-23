// hooks/useHotkeys.ts — one keyboard-shortcut registry for the desktop web app.
//
// WHY THIS EXISTS. Before wave 6b every shortcut was its own
// `window.addEventListener('keydown')` (app/_layout's Cmd+K, schedule-pro's
// undo/redo/export, GridPane's select-all, UniversalSearch's Esc…), each with
// its own copy of "am I typing in a field?" and no idea the others existed.
// Two consequences a GC hits on a laptop:
//   • collisions — schedule-pro binds Cmd+K to its AI pane while the shell
//     binds Cmd+K to search, and whichever listener ran last won;
//   • nobody can list them, so the `?` shortcut sheet has nothing to show.
// This is ONE registry (one window listener pair, see TWO PHASES below) with
// a scope stack:
//
//     global  <  page  <  dialog
//
// A key goes to the highest scope that has a matching binding; within a scope
// the higher `priority` wins, then the most recently mounted binding. Priority
// exists for ONE rule that registration order must not decide: Esc first
// clears what is local to the thing he is in (a table's search or selection,
// priority 1), and only then closes the record or panel around it (priority
// 0). Without it, which of the two ran depended on which re-registered last.
// A mounted `dialog` scope is EXCLUSIVE — while a dialog is open, page and global bindings do not fire
// (j/k must not move the list behind a confirm).
//
// Typing guard: while focus is in an input / textarea / select /
// contenteditable, plain keys belong to the field. Only Escape and chords
// with Cmd/Ctrl get through (so Cmd+Enter saves from inside a text area).
//
// Reserved: Cmd/Ctrl + P, W, T, N, L are the browser's (print, close tab, new
// tab, new window, address bar). A binding for one is refused, loudly in dev.
//
// TWO PHASES, ONE REGISTRY. react-native-web's TextInput calls
// stopPropagation() on every keydown ("prevent key events bubbling"), so a
// window listener in the bubble phase never hears a key typed in a field —
// Cmd+Enter / Cmd+S / Esc from inside an RFI's question box would do nothing
// (and Cmd+S would open the browser's "Save page as…"). So typing-target keys
// are read in the CAPTURE phase, before RNW can stop them, and everything
// else in the bubble phase, so a focused control's own Enter/Space handling
// (which stops propagation) still wins over a page binding. keyPhaseFor() is
// the partition: each keystroke is handled in exactly one phase.
//
// Consequence for hosts: an Esc typed in a field reaches the page's bindings
// BEFORE the field's own onKeyPress. A sheet, modal or popover whose fields
// use Esc themselves must register its close as a `dialog`-scope binding
// (`useHotkeys([{ combo: 'escape', handler: onClose }], { scope: 'dialog' })`)
// — dialog scope is exclusive, so the record or panel behind it stays open.
//
// Desktop web only: bindings register only when useResponsiveLayout().isDesktop
// (web ≥ 900). Mobile web keeps the browser's own keys.
//
// Focused screen only: a binding is live only while the navigator screen it
// was mounted in is FOCUSED (useIsScreenFocused, below). On web, expo-router's
// Stack (react-navigation native-stack) keeps every screen under the top one
// MOUNTED behind display:none, and a tab navigator does the same with the tabs
// he has left. Without this rule a register's table and primary action kept
// their keys after he pushed a detail route on top: '/' focused an invisible
// search box, Cmd+A ticked rows he could not see, Enter opened a row of the
// hidden list and Cmd+S saved a form he was no longer looking at. Outside any
// navigator (tests, the root layout's own chrome) counts as focused.
//
// Native: a no-op. There is no hardware keyboard on the iPhone app, and
// `document` does not exist there — the listener is never attached.
//
// The pure core (parseCombo … createHotkeyRegistry) imports nothing but React's
// types, so scripts/validate-desktop-workspace.ts executes it under bun.

import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Pure core
// ─────────────────────────────────────────────────────────────────────────────

export type HotkeyScope = 'global' | 'page' | 'dialog';
const SCOPE_RANK: Record<HotkeyScope, number> = { global: 0, page: 1, dialog: 2 };

/** The slice of a DOM KeyboardEvent the registry reads. */
export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
  repeat?: boolean;
  /** True while an IME is composing (Japanese, Chinese, Korean input…). */
  isComposing?: boolean;
  /** 229 = the key went to an IME (Safari reports this instead of isComposing). */
  keyCode?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface KeyStep {
  key: string;
  mod: boolean;
  alt: boolean;
  /** null = the binding did not say (see stepMatches). */
  shift: boolean | null;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  slash: '/',
  backslash: '\\',
  question: '?',
};

export function normalizeKey(key: string): string {
  const k = String(key ?? '').toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

/**
 * "mod+k", "mod+shift+z", "g h" (a sequence: g then h), "?", "escape".
 * `mod` is Cmd on a Mac and Ctrl elsewhere (either is accepted, so the same
 * binding works on the founder's MacBook and a Windows office PC).
 * `+` alone is written "plus".
 */
export function parseCombo(combo: string): KeyStep[] {
  const steps: KeyStep[] = [];
  for (const chunk of String(combo ?? '').trim().split(/\s+/)) {
    if (!chunk) continue;
    const parts = chunk.split('+').filter((p) => p.length > 0);
    let mod = false, alt = false; let shift: boolean | null = null; let key = '';
    for (const raw of parts) {
      const p = raw.toLowerCase();
      if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl' || p === 'control') mod = true;
      else if (p === 'alt' || p === 'option' || p === 'opt') alt = true;
      else if (p === 'shift') shift = true;
      else key = p === 'plus' ? '+' : normalizeKey(p);
    }
    if (!key) return [];
    steps.push({ key, mod, alt, shift });
  }
  return steps;
}

/** Browser-owned chords the app must never take. */
const RESERVED_MOD_KEYS = new Set(['p', 'w', 't', 'n', 'l']);

export function isReservedCombo(combo: string): boolean {
  return parseCombo(combo).some((s) => s.mod && RESERVED_MOD_KEYS.has(s.key));
}

function isLetterOrNamed(key: string): boolean {
  return /^[a-z0-9]$/.test(key) || key.length > 1;
}

/** Does one keystroke match one step? */
export function stepMatches(step: KeyStep, ev: KeyLike): boolean {
  const key = normalizeKey(ev.key);
  if (key !== step.key) return false;
  const mod = !!(ev.metaKey || ev.ctrlKey);
  if (mod !== step.mod) return false;
  if (!!ev.altKey !== step.alt) return false;
  if (step.shift !== null) return !!ev.shiftKey === step.shift;
  // Unstated shift: a letter/named key must NOT be shifted ('x' is not 'X',
  // 'enter' is not shift+enter). A symbol already carries its shift in
  // ev.key ('?' is shift+/ on a US keyboard), so shift is ignored for it.
  return isLetterOrNamed(key) ? !ev.shiftKey : true;
}

/** Focus is in something that takes typing. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (t.isContentEditable === true) return true;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // A checkbox / radio / button input takes no text; keys over it are free.
    const type = typeof t.type === 'string' ? t.type.toLowerCase() : 'text';
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

/** While typing, only Escape and Cmd/Ctrl chords reach the registry.
 *  `blockInInput` refuses even those (Cmd+A in a search box selects its text,
 *  not every row of the table). */
export function passesTypingGuard(ev: KeyLike, allowInInput = false, blockInInput = false): boolean {
  if (allowInInput) return true;
  if (!isTypingTarget(ev.target)) return true;
  if (blockInInput) return false;
  return normalizeKey(ev.key) === 'escape' || !!(ev.metaKey || ev.ctrlKey);
}

export interface HotkeyBinding {
  /** See parseCombo. */
  combo: string;
  /** Omit to LIST a shortcut another listener still handles (shortcut sheet
   *  only — the registry never fires it). */
  handler?: (ev: KeyLike) => void;
  /** Shortcut-sheet text. */
  label?: string;
  /** Shortcut-sheet section ("Navigation", "Table"…). */
  group?: string;
  /** Fire even while typing in a field (rare — Escape and mod chords already do). */
  allowInInput?: boolean;
  /** Never fire while typing in a field, not even as a Cmd/Ctrl chord. */
  blockInInput?: boolean;
  /** Default true: the key is consumed (browser default + other listeners). */
  preventDefault?: boolean;
  /** Default true. A disabled binding is ignored but keeps its sheet entry. */
  enabled?: boolean;
  /** Within one scope, higher runs first (default 0). Only for a fixed
   *  precedence between two bindings of the same key — see the header. */
  priority?: number;
}

interface Entry {
  id: number;
  scope: HotkeyScope;
  binding: HotkeyBinding;
  steps: KeyStep[];
}

export interface ListedHotkey {
  combo: string;
  label: string;
  group: string;
  scope: HotkeyScope;
  enabled: boolean;
}

/** A pending sequence expires after this long ("g" … wait … "h" is not g-h). */
export const SEQUENCE_TIMEOUT_MS = 1000;

export interface HotkeyRegistry {
  register(scope: HotkeyScope, binding: HotkeyBinding): () => void;
  /** Handle one keydown. True when a binding fired (or a sequence advanced). */
  handle(ev: KeyLike): boolean;
  list(): ListedHotkey[];
  subscribe(fn: () => void): () => void;
  size(): number;
}

export function createHotkeyRegistry(opts: { now?: () => number; warn?: (msg: string) => void } = {}): HotkeyRegistry {
  const now = opts.now ?? (() => Date.now());
  const warn = opts.warn ?? (() => {});
  let seq = 0;
  let entries: Entry[] = [];
  const listeners = new Set<() => void>();
  let pending: { prefix: KeyLike[]; at: number } | null = null;

  const notify = () => { for (const fn of listeners) fn(); };

  /** Entries eligible right now, best first: highest scope, then highest
   *  priority, then newest.
   *  If any dialog-scope entry is mounted, ONLY dialog entries are eligible. */
  const eligible = (): Entry[] => {
    const hasDialog = entries.some((e) => e.scope === 'dialog');
    const pool = hasDialog ? entries.filter((e) => e.scope === 'dialog') : entries;
    return [...pool].sort((a, b) =>
      SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]
      || (b.binding.priority ?? 0) - (a.binding.priority ?? 0)
      || b.id - a.id);
  };

  // preventDefault only — never stopPropagation. In the capture phase that
  // would starve the focused field of its own Esc / Enter handling, and at the
  // window in the bubble phase there is nothing left to stop.
  const fire = (e: Entry, ev: KeyLike) => {
    if (e.binding.preventDefault !== false) ev.preventDefault?.();
    e.binding.handler?.(ev);
  };

  return {
    register(scope, binding) {
      const steps = parseCombo(binding.combo);
      if (steps.length === 0) {
        warn(`[hotkeys] ignored unparsable combo "${binding.combo}"`);
        return () => {};
      }
      if (isReservedCombo(binding.combo)) {
        warn(`[hotkeys] refused "${binding.combo}": Cmd/Ctrl+P/W/T/N/L belong to the browser`);
        return () => {};
      }
      const id = ++seq;
      entries = [...entries, { id, scope, binding, steps }];
      notify();
      return () => {
        const before = entries.length;
        entries = entries.filter((e) => e.id !== id);
        if (entries.length !== before) notify();
      };
    },

    handle(ev) {
      if (!ev || typeof ev.key !== 'string') return false;
      // Mid-composition keys belong to the IME: the Esc that cancels a
      // half-typed word must not also close the record behind the field.
      if (ev.isComposing || ev.keyCode === 229) return false;
      // A bare modifier press is not a keystroke.
      if (['shift', 'meta', 'control', 'alt', 'capslock', 'os'].includes(normalizeKey(ev.key))) return false;
      const t = now();
      if (pending && t - pending.at > SEQUENCE_TIMEOUT_MS) pending = null;
      const live = eligible().filter((e) => e.binding.enabled !== false && typeof e.binding.handler === 'function');

      // 1. Continue a sequence already under way.
      if (pending) {
        const prefix = pending.prefix;
        const stepIndex = prefix.length;
        let advanced = false;
        for (const e of live) {
          if (e.steps.length <= stepIndex) continue;
          if (!prefix.every((p, i) => stepMatches(e.steps[i], p))) continue;
          if (!stepMatches(e.steps[stepIndex], ev)) continue;
          if (!passesTypingGuard(ev, e.binding.allowInInput, e.binding.blockInInput)) continue;
          if (e.steps.length === stepIndex + 1) {
            pending = null;
            fire(e, ev);
            return true;
          }
          advanced = true;
        }
        if (advanced) {
          pending = { prefix: [...prefix, ev], at: t };
          ev.preventDefault?.();
          return true;
        }
        pending = null; // the sequence broke; treat this key on its own
      }

      // 2. A single-step binding, best first.
      for (const e of live) {
        if (e.steps.length !== 1) continue;
        if (!stepMatches(e.steps[0], ev)) continue;
        if (!passesTypingGuard(ev, e.binding.allowInInput, e.binding.blockInInput)) continue;
        fire(e, ev);
        return true;
      }

      // 3. The first key of a sequence.
      for (const e of live) {
        if (e.steps.length < 2) continue;
        if (!stepMatches(e.steps[0], ev)) continue;
        if (!passesTypingGuard(ev, e.binding.allowInInput, e.binding.blockInInput)) continue;
        pending = { prefix: [ev], at: t };
        return true;
      }
      return false;
    },

    list() {
      // One row per combo+scope: the newest registration's label wins.
      const seen = new Set<string>();
      const out: ListedHotkey[] = [];
      for (const e of [...entries].sort((a, b) => b.id - a.id)) {
        if (!e.binding.label) continue;
        const k = `${e.scope}|${e.binding.combo}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          combo: e.binding.combo,
          label: e.binding.label,
          group: e.binding.group ?? 'General',
          scope: e.scope,
          enabled: e.binding.enabled !== false,
        });
      }
      return out.sort((a, b) => a.group.localeCompare(b.group) || SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] || a.combo.localeCompare(b.combo));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    size() { return entries.length; },
  };
}

/** "mod+shift+z" → "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" elsewhere; "g h" → "G then H". */
export function formatCombo(combo: string, mac: boolean): string {
  const named: Record<string, string> = {
    escape: 'Esc', enter: mac ? '↩' : 'Enter', backspace: mac ? '⌫' : 'Backspace', delete: 'Del',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', ' ': 'Space', '\\': '\\',
  };
  return parseCombo(combo).map((s) => {
    const key = named[s.key] ?? s.key.toUpperCase();
    const parts: string[] = [];
    if (s.mod) parts.push(mac ? '⌘' : 'Ctrl');
    if (s.alt) parts.push(mac ? '⌥' : 'Alt');
    if (s.shift) parts.push(mac ? '⇧' : 'Shift');
    parts.push(key);
    return mac ? parts.join('') : parts.join('+');
  }).join(' then ');
}

/**
 * Which window listener handles a keystroke. Keys from a typing target are
 * read in the CAPTURE phase (react-native-web's TextInput stops their
 * propagation, so the bubble phase never sees them); all others in the
 * BUBBLE phase (so a focused control's own key handling runs first). Exactly
 * one phase per keystroke — never both, never neither.
 */
export type KeyPhase = 'capture' | 'bubble';
export function keyPhaseFor(target: unknown): KeyPhase {
  return isTypingTarget(target) ? 'capture' : 'bubble';
}

// ─────────────────────────────────────────────────────────────────────────────
// The app's registry + DOM wiring
// ─────────────────────────────────────────────────────────────────────────────

/** The one registry the app uses. Exported for the shortcut sheet (list /
 *  subscribe) and for tests. */
export const hotkeys: HotkeyRegistry = createHotkeyRegistry({
  // Dev only: a refused or unparsable combo is a programming error, not
  // something to show a GC.
  warn: (msg) => { if ((globalThis as { __DEV__?: boolean }).__DEV__) console.warn(msg); },
});

interface DomLike {
  addEventListener(type: 'keydown', fn: (ev: KeyLike) => void, capture?: boolean): void;
  removeEventListener(type: 'keydown', fn: (ev: KeyLike) => void, capture?: boolean): void;
}

/** A browser with a real DOM. On native, `window` exists (RN aliases it to
 *  global) but `document` does not and window has no addEventListener. */
export function domKeyTarget(): DomLike | null {
  const g = globalThis as unknown as { document?: unknown; window?: Partial<DomLike> };
  if (typeof g.document === 'undefined' || !g.window) return null;
  if (typeof g.window.addEventListener !== 'function' || typeof g.window.removeEventListener !== 'function') return null;
  return g.window as DomLike;
}

let attachedTo: DomLike | null = null;
const onCaptureKeyDown = (ev: KeyLike) => { if (keyPhaseFor(ev?.target) === 'capture') hotkeys.handle(ev); };
const onBubbleKeyDown = (ev: KeyLike) => { if (keyPhaseFor(ev?.target) === 'bubble') hotkeys.handle(ev); };

/** Attach the listener pair while anything is registered; detach at zero. */
function syncListener(): void {
  const dom = domKeyTarget();
  if (hotkeys.size() > 0 && dom && attachedTo !== dom) {
    detach();
    dom.addEventListener('keydown', onCaptureKeyDown, true);
    dom.addEventListener('keydown', onBubbleKeyDown);
    attachedTo = dom;
  } else if (hotkeys.size() === 0 && attachedTo) {
    detach();
  }
}

/** Unmount must never throw, even if the page is tearing its window down
 *  around us (a test environment, a closing tab). */
function detach(): void {
  const prev = attachedTo;
  attachedTo = null;
  try {
    if (prev && typeof prev.removeEventListener === 'function') {
      prev.removeEventListener('keydown', onCaptureKeyDown, true);
      prev.removeEventListener('keydown', onBubbleKeyDown);
    }
  } catch { /* nothing left to detach from */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

export interface UseHotkeysOptions {
  scope?: HotkeyScope;
  /** false unregisters everything this hook mounted. */
  enabled?: boolean;
}

/**
 * Register bindings for as long as the calling component is mounted.
 *
 * Handlers are read through a ref, so passing a fresh closure every render
 * does NOT re-register (which would reorder "newest wins"). Re-registration
 * happens only when the combos, labels, scope or enabled flags change.
 * Desktop web only: nothing registers below the desktop gate (mobile web
 * keeps the browser's keys) or on native (no DOM).
 */
export function useHotkeys(bindings: readonly HotkeyBinding[], options: UseHotkeysOptions = {}): void {
  const isDesktop = useIsDesktop();
  const screenFocused = useIsScreenFocused();
  const { scope = 'page' } = options;
  const enabled = bindingsLive(options.enabled ?? true, isDesktop, screenFocused);
  const ref = useRef(bindings);
  ref.current = bindings;
  const signature = bindings
    .map((b) => `${b.combo}|${b.label ?? ''}|${b.group ?? ''}|${b.enabled === false ? 0 : 1}|${b.allowInInput ? 1 : 0}|${b.blockInInput ? 1 : 0}|${b.preventDefault === false ? 0 : 1}|${b.handler ? 1 : 0}|${b.priority ?? 0}`)
    .join('\n');

  useEffect(() => {
    if (!enabled || !domKeyTarget()) return undefined;
    const offs = ref.current.map((b, i) => hotkeys.register(scope, {
      ...b,
      handler: b.handler ? (ev) => ref.current[i]?.handler?.(ev) : undefined,
    }));
    syncListener();
    return () => {
      for (const off of offs) off();
      syncListener();
    };
    // `signature` captures everything about the bindings except the handler
    // identity, which the ref forwards.
  }, [signature, scope, enabled]);
}

/** The slice of a react-navigation `navigation` object the focus rule reads. */
export interface FocusSource {
  isFocused(): boolean;
  addListener(type: 'focus' | 'blur', cb: () => void): () => void;
}

/** Is the screen focused right now? No navigator (null) = focused: a
 *  component outside every screen — a test, the root layout's chrome — is on
 *  screen whenever it is mounted. */
export function focusSnapshot(nav: FocusSource | null | undefined): boolean {
  return nav ? nav.isFocused() !== false : true;
}

/** Re-read focus on every focus / blur of the screen. React-navigation emits
 *  these to a nested screen too when its PARENT screen blurs (a tab screen
 *  under a pushed stack route), and isFocused() checks the whole parent chain. */
export function subscribeFocus(nav: FocusSource | null | undefined, cb: () => void): () => void {
  if (!nav) return () => {};
  const offFocus = nav.addListener('focus', cb);
  const offBlur = nav.addListener('blur', cb);
  return () => { offFocus(); offBlur(); };
}

/** THE rule: a hook's bindings are registered only when the caller wants them,
 *  the layout is desktop, AND its screen is the focused one. */
export function bindingsLive(requested: boolean, isDesktop: boolean, screenFocused: boolean): boolean {
  return requested && isDesktop && screenFocused;
}

/** navigation.isFocused() for the screen this component is mounted in, kept
 *  current through its focus/blur events. Built on NavigationContext, not
 *  useIsFocused(), because useIsFocused THROWS outside a navigator; the
 *  context is simply undefined there. Lazy-required so this module stays
 *  bun-executable. Always called, so the hook order never changes. */
function useIsScreenFocused(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NavigationContext } = require('@react-navigation/native') as typeof import('@react-navigation/native');
  const nav = useContext(NavigationContext) as FocusSource | undefined;
  const subscribe = useCallback((cb: () => void) => subscribeFocus(nav, cb), [nav]);
  const snapshot = () => focusSnapshot(nav);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** useResponsiveLayout().isDesktop, lazy-required so this module stays
 *  bun-executable (useResponsiveLayout imports react-native). Always called,
 *  so the hook order never changes. */
function useIsDesktop(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useResponsiveLayout } = require('@/utils/useResponsiveLayout') as typeof import('@/utils/useResponsiveLayout');
  return useResponsiveLayout().isDesktop;
}

export interface PrimaryActionOptions {
  /** What the action is ("Save RFI") — the title of the blocked notice. */
  label: string;
  disabled?: boolean;
  /** Why it is blocked, in his words. Shown instead of silently doing nothing. */
  reason?: string | null;
  scope?: HotkeyScope;
  enabled?: boolean;
}

/** The notice for a blocked primary action. Lazy-required so this module stays
 *  bun-executable (utils/alert imports react-native). */
function explainBlocked(label: string, reason: string | null | undefined): void {
  const message = reason && reason.trim() ? reason : `${label} isn't available right now.`;
  try {
    // Lazy on purpose: a static import would pull react-native into the bun validator.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { showAlert } = require('@/utils/alert') as typeof import('@/utils/alert');
    showAlert(label, message);
  } catch {
    /* no alert host (tests) — nothing else to do */
  }
}

/**
 * Cmd/Ctrl+Enter and Cmd/Ctrl+S run the screen's primary action (Save, Send,
 * Submit). Both are consumed, so the browser's "Save page as…" never opens
 * over an RFI. Blocked → the reason is shown, never a silent no-op.
 */
export function usePrimaryAction(fn: () => void, options: PrimaryActionOptions): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optRef = useRef(options);
  optRef.current = options;
  const run = () => {
    const o = optRef.current;
    if (o.disabled) explainBlocked(o.label, o.reason);
    else fnRef.current();
  };
  useHotkeys(
    [
      { combo: 'mod+enter', handler: run, label: options.label, group: 'This screen' },
      { combo: 'mod+s', handler: run, label: options.label, group: 'This screen' },
    ],
    { scope: options.scope ?? 'page', enabled: options.enabled ?? true },
  );
}
