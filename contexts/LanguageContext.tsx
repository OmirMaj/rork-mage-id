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
// Mount (handoff): just inside ThemeProvider and ABOVE AuthProvider, so the
// sign-in and sign-up screens render in the chosen language.
//
// Not built yet (Phase 1, after the preferred_language migration):
// LanguageProfileSync — server value wins on sign-in, a Settings change writes
// local first then enqueues a single-column supabaseWrite. Until the column
// exists, nothing here writes to the server (a write to a missing column would
// sit in the offline queue forever).

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
  /** Where `lang` came from — 'default' until hydration finds something. */
  source: LanguageSource | 'user';
  /** True once the stored choice has been read (English renders until then). */
  ready: boolean;
  pseudo: boolean;
  /** Choose a language: applies instantly, persists on this device. */
  setLanguage: (lang: Lang) => void;
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

// A working default, so useLanguage() outside the provider still switches the
// runtime language (it just cannot report hydration state).
const fallbackValue: LanguageContextValue = {
  lang: 'en',
  displayLang: 'en',
  source: 'default',
  ready: false,
  pseudo: false,
  setLanguage: (l) => {
    setLang(l);
    void writeStoredLanguage(l);
  },
  setPseudo: (on) => setLang(on ? 'xx' : 'en'),
};

const LanguageContext = createContext<LanguageContextValue>(fallbackValue);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [source, setSource] = useState<LanguageSource | 'user'>('default');
  const [ready, setReady] = useState(false);
  const [pseudo, setPseudoState] = useState(false);
  const displayLang = useDisplayLang();
  // A choice made before hydration finishes must not be overwritten by it.
  const userChose = useRef(false);

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
    setPseudoState(false);
    setLang(next);
    applyDocumentLang(next);
    void writeStoredLanguage(next);
  }, []);

  const setPseudo = useCallback(
    (on: boolean) => {
      setPseudoState(on);
      setLang(on ? 'xx' : lang);
    },
    [lang],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, displayLang, source, ready, pseudo, setLanguage, setPseudo }),
    [lang, displayLang, source, ready, pseudo, setLanguage, setPseudo],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
