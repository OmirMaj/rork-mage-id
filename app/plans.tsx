// app/plans.tsx — Plans library for a project.
//
// MAGE treats drawings as IMAGES, not native PDFs. The reason is pragmatic:
// every cross-platform PDF renderer in RN has its own brittle native deps
// and weird edge cases on Android/web. An image pipeline (PDF → PNG via the
// `convert-pdf-to-images` Supabase edge function, pinch-zoom + markup here)
// works identically on iOS / Android / web, ships today, and lets us render
// 200-page hospital plan sets without melting phones.
//
// Two import paths:
//   • "Import PDF"   — picks a multi-page PDF, uploads it, converts each
//                       page to a plan sheet automatically (one tap = N sheets).
//   • "Import image" — picks a single PNG/JPG (existing flow). Useful for
//                       photos of paper drawings or markup screenshots.

import React, { useCallback, useState, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Platform, TextInput, Modal, ActivityIndicator, KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
// expo-document-picker provides the native PDF picker. Pinned in package.json
// at ~14.0.7 (matches Expo SDK 54). Run `bun install` after pulling this for
// the first time so the native module is linked.
 
// @ts-ignore — types resolve after `bun install`
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, Plus, MapPin, Trash2, Image as ImageIcon,
  ChevronRight, AlertTriangle, FileImage, X, Check, FileText, Upload, Layers, Square, CheckSquare,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import AskPlansPanel from '@/components/plans/AskPlansPanel';
import { Button } from '@/components/ui';
import { useLocalPlanSheetUri } from '@/utils/planSheetLocalFiles';
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import { confirmQuotaFits } from '@/utils/quotaPrecheck';
import { TakeoffQuotaBadge } from '@/components/TakeoffQuotaBadge';
import { useUsageStatus } from '@/hooks/useUsageStatus';
import type { PlanSheet } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { addFloorPlan, attachFloorPlanImage, uploadDeviceOnlyFloorPlan, type FloorPlanActions } from '@/utils/addFloorPlan';
import { pickFloorPlanImage } from '@/utils/pickFloorPlanImage';
import { floorPlanNameFromFile, planSheetImageState, shouldRepickAfterDeviceUploadFailure, type FloorPlanImage } from '@/utils/planSheetImageCore';
import { pdfPageSheetName, priorImportOf } from '@/utils/planSheetBatchCore';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { extractSheet } from '@/utils/plans/askYourPlans';
import { PLAN_EXTRACT_STOP_CODES } from '@/utils/plans/memoryIndexCore';
import {
  titleBlockSuggestions, planBatchRenumber, chainColumnsPatch, planScreenGate, planControlBlock, effectivePlanRole, sheetDeleteBlock,
  type TitleBlockSuggestion,
} from '@/utils/plans/revisionActions';

type PlanImageSource = 'camera' | 'library';

/**
 * #162: on the phone, a plan is usually paper on the tailgate — so Plans asks
 * Camera or Library, the way the punch walk's plan step does. The web file
 * picker already offers the camera on phones, so the web goes straight in.
 * Resolves null when he cancels.
 */
function askPlanImageSource(title: string, message?: string): Promise<PlanImageSource | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise(resolve => {
    showAlert(title, message, [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from library', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/** The alert title for a refused picker names the thing that was refused. */
const blockedPickerTitle = (source: PlanImageSource) =>
  source === 'camera' ? 'Can\u2019t open camera' : 'Can\u2019t open photos';

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ projectId?: string; ask?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  // #73: PROJECT access — own tier OR the collaborator grant. A super invited
  // on a free account opens the GC's plans ('plan_markup' is in the grant)
  // instead of a Pro paywall. isBusinessOrAbove stays own-tier: it only
  // decides whether the title-block read is offered after an import.
  const { isBusinessOrAbove } = useTierAccess();
  const { canAccess, role } = useProjectAccess(projectId);
  const roleState = useProjectRoleState(projectId);
  // Web react-query PAUSES the role read offline: it is then neither loading
  // nor errored, and must not read as "no access" or "checking" forever.
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  const sheetUri = useLocalPlanSheetUri();
  // #163: Ask Your Plans opens HERE, in a sheet of its own, not on the Plan
  // Intelligence estimating screen. `ask=1` (from the plan viewer) opens it.
  const [askOpen, setAskOpen] = useState<boolean>(params.ask === '1');
  const { user: authUser } = useAuth();
  // Same gate as the viewer's number field: chain columns are written only
  // for a signed-in, cloud-connected session.
  const canSyncSheets = !!authUser?.id && isSupabaseConfigured;
  const { refresh: refreshQuota } = useUsageStatus();
  const {
    projects, getProject, getPlanSheetsForProject, addPlanSheet, addPlanSheets, updatePlanSheet, deletePlanSheet,
    getPinsForPlan, refetchPlansFromServer,
  } = useProjects();
  // #74: a phone left open on site never learned the office filed a new
  // revision. Re-read the plans from the server whenever this screen comes
  // into focus, and on pull-to-refresh. The context skips the read while any
  // plan write is still queued, so an offline import is never lost to it.
  useFocusEffect(useCallback(() => { void refetchPlansFromServer(); }, [refetchPlansFromServer]));
  const [plansRefreshing, setPlansRefreshing] = useState(false);
  const onRefreshPlans = useCallback(async () => {
    setPlansRefreshing(true);
    try { await refetchPlansFromServer(); } finally { setPlansRefreshing(false); }
  }, [refetchPlansFromServer]);
  // The upload in addFloorPlan takes seconds, and addPlanSheet/updatePlanSheet
  // persist the planSheets array they closed over. Reading them through a ref
  // at write time means a sheet that landed during the upload is not dropped.
  const planActionsRef = useRef<FloorPlanActions>({ addPlanSheet, updatePlanSheet });
  planActionsRef.current = { addPlanSheet, updatePlanSheet };

  const [importing, setImporting] = useState<boolean>(false);
  const [pdfImporting, setPdfImporting] = useState<boolean>(false);
  const [pdfStatus, setPdfStatus] = useState<string>('');
  const [newSheet, setNewSheet] = useState<{ image: FloorPlanImage; name: string; sheetNumber: string } | null>(null);
  const [savingSheet, setSavingSheet] = useState<boolean>(false);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  // #75: title-block numbers offered after a PDF import, waiting for his yes.
  const [titleReview, setTitleReview] = useState<{ items: (TitleBlockSuggestion & { use: boolean })[]; note: string | null } | null>(null);

  const project = projectId ? getProject(projectId) : null;
  // Controls that write the GC's set say why they are off for this seat. The
  // owner of the job (projects.user_id on the local row) keeps them through a
  // failed or offline role read — he used to delete sheets offline; a
  // collaborator's null role gets the sentence that is true for WHY it is null.
  const seatRole = effectivePlanRole(role, project, authUser?.id);
  const roleStatus = { isError: roleState.isError, offline };
  const importBlock = planControlBlock(seatRole, 'import', roleStatus);
  // #118: delete is decided PER SHEET (sheetDeleteBlock) — an editor may
  // delete the sheets he added (plan_sheets_collab_delete), not the GC's.
  const deleteBlockFor = useCallback(
    (sheet: PlanSheet) => sheetDeleteBlock(seatRole, sheet, authUser?.id, roleStatus),
    // roleStatus is rebuilt every render; its two inputs are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seatRole, authUser?.id, roleState.isError, offline],
  );
  const compareBlock = planControlBlock(seatRole, 'compare', roleStatus);
  const estimateBlock = planControlBlock(seatRole, 'estimate', roleStatus);
  // Hide superseded sheets by default — when a sheet number gets
  // re-uploaded, the prior copy is marked superseded but remains in
  // the project for audit history. The "Show N superseded" pill below
  // the list lets the GC bring them back into view.
  const allSheets = projectId ? getPlanSheetsForProject(projectId) : [];
  const [showSuperseded, setShowSuperseded] = useState(false);
  const sheets = useMemo(
    () => showSuperseded ? allSheets : allSheets.filter(s => !s.superseded),
    [allSheets, showSuperseded],
  );
  const supersededCount = useMemo(() => allSheets.filter(s => s.superseded).length, [allSheets]);
  // The set as it is NOW, for work that finishes after several awaits (the
  // title-block pass) — the render's allSheets would be stale by then.
  const allSheetsRef = useRef(allSheets);
  allSheetsRef.current = allSheets;

  const handleImport = useCallback(async () => {
    if (importBlock) { showAlert('Can\u2019t add sheets', importBlock); return; }
    const source = await askPlanImageSource('Add a plan image', 'Photograph the paper plan, or pick an image you already have.');
    if (!source) return;
    setImporting(true);
    try {
      const picked = await pickFloorPlanImage(source);
      if (picked.status === 'blocked') {
        showAlert(blockedPickerTitle(source), picked.reason);
        return;
      }
      if (picked.status !== 'picked') return;
      setNewSheet({
        image: picked.image,
        name: floorPlanNameFromFile(picked.image.fileName, `Sheet ${sheets.length + 1}`),
        sheetNumber: '',
      });
    } finally {
      setImporting(false);
    }
  }, [sheets.length, importBlock]);

  // #75: one metered plan-extract read per new page; stops at the first
  // refusal that would repeat (monthly cap, hourly limit, tier) and says so.
  // Nothing is written here — the numbers go to the confirm sheet below.
  const readTitleBlocks = useCallback(async (sheetsToRead: PlanSheet[]) => {
    const reads: { sheetId: string; sheetNumber?: string }[] = [];
    let stopped: string | null = null;
    let unread = 0;
    for (let i = 0; i < sheetsToRead.length; i++) {
      setPdfStatus(`Reading sheet numbers \u2014 ${i + 1} of ${sheetsToRead.length}\u2026`);
      const out = await extractSheet(sheetsToRead[i]);
      if (out.ok) {
        if (out.titleBlock?.sheetNumber) reads.push({ sheetId: sheetsToRead[i].id, sheetNumber: out.titleBlock.sheetNumber });
        else unread++;
        continue;
      }
      if (PLAN_EXTRACT_STOP_CODES.has(out.code)) {
        stopped = `${out.reason.replace(/\s*[.!]+\s*$/, '')}. ${sheetsToRead.length - i} page${sheetsToRead.length - i === 1 ? ' was' : 's were'} not read.`;
        break;
      }
      unread++;
    }
    setPdfStatus('');
    const suggestions = titleBlockSuggestions(allSheetsRef.current, reads);
    const notes: string[] = [];
    if (unread > 0) notes.push(`${unread} page${unread === 1 ? '' : 's'} had no readable sheet number \u2014 number ${unread === 1 ? 'it' : 'them'} in the plan viewer.`);
    if (stopped) notes.push(stopped);
    if (suggestions.length === 0) {
      showAlert('No sheet numbers read', notes.join('\n\n') || 'No title block on these pages had a readable sheet number. Number them in the plan viewer.');
      return;
    }
    setTitleReview({
      // A number two pages both "read" is offered but not pre-ticked.
      items: suggestions.map(sg => ({ ...sg, use: !sg.duplicate })),
      note: notes.length > 0 ? notes.join(' ') : null,
    });
  }, []);

  // Apply the numbers he confirmed, through the same planRenumber the viewer
  // runs (supersede + Rev N+1), chain columns via the offline queue.
  const applyTitleNumbers = useCallback(() => {
    if (!titleReview) return;
    const accepted = titleReview.items.filter(i => i.use).map(i => ({ sheetId: i.sheetId, sheetNumber: i.sheetNumber }));
    setTitleReview(null);
    if (accepted.length === 0) return;
    const plan = planBatchRenumber(accepted, allSheetsRef.current);
    const now = new Date().toISOString();
    for (const p of plan.patches) {
      // updatePlanSheet reads the context's ref, so sequential patches in one
      // tick do not overwrite each other.
      planActionsRef.current.updatePlanSheet(p.id, p.updates);
      const chain = chainColumnsPatch(p.updates);
      if (canSyncSheets && chain) void supabaseWrite('plan_sheets', 'update', { id: p.id, ...chain, updated_at: now });
    }
    showAlert(
      'Sheet numbers saved',
      [`${plan.applied} sheet${plan.applied === 1 ? '' : 's'} numbered.`, ...plan.messages].join('\n\n'),
    );
  }, [titleReview, canSyncSheets]);

  const handleImportPdf = useCallback(async () => {
    if (!projectId) return;
    if (importBlock) { showAlert('Can\u2019t add sheets', importBlock); return; }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];

      // Sanity cap on the client too — the edge function caps at 50 pages
      // server-side, but stopping a 500 MB upload before it leaves the device
      // saves the user a long progress bar that ends in failure.
      if (asset.size && asset.size > 500 * 1024 * 1024) {
        showAlert('PDF too large', 'Plan PDFs must be under 500 MB. Try splitting it by discipline.');
        return;
      }

      // Quota precheck \u2014 count pages locally with pdf-lib (~150ms even on
      // 200-page sets) and confirm with the user when their takeoff
      // pages quota is tight. The edge function enforces the same check
      // server-side; doing it client-side is purely UX (fail fast, no
      // long upload + 429).
      // Same file already imported? Rendering it again charges the month's
      // takeoff pages again (convert-pdf-to-images bills per page), so ask
      // BEFORE the upload. Going ahead replaces those pages (Rev +1, the old
      // ones hidden as superseded) instead of listing every page twice.
      const baseName = asset.name?.replace(/\.[^/.]+$/, '') ?? 'Plan set';
      const prior = priorImportOf(allSheets, projectId, baseName);
      if (prior.length > 0) {
        const again = await new Promise<boolean>((resolve) => {
          showAlert(
            'Already imported',
            `\u201C${baseName}\u201D is already on this project (${prior.length} sheet${prior.length === 1 ? '' : 's'}). Importing it again uses takeoff pages again and replaces those sheets with the new copy. Pins stay on the old sheets.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Import again', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!again) return;
      }

      setPdfImporting(true);
      setPdfStatus('Reading PDF\u2026');
      const pageCount = await countPdfPages(asset.uri);
      if (pageCount != null) {
        const fits = await confirmQuotaFits(pageCount, asset.name ?? 'PDF', router);
        if (!fits) {
          setPdfImporting(false);
          setPdfStatus('');
          return;
        }
      }

      setPdfStatus('Uploading PDF\u2026');

      const pages = await uploadAndRenderPdf({
        fileUri: asset.uri,
        fileName: asset.name,
        projectId,
      });

      setPdfStatus(`Saving ${pages.length} sheet${pages.length === 1 ? '' : 's'}\u2026`);

      // ONE call for the whole set (audit round 2, #18). A forEach of
      // addPlanSheet kept only the last page on screen and in the cache while
      // the alert claimed all of them.
      const { created, superseded } = addPlanSheets(pages.map((p) => ({
        projectId,
        name: pdfPageSheetName(baseName, pages.length, p.pageNumber),
        sheetNumber: undefined,
        // #118: the uploader, on the local copy too — an editor who imported
        // the wrong PDF can delete these sheets before the next server read
        // (plan_sheets_collab_delete admits user_id = auth.uid()).
        userId: authUser?.id,
        // DB-F11: `storagePath` is what reaches plan_sheets.image_uri (the
        // context's durablePlanSheetValue picks it); `imageUri` carries the
        // freshly-signed url so the thumbnail renders right now without a
        // re-fetch. This line used to persist `p.publicUrl` — a permanent
        // unsigned link to a construction drawing.
        storagePath: p.storagePath,
        imageUri: p.viewUrl,
        width: p.width,
        height: p.height,
        pageNumber: p.pageNumber,
      })), { matchUnnumberedByPage: true });

      setPdfStatus('');
      // Refresh the usage badge so the user sees the new "X of Y pages
      // remaining" reflecting the just-charged pages without remounting.
      refreshQuota();
      // Counts what was actually created, not what the renderer returned.
      const replacedNote = superseded.length > 0
        ? ` ${superseded.length} earlier sheet${superseded.length === 1 ? ' from this set was' : 's from this set were'} replaced \u2014 the old copies are under \u201CShow superseded\u201D.`
        : '';
      const added = created.length > 0
        ? `${created.length} sheet${created.length === 1 ? '' : 's'} added.${replacedNote}`
        : 'The PDF rendered no pages, so no sheets were added.';
      // #75: the pages arrive with no sheet number, and revisions chain on the
      // number — so the NEXT issue of this set would sit beside these pages with
      // nothing superseded. Offer to read the number printed in each title
      // block. It is a paid AI read per page, so it is offered (never run
      // silently) with its cost, and every number is confirmed before it is
      // written. plan-extract is a Business feature; below that the pages are
      // numbered by hand in the viewer, as before.
      if (created.length > 0 && isBusinessOrAbove) {
        const n = created.length;
        const read = await new Promise<boolean>((resolve) => {
          showAlert(
            'PDF imported',
            `${added}\n\nThese pages have no sheet numbers yet, so a later revision of this set can\u2019t replace them. MAGE can read the number printed in each title block \u2014 that uses ${n} AI plan read${n === 1 ? '' : 's'} from your monthly allowance. You confirm every number before it\u2019s saved.`,
            [
              { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
              { text: `Read ${n} number${n === 1 ? '' : 's'}`, onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (read) await readTitleBlocks(created);
        return;
      }
      showAlert('PDF imported', created.length > 0 ? `${added} Open one to start dropping pins.` : added);
    } catch (err) {
      // The function's own sentence (utils/edgeError): a tier refusal, the
      // page cap, the hourly limit — never "non-2xx status code".
      const msg = (err as Error).message || 'Could not import that PDF.';
      showAlert('Import failed', msg);
    } finally {
      setPdfImporting(false);
      setPdfStatus('');
    }
  }, [projectId, allSheets, addPlanSheets, router, refreshQuota, isBusinessOrAbove, readTitleBlocks, importBlock, authUser?.id]);

  // Upload FIRST, then create the sheet with its storage path (utils/addFloorPlan).
  // This used to call addPlanSheet with the picker's file:// and upload
  // nothing, so plan_sheets.image_uri was '' and the sheet was blank on every
  // other device — the founder's IMG_1668 row. On failure the modal stays open
  // with the reason, and no empty sheet is created.
  const confirmImport = useCallback(async () => {
    if (!newSheet || !newSheet.name.trim() || !projectId) {
      showAlert('Name required', 'Give the sheet a name before saving.');
      return;
    }
    setSavingSheet(true);
    try {
      const result = await addFloorPlan({
        projectId,
        image: newSheet.image,
        name: newSheet.name.trim(),
        sheetNumber: newSheet.sheetNumber,
      }, () => planActionsRef.current);
      if (!result.ok) {
        showAlert('Plan not saved', result.reason);
        return;
      }
      setNewSheet(null);
      router.push({ pathname: '/plan-viewer' as never, params: { sheetId: result.sheet.id } as never });
    } finally {
      setSavingSheet(false);
    }
  }, [newSheet, projectId, router]);

  // Repair a sheet whose image never reached storage. On the phone that
  // imported it the picker file may still exist, so upload that; everywhere
  // else (and once iOS purged it) ask for the image again. Either way the
  // sheet id is kept, so pins and punch items on it survive.
  const repickAndAttach = useCallback(async (sheet: PlanSheet, chosen?: PlanImageSource) => {
    const source = chosen ?? await askPlanImageSource(`Add the image for \u201C${sheet.name}\u201D`, 'Photograph the paper plan, or pick the image from your photos.');
    if (!source) return;
    setRepairingId(sheet.id);
    try {
      const picked = await pickFloorPlanImage(source);
      if (picked.status === 'blocked') {
        showAlert(blockedPickerTitle(source), picked.reason);
        return;
      }
      if (picked.status !== 'picked') return;
      const result = await attachFloorPlanImage(sheet, picked.image, () => planActionsRef.current);
      if (!result.ok) {
        showAlert('Plan not saved', result.reason);
        return;
      }
      showAlert('Plan saved', `\u201C${sheet.name}\u201D now shows on every device.`);
    } finally {
      setRepairingId(null);
    }
  }, []);

  const handleRepairImage = useCallback(async (sheet: PlanSheet) => {
    // Re-uploading writes into plan-sheets storage (editor and up).
    if (importBlock) { showAlert('Can\u2019t upload the image', importBlock); return; }
    if (planSheetImageState(sheet) === 'device-only') {
      setRepairingId(sheet.id);
      let direct: Awaited<ReturnType<typeof uploadDeviceOnlyFloorPlan>>;
      try {
        direct = await uploadDeviceOnlyFloorPlan(sheet, () => planActionsRef.current);
      } finally {
        setRepairingId(null);
      }
      if (direct.ok) {
        showAlert('Plan saved', `\u201C${sheet.name}\u201D now shows on every device.`);
        return;
      }
      // A vanished local file, or a local file the plan store cannot take
      // (an old full-quality import copied the HEIC/oversize original), is
      // worth re-picking for — a fresh pick comes back as a JPEG. No signal
      // or an RLS refusal would fail the same way with a new image.
      if (!shouldRepickAfterDeviceUploadFailure(direct.kind)) {
        showAlert('Plan not saved', direct.reason);
        return;
      }
      // Say why the photo library is about to open — dropping him into the
      // picker with no word reads as the app misfiring (blocked controls say
      // why). He chooses to go on; nothing opens on its own.
      // "Pick plan" then asks Camera or Library (#162) — a paper plan can be
      // photographed again right here.
      showAlert('Pick the plan again', `The copy of \u201C${sheet.name}\u201D on this phone can\u2019t be saved. ${direct.reason}\n\nPhotograph the plan or pick it from your photos \u2014 its pins and punch items stay on this sheet.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pick plan', onPress: () => { void repickAndAttach(sheet); } },
      ]);
      return;
    }
    await repickAndAttach(sheet);
  }, [repickAndAttach, importBlock]);

  const handleDelete = useCallback((sheet: PlanSheet) => {
    const block = deleteBlockFor(sheet);
    if (block) { showAlert('Can\u2019t delete this sheet', block); return; }
    showAlert('Delete sheet', `Remove \u201C${sheet.name}\u201D? All pins and markup on this sheet \u2014 including teammates\u2019 \u2014 will also be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePlanSheet(sheet.id) },
    ]);
  }, [deletePlanSheet, deleteBlockFor]);

  // Project picker when launched without a project
  if (!projectId || !project) {
    return <PlansProjectPicker projects={projects} onPick={(id) => router.replace({ pathname: '/plans' as never, params: { projectId: id } as never })} onBack={() => router.back()} />;
  }

  // The gating contract (utils/plans/revisionActions planScreenGate): a
  // spinner only while the role read is in flight — never a paywall flash for
  // a free foreman — a retry on a failed read, and "no access" said plainly.
  const planAccess = canAccess('plan_markup');
  const gate = planScreenGate({ canAccess: planAccess, roleLoading: roleState.isLoading, roleError: roleState.isError, role, offline });
  if (!planAccess) {
    return gate === 'locked'
      ? <PaywallView onUpgrade={() => router.push('/paywall' as never)} onBack={() => router.back()} insets={insets} />
      : <PlansAccessGate gate={gate} projectName={project.name} onRetry={roleState.refetch} onBack={() => router.back()} insets={insets} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>{project.name}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Plans</Text>
        </View>
        <TouchableOpacity onPress={handleImportPdf} style={[styles.ghostBtn, importBlock ? { opacity: 0.5 } : null]} disabled={pdfImporting || importing} accessibilityRole="button" accessibilityLabel="Import PDF" accessibilityHint={importBlock ?? undefined}>
          {pdfImporting ? <ActivityIndicator size="small" color={themeColors.text} /> : <FileText size={15} color={themeColors.text} strokeWidth={1.75} />}
          <Text style={styles.ghostBtnText}>{pdfImporting ? 'Working' : 'PDF'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleImport} style={[styles.primaryBtn, importBlock ? { opacity: 0.5 } : null]} disabled={importing || pdfImporting} accessibilityRole="button" accessibilityLabel="Add a plan image" accessibilityHint={importBlock ?? undefined}>
          {importing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Plus size={16} color="#FFFFFF" strokeWidth={1.75} />}
          <Text style={styles.primaryBtnText}>{importing ? 'Opening' : 'Image'}</Text>
        </TouchableOpacity>
      </View>

      {/* A failed role read on a collaborator's job: every write control
          says "tap Try again" — this is the Try again. */}
      {seatRole === null && roleState.isError ? (
        <View style={styles.statusBar} testID="plans-role-banner">
          <Text style={[styles.statusBarText, { flex: 1 }]}>Couldn&apos;t check your role on this job, so adding and deleting sheets is off.</Text>
          <Button label="Try again" variant="secondary" size="sm" onPress={roleState.refetch} testID="plans-role-banner-retry" />
        </View>
      ) : null}

      {pdfImporting && pdfStatus ? (
        <View style={styles.statusBar}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.statusBarText}>{pdfStatus}</Text>
        </View>
      ) : null}

      {/* Takeoff quota badge — shows the user's current month usage so
          they can budget how many pages to upload before they pick a
          file. Tapping the upgrade pill (when over cap) routes to the
          paywall. Always visible above the sheet list. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <TakeoffQuotaBadge variant="inline" onUpgrade={() => router.push('/paywall' as never)} />
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={plansRefreshing} onRefresh={() => { void onRefreshPlans(); }} tintColor={themeColors.textMuted} />}
      >
        {sheets.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileImage size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No plan sheets yet</Text>
            <Text style={styles.emptyText}>{importBlock && seatRole !== null ? importBlock : 'Import a multi-page PDF and we\'ll convert each sheet automatically, or pick a single image (PNG/JPG).'}</Text>
            <View style={styles.emptyBtnRow}>
              <TouchableOpacity onPress={handleImportPdf} style={[styles.primaryBtn, importBlock ? { opacity: 0.5 } : null]} disabled={pdfImporting || importing} accessibilityHint={importBlock ?? undefined}>
                {pdfImporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <FileText size={16} color="#FFFFFF" strokeWidth={1.75} />}
                <Text style={styles.primaryBtnText}>{pdfImporting ? 'Working' : 'Import PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleImport} style={[styles.ghostBtn, importBlock ? { opacity: 0.5 } : null]} disabled={importing || pdfImporting} accessibilityHint={importBlock ?? undefined}>
                {importing ? <ActivityIndicator size="small" color={themeColors.text} /> : <ImageIcon size={15} color={themeColors.text} strokeWidth={1.75} />}
                <Text style={styles.ghostBtnText}>{importing ? 'Opening' : 'Import image'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.helperText}>
              PDFs are rendered server-side at 144 DPI — high enough to read sheet titles on a phone, light enough to scroll without lag. Up to 50 pages per upload.
            </Text>
          </View>
        ) : (
          sheets.map((s) => {
            const pinCount = getPinsForPlan(s.id).length;
            // 'device-only' / 'missing' = the image never reached storage
            // (Import image before 2026-09-17). Said out loud, with the fix.
            const imageState = planSheetImageState(s);
            const repairing = repairingId === s.id;
            const prev = s.previousSheetId ? allSheets.find(x => x.id === s.previousSheetId) : undefined;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.sheetCard, s.superseded && styles.sheetCardSuperseded]}
                onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: s.id } as never })}
                activeOpacity={0.7}
                testID={s.superseded ? `sheet-row-superseded-${s.id}` : undefined}
              >
                <View style={[styles.sheetThumbWrap, s.superseded && styles.sheetThumbWrapSuperseded]}>
                  {imageState === 'missing' ? (
                    <FileImage size={22} color={themeColors.textMuted} strokeWidth={1.75} />
                  ) : (
                    // #80: the day pack's on-device file first, so the list
                    // shows today's sheets with no signal too.
                    <Image source={{ uri: sheetUri(s) }} style={styles.sheetThumb} resizeMode="cover" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.sheetTagRow}>
                    {s.sheetNumber ? (
                      <Text style={[styles.sheetNumber, s.superseded && styles.sheetNumberSuperseded]}>{s.sheetNumber}</Text>
                    ) : null}
                    {/* Unconditional on `superseded` — NOT gated on revision.
                        The original copy of a re-uploaded sheet is Rev 1, so a
                        revision-gated badge left the single most dangerous row
                        in the list (the old one everyone already has printed)
                        completely unmarked. */}
                    {s.superseded ? (
                      <View style={styles.supersededBadge}>
                        <AlertTriangle size={10} color={themeColors.warningLabel} strokeWidth={2.5} />
                        <Text style={styles.supersededBadgeText}>Superseded</Text>
                      </View>
                    ) : null}
                    {s.revision && s.revision > 1 ? (
                      <View style={[styles.revPill, s.superseded && { backgroundColor: themeColors.surfaceAlt }]}>
                        <Text style={[styles.revPillText, s.superseded && { color: themeColors.textMuted }]}>
                          Rev {s.revision}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.sheetName, s.superseded && styles.sheetNameSuperseded]} numberOfLines={2}>{s.name}</Text>
                  {s.superseded ? (
                    <Text style={styles.supersededNote}>Replaced by a newer revision — do not build from it.</Text>
                  ) : null}
                  {imageState !== 'durable' ? (
                    <View style={styles.imageIssueRow}>
                      <Text style={styles.imageIssueText} numberOfLines={2}>
                        {imageState === 'missing'
                          ? 'No image saved \u2014 this plan is blank on every device.'
                          : 'Image is on this phone only \u2014 blank everywhere else.'}
                      </Text>
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); void handleRepairImage(s); }}
                        style={styles.ghostBtn}
                        disabled={repairing || !!repairingId}
                        accessibilityRole="button"
                        accessibilityLabel={imageState === 'missing' ? `Add the image for ${s.name}` : `Upload the image for ${s.name}`}
                        accessibilityState={{ disabled: repairing || !!repairingId, busy: repairing }}
                        testID={`sheet-repair-image-${s.id}`}
                      >
                        {repairing
                          ? <ActivityIndicator size="small" color={themeColors.text} />
                          : <Upload size={14} color={themeColors.text} strokeWidth={1.75} />}
                        <Text style={styles.ghostBtnText}>
                          {repairing ? 'Saving' : imageState === 'missing' ? 'Add image' : 'Upload'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <View style={styles.sheetMetaRow}>
                    <View style={styles.metaPill}>
                      <MapPin size={11} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.metaPillText}>{pinCount} {pinCount === 1 ? 'pin' : 'pins'}</Text>
                    </View>
                    <Text style={styles.sheetDate}>{new Date(s.updatedAt).toLocaleDateString()}</Text>
                  </View>
                  {/* #76: a revision already in the set compares with the one
                      it replaced — no upload, nothing filed twice. */}
                  {prev ? (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        if (compareBlock) { showAlert('Compare not available', compareBlock); return; }
                        router.push({ pathname: '/compare-drawings' as never, params: { projectId: s.projectId, oldSheetId: prev.id, newSheetId: s.id } as never });
                      }}
                      accessibilityHint={compareBlock ?? undefined}
                      style={[styles.ghostBtn, { alignSelf: 'flex-start', marginTop: 8 }, compareBlock ? { opacity: 0.5 } : null]}
                      accessibilityRole="button"
                      accessibilityLabel={`Compare ${s.sheetNumber || s.name} with revision ${prev.revision ?? 1}`}
                      testID={`sheet-compare-prev-${s.id}`}
                    >
                      <Layers size={14} color={themeColors.text} strokeWidth={1.75} />
                      <Text style={styles.ghostBtnText}>Compare with Rev {prev.revision ?? 1}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(s); }} style={[styles.iconBtn, deleteBlockFor(s) ? { opacity: 0.4 } : null]} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete" accessibilityHint={deleteBlockFor(s) ?? undefined} testID={`plans-delete-${s.id}`}>
                  <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            );
          })
        )}

        {/* Toggle to bring superseded revisions back into view. Only
            renders when there's something to toggle. */}
        {supersededCount > 0 && (
          <TouchableOpacity
            onPress={() => setShowSuperseded(v => !v)}
            style={styles.supersededToggle}
            activeOpacity={0.7}
          >
            <Text style={styles.supersededToggleText}>
              {showSuperseded
                ? `Hide ${supersededCount} superseded revision${supersededCount === 1 ? '' : 's'}`
                : `Show ${supersededCount} superseded revision${supersededCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        )}

        {sheets.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              if (compareBlock) { showAlert('Compare not available', compareBlock); return; }
              router.push({ pathname: '/compare-drawings' as never, params: { projectId: projectId ?? '' } as never });
            }}
            activeOpacity={0.85}
            style={[styles.compareBtn, compareBlock ? { opacity: 0.5 } : null]}
            accessibilityHint={compareBlock ?? undefined}
            testID="compare-drawings-cta"
          >
            <MageAIMark size={16} color={themeColors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compareBtnTitle}>AI compare to revision</Text>
              <Text style={styles.compareBtnSub}>Pick a sheet + upload its new rev (PDF page or image) — AI flags every change</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        )}

        {/* Ask Your Plans (#163) — opens the Ask box right here, over this
            job's current sheets. It used to push Plan Intelligence, the
            room-estimating screen (gated Pro, while Ask is Business), where
            tapping a sheet started a metered AI estimate. The panel carries
            its own Business gate and upgrade button. Always shown so a
            first-time user knows it exists before uploading sheets. */}
        <TouchableOpacity
          onPress={() => setAskOpen(true)}
          activeOpacity={0.85}
          style={[styles.compareBtn, { marginTop: 8 }]}
          testID="plans-ask-cta"
        >
          <MageAIMark size={16} color={themeColors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.compareBtnTitle}>Ask your plans</Text>
            <Text style={styles.compareBtnSub}>Ask anything in plain English — MAGE finds it in the sheets</Text>
          </View>
          <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>

        {/* Plan Intelligence is the ESTIMATING tool — labelled as such, so a
            tap on a sheet there is understood to start an AI room estimate. */}
        {sheets.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              if (estimateBlock) { showAlert('Estimate not available', estimateBlock); return; }
              router.push({ pathname: '/plan-intelligence' as never, params: { projectId: projectId ?? '' } as never });
            }}
            activeOpacity={0.85}
            style={[styles.compareBtn, { marginTop: 8 }, estimateBlock ? { opacity: 0.5 } : null]}
            accessibilityHint={estimateBlock ?? undefined}
            testID="plans-estimate-cta"
          >
            <MageAIMark size={16} color={themeColors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compareBtnTitle}>Estimate rooms from a sheet</Text>
              <Text style={styles.compareBtnSub}>AI reads a floor plan and prices it room by room — uses your AI allowance</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* #163: the Ask-only destination. The panel gets every sheet; it
          searches, indexes and cites only the current (non-superseded) ones. */}
      <Modal visible={askOpen} transparent animationType="slide" onRequestClose={() => setAskOpen(false)}>
        {/* The question box is the panel's first field and sits low in a
            bottom sheet; an RN Modal does not resize for the iOS keyboard, so
            without this the keyboard covers the box he is typing into. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          testID="plans-ask-keyboard"
        >
          {/* maxHeight + a shrinking ScrollView: with the keyboard up the
              space left is ~470pt on a small iPhone, and the sheet must shrink
              into it (keeping the header and question box on screen) rather
              than push its top off the screen. */}
          <View style={[styles.modalCard, { maxHeight: '92%' }]} testID="plans-ask-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ask your plans</Text>
              <TouchableOpacity onPress={() => setAskOpen(false)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 520, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              <AskPlansPanel projectId={project.id} sheets={allSheets} onUpgrade={() => { setAskOpen(false); router.push('/paywall' as never); }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New-sheet naming modal */}
      <Modal visible={!!newSheet} transparent animationType="slide" onRequestClose={() => setNewSheet(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New sheet</Text>
              <TouchableOpacity onPress={() => setNewSheet(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {newSheet?.image.uri ? (
              <Image source={{ uri: newSheet.image.uri }} style={styles.previewImg} resizeMode="contain" />
            ) : null}
            <Text style={styles.label}>Sheet number</Text>
            <TextInput
              value={newSheet?.sheetNumber ?? ''}
              onChangeText={(t) => setNewSheet((d) => d ? { ...d, sheetNumber: t } : d)}
              placeholder="A-101"
              style={styles.input}
              autoCapitalize="characters"
            />
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={newSheet?.name ?? ''}
              onChangeText={(t) => setNewSheet((d) => d ? { ...d, name: t } : d)}
              placeholder="Floor Plan — Level 1"
              style={styles.input}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, savingSheet && { opacity: 0.6 }]}
              onPress={() => { void confirmImport(); }}
              disabled={savingSheet}
              accessibilityRole="button"
              accessibilityState={{ disabled: savingSheet, busy: savingSheet }}
              testID="plans-new-sheet-save"
            >
              {savingSheet ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Check size={16} color="#FFFFFF" strokeWidth={1.75} />}
              <Text style={styles.primaryBtnText}>{savingSheet ? 'Uploading plan' : 'Save & open'}</Text>
            </TouchableOpacity>
            {savingSheet ? (
              <Text style={styles.helperText}>The plan uploads once so every phone and the office can see it.</Text>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* #75: title-block numbers, confirmed before anything is written. A
          misread number would supersede the wrong sheet, so each one is shown
          as what it is — a reading — and he ticks the ones to use. */}
      <Modal visible={!!titleReview} transparent animationType="slide" onRequestClose={() => setTitleReview(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sheet numbers from the title blocks</Text>
              <TouchableOpacity onPress={() => setTitleReview(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.helperText}>Read by AI — check each against the sheet. Only the ticked ones are saved.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {titleReview?.items.map((item) => (
                <TouchableOpacity
                  key={item.sheetId}
                  style={styles.pickerRow}
                  onPress={() => setTitleReview(r => r ? { ...r, items: r.items.map(i => i.sheetId === item.sheetId ? { ...i, use: !i.use } : i) } : r)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.use }}
                  testID={`title-number-${item.sheetId}`}
                >
                  {item.use
                    ? <CheckSquare size={16} color={themeColors.accent} strokeWidth={1.75} />
                    : <Square size={16} color={themeColors.textMuted} strokeWidth={1.75} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerRowTitle}>Title block reads {item.sheetNumber} — use it?</Text>
                    <Text style={styles.pickerRowSub} numberOfLines={1}>
                      {item.label}{item.duplicate ? ` \u00B7 another page also reads ${item.sheetNumber}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {titleReview?.note ? <Text style={styles.helperText}>{titleReview.note}</Text> : null}
            {(() => {
              const n = titleReview?.items.filter(i => i.use).length ?? 0;
              return (
                <TouchableOpacity
                  style={[styles.primaryBtn, n === 0 && { opacity: 0.5 }]}
                  onPress={applyTitleNumbers}
                  disabled={n === 0}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: n === 0 }}
                  testID="title-numbers-apply"
                >
                  <Check size={16} color="#FFFFFF" strokeWidth={1.75} />
                  <Text style={styles.primaryBtnText}>{n === 0 ? 'Tick a number to use it' : `Use ${n} number${n === 1 ? '' : 's'}`}</Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Project picker when launched without a projectId

function PlansProjectPicker({ projects, onPick, onBack }: {
  projects: { id: string; name: string; status?: string }[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Pick a project</Text>
        </View>
      </View>
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <ImageIcon size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyText}>Plans attach to a project so every pin (punch items, photos, RFIs) ties back to a job. Create a project first, then come back here to import drawings.</Text>
            <TouchableOpacity onPress={onBack} style={[styles.primaryBtn, { marginTop: 12 }]}>
              <Text style={styles.primaryBtnText}>Open Projects</Text>
            </TouchableOpacity>
          </View>
        ) : (
          projects.map(p => (
            <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => onPick(p.id)}>
              <ImageIcon size={14} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerRowTitle}>{p.name}</Text>
                {p.status && <Text style={styles.pickerRowSub}>{p.status}</Text>}
              </View>
              <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** #73: the three non-paywall states of the gate — checking, retry, no access. */
function PlansAccessGate({ gate, projectName, onRetry, onBack, insets }: {
  gate: 'loading' | 'error' | 'no_access' | 'open' | 'locked';
  projectName: string;
  onRetry: () => void;
  onBack: () => void;
  insets: { top: number };
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>{projectName}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Plans</Text>
        </View>
      </View>
      <View style={{ padding: 24 }} testID={`plans-gate-${gate}`}>
        <View style={styles.emptyCard}>
          {gate === 'loading' ? (
            <ActivityIndicator size="small" color={themeColors.accent} />
          ) : gate === 'error' ? (
            <>
              <Text style={styles.emptyText}>Couldn&apos;t check your access to this job. Check your connection and try again.</Text>
              <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} testID="plans-role-retry" />
            </>
          ) : (
            <Text style={styles.emptyText}>You don&apos;t have access to this project&apos;s plans. Ask the project owner to invite you.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function PaywallView({ onUpgrade, onBack, insets }: { onUpgrade: () => void; onBack: () => void; insets: { top: number } }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Pro feature</Text>
        </View>
      </View>
      <View style={{ padding: 24 }}>
        <View style={styles.emptyCard}>
          <FileImage size={28} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.emptyTitle}>Plan markup is a Pro feature</Text>
          <Text style={styles.emptyText}>Upgrade to Pro to import drawings, drop pins tied to photos and punch items, and annotate sheets with the crew.</Text>
          <TouchableOpacity onPress={onUpgrade} style={[styles.primaryBtn, { marginTop: 14 }]}>
            <Text style={styles.primaryBtnText}>See plans</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: t.surface, borderBottomColor: t.line, borderBottomWidth: 1,
  },
  headerBtn: { padding: 6, borderRadius: Tokens.radius.sm },
  headerEyebrow: { color: t.textSecondary, fontSize: Type.caption2.fontSize, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.accentFill, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: Type.footnote.fontSize, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 12, paddingVertical: 9, borderRadius: Tokens.radius.md,
    borderColor: t.line, borderWidth: 1,
  },
  ghostBtnText: { color: t.text, fontSize: Type.footnote.fontSize, fontWeight: '600' },

  emptyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: t.surfaceAlt, borderBottomColor: t.line, borderBottomWidth: 1,
  },
  statusBarText: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.lg,
    borderColor: t.line, borderWidth: 1, marginBottom: 10,
  },
  // Superseded rows are deliberately loud AND dimmed: amber edge so the eye
  // catches them mid-scroll, muted content so they never read as the live
  // sheet. A GC scrolling fast must not be able to mistake one for current.
  sheetCardSuperseded: {
    backgroundColor: t.warningSoft,
    borderColor: t.warningLabel + '55',
    borderLeftWidth: 3, borderLeftColor: t.warningLabel,
  },
  sheetThumbWrap: {
    width: 72, height: 72, borderRadius: Tokens.radius.md, overflow: 'hidden',
    backgroundColor: t.surfaceAlt, justifyContent: 'center', alignItems: 'center',
  },
  sheetThumbWrapSuperseded: { opacity: 0.45 },
  sheetThumb: { width: '100%', height: '100%' },
  sheetTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sheetNumber: { color: t.accent, fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 0.4 },
  sheetNumberSuperseded: { color: t.textMuted },
  supersededBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.warningSoft,
    borderWidth: 1, borderColor: t.warningLabel + '66',
  },
  supersededBadgeText: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.warningLabel,
    letterSpacing: 0.3, textTransform: 'uppercase' as const,
  },
  supersededNote: {
    color: t.warningLabel, fontSize: Type.caption2.fontSize, fontWeight: '600' as const,
    marginTop: 3,
  },
  sheetNameSuperseded: { color: t.textSecondary },
  revPill: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: t.accent + '14',
  },
  revPillText: {
    fontSize: 9, fontWeight: '700' as const, color: t.accent,
    letterSpacing: 0.3, textTransform: 'uppercase' as const,
  },
  supersededToggle: {
    paddingVertical: 10, paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  supersededToggleText: {
    fontSize: Type.caption1.fontSize, color: t.textSecondary,
    fontWeight: '600' as const,
  },
  sheetName: { color: t.text, fontSize: Type.subhead.fontSize, fontWeight: '600', marginTop: 2 },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  metaPillText: { color: t.text, fontSize: Type.caption2.fontSize, fontWeight: '600' },
  sheetDate: { color: t.textMuted, fontSize: Type.caption2.fontSize },
  imageIssueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  imageIssueText: { flex: 1, color: t.warningLabel, fontSize: Type.caption2.fontSize, fontWeight: '600' },
  iconBtn: { padding: 6, borderRadius: Tokens.radius.sm },

  emptyCard: {
    backgroundColor: t.surface, padding: 24, borderRadius: Tokens.radius.lg, alignItems: 'center',
    borderColor: t.line, borderWidth: 1, gap: 6,
  },
  emptyTitle: { color: t.text, fontSize: Type.callout.fontSize, fontWeight: '700', marginTop: 8 },
  emptyText: { color: t.textSecondary, fontSize: Type.footnote.fontSize, textAlign: 'center', lineHeight: 19 },
  helperText: { color: t.textMuted, fontSize: Type.caption2.fontSize, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.md,
    borderColor: t.line, borderWidth: 1, marginBottom: 8,
  },
  pickerRowTitle: { color: t.text, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' },
  pickerRowSub: { color: t.textSecondary, fontSize: Type.caption1.fontSize, marginTop: 2 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: 8,
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: Tokens.radius.panel, marginBottom: 20 } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: t.text, fontSize: Type.callout.fontSize, fontWeight: '700' },
  previewImg: { width: '100%', height: 180, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, marginBottom: 8 },
  label: { color: t.textSecondary, fontSize: Type.caption1.fontSize, fontWeight: '600', marginTop: 4 },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10,
    color: t.text, fontSize: Type.bodyCompact.fontSize, borderColor: t.line, borderWidth: 1,
  },

  compareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 16, padding: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '30',
  },
  compareBtnTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  compareBtnSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
});

