// components/project/SubsPayTile.tsx — the job page's "Subs & pay" section
// (W1 UXDOORS, D5).
//
// The body of the Money group's "Subs & pay" tile: it opens in the job page's
// section sheet (the modal-in-screen pattern, ChevronLeft back), like its
// siblings. One card per commitment on the job — who, the contract, what the
// ledger says has been paid, any bill waiting for review — and two doors:
// Pay (the sub's portal page, where bills are approved and payments recorded)
// and Get waiver (the lien-waiver form, pre-filled for this sub).
//
// Presentational only. The rows come from utils/subsPayRows (pure, cents in
// and out, proven by scripts/validate-ux-doors.ts); the job page decides who
// may see this at all (a Money tile: hidden from roles that cannot see money).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Card, Button } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { centsLabel, SUBS_PAY_EMPTY, type SubsPayRow } from '@/utils/subsPayRows';

type Href = { pathname: string; params: Record<string, string> };

interface Props {
  rows: readonly SubsPayRow[];
  /** Push a route (the job page's navigateFromTile: closes the sheet first). */
  onOpen: (href: Href) => void;
  /** The empty state's one action: log a subcontract on this job. */
  onAdd: () => void;
  testID?: string;
}

export function SubsPayTile({ rows, onOpen, onAdd, testID = 'subs-pay' }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  if (rows.length === 0) {
    return (
      <View style={styles.wrap} testID={`${testID}-empty`}>
        <Text style={styles.emptyTitle}>{SUBS_PAY_EMPTY.title}</Text>
        <Button
          label={SUBS_PAY_EMPTY.action}
          variant="secondary"
          onPress={onAdd}
          iconLeft={<Plus size={16} color={colors.accent} strokeWidth={2} />}
          testID={`${testID}-add`}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      {rows.map(r => (
        <Card key={r.commitmentId} testID={`${testID}-row-${r.commitmentId}`}>
          <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
          <Text style={styles.detail} numberOfLines={1}>
            {r.detail ? `${r.kindLabel} · ${r.detail}` : r.kindLabel}
          </Text>
          <View style={styles.figures}>
            <View style={styles.figure}>
              <Text style={styles.figureLabel}>Contract</Text>
              <Text style={styles.figureValue}>{centsLabel(r.contractCents)}</Text>
            </View>
            <View style={styles.figure}>
              {/* The ledger counts APPROVED bills too (gross of retainage):
                  never "Paid", which would claim cash that has not gone out. */}
              <Text style={styles.figureLabel}>Approved Bills</Text>
              <Text style={styles.figureValue}>{centsLabel(r.paidCents)}</Text>
            </View>
            {r.openBillCents != null && r.openBillCents > 0 ? (
              <View style={styles.figure}>
                <Text style={styles.figureLabel}>Open Bill</Text>
                <Text style={[styles.figureValue, { color: colors.accent }]} testID={`${testID}-open-${r.commitmentId}`}>
                  {centsLabel(r.openBillCents)}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Button
              label="Pay"
              variant="primary"
              disabled={!r.payHref}
              onPress={() => { if (r.payHref) onOpen(r.payHref); }}
              containerStyle={styles.action}
              testID={`${testID}-pay-${r.commitmentId}`}
            />
            <Button
              label="Get Waiver"
              variant="secondary"
              disabled={!r.waiverHref}
              onPress={() => { if (r.waiverHref) onOpen(r.waiverHref); }}
              containerStyle={styles.action}
              testID={`${testID}-waiver-${r.commitmentId}`}
            />
          </View>
          {r.payBlockedReason ? <Text style={styles.blocked}>{r.payBlockedReason}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 8, gap: Tokens.spacing.sm },
  emptyTitle: { ...Type.body, color: t.textSecondary, marginBottom: Tokens.spacing.sm },
  name: { ...Type.body, fontWeight: '700' as const, color: t.text },
  detail: { ...Type.footnote, color: t.textSecondary, marginTop: 2 },
  figures: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
  figure: { minWidth: 88 },
  figureLabel: { ...Type.caption1, color: t.textMuted },
  figureValue: { ...Type.subhead, fontWeight: '600' as const, color: t.text, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row' as const, gap: Tokens.spacing.sm, marginTop: Tokens.spacing.md },
  action: { flex: 1 },
  blocked: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xs },
});

export default SubsPayTile;
