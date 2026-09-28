// components/priceWatch/PriceDriftCheck.tsx — "prices moved" at the moment a
// proposal is SENT or a contract is SIGNED (roadmap T2).
//
// One component, two presentations:
//   • 'card'  — inline, for the top of a send flow or a signing ceremony's
//               `above` slot;
//   • 'sheet' — a bottom sheet a screen opens before its own action.
// Both read utils/priceDriftGate.driftAtSend for ONE project: the lines his
// newest reviewed receipts contradict, minus the ones he chose to Keep.
//
// Three answers:
//   • "Reprice to today's receipts" — the exact write PriceWatchCard makes:
//     updateProject(id, commitEstimatePatch(project, next, { reason: 'manual',
//     note: 'Repriced from your receipts' })). A normal project write (the
//     project context queues it offline); the earlier estimate is kept as a
//     revision. Then onReprice(result) — the host decides what comes next,
//     because a proposal's typed cost and a contract's value are separate
//     fields that do NOT follow the estimate by themselves.
//   • "Keep these prices" — remembered on this device under
//     PRICE_WATCH_KEPT_KEY (the receipt card's own memory, swept at sign-out),
//     then onKeep().
//   • The continue button names the action — "Send anyway" / "Sign at these
//     prices" — and only calls onContinue(). NOTHING IS SENT OR SIGNED HERE.
//
// Unread is not clear: until the projects, the receipts and the Keep memory
// are read, usePriceDriftAtSend returns check = null and this renders nothing.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { formatMoney } from '@/utils/formatters';
import { PRICE_WATCH_KEPT_KEY } from '@/utils/receiptPriceWatch';
import { driftAtSend, keptKeysFor, type DriftAtSend } from '@/utils/priceDriftGate';
import type { Project } from '@/types';

// ─── Keep memory, shared by every mounted check ─────────────────────────────
// No module-level COPY of the keys (that would outlive a sign-out and cross
// accounts on a shared device): each hook reads storage on mount; the only
// thing held here is the list of mounted listeners, so a Keep in the sheet
// hides the same lines in the screen's own hook at once.
type KeptListener = (keys: readonly string[]) => void;
const keptListeners = new Set<KeptListener>();

async function readKept(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PRICE_WATCH_KEPT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    // No storage (private window, blocked site data): nothing was kept.
    return new Set();
  }
}

/** Add Keep keys: every mounted check hides them now, and they are saved on
 *  this device (merged with what is already there). */
export async function keepDriftKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const l of keptListeners) l(keys);
  try {
    const next = await readKept();
    for (const k of keys) next.add(k);
    await AsyncStorage.setItem(PRICE_WATCH_KEPT_KEY, JSON.stringify([...next]));
  } catch {
    // Device-only memory: the lines stay hidden this session.
  }
}

export interface PriceDriftAtSendState {
  /** null while anything is unread, or with no project. */
  check: DriftAtSend | null;
  loaded: boolean;
  project: Project | null;
}

/** The drift check for one project, for a screen that decides whether to show
 *  the sheet before its own send or sign. */
export function usePriceDriftAtSend(projectId: string | null | undefined): PriceDriftAtSendState {
  const { projects, projectsLoaded } = useProjects();
  const { receipts, isLoading } = useMaterialReceipts();
  const [kept, setKept] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    const onKeep: KeptListener = (keys) => {
      setKept(prev => {
        const next = new Set(prev ?? []);
        for (const k of keys) next.add(k);
        return next;
      });
    };
    keptListeners.add(onKeep);
    void readKept().then((set) => {
      if (!alive) return;
      // Merge, so a Keep made while storage was being read is not lost.
      setKept(prev => {
        const next = new Set(set);
        for (const k of prev ?? []) next.add(k);
        return next;
      });
    });
    return () => { alive = false; keptListeners.delete(onKeep); };
  }, []);

  const project = useMemo(
    () => (projectId ? (projects ?? []).find(p => p.id === projectId) ?? null : null),
    [projects, projectId],
  );
  const loaded = !!projectsLoaded && isLoading !== true && kept !== null;
  const check = useMemo(
    () => (loaded && project ? driftAtSend(project, projects, receipts, kept) : null),
    [loaded, project, projects, receipts, kept],
  );
  return { check, loaded, project };
}

// ─── The check ──────────────────────────────────────────────────────────────

const MAX_LINES = 5;

export interface PriceDriftCheckProps {
  project: Project;
  /** 'card' (inline) or 'sheet' (bottom sheet). Default 'card'. */
  presentation?: 'card' | 'sheet';
  /** Sheet only: whether it is open. Default true. */
  visible?: boolean;
  /** Names the continue button: 'send' → "Send anyway", 'sign' → "Sign at these prices". */
  action: 'send' | 'sign';
  /** After the reprice write, with the check it applied (grandAfterCents is the new total). */
  onReprice?: (result: DriftAtSend) => void;
  /** After the Keep memory was written. */
  onKeep?: () => void;
  /** Continue at the current prices. Nothing is sent or signed by this component. */
  onContinue: () => void;
  /** Sheet closed without an answer. */
  onCancel?: () => void;
  /** One sentence the host adds under "Repriced…" — e.g. whether the
   *  proposal's cost or the contract value followed the estimate. */
  repricedNote?: string | null;
}

export function PriceDriftCheck({
  project, presentation = 'card', visible = true, action, onReprice, onKeep, onContinue, onCancel, repricedNote,
}: PriceDriftCheckProps) {
  const styles = useThemedStyles(makeStyles);
  const { updateProject } = useProjects();
  const { check, project: fresh } = usePriceDriftAtSend(project.id);
  const [repriced, setRepriced] = useState<DriftAtSend | null>(null);

  const reprice = useCallback(() => {
    const base = fresh ?? project;
    if (!check || !check.next || check.lines.length === 0) return;
    updateProject(base.id, commitEstimatePatch(base, check.next, { reason: 'manual', note: 'Repriced from your receipts' }));
    setRepriced(check);
    onReprice?.(check);
  }, [check, fresh, project, updateProject, onReprice]);

  const keep = useCallback(() => {
    if (!check) return;
    void keepDriftKeys(keptKeysFor(check));
    onKeep?.();
  }, [check, onKeep]);

  const continueLabel = action === 'sign' ? 'Sign at these prices' : 'Send anyway';

  if (repriced) {
    // The estimate now carries the receipt prices, so the check itself is
    // clear. Say what changed, once, to the cent.
    const body = (
      <Text style={styles.body} testID="pricewatch-drift-repriced">
        {`Repriced from your receipts. The estimate total is now ${formatMoney(repriced.grandAfterCents / 100, 2)} (was ${formatMoney(repriced.grandBeforeCents / 100, 2)}). The earlier estimate is kept in its revision history.`}
        {repricedNote ? ` ${repricedNote}` : ''}
      </Text>
    );
    if (presentation === 'sheet') {
      return (
        <Sheet
          visible={visible}
          onClose={() => onCancel?.()}
          title="Prices updated"
          testID="pricewatch-drift-sheet"
          primaryAction={{ label: 'Done', onPress: () => onCancel?.(), testID: 'pricewatch-drift-done' }}
        >
          {body}
        </Sheet>
      );
    }
    return (
      <View testID="pricewatch-drift-card" style={styles.wrap}>
        <Card pad={Tokens.spacing.md} radius="md">{body}</Card>
      </View>
    );
  }

  if (!check || check.lines.length === 0) return null;

  const shown = check.lines.slice(0, MAX_LINES);
  const more = check.lines.length - shown.length;
  const lines = (
    <View style={styles.lines}>
      {shown.map((l, i) => (
        <Text key={`${i}-${l.finding.materialId}-${l.finding.latestReceiptLineId}`} style={styles.line}>{l.text}</Text>
      ))}
      {more > 0 ? <Text style={styles.line}>{`${more} more ${more === 1 ? 'price' : 'prices'} moved on this estimate.`}</Text> : null}
    </View>
  );
  const preview = (
    <Text style={styles.muted}>
      {`Reprice sets the estimate total to ${formatMoney(check.grandAfterCents / 100, 2)} (now ${formatMoney(check.grandBeforeCents / 100, 2)}). Each line keeps its own markup. Keep is saved on this device until you sign out.`}
    </Text>
  );
  const buttons = (
    <View style={[styles.actions, presentation === 'sheet' && styles.actionsStack]}>
      <Button label="Reprice to today's receipts" variant="primary" size="sm" fullWidth={presentation === 'sheet'} onPress={reprice} testID="pricewatch-drift-reprice" />
      <Button label="Keep these prices" variant="secondary" size="sm" fullWidth={presentation === 'sheet'} onPress={keep} testID="pricewatch-drift-keep" />
      <Button label={continueLabel} variant="secondary" size="sm" fullWidth={presentation === 'sheet'} onPress={onContinue} testID="pricewatch-drift-continue" />
    </View>
  );

  if (presentation === 'sheet') {
    return (
      <Sheet
        visible={visible}
        onClose={() => onCancel?.()}
        title={action === 'sign' ? 'Check prices before you sign' : 'Check prices before you send'}
        subtitle={check.summary}
        testID="pricewatch-drift-sheet"
        footer={<View style={styles.sheetFooter}>{buttons}</View>}
      >
        {lines}
        {preview}
      </Sheet>
    );
  }

  return (
    <View testID="pricewatch-drift-card" style={styles.wrap}>
      <Card pad={Tokens.spacing.md} radius="md">
        <EyebrowLabel tone="neutral" showDot={false}>Price watch</EyebrowLabel>
        <Text style={styles.title}>{check.summary}</Text>
        {lines}
        {preview}
        {buttons}
      </Card>
    </View>
  );
}

export default PriceDriftCheck;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginBottom: 12 },
  title: { ...Type.subheadEmphasized, color: t.text, marginTop: 6 },
  body: { ...Type.subhead, color: t.text },
  lines: { gap: 6, marginTop: 8 },
  line: { ...Type.footnote, color: t.textSecondary },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 },
  actionsStack: { flexDirection: 'column', alignItems: 'stretch' },
  sheetFooter: { paddingHorizontal: 16, paddingBottom: 16 },
});
