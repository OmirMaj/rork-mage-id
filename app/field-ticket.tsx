// app/field-ticket.tsx — the T&M / extra-work field ticket.
//
// The problem: the super notices out-of-scope work at 2pm, nobody signs
// anything on site, and at closeout the owner denies it ever happened. A
// signed ticket at the moment the work happens is what makes it billable.
//
// Design constraints this screen is built around:
//   * Two minutes, standing in a hallway, wearing gloves. Every quantity is a
//     ±0.5 stepper with a full-height tap target; trades and reasons are chips,
//     not free text; nothing is required that the super doesn't already know.
//   * No signal. Every write goes through ProjectContext → supabaseWrite, so a
//     ticket captured in a basement is durable the instant it's saved.
//   * The signature seals it. Once signed, nothing about the captured work is
//     editable — same principle as app/contract.tsx's `isLocked`, enforced
//     again at the data layer in ProjectContext.updateFieldTicket.
//   * The payoff is billing. A signed ticket converts into a ChangeOrder in one
//     tap, through the pure gate in utils/fieldTicketCore that refuses an
//     unsigned ticket and refuses to convert the same ticket twice.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Platform, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, Minus, Trash2, Camera, X, Check, Package, Truck, HardHat,
  ChevronRight, Lock, Share2, Repeat, FileSignature, MapPin, ImagePlus,
} from 'lucide-react-native';

import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import SignaturePad from '@/components/SignaturePad';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/Button';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { showAlert } from '@/utils/alert';
import { generateUUID } from '@/utils/generateId';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import { generateFieldTicketPDF } from '@/utils/pdfGenerator';
import { nailIt } from '@/components/animations/NailItToast';
import {
  buildChangeOrderFromTicket, checkFieldTicketConversion, checkFieldTicketReadiness,
  computeFieldTicketTotals, emptyFieldTicket, fieldTicketLabel, formatTicketDate,
  isFieldTicketAuthorized, nextFieldTicketNumber, ticketConversionPatch,
} from '@/utils/fieldTicketCore';
import type {
  FieldTicket, FieldTicketAuthorizerRole, FieldTicketEquipmentRow,
  FieldTicketLaborRow, FieldTicketMaterialRow, FieldTicketPhoto, FieldTicketStatus,
} from '@/types';

// ─── Gate ────────────────────────────────────────────────────────────────────
// change_orders_invoicing (Pro). The ticket's ONLY payoff is becoming a
// billable change order — gating it anywhere else would let a free user
// capture signed evidence they can never bill, which is a dead end and a
// worse experience than not shipping the feature to them at all. It is the
// same money-capture surface as app/change-order.tsx, which is already Pro.

export default function FieldTicketScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('change_orders_invoicing')) {
    return (
      <Paywall
        visible
        feature="T&M Field Tickets"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <FieldTicketInner />;
}

// ─── Chips ───────────────────────────────────────────────────────────────────

/** The five reasons that cover essentially every extra-work argument. */
const REASON_CHIPS = [
  'Owner / rep directive',
  'Unforeseen condition',
  'Design change',
  'Damage by others',
  'Emergency / safety',
] as const;

const TRADE_CHIPS = [
  'Laborer', 'Carpenter', 'Foreman', 'Electrician', 'Plumber',
  'Operator', 'Mason', 'Painter',
] as const;

const ROLE_CHIPS: { key: FieldTicketAuthorizerRole; label: string }[] = [
  { key: 'owner_rep', label: "Owner's rep" },
  { key: 'client', label: 'Client' },
  { key: 'architect', label: 'Architect' },
  { key: 'cm', label: 'CM' },
  { key: 'other', label: 'Other' },
];

const STATUS_LABEL: Record<FieldTicketStatus, string> = {
  draft: 'Unsigned',
  signed: 'Signed — not billed',
  converted: 'Billed',
  void: 'Void',
};

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

function FieldTicketInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const {
    projectId, ticketId, sourceDailyReportId, prefillWork, prefillReason, start,
  } = useLocalSearchParams<{
    projectId?: string;
    ticketId?: string;
    sourceDailyReportId?: string;
    prefillWork?: string;
    prefillReason?: string;
    /** `start=1` from a field entry point opens the composer immediately. */
    start?: string;
  }>();

  const {
    projects, getProject, settings,
    fieldTickets, addFieldTicket, updateFieldTicket, getFieldTicketsForProject,
    changeOrders, addChangeOrder, getChangeOrdersForProject,
  } = useProjects();

  // Opened from the Tools hub / search / a deep link there is no projectId, so
  // the ToolProjectPicker sets one locally — same pattern as ai-punch and
  // compare-drawings, which keeps the choice out of the URL.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const activeProjectId = projectId ?? pickedProjectId ?? '';

  const project = useMemo(() => getProject(activeProjectId), [activeProjectId, getProject]);
  const tickets = useMemo(
    () => (activeProjectId ? getFieldTicketsForProject(activeProjectId) : []),
    [activeProjectId, getFieldTicketsForProject],
  );
  const projectCOs = useMemo(
    () => (activeProjectId ? getChangeOrdersForProject(activeProjectId) : []),
    [activeProjectId, getChangeOrdersForProject],
  );

  // 'list' | 'compose' | id-of-a-ticket (detail)
  const [view, setView] = useState<'list' | 'compose'>(
    start === '1' && !ticketId ? 'compose' : 'list',
  );
  const [openTicketId, setOpenTicketId] = useState<string | null>(ticketId ?? null);

  // ── Composer state ────────────────────────────────────────────────────────
  const [workDescription, setWorkDescription] = useState(prefillWork ?? '');
  const [reasonExtra, setReasonExtra] = useState(prefillReason ?? '');
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [labor, setLabor] = useState<FieldTicketLaborRow[]>([]);
  const [materials, setMaterials] = useState<FieldTicketMaterialRow[]>([]);
  const [equipment, setEquipment] = useState<FieldTicketEquipmentRow[]>([]);
  const [photos, setPhotos] = useState<FieldTicketPhoto[]>([]);
  const [markup, setMarkup] = useState('');

  const [signOpen, setSignOpen] = useState(false);
  /** null = signing the composer draft; an id = signing a saved unsigned ticket. */
  const [signTargetId, setSignTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = useMemo<FieldTicket>(() => ({
    id: 'pending',
    number: nextFieldTicketNumber(tickets),
    projectId: activeProjectId,
    date: workDate,
    workDescription,
    reasonExtra,
    sourceDailyReportId,
    labor, materials, equipment, photos,
    markupPercent: Number(markup) || 0,
    status: 'draft',
    createdAt: '', updatedAt: '',
  }), [tickets, activeProjectId, workDate, workDescription, reasonExtra, sourceDailyReportId,
       labor, materials, equipment, photos, markup]);

  const draftTotals = useMemo(() => computeFieldTicketTotals(draft), [draft]);
  const readiness = useMemo(() => checkFieldTicketReadiness(draft), [draft]);

  const openTicket = useMemo(
    () => (openTicketId ? fieldTickets.find(x => x.id === openTicketId) ?? null : null),
    [openTicketId, fieldTickets],
  );

  const resetComposer = useCallback(() => {
    setWorkDescription(''); setReasonExtra('');
    setWorkDate(new Date().toISOString().slice(0, 10));
    setLabor([]); setMaterials([]); setEquipment([]); setPhotos([]); setMarkup('');
  }, []);

  const tap = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ── Row editing ───────────────────────────────────────────────────────────

  const addLaborRow = useCallback(() => {
    tap();
    setLabor(prev => [...prev, {
      id: generateUUID(), workerName: '', trade: TRADE_CHIPS[0], hours: 1,
    }]);
  }, [tap]);

  const addMaterialRow = useCallback(() => {
    tap();
    setMaterials(prev => [...prev, {
      id: generateUUID(), description: '', quantity: 1, unit: 'ea',
    }]);
  }, [tap]);

  const addEquipmentRow = useCallback(() => {
    tap();
    setEquipment(prev => [...prev, { id: generateUUID(), description: '', hours: 1 }]);
  }, [tap]);

  // ── Photos ────────────────────────────────────────────────────────────────
  // Same funnel as the daily report: capture locally, geo-stamp on CAMERA only
  // (a library photo could have been taken anywhere, any time), and let
  // ProjectContext stage the bytes onto the photo-upload queue at save time.
  // Nothing here ever writes a raw file:// URI to the server.

  const handleAddPhoto = useCallback(async (fromCamera: boolean) => {
    if (photos.length >= 8) {
      showAlert('Limit reached', 'Up to 8 photos per ticket.');
      return;
    }
    try {
      let result: ImagePicker.ImagePickerResult;
      if (fromCamera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert('Camera access needed', 'Allow camera access to photograph the extra work.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
        });
      }
      if (result.canceled || !result.assets[0]) return;
      const stamp = fromCamera && Platform.OS !== 'web' ? await stampPhotoLocation() : null;
      setPhotos(prev => [...prev, {
        id: generateUUID(),
        uri: result.assets[0].uri,
        timestamp: new Date().toISOString(),
        ...(stamp ? {
          latitude: stamp.latitude,
          longitude: stamp.longitude,
          locationAccuracyMeters: stamp.accuracyMeters,
          locationLabel: stamp.label,
        } : null),
      }]);
      tap();
    } catch (err) {
      console.warn('[FieldTicket] photo error:', err);
    }
  }, [photos.length, tap]);

  // ── Sign & seal ───────────────────────────────────────────────────────────

  /**
   * One signature handler for both paths: a brand-new ticket built in the
   * composer, and a ticket that was saved unsigned earlier and is now being
   * signed from its detail view (`signTargetId`). The second path is not
   * optional — without it, "Save" produces a ticket that can never be billed,
   * which is exactly the dead end this feature exists to eliminate.
   */
  const handleSign = useCallback(async (
    name: string, title: string, role: FieldTicketAuthorizerRole, paths: string[],
  ) => {
    if (!activeProjectId) return;
    setBusy(true);
    try {
      // Best-effort GPS on the signature itself — proves it was signed on site
      // and not typed up in the truck three days later. Never blocks the save.
      const stamp = Platform.OS === 'web' ? null : await stampPhotoLocation();
      const now = new Date().toISOString();
      const authorization = {
        name: name.trim(),
        title: title.trim() || undefined,
        role,
        signedAt: now,
        signaturePaths: paths,
        ...(stamp ? {
          latitude: stamp.latitude,
          longitude: stamp.longitude,
          locationLabel: stamp.label,
        } : null),
      };
      const auditEntry = {
        id: generateUUID(),
        action: 'signed_on_site',
        actor: name.trim(),
        timestamp: now,
        detail: stamp?.label,
      };

      // Signing a ticket that already exists (saved unsigned earlier).
      if (signTargetId) {
        const existing = fieldTickets.find(x => x.id === signTargetId);
        if (!existing) return;
        updateFieldTicket(signTargetId, {
          status: 'signed',
          authorization,
          auditTrail: [...(existing.auditTrail ?? []), auditEntry],
        });
        setSignOpen(false);
        setSignTargetId(null);
        setOpenTicketId(signTargetId);
        nailIt(`${fieldTicketLabel(existing.number)} signed — ${money(computeFieldTicketTotals(existing).billableTotal)}`);
        return;
      }

      const ticket: FieldTicket = {
        ...emptyFieldTicket({
          id: generateUUID(),
          projectId: activeProjectId,
          number: nextFieldTicketNumber(tickets),
          nowISO: now,
          sourceDailyReportId,
          markupPercent: Number(markup) || 0,
        }),
        date: workDate,
        workDescription: workDescription.trim(),
        reasonExtra: reasonExtra.trim(),
        labor, materials, equipment, photos,
        status: 'signed',
        authorization,
        auditTrail: [auditEntry],
      };
      addFieldTicket(ticket);
      setSignOpen(false);
      resetComposer();
      setView('list');
      setOpenTicketId(ticket.id);
      nailIt(`${fieldTicketLabel(ticket.number)} signed — ${money(computeFieldTicketTotals(ticket).billableTotal)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, tickets, sourceDailyReportId, markup, workDate, workDescription,
      reasonExtra, labor, materials, equipment, photos, addFieldTicket, resetComposer,
      signTargetId, fieldTickets, updateFieldTicket]);

  /** Save without a signature. Honest about what it is: a reminder, not evidence. */
  const handleSaveUnsigned = useCallback(() => {
    if (!activeProjectId) return;
    const now = new Date().toISOString();
    const ticket: FieldTicket = {
      ...emptyFieldTicket({
        id: generateUUID(), projectId: activeProjectId, number: nextFieldTicketNumber(tickets),
        nowISO: now, sourceDailyReportId, markupPercent: Number(markup) || 0,
      }),
      date: workDate,
      workDescription: workDescription.trim(),
      reasonExtra: reasonExtra.trim(),
      labor, materials, equipment, photos,
    };
    addFieldTicket(ticket);
    resetComposer();
    setView('list');
    showAlert(
      'Saved unsigned',
      'This ticket is a note, not evidence. Get the signature before the crew leaves — an unsigned ticket cannot become a change order.',
    );
  }, [activeProjectId, tickets, sourceDailyReportId, markup, workDate, workDescription,
      reasonExtra, labor, materials, equipment, photos, addFieldTicket, resetComposer]);

  // ── Convert to change order ───────────────────────────────────────────────

  const handleConvert = useCallback((ticket: FieldTicket) => {
    const gate = checkFieldTicketConversion(ticket, changeOrders);
    if (!gate.canConvert) {
      showAlert("Can't bill this yet", gate.reason ?? 'This ticket cannot be converted.');
      return;
    }
    const totals = computeFieldTicketTotals(ticket);
    showAlert(
      'Create change order',
      `${fieldTicketLabel(ticket.number)} becomes a draft change order for ${money(totals.billableTotal)}. You still review and send it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: () => {
            // Re-check against the LIVE list: the user may have sat on this
            // dialog while a sync landed the CO from another device.
            const recheck = checkFieldTicketConversion(ticket, changeOrders);
            if (!recheck.canConvert) {
              showAlert("Can't bill this yet", recheck.reason ?? '');
              return;
            }
            const now = new Date().toISOString();
            const co = buildChangeOrderFromTicket({
              ticket,
              existingCOs: projectCOs,
              baseContractValue:
                project?.linkedEstimate?.grandTotal ?? project?.estimate?.grandTotal ?? 0,
              nowISO: now,
            });
            addChangeOrder(co);
            updateFieldTicket(ticket.id, ticketConversionPatch(co, now));
            nailIt(`CO #${co.number} drafted — ${money(co.changeAmount)}`);
            router.push({
              pathname: '/change-order',
              params: { projectId: ticket.projectId, coId: co.id },
            });
          },
        },
      ],
    );
  }, [changeOrders, projectCOs, project, addChangeOrder, updateFieldTicket, router]);

  const handleShare = useCallback(async (ticket: FieldTicket) => {
    if (!project) return;
    setBusy(true);
    try {
      await generateFieldTicketPDF(ticket, project, settings.branding ?? {
        companyName: '', contactName: '', email: '', phone: '', address: '',
        licenseNumber: '', tagline: '',
      });
    } catch (err) {
      console.warn('[FieldTicket] pdf error:', err);
      showAlert('Could not build the PDF', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [project, settings.branding]);

  const handleVoid = useCallback((ticket: FieldTicket) => {
    showAlert(
      `Void ${fieldTicketLabel(ticket.number)}?`,
      'The ticket stays on the record but can never be billed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: () => {
            updateFieldTicket(ticket.id, { status: 'void' });
            setOpenTicketId(null);
          },
        },
      ],
    );
  }, [updateFieldTicket]);

  // ── No project selected ───────────────────────────────────────────────────

  if (!activeProjectId || !project) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="T&M TICKET · MAGE ID" title="Field Ticket" />
        <ToolProjectPicker
          toolName="T&M Field Ticket"
          message="Capture extra work and get it signed on site, before anyone forgets it happened."
          projects={projects}
          onPick={setPickedProjectId}
        />
      </View>
    );
  }

  // ── Signed-ticket detail ──────────────────────────────────────────────────

  if (openTicket) {
    const totals = computeFieldTicketTotals(openTicket);
    const authorized = isFieldTicketAuthorized(openTicket);
    const gate = checkFieldTicketConversion(openTicket, changeOrders);
    const billedCO = gate.existingChangeOrderId
      ? changeOrders.find(c => c.id === gate.existingChangeOrderId)
      : undefined;
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader
          eyebrow={`${fieldTicketLabel(openTicket.number)} · ${STATUS_LABEL[openTicket.status].toUpperCase()}`}
          title={project.name}
          right={
            <TouchableOpacity onPress={() => setOpenTicketId(null)} hitSlop={12} style={styles.headerAction}>
              <X size={20} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
          }
        />
        <ScrollView {...fabScroll} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
          {/* Seal banner — why nothing here is editable. */}
          {openTicket.status !== 'draft' && (
            <View style={styles.sealBanner}>
              <Lock size={14} color={t.accent} strokeWidth={2} />
              <Text style={styles.sealBannerText}>
                Sealed. This is the record {openTicket.authorization?.name ?? 'the signer'} put their
                name on — it can&apos;t be edited.
              </Text>
            </View>
          )}

          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>Ticket total</Text>
            <Text style={styles.amountValue}>{money(totals.billableTotal)}</Text>
            <Text style={styles.amountSub}>
              {totals.laborHours} labor hr · {money(totals.materialCost)} materials ·{' '}
              {totals.equipmentHours} equip hr
              {totals.markupAmount > 0 ? ` · ${totals.markupPercent}% O&P` : ''}
            </Text>
          </View>

          <ReadBlock label="Work performed" value={openTicket.workDescription} />
          <ReadBlock label="Why it's extra" value={openTicket.reasonExtra} />
          <ReadBlock label="Date of work" value={formatTicketDate(openTicket.date)} />

          {openTicket.labor.length > 0 && (
            <View style={styles.readCard}>
              <Text style={styles.readLabel}>Labor</Text>
              {openTicket.labor.map(r => (
                <View key={r.id} style={styles.readRow}>
                  <Text style={styles.readRowMain} numberOfLines={1}>
                    {r.workerName || 'Unnamed'} · {r.trade}
                  </Text>
                  <Text style={styles.readRowValue}>
                    {r.hours} hr{r.rate ? ` @ ${money(r.rate)}` : ' · rate TBD'}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {openTicket.materials.length > 0 && (
            <View style={styles.readCard}>
              <Text style={styles.readLabel}>Materials</Text>
              {openTicket.materials.map(r => (
                <View key={r.id} style={styles.readRow}>
                  <Text style={styles.readRowMain} numberOfLines={1}>{r.description || 'Material'}</Text>
                  <Text style={styles.readRowValue}>
                    {r.quantity} {r.unit}{r.unitCost ? ` @ ${money(r.unitCost)}` : ' · cost TBD'}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {openTicket.equipment.length > 0 && (
            <View style={styles.readCard}>
              <Text style={styles.readLabel}>Equipment</Text>
              {openTicket.equipment.map(r => (
                <View key={r.id} style={styles.readRow}>
                  <Text style={styles.readRowMain} numberOfLines={1}>{r.description || 'Equipment'}</Text>
                  <Text style={styles.readRowValue}>
                    {r.hours} hr{r.rate ? ` @ ${money(r.rate)}` : ' · rate TBD'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {(openTicket.photos ?? []).length > 0 && (
            <View style={styles.readCard}>
              <Text style={styles.readLabel}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                {(openTicket.photos ?? []).map(p => (
                  <Image key={p.id} source={{ uri: p.localUri ?? p.uri }} style={styles.photoThumb} contentFit="cover" />
                ))}
              </ScrollView>
            </View>
          )}

          {/* The signature — the whole point of the record. */}
          <View style={[styles.readCard, authorized ? styles.sigCardOk : styles.sigCardBad]}>
            <Text style={styles.readLabel}>Authorized on site</Text>
            {openTicket.authorization ? (
              <>
                <Text style={styles.sigName}>{openTicket.authorization.name}</Text>
                {!!openTicket.authorization.title && (
                  <Text style={styles.sigMeta}>{openTicket.authorization.title}</Text>
                )}
                <Text style={styles.sigMeta}>
                  Signed {new Date(openTicket.authorization.signedAt).toLocaleString()}
                </Text>
                {!!openTicket.authorization.locationLabel && (
                  <View style={styles.sigGeo}>
                    <MapPin size={12} color={t.textMuted} strokeWidth={1.75} />
                    <Text style={styles.sigMeta}>{openTicket.authorization.locationLabel}</Text>
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.sigBadText}>
                Unsigned. This is a note, not evidence — it can&apos;t be billed.
              </Text>
            )}
          </View>

          {/* A ticket saved unsigned can still be signed — the crew may not
              have left yet, or the rep may show up an hour later. Without this
              the "Save" affordance would produce a permanently unbillable
              record, which is the exact failure this feature exists to fix. */}
          {openTicket.status === 'draft' && (
            <Button
              label="Get signature now"
              onPress={() => { setSignTargetId(openTicket.id); setSignOpen(true); }}
              fullWidth
              size="lg"
              iconLeft={<FileSignature size={16} color="#FFF" strokeWidth={2} />}
              testID="ticket-sign-existing"
            />
          )}

          {billedCO && (
            <TouchableOpacity
              style={styles.billedRow}
              onPress={() => router.push({
                pathname: '/change-order',
                params: { projectId: openTicket.projectId, coId: billedCO.id },
              })}
              testID="ticket-open-co"
            >
              <Check size={16} color={t.success} strokeWidth={2} />
              <Text style={styles.billedText}>Billed on Change Order #{billedCO.number}</Text>
              <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}

          <View style={styles.detailActions}>
            {!billedCO && openTicket.status !== 'void' && (
              <Button
                label={gate.canConvert ? `Bill it — create change order` : "Can't bill yet"}
                onPress={() => handleConvert(openTicket)}
                disabled={!gate.canConvert}
                fullWidth
                iconLeft={<Repeat size={16} color="#FFF" strokeWidth={2} />}
                testID="ticket-convert"
              />
            )}
            {!gate.canConvert && !billedCO && !!gate.reason && (
              <Text style={styles.gateReason}>{gate.reason}</Text>
            )}
            <Button
              label="Share signed PDF"
              onPress={() => void handleShare(openTicket)}
              variant="secondary"
              fullWidth
              loading={busy}
              iconLeft={<Share2 size={16} color={t.text} strokeWidth={1.75} />}
              testID="ticket-share"
            />
            {openTicket.status !== 'void' && !billedCO && (
              <Button
                label="Void ticket"
                onPress={() => handleVoid(openTicket)}
                variant="ghost"
                fullWidth
              />
            )}
          </View>
        </ScrollView>

        {/* Mounted only while open. A signature pad that survives between
            opens could carry one signer's strokes onto the next ticket. */}
        {signOpen && (
          <SignatureModal
            visible
            busy={busy}
            amount={totals.billableTotal}
            summary={openTicket.workDescription}
            onClose={() => { setSignOpen(false); setSignTargetId(null); }}
            onSign={handleSign}
          />
        )}
      </View>
    );
  }

  // ── Composer ──────────────────────────────────────────────────────────────

  if (view === 'compose') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader
          eyebrow={`${fieldTicketLabel(nextFieldTicketNumber(tickets))} · NEW`}
          title={project.name}
          right={
            <TouchableOpacity
              onPress={() => { resetComposer(); setView('list'); }}
              hitSlop={12}
              style={styles.headerAction}
              testID="ticket-cancel"
            >
              <X size={20} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
          }
        />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 60}
        >
          <ScrollView
            {...fabScroll}
            contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1. What work */}
            <Text style={styles.fieldLabel}>What did the crew do?</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={workDescription}
              onChangeText={setWorkDescription}
              placeholder="e.g. Broke out and hauled off an undocumented footing under the east slab"
              placeholderTextColor={t.textMuted}
              multiline
              testID="ticket-work"
            />

            {/* 2. Why it's extra — chips first, typing optional */}
            <Text style={styles.fieldLabel}>Why is it extra?</Text>
            <View style={styles.chipWrap}>
              {REASON_CHIPS.map(r => {
                const on = reasonExtra.startsWith(r);
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => { tap(); setReasonExtra(on ? '' : r); }}
                    testID={`ticket-reason-${r}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              value={reasonExtra}
              onChangeText={setReasonExtra}
              placeholder="Tap a reason above, or type it"
              placeholderTextColor={t.textMuted}
              testID="ticket-reason"
            />

            {/* 3. Date */}
            <Text style={styles.fieldLabel}>Date of work</Text>
            <TextInput
              style={styles.input}
              value={workDate}
              onChangeText={setWorkDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              testID="ticket-date"
            />

            {/* 4. Labor */}
            <SectionHead
              icon={<HardHat size={16} color={t.accent} strokeWidth={2} />}
              label="Labor"
              hint={draftTotals.laborHours > 0 ? `${draftTotals.laborHours} hr` : undefined}
              onAdd={addLaborRow}
              addTestID="ticket-add-labor"
            />
            {labor.map((row, i) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowTop}>
                  <TextInput
                    style={[styles.input, styles.rowNameInput]}
                    value={row.workerName}
                    onChangeText={v => setLabor(p => p.map((r, j) => j === i ? { ...r, workerName: v } : r))}
                    placeholder="Name"
                    placeholderTextColor={t.textMuted}
                    testID={`ticket-labor-name-${i}`}
                  />
                  <TouchableOpacity
                    onPress={() => setLabor(p => p.filter((_, j) => j !== i))}
                    style={styles.rowDelete}
                    hitSlop={10}
                    testID={`ticket-labor-del-${i}`}
                  >
                    <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {TRADE_CHIPS.map(tr => (
                    <TouchableOpacity
                      key={tr}
                      style={[styles.chipSm, row.trade === tr && styles.chipOn]}
                      onPress={() => { tap(); setLabor(p => p.map((r, j) => j === i ? { ...r, trade: tr } : r)); }}
                    >
                      <Text style={[styles.chipTextSm, row.trade === tr && styles.chipTextOn]}>{tr}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.rowBottom}>
                  <Stepper
                    label="hours"
                    value={row.hours}
                    step={0.5}
                    onChange={v => setLabor(p => p.map((r, j) => j === i ? { ...r, hours: v } : r))}
                    testID={`ticket-labor-hours-${i}`}
                  />
                  <MoneyInput
                    label="$/hr"
                    value={row.rate}
                    onChange={v => setLabor(p => p.map((r, j) => j === i ? { ...r, rate: v } : r))}
                    testID={`ticket-labor-rate-${i}`}
                  />
                </View>
              </View>
            ))}

            {/* 5. Materials */}
            <SectionHead
              icon={<Package size={16} color={t.accent} strokeWidth={2} />}
              label="Materials"
              hint={draftTotals.materialCost > 0 ? money(draftTotals.materialCost) : undefined}
              onAdd={addMaterialRow}
              addTestID="ticket-add-material"
            />
            {materials.map((row, i) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowTop}>
                  <TextInput
                    style={[styles.input, styles.rowNameInput]}
                    value={row.description}
                    onChangeText={v => setMaterials(p => p.map((r, j) => j === i ? { ...r, description: v } : r))}
                    placeholder="What was used"
                    placeholderTextColor={t.textMuted}
                    testID={`ticket-material-desc-${i}`}
                  />
                  <TouchableOpacity
                    onPress={() => setMaterials(p => p.filter((_, j) => j !== i))}
                    style={styles.rowDelete}
                    hitSlop={10}
                  >
                    <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <View style={styles.rowBottom}>
                  <Stepper
                    label="qty"
                    value={row.quantity}
                    step={1}
                    onChange={v => setMaterials(p => p.map((r, j) => j === i ? { ...r, quantity: v } : r))}
                    testID={`ticket-material-qty-${i}`}
                  />
                  <TextInput
                    style={[styles.input, styles.unitInput]}
                    value={row.unit}
                    onChangeText={v => setMaterials(p => p.map((r, j) => j === i ? { ...r, unit: v } : r))}
                    placeholder="ea"
                    placeholderTextColor={t.textMuted}
                    autoCapitalize="none"
                  />
                  <MoneyInput
                    label="$/unit"
                    value={row.unitCost}
                    onChange={v => setMaterials(p => p.map((r, j) => j === i ? { ...r, unitCost: v } : r))}
                    testID={`ticket-material-cost-${i}`}
                  />
                </View>
              </View>
            ))}

            {/* 6. Equipment */}
            <SectionHead
              icon={<Truck size={16} color={t.accent} strokeWidth={2} />}
              label="Equipment"
              hint={draftTotals.equipmentHours > 0 ? `${draftTotals.equipmentHours} hr` : undefined}
              onAdd={addEquipmentRow}
              addTestID="ticket-add-equipment"
            />
            {equipment.map((row, i) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowTop}>
                  <TextInput
                    style={[styles.input, styles.rowNameInput]}
                    value={row.description}
                    onChangeText={v => setEquipment(p => p.map((r, j) => j === i ? { ...r, description: v } : r))}
                    placeholder="Machine (e.g. mini excavator)"
                    placeholderTextColor={t.textMuted}
                    testID={`ticket-equipment-desc-${i}`}
                  />
                  <TouchableOpacity
                    onPress={() => setEquipment(p => p.filter((_, j) => j !== i))}
                    style={styles.rowDelete}
                    hitSlop={10}
                  >
                    <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <View style={styles.rowBottom}>
                  <Stepper
                    label="hours"
                    value={row.hours}
                    step={0.5}
                    onChange={v => setEquipment(p => p.map((r, j) => j === i ? { ...r, hours: v } : r))}
                    testID={`ticket-equipment-hours-${i}`}
                  />
                  <MoneyInput
                    label="$/hr"
                    value={row.rate}
                    onChange={v => setEquipment(p => p.map((r, j) => j === i ? { ...r, rate: v } : r))}
                    testID={`ticket-equipment-rate-${i}`}
                  />
                </View>
              </View>
            ))}

            {/* 7. Photos */}
            <SectionHead
              icon={<Camera size={16} color={t.accent} strokeWidth={2} />}
              label="Photos"
              hint={photos.length > 0 ? `${photos.length}` : undefined}
            />
            <View style={styles.photoActions}>
              <TouchableOpacity style={styles.photoBtn} onPress={() => void handleAddPhoto(true)} testID="ticket-camera">
                <Camera size={18} color={t.accent} strokeWidth={1.75} />
                <Text style={styles.photoBtnText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoBtn} onPress={() => void handleAddPhoto(false)} testID="ticket-library">
                <ImagePlus size={18} color={t.accent} strokeWidth={1.75} />
                <Text style={styles.photoBtnText}>From library</Text>
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                {photos.map(p => (
                  <View key={p.id}>
                    <Image source={{ uri: p.uri }} style={styles.photoThumb} contentFit="cover" />
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => setPhotos(prev => prev.filter(x => x.id !== p.id))}
                      hitSlop={8}
                    >
                      <X size={12} color="#FFF" strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* 8. Markup */}
            <Text style={styles.fieldLabel}>Overhead &amp; profit</Text>
            <View style={styles.markupRow}>
              <TextInput
                style={[styles.input, styles.markupInput]}
                value={markup}
                onChangeText={setMarkup}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="decimal-pad"
                testID="ticket-markup"
              />
              <Text style={styles.markupPct}>%</Text>
              <Text style={styles.markupHint}>
                {draftTotals.markupAmount > 0 ? `+${money(draftTotals.markupAmount)}` : 'Applied on top of cost'}
              </Text>
            </View>
          </ScrollView>

          {/* Sticky bottom bar — total + the one action that matters */}
          <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 10 }]}>
            <View style={styles.stickyTotals}>
              <Text style={styles.stickyTotalValue}>{money(draftTotals.billableTotal)}</Text>
              <Text style={styles.stickyTotalLabel} numberOfLines={1}>
                {readiness.ready
                  ? 'Ready for signature'
                  : `Still need: ${readiness.missing[0]}`}
              </Text>
            </View>
            <View style={styles.stickyActions}>
              <TouchableOpacity
                style={styles.saveLater}
                onPress={handleSaveUnsigned}
                disabled={!readiness.ready}
                testID="ticket-save-unsigned"
              >
                <Text style={[styles.saveLaterText, !readiness.ready && styles.disabledText]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signBtn, !readiness.ready && styles.signBtnDisabled]}
                onPress={() => { tap(); setSignTargetId(null); setSignOpen(true); }}
                disabled={!readiness.ready}
                testID="ticket-get-signature"
              >
                <FileSignature size={16} color={readiness.ready ? '#FFF' : t.textMuted} strokeWidth={2} />
                <Text style={[styles.signBtnText, !readiness.ready && styles.disabledText]}>
                  Get signature
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

        {signOpen && (
          <SignatureModal
            visible
            busy={busy}
            amount={draftTotals.billableTotal}
            summary={workDescription}
            onClose={() => setSignOpen(false)}
            onSign={handleSign}
          />
        )}
      </View>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────

  const unbilled = tickets.filter(x => x.status === 'signed');
  const unbilledTotal = unbilled.reduce(
    (s, x) => s + computeFieldTicketTotals(x).billableTotal, 0,
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="T&M TICKET · MAGE ID" title={project.name} />
      <ScrollView {...fabScroll} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
        {unbilled.length > 0 && (
          <View style={styles.unbilledCard}>
            <Text style={styles.unbilledLabel}>Signed, not yet billed</Text>
            <Text style={styles.unbilledValue}>{money(unbilledTotal)}</Text>
            <Text style={styles.unbilledSub}>
              {unbilled.length} ticket{unbilled.length === 1 ? '' : 's'} the owner has already
              authorized. Convert them before closeout.
            </Text>
          </View>
        )}

        {tickets.length === 0 ? (
          <EmptyState
            icon={<FileSignature size={36} color={t.accent} strokeWidth={1.6} />}
            title="No field tickets yet"
            message="Extra work you never got signed for is the money you lose at closeout. Write the ticket while the work is still visible and get the owner's rep to sign it on the spot."
            actionLabel="New T&M ticket"
            onAction={() => setView('compose')}
          />
        ) : (
          tickets.map(x => {
            const tot = computeFieldTicketTotals(x);
            const tone = x.status === 'converted' ? styles.pillDone
              : x.status === 'signed' ? styles.pillSigned
              : x.status === 'void' ? styles.pillVoid
              : styles.pillDraft;
            return (
              <TouchableOpacity
                key={x.id}
                style={styles.ticketRow}
                onPress={() => setOpenTicketId(x.id)}
                testID={`ticket-row-${x.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${fieldTicketLabel(x.number)}, ${STATUS_LABEL[x.status]}, ${money(tot.billableTotal)}`}
              >
                <View style={styles.ticketRowMain}>
                  <View style={styles.ticketRowHead}>
                    <Text style={styles.ticketNumber}>{fieldTicketLabel(x.number)}</Text>
                    <View style={[styles.pill, tone]}>
                      <Text style={styles.pillText}>{STATUS_LABEL[x.status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.ticketDesc} numberOfLines={2}>
                    {x.workDescription || 'No description'}
                  </Text>
                  <Text style={styles.ticketMeta}>
                    {formatTicketDate(x.date)}
                    {x.authorization ? ` · signed by ${x.authorization.name}` : ' · unsigned'}
                  </Text>
                </View>
                <View style={styles.ticketRowRight}>
                  <Text style={styles.ticketAmount}>{money(tot.billableTotal)}</Text>
                  <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {tickets.length > 0 && (
        <View style={[styles.fabBar, { paddingBottom: insets.bottom + 10 }]}>
          <Button
            label="New T&M ticket"
            onPress={() => setView('compose')}
            fullWidth
            size="lg"
            iconLeft={<Plus size={18} color="#FFF" strokeWidth={2.25} />}
            testID="ticket-new"
          />
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHead({ icon, label, hint, onAdd, addTestID }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onAdd?: () => void;
  addTestID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  return (
    <View style={styles.sectionHead}>
      {icon}
      <Text style={styles.sectionHeadLabel}>{label}</Text>
      {!!hint && <Text style={styles.sectionHeadHint}>{hint}</Text>}
      {!!onAdd && (
        <TouchableOpacity style={styles.sectionAdd} onPress={onAdd} hitSlop={10} testID={addTestID}>
          <Plus size={16} color={t.accent} strokeWidth={2.25} />
          <Text style={styles.sectionAddText}>Add</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Big ± quantity control. Sized for a gloved thumb, not a stylus. */
function Stepper({ label, value, step, onChange, testID }: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const bump = (dir: 1 | -1) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const next = Math.max(0, Math.round((value + dir * step) * 100) / 100);
    onChange(next);
  };
  return (
    <View style={styles.stepper}>
      <TouchableOpacity style={styles.stepperBtn} onPress={() => bump(-1)} hitSlop={6} testID={`${testID}-minus`}>
        <Minus size={18} color={t.text} strokeWidth={2.25} />
      </TouchableOpacity>
      <View style={styles.stepperMid}>
        <Text style={styles.stepperValue} testID={testID}>{value}</Text>
        <Text style={styles.stepperLabel}>{label}</Text>
      </View>
      <TouchableOpacity style={styles.stepperBtn} onPress={() => bump(1)} hitSlop={6} testID={`${testID}-plus`}>
        <Plus size={18} color={t.text} strokeWidth={2.25} />
      </TouchableOpacity>
    </View>
  );
}

/** Optional-by-design money field. Blank means "the office knows the rate." */
function MoneyInput({ label, value, onChange, testID }: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  return (
    <View style={styles.moneyWrap}>
      <TextInput
        style={[styles.input, styles.moneyInput]}
        value={value == null ? '' : String(value)}
        onChangeText={v => {
          const n = parseFloat(v);
          onChange(v.trim() === '' || Number.isNaN(n) ? undefined : n);
        }}
        placeholder="—"
        placeholderTextColor={t.textMuted}
        keyboardType="decimal-pad"
        testID={testID}
      />
      <Text style={styles.moneyLabel}>{label}</Text>
    </View>
  );
}

function ReadBlock({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.readCard}>
      <Text style={styles.readLabel}>{label}</Text>
      <Text style={styles.readValue}>{value || '—'}</Text>
    </View>
  );
}

/**
 * The signature capture. Deliberately spells out what the signer is attesting
 * to (work performed and hours, NOT pricing) — that framing is what keeps a
 * ticket usable when the owner later disputes the rate rather than the hours,
 * and it's the same claim printed on the PDF.
 */
function SignatureModal({ visible, busy, amount, summary, onClose, onSign }: {
  visible: boolean;
  busy: boolean;
  amount: number;
  summary: string;
  onClose: () => void;
  onSign: (name: string, title: string, role: FieldTicketAuthorizerRole, paths: string[]) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<FieldTicketAuthorizerRole>('owner_rep');
  const [paths, setPaths] = useState<string[]>([]);

  // The modal stays mounted between opens, so wipe it every time it appears.
  // Carrying one signer's strokes and name into the next ticket would attach
  // the wrong person's authorization to work they never saw — the single worst
  // bug this screen could ship.
  React.useEffect(() => {
    if (visible) { setName(''); setTitle(''); setRole('owner_rep'); setPaths([]); }
  }, [visible]);

  const ready = name.trim().length > 0 && paths.length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Only the WHO half scrolls. The signature pad drives its own
              PanResponder, and nesting that inside a ScrollView makes the two
              fight over the gesture — the drag either scrolls the sheet or
              draws, depending on which wins, and the loser is the signature.
              Keeping the pad outside the scroll region removes the contention
              entirely and has the side benefit of keeping it always visible. */}
          <ScrollView
            style={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalTitle}>Sign for the work</Text>
            <Text style={styles.modalBody} numberOfLines={3}>{summary}</Text>
            <Text style={styles.modalAttest}>
              By signing you confirm this work was performed and the hours and quantities shown are
              accurate. Pricing is billed under the contract&apos;s T&amp;M rates.
            </Text>

            <View style={styles.chipWrap}>
              {ROLE_CHIPS.map(r => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.chip, role === r.key && styles.chipOn]}
                  onPress={() => setRole(r.key)}
                  testID={`ticket-sign-role-${r.key}`}
                >
                  <Text style={[styles.chipText, role === r.key && styles.chipTextOn]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor={t.textMuted}
              autoCapitalize="words"
              testID="ticket-sign-name"
            />
            <TextInput
              style={[styles.input, styles.inputSpaced]}
              value={title}
              onChangeText={setTitle}
              placeholder="Title / company (optional)"
              placeholderTextColor={t.textMuted}
              testID="ticket-sign-title"
            />
          </ScrollView>

          <View style={styles.sigPadWrap}>
            <SignaturePad
              initialPaths={paths}
              onSave={setPaths}
              onClear={() => setPaths([])}
              height={150}
            />
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={busy}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, !ready && styles.signBtnDisabled]}
              onPress={() => onSign(name, title, role, paths)}
              disabled={!ready || busy}
              testID="ticket-sign-confirm"
            >
              {busy ? <ActivityIndicator size="small" color="#FFF" /> : (
                <>
                  <Check size={16} color={ready ? '#FFF' : t.textMuted} strokeWidth={2.5} />
                  <Text style={[styles.modalConfirmText, !ready && styles.disabledText]}>
                    Sign &amp; seal · {money(amount)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.sealNote}>
            <Lock size={12} color={t.textMuted} strokeWidth={1.75} />
            <Text style={styles.sealNoteText}>
              {ready
                ? 'Once signed the ticket is locked. Nothing above can be changed afterward.'
                : 'Type the signer’s name and capture a signature to continue.'}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  body: { padding: Tokens.spacing.md, gap: Tokens.spacing.xs },
  headerAction: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  fieldLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginTop: Tokens.spacing.sm, marginBottom: Tokens.spacing.xxs,
  },
  input: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 12,
    minHeight: Tokens.touchTarget.comfortable,
    paddingVertical: 10,
    fontSize: Type.callout.fontSize, color: t.text,
  },
  inputTall: { minHeight: 92, textAlignVertical: 'top' },
  inputSpaced: { marginTop: Tokens.spacing.xs },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Tokens.spacing.xs },
  chipRow: { gap: 6, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: Tokens.radius.full,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  chipSm: {
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  chipOn: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary },
  chipTextSm: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },
  chipTextOn: { color: '#FFFFFF' },

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: Tokens.spacing.lg, marginBottom: Tokens.spacing.xxs,
  },
  sectionHeadLabel: { fontSize: Type.subheadEmphasized.fontSize, fontWeight: '700', color: t.text },
  sectionHeadHint: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' },
  sectionAdd: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
  },
  sectionAddText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.accent },

  rowCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: Tokens.spacing.sm,
    marginBottom: Tokens.spacing.xs, gap: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowNameInput: { flex: 1 },
  rowDelete: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitInput: { width: 62, textAlign: 'center' },

  stepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  stepperBtn: {
    width: 46, height: Tokens.touchTarget.comfortable,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperMid: { minWidth: 58, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text },
  stepperLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },

  moneyWrap: { flex: 1, minWidth: 78 },
  moneyInput: { textAlign: 'center' },
  moneyLabel: {
    fontSize: Type.caption2.fontSize, color: t.textMuted,
    textAlign: 'center', marginTop: 2, fontWeight: '600',
  },

  photoActions: { flexDirection: 'row', gap: 8 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.line,
  },
  photoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  photoStrip: { gap: 8, paddingVertical: 8 },
  photoThumb: { width: 84, height: 84, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },

  markupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  markupInput: { width: 86, textAlign: 'center' },
  markupPct: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text },
  markupHint: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textMuted },

  stickyBar: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.sm,
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface,
  },
  stickyTotals: { flex: 1, minWidth: 0 },
  stickyTotalValue: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  stickyTotalLabel: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },
  stickyActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveLater: {
    paddingHorizontal: 14, height: Tokens.touchTarget.comfortable,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  saveLaterText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textSecondary },
  signBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 18, height: Tokens.touchTarget.comfortable,
    borderRadius: Tokens.radius.md, backgroundColor: t.accent,
  },
  signBtnDisabled: { backgroundColor: t.surfaceAlt },
  signBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFFFFF' },
  disabledText: { color: t.textMuted },

  fabBar: {
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.sm,
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface,
  },

  unbilledCard: {
    backgroundColor: t.accentSoft, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accent + '33', padding: Tokens.spacing.md,
    marginBottom: Tokens.spacing.sm,
  },
  unbilledLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  unbilledValue: { fontSize: Type.title1.fontSize, fontWeight: '800', color: t.text, marginTop: 2 },
  unbilledSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 4, lineHeight: 18 },

  ticketRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: Tokens.spacing.sm,
    marginBottom: Tokens.spacing.xs,
  },
  ticketRowMain: { flex: 1, minWidth: 0, gap: 3 },
  ticketRowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketNumber: { fontSize: Type.subheadEmphasized.fontSize, fontWeight: '800', color: t.text },
  ticketDesc: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  ticketMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  ticketRowRight: { alignItems: 'flex-end', gap: 2 },
  ticketAmount: { fontSize: Type.subheadEmphasized.fontSize, fontWeight: '800', color: t.text },

  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  pillText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.3, color: t.text },
  pillDraft: { backgroundColor: t.surfaceAlt },
  pillSigned: { backgroundColor: t.warningSoft },
  pillDone: { backgroundColor: t.successSoft },
  pillVoid: { backgroundColor: t.dangerSoft },

  sealBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: t.accentSoft, borderRadius: Tokens.radius.md,
    padding: Tokens.spacing.sm, marginBottom: Tokens.spacing.xs,
  },
  sealBannerText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  amountCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: Tokens.spacing.md,
    marginBottom: Tokens.spacing.xs,
  },
  amountLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  amountValue: { fontSize: Type.largeTitle.fontSize, fontWeight: '800', color: t.text, marginTop: 2 },
  amountSub: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 4 },

  readCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: Tokens.spacing.sm,
    marginBottom: Tokens.spacing.xs, gap: 4,
  },
  readLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  readValue: { fontSize: Type.callout.fontSize, color: t.text, lineHeight: 21 },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  readRowMain: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  readRowValue: { fontSize: Type.footnote.fontSize, color: t.textSecondary },

  sigCardOk: { borderColor: t.success + '55', borderWidth: 1.5 },
  sigCardBad: { borderColor: t.danger + '55', borderWidth: 1.5 },
  sigName: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text },
  sigMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  sigGeo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sigBadText: { fontSize: Type.footnote.fontSize, color: t.danger, fontWeight: '600', lineHeight: 18 },

  billedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.successSoft, borderRadius: Tokens.radius.md,
    padding: Tokens.spacing.sm, marginBottom: Tokens.spacing.xs,
  },
  billedText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },

  detailActions: { gap: 8, marginTop: Tokens.spacing.sm },
  gateReason: {
    fontSize: Type.caption1.fontSize, color: t.textMuted,
    textAlign: 'center', lineHeight: 17, paddingHorizontal: Tokens.spacing.sm,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl, padding: Tokens.spacing.md,
    paddingBottom: Tokens.spacing.xl, maxHeight: '92%',
  },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  modalBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 4, lineHeight: 18 },
  modalAttest: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17,
    marginTop: Tokens.spacing.xs, marginBottom: Tokens.spacing.sm,
  },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  sigPadWrap: { marginTop: Tokens.spacing.sm, alignItems: 'center' },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: Tokens.spacing.md },
  modalCancel: {
    paddingHorizontal: 18, height: Tokens.touchTarget.comfortable,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  modalCancelText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textSecondary },
  modalConfirm: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: Tokens.touchTarget.comfortable, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
  },
  modalConfirmText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFFFFF' },
  sealNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: Tokens.spacing.sm, justifyContent: 'center',
  },
  sealNoteText: { fontSize: Type.caption2.fontSize, color: t.textMuted },
});
