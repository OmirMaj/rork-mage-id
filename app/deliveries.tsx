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

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Plus, Truck, X, Check, CalendarDays, Building2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import EmptyState from '@/components/EmptyState';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import {
  buildLookahead, summarizeLookahead, LOOKAHEAD_DAYS,
  type Delivery, type DeliveryView, type LookaheadDays,
} from '@/utils/deliverySchedule';
import {
  findAccessConflicts, conflictsForDelivery, type AccessConflict,
} from '@/utils/buildingAccess';
import type { DeliveryReceipt } from '@/utils/deliverySchedule';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();

  const {
    projects, deliveries, addDelivery, updateDelivery,
    getBuildingAccess, accessReservations, addDeliveryReceipt,
  } = useProjects();

  // Reached from the chase list, search or the sidebar with no project — same
  // picker pattern as the other tool screens.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const [horizon, setHorizon] = useState<LookaheadDays>(7);
  const [showAdd, setShowAdd] = useState(false);
  const [receiving, setReceiving] = useState<Delivery | null>(null);

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
  }) => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = new Date();
    const receipt: DeliveryReceipt = {
      id: generateUUID(),
      projectId: d.projectId,
      deliveryId: d.id,
      date: todayLocal(),
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
      deliveredAt: now.toISOString(),
      receivedBy: receipt.receivedBy,
      // Links the promise to the witness statement — populates deliveries
      // .receipt_id, which existed unused until receiving was built.
      receiptId: receipt.id,
    });
    setReceiving(null);
  }, [addDeliveryReceipt, updateDelivery]);

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top || 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={() => router.back()} title="Deliveries" subtitle="" styles={styles} t={t} onAdd={undefined} />
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
    <View style={[styles.root, { paddingTop: insets.top || 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header
        onBack={() => router.back()}
        title={project.name}
        subtitle={summarizeLookahead(look, horizon)}
        styles={styles}
        t={t}
        onAdd={() => setShowAdd(true)}
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
              style={[styles.horizonChip, horizon === d && styles.horizonChipOn]}
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

      <ReceiveSheet
        delivery={receiving}
        onClose={() => setReceiving(null)}
        onSave={(form) => { if (receiving) commitReceipt(receiving, form); }}
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
  onBack, title, subtitle, styles, t, onAdd,
}: {
  onBack: () => void; title: string; subtitle: string;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors; onAdd?: () => void;
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

  // Reset per delivery so last load's damage note never rides along to the next.
  React.useEffect(() => {
    if (delivery) setForm({ receivedBy: '', hasDamage: false, damageNotes: '', notes: '' });
  }, [delivery?.id]);

  if (!delivery) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
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
            style={styles.saveBtn}
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
  const valid = draft.description.trim().length > 0 && draft.supplier.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.expectedDate.trim());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Expecting a delivery</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

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
          <TextInput
            style={styles.input}
            value={draft.expectedDate}
            onChangeText={(x) => setDraft(p => ({ ...p, expectedDate: x }))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            testID="delivery-date"
          />

          <Text style={styles.fieldLabel}>
            Window <Text style={styles.fieldHint}>optional — the dock slot, if there is one</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={draft.window}
            onChangeText={(x) => setDraft(p => ({ ...p, window: x }))}
            placeholder="07:00-11:00"
            placeholderTextColor={t.textMuted}
            testID="delivery-window"
          />

          <TouchableOpacity
            style={[styles.saveBtn, !valid && styles.saveBtnOff]}
            onPress={() => { if (valid) { onSave(draft); setDraft({ description: '', supplier: '', expectedDate: todayLocal(), window: '' }); } }}
            disabled={!valid}
            accessibilityRole="button"
            testID="delivery-save"
          >
            <CalendarDays size={16} color="#FFFFFF" strokeWidth={1.75} />
            <Text style={styles.saveBtnText}>Add to the look-ahead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

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
  },
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
});
