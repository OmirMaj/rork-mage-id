// building-access.tsx — what the building requires, and what has been booked.
//
// The rules recorded here are not a reference document. They are the inputs to
// utils/buildingAccess.findAccessConflicts, which is what puts "no freight
// elevator booked for Thursday" on the delivery row itself. Nothing on this
// screen is worth reading twice; it exists so the deliveries screen can be
// right.
//
// WHY THE REQUIREMENTS ARE OFF BY DEFAULT. Most jobs are not in occupied
// towers. A building that requires nothing must produce no conflicts at all —
// inventing constraints would train people to ignore the ones that are real.
//
// All maths lives in utils/buildingAccess (pure, pinned by test:building-access);
// this file is a form plus a booking list.

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Modal, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Plus, Building2, X, Check, ArrowUpDown, Truck, Moon, IdCard } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import {
  findAccessConflicts, summarizeAccess,
  type BuildingAccessRules, type AccessReservation, type AccessKind,
} from '@/utils/buildingAccess';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Today as YYYY-MM-DD in LOCAL time — toISOString() rolls the date over in the
 *  evening for anyone west of UTC, which would book the wrong morning. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const KIND_LABEL: Record<AccessKind, string> = {
  freight_elevator: 'Freight elevator',
  dock: 'Loading dock',
  after_hours: 'After hours',
  badging: 'Badging',
};

const KIND_ICON: Record<AccessKind, typeof ArrowUpDown> = {
  freight_elevator: ArrowUpDown,
  dock: Truck,
  after_hours: Moon,
  badging: IdCard,
};

export default function BuildingAccessScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();

  const {
    projects, deliveries,
    getBuildingAccess, setBuildingAccess,
    accessReservations, addReservation, updateReservation, deleteReservation,
  } = useProjects();

  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const [showAdd, setShowAdd] = useState(false);

  const rules = getBuildingAccess(projectId);
  const scopedReservations = useMemo(
    () => accessReservations
      .filter(r => r.projectId === projectId)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [accessReservations, projectId],
  );
  const scopedDeliveries = useMemo(
    () => deliveries.filter(d => d.projectId === projectId),
    [deliveries, projectId],
  );

  const conflicts = useMemo(() => findAccessConflicts({
    rules, deliveries: scopedDeliveries, reservations: scopedReservations,
  }), [rules, scopedDeliveries, scopedReservations]);

  /** Every edit writes the whole rules row — one project, one set of rules, so
   *  there is no partial-update path to get wrong. */
  const patch = useCallback((updates: Partial<BuildingAccessRules>) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const base: BuildingAccessRules = rules ?? {
      projectId,
      requiresFreightElevator: false,
      requiresDockReservation: false,
      requiresCoiOnFile: false,
      requiresBadging: false,
      afterHoursRequiresApproval: false,
      updatedAt: new Date().toISOString(),
    };
    setBuildingAccess({ ...base, ...updates });
  }, [rules, projectId, setBuildingAccess]);

  const confirmSlot = useCallback((r: AccessReservation) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    updateReservation(r.id, { status: 'confirmed', confirmedAt: new Date().toISOString() });
  }, [updateReservation]);

  const denySlot = useCallback((r: AccessReservation) => {
    // Recording a refusal is what moves the delivery, so it is worth a beat of
    // friction rather than a mis-tap.
    showAlert(
      'Building refused this slot?',
      `${KIND_LABEL[r.kind]} on ${r.date}. The delivery it covers will be flagged as blocked.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refused', style: 'destructive', onPress: () => updateReservation(r.id, { status: 'denied' }) },
      ],
    );
  }, [updateReservation]);

  const removeSlot = useCallback((r: AccessReservation) => {
    showAlert(
      'Delete this booking?',
      `${KIND_LABEL[r.kind]} on ${r.date}. This does not cancel it with the building.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteReservation(r.id) },
      ],
    );
  }, [deleteReservation]);

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top || 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={() => router.back()} title="Building access" subtitle="" styles={styles} t={t} onAdd={undefined} />
        <ToolProjectPicker
          toolName="Building access"
          message="Building rules are per project — pick the job whose building you're working in."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={!project && paramProjectId ? paramProjectId : undefined}
          icon={<Building2 size={36} color={t.accent} strokeWidth={1.6} />}
          steps={[
            'Record what the building requires — elevator, dock, COI, badges.',
            'Book the slots you need and mark them confirmed when granted.',
            'Any delivery with nowhere to land gets flagged on the Deliveries screen.',
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
        subtitle={summarizeAccess(conflicts) ?? 'Nothing blocking'}
        styles={styles}
        t={t}
        onAdd={() => setShowAdd(true)}
      />

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
      >
        <Text style={styles.sectionTitle}>What the building requires</Text>
        <View style={styles.card}>
          <Toggle
            label="Freight elevator must be booked"
            hint="Every delivery needs a reserved slot."
            value={rules?.requiresFreightElevator ?? false}
            onChange={(v) => patch({ requiresFreightElevator: v })}
            styles={styles} t={t} testID="req-elevator"
          />
          <Toggle
            label="Loading dock must be booked"
            hint="The dock takes one truck at a time."
            value={rules?.requiresDockReservation ?? false}
            onChange={(v) => patch({ requiresDockReservation: v })}
            styles={styles} t={t} testID="req-dock"
          />
          <Toggle
            label="Building holds a COI"
            hint="Names the building as additional insured. Their copy, not yours."
            value={rules?.requiresCoiOnFile ?? false}
            onChange={(v) => patch({ requiresCoiOnFile: v })}
            styles={styles} t={t} testID="req-coi"
          />
          {rules?.requiresCoiOnFile ? (
            <Field
              label="Sent to the building on"
              value={rules?.coiOnFileAt ?? ''}
              placeholder="YYYY-MM-DD — leave blank until it is"
              onChange={(v) => patch({ coiOnFileAt: v.trim() || undefined })}
              styles={styles} t={t} testID="coi-date"
            />
          ) : null}
          <Toggle
            label="Workers must be badged"
            hint="Nobody gets past the lobby without one."
            value={rules?.requiresBadging ?? false}
            onChange={(v) => patch({ requiresBadging: v })}
            styles={styles} t={t} testID="req-badging"
          />
          {rules?.requiresBadging ? (
            <Field
              label="Badge lead time (days)"
              value={rules?.badgeLeadTimeDays == null ? '' : String(rules.badgeLeadTimeDays)}
              placeholder="5"
              keyboardType="number-pad"
              onChange={(v) => {
                const n = parseInt(v, 10);
                patch({ badgeLeadTimeDays: Number.isFinite(n) && n >= 0 ? n : undefined });
              }}
              styles={styles} t={t} testID="badge-lead"
            />
          ) : null}
          <Toggle
            label="After-hours needs written approval"
            hint="Anything outside permitted work hours."
            value={rules?.afterHoursRequiresApproval ?? false}
            onChange={(v) => patch({ afterHoursRequiresApproval: v })}
            styles={styles} t={t} testID="req-after-hours"
          />
        </View>

        <Text style={styles.sectionTitle}>Who to call</Text>
        <View style={styles.card}>
          <Field
            label="Property manager"
            value={rules?.buildingContact ?? ''}
            placeholder="Dana Ruiz, Hines"
            onChange={(v) => patch({ buildingContact: v.trim() || undefined })}
            styles={styles} t={t} testID="building-contact"
          />
          <Field
            label="Phone"
            value={rules?.buildingPhone ?? ''}
            placeholder="(312) 555-0148"
            keyboardType="phone-pad"
            onChange={(v) => patch({ buildingPhone: v.trim() || undefined })}
            styles={styles} t={t} testID="building-phone"
          />
          <Field
            label="Permitted work hours"
            value={rules?.workHours ?? ''}
            placeholder="07:00-17:00"
            onChange={(v) => patch({ workHours: v.trim() || undefined })}
            styles={styles} t={t} testID="work-hours"
          />
        </View>

        <Text style={styles.sectionTitle}>
          Bookings{scopedReservations.length > 0 ? ` · ${scopedReservations.length}` : ''}
        </Text>
        {scopedReservations.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Nothing booked. A requested slot is not a booking — mark it confirmed only when
              the building says yes, so a truck is never sent against a slot nobody granted.
            </Text>
          </View>
        ) : (
          scopedReservations.map(r => (
            <SlotRow
              key={r.id}
              r={r}
              onConfirm={confirmSlot}
              onDeny={denySlot}
              onDelete={removeSlot}
              styles={styles}
              t={t}
            />
          ))
        )}
      </ScrollView>

      <AddSlotSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={(draft) => {
          const now = new Date().toISOString();
          addReservation({
            id: generateUUID(),
            projectId,
            kind: draft.kind,
            date: draft.date.trim(),
            window: draft.window.trim() || undefined,
            // Always starts as requested. A slot you have asked for is not a
            // slot you have — that distinction is the whole point.
            status: 'requested',
            requestedAt: now,
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
        <Text style={styles.headerEyebrow}>Building access · MAGE ID</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onAdd ? (
        <TouchableOpacity onPress={onAdd} style={[styles.headerBtn, styles.headerCta]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Book a slot">
          <Plus size={18} color="#FFFFFF" strokeWidth={1.75} />
        </TouchableOpacity>
      ) : <View style={styles.headerBtn} />}
    </View>
  );
}

function Toggle({
  label, hint, value, onChange, styles, t, testID,
}: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors; testID: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.line, true: t.accent }}
        thumbColor="#FFFFFF"
        testID={testID}
      />
    </View>
  );
}

function Field({
  label, value, placeholder, onChange, styles, t, testID, keyboardType,
}: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors; testID: string;
  keyboardType?: 'number-pad' | 'phone-pad';
}) {
  // Local draft so a keystroke does not write through the context (and the
  // offline queue) on every character.
  const [draft, setDraft] = useState(value);
  React.useEffect(() => { setDraft(value); }, [value]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onBlur={() => onChange(draft)}
        onSubmitEditing={() => onChange(draft)}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        keyboardType={keyboardType}
        returnKeyType="done"
        testID={testID}
      />
    </View>
  );
}

function SlotRow({
  r, onConfirm, onDeny, onDelete, styles, t,
}: {
  r: AccessReservation;
  onConfirm: (r: AccessReservation) => void;
  onDeny: (r: AccessReservation) => void;
  onDelete: (r: AccessReservation) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
}) {
  const Icon = KIND_ICON[r.kind];
  const tone =
    r.status === 'confirmed' ? t.successLabel :
    r.status === 'denied' ? t.danger :
    r.status === 'cancelled' ? t.textMuted :
    t.accentLabel;
  const statusLabel =
    r.status === 'requested' ? 'Requested — not booked' :
    r.status === 'confirmed' ? 'Confirmed' :
    r.status === 'denied' ? 'Refused' : 'Cancelled';

  return (
    <View style={styles.slot}>
      <View style={styles.slotHead}>
        <Icon size={15} color={t.textSecondary} strokeWidth={1.9} />
        <Text style={styles.slotTitle} numberOfLines={1}>{KIND_LABEL[r.kind]}</Text>
        <Text style={[styles.slotStatus, { color: tone }]} numberOfLines={1}>{statusLabel}</Text>
      </View>
      <Text style={styles.slotMeta} numberOfLines={1}>
        {r.date}
        {r.window ? ` · ${r.window}` : ''}
        {r.confirmationRef ? ` · ref ${r.confirmationRef}` : ''}
      </Text>
      <View style={styles.slotCtas}>
        {r.status === 'requested' && (
          <>
            <TouchableOpacity onPress={() => onConfirm(r)} style={[styles.slotBtn, styles.slotBtnPrimary]} accessibilityRole="button" testID={`confirm-slot-${r.id}`}>
              <Check size={13} color={t.accentLabel} strokeWidth={2} />
              <Text style={[styles.slotBtnText, { color: t.accentLabel }]}>Confirmed</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onDeny(r)} style={styles.slotBtn} accessibilityRole="button" testID={`deny-slot-${r.id}`}>
              <X size={13} color={t.textSecondary} strokeWidth={2} />
              <Text style={styles.slotBtnText}>Refused</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity onPress={() => onDelete(r)} style={styles.slotBtn} accessibilityRole="button" testID={`delete-slot-${r.id}`}>
          <Text style={styles.slotBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface Draft { kind: AccessKind; date: string; window: string }

function AddSlotSheet({
  visible, onClose, onSave, styles, t,
}: {
  visible: boolean; onClose: () => void; onSave: (d: Draft) => void;
  styles: ReturnType<typeof makeStyles>; t: ThemeColors;
}) {
  const [draft, setDraft] = useState<Draft>({ kind: 'freight_elevator', date: todayLocal(), window: '' });
  const valid = draft.date.trim().length >= 8;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Book a slot</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textSecondary} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>What</Text>
          <View style={styles.kindRow}>
            {(Object.keys(KIND_LABEL) as AccessKind[]).map(k => (
              <TouchableOpacity
                key={k}
                onPress={() => setDraft(p => ({ ...p, kind: k }))}
                style={[styles.kindChip, draft.kind === k && styles.kindChipOn]}
                accessibilityRole="button"
                testID={`slot-kind-${k}`}
              >
                <Text style={[styles.kindText, draft.kind === k && styles.kindTextOn]}>
                  {KIND_LABEL[k]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Date</Text>
          <TextInput
            style={styles.input}
            value={draft.date}
            onChangeText={(x) => setDraft(p => ({ ...p, date: x }))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={t.textMuted}
            testID="slot-date"
          />

          <Text style={styles.fieldLabel}>Window (optional)</Text>
          <TextInput
            style={styles.input}
            value={draft.window}
            onChangeText={(x) => setDraft(p => ({ ...p, window: x }))}
            placeholder="07:00-11:00"
            placeholderTextColor={t.textMuted}
            testID="slot-window"
          />

          <TouchableOpacity
            style={[styles.saveBtn, !valid && styles.saveBtnOff]}
            disabled={!valid}
            onPress={() => {
              if (!valid) return;
              onSave(draft);
              setDraft({ kind: 'freight_elevator', date: todayLocal(), window: '' });
            }}
            accessibilityRole="button"
            testID="slot-save"
          >
            <Text style={styles.saveBtnText}>Add as requested</Text>
          </TouchableOpacity>
          <Text style={styles.saveHint}>
            Starts as requested. Mark it confirmed only once the building says yes.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerCta: { backgroundColor: t.accentFill, borderRadius: Tokens.radius.md },
  headerText: { flex: 1 },
  headerEyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  headerSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },

  content: { paddingHorizontal: 14, gap: 10 },
  sectionTitle: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: 8 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 14, gap: 14,
  },

  toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  toggleHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },

  field: { gap: 6 },
  fieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 8 },
  input: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },

  empty: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 16,
  },
  emptyText: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 19 },

  slot: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 14, gap: 6,
  },
  slotHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  slotTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  slotStatus: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  slotMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  slotCtas: { flexDirection: 'row' as const, gap: 8, marginTop: 4 },
  slotBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  slotBtnPrimary: { borderColor: t.accent + '40', backgroundColor: t.accentSoft },
  slotBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 18, paddingBottom: 34, gap: 4,
  },
  sheetHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 },
  // Compact sheet, not a full-screen modal — system sans, not serif.
  sheetTitle: { ...Type.headline, color: t.text },

  kindRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 2 },
  kindChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  kindChipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  kindText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  kindTextOn: { color: t.accentLabel },

  saveBtn: {
    marginTop: 20, minHeight: 50, borderRadius: Tokens.radius.lg, backgroundColor: t.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  saveHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center' as const, marginTop: 8, lineHeight: 15 },
});
