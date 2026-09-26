// components/backcharge/BackchargeDeductionCard.tsx — on a SUBMITTED sub
// invoice: what comes off this bill for the sub's open backcharges.
//
// Renders nothing when the sub has no open backcharge on this job and none
// was recorded on this bill. Once a deduction is recorded on this bill it shows
// only that (no second Apply). It never
// changes the sub's invoice, the approve flow, the overage guard or any
// payment record: MAGE records the deduction; the GC pays the net himself.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Send, MinusCircle } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Button } from '@/components/ui';
import { shareText } from '@/utils/shareText';
import { useBackcharges } from '@/hooks/useBackcharges';
import { formatCents, invoiceDeduction, sumCents } from '@/utils/backcharges';
import type { Project, Subcontractor, SubSubmittedInvoice } from '@/types';

export interface BackchargeDeductionCardProps {
  invoice: SubSubmittedInvoice;
  project: Project;
  sub: Subcontractor;
}

export function BackchargeDeductionCard({ invoice, project, sub }: BackchargeDeductionCardProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { settings } = useProjects();
  const { list, applyToInvoice } = useBackcharges();
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // SubSubmittedInvoice.amount is DOLLARS; the plan works in integer cents.
  const billCents = Math.round((Number(invoice.amount) || 0) * 100);
  // Once a deduction is recorded on this bill the card shows only that — no
  // second Apply — so one bill can never take more than it is.
  const d = useMemo(
    () => invoiceDeduction(list, project.id, sub.id, invoice.id, billCents),
    [list, project.id, sub.id, invoice.id, billCents],
  );
  const taken = d.kind === 'recorded' ? d.appliedHere : d.kind === 'plan' ? d.plan.applied : [];
  const waiting = d.kind === 'recorded' ? d.openAfter : d.kind === 'plan' ? d.plan.carried : [];
  const deductCents = d.kind === 'recorded' ? d.deductCents : d.kind === 'plan' ? d.plan.deductCents : 0;
  const payCents = d.kind === 'recorded' ? d.payCents : d.kind === 'plan' ? d.plan.payCents : billCents;

  const note = useMemo(() => {
    if (taken.length === 0) return '';
    const who = sub.contactName?.split(' ')[0] || sub.companyName;
    const lines = taken.map(b => `- ${b.reason}: ${formatCents(b.amountCents)}`);
    const carried = waiting.length > 0
      ? [`${formatCents(sumCents(waiting))} more carries to your next bill.`]
      : [];
    const from = settings?.branding?.companyName?.trim();
    return [
      `Hi ${who},`,
      '',
      `On invoice #${invoice.invoiceNumber} for ${project.name} (${formatCents(billCents)}), we're deducting these backcharges:`,
      ...lines,
      '',
      `Deducted: ${formatCents(deductCents)}. We'll pay ${formatCents(payCents)}.`,
      ...carried,
      'Photos available on request.',
      '',
      from ? `Thanks,\n${from}` : 'Thanks',
    ].join('\n');
  }, [taken, waiting, deductCents, payCents, sub, settings, invoice.invoiceNumber, project.name, billCents]);

  const shareNote = useCallback(async () => {
    if (!note) return;
    const r = await shareText({ message: note, title: `Invoice #${invoice.invoiceNumber} — backcharges` });
    setShareMsg(r === 'copied' ? 'Note copied — paste it into your message.' : r === 'failed' ? 'Couldn’t open the share sheet on this device.' : null);
  }, [note, invoice.invoiceNumber]);

  if (d.kind === 'none') return null;

  const recorded = d.kind === 'recorded';
  return (
    <View style={styles.wrap} testID={`backcharge-deduct-${invoice.id}`}>
      <View style={styles.headRow}>
        <MinusCircle size={15} color={t.textSecondary} strokeWidth={1.75} />
        {d.kind === 'recorded' ? (
          <Text style={styles.headline} testID={`backcharge-deduct-line-${invoice.id}`}>
            Deducted {formatCents(d.deductCents)} on this bill → pay {formatCents(d.payCents)}
          </Text>
        ) : (
          <Text style={styles.headline} testID={`backcharge-deduct-line-${invoice.id}`}>
            Backcharges open: {formatCents(sumCents(d.open))} · Deduct {formatCents(d.plan.deductCents)} on this bill → pay {formatCents(d.plan.payCents)}
          </Text>
        )}
      </View>
      {taken.map(b => (
        <Text key={b.id} style={styles.item}>• {b.reason}: {formatCents(b.amountCents)}</Text>
      ))}
      {waiting.length > 0 ? (
        <Text style={styles.muted}>
          {formatCents(sumCents(waiting))} carries to the next bill ({waiting.map(b => b.reason).join(', ')}) — a backcharge comes off whole, never split.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {!recorded ? (
          <Button
            label="Apply to this bill"
            variant="secondary"
            size="sm"
            disabled={taken.length === 0}
            onPress={() => applyToInvoice(taken.map(b => b.id), invoice.id)}
            testID={`backcharge-apply-${invoice.id}`}
          />
        ) : null}
        {note ? (
          <Button
            label="Send note to sub"
            variant="ghost"
            size="sm"
            onPress={() => { void shareNote(); }}
            iconLeft={<Send size={14} color={t.text} strokeWidth={1.75} />}
            testID={`backcharge-note-${invoice.id}`}
          />
        ) : null}
      </View>
      {!recorded && taken.length === 0 ? (
        <Text style={styles.muted}>Nothing fits on this bill: the oldest open backcharge is bigger than the invoice.</Text>
      ) : null}
      <Text style={styles.muted}>
        MAGE records the deduction. Pay {formatCents(payCents)} when you mark this bill paid — MAGE never moves the money. Saved on this device until you sign out.
      </Text>
      {shareMsg ? <Text style={styles.muted}>{shareMsg}</Text> : null}
    </View>
  );
}

export default BackchargeDeductionCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headline: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
  item: { ...Type.footnote, color: t.textSecondary, marginTop: 4, marginLeft: 23 },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 10 },
});
