// contexts/LanguageContext.tsx — the per-user language choice, in React.
//
//   <LanguageProvider>  hydrates the choice (i18n/resolve.ts order), writes it
//                       to the module-level runtime (i18n/core.ts setLang),
//                       persists changes (mageid_language), and sets
//                       <html lang> on the web.
//   useT()              { t, tn, lang, displayLang } — re-renders on change.
//   useLanguage()       { lang, source, ready, setLanguage, setPseudo, … }
//
// WHY useSyncExternalStore and not a plain context value: the language lives
// in i18n/core.ts so utils, the ErrorBoundary and AI payload builders can read
// it outside React. useT() subscribes to that store directly, so it works in
// any component — including one rendered outside the provider (smoke tests,
// the error fallback, early boot), where it simply reads English.
//
// Mount: app/_layout.tsx, just inside ThemeProvider and ABOVE AuthProvider,
// so the sign-in and sign-up screens render in the chosen language.
//
// The account copy (components/LanguageProfileSync.tsx, mounted under
// AuthProvider; decisions in utils/languageSyncCore.ts):
//   • on sign-in or a user change it reads profiles.preferred_language; a
//     value there wins and arrives through applyAccountLanguage() — source
//     'account', copied to mageid_language, never written back. NULL, a
//     missing column (migration not applied) or a failed read change nothing.
//   • an explicit choice through setLanguage() applies and persists locally
//     here first, then notifies subscribeUserChoice() listeners; the Sync
//     turns that into ONE single-column offline-queue write
//     (profiles.preferred_language). Hydration, the account apply and the
//     'xx' pseudo-locale never notify, so they are never written anywhere.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { DisplayLang, I18nKey, Lang, PluralForms, Vars } from '@/i18n/types';
import { getDisplayLang, setLang, subscribe, t as tCore, tn as tnCore } from '@/i18n/core';
import { resolveLanguage, type LanguageSource } from '@/i18n/resolve';
import { detectDeviceLanguage } from '@/i18n/device';
import { readStoredLanguage, writeStoredLanguage } from '@/utils/languageStorage';

// ── useT ─────────────────────────────────────────────────────────────────

const getServerSnapshot = (): DisplayLang => 'en';

/** The display language, re-rendering on change. Safe outside the provider. */
export function useDisplayLang(): DisplayLang {
  return useSyncExternalStore(subscribe, getDisplayLang, getServerSnapshot);
}

export interface UseT {
  t: (key: I18nKey, en: string, vars?: Vars) => string;
  tn: (key: I18nKey, count: number, en: PluralForms, vars?: Vars) => string;
  /** The language for formatting and payloads ('xx' reads as 'en'). */
  lang: Lang;
  displayLang: DisplayLang;
}

/**
 * The translation functions for the current language. `t` and `tn` change
 * identity when the language changes, so memoised children that receive them
 * re-render with the new text.
 *
 *   const { t, tn } = useT();
 *   <Text>{t('field.dfr.weather', 'Weather')}</Text>
 */
export function useT(): UseT {
  const displayLang = useDisplayLang();
  return useMemo<UseT>(
    () => ({
      t: (key, en, vars) => tCore(key, en, vars, displayLang),
      tn: (key, count, en, vars) => tnCore(key, count, en, vars, displayLang),
      lang: displayLang === 'es' ? 'es' : 'en',
      displayLang,
    }),
    [displayLang],
  );
}

// ── LanguageProvider / useLanguage ───────────────────────────────────────

export interface LanguageContextValue {
  /** The user's language ('en' | 'es'). Unaffected by the pseudo toggle. */
  lang: Lang;
  displayLang: DisplayLang;
  /** Where `lang` came from — 'default' until hydration finds something,
   *  'user' after a choice here, 'account' after the profile's value arrived. */
  source: LanguageSource | 'user' | 'account';
  /** True once the stored choice has been read (English renders until then). */
  ready: boolean;
  pseudo: boolean;
  /** Choose a language: applies instantly, persists on this device, and (via
   *  LanguageProfileSync) saves it to the signed-in account. */
  setLanguage: (lang: Lang) => void;
  /** The account's saved language (LanguageProfileSync only): applies and
   *  persists on this device; never notifies subscribeUserChoice. */
  applyAccountLanguage: (lang: Lang) => void;
  /** Dev-only 'xx' pseudo-locale. Never persisted. */
  setPseudo: (on: boolean) => void;
}

function applyDocumentLang(lang: Lang): void {
  if (Platform.OS !== 'web') return;
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang;
    }
  } catch {
    /* non-DOM web renderer */
  }
}

// ── Explicit choices ─────────────────────────────────────────────────────
// Only setLanguage() (a person tapping a language) notifies these listeners.
// LanguageProfileSync is the one subscriber: it writes the choice to the
// account. A module-level set (not context) so the Sync never re-subscribes
// when the context value changes.

const userChoiceListeners = new Set<(lang: Lang) => void>();

/** Subscribe to explicit language choices. Returns the unsubscribe. */
export function subscribeUserChoice(fn: (lang: Lang) => void): () => void {
  userChoiceListeners.add(fn);
  return () => {
    userChoiceListeners.delete(fn);
  };
}

function notifyUserChoice(lang: Lang): void {
  userChoiceListeners.forEach((fn) => {
    try {
      fn(lang);
    } catch {
      /* a broken listener must not stop the choice */
    }
  });
}

// A working default, so useLanguage() outside the provider still switches the
// runtime language (it just cannot report hydration state).
const fallbackValue: LanguageContextValue = {
  lang: 'en',
  displayLang: 'en',
  source: 'default',
  ready: false,
  pseudo: false,
  setLanguage: (l) => {
    if (l !== 'en' && l !== 'es') return;
    setLang(l);
    void writeStoredLanguage(l);
    notifyUserChoice(l);
  },
  applyAccountLanguage: (l) => {
    if (l !== 'en' && l !== 'es') return;
    setLang(l);
    void writeStoredLanguage(l);
  },
  setPseudo: (on) => setLang(on ? 'xx' : 'en'),
};

const LanguageContext = createContext<LanguageContextValue>(fallbackValue);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [source, setSource] = useState<LanguageSource | 'user' | 'account'>('default');
  const [ready, setReady] = useState(false);
  const [pseudo, setPseudoState] = useState(false);
  const displayLang = useDisplayLang();
  // A choice (the user's, or the account's) made before hydration finishes
  // must not be overwritten by it.
  const userChose = useRef(false);
  // Mirrors `pseudo` for the stable callbacks below (set where it changes).
  const pseudoRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await readStoredLanguage();
      if (cancelled) return;
      if (!userChose.current) {
        const hints = detectDeviceLanguage();
        const resolved = resolveLanguage({ stored, device: hints.device, intl: hints.intl });
        setLangState(resolved.lang);
        setSource(resolved.source);
        setLang(resolved.lang);
        applyDocumentLang(resolved.lang);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: Lang) => {
    if (next !== 'en' && next !== 'es') return;
    userChose.current = true;
    setLangState(next);
    setSource('user');
    pseudoRef.current = false;
    setPseudoState(false);
    setLang(next);
    applyDocumentLang(next);
    void writeStoredLanguage(next);
    // Local first (above), then the account (LanguageProfileSync).
    notifyUserChoice(next);
  }, []);

  const applyAccountLanguage = useCallback((next: Lang) => {
    if (next !== 'en' && next !== 'es') return;
    userChose.current = true;
    setLangState(next);
    setSource('account');
    // A dev reviewer's pseudo-locale stays on; it switches back to `next`.
    setLang(pseudoRef.current ? 'xx' : next);
    applyDocumentLang(next);
    void writeStoredLanguage(next);
  }, []);

  const setPseudo = useCallback(
    (on: boolean) => {
      pseudoRef.current = on;
      setPseudoState(on);
      setLang(on ? 'xx' : lang);
    },
    [lang],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, displayLang, source, ready, pseudo, setLanguage, applyAccountLanguage, setPseudo }),
    [lang, displayLang, source, ready, pseudo, setLanguage, applyAccountLanguage, setPseudo],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
