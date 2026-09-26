// components/subInvoice/PayWhatsEarnedCard.tsx — "Pay what's earned" on a
// SUBMITTED sub invoice, next to the overage guard on /sub-portal-setup.
//
// The math and every sentence live in utils/subBillCheck (pure, validated by
// scripts/validate-pay-earned.ts). This card only gathers the job's data:
// the sub's schedule tasks, THIS company's days on the daily reports (never a
// trade total — buildCrewPresence is deliberately not used) and the open punch
// items on the sub.
//
// MAGE cannot approve part of an invoice, so the card never pretends to: it
// suggests a split, says so plainly, and offers the note to send with a
// rejection. Nothing here writes, sends or approves anything.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle, ChevronDown, ChevronUp, Copy } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { copyToClipboard } from '@/utils/clipboard';
import { shareText } from '@/utils/shareText';
import {
  companyDaysOnSite,
  subBillCheck,
  PARTIAL_APPROVAL_HONESTY,
} from '@/utils/subBillCheck';
import type { Commitment, Project, Subcontractor, SubSubmittedInvoice } from '@/types';

export interface PayWhatsEarnedCardProps {
  invoice: SubSubmittedInvoice;
  siblings: SubSubmittedInvoice[];
  commitment: Commitment | undefined;
  project: Project;
  sub: Subcontractor;
}

type CopyState = 'idle' | 'copied' | 'shared' | 'failed';

export function PayWhatsEarnedCard({ invoice, siblings, commitment, project, sub }: PayWhatsEarnedCardProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getDailyReportsForProject, getPunchItemsForProject } = useProjects();
  const [showEvidence, setShowEvidence] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const check = useMemo(() => {
    const presence = companyDaysOnSite(getDailyReportsForProject(project.id), sub.companyName);
    const openPunchCount = getPunchItemsForProject(project.id)
      .filter(p => p.assignedSubId === sub.id && p.status !== 'closed').length;
    return subBillCheck({
      invoice,
      siblings,
      commitment: commitment ?? null,
      tasks: project.schedule?.tasks ?? [],
      subId: sub.id,
      subName: sub.companyName,
      presence,
      openPunchCount,
    });
  }, [invoice, siblings, commitment, project, sub, getDailyReportsForProject, getPunchItemsForProject]);

  const note = check.noteToSub;
  const handleCopy = useCallback(async () => {
    if (!note) return;
    let next: CopyState;
    if (await copyToClipboard(note)) {
      next = 'copied';
    } else {
      // The clipboard can be blocked on web (non-secure context, iframe
      // policy). shareText opens the share sheet where there is one and falls
      // back to the clipboard where there is not.
      const r = await shareText({ message: note, title: `Invoice #${invoice.invoiceNumber}` });
      next = r === 'shared' ? 'shared' : r === 'copied' ? 'copied' : r === 'cancelled' ? 'idle' : 'failed';
    }
    setCopyState(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (next !== 'idle') resetTimer.current = setTimeout(() => setCopyState('idle'), 2500);
  }, [note, invoice.invoiceNumber]);

  if (check.verdict !== 'ahead_of_work') {
    return (
      <View testID={`payearned-${invoice.id}`} style={styles.quietWrap}>
        <Text style={styles.quietLine}>{check.headline}</Text>
      </View>
    );
  }

  const copyLabel =
    copyState === 'copied' ? 'Copied' :
    copyState === 'shared' ? 'Shared' :
    'Copy note to sub';

  return (
    <View testID={`payearned-${invoice.id}`} style={styles.wrap}>
      <Card pad={Tokens.spacing.md} radius="md">
        <EyebrowLabel tone="neutral" showDot={false}>Pay what’s earned</EyebrowLabel>
        <View style={styles.headRow}>
          <AlertTriangle size={16} color={t.warningLabel} strokeWidth={1.75} style={styles.headIcon} />
          <Text style={styles.headline}>{check.headline}</Text>
        </View>
        <Text style={styles.suggestion} testID={`payearned-suggestion-${invoice.id}`}>{check.suggestion}</Text>
        <Text style={styles.muted}>{PARTIAL_APPROVAL_HONESTY}</Text>
        {note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>{note}</Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={copyLabel}
            variant="secondary"
            size="sm"
            onPress={() => { void handleCopy(); }}
            iconLeft={<Copy size={14} color={t.text} strokeWidth={1.75} />}
            testID={`payearned-copy-${invoice.id}`}
          />
          <TouchableOpacity
            onPress={() => setShowEvidence(v => !v)}
            style={styles.evidenceToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: showEvidence }}
            testID={`payearned-evidence-${invoice.id}`}
          >
            <Text style={styles.evidenceToggleText}>{showEvidence ? 'Hide the evidence' : 'Show the evidence'}</Text>
            {showEvidence
              ? <ChevronUp size={14} color={t.textMuted} strokeWidth={1.75} />
              : <ChevronDown size={14} color={t.textMuted} strokeWidth={1.75} />}
          </TouchableOpacity>
        </View>
        {copyState === 'failed' ? (
          <Text style={styles.error}>Couldn’t copy the note on this device. Select the text above and copy it by hand.</Text>
        ) : null}
        {showEvidence ? (
          <View style={styles.evidence}>
            {check.evidence.map((line, i) => (
              <Text key={i} style={styles.evidenceLine}>• {line}</Text>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

export default PayWhatsEarnedCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 8 },
  quietWrap: { marginTop: 6 },
  quietLine: { ...Type.footnote, color: t.textMuted },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  headIcon: { marginTop: 2 },
  headline: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
  suggestion: { ...Type.subhead, color: t.text, marginTop: 8 },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 6 },
  noteBox: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: t.line },
  noteText: { ...Type.footnote, color: t.textSecondary },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  evidenceToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  evidenceToggleText: { ...Type.footnoteEmphasized, color: t.textMuted },
  error: { ...Type.footnote, color: t.dangerLabel, marginTop: 6 },
  evidence: { marginTop: 8, gap: 4 },
  evidenceLine: { ...Type.footnote, color: t.textSecondary },
});
