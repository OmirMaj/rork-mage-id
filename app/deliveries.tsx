// deliveries.tsx — what is arriving, and what should already be here.
//
// The Monday-morning screen. delivery_receipts records what ARRIVED; this is
// the other half — what was promised, so a late load can be chased before the
// crew is standing around waiting for it.
//
// LATE SITS ABOVE THE LOOK-AHEAD, ALWAYS. A delivery three weeks overdue is
// more urgent than one due Friday, and it is deliberately not bounded by the
// 7/14/28 horizon — dropping it out of view because it fell outside a window is
// exactly how it stays forgotten. All maths lives in utils/deliverySchedule
// (pure, pinned by test:delivery-schedule); this file is a read plus three
// status writes.
//
// UX wave B6 — "It's here now": a truck nobody logged is ONE sheet (what,
// supplier chips, a ticket photo, received by = him, the day on a picker, the
// same damage question receiving asks). Saving writes the delivery and its
// receipt together through the context writers (the offline queue); a due or
// late load from the same supplier is offered instead of a duplicate. Opened
// by the header button, by `arrived=1` (Lane 0's route contract) and by a
// scanned delivery ticket (pre-filled, each field "from scan, check it").
// Rules: utils/deliveryArrival. No typed dates are left on this screen.

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform, KeyboardAvoidingView,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { ChevronLeft, Plus, Truck, X, Check, CalendarDays, Building2, Camera, PackageCheck } from 'lucide-react-native';
import DatePickerModal from '@/components/DatePickerModal';
import { useAuth } from '@/contexts/AuthContext';
import { nailIt } from '@/components/animations/NailItToast';
import { readUxDoorParams, readParam } from '@/utils/uxRoutes';
import { SCAN_ARRIVAL_PARAM } from '@/utils/scanRouting';
import { arrivalDayProblem, arrivalProblem, buildArrival, deliveredAtFor, lateMatchForSupplier, FROM_SCAN_LABEL, DELIVERY_TICKET_TAG, type ArrivalDraft } from '@/utils/deliveryArrival';
import { recentSuppliers } from '@/utils/recentChips';
import { buildPhotoStoragePath, isDeviceLocalUri, photoExtFromUri } from '@/utils/photoUploadCore';
import { calendarDayOf, formatCalendarDay, parseCalendarDay } from '@/utils/calendarDate';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import EmptyState from '@/components/EmptyState';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { useSafeBack } from '@/hooks/useSafeBack';
import {
  buildLookahead, summarizeLookahead, LOOKAHEAD_DAYS,
  type Delivery, type DeliveryView, type LookaheadDays,
} from '@/utils/deliverySchedule';
import {
  findAccessConflicts, conflictsForDelivery, type AccessConflict,
} from '@/utils/buildingAccess';
import type { DeliveryReceipt } from '@/utils/deliverySchedule';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { desktopField, segmentedDesktop, useIsDesktop, useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { DeliveriesRegister } from '@/components/registers/DeliveriesRegister';

/** Today as YYYY-MM-DD in LOCAL time — toISOString() would roll the date over
 *  in the evening for anyone west of UTC. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DeliveriesScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const goBack = useSafeBack(); // UX-F18: cold-start safe
  const rawParams = useLocalSearchParams<{ projectId?: string } & Record<string, string | string[]>>();
  const paramProjectId = readParam(rawParams.projectId) ?? undefined;
  const openArrived = readUxDoorParams(rawParams).openArrived;
  // A scanned delivery ticket (app/scan.tsx) hands over what it read.
  // Primitives first, so the memo (and the sheet's reset effect) only moves
  // when a value does — never on a new params object.
  const scanFlag = readParam(rawParams[SCAN_ARRIVAL_PARAM.fromScan]) === '1';
  const scanWhat = readParam(rawParams[SCAN_ARRIVAL_PARAM.what]) ?? '';
  const scanSupplier = readParam(rawParams[SCAN_ARRIVAL_PARAM.supplier]) ?? '';
  const scanDate = readParam(rawParams[SCAN_ARRIVAL_PARAM.date]);
  const scanPo = readParam(rawParams[SCAN_ARRIVAL_PARAM.po]) ?? '';
  const scanTicket = readParam(rawParams[SCAN_ARRIVAL_PARAM.ticket]);
  const scanPrefill = useMemo(() => (scanFlag ? {
    what: scanWhat, supplier: scanSupplier,
    // Only a real calendar day pre-fills the picker.
    date: scanDate && parseCalendarDay(scanDate) ? scanDate : null,
    poNumber: scanPo, ticket: scanTicket,
  } : null), [scanFlag, scanWhat, scanSupplier, scanDate, scanPo, scanTicket]);

  const {
    projects, deliveries, addDelivery, updateDelivery,
    getBuildingAccess, accessReservations, addDeliveryReceipt,
    deliveryReceipts, addProjectPhoto,
  } = useProjects();
  const { user } = useAuth();

  // Reached from the chase list, search or the sidebar with no project — same
  // picker pattern as the other tool screens.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const [horizon, setHorizon] = useState<LookaheadDays>(7);
  const [showAdd, setShowAdd] = useState(false);
  const [receiving, setReceiving] = useState<Delivery | null>(null);
  // "It's here now" — opened once by arrived=1 (or a scan), then by the button.
  const [showArrived, setShowArrived] = useState(false);
  const openedArrivedRef = React.useRef(false);
  React.useEffect(() => {
    if (openedArrivedRef.current || !openArrived || !project) return;
    openedArrivedRef.current = true;
    setShowArrived(true);
  }, [openArrived, project]);
  const supplierChips = useMemo(
    () => recentSuppliers(deliveries, deliveryReceipts ?? [], projectId),
    [deliveries, deliveryReceipts, projectId],
  );

  const scoped = useMemo(
    () => deliveries.filter(d => d.projectId === projectId),
    [deliveries, projectId],
  );
  const look = useMemo(() => buildLookahead(scoped, horizon), [scoped, horizon]);

  // What the BUILDING will stop, as opposed to what the supplier will. A load
  // with a confirmed date and no freight elevator booked is not a delivery
  // problem — the truck simply gets turned away — so it belongs on this row
  // rather than in a separate list nobody opens.
  const rules = getBuildingAccess(projectId);
  const conflicts = useMemo(() => findAccessConflicts({
    rules,
    deliveries: scoped,
    reservations: accessReservations.filter(r => r.projectId === projectId),
    horizonDays: horizon,
  }), [rules, scoped, accessReservations, projectId, horizon]);

  // Not tied to any one load (a missing building COI stops everything).
  const projectConflicts = useMemo(() => conflicts.filter(c => !c.deliveryId), [conflicts]);

  const confirm = useCallback((d: Delivery) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    updateDelivery(d.id, { status: 'confirmed', confirmedAt: new Date().toISOString() });
  }, [updateDelivery]);

  // Receiving opens a sheet rather than a yes/no dialog. It is the one moment
  // the load is physically in front of someone, and it is the ONLY moment
  // damage can be recorded honestly — a week later it is your word against the
  // supplier's. The sheet doubles as the mis-tap guard the old dialog provided.
  const receive = useCallback((d: Delivery) => setReceiving(d), []);

  const commitReceipt = useCallback((d: Delivery, form: {
    receivedBy: string; hasDamage: boolean; damageNotes: string; notes: string;
  }, extra?: { bolPhotoUri?: string; date?: string }) => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = new Date();
    const receipt: DeliveryReceipt = {
      id: generateUUID(),
      projectId: d.projectId,
      deliveryId: d.id,
      // UX wave B6: "It's here now" passes the day on its picker and the
      // ticket photo; the Received sheet passes neither (today, no photo).
      date: extra?.date ?? todayLocal(),
      bolPhotoUri: extra?.bolPhotoUri,
      supplier: d.supplier,
      poNumber: d.poNumber,
      commitmentId: d.commitmentId,
      // Empty is honest: the load landed and nobody itemized it. The receipt
      // still witnesses arrival, damage and who signed.
      items: [],
      hasDamage: form.hasDamage,
      damageNotes: form.hasDamage ? (form.damageNotes.trim() || undefined) : undefined,
      receivedAt: now.toISOString(),
      receivedBy: form.receivedBy.trim() || 'Site',
      notes: form.notes.trim() || undefined,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    addDeliveryReceipt(receipt);
    updateDelivery(d.id, {
      status: 'delivered',
      // The day it landed. From "It's here now" that is the picked day (a
      // back-dated load is not scored late by the days he back-dated); the
      // Received sheet passes no day, so it stays the moment he tapped.
      deliveredAt: extra?.date ? deliveredAtFor(extra.date, now) : now.toISOString(),
      receivedBy: receipt.receivedBy,
      // Links the promise to the witness statement — populates deliveries
      // .receipt_id, which existed unused until receiving was built.
      receiptId: receipt.id,
    });
    setReceiving(null);
  }, [addDeliveryReceipt, updateDelivery]);

  /** The ticket photo, filed to the job's photos as a DRAFT (a supplier's
   *  ticket can carry his pricing — it is never auto-shared to the client
   *  portal) and uploaded by the photo queue. The receipt keeps the durable
   *  storage path the photo row uses, so another device can open it. */
  const fileTicketPhoto = useCallback((uri: string): string => {
    if (!isDeviceLocalUri(uri)) return uri; // a scanned ticket: already in Project Files
    const id = generateUUID();
    const nowIso = new Date().toISOString();
    addProjectPhoto({
      id, projectId, uri, timestamp: nowIso, createdAt: nowIso,
      tag: DELIVERY_TICKET_TAG, location: DELIVERY_TICKET_TAG,
      portalState: { status: 'draft' },
    });
    return user?.id ? buildPhotoStoragePath(user.id, projectId, id, photoExtFromUri(uri)) : uri;
  }, [addProjectPhoto, projectId, user?.id]);

  const commitArrival = useCallback((draft: ArrivalDraft & { hasDamage: boolean; damageNotes: string }, match: Delivery | null) => {
    const ticket = draft.ticketUri ? fileTicketPhoto(draft.ticketUri) : undefined;
    if (match) {
      // The load he was expecting: close THAT delivery, no duplicate.
      commitReceipt(match, {
        receivedBy: draft.receivedBy, hasDamage: draft.hasDamage, damageNotes: draft.damageNotes, notes: draft.notes ?? '',
      }, { bolPhotoUri: ticket, date: draft.date });
      setShowArrived(false);
      nailIt(`Received: ${match.description}`);
      return;
    }
    const { delivery, receipt } = buildArrival({
      projectId, draft: { ...draft, ticketUri: ticket }, now: new Date(), deliveryId: generateUUID(), receiptId: generateUUID(),
    });
    const withDamage: DeliveryReceipt = draft.hasDamage
      ? { ...receipt, hasDamage: true, damageNotes: draft.damageNotes.trim() || undefined }
      : receipt;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Two writers, two collections — the delivery is born delivered and
    // linked to its receipt, so neither write depends on the other's state.
    addDelivery(delivery);
    addDeliveryReceipt(withDamage);
    setShowArrived(false);
    nailIt(`Logged: ${delivery.description}`);
  }, [fileTicketPhoto, commitReceipt, projectId, addDelivery, addDeliveryReceipt]);
  const isDesktop = useIsDesktop();
  // Desktop web only: the look-ahead becomes a register (Late and Upcoming
  // tables). The phone and a native tablet keep today's rows.
  const isDesktopWeb = useIsDesktopWeb();
  const openBuildingAccess = useCallback(() => {
    router.push({ pathname: '/building-access', params: { projectId } });
  }, [router, projectId]);

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top || 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={goBack} title="Deliveries" subtitle="" styles={styles} t={t} onAdd={undefined} />
        <ToolProjectPicker
          toolName="Deliveries"
          message="Deliveries are tracked per project — pick the job whose material you're expecting."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={!project && paramProjectId ? paramProjectId : undefined}
          icon={<Truck size={36} color={t.accent} strokeWidth={1.6} />}
          steps={[
            'Open a project from the Projects tab.',
            'Add what you are expecting and the date it was promised.',
            'Anything past its date shows up here and in Waiting On.',
          ]}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top || 16 }, isDesktopWeb && styles.rootDesktop]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* UX wave B6: the register draws its own title row, so the desk's
          "It's here now" door sits above it. */}
      {isDesktopWeb ? (
        <View style={styles.arrivedDeskRow}>
          <TouchableOpacity
            onPress={() => setShowArrived(true)}
            style={styles.arrivedBtn}
            accessibilityRole="button"
            testID="deliveries-arrived-desk"
          >
            <PackageCheck size={16} color={t.accentLabel} strokeWidth={1.9} />
            <Text style={styles.arrivedBtnText}>It&apos;s here now</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {isDesktopWeb ? (
        <DeliveriesRegister
          projectId={projectId}
          projectName={project.name}
          look={look}
          horizon={horizon}
          onHorizon={setHorizon}
          conflicts={conflicts}
          projectConflicts={projectConflicts}
          hasAccessRules={!!rules}
          onConfirm={confirm}
          onReceive={receive}
          onAdd={() => setShowAdd(true)}
          onOpenBuildingAccess={openBuildingAccess}
        />
      ) : (
        <>
          <Header
            onBack={goBack}
            title={project.name}
            subtitle={summarizeLookahead(look, horizon)}
            styles={styles}
            t={t}
            onAdd={() => setShowAdd(true)}
            onArrived={() => setShowArrived(true)}
          />

          <ScrollView
            {...fabScroll}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
          >
            {/* Building-wide blockers. Above everything: a COI the property manager
                does not hold stops every load, not one. */}
            {projectConflicts.map((c, i) => (
              <TouchableOpacity
                key={`${c.kind}-${i}`}
                style={[styles.banner, c.severity === 'blocking' && styles.bannerBlocking]}
                onPress={() => router.push({ pathname: '/building-access', params: { projectId } })}
                accessibilityRole="button"
                testID={`access-banner-${c.kind}`}
              >
                <Building2 size={15} color={c.severity === 'blocking' ? t.danger : t.accentLabel} strokeWidth={1.9} />
                <View style={styles.bannerText}>
                  <Text style={[styles.bannerTitle, { color: c.severity === 'blocking' ? t.danger : t.accentLabel }]}>
                    {c.message}
                  </Text>
                  <Text style={styles.bannerAction}>{c.action}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {/* LATE — never inside the horizon toggle, never collapsed. */}
            {look.late.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: t.danger }]}>
                  {look.late.length} late
                </Text>
                {look.late.map(v => (
                  <Row key={v.delivery.id} v={v} tone={t.danger} styles={styles} t={t}
                       onConfirm={confirm} onReceive={receive}
                       conflicts={conflictsForDelivery(conflicts, v.delivery.id)} />
                ))}
              </>
            )}

            <View style={styles.horizonRow}>
              {LOOKAHEAD_DAYS.map(d => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setHorizon(d)}
                  style={[styles.horizonChip, isDesktop && segmentedDesktop.segment, horizon === d && styles.horizonChipOn]}
                  accessibilityRole="button"
                  testID={`deliveries-horizon-${d}`}
                >
                  <Text style={[styles.horizonText, horizon === d && styles.horizonTextOn]}>
                    {d} days
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {look.upcoming.length === 0 && look.late.length === 0 ? (
              <EmptyState
                icon={<Truck size={36} color={t.accent} strokeWidth={1.6} />}
                title="Nothing scheduled yet"
                message="Add what you're expecting and the date it was promised. Anything that slips past its date shows up here and in Waiting On, so a late load gets chased before the crew is stood down."
              />
            ) : (
              look.upcoming.map(v => (
                <Row
                  key={v.delivery.id}
                  v={v}
                  tone={v.flag === 'unconfirmed' ? t.accentLabel : t.textSecondary}
                  styles={styles}
                  t={t}
                  onConfirm={confirm}
                  onReceive={receive}
                  conflicts={conflictsForDelivery(conflicts, v.delivery.id)}
                />
              ))
            )}

            {/* Always reachable, not only when something is already wrong — the
                rules have to be recorded before the engine can catch anything. */}
            <TouchableOpacity
              style={styles.buildingLink}
              onPress={() => router.push({ pathname: '/building-access', params: { projectId } })}
              accessibilityRole="button"
              testID="deliveries-building-access"
            >
              <Building2 size={15} color={t.textSecondary} strokeWidth={1.8} />
              <Text style={styles.buildingLinkText}>
                {rules ? 'Building access & bookings' : 'Set up building access'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}

      <ReceiveSheet
        delivery={receiving}
        onClose={() => setReceiving(null)}
        onSave={(form) => { if (receiving) commitReceipt(receiving, form); }}
        styles={styles}
        t={t}
      />

      <ArrivedSheet
        visible={showArrived}
        onClose={() => setShowArrived(false)}
        onSave={commitArrival}
        deliveries={scoped}
        projectId={projectId}
        supplierChips={supplierChips}
        defaultReceivedBy={user?.name?.trim() || ''}
        scanPrefill={scanPrefill}
        styles={styles}
        t={t}
      />

      <AddDeliverySheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={(draft) => {
          const now = new Date().toISOString();
          addDelivery({
            id: generateUUID(),
            projectId,
            description: draft.description.trim(),
            supplier: draft.supplier.trim(),
            expectedDate: draft.expectedDate.trim(),
            window: draft.window.trim() || undefined,
            status: 'scheduled',
            createdAt: now,
            updatedAt: now,
          });
          setShowAdd(false);
        }}
        styles={styles}
        t={t}
      />
    </View>
  );
}

function Header({
  onBack, title, subtitle, styles, t, onAdd, onArrived,
}: {
  onBack: () => void; title: string; subtitle: string;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors; onAdd?: () => void;
  /** UX wave B6: "It's here now" — a delivery nobody logged. */
  onArrived?: () => void;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
      </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.headerEyebrow}>Deliveries · MAGE ID</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onArrived ? (
        <TouchableOpacity onPress={onArrived} style={styles.arrivedBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="It's here now. Log a delivery that just arrived" testID="deliveries-arrived">
          <PackageCheck size={16} color={t.accentLabel} strokeWidth={1.9} />
          <Text style={styles.arrivedBtnText}>Here now</Text>
        </TouchableOpacity>
      ) : null}
      {onAdd ? (
        <TouchableOpacity onPress={onAdd} style={[styles.headerBtn, styles.headerCta]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add delivery">
          <Plus size={18} color="#FFFFFF" strokeWidth={1.75} />
        </TouchableOpacity>
      ) : <View style={styles.headerBtn} />}
    </View>
  );
}

function Row({
  v, tone, styles, t, onConfirm, onReceive, conflicts = [],
}: {
  v: DeliveryView; tone: string;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
  onConfirm: (d: Delivery) => void; onReceive: (d: Delivery) => void;
  conflicts?: AccessConflict[];
}) {
  const d = v.delivery;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle} numberOfLines={1}>{d.description}</Text>
        <Text style={[styles.rowFlag, { color: tone }]} numberOfLines={1}>{v.label}</Text>
      </View>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {d.supplier}
        {d.window ? ` · ${d.window}` : ''}
        {d.poNumber ? ` · PO ${d.poNumber}` : ''}
      </Text>

      {/* The building's objection, on the row it applies to. A confirmed date
          with no elevator booked still means the truck goes home. */}
      {conflicts.map((c, i) => (
        <View key={`${c.kind}-${i}`} style={styles.conflict}>
          <View style={[styles.conflictBar, { backgroundColor: c.severity === 'blocking' ? t.danger : t.accentLabel }]} />
          <View style={styles.conflictText}>
            <Text style={[styles.conflictTitle, { color: c.severity === 'blocking' ? t.danger : t.accentLabel }]}>
              {c.message}
            </Text>
            <Text style={styles.conflictAction}>{c.action}</Text>
          </View>
        </View>
      ))}
      <View style={styles.rowCtas}>
        {d.status !== 'confirmed' && (
          <TouchableOpacity onPress={() => onConfirm(d)} style={styles.rowBtn} accessibilityRole="button" testID={`confirm-${d.id}`}>
            <Check size={13} color={t.textSecondary} strokeWidth={2} />
            <Text style={styles.rowBtnText}>Confirm</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => onReceive(d)} style={[styles.rowBtn, styles.rowBtnPrimary]} accessibilityRole="button" testID={`receive-${d.id}`}>
          <Truck size={13} color={t.accentLabel} strokeWidth={2} />
          <Text style={[styles.rowBtnText, { color: t.accentLabel }]}>Received</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface ReceiveForm { receivedBy: string; hasDamage: boolean; damageNotes: string; notes: string }

/**
 * The receiving sheet — the one moment the load is physically in front of
 * someone. Damage recorded here is evidence; damage remembered next week is an
 * argument. Nothing is required except the tap, so a busy super is never blocked
 * from closing out a delivery, but the damage question is asked EVERY time
 * rather than hidden behind an optional field nobody opens.
 */
function ReceiveSheet({
  delivery, onClose, onSave, styles, t,
}: {
  delivery: Delivery | null; onClose: () => void; onSave: (f: ReceiveForm) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
}) {
  const [form, setForm] = useState<ReceiveForm>({ receivedBy: '', hasDamage: false, damageNotes: '', notes: '' });
  // Desktop: a centred 560 card; a phone keeps its bottom sheet (every frame
  // part is null there). Called before the early return below.
  const isDesktop = useIsDesktop();
  const f = useSheetFrame('form', { visible: !!delivery, animationType: 'slide' });
  const save = () => onSave(form);
  useSheetPrimaryHotkey(!!delivery, save);

  // Reset per delivery so last load's damage note never rides along to the next.
  React.useEffect(() => {
    if (delivery) setForm({ receivedBy: '', hasDamage: false, damageNotes: '', notes: '' });
  }, [delivery?.id]);

  if (!delivery) return null;

  return (
    <Modal visible animationType={f.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.overlay, f.overlay]}>
        <View style={[styles.sheet, f.card]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Receive delivery</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textSecondary} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>

          <Text style={styles.receiveWhat} numberOfLines={2}>
            {delivery.description} — {delivery.supplier}
          </Text>

          <Text style={styles.fieldLabel}>Received by</Text>
          <TextInput
            style={styles.input}
            value={form.receivedBy}
            onChangeText={(x) => setForm(p => ({ ...p, receivedBy: x }))}
            placeholder="Who signed for it"
            placeholderTextColor={t.textMuted}
            testID="receive-by"
          />

          <TouchableOpacity
            style={[styles.damageToggle, form.hasDamage && styles.damageToggleOn]}
            onPress={() => setForm(p => ({ ...p, hasDamage: !p.hasDamage }))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.hasDamage }}
            testID="receive-damage"
          >
            <View style={[styles.damageBox, form.hasDamage && { backgroundColor: t.danger, borderColor: t.danger }]}>
              {form.hasDamage ? <Check size={13} color="#FFFFFF" strokeWidth={2.5} /> : null}
            </View>
            <Text style={[styles.damageLabel, form.hasDamage && { color: t.danger }]}>
              Something arrived damaged or short
            </Text>
          </TouchableOpacity>

          {form.hasDamage ? (
            <>
              <Text style={styles.fieldLabel}>What was wrong</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={form.damageNotes}
                onChangeText={(x) => setForm(p => ({ ...p, damageNotes: x }))}
                placeholder="Two lites cracked, one unit short"
                placeholderTextColor={t.textMuted}
                multiline
                testID="receive-damage-notes"
              />
              <Text style={styles.damageHint}>
                Photograph it at the tailgate. This note is what a claim rests on.
              </Text>
            </>
          ) : null}

          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput
            style={styles.input}
            value={form.notes}
            onChangeText={(x) => setForm(p => ({ ...p, notes: x }))}
            placeholder="Left in the north bay"
            placeholderTextColor={t.textMuted}
            testID="receive-notes"
          />

          <TouchableOpacity
            style={[styles.saveBtn, isDesktop && styles.saveBtnDesktop]}
            onPress={() => onSave(form)}
            accessibilityRole="button"
            testID="receive-save"
          >
            <Text style={styles.saveBtnText}>Mark received</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

interface Draft { description: string; supplier: string; expectedDate: string; window: string }

function AddDeliverySheet({
  visible, onClose, onSave, styles, t,
}: {
  visible: boolean; onClose: () => void; onSave: (d: Draft) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft>({ description: '', supplier: '', expectedDate: todayLocal(), window: '' });
  const [pickingDate, setPickingDate] = useState(false);
  const valid = draft.description.trim().length > 0 && draft.supplier.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.expectedDate.trim());
  const isDesktop = useIsDesktop();
  const f = useSheetFrame('form', { visible, animationType: 'slide' });
  const save = () => { if (valid) { onSave(draft); setDraft({ description: '', supplier: '', expectedDate: todayLocal(), window: '' }); } };
  useSheetPrimaryHotkey(visible && valid, save);

  return (
    <Modal visible={visible} transparent animationType={f.animationType} onRequestClose={onClose}>
      {/* UX-F15: four inputs + Save in a bottom-anchored sheet with no keyboard
          handling — the keyboard covered "Promised date", "Window" and the Save
          button, and the first tap on Save only dismissed the keyboard. Same
          pattern as app/login.tsx. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.overlay, f.overlay]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }, f.card]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Expecting a delivery</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} style={styles.sheetScroll}>

          <Text style={styles.fieldLabel}>What</Text>
          <TextInput
            style={styles.input}
            value={draft.description}
            onChangeText={(x) => setDraft(p => ({ ...p, description: x }))}
            placeholder="14 windows, roof trusses…"
            placeholderTextColor={t.textMuted}
            testID="delivery-description"
          />

          <Text style={styles.fieldLabel}>Supplier</Text>
          <TextInput
            style={styles.input}
            value={draft.supplier}
            onChangeText={(x) => setDraft(p => ({ ...p, supplier: x }))}
            placeholder="Who is sending it"
            placeholderTextColor={t.textMuted}
            testID="delivery-supplier"
          />

          <Text style={styles.fieldLabel}>Promised date</Text>
          {/* UX wave B6: a picker, never a typed YYYY-MM-DD. */}
          <TouchableOpacity
            style={[styles.input, isDesktop && desktopField('sm'), styles.dateField]}
            onPress={() => setPickingDate(true)}
            accessibilityRole="button"
            accessibilityLabel={`Promised date ${formatCalendarDay(draft.expectedDate) || draft.expectedDate}. Change`}
            testID="delivery-date"
          >
            <CalendarDays size={15} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={styles.dateFieldText}>{formatCalendarDay(draft.expectedDate, { weekday: 'short', month: 'short', day: 'numeric' }) || draft.expectedDate}</Text>
          </TouchableOpacity>
          <DatePickerModal
            visible={pickingDate}
            value={parseCalendarDay(draft.expectedDate)?.toISOString() ?? ''}
            allowFuture
            title="Promised date"
            onClose={() => setPickingDate(false)}
            onChange={(iso) => { setDraft(p => ({ ...p, expectedDate: calendarDayOf(iso) ?? p.expectedDate })); setPickingDate(false); }}
          />

          <Text style={styles.fieldLabel}>
            Window <Text style={styles.fieldHint}>optional — the dock slot, if there is one</Text>
          </Text>
          <TextInput
            style={[styles.input, isDesktop && (desktopField('sm') as TextStyle)]}
            value={draft.window}
            onChangeText={(x) => setDraft(p => ({ ...p, window: x }))}
            placeholder="07:00-11:00"
            placeholderTextColor={t.textMuted}
            testID="delivery-window"
          />

          <TouchableOpacity
            style={[styles.saveBtn, !valid && styles.saveBtnOff, isDesktop && styles.saveBtnDesktop]}
            onPress={() => { if (valid) { onSave(draft); setDraft({ description: '', supplier: '', expectedDate: todayLocal(), window: '' }); } }}
            disabled={!valid}
            accessibilityRole="button"
            testID="delivery-save"
          >
            <CalendarDays size={16} color="#FFFFFF" strokeWidth={1.75} />
            <Text style={styles.saveBtnText}>Add to the look-ahead</Text>
          </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ArrivalForm = ArrivalDraft & { hasDamage: boolean; damageNotes: string };
interface ScanPrefill { what: string; supplier: string; date: string | null; poNumber: string; ticket: string | null }

/**
 * "It's here now" (UX wave B6). One sheet for a load nobody logged: what, the
 * supplier (his recent ones as chips), the ticket photo, who received it (his
 * own name until he changes it), the day on a picker, and the damage question
 * receiving always asks. A due or late load from the same supplier is offered
 * as "Mark this one received" so it closes that delivery instead of adding a
 * second. A scanned ticket opens it pre-filled, labelled "from scan, check it".
 */
function ArrivedSheet({
  visible, onClose, onSave, deliveries, projectId, supplierChips, defaultReceivedBy, scanPrefill, styles, t,
}: {
  visible: boolean; onClose: () => void;
  onSave: (form: ArrivalForm, match: Delivery | null) => void;
  deliveries: Delivery[]; projectId: string; supplierChips: string[]; defaultReceivedBy: string;
  scanPrefill: ScanPrefill | null;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
}) {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();
  const frame = useSheetFrame('form', { visible, animationType: 'slide' });
  const blank = useCallback((): ArrivalForm => ({
    what: scanPrefill?.what ?? '',
    supplier: scanPrefill?.supplier ?? '',
    receivedBy: defaultReceivedBy,
    date: scanPrefill?.date ?? todayLocal(),
    ticketUri: scanPrefill?.ticket ?? null,
    poNumber: scanPrefill?.poNumber ?? '',
    notes: '',
    hasDamage: false,
    damageNotes: '',
  }), [scanPrefill, defaultReceivedBy]);
  const [form, setForm] = useState<ArrivalForm>(blank);
  const [pickingDate, setPickingDate] = useState(false);
  const [useMatch, setUseMatch] = useState(true);
  // Fresh every time it opens: last load's damage note never rides along.
  React.useEffect(() => { if (visible) { setForm(blank()); setUseMatch(true); } }, [visible, blank]);

  const problem = arrivalProblem(form, todayLocal());
  const match = useMemo(
    () => lateMatchForSupplier(deliveries, projectId, form.supplier, todayLocal()),
    [deliveries, projectId, form.supplier],
  );
  const closing = useMatch ? match : null;
  // Closing an expected load needs no "what" (the delivery already says it).
  const blocked = closing
    ? (!form.supplier.trim() ? 'Name the supplier.' : arrivalDayProblem(form.date, todayLocal()))
    : problem;
  const save = () => { if (!blocked) onSave(form, closing); };
  useSheetPrimaryHotkey(visible && !blocked, save);
  const fromScan = (v: string | null | undefined) => !!scanPrefill && !!v && v.trim().length > 0;

  const takeTicket = useCallback(async () => {
    try {
      let res: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Camera access needed', 'Allow camera access in Settings to photograph the ticket.'); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      }
      if (res.canceled || !res.assets[0]?.uri) return;
      const uri = res.assets[0].uri;
      setForm(p => ({ ...p, ticketUri: uri }));
    } catch (e) {
      showAlert('Couldn\u2019t open the camera', 'Try again.');
    }
  }, []);

  return (
    <Modal visible={visible} transparent animationType={frame.animationType} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.overlay, frame.overlay]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }, frame.card]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>It&apos;s here now</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} style={styles.sheetScroll}>
            <Text style={styles.fieldLabel}>
              Supplier{fromScan(scanPrefill?.supplier) ? <Text style={styles.fieldHint}>{` · ${FROM_SCAN_LABEL}`}</Text> : null}
            </Text>
            <TextInput
              style={styles.input}
              value={form.supplier}
              onChangeText={(x) => setForm(p => ({ ...p, supplier: x }))}
              placeholder="Who sent it"
              placeholderTextColor={t.textMuted}
              testID="arrived-supplier"
            />
            {supplierChips.length > 0 ? (
              <View style={styles.chipRow}>
                {supplierChips.map(sup => (
                  <TouchableOpacity
                    key={sup}
                    style={[styles.chip, form.supplier.trim().toLowerCase() === sup.toLowerCase() && styles.chipOn]}
                    onPress={() => setForm(p => ({ ...p, supplier: sup }))}
                    accessibilityRole="button"
                    testID={`arrived-supplier-chip-${sup}`}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>{sup}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {match ? (
              <TouchableOpacity
                style={[styles.damageToggle, useMatch && styles.matchOn]}
                onPress={() => setUseMatch(v => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: useMatch }}
                testID="arrived-match"
              >
                <View style={[styles.damageBox, useMatch && { backgroundColor: t.accentFill, borderColor: t.accentFill }]}>
                  {useMatch ? <Check size={13} color={Colors.textOnAccent} strokeWidth={2.5} /> : null}
                </View>
                <Text style={styles.damageLabel}>
                  Mark this one received: {match.description} (expected {formatCalendarDay(match.expectedDate, { month: 'short', day: 'numeric' }) || match.expectedDate})
                </Text>
              </TouchableOpacity>
            ) : null}

            {!closing ? (
              <>
                <Text style={styles.fieldLabel}>
                  What arrived{fromScan(scanPrefill?.what) ? <Text style={styles.fieldHint}>{` · ${FROM_SCAN_LABEL}`}</Text> : null}
                </Text>
                <TextInput
                  style={styles.input}
                  value={form.what}
                  onChangeText={(x) => setForm(p => ({ ...p, what: x }))}
                  placeholder="40 sheets 5/8 board, 2 pallets block"
                  placeholderTextColor={t.textMuted}
                  testID="arrived-what"
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Ticket</Text>
            {form.ticketUri && isDeviceLocalUri(form.ticketUri) ? (
              <View style={styles.ticketRow}>
                <Image source={{ uri: form.ticketUri }} style={styles.ticketThumb} contentFit="cover" />
                <TouchableOpacity onPress={() => { void takeTicket(); }} accessibilityRole="button" testID="arrived-ticket-retake">
                  <Text style={styles.linkText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setForm(p => ({ ...p, ticketUri: null }))} accessibilityRole="button" testID="arrived-ticket-remove">
                  <Text style={styles.linkText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : form.ticketUri ? (
              <Text style={styles.fieldHint} testID="arrived-ticket-scanned">The scanned ticket is attached (it is in Project Files).</Text>
            ) : (
              <TouchableOpacity style={styles.buildingLink} onPress={() => { void takeTicket(); }} accessibilityRole="button" testID="arrived-ticket">
                <Camera size={16} color={t.textSecondary} strokeWidth={1.8} />
                <Text style={styles.buildingLinkText}>{Platform.OS === 'web' ? 'Attach the ticket photo' : 'Photograph the ticket'}</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>Received by</Text>
            <TextInput
              style={styles.input}
              value={form.receivedBy}
              onChangeText={(x) => setForm(p => ({ ...p, receivedBy: x }))}
              placeholder="Who signed for it"
              placeholderTextColor={t.textMuted}
              testID="arrived-by"
            />

            <Text style={styles.fieldLabel}>
              Day{fromScan(scanPrefill?.date) ? <Text style={styles.fieldHint}>{` · ${FROM_SCAN_LABEL}`}</Text> : null}
            </Text>
            <TouchableOpacity
              style={[styles.input, styles.dateField, isDesktop && desktopField('sm')]}
              onPress={() => setPickingDate(true)}
              accessibilityRole="button"
              testID="arrived-date"
            >
              <CalendarDays size={15} color={t.textSecondary} strokeWidth={1.75} />
              <Text style={styles.dateFieldText}>{form.date === todayLocal() ? 'Today' : formatCalendarDay(form.date, { weekday: 'short', month: 'short', day: 'numeric' }) || form.date}</Text>
            </TouchableOpacity>
            <DatePickerModal
              visible={pickingDate}
              value={parseCalendarDay(form.date)?.toISOString() ?? ''}
              title="Arrived on"
              onClose={() => setPickingDate(false)}
              onChange={(iso) => { setForm(p => ({ ...p, date: calendarDayOf(iso) ?? p.date })); setPickingDate(false); }}
            />

            <TouchableOpacity
              style={[styles.damageToggle, form.hasDamage && styles.damageToggleOn]}
              onPress={() => setForm(p => ({ ...p, hasDamage: !p.hasDamage }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: form.hasDamage }}
              testID="arrived-damage"
            >
              <View style={[styles.damageBox, form.hasDamage && { backgroundColor: t.danger, borderColor: t.danger }]}>
                {form.hasDamage ? <Check size={13} color={Colors.textOnAccent} strokeWidth={2.5} /> : null}
              </View>
              <Text style={[styles.damageLabel, form.hasDamage && { color: t.danger }]}>Something arrived damaged or short</Text>
            </TouchableOpacity>
            {form.hasDamage ? (
              <TextInput
                style={[styles.input, styles.inputMulti, { marginTop: 8 }]}
                value={form.damageNotes}
                onChangeText={(x) => setForm(p => ({ ...p, damageNotes: x }))}
                placeholder="Two lites cracked, one unit short"
                placeholderTextColor={t.textMuted}
                multiline
                testID="arrived-damage-notes"
              />
            ) : null}

            {blocked ? <Text style={styles.damageHint} testID="arrived-blocked">{blocked}</Text> : null}
            <TouchableOpacity
              style={[styles.saveBtn, blocked ? styles.saveBtnOff : null, isDesktop && styles.saveBtnDesktop]}
              onPress={save}
              disabled={!!blocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!blocked }}
              testID="arrived-save"
            >
              <PackageCheck size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
              <Text style={styles.saveBtnText}>{closing ? 'Mark received' : 'Log it as received'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  // Desktop web: the register draws its own title row inside the column.
  rootDesktop: { paddingTop: 0 },

  header: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
  headerBtn: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerCta: { backgroundColor: t.accentFill, borderRadius: Tokens.radius.md },
  headerText: { flex: 1 },
  headerEyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.8 },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  headerSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },

  content: { padding: 16, gap: 10 },
  sectionTitle: { ...Type.monoCaption, letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: 4 },

  horizonRow: { flexDirection: 'row' as const, gap: 8, marginTop: 14, marginBottom: 2 },
  horizonChip: {
    flex: 1, paddingVertical: 9, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surface,
    alignItems: 'center' as const,
  },
  horizonChipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  horizonText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  horizonTextOn: { color: t.accentLabel },

  row: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 14, gap: 6,
  },
  rowHead: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 10 },
  rowTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  rowFlag: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  rowMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  rowCtas: { flexDirection: 'row' as const, gap: 8, marginTop: 4 },
  rowBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  rowBtnPrimary: { borderColor: t.accent + '40', backgroundColor: t.accentSoft },
  rowBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },

  // A building conflict on a delivery row. The severity bar carries the state
  // in FORM as well as colour, so it still reads at a glance when several rows
  // are scanned at once — and does not depend on colour alone.
  conflict: { flexDirection: 'row' as const, gap: 9, marginTop: 2 },
  conflictBar: { width: 3, borderRadius: 2 },
  conflictText: { flex: 1, gap: 1 },
  conflictTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  conflictAction: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },

  banner: {
    flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const,
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 13,
  },
  bannerBlocking: { borderColor: t.danger + '55' },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  bannerAction: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },

  buildingLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    justifyContent: 'center' as const, marginTop: 6, paddingVertical: 12,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  buildingLinkText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 18,
    maxHeight: '90%', // UX-F15: bounded so the body scrolls above the keyboard
  },
  sheetScroll: { flexShrink: 1 },
  sheetHead: { flexDirection: 'row' as const, alignItems: 'center' as const },
  sheetTitle: { flex: 1, ...Type.serifHeadline, color: t.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 14, marginBottom: 6 },
  fieldHint: { fontSize: Type.caption2.fontSize, fontWeight: '400' as const, color: t.textMuted },
  input: {
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Type.subhead.fontSize, color: t.text, backgroundColor: t.bg,
  },
  saveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    marginTop: 20, minHeight: 50, borderRadius: Tokens.radius.lg, backgroundColor: t.accentFill,
  },
  saveBtnOff: { opacity: 0.45 },
  // Desktop: the sheet's primary hugs its label at the right, 40 tall.
  saveBtnDesktop: { alignSelf: 'flex-end' as const, minWidth: Layout.button.minWidth.lg, height: Layout.control.md, minHeight: Layout.control.md, paddingHorizontal: 20 },
  receiveWhat: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, marginBottom: 4 },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' as const },

  // Damage is a checkbox, not a buried field. It is asked on EVERY receive,
  // because the only honest moment to record it is with the load in front of
  // you — and it is the single field a claim later rests on.
  damageToggle: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    marginTop: 14, padding: 12,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  damageToggleOn: { borderColor: t.danger + '55', backgroundColor: t.danger + '10' },
  damageBox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: t.line,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  damageLabel: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  damageHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 6, lineHeight: 15 },

  saveBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },

  // UX wave B6 — "It's here now". Theme tokens only; no new surface card.
  arrivedBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    minHeight: 40, paddingHorizontal: 12, marginRight: 6,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.accent + '40', backgroundColor: t.accentSoft,
  },
  arrivedBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  arrivedDeskRow: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, paddingHorizontal: 16, paddingTop: 12 },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  chip: {
    minHeight: 36, justifyContent: 'center' as const, paddingHorizontal: 12, maxWidth: 220,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg,
  },
  chipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  matchOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  ticketRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 },
  ticketThumb: { width: 64, height: 64, borderRadius: Tokens.radius.md, backgroundColor: t.bg },
  linkText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accentLabel, paddingVertical: 8 },
  dateField: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  dateFieldText: { fontSize: Type.subhead.fontSize, color: t.text },
});
