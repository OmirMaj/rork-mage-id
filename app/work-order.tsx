// app/work-order.tsx — a single work order: its details, status, and the
// contractor bridge. This is where the Property Manager persona's
// recurring demand meets supply.
//
// Two bridges (the whole point of "Bet 1 — recurring-demand engine"):
//   1. Send to a contractor you already use — pick from Contacts, and the
//      PM's own Messages or Mail opens with the job filled in (property,
//      title, priority, trade, budget, description). The order moves to
//      'assigned' only once that composer opened. MAGE does not message the
//      contractor itself, and the sheet says so: this button used to read
//      "Dispatch to contractor", set 'assigned' and tell nobody, so the PM
//      believed an emergency leak was handled (audit round 2, #20). "Mark
//      assigned without sending" stays for the job he already phoned in.
//   2. Post for bids — route into the existing marketplace RFP flow so
//      verified contractors compete. The order is NOT marked 'Out for bids'
//      here: it used to flip before /post-rfp opened, so backing out left it
//      claiming bids that were never asked for. post-rfp owns that step once
//      the public_bids row exists (it gets this order's id as a param).
//
// Status otherwise advances by tapping the "mark as" chips
// (open → in progress → done, or cancelled).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, Linking,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Wrench, Building2, Send, UserCheck, X, Trash2,
  AlertTriangle, Phone, Users, Mail, ChevronRight,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProperties } from '@/contexts/PropertyContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  WORK_ORDER_STATUS_LABELS, WORK_ORDER_PRIORITY_LABELS,
  type WorkOrderStatus, type Contact,
} from '@/types';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  composeDispatchMessage, buildDispatchSmsUrl, buildDispatchMailtoUrl,
} from '@/utils/propertyMirror';

const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  open: '#FF6A1A',
  posted_for_bids: '#0D6CB1',
  assigned: '#7A3FF2',
  in_progress: '#C99700',
  done: '#16A34A',
  cancelled: '#9CA3AF',
};

// The statuses a PM sets by hand (the other two are set by the bridges).
const MANUAL_STATUSES: WorkOrderStatus[] = ['open', 'in_progress', 'done', 'cancelled'];

// Contacts most likely to be the ones a PM dispatches work to. We surface
// these first in the picker but don't hide the rest.
const CONTRACTORISH = new Set(['Sub', 'Supplier', 'Other']);

export default function WorkOrderScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{ workOrderId?: string }>();
  const workOrderId = params.workOrderId ?? '';

  const { getWorkOrder, updateWorkOrder, deleteWorkOrder, getProperty } = useProperties();
  const { contacts, settings } = useProjects();

  const wo = getWorkOrder(workOrderId);
  const property = wo ? getProperty(wo.propertyId) : null;

  const [dispatchOpen, setDispatchOpen] = useState(false);

  const sortedContacts = useMemo(() => {
    return contacts
      .slice()
      .sort((a, b) => {
        const ac = CONTRACTORISH.has(a.role) ? 0 : 1;
        const bc = CONTRACTORISH.has(b.role) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      });
  }, [contacts]);

  const setStatus = useCallback((status: WorkOrderStatus) => {
    if (!wo) return;
    updateWorkOrder(wo.id, {
      status,
      completedAt: status === 'done' ? new Date().toISOString() : undefined,
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [wo, updateWorkOrder]);

  const markAssigned = useCallback((c: Contact) => {
    if (!wo) return;
    const name = `${c.firstName} ${c.lastName}`.trim() || c.companyName || 'Contractor';
    updateWorkOrder(wo.id, {
      status: 'assigned',
      assignedContactId: c.id,
      assignedContactName: name,
      assignedAt: new Date().toISOString(),
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDispatchOpen(false);
  }, [wo, updateWorkOrder]);

  // Opens the PM's own composer with the job filled in; marks the order
  // assigned only if the composer actually opened. We cannot see whether he
  // pressed Send, so nothing here claims the contractor was told.
  const sendVia = useCallback(async (c: Contact, channel: 'sms' | 'email') => {
    if (!wo) return;
    const msg = composeDispatchMessage({
      workOrder: wo,
      propertyName: property?.name,
      propertyAddress: property?.address,
      contactFirstName: c.firstName?.trim() || undefined,
      senderName: settings?.branding?.contactName?.trim() || settings?.branding?.companyName?.trim() || undefined,
    });
    const url = channel === 'sms'
      ? buildDispatchSmsUrl(c.phone ?? '', msg, Platform.OS)
      : buildDispatchMailtoUrl(c.email ?? '', msg);
    try {
      await Linking.openURL(url);
      // On web openURL resolves even when no sms:/mailto: handler exists (a
      // desk PC with no Messages app), so "it opened" proves nothing there —
      // marking it assigned would record a dispatch that never went out. Ask.
      if (Platform.OS === 'web') {
        showAlert(
          'Did you send it?',
          `MAGE can't see your ${channel === 'sms' ? 'messages' : 'email'}. Mark the job assigned only once the ${channel === 'sms' ? 'text' : 'email'} has actually gone to ${c.firstName?.trim() || 'the contractor'}.`,
          [
            { text: 'Not sent', style: 'cancel' },
            { text: 'Sent — mark assigned', onPress: () => markAssigned(c) },
          ],
        );
        return;
      }
      markAssigned(c);
    } catch {
      showAlert(
        channel === 'sms' ? "Couldn't open Messages" : "Couldn't open Mail",
        `Nothing was sent and the work order is unchanged. ${channel === 'sms' ? `Call or text ${c.phone}` : `Email ${c.email}`} yourself, then use "Mark assigned without sending".`,
      );
    }
  }, [wo, property, settings, markAssigned]);

  const chooseContact = useCallback((c: Contact) => {
    const name = `${c.firstName} ${c.lastName}`.trim() || c.companyName || 'this contractor';
    const hasPhone = !!c.phone?.trim();
    const hasEmail = !!c.email?.trim();
    showAlert(
      `Send to ${name}`,
      hasPhone || hasEmail
        ? 'Your Messages or Mail app opens with the job filled in. You press Send. MAGE does not message contractors for you.'
        : `${name} has no phone or email in Contacts, so there is nothing to send it with. Add one in Contacts, or mark the job assigned if you already told them.`,
      [
        // At most THREE buttons per alert: Android's native Alert drops any
        // past the third (and the web AlertHost renders 1–3), so a contact
        // with both a phone and an email lost Cancel. Two channels get their
        // own follow-up alert instead of a fourth button here.
        ...(hasPhone && hasEmail
          ? [{
              text: 'Send it…',
              onPress: () => showAlert(`Send to ${name}`, 'Pick how. Your app opens with the job filled in; you press Send.', [
                { text: `Text ${c.phone}`, onPress: () => { void sendVia(c, 'sms'); } },
                { text: `Email ${c.email}`, onPress: () => { void sendVia(c, 'email'); } },
                { text: 'Cancel', style: 'cancel' as const },
              ]),
            }]
          : hasPhone ? [{ text: `Text ${c.phone}`, onPress: () => { void sendVia(c, 'sms'); } }]
          : hasEmail ? [{ text: `Email ${c.email}`, onPress: () => { void sendVia(c, 'email'); } }]
          : []),
        { text: 'Mark assigned without sending', onPress: () => markAssigned(c) },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [sendVia, markAssigned]);

  const postForBids = useCallback(() => {
    if (!wo) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Reuse the marketplace RFP flow, pre-filled from this work order so the
    // PM doesn't re-type scope/budget/address they already entered. The
    // homeowner-RFP form treats every param as optional, so anything we
    // don't have simply stays blank. Maintenance/repair work maps to the
    // 'other' work-type chip; the property address seeds nearby-contractor
    // matching (the PM still taps Verify to geocode it).
    const description = [wo.title, wo.description].filter(Boolean).join(' — ');
    const scope = wo.category ? `Trade: ${wo.category}` : '';
    router.push({
      pathname: '/post-rfp' as never,
      params: {
        prefillDescription: description,
        prefillScope: scope,
        prefillAddress: property?.address ?? '',
        prefillBudgetMax: wo.budget != null ? String(wo.budget) : '',
        prefillWorkType: 'other',
        // post-rfp marks this order 'Out for bids' and stores the RFP id once
        // the public_bids row exists (handoff). Until it does, the order stays
        // as it is — it never claims bids that were not asked for.
        workOrderId: wo.id,
      } as never,
    });
  }, [wo, property, router]);

  const handleDelete = useCallback(() => {
    if (!wo) return;
    showAlert('Delete work order?', `"${wo.title}" will be removed. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteWorkOrder(wo.id); router.back(); } },
    ]);
  }, [wo, deleteWorkOrder, router]);

  if (!wo) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}><ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Work order</Text>
        </View>
        <View style={styles.missingWrap}>
          <AlertTriangle size={28} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.missingText}>This work order could not be found.</Text>
        </View>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[wo.status];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Work order</Text>
        <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityLabel="Delete work order">
          <Trash2 size={18} color={themeColors.danger} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {/* Title + status */}
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><Wrench size={20} color={themeColors.accent} strokeWidth={1.75} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{wo.title}</Text>
            {!!property && (
              <TouchableOpacity
                style={styles.propLink}
                onPress={() => router.push({ pathname: '/managed-property' as never, params: { propertyId: property.id } as never })}
                hitSlop={6}
              >
                <Building2 size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.propLinkText} numberOfLines={1}>{property.name}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColor + '1A' }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>{WORK_ORDER_STATUS_LABELS[wo.status]}</Text>
          </View>
        </View>

        {/* Meta chips */}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}><Text style={styles.metaChipText}>Priority: {WORK_ORDER_PRIORITY_LABELS[wo.priority]}</Text></View>
          {!!wo.category && <View style={styles.metaChip}><Text style={styles.metaChipText}>{wo.category}</Text></View>}
          {wo.budget != null && <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatMoney(wo.budget)}</Text></View>}
        </View>

        {!!wo.description && (
          <View style={styles.descCard}><Text style={styles.descText}>{wo.description}</Text></View>
        )}

        {/* Assigned-to banner */}
        {wo.status === 'assigned' && !!wo.assignedContactName && (
          <View style={styles.assignedBanner}>
            <UserCheck size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.assignedText}>
              Assigned to <Text style={styles.assignedName}>{wo.assignedContactName}</Text>
              {wo.assignedAt ? ` · ${new Date(wo.assignedAt).toLocaleDateString()}` : ''}
            </Text>
          </View>
        )}

        {/* The RFP this order was posted as — so "Out for bids" leads somewhere. */}
        {!!wo.rfpId && (
          <TouchableOpacity
            style={styles.assignedBanner}
            onPress={() => router.push({ pathname: '/rfp-detail' as never, params: { bidId: wo.rfpId } as never })}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Send size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.assignedText}>Posted for bids · see responses</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        )}

        {/* Bridge — the demand → supply handoff */}
        <Text style={styles.sectionLabel}>Get it done</Text>
        <View style={styles.bridgeRow}>
          <TouchableOpacity style={styles.bridgeBtn} onPress={() => setDispatchOpen(true)} activeOpacity={0.85} testID="wo-dispatch">
            <View style={styles.bridgeIcon}><UserCheck size={18} color={themeColors.accent} strokeWidth={1.75} /></View>
            <Text style={styles.bridgeTitle}>Send to a contractor</Text>
            <Text style={styles.bridgeSub}>Text or email the job from your phone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bridgeBtn} onPress={postForBids} activeOpacity={0.85} testID="wo-post-bids">
            <View style={styles.bridgeIcon}><Send size={18} color={themeColors.accent} strokeWidth={1.75} /></View>
            <Text style={styles.bridgeTitle}>Post for bids</Text>
            <Text style={styles.bridgeSub}>Post it to MAGE ID contractors who cover your area</Text>
          </TouchableOpacity>
        </View>

        {/* Manual status */}
        <Text style={styles.sectionLabel}>Status</Text>
        <View style={styles.statusChipRow}>
          {MANUAL_STATUSES.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.statusChip, wo.status === s && { backgroundColor: STATUS_COLORS[s] + '18', borderColor: STATUS_COLORS[s] }]}
              onPress={() => setStatus(s)}
              activeOpacity={0.8}
              testID={`wo-status-${s}`}
            >
              <Text style={[styles.statusChipText, wo.status === s && { color: STATUS_COLORS[s] }]}>
                {WORK_ORDER_STATUS_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Dispatch picker */}
      <Modal visible={dispatchOpen} transparent animationType="slide" onRequestClose={() => setDispatchOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <View style={styles.modalHeadIcon}><Users size={15} color="#FFF" strokeWidth={1.75} /></View>
              <Text style={styles.modalTitle}>Send to…</Text>
              <TouchableOpacity onPress={() => setDispatchOpen(false)} hitSlop={8}><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>
              Your Messages or Mail app opens with the job filled in, and you press Send. MAGE does not contact them for you.
            </Text>
            {sortedContacts.length === 0 ? (
              <View style={styles.noContacts}>
                <Users size={24} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.noContactsText}>
                  No contacts yet. Add the contractors you work with in the Contacts screen, then dispatch work orders to them in one tap.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                {sortedContacts.map(c => (
                  <TouchableOpacity key={c.id} style={styles.contactRow} onPress={() => chooseContact(c)} activeOpacity={0.8} testID={`dispatch-${c.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{`${c.firstName} ${c.lastName}`.trim() || c.companyName}</Text>
                      <View style={styles.contactMeta}>
                        <View style={styles.roleChip}><Text style={styles.roleChipText}>{c.role}</Text></View>
                        {!!c.phone && (
                          <View style={styles.contactPhone}><Phone size={10} color={themeColors.textMuted} strokeWidth={1.75} /><Text style={styles.contactPhoneText}>{c.phone}</Text></View>
                        )}
                        {!c.phone && !!c.email && (
                          <View style={styles.contactPhone}><Mail size={10} color={themeColors.textMuted} strokeWidth={1.75} /><Text style={styles.contactPhoneText}>{c.email}</Text></View>
                        )}
                        {!c.phone && !c.email && (
                          <Text style={styles.contactPhoneText}>No phone or email</Text>
                        )}
                      </View>
                    </View>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerTitle: { ...Type.serifHeadline, flex: 1, color: t.text },

  missingWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  missingText: { fontSize: Type.footnote.fontSize, color: t.textMuted },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  titleIcon: { width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '12', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4 },
  propLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  propLinkText: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.2 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  metaChip: { backgroundColor: t.surface, borderRadius: Tokens.radius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: t.line },
  metaChipText: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },

  descCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: t.line, marginBottom: 16 },
  descText: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 20 },

  assignedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accent + '0E', borderRadius: Tokens.radius.lg, padding: 12,
    borderWidth: 1, borderColor: t.accent + '2A', marginBottom: 16,
  },
  assignedText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text },
  assignedName: { fontWeight: '700' },

  sectionLabel: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginTop: 4 },
  bridgeRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  bridgeBtn: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: t.line, gap: 4 },
  bridgeIcon: { width: 36, height: 36, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  bridgeTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  bridgeSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },

  statusChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
  statusChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },

  // dispatch modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34, maxHeight: '80%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 14 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  modalHeadIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  modalNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 8 },
  noContacts: { alignItems: 'center', gap: 10, padding: 24 },
  noContactsText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 300 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  contactName: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  contactMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  roleChip: { backgroundColor: t.bg, borderRadius: Tokens.radius.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: t.line },
  roleChipText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' },
  contactPhone: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  contactPhoneText: { fontSize: Type.caption2.fontSize, color: t.textMuted },
});
