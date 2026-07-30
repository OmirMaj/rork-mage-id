// quick-quote.tsx — DMG-Pro-style fast bid for small jobs.
//
// The heavyweight path is smart-proposal.tsx (good/better/best, priced by the
// Win Optimizer). This is the opposite end: type a client, a couple of line
// items, an optional markup and tax, and get one professional number to send
// in under a minute. It REUSES the Smart Proposal infra end-to-end —
// buildQuickQuote() emits a normal SmartProposal (kind:'quick', one tier),
// useSmartProposals persists it to the same store, and proposalToShareText
// renders the same client-safe text. No new storage, no new share format.
//
// MVP ONLY. DEFERRED (do not build here): price-book / learned-cost auto-fill,
// viewed-tracking, deposit-invoice generation, and converting a won quote into
// a full project. Those belong to later increments.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Zap, Plus, Trash2, Share2, CheckCircle2, XCircle,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useSmartProposals } from '@/hooks/useSmartProposals';
import { buildQuickQuote, proposalToShareText, type SmartProposal } from '@/utils/proposalBuilder';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface DraftLine {
  /** Stable key for the row (not persisted). */
  id: string;
  description: string;
  /** Raw string so the field can be empty mid-edit; parsed on the fly. */
  amountStr: string;
}

const STATUS_LABEL: Record<SmartProposal['status'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
};

function parseAmount(s: string): number {
  return Math.max(0, parseFloat(s.replace(/[^0-9.]/g, '')) || 0);
}

export default function QuickQuoteScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { globalMarkup } = useMaterialCart();
  const { proposals, addProposal, updateProposal } = useSmartProposals();

  const [clientName, setClientName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [scope, setScope] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { id: generateUUID(), description: '', amountStr: '' },
  ]);
  // Prefill markup from the GC's usual markup (a percent, e.g. 15). Falls back
  // to '' if unset so the field reads empty rather than "0".
  const [markupStr, setMarkupStr] = useState(
    globalMarkup && globalMarkup > 0 ? String(Math.round(globalMarkup)) : '',
  );
  const [taxStr, setTaxStr] = useState('');

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + parseAmount(l.amountStr), 0),
    [lines],
  );
  const markupPct = Math.max(0, parseFloat(markupStr) || 0);
  const taxPct = Math.max(0, parseFloat(taxStr) || 0);
  const markupAmount = subtotal * (markupPct / 100);
  const taxAmount = (subtotal + markupAmount) * (taxPct / 100);
  const total = subtotal + markupAmount + taxAmount;

  const quickQuotes = useMemo(
    () => proposals.filter(p => p.kind === 'quick'),
    [proposals],
  );

  const addRow = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLines(prev => [...prev, { id: generateUUID(), description: '', amountStr: '' }]);
  };

  const removeRow = (id: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLines(prev => (prev.length <= 1 ? prev : prev.filter(l => l.id !== id)));
  };

  const updateRow = (id: string, patch: Partial<DraftLine>) => {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleCreateAndSend = async () => {
    const name = clientName.trim();
    const priced = lines
      .map(l => ({ description: l.description.trim(), amount: parseAmount(l.amountStr) }))
      .filter(l => l.amount > 0);

    if (!name) {
      showAlert('Add a client name', 'A quote needs a client name before you can send it.');
      return;
    }
    if (priced.length === 0) {
      showAlert('Add a line item', 'Add at least one line item with an amount above $0.');
      return;
    }

    const quote = buildQuickQuote({
      clientName: name,
      jobTitle: jobTitle.trim(),
      scope: scope.trim() || undefined,
      lineItems: priced,
      markupPct: markupPct > 0 ? markupPct : undefined,
      taxPct: taxPct > 0 ? taxPct : undefined,
    });

    addProposal(quote);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const result = await Share.share({ message: proposalToShareText(quote) });
      if (result.action === Share.sharedAction) {
        updateProposal(quote.id, { status: 'sent' });
      }
    } catch (err) {
      console.warn('[quickQuote] share failed:', err);
    }

    showAlert('Quote saved', `${formatMoney(quote.tiers[0]?.price ?? 0)} quote for ${name} is in Recent quotes below.`);

    // Reset the form for the next quick quote.
    setClientName('');
    setJobTitle('');
    setScope('');
    setLines([{ id: generateUUID(), description: '', amountStr: '' }]);
  };

  const reshare = async (record: SmartProposal) => {
    try {
      const result = await Share.share({ message: proposalToShareText(record) });
      if (result.action === Share.sharedAction && record.status === 'draft') {
        updateProposal(record.id, { status: 'sent' });
      }
    } catch (err) {
      console.warn('[quickQuote] reshare failed:', err);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Quick Quote · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Fast bid</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Client + job */}
        <View style={styles.inputCard}>
          <View style={styles.stackedRow}>
            <Text style={styles.inputLabel}>Client name</Text>
            <TextInput
              style={styles.textInput}
              value={clientName}
              onChangeText={setClientName}
              placeholder="Who is this for?"
              placeholderTextColor={t.textMuted}
              returnKeyType="next"
            />
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.stackedRow}>
            <Text style={styles.inputLabel}>Job title</Text>
            <TextInput
              style={styles.textInput}
              value={jobTitle}
              onChangeText={setJobTitle}
              placeholder="e.g. Master bath tile"
              placeholderTextColor={t.textMuted}
              returnKeyType="next"
            />
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.stackedRow}>
            <Text style={styles.inputLabel}>Scope <Text style={styles.inputHint}>(one line, optional)</Text></Text>
            <TextInput
              style={styles.textInput}
              value={scope}
              onChangeText={setScope}
              placeholder="Short description of the work"
              placeholderTextColor={t.textMuted}
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Line items */}
        <Text style={styles.sectionTitle}>Line items</Text>
        <View style={styles.inputCard}>
          {lines.map((line, i) => (
            <View key={line.id}>
              {i > 0 && <View style={styles.inputDivider} />}
              <View style={styles.lineRow}>
                <TextInput
                  style={styles.lineDesc}
                  value={line.description}
                  onChangeText={(v) => updateRow(line.id, { description: v })}
                  placeholder={`Item ${i + 1}`}
                  placeholderTextColor={t.textMuted}
                  returnKeyType="next"
                />
                <View style={styles.lineAmountWrap}>
                  <Text style={styles.inputPrefix}>$</Text>
                  <TextInput
                    style={styles.lineAmount}
                    value={line.amountStr}
                    onChangeText={(v) => updateRow(line.id, { amountStr: v })}
                    placeholder="0"
                    placeholderTextColor={t.textMuted}
                    keyboardType="numeric"
                    inputMode="numeric"
                    returnKeyType="done"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => removeRow(line.id)}
                  disabled={lines.length <= 1}
                  style={styles.rowIconBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove line item"
                >
                  <Trash2 size={16} color={lines.length <= 1 ? t.textMuted : t.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.addRowBtn} onPress={addRow} activeOpacity={0.7} testID="quick-quote-add-row">
          <Plus size={16} color={t.accent} strokeWidth={2} />
          <Text style={styles.addRowText}>Add line item</Text>
        </TouchableOpacity>

        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>{formatMoney(subtotal)}</Text>
        </View>

        {/* Markup + tax */}
        <View style={styles.inputCard}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Markup <Text style={styles.inputHint}>(optional)</Text></Text>
            <View style={styles.inlineInputWrap}>
              <TextInput
                style={styles.inlineInput}
                value={markupStr}
                onChangeText={setMarkupStr}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Tax <Text style={styles.inputHint}>(optional)</Text></Text>
            <View style={styles.inlineInputWrap}>
              <TextInput
                style={styles.inlineInput}
                value={taxStr}
                onChangeText={setTaxStr}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
          </View>
        </View>

        {/* Live breakdown */}
        <View style={styles.breakdownCard}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Subtotal</Text>
            <Text style={styles.breakdownValue}>{formatMoney(subtotal)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Markup{markupPct > 0 ? ` (${markupPct}%)` : ''}</Text>
            <Text style={styles.breakdownValue}>{formatMoney(markupAmount)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Tax{taxPct > 0 ? ` (${taxPct}%)` : ''}</Text>
            <Text style={styles.breakdownValue}>{formatMoney(taxAmount)}</Text>
          </View>
          <View style={styles.breakdownDivider} />
          <View style={styles.breakdownRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
        </View>

        {/* Primary action */}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: t.accent }]}
          onPress={handleCreateAndSend}
          activeOpacity={0.85}
          testID="quick-quote-send"
        >
          <Share2 size={18} color={t.bg} strokeWidth={1.75} />
          <Text style={[styles.primaryBtnText, { color: t.bg }]}>Create &amp; send quote</Text>
        </TouchableOpacity>

        {/* Recent quotes */}
        <Text style={styles.sectionTitle}>Recent quotes</Text>
        {quickQuotes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Zap size={24} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.emptyTitle}>No quick quotes yet</Text>
            <Text style={styles.emptyBody}>
              Add a client, a line item or two, and hit Create &amp; send. Your quotes land here so
              you can track which ones close.
            </Text>
          </View>
        ) : (
          quickQuotes.map(record => (
            <QuoteRow
              key={record.id}
              record={record}
              t={t}
              styles={styles}
              onAccept={() => updateProposal(record.id, { status: 'accepted' })}
              onDecline={() => updateProposal(record.id, { status: 'declined' })}
              onReshare={() => reshare(record)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function QuoteRow({ record, t, styles, onAccept, onDecline, onReshare }: {
  record: SmartProposal;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onAccept: () => void;
  onDecline: () => void;
  onReshare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const price = record.tiers[0]?.price ?? 0;
  const statusColor =
    record.status === 'accepted' ? t.success
      : record.status === 'declined' ? t.danger
        : record.status === 'sent' ? t.accent
          : t.textMuted;
  const decided = record.status === 'accepted' || record.status === 'declined';

  return (
    <View style={styles.quoteCard}>
      <TouchableOpacity
        style={styles.quoteHead}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
        testID={`quick-quote-row-${record.id}`}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.quoteClient} numberOfLines={1}>{record.clientName}</Text>
          {!!record.projectName && (
            <Text style={styles.quoteJob} numberOfLines={1}>{record.projectName}</Text>
          )}
        </View>
        <View style={styles.quoteRight}>
          <Text style={styles.quotePrice}>{formatMoney(price)}</Text>
          <View style={[styles.statusChip, { backgroundColor: statusColor + '22' }]}>
            <Text style={[styles.statusChipText, { color: statusColor }]}>{STATUS_LABEL[record.status]}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.quoteActions}>
          <TouchableOpacity
            style={[styles.quoteActionBtn, { borderColor: t.success }, record.status === 'accepted' && { backgroundColor: t.success + '22' }]}
            onPress={onAccept}
            disabled={decided}
            activeOpacity={0.85}
          >
            <CheckCircle2 size={15} color={t.success} strokeWidth={1.75} />
            <Text style={[styles.quoteActionText, { color: t.success }]}>Accepted</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quoteActionBtn, { borderColor: t.danger }, record.status === 'declined' && { backgroundColor: t.danger + '22' }]}
            onPress={onDecline}
            disabled={decided}
            activeOpacity={0.85}
          >
            <XCircle size={15} color={t.danger} strokeWidth={1.75} />
            <Text style={[styles.quoteActionText, { color: t.danger }]}>Declined</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quoteActionBtn, { borderColor: t.line }]}
            onPress={onReshare}
            activeOpacity={0.85}
          >
            <Share2 size={15} color={t.text} strokeWidth={1.75} />
            <Text style={[styles.quoteActionText, { color: t.text }]}>Re-share</Text>
          </TouchableOpacity>
        </View>
      )}
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
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  inputCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 16, marginBottom: 14,
  },
  inputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 14 },
  stackedRow: { paddingVertical: 12, gap: 6 },
  inputDivider: { height: 1, backgroundColor: t.line },
  inputLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  inputHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '500' as const },
  textInput: {
    fontSize: Type.body.fontSize, fontWeight: '500' as const, color: t.text, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  inputPrefix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  inputSuffix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },

  inlineInputWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, minWidth: 90, justifyContent: 'flex-end' as const },
  inlineInput: {
    fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text,
    textAlign: 'right' as const, minWidth: 50, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },

  lineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 12 },
  lineDesc: {
    flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '500' as const, color: t.text, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  lineAmountWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, minWidth: 90, justifyContent: 'flex-end' as const },
  lineAmount: {
    fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text,
    textAlign: 'right' as const, minWidth: 50, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  rowIconBtn: { width: 30, height: 30, alignItems: 'center' as const, justifyContent: 'center' as const },

  addRowBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 10, marginTop: -4, marginBottom: 10,
  },
  addRowText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },

  subtotalRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: 4, marginBottom: 14,
  },
  subtotalLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  subtotalValue: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },

  breakdownCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 16, gap: 10,
  },
  breakdownRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  breakdownLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  breakdownValue: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  breakdownDivider: { height: 1, backgroundColor: t.line, marginVertical: 2 },
  totalLabel: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  totalValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 14, borderRadius: Tokens.radius.card, marginBottom: 22,
  },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },

  emptyCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 8, marginBottom: 14,
  },
  emptyTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },

  quoteCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, marginBottom: 10, overflow: 'hidden' as const,
  },
  quoteHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 14 },
  quoteClient: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  quoteJob: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  quoteRight: { alignItems: 'flex-end' as const, gap: 5 },
  quotePrice: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const },

  quoteActions: {
    flexDirection: 'row' as const, gap: 8, paddingHorizontal: 14, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12,
  },
  quoteActionBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 5, paddingVertical: 10, borderRadius: Tokens.radius.card, borderWidth: 1.5,
  },
  quoteActionText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
});
