// app/punch-seal.tsx — the sealed final punch (lane SEAL). `?projectId=`.
//
// Three states, each from the SERVER, never a local guess:
//   (a) readiness: every formal punch item the client walks, read from
//       punch_items on the account. A row ticks (CheckSync) only when the
//       server has it closed with an after photo. Each blocker has its action:
//       "Take after photo" or "Open item".
//   (b) acceptance: when ready, the phone is handed to the client and the
//       shipped SigningCeremony takes the in-person signature. Its write is
//       the seal-punch edge function; nothing reads as accepted before that
//       function returns the stored row (server time, server hash).
//   (c) sealed: the stored record, read-only, and "Save PDF".
// A sample project shows why it cannot be sealed, never the pad. Offline, the
// ceremony is disabled with the legal reason; a seal is never queued.
//
// Certifies closure as of the server's date and nothing else: no warranty,
// lien or payment claim anywhere on this screen.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, Circle, Lock, Camera, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { Button, Card, useSheetDialogScope } from '@/components/ui';
import { CheckSync, type CheckRow } from '@/components/motion/kit';
import { SigningCeremony, type SigningCeremonyProps } from '@/components/moments/signing/SigningCeremony';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';
import { useOffline } from '@/hooks/useOnline';
import { usePunchSeal, punchSealFromRow } from '@/hooks/usePunchSeal';
import { isSampleProject } from '@/utils/sampleGuard';
import { offlineLegalReason, type CommitResult } from '@/utils/moments/commitResult';
import { sealRefused, sealLegalQueued } from '@/utils/moments/sites/signingCopy';
import { closeProjectTimeout } from '@/utils/moments/sites/fieldCopy';
import { readEdgeError, edgeErrorStatus } from '@/utils/edgeError';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/utils/alert';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { savePunchSealPdf } from '@/utils/punchSealShare';
import {
  PUNCH_SEAL_CONSENT_VERSION,
  PUNCH_SEAL_MAX_ITEMS,
  isSealableItem,
  punchSealReadiness,
  type PunchSealErrorCode,
} from '@/supabase/functions/_shared/punchSealManifest';
import type { PunchItem, PunchSeal } from '@/types';

type Confirmed = Extract<CommitResult, { status: 'confirmed' }>;

/** A seal's error code as a sentence. Record<…> keeps it exhaustive: a new code fails tsc here. */
function errorSentence(t: ReturnType<typeof useT>['t']): Record<PunchSealErrorCode, string> {
  return {
    bad_request: t('field.punchSeal.err.badRequest', 'Not sealed. The request was incomplete, so nothing was sealed. Sign again.'),
    forbidden: t('field.punchSeal.err.forbidden', 'Not sealed. Only the project owner can seal the final punch.'),
    not_found: t('field.punchSeal.err.notFound', 'Not sealed. This project was not found on your account.'),
    sample: t('field.punchSeal.err.sample', 'Not sealed. A sample project can’t be sealed.'),
    already_sealed: t('field.punchSeal.err.alreadySealed', 'Already sealed. This project’s final punch was sealed earlier, so nothing was changed.'),
    not_ready: t('field.punchSeal.err.notReady', 'Not sealed. Some punch items are not closed with an after photo on your account yet.'),
    changed: t('field.punchSeal.err.changed', 'Not sealed. The punch list changed while the client was signing. Review it and sign again.'),
    too_many: t('field.punchSeal.err.tooMany', 'Not sealed. A sealed record holds up to {max} punch items.', { max: PUNCH_SEAL_MAX_ITEMS }),
    photo_uploading: t('field.punchSeal.err.photoUploading', 'Not sealed. Some after photos are still uploading from this phone. Wait a minute, then sign again.'),
    photo_foreign: t('field.punchSeal.err.photoForeign', 'Not sealed. Some after photos were taken on another account. Retake them on this phone.'),
    hash_mismatch: t('field.punchSeal.err.hashMismatch', 'The PDF copy did not match the record, so it was not stored.'),
    pdf_attached: t('field.punchSeal.err.pdfAttached', 'A PDF copy is already stored for this record.'),
    server: t('field.punchSeal.err.server', 'Not sealed. Something went wrong on our side, so nothing was sealed.'),
  };
}

export default function PunchSealScreen() {
  const { projectId: rawProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof rawProjectId === 'string' && rawProjectId ? rawProjectId : undefined;
  const { t, tn } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { getProject, getPunchItemsForProject, updatePunchItem, settings } = useProjects();
  const { user } = useAuth();
  const offline = useOffline();
  const project = projectId ? getProject(projectId) : undefined;
  const { status, seal, serverItems, refetch } = usePunchSeal(projectId);

  // Re-read whenever the screen comes back into view (an after photo taken on
  // the punch list, an item closed there).
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const readiness = useMemo(() => punchSealReadiness(serverItems), [serverItems]);
  const blockerById = useMemo(() => new Map(readiness.blockers.map(b => [b.itemId, b.reason])), [readiness]);
  const formalServer = useMemo(() => serverItems.filter(isSealableItem).sort((a, b) => a.description.localeCompare(b.description)), [serverItems]);
  const localById = useMemo(() => new Map((projectId ? getPunchItemsForProject(projectId) : []).map(i => [i.id, i])), [projectId, getPunchItemsForProject]);
  const sample = !!project && isSampleProject(project);

  // ── After photo from here ────────────────────────────────────────────────
  const takeAfterPhoto = useCallback(async (item: PunchItem | undefined) => {
    if (!item) {
      showAlert(t('field.punchSeal.itemNotOnPhone', 'Not on This Phone Yet'), t('field.punchSeal.itemNotOnPhoneBody', 'Open the punch list once so this item loads, then take the after photo.'));
      return;
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert(t('field.punchSeal.cameraNeeded', 'Camera Access Needed'), t('field.punchSeal.cameraNeededBody', 'Allow camera access in Settings to take the after photo.'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      }
    } catch {
      showAlert(t('field.punchSeal.cameraFailed', 'Couldn’t Open the Camera'), t('field.punchSeal.cameraFailedBody', 'Try again.'));
      return;
    }
    const uri = !result.canceled ? result.assets?.[0]?.uri : undefined;
    if (!uri) return;
    updatePunchItem(item.id, { afterPhotoUri: uri, afterPhotoTakenAt: new Date().toISOString() });
    // The row ticks only once the server has it: look again shortly.
    setTimeout(() => { void refetch(); }, 4000);
  }, [updatePunchItem, refetch, t]);

  const openItem = useCallback((itemId: string) => {
    if (!projectId) return;
    router.push({ pathname: '/punch-list' as never, params: { projectId, itemId } as never });
  }, [projectId, router]);

  // ── The ceremony ─────────────────────────────────────────────────────────
  const [signOpen, setSignOpen] = useState(false);
  useSheetDialogScope(signOpen);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [paths, setPaths] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const storedRef = useRef<PunchSeal | null>(null);
  const errors = useMemo(() => errorSentence(t), [t]);
  const projectName = project?.name ?? '';

  const openSign = useCallback(() => {
    setName(''); setPaths([]); setConsent(false); storedRef.current = null;
    setSignOpen(true);
  }, []);

  const write = useCallback(async (): Promise<CommitResult> => {
    if (offline) return { status: 'refused', reason: offlineLegalReason('signing') };
    if (!projectId) return { status: 'refused', reason: errors.not_found };
    try {
      const { data, error } = await supabase.functions.invoke('seal-punch', {
        body: {
          action: 'seal',
          project_id: projectId,
          item_ids: readiness.itemIds,
          signer_name: name.trim(),
          signer_role: 'Client',
          signature_paths: paths,
          consent_version: PUNCH_SEAL_CONSENT_VERSION,
        },
      });
      if (error) {
        // Nothing reached the server, or no answer: it may still have landed.
        if (edgeErrorStatus(error) == null) {
          void refetch();
          return { status: 'timeout', message: closeProjectTimeout(projectName || t('field.punchSeal.thisProject', 'this project')) };
        }
        const info = await readEdgeError(error, errors.server);
        void refetch();
        const code = info.code as PunchSealErrorCode;
        return { status: 'refused', reason: errors[code] ?? errors.server };
      }
      const row = punchSealFromRow((data as { seal?: unknown } | null)?.seal);
      if (!row) {
        void refetch();
        return { status: 'timeout', message: closeProjectTimeout(projectName || t('field.punchSeal.thisProject', 'this project')) };
      }
      storedRef.current = row;
      return {
        status: 'confirmed',
        title: t('field.punchSeal.acceptedTitle', 'Final Punch Accepted'),
        detail: tn('field.punchSeal.acceptedDetail', row.itemCount, { one: '{count} item sealed on the record.', other: '{count} items sealed on the record.' }),
      };
    } catch {
      void refetch();
      return { status: 'timeout', message: closeProjectTimeout(projectName || t('field.punchSeal.thisProject', 'this project')) };
    }
  }, [offline, projectId, readiness.itemIds, name, paths, refetch, errors, projectName, t, tn]);

  const recordFrom = useCallback<SigningCeremonyProps['recordFrom']>((_r: Confirmed) => {
    const row = storedRef.current;
    return { signedAtIso: row?.sealedAt ?? '', timeSource: 'server', name: row?.signerName ?? '' };
  }, []);

  const onSignDone = useCallback((r: CommitResult) => {
    setBusy(false);
    if (r.status !== 'confirmed') return;
    void refetch();
  }, [refetch]);
  const onLateResult = useCallback((r: CommitResult) => {
    if (r.status === 'confirmed') { setSignOpen(false); void refetch(); }
  }, [refetch]);

  const ceremonyCopy = useMemo(() => ({
    label: t('field.punchSeal.slideLabel', 'Slide Along the Line to Accept'),
    srLabel: t('field.punchSeal.srLabel', 'Accept the Final Punch'),
    srConfirm: t('field.punchSeal.srConfirm', 'Confirm Your Acceptance'),
    sealedAnnounce: t('field.punchSeal.sealedAnnounce', 'Accepted. The final punch is sealed.'),
  }), [t]);

  // ── PDF ──────────────────────────────────────────────────────────────────
  const companyName = settings?.branding?.companyName ?? '';
  const [pdfBusy, setPdfBusy] = useState(false);
  const savePdf = useCallback(async () => {
    if (!seal || !user?.id) return;
    setPdfBusy(true);
    try {
      const r = await savePunchSealPdf({ seal, userId: user.id, companyName });
      if (r.kind !== 'web_print') {
        if (r.storeError) {
          // The raw storage error is for diagnostics only, never the screen.
          console.warn('[punch-seal] PDF copy not stored', r.storeError);
          showAlert(
            t('field.punchSeal.pdfNotStoredTitle', 'PDF Copy Not Stored Yet'),
            t('field.punchSeal.pdfNotStoredBody', 'You have your PDF, but the copy kept with this job wasn’t saved. Tap Save PDF again to store it.'),
          );
        }
        void refetch();
      }
    } catch (e) {
      // Log the raw error for diagnostics; the GC gets a plain next step.
      console.warn('[punch-seal] PDF failed', e);
      showAlert(
        t('field.punchSeal.pdfFailed', 'Couldn’t Make the PDF'),
        t('field.punchSeal.pdfFailedBody', 'No PDF was made. Try again. If it keeps failing, check your connection.'),
      );
    } finally {
      setPdfBusy(false);
    }
  }, [seal, user?.id, companyName, refetch, t]);

  // ── Render ───────────────────────────────────────────────────────────────
  const screenOptions = useMemo(() => ({ title: t('field.punchSeal.screenTitle', 'Final Punch') }), [t]);
  const day = (iso: string) => formatCalendarDay(calendarDayOf(iso) ?? iso);

  const rows: CheckRow[] = formalServer.map((it) => {
    const reason = blockerById.get(it.id);
    const local = localById.get(it.id);
    const uploading = reason === 'no_after_photo' && !!local?.afterPhotoUri;
    return {
      key: it.id,
      status: reason ? 'pending' : 'done',
      render: () => (
        <View style={styles.rowBody}>
          <Text style={styles.rowText} numberOfLines={2}>{it.description || t('field.punchSeal.untitledItem', 'Untitled item')}</Text>
          {it.location ? <Text style={styles.rowSub} numberOfLines={1}>{it.location}</Text> : null}
          {reason === 'not_closed' ? (
            <View style={styles.rowActions}>
              <Text style={styles.rowWarn}>{t('field.punchSeal.notClosed', 'Not closed yet.')}</Text>
              <TouchableOpacity onPress={() => openItem(it.id)} accessibilityRole="button" testID={`punch-seal-open-${it.id}`} style={styles.rowLink}>
                <Text style={styles.rowLinkText}>{t('field.punchSeal.openItem', 'Open Item')}</Text>
                <ChevronRight size={14} color={colors.accentLabel} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          ) : reason === 'no_after_photo' ? (
            <View style={styles.rowActions}>
              <Text style={styles.rowWarn}>
                {uploading
                  ? t('field.punchSeal.afterPhotoUploading', 'After photo saved on this phone. Uploading.')
                  : t('field.punchSeal.needsAfterPhoto', 'Needs an after photo.')}
              </Text>
              {!uploading ? (
                <TouchableOpacity onPress={() => { void takeAfterPhoto(local); }} accessibilityRole="button" testID={`punch-seal-photo-${it.id}`} style={styles.rowLink}>
                  <Camera size={14} color={colors.accentLabel} strokeWidth={1.75} />
                  <Text style={styles.rowLinkText}>{t('field.punchSeal.takeAfterPhoto', 'Take After Photo')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ),
    };
  });

  const noAfter = readiness.blockers.filter(b => b.reason === 'no_after_photo').length;
  const notClosed = readiness.blockers.filter(b => b.reason === 'not_closed').length;

  let body: React.ReactNode;
  if (!projectId || !project) {
    body = <Text style={styles.muted}>{t('field.punchSeal.noProject', 'This project is not on this phone.')}</Text>;
  } else if (status === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>{t('field.punchSeal.loading', 'Reading the punch list on your account.')}</Text>
      </View>
    );
  } else if (status === 'failed') {
    body = (
      <Card>
        <Text style={styles.bodyText}>{t('field.punchSeal.loadFailed', 'Couldn’t read the punch list on your account. Check your connection.')}</Text>
        <Button label={t('field.punchSeal.tryAgainButton', 'Try Again')} variant="secondary" onPress={() => { void refetch(); }} style={styles.gapTop} testID="punch-seal-retry" />
      </Card>
    );
  } else if (seal) {
    body = (
      <Card testID="punch-seal-record">
        <View style={styles.sealedHead}>
          <Lock size={16} color={colors.successLabel} strokeWidth={1.75} />
          <Text style={styles.heading}>{t('field.punchSeal.acceptedTitle', 'Final Punch Accepted')}</Text>
        </View>
        <Text style={styles.bodyText}>{t('field.punchSeal.recordStatement', 'These punch items were closed, each with an after photo, as of the date below. This record is not a warranty.')}</Text>
        {([
          [t('field.punchSeal.rowSealed', 'Sealed'), day(seal.sealedAt)],
          [t('field.punchSeal.rowAcceptedBy', 'Accepted by'), seal.signerName],
          [t('field.punchSeal.rowItems', 'Punch Items'), String(seal.itemCount)],
          [t('field.punchSeal.rowRecordId', 'Record ID'), seal.id],
          [t('field.punchSeal.rowHash', 'Record Hash'), seal.manifestHash],
        ] as const).map(([k, v]) => (
          <View key={k} style={styles.kv}>
            <Text style={styles.kvKey}>{k}</Text>
            <Text style={styles.kvVal} selectable>{v}</Text>
          </View>
        ))}
        <Text style={styles.muted}>
          {seal.pdfPath
            ? t('field.punchSeal.pdfStored', 'PDF copy stored, hash checked.')
            : Platform.OS === 'web'
              ? t('field.punchSeal.pdfWebOnly', 'PDF copy not stored yet. The stored copy is made in the phone app; here you can print from the record.')
              : t('field.punchSeal.pdfNotStored', 'PDF copy not stored yet.')}
        </Text>
        <Button label={t('field.punchSeal.savePdf', 'Save PDF')} onPress={() => { void savePdf(); }} loading={pdfBusy} disabled={pdfBusy} style={styles.gapTop} testID="punch-seal-save-pdf" />
      </Card>
    );
  } else if (sample) {
    body = (
      <Card testID="punch-seal-sample">
        <Text style={styles.bodyText}>{t('field.punchSeal.sampleReason', 'Sample projects can’t be sealed. Seal the final punch on one of your real projects.')}</Text>
      </Card>
    );
  } else {
    body = (
      <>
        <Card pad="none">
          <View style={styles.summary}>
            <Text style={styles.heading}>
              {readiness.count === 0
                ? t('field.punchSeal.noPunchList', 'No punch list on file for this project.')
                : readiness.ready
                  ? tn('field.punchSeal.allReady', readiness.count, { one: '{count} item closed with an after photo. Ready for the client.', other: 'All {count} items closed with an after photo. Ready for the client.' })
                  : t('field.punchSeal.progress', '{done} of {count} items closed with an after photo.', { done: readiness.count - readiness.blockers.length, count: readiness.count })}
            </Text>
            {noAfter > 0 ? <Text style={styles.warn}>{tn('field.punchSeal.needAfterPhotos', noAfter, { one: '{count} item still needs an after photo.', other: '{count} items still need an after photo.' })}</Text> : null}
            {notClosed > 0 ? <Text style={styles.warn}>{tn('field.punchSeal.needClosing', notClosed, { one: '{count} item is not closed yet.', other: '{count} items are not closed yet.' })}</Text> : null}
            <Text style={styles.muted}>{t('field.punchSeal.formalOnly', 'Crew list items are not part of the client’s acceptance.')}</Text>
          </View>
          {rows.length > 0 ? (
            <CheckSync
              rows={rows}
              rowStyle={styles.row}
              renderCheck={(s) => (s === 'done'
                ? <CheckCircle2 size={20} color={colors.successLabel} strokeWidth={1.75} />
                : <Circle size={20} color={colors.textMuted} strokeWidth={1.75} />)}
              testID="punch-seal-readiness"
            />
          ) : null}
        </Card>
        <Button label={t('field.punchSeal.checkAgain', 'Check Again')} variant="ghost" onPress={() => { void refetch(); }} style={styles.gapTop} testID="punch-seal-check-again" />
        {readiness.ready ? (
          <Button
            label={t('field.punchSeal.handToClient', 'Hand the Phone to the Client to Accept')}
            onPress={openSign}
            disabled={offline}
            style={styles.gapTop}
            testID="punch-seal-start"
          />
        ) : null}
        {readiness.ready && offline ? <Text style={styles.muted}>{offlineLegalReason('signing')}</Text> : null}
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} keyboardShouldPersistTaps="handled">
        {projectName ? <Text style={styles.projectName}>{projectName}</Text> : null}
        {body}
      </ScrollView>

      <Modal visible={signOpen} transparent animationType="slide" onRequestClose={() => { if (!busy) setSignOpen(false); }}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.heading}>{t('field.punchSeal.acceptHeading', 'Accept the Final Punch')}</Text>
              <Text style={styles.muted}>{t('field.punchSeal.acceptSub', 'Walk the list together, then sign with your finger.')}</Text>
            </ScrollView>
            {signOpen ? (
              <SigningCeremony
                signer="homeowner"
                mode="drawn"
                method="in_person"
                parties={1}
                signedBefore={0}
                sealVerb="ACCEPTED"
                role="Client"
                top={{
                  title: t('field.punchSeal.ceremonyTitle', 'Final Punch'),
                  subtitle: projectName || undefined,
                  rows: [
                    { label: t('field.punchSeal.rowItems', 'Punch Items'), value: String(readiness.count) },
                    { label: t('field.punchSeal.rowState', 'State'), value: t('field.punchSeal.rowStateValue', 'Closed, each with an after photo') },
                  ],
                }}
                name={{ value: name, onChange: setName, label: t('field.punchSeal.clientName', 'Your Full Name'), placeholder: t('field.punchSeal.clientName', 'Your Full Name'), minLength: 2 }}
                consent={{
                  version: PUNCH_SEAL_CONSENT_VERSION,
                  text: t('field.punchSeal.legal.acceptance', 'By signing you confirm you walked this project with the contractor and the items listed were closed on the date shown, each with an after photo. This record is not a warranty and does not change your contract or its warranty terms. A copy is kept by your contractor and is available to you on request.'),
                  checked: consent,
                  onChange: setConsent,
                }}
                paths={paths}
                onPathsChange={setPaths}
                offline={offline}
                copy={ceremonyCopy}
                write={write}
                writeOptions={{
                  idempotent: false,
                  timeoutMs: 60000,
                  copy: {
                    refused: sealRefused(),
                    timeout: closeProjectTimeout(projectName || t('field.punchSeal.thisProject', 'this project')),
                    legalQueued: sealLegalQueued(),
                  },
                }}
                recordFrom={recordFrom}
                evidence={storedRef.current ? t('field.punchSeal.evidence', 'Record hash {hash}', { hash: storedRef.current.manifestHash.slice(0, 12) }) : undefined}
                onCommitStart={() => setBusy(true)}
                onUncommit={() => { setBusy(false); void refetch(); }}
                onDone={onSignDone}
                onLateResult={onLateResult}
                onResultAfterUnmount={onLateResult}
                testID="punch-seal-ceremony"
              />
            ) : null}
            <Button
              label={storedRef.current ? t('field.punchSeal.done', 'Done') : t('field.punchSeal.cancel', 'Cancel')}
              variant="ghost"
              onPress={() => setSignOpen(false)}
              disabled={busy}
              style={styles.gapTop}
              testID="punch-seal-close"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 48, gap: 12, maxWidth: Layout.page.reading, width: '100%', alignSelf: 'center' },
    projectName: { fontSize: Type.footnote.fontSize, color: c.textSecondary },
    center: { alignItems: 'center', gap: 10, paddingVertical: 32 },
    heading: { fontSize: Type.headline.fontSize, fontWeight: '700', color: c.text },
    bodyText: { fontSize: Type.subhead.fontSize, color: c.text, lineHeight: 21, marginTop: 6 },
    muted: { fontSize: Type.footnote.fontSize, color: c.textMuted, marginTop: 8 },
    warn: { fontSize: Type.footnote.fontSize, color: c.warningLabel, marginTop: 6 },
    summary: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    row: { paddingVertical: 12, paddingHorizontal: 16, gap: 12, alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    rowBody: { flex: 1, gap: 2 },
    rowText: { fontSize: Type.subhead.fontSize, color: c.text },
    rowSub: { fontSize: Type.footnote.fontSize, color: c.textSecondary },
    rowActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 4 },
    rowWarn: { fontSize: Type.footnote.fontSize, color: c.warningLabel },
    rowLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
    rowLinkText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: c.accentLabel },
    sealedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    kv: { marginTop: 10 },
    kvKey: { fontSize: Type.caption1.fontSize, color: c.textMuted },
    kvVal: { fontSize: Type.subhead.fontSize, color: c.text },
    gapTop: { marginTop: 12 },
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: { maxHeight: '94%', padding: 16, paddingBottom: 32, borderTopLeftRadius: Tokens.radius.panel, borderTopRightRadius: Tokens.radius.panel, backgroundColor: c.bg },
    sheetScroll: { flexGrow: 0, marginBottom: 8 },
  });
}
