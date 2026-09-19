// AI Drawing Comparison — pick a current sheet + a new revision PDF/image
// and AI returns a structured diff: scope added, scope removed, dimensions
// changed, notes revised, plus suggested actions (CO / RFI / nothing).
//
// The headline win: a typical revision drop from the architect is 200+
// pages with no changelog. Walking each sheet manually takes hours and
// misses things, which becomes scope creep that goes unbilled. AI does
// it in under a minute per sheet pair.
//
// Pairs with supabase/functions/compare-drawings.
//
// Audit round 2 (#20): the review step used to end at "Done", which threw the
// whole comparison away — the revision was never added to the plan set (so the
// superseded sheet stayed "current" in the field), the drafted RFIs vanished,
// and every flagged change had to be retyped into the CO screen from memory.
// The review now files the revision (addPlanSheet chains it and marks the old
// copy superseded), creates each RFI against the sheet, and starts a change
// order prefilled with the change and the drawing it came from.
//
// Wave 3 (plans-revisions):
//   #76 A re-issued SET is the normal case, so the revision can be a chosen
//       page of a multi-page PDF (startPage), or a sheet ALREADY in the plan set
//       (oldSheetId/newSheetId from the viewer and the Plans list) — which is
//       then "already in the set", never filed a second time.
//   #75 An unnumbered old sheet takes its number inline; the paid comparison is
//       kept while he types it, so filing needs no second render or compare.
//   #160 A JPG/PNG revision is uploaded like a Plans image and compared by path.
//   #165 The AI limit is checked BEFORE anything is rendered or billed, and a
//       failed compare reuses its render when he picks the same file again.
//   #166 A created RFI opens (to assign and send), and every change can raise one.

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, TextInput, ActivityIndicator,
} from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import CraneLoader from '@/components/CraneLoader';
import { CONSTRUCTION_FACTS } from '@/utils/constructionFacts';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  FileText, AlertCircle, Plus, Minus, Pencil, Info,
  ArrowUpRight, Layers, Check, FilePlus2, MessageSquarePlus,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import {
  compareDrawings, type CompareDrawingsResult, type ChangeType, type ChangeImpact,
} from '@/utils/compareDrawings';
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import { edgeErrorCode } from '@/utils/edgeError';
import {
  currentSheetsForCompare, revisionFiling, changeOrderPrefill, rfiFromCandidate, rfiFromChange, sheetCitation,
  planRenumber, chainColumnsPatch, planControlBlock, effectivePlanRole,
} from '@/utils/plans/revisionActions';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import {
  precheckFloorPlanImage, classifyFloorPlanFailure, floorPlanFailureReason, type FloorPlanFailure,
} from '@/utils/planSheetImageCore';
import { uploadPlanSheetImage, PlanSheetUploadNotConfiguredError } from '@/utils/planSheetImageUpload';
import { resolvePlanSheetUrl } from '@/utils/planSheetUrls';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface, Button } from '@/components/ui';
import type { PlanSheet } from '@/types';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { showAlert } from '@/utils/alert';

type Step = 'pickOld' | 'pickNew' | 'analyzing' | 'review';

type PickedAsset = DocumentPicker.DocumentPickerAsset;
/** What gets rendered/uploaded for the NEW side of an upload compare. */
type RevisionSource =
  | { kind: 'pdf'; asset: PickedAsset; page: number; pageCount: number | null }
  | { kind: 'image'; asset: PickedAsset };
/** The last render, so a retry of the SAME file does not render (and bill a
 *  takeoff page) again (#165). Keyed on name + size + page, not the uri: the
 *  native picker copies to a fresh cache path on every pick. */
interface RenderedRevision { key: string; url: string; path: string; width: number | null; height: number | null }

const isPdfAsset = (a: PickedAsset) => (a.mimeType ?? '').includes('pdf') || /\.pdf$/i.test(a.name ?? '');
const renderKey = (src: RevisionSource) =>
  `${src.kind}|${src.asset.name ?? ''}|${src.asset.size ?? ''}|${src.kind === 'pdf' ? src.page : 0}`;
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

/** Natural size of a local image — the overlay and the filed sheet use it. */
function localImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    try {
      Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export default function CompareDrawingsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; oldSheetId?: string; newSheetId?: string }>();
  const paramProjectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  const {
    projects, getProject, getPlanSheetsForProject, addPlanSheet, updatePlanSheet, addRFI, getChangeOrdersForProject,
  } = useProjects();
  const { tier } = useSubscription();
  const { user: authUser } = useAuth();
  // Web react-query pauses the role read offline (neither loading nor
  // errored); that is "check your connection", not "no access".
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  // Same gate the plan viewer uses before it writes chain columns.
  const canSyncSheets = !!authUser?.id && isSupabaseConfigured;

  // Opened without params (Tools hub, search): land on a project picker
  // instead of the old flat "Project not found." dead end (sim-audit #5).
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? null;
  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);
  // #73: a field or viewer seat can now open Plans; Compare files a new
  // revision into the GC's set, so it stays with the owner and editors.
  const roleState = useProjectRoleState(projectId ?? undefined);
  const allSheets = useMemo(() => projectId ? getPlanSheetsForProject(projectId) : [], [projectId, getPlanSheetsForProject]);
  // A superseded revision is not "the sheet currently in the field" — offering
  // it as the comparison base is how a diff gets run against a dead drawing.
  const planSheets = useMemo(() => currentSheetsForCompare(allSheets), [allSheets]);

  const [step, setStep] = useState<Step>('pickOld');
  const [error, setError] = useState<string | null>(null);
  // The PICK is a snapshot; the sheet itself is re-read from allSheets on every
  // render, so a number typed inline (#75) or a chain change made elsewhere is
  // what filing sees — without that the paid result would still be blocked.
  const [oldPick, setOldPick] = useState<PlanSheet | null>(null);
  const oldSheet = useMemo(
    () => (oldPick ? allSheets.find(s => s.id === oldPick.id) ?? oldPick : null),
    [oldPick, allSheets],
  );
  // #76: the "new" side can be a sheet already in the plan set. Resolved from
  // allSheets (NOT planSheets, which has already hidden the superseded copy).
  const [pairNewId, setPairNewId] = useState<string | null>(null);
  const pairNew = useMemo(
    () => (pairNewId ? allSheets.find(s => s.id === pairNewId) ?? null : null),
    [pairNewId, allSheets],
  );
  const [newPageUrl, setNewPageUrl] = useState<string | null>(null);
  const [newPageLabel, setNewPageLabel] = useState<string | null>(null);
  const [result, setResult] = useState<CompareDrawingsResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [newPagePath, setNewPagePath] = useState('');
  const [newPageSize, setNewPageSize] = useState<{ width: number; height: number } | null>(null);
  // What this comparison has already committed — so a second tap can't file the
  // same revision twice or raise the same RFI twice, and the button can say so.
  const [filed, setFiled] = useState<{ sheetId: string; revision: number } | null>(null);
  // id AND number: the done row opens the RFI (#166), it is not dead text.
  const [rfiByIndex, setRfiByIndex] = useState<Record<number, { id: string; number: number }>>({});
  // RFIs raised from a flagged CHANGE, keyed by change index — a separate map
  // so it never collides with the drafted-question indices above.
  const [changeRfi, setChangeRfi] = useState<Record<number, { id: string; number: number }>>({});
  // A multi-page PDF waits here while he says which page is the sheet (#76).
  const [pendingPdf, setPendingPdf] = useState<{ asset: PickedAsset; pageCount: number | null } | null>(null);
  const [pageDraft, setPageDraft] = useState('1');
  const renderCache = useRef<RenderedRevision | null>(null);
  // #75 inline sheet number.
  const [numberDraft, setNumberDraft] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);

  // Deep link from the viewer's revision banner or a Plans row (#76): both
  // sheets are in the set, so land straight on the confirm step. Applied once —
  // a later sheet refetch must not yank him back from wherever he went.
  const appliedPairParams = useRef(false);
  useEffect(() => {
    if (appliedPairParams.current) return;
    const oldId = typeof params.oldSheetId === 'string' ? params.oldSheetId : '';
    const newId = typeof params.newSheetId === 'string' ? params.newSheetId : '';
    if (!oldId || !newId || allSheets.length === 0) return;
    const o = allSheets.find(s => s.id === oldId);
    const n = allSheets.find(s => s.id === newId);
    if (!o || !n || o.id === n.id) return;
    appliedPairParams.current = true;
    setOldPick(o);
    setPairNewId(n.id);
    setStep('pickNew');
  }, [params.oldSheetId, params.newSheetId, allSheets]);

  const resetComparison = useCallback(() => {
    setError(null);
    setResult(null);
    setNewPagePath('');
    setNewPageSize(null);
    setFiled(null);
    setRfiByIndex({});
    setChangeRfi({});
    setNumberDraft('');
    setNumberError(null);
  }, []);

  // ── Pick the OLD sheet — from the project's existing plan sheets ──
  const handlePickOld = useCallback((sheet: PlanSheet) => {
    setOldPick(sheet);
    setPairNewId(null);
    setPendingPdf(null);
    // A different base is a different comparison: drop the kept render.
    renderCache.current = null;
    setStep('pickNew');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // The drawingAnalysis limit, checked BEFORE anything is rendered, uploaded or
  // billed (#165). It is local and free; a refusal used to arrive only after
  // convert-pdf-to-images had charged a takeoff page — and a free user got the
  // render's raw tier error instead of the upgrade prompt.
  const limitAllows = useCallback(async (): Promise<boolean> => {
    const limit = await checkAILimit(tier, 'smart', 'drawingAnalysis');
    if (limit.allowed) return true;
    showAILimitAlert({ limit, router, monthly: true });
    return false;
  }, [tier, router]);

  // ── Pick the NEW revision — a PDF (any page of it) or a JPG/PNG ───
  const handlePickNew = useCallback(async () => {
    if (!project || !oldSheet) return;
    resetComparison();
    setPendingPdf(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (!(await limitAllows())) return;

      if (isPdfAsset(asset)) {
        // A re-issued SET is the normal case: ask which page is this sheet
        // instead of diffing its cover page against A-201. Only the chosen
        // page is rendered.
        const pageCount = await countPdfPages(asset.uri);
        if (pageCount === null || pageCount > 1) {
          setPendingPdf({ asset, pageCount });
          setPageDraft('1');
          return;
        }
        await runCompareRef.current({ kind: 'pdf', asset, page: 1, pageCount });
        return;
      }
      await runCompareRef.current({ kind: 'image', asset });
    } catch (e) {
      console.warn('[compare-drawings] pick failed', e);
      setError(String((e as Error).message ?? e));
      setStep('pickNew');
    }
  }, [project, oldSheet, resetComparison, limitAllows]);

  // Render (or upload) the revision, then run the compare.
  const runCompare = useCallback(async (src: RevisionSource) => {
    if (!project || !oldSheet) return;
    setError(null);
    // Checked again here: the page picker can sit open a while.
    if (!(await limitAllows())) return;
    const key = renderKey(src);
    const label = src.kind === 'pdf' && (src.pageCount === null || src.pageCount > 1)
      ? `${src.asset.name} · page ${src.page}`
      : src.asset.name;
    setNewPageLabel(label);
    try {
      let rendered = renderCache.current?.key === key ? renderCache.current : null;
      if (!rendered) {
        setStep('analyzing');
        if (src.kind === 'pdf') {
          // DB-F11: the NEW page is freshly rendered, so we know its storage
          // path and the function downloads it with the service role.
          const pages = await uploadAndRenderPdf({
            fileUri: src.asset.uri,
            projectId: project.id,
            fileName: src.asset.name,
            dpi: 150,
            maxPages: 1,
            startPage: src.page,
          });
          if (!pages[0]) throw new Error('Could not render the PDF page.');
          rendered = { key, url: pages[0].viewUrl, path: pages[0].storagePath, width: pages[0].width, height: pages[0].height };
        } else {
          // #160: a JPG/PNG goes into plan-sheets exactly like a Plans image
          // import (same precheck, same bucket path), and is compared by path.
          const image = {
            uri: src.asset.uri,
            mimeType: src.asset.mimeType ?? null,
            fileName: src.asset.name ?? null,
            fileSize: typeof src.asset.size === 'number' ? src.asset.size : null,
          };
          const pre = precheckFloorPlanImage(project.id, image);
          if (!pre.ok) throw new Error(floorPlanFailureReason(pre.kind, pre.detail));
          let path: string;
          try {
            path = await uploadPlanSheetImage(project.id, image, pre);
          } catch (err) {
            if (err instanceof PlanSheetUploadNotConfiguredError) throw new Error(floorPlanFailureReason('not-configured'));
            const outcome = classifyFloorPlanFailure(err);
            const kind: FloorPlanFailure = outcome === 'already-uploaded' || outcome === 'success' ? 'retryable' : outcome;
            throw new Error(floorPlanFailureReason(kind, kind === 'terminal' || kind === 'retryable' ? (err as Error)?.message : undefined));
          }
          // A signed URL to show it (and to file it with); the local file
          // renders if signing is refused. Never the local uri on the wire.
          const signed = await resolvePlanSheetUrl(path);
          const size = await localImageSize(src.asset.uri);
          rendered = {
            key,
            url: isHttpUrl(signed) ? signed : src.asset.uri,
            path,
            width: size?.width ?? null,
            height: size?.height ?? null,
          };
        }
        renderCache.current = rendered;
      }
      setNewPagePath(rendered.path);
      setNewPageSize(rendered.width && rendered.height ? { width: rendered.width, height: rendered.height } : null);
      setNewPageUrl(rendered.url);
      setStep('analyzing');
      const { result: r, modelUsed: m } = await compareDrawings({
        // The OLD sheet comes out of a plan_sheets row. `storagePath` is set by
        // planSheetRowUris ONLY when the key is project-scoped, so a legacy row
        // under the shared `tmp/` prefix deliberately arrives with none and
        // takes the URL fallback — the path would recover fine but no policy can
        // admit it and planSheetBytes refuses it, which would turn a comparison
        // that works today into a 403.
        oldPagePath: oldSheet.storagePath,
        newPagePath: rendered.path || undefined,
        oldPageUrl: oldSheet.imageUri,
        newPageUrl: isHttpUrl(rendered.url) ? rendered.url : '',
        sheetNumber: oldSheet.sheetNumber || oldSheet.name,
        projectName: project.name,
      });
      await recordAIUsage('smart', 'drawingAnalysis');
      renderCache.current = null;
      setPendingPdf(null);
      setResult(r);
      setModelUsed(m);
      setStep('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[compare-drawings] failed', e);
      // The function's own sentence (edgeError) — a page past the end keeps
      // the page picker open with the real page count in the reason.
      setError(String((e as Error).message ?? e));
      if (src.kind === 'pdf' && edgeErrorCode(e) === 'start_page_past_end') {
        setPendingPdf({ asset: src.asset, pageCount: src.pageCount });
      }
      setStep('pickNew');
    }
  }, [project, oldSheet, limitAllows]);
  // handlePickNew is declared first (the pick decides what runs); the ref keeps
  // it on the latest runCompare without a declaration-order dependency.
  const runCompareRef = useRef(runCompare);
  runCompareRef.current = runCompare;

  const pageChoice = useMemo(() => {
    const n = Number(pageDraft.trim());
    const max = pendingPdf?.pageCount ?? null;
    if (!Number.isInteger(n) || n < 1) return { page: null, reason: 'Type the page number of this sheet in the PDF.' };
    if (max !== null && n > max) return { page: null, reason: `That PDF has ${max} pages — pick a page from 1 to ${max}.` };
    return { page: n, reason: null };
  }, [pageDraft, pendingPdf]);

  // #76: both sheets are already in the plan set. Nothing is rendered.
  const handleCompareExisting = useCallback(async () => {
    if (!project || !oldSheet || !pairNew) return;
    resetComparison();
    if (!(await limitAllows())) return;
    setNewPageUrl(pairNew.imageUri);
    setNewPageLabel(sheetCitation(pairNew));
    setNewPagePath(pairNew.storagePath ?? '');
    setStep('analyzing');
    try {
      const { result: r, modelUsed: m } = await compareDrawings({
        // Each side sends its storagePath; a legacy `tmp/` row has none and
        // takes the URL fallback, the same rule as the upload path.
        oldPagePath: oldSheet.storagePath,
        newPagePath: pairNew.storagePath,
        oldPageUrl: oldSheet.imageUri,
        newPageUrl: pairNew.imageUri,
        sheetNumber: pairNew.sheetNumber || oldSheet.sheetNumber || oldSheet.name,
        projectName: project.name,
      });
      await recordAIUsage('smart', 'drawingAnalysis');
      setResult(r);
      setModelUsed(m);
      setStep('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[compare-drawings] failed', e);
      setError(String((e as Error).message ?? e));
      setStep('pickNew');
    }
  }, [project, oldSheet, pairNew, resetComparison, limitAllows]);

  // ── Turn the comparison into records ────────────────────────────────
  // Filing is the one that cannot be recovered later: until the revision is in
  // the plan set, the old sheet is still what the crew opens in the field.
  const filing = oldSheet
    ? revisionFiling({ oldSheet, allSheets, newPath: newPagePath, filedRevision: filed?.revision ?? null, newSheetInSet: pairNew })
    : null;

  const handleFileRevision = useCallback(() => {
    if (!project || !oldSheet || !newPagePath || filed || pairNew) return;
    const fresh = addPlanSheet({
      projectId: project.id,
      // Same name and number as the sheet it replaces: the number is what
      // addPlanSheet chains on (it marks the old copy superseded and sets
      // revision N+1 + previousSheetId).
      name: oldSheet.name,
      sheetNumber: oldSheet.sheetNumber,
      imageUri: newPageUrl ?? '',
      storagePath: newPagePath,
      pageNumber: 1,
      width: newPageSize?.width,
      height: newPageSize?.height,
    });
    setFiled({ sheetId: fresh.id, revision: fresh.revision ?? 1 });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, oldSheet, newPagePath, newPageUrl, newPageSize, filed, pairNew, addPlanSheet]);

  // #75: give the old sheet its number here, through the same planRenumber the
  // viewer uses — chain columns written through the offline queue — so filing
  // re-derives to "ready" on the comparison already paid for.
  const handleSaveNumber = useCallback(() => {
    if (!oldSheet) return;
    const plan = planRenumber(oldSheet, numberDraft, allSheets);
    if (plan.kind === 'invalid') { setNumberError(plan.reason); return; }
    setNumberError(null);
    if (plan.kind === 'noop') return;
    const now = new Date().toISOString();
    for (const p of plan.patches) {
      // updatePlanSheet reads the context's ref, so patches applied in one
      // tick do not overwrite each other.
      updatePlanSheet(p.id, p.updates);
      const chain = chainColumnsPatch(p.updates);
      if (canSyncSheets && chain) void supabaseWrite('plan_sheets', 'update', { id: p.id, ...chain, updated_at: now });
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (plan.message) showAlert('Revision updated', plan.message);
  }, [oldSheet, numberDraft, allSheets, updatePlanSheet, canSyncSheets]);

  // #77: both drawings ride on the RFI (old, then new), so the architect sees
  // what changed instead of a sheet number in text. The new side is the sheet
  // already in the set, or the page just rendered for this comparison.
  const comparedSheetImages = useMemo(
    () => [oldSheet?.imageUri, pairNew ? pairNew.imageUri : newPageUrl],
    [oldSheet?.imageUri, pairNew, newPageUrl],
  );

  const handleCreateRfi = useCallback((index: number) => {
    if (!oldSheet || !result || rfiByIndex[index]) return;
    const candidate = result.rfiCandidates[index];
    if (!candidate) return;
    // In the two-sheets-in-the-set mode the RFI is about the NEW sheet.
    const rfi = addRFI(rfiFromCandidate(candidate, oldSheet, newPageLabel, new Date(), { newSheet: pairNew, sheetImages: comparedSheetImages }));
    setRfiByIndex(prev => ({ ...prev, [index]: { id: rfi.id, number: rfi.number } }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [oldSheet, result, rfiByIndex, newPageLabel, pairNew, addRFI, comparedSheetImages]);

  const handleRaiseChangeRfi = useCallback((index: number) => {
    if (!oldSheet || !result || changeRfi[index]) return;
    const change = result.changes[index];
    if (!change) return;
    const rfi = addRFI(rfiFromChange(change, oldSheet, newPageLabel, new Date(), { newSheet: pairNew, sheetImages: comparedSheetImages }));
    setChangeRfi(prev => ({ ...prev, [index]: { id: rfi.id, number: rfi.number } }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [oldSheet, result, changeRfi, newPageLabel, pairNew, addRFI, comparedSheetImages]);

  // The RFI is created with no addressee on purpose (never guessed) — this is
  // where he adds one and sends it.
  const openRfi = useCallback((rfiId: string) => {
    if (!project) return;
    router.push({ pathname: '/rfi' as never, params: { projectId: project.id, rfiId } as never });
  }, [project, router]);

  // Which changes have a change order in the project that CARRIES this change's
  // text. This used to be a flag set the moment the user tapped through to the
  // CO screen — so backing out of that screen without saving still counted as
  // "saved", and Done then waved through the exact loss the guard exists to
  // prevent. Matching on the real record is the only claim we can make
  // honestly; a `.includes` (not equality) survives the user editing the
  // description in the CO form, which he usually does.
  const projectChangeOrders = useMemo(
    () => (project ? getChangeOrdersForProject(project.id) : []),
    [project, getChangeOrdersForProject],
  );
  const coSaved = useMemo(() => {
    const out: Record<number, { id: string; number: number }> = {};
    if (!result) return out;
    result.changes.forEach((c, i) => {
      const needle = c.description.trim();
      if (!needle) return;
      const hit = projectChangeOrders.find(co => co.description.includes(needle));
      if (hit) out[i] = { id: hit.id, number: hit.number };
    });
    return out;
  }, [result, projectChangeOrders]);

  const handleStartChangeOrder = useCallback((index: number) => {
    if (!project || !oldSheet || !result) return;
    const change = result.changes[index];
    if (!change) return;
    const existing = coSaved[index];
    // Two sheets in the set: the CO cites the NEW revision, compared with the old.
    const prefill = pairNew
      ? changeOrderPrefill(change, pairNew, `compared with ${sheetCitation(oldSheet)}`)
      : changeOrderPrefill(change, oldSheet, newPageLabel);
    router.push({
      pathname: '/change-order' as never,
      // An already-saved change reopens ITS change order rather than prefilling
      // a second one with the same scope.
      params: (existing
        ? { projectId: project.id, coId: existing.id }
        : { projectId: project.id, ...prefill }) as never,
    });
  }, [project, oldSheet, result, newPageLabel, pairNew, router, coSaved]);

  // Nothing here is saved until one of the buttons above is used, so Done asks
  // once rather than discarding a revision drop silently.
  const handleDone = useCallback(() => {
    const savedSomething = !!filed || Object.keys(rfiByIndex).length > 0 || Object.keys(changeRfi).length > 0
      || Object.keys(coSaved).length > 0;
    const foundSomething = (result?.changes.length ?? 0) > 0 || (result?.rfiCandidates.length ?? 0) > 0;
    if (savedSomething || !foundSomething) { router.back(); return; }
    showAlert(
      'Nothing from this comparison is saved',
      'File the revision, create an RFI, or start a change order first — leaving now discards what the comparison found.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => router.back() },
      ],
      { cancelable: true },
    );
  }, [filed, rfiByIndex, changeRfi, coSaved, result, router]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title="Find what changed" />
        <ToolProjectPicker
          toolName="Compare Drawings"
          message="Compare Drawings diffs a new revision against the sheet in the field and flags every scope, dimension, and note change with its likely cost or schedule impact."
          projects={projects}
          onPick={setPickedProjectId}
        />
      </View>
    );
  }

  // The gating contract: a spinner only while the role read is in flight, a
  // retry when it failed (or is paused offline), and a plain reason when this
  // seat may not compare. The job's OWNER (projects.user_id on the local row)
  // is never held on the collaborator read — a blip must not lock him out.
  const seatRole = effectivePlanRole(roleState.role, project, authUser?.id);
  const roleWaiting = seatRole === null && roleState.isLoading;
  const roleFailed = seatRole === null && !roleState.isLoading && (roleState.isError || offline);
  const compareBlock = roleWaiting || roleFailed
    ? null
    : seatRole === null
      ? 'You don\u2019t have access to this project. Ask the project owner to invite you.'
      : planControlBlock(seatRole, 'compare');
  if (roleWaiting || roleFailed || compareBlock) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title={project.name} />
        <View style={[styles.hero, { alignItems: 'flex-start' }]} testID="compare-role-gate">
          {roleWaiting ? (
            <ActivityIndicator size="small" color={themeColors.accent} />
          ) : roleFailed ? (
            <>
              <Text style={styles.heroBody}>Couldn&apos;t check your role on this job. Check your connection and try again.</Text>
              <Button label="Try again" variant="secondary" size="sm" onPress={roleState.refetch} testID="compare-role-retry" />
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>Compare isn&apos;t available on your seat</Text>
              <Text style={styles.heroBody}>{compareBlock}</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  // Full-screen crane + rotating facts during the 30-60s AI compare (was a tiny
  // centered spinner on an otherwise empty screen).
  if (step === 'analyzing') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title={project.name} />
        <CraneLoader label="Comparing sheets" facts={CONSTRUCTION_FACTS} />
      </View>
    );
  }

  const errorBanner = error ? (
    <View style={styles.errorBanner}>
      <AlertCircle size={14} color={themeColors.danger} strokeWidth={1.75} />
      <Text style={styles.errorText}>{error}</Text>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title={project.name} />
      <ScrollView {...fabScroll} style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>

        {/* ── Step 1: pick the OLD sheet ─────────────────────────── */}
        {step === 'pickOld' && (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <MageAIMark size={20} color={themeColors.accent} />
              </View>
              <Text style={styles.heroTitle}>Find what changed</Text>
              <Text style={styles.heroBody}>
                Pick the sheet that&apos;s currently in the field. Then upload the new revision — a PDF (any page of a re-issued set) or a JPG/PNG — and AI will tell you exactly what changed — scope, dimensions, notes — and what each change probably means for cost or schedule.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Pick the current sheet</Text>
            {planSheets.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No plan sheets in this project yet.</Text>
                <Text style={styles.emptyBody}>Add a sheet from the Plans screen first — that&apos;s the &quot;current&quot; reference for the comparison.</Text>
              </View>
            ) : (
              planSheets.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.sheetCard}
                  onPress={() => handlePickOld(s)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: s.imageUri }} style={styles.sheetThumb} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{s.name}</Text>
                    {s.sheetNumber ? <Text style={styles.sheetMeta}>{s.sheetNumber}</Text> : null}
                  </View>
                  <ArrowUpRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ── Step 2: pick the NEW revision ───────────────────────── */}
        {step === 'pickNew' && oldSheet && pairNew && (
          <>
            {/* #76: two revisions already in the plan set. */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Compare two revisions</Text>
              <Text style={styles.heroBody}>
                Both sheets are already in the plan set, so nothing is uploaded or filed. AI compares {sheetCitation(oldSheet)} with {sheetCitation(pairNew)} and flags every change.
              </Text>
            </View>
            <View style={styles.previewRow}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Older</Text>
                <Image source={{ uri: oldSheet.imageUri }} style={styles.previewImg} resizeMode="contain" />
                <Text style={styles.previewName} numberOfLines={1}>{sheetCitation(oldSheet)}{oldSheet.superseded ? ' · superseded' : ''}</Text>
              </View>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Newer</Text>
                <Image source={{ uri: pairNew.imageUri }} style={styles.previewImg} resizeMode="contain" />
                <Text style={styles.previewName} numberOfLines={1}>{sheetCitation(pairNew)}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => { void handleCompareExisting(); }} style={styles.primaryBtn} activeOpacity={0.85} testID="compare-existing-pair">
              <Layers size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Compare these revisions</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPairNewId(null)} style={[styles.changeBtn, { marginHorizontal: 16 }]}>
              <Text style={styles.changeBtnText}>Upload a different revision instead</Text>
            </TouchableOpacity>
            {errorBanner}
          </>
        )}

        {step === 'pickNew' && oldSheet && !pairNew && (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Now upload the revision</Text>
              <Text style={styles.heroBody}>
                Pick the new PDF, or a JPG/PNG, showing the same drawing as <Text style={{ fontWeight: '700' }}>{oldSheet.name}</Text>. For a whole re-issued set you choose the page. We&apos;ll render it and run the comparison.
              </Text>
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Comparing against</Text>
              <View style={styles.summaryRow}>
                <Image source={{ uri: oldSheet.imageUri }} style={styles.summaryThumb} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle}>{oldSheet.name}</Text>
                  {oldSheet.sheetNumber ? <Text style={styles.sheetMeta}>{oldSheet.sheetNumber}</Text> : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => { setPendingPdf(null); renderCache.current = null; setStep('pickOld'); }} style={styles.changeBtn}>
                <Text style={styles.changeBtnText}>Pick a different sheet</Text>
              </TouchableOpacity>
            </View>

            {pendingPdf ? (
              /* #76: which page of the set is this sheet. Only that page is
                 rendered (one takeoff page). */
              <View style={styles.fileCard} testID="compare-page-picker">
                <View style={styles.fileCardHead}>
                  <FileText size={15} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.fileCardTitle} numberOfLines={2}>
                    {pendingPdf.asset.name}{pendingPdf.pageCount ? ` · ${pendingPdf.pageCount} pages` : ''}
                  </Text>
                </View>
                <Text style={styles.fileCardBody}>
                  Which page is {oldSheet.sheetNumber || oldSheet.name}? Only that page is rendered and compared — it uses 1 takeoff page.
                </Text>
                <View style={styles.pageRow}>
                  <TouchableOpacity
                    onPress={() => setPageDraft(p => String(Math.max(1, (Number(p) || 1) - 1)))}
                    style={styles.pageStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Previous page"
                  >
                    <Minus size={14} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <TextInput
                    value={pageDraft}
                    onChangeText={setPageDraft}
                    keyboardType="number-pad"
                    style={styles.pageInput}
                    accessibilityLabel="Page number"
                    testID="compare-page-input"
                  />
                  <TouchableOpacity
                    onPress={() => setPageDraft(p => {
                      const next = (Number(p) || 0) + 1;
                      return String(pendingPdf.pageCount ? Math.min(pendingPdf.pageCount, next) : next);
                    })}
                    style={styles.pageStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Next page"
                  >
                    <Plus size={14} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  {pendingPdf.pageCount ? <Text style={styles.sheetMeta}>of {pendingPdf.pageCount}</Text> : null}
                </View>
                {pageChoice.reason ? <Text style={styles.fileCardBlocked}>{pageChoice.reason}</Text> : null}
                <TouchableOpacity
                  onPress={() => {
                    if (pageChoice.page === null) return;
                    void runCompare({ kind: 'pdf', asset: pendingPdf.asset, page: pageChoice.page, pageCount: pendingPdf.pageCount });
                  }}
                  disabled={pageChoice.page === null}
                  style={[styles.fileBtn, pageChoice.page === null && { opacity: 0.5 }]}
                  activeOpacity={0.85}
                  accessibilityState={{ disabled: pageChoice.page === null }}
                  testID="compare-page-go"
                >
                  <Text style={styles.fileBtnText}>{pageChoice.page === null ? 'Pick a page' : `Compare page ${pageChoice.page}`}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPendingPdf(null)} style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>Pick a different file</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={handlePickNew} style={styles.primaryBtn} activeOpacity={0.85}>
                <FileText size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.primaryBtnText}>Pick new revision (PDF or image)</Text>
              </TouchableOpacity>
            )}

            {errorBanner}
          </>
        )}

        {/* ── Step 4: review the diff ────────────────────────────── */}
        {step === 'review' && result && oldSheet && (
          <>
            <View style={[styles.hero, severityHero(result.severity)]}>
              <Text style={styles.severityLabel}>{severityLabel(result.severity)}</Text>
              <Text style={styles.heroTitle}>{result.changes.length} change{result.changes.length === 1 ? '' : 's'} found</Text>
              <Text style={styles.heroBody}>{result.summary}</Text>
              {modelUsed && (
                <Text style={styles.modelTag}>via {modelUsed}</Text>
              )}
            </View>

            {/* Side-by-side preview */}
            <View style={styles.previewRow}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Old</Text>
                <Image source={{ uri: oldSheet.imageUri }} style={styles.previewImg} resizeMode="contain" />
                <Text style={styles.previewName} numberOfLines={1}>{oldSheet.name}</Text>
              </View>
              {newPageUrl && (
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>New</Text>
                  <Image source={{ uri: newPageUrl }} style={styles.previewImg} resizeMode="contain" />
                  <Text style={styles.previewName} numberOfLines={1}>{newPageLabel ?? 'Revision'}</Text>
                </View>
              )}
            </View>

            {/* File the revision. Until this happens the plan set still shows
                the OLD sheet as current, and the super opens it in the field. */}
            {filing ? (
              <View style={styles.fileCard}>
                <View style={styles.fileCardHead}>
                  <Layers size={15} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.fileCardTitle}>Put this revision in the plan set</Text>
                </View>
                {filing.kind === 'ready' ? (
                  <>
                    <Text style={styles.fileCardBody}>
                      {sheetCitation(oldSheet)} stays in the field until the new copy is filed. Filing marks it superseded and the viewer warns anyone who opens it.
                    </Text>
                    <TouchableOpacity onPress={handleFileRevision} style={styles.fileBtn} activeOpacity={0.85} testID="compare-file-revision">
                      <FilePlus2 size={15} color={Colors.textOnAccent} strokeWidth={1.75} />
                      <Text style={styles.fileBtnText}>{filing.label}</Text>
                    </TouchableOpacity>
                  </>
                ) : filing.kind === 'filed' || filing.kind === 'in_set' ? (
                  <>
                    <View style={styles.doneRow}>
                      <Check size={14} color={themeColors.successLabel} strokeWidth={2} />
                      <Text style={styles.doneText}>{filing.label}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: (filing.kind === 'in_set' ? pairNew?.id : filed?.sheetId) ?? '' } as never })}
                      style={styles.linkBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.linkBtnText}>{filing.kind === 'in_set' ? 'Open the newer sheet' : 'Open the filed sheet'}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Disabled controls say why (house rule) — and what to do. */}
                    <Text style={styles.fileCardBlocked}>{filing.reason}</Text>
                    {filing.needsNumber ? (
                      /* #75: number it here; the comparison above is kept. */
                      <View style={styles.pageRow}>
                        <TextInput
                          value={numberDraft}
                          onChangeText={(t) => { setNumberDraft(t); setNumberError(null); }}
                          placeholder="A-201"
                          autoCapitalize="characters"
                          autoCorrect={false}
                          style={[styles.pageInput, { flex: 1, textAlign: 'left' }]}
                          accessibilityLabel={`Sheet number for ${oldSheet.name}`}
                          testID="compare-sheet-number-input"
                        />
                        <TouchableOpacity
                          onPress={handleSaveNumber}
                          disabled={!numberDraft.trim()}
                          style={[styles.rowBtn, { marginTop: 0 }, !numberDraft.trim() && { opacity: 0.5 }]}
                          accessibilityState={{ disabled: !numberDraft.trim() }}
                          testID="compare-sheet-number-save"
                        >
                          <Check size={13} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.rowBtnText}>{numberDraft.trim() ? 'Save number' : 'Type a number'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {numberError ? <Text style={styles.errorText}>{numberError}</Text> : null}
                  </>
                )}
              </View>
            ) : null}

            {result.changes.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No changes detected.</Text>
                <Text style={styles.emptyBody}>The two sheets look the same to AI. Worth a quick eyeball confirmation before you trust this.</Text>
              </View>
            ) : (
              result.changes.map((c, i) => (
                <View key={i} style={styles.changeCard}>
                  <View style={styles.changeHeader}>
                    <View style={[styles.changeIcon, changeBg(c.type)]}>
                      {iconForType(c.type)}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.changeType}>{labelForType(c.type)}{c.location ? ` · ${c.location}` : ''}</Text>
                      <Text style={styles.changeDescription}>{c.description}</Text>
                      {c.impact !== 'none' && (
                        <View style={[styles.impactChip, impactBg(c.impact)]}>
                          <Text style={styles.impactText}>{c.impact} impact</Text>
                        </View>
                      )}
                      {c.suggestedAction ? (
                        <Text style={styles.suggestedAction}>→ {c.suggestedAction}</Text>
                      ) : null}
                      <View style={styles.rowBtnWrap}>
                        {/* The change, the place, and the drawing it came from,
                            carried into the CO — no retyping from memory. */}
                        <TouchableOpacity
                          onPress={() => handleStartChangeOrder(i)}
                          style={styles.rowBtn}
                          activeOpacity={0.8}
                          testID={`compare-start-co-${i}`}
                        >
                          <FilePlus2 size={13} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.rowBtnText}>{coSaved[i] ? `Open CO #${coSaved[i].number}` : 'Start change order'}</Text>
                        </TouchableOpacity>
                        {/* #166: a change that needs the architect's word. */}
                        <TouchableOpacity
                          onPress={() => (changeRfi[i] ? openRfi(changeRfi[i].id) : handleRaiseChangeRfi(i))}
                          style={styles.rowBtn}
                          activeOpacity={0.8}
                          testID={`compare-change-rfi-${i}`}
                        >
                          <MessageSquarePlus size={13} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.rowBtnText}>{changeRfi[i] ? `Open RFI #${changeRfi[i].number} to assign and send` : 'Raise RFI'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              ))
            )}

            {result.rfiCandidates.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Possible RFIs to architect</Text>
                {result.rfiCandidates.map((r, i) => (
                  <View key={i} style={styles.rfiCard}>
                    <Info size={14} color={themeColors.info} strokeWidth={1.75} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rfiSubject}>{r.subject}</Text>
                      <Text style={styles.rfiQuestion}>{r.question}</Text>
                      {rfiByIndex[i] ? (
                        /* #166: created with no addressee — open it to add one and send. */
                        <TouchableOpacity
                          onPress={() => openRfi(rfiByIndex[i].id)}
                          style={styles.doneRow}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          testID={`compare-open-rfi-${i}`}
                        >
                          <Check size={13} color={themeColors.successLabel} strokeWidth={2} />
                          <Text style={styles.doneText}>
                            RFI #{rfiByIndex[i].number} created, linked to {sheetCitation(pairNew ?? oldSheet)}. <Text style={styles.linkBtnText}>Open RFI #{rfiByIndex[i].number} to assign and send</Text>
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleCreateRfi(i)}
                          style={styles.rowBtn}
                          activeOpacity={0.8}
                          testID={`compare-create-rfi-${i}`}
                        >
                          <MessageSquarePlus size={13} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.rowBtnText}>Create RFI</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity onPress={handleDone} style={styles.primaryBtn} activeOpacity={0.85} testID="compare-done">
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function iconForType(t: ChangeType) {
  if (t === 'added') return <Plus size={14} color="#FFF" strokeWidth={1.75} />;
  if (t === 'removed') return <Minus size={14} color="#FFF" strokeWidth={1.75} />;
  if (t === 'modified') return <Pencil size={14} color="#FFF" strokeWidth={1.75} />;
  return <Info size={14} color="#FFF" strokeWidth={1.75} />;
}
function labelForType(t: ChangeType): string {
  if (t === 'added') return 'Added';
  if (t === 'removed') return 'Removed';
  if (t === 'modified') return 'Modified';
  return 'Note revised';
}
// Module-level — hardcoded hex to stay theme-agnostic.
function changeBg(t: ChangeType) {
  if (t === 'added') return { backgroundColor: '#2E7D44' };
  if (t === 'removed') return { backgroundColor: '#C84038' };
  if (t === 'modified') return { backgroundColor: Colors.warning };
  return { backgroundColor: '#1565C0' };
}
function impactBg(i: ChangeImpact) {
  if (i === 'major') return { backgroundColor: '#C84038' + '25' };
  if (i === 'moderate') return { backgroundColor: Colors.warning + '25' };
  return { backgroundColor: '#F4EFE6' };
}
function severityHero(s: 'low' | 'medium' | 'high') {
  if (s === 'high') return { backgroundColor: '#C84038' + '12', borderColor: '#C84038' + '30' };
  if (s === 'medium') return { backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '40' };
  return { backgroundColor: '#2E7D44' + '12', borderColor: '#2E7D44' + '30' };
}
function severityLabel(s: 'low' | 'medium' | 'high'): string {
  if (s === 'high') return 'HIGH IMPACT';
  if (s === 'medium') return 'MEDIUM IMPACT';
  return 'LOW IMPACT';
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: Type.body.fontSize, color: t.textMuted },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  severityLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.text, marginBottom: 6, letterSpacing: 0.6 },
  modelTag: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8 },

  sectionLabel: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 8,
    fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.card, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  sheetThumb: { width: 50, height: 50, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  sheetTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  sheetMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  emptyCard: {
    margin: 16, padding: 16, borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  emptyText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptyBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  summaryCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  summaryLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryThumb: { width: 50, height: 50, borderRadius: Tokens.radius.md },
  summaryTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  changeBtn: { marginTop: 10 },
  changeBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },

  primaryBtn: {
    marginHorizontal: 16, paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },

  busyWrap: { padding: 40, alignItems: 'center', gap: 12 },
  busyText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  busySub: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 17 },

  errorBanner: {
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '15', borderWidth: 1, borderColor: t.danger + '30',
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, flex: 1, lineHeight: 17 },

  previewRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  previewItem: { flex: 1, padding: 8, borderRadius: Tokens.radius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  previewLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  previewImg: { width: '100%', height: 140, borderRadius: 6, backgroundColor: t.surfaceAlt },
  previewName: { fontSize: Type.caption1.fontSize, color: t.text, marginTop: 6 },

  changeCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.card, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  changeHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  changeIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  changeType: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  changeDescription: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 19 },
  impactChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 6 },
  impactText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, color: t.text },
  suggestedAction: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 6, fontStyle: 'italic' },

  fileCard: {
    // The four properties that must agree app-wide come from cardSurface; only
    // the accent hairline (this card is the one that WRITES to the plan set)
    // and the layout are overlaid.
    ...cardSurface(t, { radius: 'card', pad: 14, bordered: true }),
    borderColor: t.accent + '33',
    marginHorizontal: 16, marginBottom: 12, gap: 8,
  },
  fileCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fileCardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  fileCardBody: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  fileCardBlocked: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  fileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill,
  },
  fileBtnText: { color: Colors.textOnAccent, fontSize: Type.subhead.fontSize, fontWeight: '700' },
  linkBtn: { alignSelf: 'flex-start' },
  linkBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  doneText: { fontSize: Type.caption1.fontSize, color: t.successLabel, flex: 1, lineHeight: 17 },
  rowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.accent + '44',
  },
  rowBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },
  rowBtnWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageStepBtn: {
    width: 34, height: 34, borderRadius: Tokens.radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  pageInput: {
    minWidth: 64, height: 36, paddingHorizontal: 10, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
    color: t.text, fontSize: Type.body.fontSize, textAlign: 'center',
  },

  rfiCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.info + '10',
    borderWidth: 1, borderColor: t.info + '30',
    flexDirection: 'row', gap: 8,
  },
  rfiSubject: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  rfiQuestion: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
});
