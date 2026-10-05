// components/brain/ask/AskAttach.tsx — the paperclip in the Ask composer
// (lane ATTASK): attach a photo, a PDF or one of the anchored job's plan pages
// to the next question. A plan page is offered to the job's owner only: the
// server reads one for nobody else, so anyone else sees the row off with the
// reason under it. The reason is the true one: "couldn't check, try again" only
// when the role read failed or is waiting for a network; a read that answered
// "not on this job" says that, with nothing to try again.
//
// WHAT A TAP DOES.
//   Free plan: an alert that says reading files is on Pro, with "See plans".
//     Nothing can be attached.
//   Otherwise: one sheet. Phone rows: Take photo, Choose photos, Choose a PDF,
//     Plan page. Web rows: Choose photos or PDFs, Plan page. The plan list is
//     the same sheet with its body swapped (one modal, so on iOS no second
//     modal has to present while the first one dismisses); its first row,
//     Back, returns to the menu.
//
// THE PICKERS. Ask launches them itself rather than through the message
// picker hook: that one picks at quality 0.7 (four such photos do not fit one
// question) and logs the caught error. Here photos are picked at quality 0.4
// with no EXIF (the repo's setting for multi-photo AI reads), a throw adds
// nothing and writes nothing to a log, and the sheet stays mounted until the
// picker returns (a picker launched while a sheet is dismissing does not
// present on iOS). On the web the picker call is the first thing the tap does,
// with nothing awaited before it: a browser opens a file chooser only inside
// the tap.
//
// THE CHECKS, in order: the message picker's own vetting for type, empty files
// and name cleaning; Ask's limits (file count, device megabytes); then each
// PDF's page count, read on the device without skipping encryption, so a
// password-protected PDF is refused here instead of after an upload. A refused
// file's cache copy is deleted. Every refusal is one sentence from
// useAskCopy().files with its numbers filled from utils/askFilesCore.
//
// Nothing here is sent anywhere, and no file name reaches a log.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Paperclip, Camera, Images, FileText, Map as MapIcon, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { AskAttachedFile, PlanSheet } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useAskCopy } from '@/hooks/useAskCopy';
import { vetCandidates, type AttachmentCandidate } from '@/hooks/useAttachmentPicker';
import { normalizeMime } from '@/utils/messageAttachments';
import { formatBytes } from '@/utils/projectFiles';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { oops } from '@/components/animations/NailItToast';
import { Sheet } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { countAskPdfPages, releaseAskFile } from '@/utils/askFiles';
import {
  ASK_DEVICE_TOTAL_MAX_BYTES, ASK_FILE_MIMES, ASK_MAX_FILES, ASK_PDF_MAX_PAGES,
  askPlanRowBlock, isAskablePlanPath, mbOf, vetAskFiles,
} from '@/utils/askFilesCore';

export interface AskAttachProps {
  /** What is already in the tray. */
  files: AskAttachedFile[];
  onAdd: (files: AskAttachedFile[]) => void;
  /** The job Ask is anchored to: its plan pages can be attached. */
  anchorProjectId?: string | null;
  disabled?: boolean;
}

type PickKind = 'camera' | 'photos' | 'pdf' | 'files';

/** A toast holds this many characters before it cuts the sentence. */
const TOAST_MAX = 120;

const lastSegment = (uri: string): string => {
  const clean = String(uri ?? '').split(/[?#]/)[0];
  const seg = clean.split('/').pop() ?? '';
  try { return decodeURIComponent(seg); } catch { return seg; }
};

function imageCandidate(a: ImagePicker.ImagePickerAsset): AttachmentCandidate {
  const name = a.fileName || lastSegment(a.uri);
  return {
    uri: a.uri,
    name,
    // A camera shot may carry no type: the extension decides here, and the
    // server checks the bytes.
    mimeType: a.mimeType ?? (normalizeMime('', name) ?? normalizeMime('', lastSegment(a.uri))),
    size: a.fileSize ?? a.file?.size ?? null,
    width: a.width,
    height: a.height,
  };
}

/** A size the picker did not give, measured on a phone; null when it cannot be. */
async function sizeOf(uri: string, known?: number | null): Promise<number | null> {
  if (typeof known === 'number' && known > 0) return known;
  if (Platform.OS === 'web') return typeof known === 'number' ? known : null;
  try {
    // `size: true`: older file-system builds measure only when asked.
    const info = await FileSystem.getInfoAsync(uri, { size: true } as never);
    const size = (info as { size?: unknown }).size;
    return info.exists && typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}

/** Just enough of a tray file to let its local copy go. */
const localCopy = (uri: string): AskAttachedFile =>
  ({ id: '', source: 'device', name: '', mime: 'image/jpeg', size: 0, localUri: uri });

/** How long the sheet takes to leave. An alert raised over a sheet that is
 *  still dismissing goes away with it on iOS, so a refusal waits this long. */
const SHEET_LEAVE_MS = 400;

/** One alert or one toast for everything a pick refused: each sentence once. */
function showRefusals(sentences: string[], title: string): void {
  const said = sentences.filter((s, i) => !!s && sentences.indexOf(s) === i);
  if (said.length === 0) return;
  const show = () => {
    if (said.length === 1 && said[0].length <= TOAST_MAX) { oops(said[0]); return; }
    // A toast shows one message and cuts it short: several refusals, or a long
    // one, go in an alert so every sentence is read whole.
    showAlert(title, said.join('\n\n'));
  };
  if (Platform.OS === 'web') show();
  else setTimeout(show, SHEET_LEAVE_MS);
}

export function AskAttach({ files, onAdd, anchorProjectId, disabled }: AskAttachProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const copy = useAskCopy().files;
  const { isProOrAbove } = useTierAccess();
  const { getPlanSheetsForProject } = useProjects();
  const web = Platform.OS === 'web';
  // Plan pages are for the job's owner (the server reads one for nobody else).
  // isPaused: a read waiting for a network has not answered, so it is never
  // read as "not on this job".
  const { role, isLoading, isError, isPaused } = useProjectRoleState(anchorProjectId ?? undefined);
  // With no user id the role hook answers a settled null without asking
  // anybody: that is "couldn't check", never "you are not on this job".
  const { user } = useAuth();
  const planBlock = askPlanRowBlock({ hasJob: !!anchorProjectId, hasUser: !!user?.id, role, isLoading, isError, isPaused });

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'plan'>('menu');
  const picking = useRef(false);
  // The tray as it is when a picker returns (the pick itself is async).
  const filesRef = useRef(files);
  filesRef.current = files;

  const close = useCallback(() => { setOpen(false); setView('menu'); }, []);

  const onPressClip = useCallback(() => {
    if (disabled) return;
    Keyboard.dismiss();
    if (!isProOrAbove) {
      showAlert(copy.lockedTitle, copy.lockedBody, [
        { text: copy.lockedNotNow, style: 'cancel' },
        { text: copy.lockedSeePlans, onPress: () => router.push('/paywall') },
      ]);
      return;
    }
    setView('menu');
    setOpen(true);
  }, [disabled, isProOrAbove, copy, router]);

  /** Hold what a picker returned to the checks, hand the kept files up, and
   *  answer with one sentence per refusal. */
  const takeCandidates = useCallback(async (raw: AttachmentCandidate[]): Promise<string[]> => {
    const refusals: string[] = [];
    const cands: AttachmentCandidate[] = [];
    for (const c of raw) cands.push({ ...c, size: await sizeOf(c.uri, c.size) });
    // Type, empty file, name cleaning: the message picker's own rules.
    const vetted = vetCandidates(cands, 0);
    for (const r of vetted.refused) {
      if (r.reason === 'type') refusals.push(copy.refuseType(r.name || copy.fileFallback));
      else if (r.reason === 'empty') refusals.push(copy.refuseEmpty(r.name || copy.fileFallback));
      else if (r.reason === 'size') {
        refusals.push(copy.refuseSize(r.name || copy.fileFallback, formatBytes(r.size ?? 0), mbOf(ASK_DEVICE_TOTAL_MAX_BYTES)));
      } else refusals.push(copy.refuseCount(ASK_MAX_FILES));
    }
    const keptUris = new Set(vetted.picked.map((p) => p.localUri));
    for (const c of cands) if (!keptUris.has(c.uri)) releaseAskFile(localCopy(c.uri));

    // Ask's own limits: how many files, and how many megabytes from this device.
    const mine = vetAskFiles(vetted.picked.map((p) => ({ name: p.name, size: p.size })), filesRef.current);
    for (const r of mine.refused) {
      const p = vetted.picked[r.index];
      if (r.reason === 'count') refusals.push(copy.refuseCount(ASK_MAX_FILES));
      else if (r.reason === 'size') refusals.push(copy.refuseSize(r.name, formatBytes(r.size ?? 0), mbOf(ASK_DEVICE_TOTAL_MAX_BYTES)));
      else refusals.push(copy.refuseTotal(formatBytes(r.size ?? 0), mbOf(ASK_DEVICE_TOTAL_MAX_BYTES)));
      if (p) releaseAskFile(localCopy(p.localUri));
    }

    // A PDF: count its pages here. One that will not open is refused now.
    const added: AskAttachedFile[] = [];
    for (const index of mine.kept) {
      const p = vetted.picked[index];
      const file: AskAttachedFile = { id: p.id, source: 'device', name: p.name, mime: p.mime, size: p.size, localUri: p.localUri };
      if (p.mime === 'application/pdf') {
        const pages = await countAskPdfPages(p.localUri);
        if (pages === null) { refusals.push(copy.refusePdfUnreadable(p.name)); releaseAskFile(file); continue; }
        if (pages > ASK_PDF_MAX_PAGES) { refusals.push(copy.refusePages(p.name, pages, ASK_PDF_MAX_PAGES)); releaseAskFile(file); continue; }
        if (pages > 0) file.pages = pages;
      }
      added.push(file);
    }
    if (added.length > 0) onAdd(added);
    return refusals;
  }, [copy, onAdd]);

  const launch = useCallback(async (kind: PickKind) => {
    // A phone's picker is modal, so a second tap is a double tap. A browser
    // may never report a dismissed file chooser, so the web is not held.
    if (picking.current && !web) return;
    picking.current = true;
    let refusals: string[] = [];
    try {
      const room = ASK_MAX_FILES - filesRef.current.length;
      if (room <= 0) { refusals = [copy.refuseCount(ASK_MAX_FILES)]; return; }
      let cands: AttachmentCandidate[] = [];
      if (kind === 'pdf' || kind === 'files') {
        // On the web this call is reached with nothing awaited before it.
        const r = await DocumentPicker.getDocumentAsync({
          type: kind === 'pdf' ? 'application/pdf' : [...ASK_FILE_MIMES],
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (r.canceled || !r.assets) return;
        cands = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType ?? null,
          size: typeof a.size === 'number' ? a.size : (a.file?.size ?? null),
        }));
      } else if (kind === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { refusals = [copy.refuseCameraDenied]; return; }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.4, exif: false });
        if (r.canceled || !r.assets) return;
        cands = r.assets.map(imageCandidate);
      } else {
        if (!web) {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { refusals = [copy.refusePhotosDenied]; return; }
        }
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.4,
          exif: false,
          allowsMultipleSelection: true,
          selectionLimit: room,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
        });
        if (r.canceled || !r.assets) return;
        cands = r.assets.map(imageCandidate);
      }
      refusals = await takeCandidates(cands);
    } catch {
      // A picker that throws adds nothing. Nothing is written to a log.
    } finally {
      picking.current = false;
      // Only now: the sheet stayed mounted under the picker.
      close();
      // After the sheet has left (see SHEET_LEAVE_MS).
      showRefusals(refusals, copy.refuseTitle);
    }
  }, [copy, web, takeCandidates, close]);

  // The anchored job's plan pages MAGE can be sent: current revisions whose
  // stored path is exactly `<project>/<file>`. The rest are counted, not listed.
  const plan = useMemo(() => {
    if (!anchorProjectId) return { listed: [] as PlanSheet[], older: 0 };
    const current = getPlanSheetsForProject(anchorProjectId).filter((s) => !s.superseded);
    const listed = current.filter((s) => isAskablePlanPath(s.storagePath));
    return { listed, older: current.length - listed.length };
  }, [anchorProjectId, getPlanSheetsForProject]);

  const pickPlan = useCallback((sheet: PlanSheet) => {
    if (planBlock) return;
    const storagePath = sheet.storagePath;
    if (!storagePath || !isAskablePlanPath(storagePath)) return;
    const now = filesRef.current;
    if (now.some((f) => f.source === 'plan' && f.storagePath === storagePath)) { close(); return; }
    if (now.length >= ASK_MAX_FILES) {
      close();
      showRefusals([copy.refuseCount(ASK_MAX_FILES)], copy.refuseTitle);
      return;
    }
    onAdd([{ id: generateUUID().toLowerCase(), source: 'plan', name: sheet.name, storagePath }]);
    close();
  }, [copy, onAdd, close, planBlock]);

  const row = (testID: string, Icon: LucideIcon, label: string, onPress: () => void, opts?: { off?: boolean; why?: string; chevron?: boolean }) => (
    <View key={testID}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && !opts?.off && styles.rowPressed, opts?.off && styles.rowOff]}
        onPress={onPress}
        disabled={opts?.off}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!opts?.off }}
        accessibilityHint={opts?.off ? opts.why : undefined}
        testID={testID}
      >
        <Icon size={20} color={colors.textSecondary} strokeWidth={1.75} />
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {opts?.chevron && <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />}
      </Pressable>
      {opts?.off && !!opts.why && <Text style={styles.rowWhy}>{opts.why}</Text>}
    </View>
  );

  const planWhy = planBlock === 'noJob' ? copy.menuPlanPageNoJob
    : planBlock === 'notOwner' ? copy.menuPlanPageNotOwner
      : planBlock === 'notOnJob' ? copy.menuPlanPageNotOnJob
        : planBlock === 'checking' ? copy.menuPlanPageChecking
          : planBlock === 'unknown' ? copy.menuPlanPageUnknown : undefined;
  const planRow = row('ask-attach-plan', MapIcon, copy.menuPlanPage, () => setView('plan'),
    { off: !!planBlock, why: planWhy, chevron: !planBlock });
  // The list is drawn only while a page can be picked.
  const showPlan = view === 'plan' && !planBlock;

  return (
    <>
      <Pressable
        style={styles.clip}
        onPress={onPressClip}
        disabled={disabled}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={copy.attachA11y}
        accessibilityState={{ disabled: !!disabled }}
        testID="ask-attach"
      >
        <Paperclip size={20} color={colors.textMuted} strokeWidth={1.75} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={close}
        title={showPlan ? copy.planTitle : copy.menuTitle}
        testID={showPlan ? 'ask-plan-list' : 'ask-attach-menu'}
      >
        {!showPlan ? (
          <View style={styles.rows}>
            {web
              ? row('ask-attach-files', Images, copy.menuChooseFiles, () => { void launch('files'); })
              : (
                <>
                  {row('ask-attach-camera', Camera, copy.menuTakePhoto, () => { void launch('camera'); })}
                  {row('ask-attach-photos', Images, copy.menuChoosePhotos, () => { void launch('photos'); })}
                  {row('ask-attach-pdf', FileText, copy.menuChoosePdf, () => { void launch('pdf'); })}
                </>
              )}
            {planRow}
          </View>
        ) : (
          <View style={styles.rows}>
            {row('ask-plan-back', ChevronLeft, copy.planBack, () => setView('menu'))}
            {plan.listed.length === 0 && <Text style={styles.planNote}>{copy.planEmpty}</Text>}
            {plan.listed.map((s) => {
              const attached = files.some((f) => f.source === 'plan' && f.storagePath === s.storagePath);
              return (
                <Pressable
                  key={s.id}
                  style={({ pressed }) => [styles.row, pressed && !attached && styles.rowPressed, attached && styles.rowOff]}
                  onPress={() => pickPlan(s)}
                  disabled={attached}
                  accessibilityRole="button"
                  accessibilityLabel={copy.planPickA11y(s.name)}
                  accessibilityState={{ disabled: attached }}
                  testID={`ask-plan-${s.id}`}
                >
                  <MapIcon size={20} color={colors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.rowLabel} numberOfLines={1} ellipsizeMode="middle">{s.name}</Text>
                </Pressable>
              );
            })}
            {plan.older > 0 && <Text style={styles.planNote}>{copy.planOlder(plan.older)}</Text>}
          </View>
        )}
      </Sheet>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  clip: {
    width: 36, height: 36, borderRadius: Tokens.radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  rows: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: Layout.control.row, paddingHorizontal: 4, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  rowPressed: { backgroundColor: t.surfaceAlt },
  rowOff: { opacity: 0.5 },
  rowLabel: { flex: 1, fontSize: Type.callout.fontSize, color: t.text },
  rowWhy: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 6, paddingHorizontal: 4 },
  planNote: { fontSize: Type.footnote.fontSize, color: t.textSecondary, paddingHorizontal: 4, paddingVertical: 12 },
});
