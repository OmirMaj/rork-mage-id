// hooks/useLegalCopy.ts — the ONLY place the strings of the re-acceptance sheet
// and the scan notice live (lane PROTECT-SERVER). Every string goes through
// t('office.notices.*', english, vars), surface 'office.notices'. The scan
// notice has Spanish in i18n/catalog/es/office/notices.ts. The re-acceptance
// sheet's keys sit under `.legal.` and have NO Spanish on purpose: the i18n
// rule (docs/I18N.md section 9, scripts/validate-i18n.ts) is that words a
// person agrees to are translated only by a human legal translator, never by
// the build lane, so a Spanish-language phone shows that sheet in English
// until one has (the Terms and the Privacy Policy are English only too). components/LegalGateHost.tsx and
// hooks/useScanAck.ts import this and add no t() key of their own.
//
// WORDING (docs/VOICE.md). A key ending in `Label` is a name or an action,
// every word capitalised, no closing period. `Title` and `Body` are whole
// sentences in sentence case. No em dashes, no "and" sign, no "e.g.", no
// arrows.
//
// DRAFT FOR COUNSEL. The sheet's sentences ask a person to agree to a contract.
// They are placeholders until the founder's attorney approves them; the sheet
// is behind TERMS_REACCEPT_ENABLED = false. The scan notice is the sentence the
// founder agreed on 2026-10-09, word for word: its English is also
// utils/legalAcceptanceCore SCAN_ACK_COPY (what the recorded hash is taken
// over), pinned equal by scripts/validate-legal-acceptance.ts.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';

export interface LegalCopy {
  // ── the re-acceptance sheet ──
  reacceptTitle: string;
  reacceptBody: string;
  changedHeadingLabel: string;
  /** What changed since the version this account last accepted. */
  changedLines: string[];
  termsLinkLabel: string;
  privacyLinkLabel: string;
  agreeBody: string;
  agreeLabel: string;
  signOutLabel: string;
  // ── the scan notice ──
  scanTitle: string;
  scanBody: string;
  scanAckLabel: string;
}

export function useLegalCopy(): LegalCopy {
  const { t } = useT();
  return useMemo<LegalCopy>(() => ({
    reacceptTitle: t('office.notices.legal.reacceptTitle', 'Please read and agree to continue'),
    reacceptBody: t('office.notices.legal.reacceptBody', 'To keep using MAGE ID, read the Terms of Service and the Privacy Policy and agree to them.'),
    changedHeadingLabel: t('office.notices.legal.reacceptChangedHeadingLabel', 'What Changed'),
    // At the next change of the Terms, replace this one line with what changed
    // (up to three short lines).
    changedLines: [
      t('office.notices.legal.reacceptChangedFirstBody', 'This is the first time MAGE ID asks you to agree inside the app. The Terms of Service are dated May 12, 2026 and the Privacy Policy is dated October 4, 2026.'),
    ],
    termsLinkLabel: t('office.notices.legal.reacceptTermsLinkLabel', 'Read the Terms of Service'),
    privacyLinkLabel: t('office.notices.legal.reacceptPrivacyLinkLabel', 'Read the Privacy Policy'),
    agreeBody: t('office.notices.legal.reacceptAgreeBody', 'By tapping I Agree you agree to the Terms of Service and the Privacy Policy.'),
    agreeLabel: t('office.notices.legal.reacceptAgreeLabel', 'I Agree'),
    signOutLabel: t('office.notices.legal.reacceptSignOutLabel', 'Sign Out'),
    scanTitle: t('office.notices.scan.title', 'Before you rely on a scan'),
    scanBody: t('office.notices.scan.body', 'A scan is a first measure. It can be off by an inch or more. Check before you order, cut, price or build from it.'),
    scanAckLabel: t('office.notices.scan.ackLabel', 'I Understand'),
  }), [t]);
}
