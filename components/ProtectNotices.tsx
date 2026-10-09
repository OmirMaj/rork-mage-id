// components/ProtectNotices.tsx — the plain notices a person reads before he
// agrees, sends or logs (PROTECT-TEXT, 2026-10-09).
//
// Three small pieces, one wording each, so no screen writes its own version:
//
//   AgreementNotice   "By continuing you agree to our Terms of Service and
//                     Privacy Policy." with working links. It goes ABOVE the
//                     buttons it governs on every screen that can create an
//                     account or sign someone in for the first time. Text
//                     only: it records nothing and blocks nobody. (Recording
//                     acceptance is a server change in another lane.)
//
//   TemplateNotice    told to the CONTRACTOR where he picks or edits a
//                     contract, proposal, lien waiver or AIA-style form: it is
//                     a starting template, not legal advice. It is drawn on
//                     his screen and never printed on the document his client
//                     signs.
//
//   ProtectNote       a plain body-size note for any other standing sentence
//                     (the safety log notice).
//
// The words are drafts for counsel. scripts/validate-protections.ts pins which
// screens carry which piece, and that the agreement sits above the buttons.

import React from 'react';
import { Linking, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { Type } from '@/constants/typography';
import { useT } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

export const TERMS_URL = 'https://mageid.app/terms';
export const PRIVACY_URL = 'https://mageid.app/privacy';

function useNoticeStyles() {
  const { colors } = useTheme();
  return React.useMemo(() => StyleSheet.create({
    note: {
      fontSize: Type.footnote.fontSize,
      lineHeight: 19,
      color: colors.text,
    },
    link: {
      color: colors.accentLabel,
      fontWeight: '600' as const,
      textDecorationLine: 'underline' as const,
    },
  }), [colors]);
}

/** The agreement sentence. Place it above the first button it governs. */
export function AgreementNotice({ testID, style }: { testID: string; style?: StyleProp<TextStyle> }): React.ReactElement {
  const { t } = useT();
  const styles = useNoticeStyles();
  return (
    <Text style={[styles.note, { textAlign: 'center' }, style]} testID={testID}>
      {t('office.protect.agreeLead', 'By continuing you agree to our')}{' '}
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => { void Linking.openURL(TERMS_URL); }}
        testID={`${testID}-terms`}
      >
        {t('office.protect.termsOfService', 'Terms of Service')}
      </Text>
      {' '}{t('office.protect.agreeAnd', 'and')}{' '}
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => { void Linking.openURL(PRIVACY_URL); }}
        testID={`${testID}-privacy`}
      >
        {t('office.protect.privacyPolicy', 'Privacy Policy')}
      </Text>
      .
    </Text>
  );
}

/** Told to the contractor where he picks or edits a template. Never printed on the document. */
export function TemplateNotice({ testID, style }: { testID: string; style?: StyleProp<TextStyle> }): React.ReactElement {
  const { t } = useT();
  const styles = useNoticeStyles();
  return (
    <Text style={[styles.note, style]} testID={testID}>
      {t('office.protect.templateNotice', 'This is a starting template, not legal advice. It is not written for your state or your job. Have your own attorney review it before you use it.')}
    </Text>
  );
}

/** A plain body-size note. The caller supplies the sentence (already through t()). */
export function ProtectNote({ children, testID, style }: { children: React.ReactNode; testID: string; style?: StyleProp<TextStyle> }): React.ReactElement {
  const styles = useNoticeStyles();
  return <Text style={[styles.note, style]} testID={testID}>{children}</Text>;
}
