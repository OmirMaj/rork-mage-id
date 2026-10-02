// components/learn/CertificateCard.tsx — one MAGE ID app-skills certificate,
// drawn as a plain full-width document card, with its three actions:
// Save PDF, Share link, Remove from profile.
//
// WHAT IT SHOWS (the words come from utils/learn/certificateDoc.ts, which the
// PDF and the share text use too): "MAGE ID" as text, the certificate title,
// "Awarded to {name}" with CERT_NAME_NOTE right under it (the name is typed by
// the account holder and nobody checked it), "Passed the in-app check, 4 of 5 ·
// Oct 1, 2026", the topic's scope line, and CERT_SCOPE_NOTE as the footnote.
// Green theme tokens only, through the Card primitive. No emblem, ribbon,
// star or end date, no ID-number styling, no pocket-card proportions: it must
// never read as a trade credential (scripts/validate-skill-certificate-doc.ts
// pins the words and cues that are banned here).
//
// REMOVE IS NOT QUEUED (the documented exception to utils/offlineQueue.ts).
// CLAUDE.md sends every Supabase write through the offline queue so an
// airplane-mode edit lands later. Removing a certificate is different: the
// same row backs the public check link at mageid.app/skills/<code>, so a
// removal that "lands later" would tell him the link is dead while anyone
// could still open it. So: a confirm first, then a direct delete under the
// table's delete-own RLS policy, and the "Certificate removed" toast only
// after the server answered with the deleted row. Offline, nothing is sent:
// "Connect to remove it."

import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { Type } from '@/constants/typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { nailIt, notice, oops } from '@/components/animations/NailItToast';
import { formatDateL, formatDateOptsL } from '@/i18n';
import { isOfflineNow } from '@/hooks/useOnline';
import { showAlert } from '@/utils/alert';
import { copyToClipboard } from '@/utils/clipboard';
import { shareText } from '@/utils/shareText';
import { pdfFailureMessage, printHtmlDocument } from '@/utils/platformFile';
import { SKILL_CERTIFICATES_QUERY_ROOT, verifyUrl } from '@/utils/learn/certificateClient';
import { buildCertificateHtml, certificateA11yLabel, certificateShareText } from '@/utils/learn/certificateDoc';
import { CERT_NAME_NOTE, CERT_SCOPE_NOTE, type SkillCertificate, type SkillTopic } from '@/utils/learn/types';

export interface CertificateCardProps {
  cert: SkillCertificate;
  topic: SkillTopic;
  /** Show Save PDF / Share link / Remove from profile under the card. */
  actions?: boolean;
  testID?: string;
}

export type RemoveOutcome = 'removed' | 'offline' | 'failed';

/** Delete one certificate row (RLS: only the caller's own). 'removed' only
 *  when the server hands the deleted row back. */
export async function removeCertificate(id: string): Promise<RemoveOutcome> {
  if (isOfflineNow()) return 'offline';
  try {
    const { data, error } = await supabase.from('app_skill_certificates').delete().eq('id', id).select('id');
    if (error) return 'failed';
    return Array.isArray(data) && data.length > 0 ? 'removed' : 'failed';
  } catch {
    return 'failed';
  }
}

export function CertificateCard({ cert, topic, actions = false, testID }: CertificateCardProps) {
  const { colors } = useTheme();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'pdf' | 'remove' | null>(null);
  const busyRef = useRef(false);

  const issuedLabel = formatDateL(cert.issuedAt, 'dayYear', 'en');
  const longDate = formatDateOptsL(cert.issuedAt, { month: 'long', day: 'numeric', year: 'numeric' });
  const url = verifyUrl(cert.verifyCode);
  const id = testID ?? `certificate-${cert.topic}`;

  const savePdf = useCallback(async () => {
    if (busyRef.current) return;
    const html = buildCertificateHtml(cert, topic, { verifyUrl: url, issuedLabel });
    busyRef.current = true;
    setBusy('pdf');
    try {
      // Web: printHtmlDocument opens the print window before its first await,
      // so it still counts as part of the tap.
      const uri = await printHtmlDocument(html);
      if (Platform.OS !== 'web' && uri && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: topic.certificateTitle, UTI: 'com.adobe.pdf' });
      }
    } catch (err) {
      oops(pdfFailureMessage(err, t('settings.learn.pdfFailed', "Couldn't build the PDF.")));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [cert, topic, url, issuedLabel, t]);

  const shareLink = useCallback(async () => {
    const message = certificateShareText(cert, topic, url);
    // Web: Share.share rejects on most desktop browsers (see utils/shareText),
    // so the link goes straight to the clipboard, with a toast saying so.
    if (Platform.OS === 'web') {
      const ok = await copyToClipboard(message);
      if (ok) notice(t('settings.learn.linkCopied', 'Link copied'), { icon: 'alert' });
      else oops(t('settings.learn.copyFailed', "Couldn't copy the link."));
      return;
    }
    const outcome = await shareText({ message });
    if (outcome === 'copied') notice(t('settings.learn.linkCopied', 'Link copied'), { icon: 'alert' });
    else if (outcome === 'failed') oops(t('settings.learn.shareFailed', "Couldn't share the link."));
  }, [cert, topic, url, t]);

  const doRemove = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('remove');
    try {
      const outcome = await removeCertificate(cert.id);
      if (outcome === 'removed') {
        nailIt(t('settings.learn.removed', 'Certificate removed'));
      } else if (outcome === 'offline') {
        notice(t('settings.learn.removeOffline', 'Connect to remove it.'), { icon: 'alert' });
      } else {
        oops(t('settings.learn.removeFailed', "Couldn't remove the certificate. Try again."));
      }
      // Either way, read the list again: a removal done elsewhere shows too.
      if (outcome !== 'offline') void queryClient.invalidateQueries({ queryKey: [SKILL_CERTIFICATES_QUERY_ROOT] });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [cert.id, queryClient, t]);

  const confirmRemove = useCallback(() => {
    if (isOfflineNow()) {
      notice(t('settings.learn.removeOffline', 'Connect to remove it.'), { icon: 'alert' });
      return;
    }
    showAlert(t('settings.learn.removeConfirm', 'Remove this certificate? Its check link stops working.'), undefined, [
      { text: t('settings.learn.keep', 'Keep it'), style: 'cancel' },
      { text: t('settings.learn.remove', 'Remove'), style: 'destructive', onPress: () => { void doRemove(); } },
    ]);
  }, [doRemove, t]);

  return (
    <View testID={id}>
      <Card>
        <View accessible accessibilityLabel={certificateA11yLabel(cert, topic, longDate)} testID={`${id}-doc`}>
          <Text style={[Type.caption1, styles.mark, { color: colors.accentLabel }]}>MAGE ID</Text>
          <Text style={[Type.serifHeadline, styles.certName, { color: colors.text }]}>{topic.certificateTitle}</Text>
          <Text style={[Type.subheadEmphasized, styles.awarded, { color: colors.text }]} testID={`${id}-awarded`}>
            {t('settings.learn.awardedTo', 'Awarded to {name}', { name: cert.holderName })}
          </Text>
          <Text style={[Type.footnote, styles.nameNote, { color: colors.textSecondary }]} testID={`${id}-name-note`}>
            {CERT_NAME_NOTE}
          </Text>
          <Text style={[Type.bodyCompact, styles.score, { color: colors.text }]}>
            {t('settings.learn.cardScore', 'Passed the in-app check, {correct} of {total} · {date}', {
              correct: String(cert.correct),
              total: String(cert.total),
              date: formatDateL(cert.issuedAt),
            })}
          </Text>
          <Text style={[Type.bodyCompact, styles.scope, { color: colors.text }]}>{topic.scope}</Text>
          <View style={[styles.foot, { borderTopColor: colors.line }]}>
            <Text style={[Type.footnote, { color: colors.textSecondary }]} testID={`${id}-scope-note`}>
              {CERT_SCOPE_NOTE}
            </Text>
          </View>
        </View>
      </Card>
      {actions ? (
        <View style={styles.actions}>
          <Button
            label={t('settings.learn.savePdf', 'Save PDF')}
            variant="secondary"
            size="sm"
            loading={busy === 'pdf'}
            disabled={busy !== null}
            onPress={() => { void savePdf(); }}
            testID={`${id}-pdf`}
          />
          <Button
            label={t('settings.learn.shareLink', 'Share link')}
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onPress={() => { void shareLink(); }}
            testID={`${id}-share`}
          />
          <Button
            label={t('settings.learn.removeFromProfile', 'Remove from profile')}
            variant="ghost"
            size="sm"
            loading={busy === 'remove'}
            disabled={busy !== null}
            onPress={confirmRemove}
            testID={`${id}-remove`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { fontWeight: '700', letterSpacing: 1.6 },
  certName: { marginTop: 8 },
  awarded: { marginTop: 14 },
  nameNote: { marginTop: 2 },
  score: { marginTop: 12 },
  scope: { marginTop: 4 },
  foot: { marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});

export default CertificateCard;
