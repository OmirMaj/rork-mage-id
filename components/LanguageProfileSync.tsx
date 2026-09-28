// components/LanguageProfileSync.tsx — keeps the user's app language on the
// ACCOUNT (profiles.preferred_language), so it follows them to another phone
// (docs/I18N.md §5). Renders nothing.
//
// Mounted in app/_layout.tsx under AuthProvider (reads the user) and under
// LanguageProvider (applies the language). Every decision lives in the pure
// utils/languageSyncCore.ts (validated by scripts/validate-language-sync.ts).
//
//   sign-in / user change  ONE select of profiles.preferred_language for the
//                          signed-in user. A value there wins: applied with
//                          source 'account' and copied to this device. NULL,
//                          a missing column (the migration is not applied
//                          yet) or a failed read change nothing. Never throws.
//   explicit choice        LanguageContext.setLanguage already applied and
//                          stored it on this device; this sends ONE column —
//                          { id, preferred_language } — through the offline
//                          queue. Never through ProjectContext.updateSettings
//                          (a whole-row write from a stale settings object
//                          would overwrite fields changed elsewhere). The 'xx'
//                          pseudo-locale is never written.
//
//   LANGUAGE_PICKER_ENABLED false (today)  BOTH effects return before doing
//                          anything: no read, no apply, no write. A dev build
//                          (which talks to the production database and can
//                          still open the language screen) must never put
//                          Spanish on an account that production — with the
//                          picker hidden — could not switch back.

import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { LANGUAGE_PICKER_ENABLED } from '@/i18n/flags';
import { subscribeUserChoice, useLanguage } from '@/contexts/LanguageContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { decideOnChange, decideOnSignIn, serverLanguageFromRead, type ServerLanguage } from '@/utils/languageSyncCore';

export function LanguageProfileSync(): null {
  const { user } = useAuth();
  const { applyAccountLanguage, lang } = useLanguage();
  const userId = user?.id ?? null;

  // Latest values for the long-lived choice listener and the async read.
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const langRef = useRef(lang);
  langRef.current = lang;
  const applyRef = useRef(applyAccountLanguage);
  applyRef.current = applyAccountLanguage;
  // Bumped on every explicit choice, so a read that was in flight when the
  // user tapped never overrides that newer tap.
  const choiceSeq = useRef(0);
  // Set when the sign-in read found no preferred_language column.
  const columnMissing = useRef(false);

  // Sign-in / user change: read the account's language once.
  useEffect(() => {
    columnMissing.current = false;
    if (!LANGUAGE_PICKER_ENABLED) return;
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    const seqAtStart = choiceSeq.current;
    (async () => {
      let server: ServerLanguage;
      try {
        const result = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', userId)
          .maybeSingle();
        server = serverLanguageFromRead(result);
      } catch {
        server = 'unavailable';
      }
      if (cancelled || userIdRef.current !== userId) return;
      if (server === 'missing_column') columnMissing.current = true;
      const decision = decideOnSignIn({
        pickerEnabled: LANGUAGE_PICKER_ENABLED,
        server,
        local: { lang: langRef.current, explicit: choiceSeq.current !== seqAtStart },
      });
      if (decision.apply) {
        try {
          applyRef.current(decision.apply);
        } catch {
          /* a language preference must never crash the app */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Explicit choice → the account (one column, through the offline queue).
  useEffect(
    () =>
      subscribeUserChoice((chosen) => {
        choiceSeq.current += 1;
        if (!LANGUAGE_PICKER_ENABLED) return;
        const decision = decideOnChange({
          pickerEnabled: LANGUAGE_PICKER_ENABLED,
          userId: userIdRef.current,
          supabaseConfigured: isSupabaseConfigured,
          lang: chosen,
          columnMissing: columnMissing.current,
        });
        if (!decision.write) return;
        supabaseWrite('profiles', 'update', {
          id: decision.row.id,
          preferred_language: decision.row.preferred_language,
        }).catch(() => {
          /* queued or refused — the local choice already applies */
        });
      }),
    [],
  );

  return null;
}

export default LanguageProfileSync;
