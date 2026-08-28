// scan.tsx — "Scan Anything to auto-file."
//
// One capture (or a few) → the scan-anything edge function classifies the
// document (Gemini), extracts a flat `fields` object, and suggests where it
// files. The GC reviews/edits, then Save uploads the image to the project's
// document folder AND creates the matching domain record (invoice → cost /
// material receipt; business card → Contact; COI → sub compliance record;
// everything else → file-only), then logs a ScanRecord for the audit trail.
//
// PII BOUNDARY: if the edge fn classifies the capture as a government ID it
// returns `redirect: 'crew-id-scan'` and extracts NOTHING. This screen then
// shows a redirect card to the consented crew ID-scan flow and never saves.
// Government-ID fields never flow through here.
//
// Capture uses the existing expo-image-picker (base64:true) — no new native
// deps. All writes go through the existing create paths (addReceipt / addContact
// / addCOI) + uploadProjectFile + the ScanContext audit log.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { resolveDestination, defaultTitleFor } from '@/utils/scanRouting';
import { normalizeExtraction } from '@/utils/materialReceipt';
import { uploadProjectFile } from '@/utils/projectFiles';
import { supabase } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';
import type {
  ScanDocType, ScanRecordKind, Contact, CertificateOfInsurance,
} from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
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

/** Storage-folder key → readable folder name. */
function folderLabel(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** What the destination line says the auto-file will DO, per record kind. */
function recordKindPhrase(kind: ScanRecordKind): string {
  switch (kind) {
    case 'cost': return 'logs a cost entry';
    case 'contact': return 'creates a contact';
    case 'sub_compliance': return 'files sub compliance';
    case 'file_only': return 'files the document';
  }
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
  const { projects, getProject, subcontractors, addContact, addCOI } = useProjects();
  const { addReceipt } = useMaterialReceipts();
  const { addScan } = useScans();
  const { tier } = useSubscription();

  const initialProjectId = params.projectId ?? projects[0]?.id ?? '';
  const [projectId, setProjectId] = useState(initialProjectId);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  const [subId, setSubId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const project = projectId ? getProject(projectId) : null;

  // resolveDestination is the pure, validator-tested source of truth for
  // routing — we never trust the server's suggestedDestination for the save.
  const destination = result ? resolveDestination(result.docType) : null;
  // Government-ID is a hard stop that must not depend on a single server-supplied
  // string. Treat the classified docType as an independent boundary: if EITHER
  // the redirect hint OR the docType says government_id, we render the redirect
  // card and never upload / never log a ScanRecord for it.
  const isRedirect = result?.redirect === 'crew-id-scan' || result?.docType === 'government_id';

  // A COI with no linked subcontractor is invisible in every compliance surface
  // (all filter strictly by subcontractorId). Rather than persist an orphaned,
  // unfindable compliance record, an unlinked COI files as a plain document.
  const effectiveRecordKind: ScanRecordKind | null = destination
    ? (destination.recordKind === 'sub_compliance' && !subId ? 'file_only' : destination.recordKind)
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
      setSaved(false);
    } catch (e) {
      setError(`Couldn't open the ${source}: ${String((e as Error).message ?? e)}`);
    }
  }, [captures.length]);

  const removeCapture = useCallback((idx: number) => {
    setCaptures(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
  }, []);

  // ── Scan (edge fn) ───────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (busy || captures.length === 0) return;
    if (!projectId) { showAlert('Pick a project', 'Choose which project this document belongs to.'); return; }
    // Meter the vision call against the same monthly photoAnalysis budget every
    // other vision surface uses (material-receipt / photo-triage). The server is
    // still the authority (see FLAG below) — this is the client pre-check so the
    // user sees the cap before we burn an uncapped Gemini call.
    const limit = await checkAILimit(tier, 'smart', 'photoAnalysis');
    if (!limit.allowed) { showAILimitAlert({ limit, router, monthly: true }); return; }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke<ScanResponse>('scan-anything', {
        body: {
          projectId,
          images: captures.map(c => ({ base64: c.base64, mimeType: c.mimeType })),
        },
      });
      if (fnError) throw new Error(fnError.message || 'Scan failed');
      if (!data?.success) throw new Error(data?.error || 'Scan failed');
      await recordAIUsage('smart', 'photoAnalysis');
      setResult(data);
      // The redirect (gov-ID) path returns empty fields — nothing to edit.
      setEditedFields(data.redirect ? {} : { ...(data.fields ?? {}) });
      setSubId('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(`Scan failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, captures, projectId, tier, router]);

  // ── Field edits ──────────────────────────────────────────────
  const patchField = useCallback((key: string, value: string) => {
    setEditedFields(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Domain-record creation (reuses the existing create paths) ─
  // Returns the created record id (linkedRecordId) or undefined. Only ever
  // called AFTER a successful upload, so a COI's fileUri points at a real file.
  const createDomainRecord = useCallback((
    kind: ScanRecordKind,
    docType: ScanDocType,
    fields: Record<string, unknown>,
    publicUrl: string,
  ): string | undefined => {
    const now = new Date().toISOString();
    if (kind === 'cost') {
      // invoice → material receipt → feeds the Cost Database (same path as
      // material-receipt.tsx). Map the scan's invoice schema onto the receipt
      // extraction shape (qty → quantity, date → receiptDate, docNumber → documentNumber).
      const rawLines = Array.isArray(fields.lines) ? (fields.lines as Record<string, unknown>[]) : [];
      const receipt = normalizeExtraction(
        {
          vendor: str(fields.vendor),
          receiptDate: str(fields.date),
          documentNumber: str(fields.docNumber),
          subtotal: str(fields.subtotal),
          tax: str(fields.tax),
          total: str(fields.total),
          lines: rawLines.map(l => ({
            description: str(l.description),
            category: str(l.category) || undefined,
            quantity: str(l.qty),
            unit: str(l.unit),
            unitPrice: str(l.unitPrice),
            lineTotal: str(l.lineTotal),
          })),
        },
        { projectId, imageUri: publicUrl || undefined, now },
      );
      receipt.status = 'reviewed';
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
        linkedProjectIds: projectId ? [projectId] : [],
        createdAt: now,
        updatedAt: now,
      };
      addContact(contact);
      return contact.id;
    }
    if (kind === 'sub_compliance') {
      // COI → sub compliance record. fileUri is the uploaded file's public URL.
      // subcontractorId is optional here (blanket COI) until the GC links it.
      const coi: CertificateOfInsurance = {
        id: generateUUID(),
        subcontractorId: subId,
        projectId,
        fileUri: publicUrl,
        uploadedAt: now,
        notes: [str(fields.insured), str(fields.carrier), str(fields.policyNumber)]
          .filter(Boolean).join(' · '),
      };
      addCOI(coi);
      return coi.id;
    }
    return undefined; // file_only
  }, [projectId, addReceipt, addContact, addCOI, subId]);

  // ── Save ─────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (!result || !destination || !effectiveRecordKind || !projectId || saving) return;
    // Hard PII boundary: a government-ID capture must NEVER be uploaded or logged
    // as a ScanRecord here, regardless of any other response field. It goes
    // through the consented crew ID-scan flow instead.
    if (result.docType === 'government_id' || result.redirect === 'crew-id-scan') return;
    setSaving(true);
    setError(null);

    const title = result.suggestedTitle?.trim() || defaultTitleFor(result.docType, editedFields);
    const first = captures[0];
    const fileName = `${title}-${Date.now()}.jpg`;

    let filePath = '';
    let publicUrl = '';
    let uploadOk = false;
    try {
      if (first) {
        const r = await fetch(first.uri);
        const blob = await r.blob();
        const uploaded = await uploadProjectFile({
          projectId,
          folderKey: destination.folder,
          fileName,
          blob,
          contentType: first.mimeType || 'image/jpeg',
        });
        filePath = uploaded.path;
        publicUrl = uploaded.publicUrl;
        uploadOk = true;
      }
    } catch (e) {
      // Upload failed — leave everything intact (capture + confirm card) so the
      // user can retry. We do NOT log a scan or create a record for a file that
      // never landed, so there's no orphan pointing at nothing.
      setError(`Filing failed: ${String((e as Error).message ?? e)}. Nothing was saved — tap "Confirm & file" to retry.`);
    }

    // Upload failed → keep the capture + confirm card on screen so the user can
    // retry 'Confirm & file' (offline / transient Storage 5xx / name collision
    // are all recoverable). Do NOT create a domain record, do NOT log a scan
    // pointing at a file that never landed, and do NOT show the success banner.
    if (!uploadOk) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSaving(false);
      return;
    }

    let linkedRecordId: string | undefined;
    try {
      linkedRecordId = createDomainRecord(effectiveRecordKind, result.docType, editedFields, publicUrl);
    } catch {
      // Domain-record creation is best-effort — the scan + file are already
      // saved; don't fail the whole flow over the linked record.
    }

    addScan({
      projectId,
      docType: result.docType,
      title,
      fields: editedFields,
      filePath,
      recordKind: effectiveRecordKind,
      linkedRecordId,
    });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(false);
    setSaved(true);
    setResult(null);
    setCaptures([]);
  }, [result, destination, effectiveRecordKind, projectId, saving, editedFields, captures, createDomainRecord, addScan]);

  const scanAnother = useCallback(() => {
    setSaved(false);
    setResult(null);
    setCaptures([]);
    setError(null);
  }, []);

  const projectSubs = useMemo(
    () => (projectId ? subcontractors.filter(s => s.assignedProjects?.includes(projectId)) : subcontractors),
    [subcontractors, projectId],
  );

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

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Project picker */}
        {projects.length > 1 && (
          <View style={styles.pickerWrap}>
            <Text style={styles.pickerLabel}>Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {projects.map(p => (
                <TouchableOpacity key={p.id} onPress={() => setProjectId(p.id)} style={[styles.chip, projectId === p.id && styles.chipOn]}>
                  <Text style={[styles.chipText, projectId === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
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
                <TouchableOpacity style={styles.thumbDel} onPress={() => removeCapture(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove capture">
                  <X size={13} color={Colors.textOnAccent} strokeWidth={2.25} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {!result && !saved && (
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
            <Text style={[styles.warnText, { color: t.text }]}>Filed. The document is in its folder and the record is logged.</Text>
          </View>
        )}
        {saved && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={scanAnother} activeOpacity={0.85} testID="scan-another">
            <ScanLine size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.secondaryBtnText}>Scan another</Text>
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
              <Text style={styles.destText}>
                Files to <Text style={styles.destStrong}>{folderLabel(destination.folder)}</Text>
                {' · '}{recordKindPhrase(effectiveRecordKind ?? destination.recordKind)}
              </Text>
            </View>

            {/* Sub picker (COI only) */}
            {destination.recordKind === 'sub_compliance' && projectSubs.length > 0 && (
              <View style={styles.pickerWrap}>
                <Text style={styles.pickerLabel}>Link to subcontractor (needed to file as compliance)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity onPress={() => setSubId('')} style={[styles.chip, !subId && styles.chipOn]}>
                    <Text style={[styles.chipText, !subId && styles.chipTextOn]}>None</Text>
                  </TouchableOpacity>
                  {projectSubs.map(s => (
                    <TouchableOpacity key={s.id} onPress={() => setSubId(s.id)} style={[styles.chip, subId === s.id && styles.chipOn]}>
                      <Text style={[styles.chipText, subId === s.id && styles.chipTextOn]} numberOfLines={1}>{s.companyName}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Editable fields */}
            {scalarKeys.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.sectionTitle}>Details</Text>
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

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={onSave} disabled={saving} activeOpacity={0.85} testID="scan-save">
              {saving ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} />}
              <Text style={styles.saveBtnText}>{saving ? 'Filing…' : 'Confirm & file'}</Text>
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

  saveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.success, borderRadius: Tokens.radius.card, paddingVertical: 14, marginTop: 8,
  },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
