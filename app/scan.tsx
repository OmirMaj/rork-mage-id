// scan.tsx — "Scan Anything to auto-file."
//
// One capture (or a few) → the scan-anything edge function classifies the
// document (Gemini), extracts a flat `fields` object, and suggests where it
// files. The GC reviews/edits, then Save uploads EVERY page to the project's
// document folder AND creates the matching domain record (invoice → material
// receipt linked to the commitment it pays down; business card → Contact;
// COI → the sub's compliance record with its expiry; permit → a Permit;
// warranty → a Warranty; everything else → file-only), then logs a ScanRecord
// for the audit trail.
//
// PII BOUNDARY: if the edge fn classifies the capture as a government ID it
// returns `redirect: 'crew-id-scan'` and extracts NOTHING. This screen then
// shows a redirect card to the consented crew ID-scan flow and never saves.
// Government-ID fields never flow through here.
//
// Capture uses the existing expo-image-picker (base64:true) — no new native
// deps. All writes go through the existing create paths (addReceipt / addContact
// / addCOI / addPermit / addWarranty) + uploadProjectFile + the ScanContext
// audit log. The pure halves (routing, page names, the COI coverage, the
// permit / warranty builders, the receipt) live in utils/scanRouting and
// utils/commitmentLinking, pinned by scripts/validate-w5-scan-files-*.ts.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, ImagePlus, Check, AlertTriangle, X,
  ScanLine, ShieldAlert, ArrowRight, Folder,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useScans } from '@/contexts/ScanContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  resolveDestination, defaultTitleFor, recordKindPhrase, scanFolderLabel, scanFiledMessage,
  scanPageFileName, scanPayloadTooLarge, coiPickerSubs, scanCoiCoverages, scanCalendarDay,
  buildScanPermit, buildScanWarranty, buildScanReceipt, scanInvoiceLines, scanOwnerOnlyGate,
} from '@/utils/scanRouting';
import { linkableCommitments, autoLinkCommitment, commitmentChipLabel } from '@/utils/commitmentLinking';
import { uploadProjectFile, ProjectFileEmptyError } from '@/utils/projectFiles';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { readFileBytes } from '@/utils/fileBytes';
import { base64ToBytes } from '@/utils/base64Bytes';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';
import { edgeFunctionError, edgeErrorCode } from '@/utils/edgeError';
import { generateUUID } from '@/utils/generateId';
import { formatMoney } from '@/utils/formatters';
import type {
  ScanDocType, ScanRecordKind, Contact, CertificateOfInsurance,
} from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { Colors } from '@/constants/colors';
import { showAlert } from '@/utils/alert';

// ── Types ────────────────────────────────────────────────────────
interface Capture { uri: string; base64: string; mimeType: string }

interface ScanResponse {
  success: boolean;
  docType: ScanDocType;
  confidence: number;
  fields: Record<string, unknown>;
  suggestedTitle?: string;
  redirect?: 'crew-id-scan';
  error?: string;
}

/** A page that reached the server with bytes (index = capture order). */
interface LandedPage { path: string; name: string }

const MAX_CAPTURES = 6;

// ── Helpers (pure) ───────────────────────────────────────────────
function isScalar(v: unknown): v is string | number {
  return typeof v === 'string' || typeof v === 'number';
}

/** camelCase / snake_case field key → "Title Case" label. */
function humanizeKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export default function ScanScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('scan_anything')) {
    return <Paywall visible feature="Scan Anything" requiredTier="business" onClose={() => router.back()} />;
  }
  return <ScanInner />;
}

function ScanInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, getProject, subcontractors, addContact, addCOI, addPermit, addWarranty,
    getCommitmentsForProject,
  } = useProjects();
  const { addReceipt } = useMaterialReceipts();
  const { addScan } = useScans();
  const { tier } = useSubscription();

  const initialProjectId = params.projectId ?? projects[0]?.id ?? '';
  const [projectId, setProjectId] = useState(initialProjectId);
  // #163: the state above is seeded ONCE, at mount. Cold-starting (or
  // refreshing on web) into /scan before the projects load left it '' for
  // good, and with one job there was no picker to fix it: "Pick a project"
  // with nothing to pick. Work the project out at USE time instead — his
  // pick, else the route's, else the only job he has. With several jobs and
  // no pick, nothing is guessed: the picker shows.
  const effectiveProjectId = projectId || params.projectId || (projects.length === 1 ? projects[0].id : '');
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  // null = follow the auto-pick (the insured-name match / the vendor match);
  // a string = his explicit choice ('' = None).
  const [subPick, setSubPick] = useState<string | null>(null);
  const [commitmentPick, setCommitmentPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ kind: ScanRecordKind; folder: string; pages: number } | null>(null);
  // #64: pages already on the server for THIS scan, so a retry after a
  // partial failure files only the rest (never a duplicate). The stamp and
  // title are frozen at the first attempt so a retry re-targets the same names.
  const [landed, setLanded] = useState<Record<number, LandedPage>>({});
  const fileStemRef = useRef<{ stamp: number; title: string } | null>(null);
  // Per page: how many times its upload landed as an undeletable 0-byte
  // object. Each one moves that page to a new name (`-pN-rA`) — the old name
  // is held by the empty copy a field seat can't remove.
  const pageAttemptRef = useRef<Record<number, number>>({});

  const project = effectiveProjectId ? getProject(effectiveProjectId) : null;

  // resolveDestination is the pure, validator-tested source of truth for
  // routing — we never trust the server's suggestedDestination for the save.
  const destination = result ? resolveDestination(result.docType) : null;
  // Government-ID is a hard stop that must not depend on a single server-supplied
  // string. Treat the classified docType as an independent boundary: if EITHER
  // the redirect hint OR the docType says government_id, we render the redirect
  // card and never upload / never log a ScanRecord for it.
  const isRedirect = result?.redirect === 'crew-id-scan' || result?.docType === 'government_id';

  // #33: the picker used to require the project id in `assignedProjects`,
  // which no screen writes — the list was empty for every real sub, so every
  // scanned COI filed as a loose document. buyout-package's rule instead
  // (empty = available everywhere), this job's subs first, and the sub whose
  // name matches the certificate's insured pre-selected.
  const coiSubs = useMemo(
    () => coiPickerSubs(subcontractors, effectiveProjectId, editedFields.insured),
    [subcontractors, effectiveProjectId, editedFields.insured],
  );
  // An explicit pick counts only while that sub is still in THIS job's list —
  // switching project must never carry a sub the new job doesn't offer.
  const effectiveSubId = subPick === null
    ? coiSubs.matchId
    : (subPick && coiSubs.subs.some(s => s.id === subPick) ? subPick : '');

  // #63: a scanned bill books against the commitment it pays down — the same
  // candidates and counterparty rule as material-receipt (utils/
  // commitmentLinking), defaulted by the exact vendor match and overridable
  // on the "Pays against" chips.
  const linkable = useMemo(
    () => linkableCommitments(effectiveProjectId ? getCommitmentsForProject(effectiveProjectId) : [], effectiveProjectId),
    [effectiveProjectId, getCommitmentsForProject],
  );
  const autoCommitmentId = useMemo(
    () => autoLinkCommitment(str(editedFields.vendor), linkable, subcontractors),
    [editedFields.vendor, linkable, subcontractors],
  );
  // An explicit pick counts only while it is one of THIS job's commitments: a
  // chip tapped on job A must never book a bill on job B against A's
  // subcontract (job costing on B can't resolve it and books direct cost —
  // the opposite of what the card said).
  const effectiveCommitmentId = commitmentPick === null
    ? autoCommitmentId
    : (commitmentPick && linkable.some(c => c.id === commitmentPick) ? commitmentPick : undefined);
  const invoiceLines = useMemo(() => scanInvoiceLines(editedFields), [editedFields]);

  // #162: a warranty row needs readable dates; say which are missing instead
  // of creating a record with invented ones.
  const warrantyCheck = useMemo(
    () => (destination?.recordKind === 'warranty'
      ? buildScanWarranty(editedFields, { projectId: effectiveProjectId, projectName: project?.name ?? '', fileName: '' })
      : null),
    [destination?.recordKind, editedFields, effectiveProjectId, project?.name],
  );

  // Product decision #53 (owner-only interim): a permit or warranty — and a
  // bill or COI (owner-only RLS, integration round 1) — is created only by
  // the job's OWNER. An invited PM's warranty would land on
  // HIS account (warranties RLS is auth.uid() = user_id) — the GC's list,
  // handover, binder and portal would never see it while the banner said
  // "added the warranty". Unknown role = not the owner.
  const roleState = useProjectRoleState(effectiveProjectId || undefined);
  // Loading and a failed read are both handled in the gate: loading decides
  // nothing (Save waits), an error / unknown role is not ownership.
  const ownerGate = scanOwnerOnlyGate(destination?.recordKind, {
    role: roleState.role, isLoading: roleState.isLoading, isError: roleState.isError,
  });

  // A COI with no linked subcontractor is invisible in every compliance surface
  // (all filter strictly by subcontractorId). Rather than persist an orphaned,
  // unfindable compliance record, an unlinked COI files as a plain document.
  // Likewise a warranty whose dates didn't read, and a permit / warranty on a
  // job he doesn't own.
  const effectiveRecordKind: ScanRecordKind | null = destination
    ? (destination.recordKind === 'sub_compliance' && !effectiveSubId ? 'file_only'
      : ownerGate.state === 'blocked' ? 'file_only'
      : destination.recordKind === 'warranty' && warrantyCheck && !warrantyCheck.ok ? 'file_only'
      : destination.recordKind)
    : null;

  const scalarKeys = useMemo(
    () => Object.keys(editedFields).filter(k => isScalar(editedFields[k])),
    [editedFields],
  );

  // ── Capture ──────────────────────────────────────────────────
  const addCapture = useCallback(async (source: 'camera' | 'library') => {
    if (captures.length >= MAX_CAPTURES) {
      showAlert('Max captures', `Up to ${MAX_CAPTURES} images per scan.`);
      return;
    }
    try {
      let res: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Camera access needed', 'Grant camera access in Settings.'); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { showAlert('Photo access needed', 'Grant photo access in Settings.'); return; }
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true });
      }
      if (res.canceled || !res.assets[0]?.base64) return;
      const a = res.assets[0];
      setCaptures(prev => [...prev, { uri: a.uri, base64: a.base64 ?? '', mimeType: a.mimeType ?? 'image/jpeg' }]);
      setResult(null);
      setError(null);
      setSaved(null);
    } catch (e) {
      setError(`Couldn't open the ${source}: ${String((e as Error).message ?? e)}`);
    }
  }, [captures.length]);

  // #64 partial filing: once any page of this scan is in Project Files,
  // removing a page would clear the result — the next Scan is another charged
  // AI call, and it resets `landed` and the name stem, so the pages already
  // filed would upload AGAIN under a new stamp (orphaned duplicates). Refuse
  // with the reason and the way out instead (Start over below).
  const landedCount = Object.keys(landed).length;
  const removeCapture = useCallback((idx: number) => {
    if (landedCount > 0) {
      showAlert(
        'Pages already filed',
        `${landedCount} page${landedCount === 1 ? ' of this scan is' : 's of this scan are'} already in ${project?.name ?? 'this job'}'s files. Finish filing the rest here, or tap Start over (the filed pages stay in Project Files).`,
      );
      return;
    }
    setCaptures(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
  }, [landedCount, project?.name]);

  // ── Scan (edge fn) ───────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (busy || captures.length === 0) return;
    if (!effectiveProjectId) { showAlert('Pick a project', 'Choose which project this document belongs to.'); return; }
    // #68 (carried for photo-ai): the server refuses over 6 MB for one image
    // or 8 MB for the scan. Say so BEFORE the call, with what to do about it,
    // instead of "Edge Function returned a non-2xx status code".
    const tooLarge = scanPayloadTooLarge(captures);
    if (tooLarge) { setError(tooLarge); return; }
    // Meter the vision call against the same monthly photoAnalysis budget every
    // other vision surface uses (material-receipt / photo-triage). The server is
    // still the authority — this is the client pre-check so the user sees the
    // cap before we burn an uncapped Gemini call.
    const limit = await checkAILimit(tier, 'smart', 'photoAnalysis');
    if (!limit.allowed) { showAILimitAlert({ limit, router, monthly: true }); return; }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // invokeWithTimeout: a Gemini stall no longer spins forever.
      const { data, error: fnError } = await invokeWithTimeout<ScanResponse>('scan-anything', {
        body: {
          projectId: effectiveProjectId,
          images: captures.map(c => ({ base64: c.base64, mimeType: c.mimeType })),
        },
      });
      // #124: read the function's own sentence and code off the response.
      if (fnError) throw await edgeFunctionError(fnError, 'Scan failed');
      if (!data?.success) throw new Error(data?.error || 'Scan failed');
      await recordAIUsage('smart', 'photoAnalysis');
      setResult(data);
      // The redirect (gov-ID) path returns empty fields — nothing to edit.
      setEditedFields(data.redirect ? {} : { ...(data.fields ?? {}) });
      setSubPick(null);
      setCommitmentPick(null);
      setLanded({});
      fileStemRef.current = null;
      pageAttemptRef.current = {};
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const code = edgeErrorCode(e);
      if (code === 'monthly_cap_reached' || code === 'tier_required') {
        // A cap or a plan gate: "try again" would be a lie. Offer the plans.
        setError(msg);
        showAlert(
          code === 'tier_required' ? 'Not on your plan' : 'Monthly scan limit reached',
          msg,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push('/paywall' as never) },
          ],
        );
      } else if (code === 'hourly_limit') {
        setError(msg); // the server's sentence already says when to retry
      } else {
        setError(`Scan failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, captures, effectiveProjectId, tier, router]);

  // ── Field edits ──────────────────────────────────────────────
  const patchField = useCallback((key: string, value: string) => {
    setEditedFields(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Domain-record creation (reuses the existing create paths) ─
  // Returns the created record id (linkedRecordId) or undefined. Only ever
  // called AFTER every page landed. `pages` are bare project-documents paths
  // (CONTRACT 7): a record stores the PATH, never the 7-day signed URL that
  // went blank a week later (#66).
  const createDomainRecord = useCallback((
    kind: ScanRecordKind,
    fields: Record<string, unknown>,
    pages: LandedPage[],
  ): string | undefined => {
    const now = new Date().toISOString();
    const first = pages[0];
    const projectName = project?.name ?? '';
    if (kind === 'cost') {
      // invoice → material receipt → feeds the Cost Database, booked against
      // the commitment it pays down (#63). The line items were shown on the
      // card, so 'reviewed' is true when there are any.
      const receipt = buildScanReceipt(fields, {
        projectId: effectiveProjectId,
        commitmentId: effectiveCommitmentId,
        imagePath: first?.path,
        now,
        linesShown: true,
      });
      addReceipt(receipt);
      return receipt.id;
    }
    if (kind === 'contact') {
      const name = str(fields.name).trim();
      const [firstName, ...rest] = name.split(/\s+/);
      const website = str(fields.website).trim();
      const contact: Contact = {
        id: generateUUID(),
        firstName: firstName ?? '',
        lastName: rest.join(' '),
        companyName: str(fields.company).trim(),
        role: 'Supplier',
        email: str(fields.email).trim(),
        phone: str(fields.phone).trim(),
        address: str(fields.address).trim(),
        notes: website ? `Website: ${website}` : '',
        linkedProjectIds: effectiveProjectId ? [effectiveProjectId] : [],
        createdAt: now,
        updatedAt: now,
      };
      addContact(contact);
      return contact.id;
    }
    if (kind === 'sub_compliance') {
      // COI → the sub's compliance record. #33: the expiry it read becomes a
      // coverage (only when it is a real calendar day), so addCOI's
      // syncSubCoiExpiry moves the sub's coi_expiry. fileUri = page 1's path;
      // the other pages are named in the notes.
      const morePages = pages.length > 1 ? `${pages.length} pages: ${pages.map(p => p.name).join(', ')}` : '';
      const coi: CertificateOfInsurance = {
        id: generateUUID(),
        subcontractorId: effectiveSubId,
        projectId: effectiveProjectId,
        fileUri: first?.path ?? '',
        uploadedAt: now,
        coverages: scanCoiCoverages(fields),
        notes: [str(fields.insured), str(fields.carrier), str(fields.policyNumber), morePages]
          .filter(Boolean).join(' · '),
      };
      addCOI(coi);
      return coi.id;
    }
    if (kind === 'permit') {
      // #162: the permit the card read becomes a row on the Permits list.
      const permit = addPermit(buildScanPermit(fields, { projectId: effectiveProjectId, projectName, fileName: first?.name ?? '' }));
      return permit.id;
    }
    if (kind === 'warranty') {
      const built = buildScanWarranty(fields, { projectId: effectiveProjectId, projectName, fileName: first?.name ?? '' });
      if (!built.ok) return undefined;
      return addWarranty(built.warranty).id;
    }
    return undefined; // file_only
  }, [effectiveProjectId, project?.name, effectiveCommitmentId, effectiveSubId, addReceipt, addContact, addCOI, addPermit, addWarranty]);

  // ── Save ─────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (!result || !destination || !effectiveRecordKind || !effectiveProjectId || saving) return;
    // The owner check hasn't answered yet: decide nothing (the button is
    // disabled too, with the reason on the card).
    if (ownerGate.state === 'checking') return;
    // Hard PII boundary: a government-ID capture must NEVER be uploaded or logged
    // as a ScanRecord here, regardless of any other response field. It goes
    // through the consented crew ID-scan flow instead.
    if (result.docType === 'government_id' || result.redirect === 'crew-id-scan') return;
    if (captures.length === 0) return;
    setSaving(true);
    setError(null);

    if (!fileStemRef.current) {
      fileStemRef.current = {
        stamp: Date.now(),
        title: result.suggestedTitle?.trim() || defaultTitleFor(result.docType, editedFields),
      };
    }
    const { stamp, title } = fileStemRef.current;

    // #64: EVERY page, in order, under one stem. It used to upload captures[0]
    // only and then clear the rest — pages 2..N of a contract or COI existed
    // nowhere. #5: the bytes come from the capture's own base64 (or
    // readFileBytes), never fetch(uri).blob(), which lands 0 bytes on iOS.
    const next: Record<number, LandedPage> = { ...landed };
    let firstError = '';
    for (let i = 0; i < captures.length; i++) {
      if (next[i]) continue; // landed on an earlier attempt — never re-filed
      const c = captures[i];
      try {
        const bytes = c.base64 ? base64ToBytes(c.base64) : await readFileBytes(c.uri);
        const uploaded = await uploadProjectFile({
          projectId: effectiveProjectId,
          folderKey: destination.folder,
          fileName: scanPageFileName(title, stamp, i, c.mimeType, pageAttemptRef.current[i] ?? 0),
          bytes,
          contentType: c.mimeType || 'image/jpeg',
        });
        next[i] = { path: uploaded.path, name: uploaded.name };
      } catch (e) {
        // A 0-byte copy nobody could remove holds this page's name for good —
        // the retry files it under the next name instead of colliding forever.
        if (e instanceof ProjectFileEmptyError && !e.removed) {
          pageAttemptRef.current[i] = (pageAttemptRef.current[i] ?? 0) + 1;
        }
        if (!firstError) firstError = String((e as Error).message ?? e);
      }
    }
    setLanded(next);

    const total = captures.length;
    const done = Object.keys(next).length;
    // Anything short of every page: keep the captures and the confirm card on
    // screen, create no record and log no scan, and say exactly what landed.
    if (done < total) {
      setError(done === 0
        ? `Filing failed: ${firstError}. Nothing was saved — tap "Confirm & file" to retry.`
        : `Filed ${done} of ${total} pages — tap Confirm & file to retry the rest. (${firstError})`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSaving(false);
      return;
    }

    const pages = captures.map((_, i) => next[i]);
    let linkedRecordId: string | undefined;
    try {
      linkedRecordId = createDomainRecord(effectiveRecordKind, editedFields, pages);
    } catch {
      // Domain-record creation is best-effort — the files are already saved;
      // the banner below then says no record was made rather than claiming one.
    }
    const madeKind: ScanRecordKind = effectiveRecordKind === 'file_only' || linkedRecordId
      ? effectiveRecordKind
      : 'file_only';

    addScan({
      projectId: effectiveProjectId,
      docType: result.docType,
      title,
      // Page 1 stays in filePath for older readers; every page is listed here
      // (scan_records.fields is jsonb — no column change).
      fields: pages.length > 1 ? { ...editedFields, _pages: pages.map(p => p.path) } : editedFields,
      filePath: pages[0].path,
      recordKind: madeKind,
      linkedRecordId,
    });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(false);
    setSaved({ kind: madeKind, folder: destination.folder, pages: pages.length });
    setResult(null);
    setCaptures([]);
    setLanded({});
    fileStemRef.current = null;
    pageAttemptRef.current = {};
  }, [result, destination, effectiveRecordKind, ownerGate.state, effectiveProjectId, saving, editedFields, captures, landed, createDomainRecord, addScan]);

  const scanAnother = useCallback(() => {
    setSaved(null);
    setResult(null);
    setCaptures([]);
    setLanded({});
    fileStemRef.current = null;
    pageAttemptRef.current = {};
    setError(null);
  }, []);

  // Pages already on the server live in THIS job's folder; switching now
  // would file page 1 (in the old job) as the record of the new one and split
  // the rest across two jobs. Refuse with the reason. Otherwise switch and
  // drop the explicit sub / commitment picks — they belonged to the old job.
  const pickProject = useCallback((id: string) => {
    if (id === effectiveProjectId) return;
    if (landedCount > 0) {
      showAlert(
        'Pages already filed',
        `${landedCount} page${landedCount === 1 ? ' is' : 's are'} already in ${project?.name ?? 'this job'}'s files. Finish filing here, or tap Start over (the filed pages stay in Project Files).`,
      );
      return;
    }
    setProjectId(id);
    setSubPick(null);
    setCommitmentPick(null);
  }, [effectiveProjectId, landedCount, project?.name]);

  const showProjectPicker = projects.length > 1 || (!effectiveProjectId && projects.length > 0);
  const expiryRead = scanCalendarDay(editedFields.expiresDate);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Scan Anything · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Auto-file a document'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* What this screen is. It had no sentence on it at all: an eyebrow,
            a title and two camera buttons — and picking a project replaced the
            only self-description that existed, because the title falls back to
            "Auto-file a document" only when nothing is selected. Every sibling
            AI door (ai-punch, cost-xray, takeoff, compare-drawings) opens with
            a paragraph saying what it will do. */}
        {/* Suppressed at zero projects: the EmptyState below already opens
            with what Scan Anything does, and two paragraphs of the same
            explanation is the wall of text this pass exists to avoid. */}
        {projects.length > 0 && captures.length === 0 && !result && !saved && (
          <View style={styles.intro}>
            <Text style={styles.introText}>
              Photograph any document — a sub&apos;s invoice, a COI, a permit, a business
              card. MAGE reads it, tells you what it found, and files it to the right
              job. Nothing is filed without your OK.
            </Text>
          </View>
        )}

        {/* Project picker — also whenever no project is selected, so the
            screen never asks him to pick with nothing to pick from (#163). */}
        {showProjectPicker && (
          <View style={styles.pickerWrap}>
            <Text style={styles.pickerLabel}>Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {projects.map(p => (
                <TouchableOpacity key={p.id} onPress={() => pickProject(p.id)} style={[styles.chip, effectiveProjectId === p.id && styles.chipOn]}>
                  <Text style={[styles.chipText, effectiveProjectId === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Captures */}
        {captures.length > 0 && (
          <View style={styles.thumbRow}>
            {captures.map((c, i) => (
              <View key={c.uri + i} style={styles.thumbWrap}>
                <Image source={{ uri: c.uri }} style={styles.thumb} resizeMode="cover" />
                {landed[i] ? (
                  <View style={[styles.thumbDel, { backgroundColor: t.success }]} accessibilityLabel={`Page ${i + 1} filed`}>
                    <Check size={13} color={Colors.textOnAccent} strokeWidth={2.25} />
                  </View>
                ) : (
                  <TouchableOpacity style={styles.thumbDel} onPress={() => removeCapture(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove capture">
                    <X size={13} color={Colors.textOnAccent} strokeWidth={2.25} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* The prerequisite in front of the camera instead of behind it. With
            no projects, the old screen still offered Capture: the contractor
            took the photo, waited out the vision call, and was only then told
            to pick a project from an empty list — the cost paid before the
            refusal. */}
        {!result && !saved && projects.length === 0 && (
          <EmptyState
            icon={<ScanLine size={36} color={t.accent} strokeWidth={1.6} />}
            title="No projects yet"
            message="Scan Anything reads a document and files it into a job — a bill as a cost entry, a COI on the sub, a permit on the Permits list. Create a project first so Scan Anything has somewhere to land."
            actionLabel="Create a project"
            onAction={() => router.push({ pathname: '/' as never, params: { openCreate: '1' } as never })}
          />
        )}

        {!result && !saved && projects.length > 0 && (
          <View style={styles.captureRow}>
            <TouchableOpacity style={styles.captureBtn} onPress={() => addCapture('camera')} activeOpacity={0.85} testID="scan-camera">
              <Camera size={22} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.captureText}>{captures.length ? 'Add shot' : 'Capture'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureBtn} onPress={() => addCapture('library')} activeOpacity={0.85} testID="scan-library">
              <ImagePlus size={22} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.captureText}>From library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Scan CTA */}
        {captures.length > 0 && !result && (
          <TouchableOpacity style={[styles.aiBtn, busy && { opacity: 0.7 }]} onPress={runScan} disabled={busy} activeOpacity={0.85} testID="scan-run">
            {busy ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <MageAIMark size={16} color={Colors.textOnAccent} />}
            <Text style={styles.aiBtnText}>{busy ? 'Reading the document…' : 'Scan & auto-file'}</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.warn}>
            <AlertTriangle size={15} color={t.danger} strokeWidth={1.75} />
            <Text style={styles.warnText}>{error}</Text>
          </View>
        )}

        {saved && (
          <View style={[styles.warn, { backgroundColor: t.success + '14' }]}>
            <Check size={15} color={t.success} strokeWidth={1.75} />
            <Text style={[styles.warnText, { color: t.text }]} testID="scan-filed-message">{scanFiledMessage(saved.kind, saved.folder, saved.pages)}</Text>
          </View>
        )}
        {saved && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={scanAnother} activeOpacity={0.85} testID="scan-another">
            <ScanLine size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.secondaryBtnText}>Scan another</Text>
          </TouchableOpacity>
        )}
        {/* #64 partial filing: the way out the refusals above name. The pages
            that landed stay in Project Files; nothing is re-uploaded. */}
        {!saved && landedCount > 0 && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={scanAnother} activeOpacity={0.85} testID="scan-start-over" accessibilityRole="button" accessibilityLabel="Start over — the filed pages stay in Project Files">
            <ScanLine size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.secondaryBtnText}>Start over</Text>
          </TouchableOpacity>
        )}

        {/* ── Gov-ID redirect card (PII boundary) ── */}
        {result && isRedirect && (
          <View style={styles.redirectCard}>
            <View style={styles.redirectIcon}>
              <ShieldAlert size={22} color={t.accentHot} strokeWidth={1.75} />
            </View>
            <Text style={styles.redirectTitle}>This looks like an ID</Text>
            <Text style={styles.redirectBody}>
              Use the crew ID scan — it asks the person's consent, verifies the ID, and never stores the number.
              Government IDs aren&apos;t filed here.
            </Text>
            <TouchableOpacity style={styles.aiBtn} onPress={() => router.push('/crew')} activeOpacity={0.85} testID="scan-goto-crew">
              <Text style={styles.aiBtnText}>Go to crew ID scan</Text>
              <ArrowRight size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Confirm card ── */}
        {result && !isRedirect && destination && (
          <View style={styles.confirmWrap}>
            {/* docType + confidence */}
            <View style={styles.docTypeRow}>
              <Text style={styles.docTypeLabel}>{humanizeKey(result.docType)}</Text>
              <View style={styles.confBadge}>
                <Text style={styles.confText}>{Math.round(result.confidence)}%</Text>
              </View>
            </View>

            {/* Destination */}
            <View style={styles.destCard}>
              <Folder size={15} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.destText} testID="scan-destination">
                Files {captures.length > 1 ? `all ${captures.length} pages ` : ''}to <Text style={styles.destStrong}>{scanFolderLabel(destination.folder)}</Text>
                {' · '}{recordKindPhrase(effectiveRecordKind ?? destination.recordKind)}
              </Text>
            </View>

            {/* Owner-only (#53 interim): say why a permit / warranty files as
                an image only, or that the role check is still answering. */}
            {ownerGate.state !== 'open' && (
              <Text style={styles.helpText} testID="scan-owner-only">{ownerGate.reason}</Text>
            )}

            {/* Sub picker (COI only). Shown for every COI the user may file
                — an empty list says why it will file as a plain document and
                where to fix it. Hidden while the owner-only gate is not open:
                the reason above already says this files as an image only, and
                a picker saying 'needed to file as compliance' under it would
                contradict it. */}
            {destination.recordKind === 'sub_compliance' && ownerGate.state === 'open' && (
              <View style={styles.pickerWrap} testID="scan-coi-sub-picker">
                <Text style={styles.pickerLabel}>Link to subcontractor (needed to file as compliance)</Text>
                {coiSubs.subs.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <TouchableOpacity onPress={() => setSubPick('')} style={[styles.chip, !effectiveSubId && styles.chipOn]}>
                      <Text style={[styles.chipText, !effectiveSubId && styles.chipTextOn]}>None</Text>
                    </TouchableOpacity>
                    {coiSubs.subs.map(s => (
                      <TouchableOpacity key={s.id} onPress={() => setSubPick(s.id)} style={[styles.chip, effectiveSubId === s.id && styles.chipOn]}>
                        <Text style={[styles.chipText, effectiveSubId === s.id && styles.chipTextOn]} numberOfLines={1}>
                          {s.companyName}{subPick === null && coiSubs.matchId === s.id ? ' · matched by insured name' : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.helpRow}>
                    <Text style={styles.helpText}>No subs yet — add one in Subs to file this as compliance. Until then it files as a plain document.</Text>
                    <TouchableOpacity onPress={() => router.push('/(tabs)/subs' as never)} hitSlop={8} accessibilityRole="link" testID="scan-add-sub">
                      <Text style={styles.helpLink}>Open Subs</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {effectiveSubId && !expiryRead && (
                  <Text style={styles.helpText}>
                    No expiry date read as YYYY-MM-DD — the COI files on the sub, but his insurance expiry won&apos;t update until you fix Expires Date below.
                  </Text>
                )}
              </View>
            )}

            {/* Pays against (invoice only) — #63. Hidden unless the owner-only
                gate is open: a blocked bill files as an image only, so 'counts
                against that PO' / 'books as direct cost' would be false. */}
            {destination.recordKind === 'cost' && ownerGate.state === 'open' && (
              <View style={styles.pickerWrap} testID="scan-commitment-picker">
                <Text style={styles.pickerLabel}>Pays against</Text>
                {linkable.length > 0 ? (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <TouchableOpacity onPress={() => setCommitmentPick('')} style={[styles.chip, !effectiveCommitmentId && styles.chipOn]}>
                        <Text style={[styles.chipText, !effectiveCommitmentId && styles.chipTextOn]}>None — direct cost</Text>
                      </TouchableOpacity>
                      {linkable.map(c => (
                        <TouchableOpacity key={c.id} onPress={() => setCommitmentPick(c.id)} style={[styles.chip, effectiveCommitmentId === c.id && styles.chipOn]} testID={`scan-commitment-${c.id}`}>
                          <Text style={[styles.chipText, effectiveCommitmentId === c.id && styles.chipTextOn]} numberOfLines={1}>
                            {commitmentChipLabel(c, subcontractors)}
                            {commitmentPick === null && autoCommitmentId === c.id ? ' · matched by vendor name' : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={styles.helpText}>
                      {effectiveCommitmentId
                        ? 'Counts against that PO or subcontract in job costing, so the same dollars are not counted twice.'
                        : 'Unlinked, this counts as direct cost — if the vendor already has a PO or subcontract on this job, the same dollars are then counted twice.'}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.helpText}>No open POs or subcontracts on this job — the bill books as direct cost.</Text>
                )}
              </View>
            )}

            {/* Warranty needs readable dates — say which. */}
            {ownerGate.state === 'open' && warrantyCheck && !warrantyCheck.ok && (
              <Text style={styles.helpText} testID="scan-warranty-reason">{warrantyCheck.reason}</Text>
            )}

            {/* Editable fields */}
            {scalarKeys.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.sectionTitle}>Details</Text>
                {effectiveRecordKind === 'file_only' && (
                  <Text style={styles.helpText}>These are kept with the scan log only — no record is created from them.</Text>
                )}
                {scalarKeys.map(key => (
                  <View key={key} style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>{humanizeKey(key)}</Text>
                    <TextInput
                      value={str(editedFields[key])}
                      onChangeText={v => patchField(key, v)}
                      style={styles.field}
                      placeholderTextColor={t.textMuted}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyFields}>No fields extracted — the document will be filed as-is.</Text>
            )}

            {/* Line items, read-only — the receipt is only marked reviewed
                because he saw them here (#63). */}
            {destination.recordKind === 'cost' && invoiceLines.length > 0 && (
              <View style={{ marginTop: 4 }} testID="scan-invoice-lines">
                <Text style={styles.sectionTitle}>Line items ({invoiceLines.length})</Text>
                {invoiceLines.map((l, i) => (
                  <View key={i} style={styles.lineRow}>
                    <Text style={styles.lineDesc} numberOfLines={2}>{l.description || 'Item'}{l.qty ? ` · ${l.qty}${l.unit ? ` ${l.unit}` : ''}` : ''}</Text>
                    <Text style={styles.lineTotal}>{Number.isFinite(Number(l.lineTotal)) && l.lineTotal !== '' ? formatMoney(Number(l.lineTotal), 2) : l.lineTotal}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, (saving || ownerGate.state === 'checking') && { opacity: 0.7 }]}
              onPress={onSave}
              disabled={saving || ownerGate.state === 'checking'}
              accessibilityState={{ disabled: saving || ownerGate.state === 'checking' }}
              activeOpacity={0.85}
              testID="scan-save"
            >
              {saving ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} />}
              <Text style={styles.saveBtnText}>
                {saving ? 'Filing…' : 'Confirm & file'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  intro: { ...cardSurface(t, { radius: 'card', pad: 14 }), marginBottom: 14 },
  introText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },
  pickerWrap: { marginBottom: 14 },
  pickerLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, maxWidth: 180 },
  chipOn: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  chipTextOn: { color: t.accent },

  thumbRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginBottom: 12 },
  thumbWrap: { position: 'relative' as const },
  thumb: { width: 72, height: 72, borderRadius: Tokens.radius.sm, backgroundColor: t.surface },
  thumbDel: {
    position: 'absolute' as const, top: -6, right: -6, width: 22, height: 22, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent, alignItems: 'center' as const, justifyContent: 'center' as const,
  },

  captureRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 12 },
  captureBtn: {
    flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line,
    paddingVertical: 26,
  },
  captureText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.card, paddingVertical: 14, marginBottom: 8,
  },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  secondaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.accent,
    paddingVertical: 13, marginTop: 4,
  },
  secondaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },

  warn: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, backgroundColor: t.danger + '14', borderRadius: Tokens.radius.card, padding: 12, marginBottom: 12, marginTop: 4 },
  warnText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  // Gov-ID redirect
  redirectCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.accentHot + '55', padding: 18, marginTop: 6, gap: 10, alignItems: 'flex-start' as const },
  redirectIcon: { width: 44, height: 44, borderRadius: Tokens.radius.full, backgroundColor: t.accentHot + '1A', alignItems: 'center' as const, justifyContent: 'center' as const },
  redirectTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  redirectBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 4 },

  // Confirm
  confirmWrap: { marginTop: 6 },
  docTypeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 12 },
  docTypeLabel: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  confBadge: { backgroundColor: t.accent + '1A', borderRadius: Tokens.radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  confText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },

  destCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 12 },
  destText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  destStrong: { fontWeight: '800' as const, color: t.text },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 4 },
  fieldBlock: { marginBottom: 10 },
  fieldLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 4 },
  field: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 10, paddingVertical: 9, fontSize: Type.subhead.fontSize, color: t.text,
  },
  emptyFields: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 18, marginVertical: 8 },
  helpRow: { gap: 6 },
  helpText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17, marginTop: 6 },
  helpLink: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' as const },
  lineRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  lineDesc: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text },
  lineTotal: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontVariant: ['tabular-nums' as const] },

  saveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.success, borderRadius: Tokens.radius.card, paddingVertical: 14, marginTop: 8,
  },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
