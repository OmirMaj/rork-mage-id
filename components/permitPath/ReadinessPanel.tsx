// components/permitPath/ReadinessPanel.tsx — "Ready to file?" (lane PPUI, M6).
//
// What the filing needs, missing first, each line with its source chip and one
// of: "Have it" (attested with today's date), "Link a permit" (one of this
// job's permits), "Not needed", or "Ask" for a line nobody knows yet. A line
// MAGE does not know stays "Not known yet" until the department answers, even
// if it is marked (readinessFor's rule); AI draft lines never count (the engine
// gives them readiness:false).
//
// Motion from the kit only: CountRoll steps the tally, CheckSync ticks a row
// the moment its mark lands. "Saved on this device." (PLAN F2).

import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Circle, HelpCircle, Minus, Printer, Share2 } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import type { Permit } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button, Card } from '@/components/ui';
import { CheckSync, CountRoll, type CheckRow, type CheckStatus } from '@/components/motion/kit';
import { nailIt } from '@/components/animations/NailItToast';
import { formatCalendarDayL } from '@/i18n';
import { PERMIT_TYPE_INFO } from '@/mocks/permits';
import { READINESS_LABEL } from '@/utils/permitPath/packs';
import type { SavedDeptAnswer } from '@/utils/permitPath/deptAnswers';
import type { ReadinessRow, ReadinessTally } from '@/utils/permitPath/readiness';
import type { ReadinessMark } from '@/utils/permitPath/types';
import { sourceChipFor } from '@/components/permitPath/sourceChip';

export interface ReadinessPanelProps {
  rows: readonly ReadinessRow[];
  tally: ReadinessTally;
  /** This job's permits (for "Link a permit"). */
  permits: readonly Permit[];
  /** 'YYYY-MM-DD'. */
  today: string;
  savedAnswer?: (id: string) => SavedDeptAnswer | undefined;
  onMark: (itemId: string, mark: ReadinessMark | null) => void;
  onAsk: (questionIds: string[]) => void;
  /** The plain-text checklist (shareText). */
  share: string;
  /** Desktop left pane: the tally and the first missing lines, then "Open checklist". */
  summary?: boolean;
  onOpenFull?: () => void;
  testID?: string;
}

type T = ReturnType<typeof useT>['t'];

const day = (iso: string): string => formatCalendarDayL(iso);

function statusOf(r: ReadinessRow): CheckStatus {
  if (r.state === 'have') return 'done';
  if (r.state === 'n_a') return 'failed';
  if (r.state === 'unknown') return 'active';
  return 'pending';
}

function evidenceLine(t: T, r: ReadinessRow, permits: readonly Permit[]): string | null {
  const m = r.mark;
  if (!m || r.state === 'unknown') return null;
  if (m.state === 'n_a') return t('office.permitPath.ready.markedNa', 'Marked not needed · {date}', { date: day(m.at) });
  if (m.state !== 'have') return null;
  if (m.evidence?.kind === 'permit') {
    const p = permits.find((x) => x.id === m.evidence?.ref);
    const name = p ? `${PERMIT_TYPE_INFO[p.type]?.label ?? p.type}${p.permitNumber ? ` · ${p.permitNumber}` : ''}` : t('office.permitPath.ready.permitGone', 'a permit no longer in this project');
    return t('office.permitPath.ready.linked', 'Linked to {permit} · {date}', { permit: name, date: day(m.at) });
  }
  return t('office.permitPath.ready.attested', 'You said you have it · {date}', { date: day(m.at) });
}

export function ReadinessPanel({
  rows, tally, permits, today, savedAnswer, onMark, onAsk, share, summary = false, onOpenFull, testID = 'permit-path-ready',
}: ReadinessPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { t, tn } = useT();
  const [linking, setLinking] = useState<string | null>(null);

  // The tally steps up through each real count when a mark lands; at rest it is plain text.
  const prevHave = useRef(tally.have);
  const rising = tally.have > prevHave.current;
  const steps = rising
    ? Array.from({ length: tally.have - prevHave.current }, (_, i) => prevHave.current + i + 1)
    : [tally.have];
  useEffect(() => { prevHave.current = tally.have; }, [tally.have]);
  const tallyText = (have: number) => {
    const inHand = t('office.permitPath.ready.inHand', '{have} of {total} in hand', { have, total: tally.total });
    return tally.unknown > 0
      ? `${inHand} · ${tn('office.permitPath.ready.notKnown', tally.unknown, { one: '1 not known yet', other: '{count} not known yet' })}`
      : inHand;
  };

  const doShare = async () => {
    if (Platform.OS === 'web') {
      try {
        await Clipboard.setStringAsync(share);
        nailIt(t('office.permitPath.ready.copied', 'Checklist copied'));
      } catch {
        nailIt(t('office.permitPath.ready.copyFailed', 'Couldn’t copy the checklist'));
      }
      return;
    }
    try { await Share.share({ message: share }); } catch { /* the GC closed the share sheet */ }
  };
  const doPrint = () => {
    const w = (globalThis as { print?: () => void }).print;
    if (typeof w === 'function') w();
  };

  const attest = (itemId: string) => onMark(itemId, { state: 'have', evidence: { kind: 'attested', ref: null }, at: today });
  const linkPermit = (itemId: string, permitId: string) => {
    onMark(itemId, { state: 'have', evidence: { kind: 'permit', ref: permitId }, at: today });
    setLinking(null);
  };
  const notNeeded = (itemId: string) => onMark(itemId, { state: 'n_a', evidence: null, at: today });

  const shownRows = summary ? rows.filter((r) => r.state === 'missing').slice(0, 3) : rows;

  const checkRows: CheckRow[] = shownRows.map((r) => {
    const chip = sourceChipFor(r.item, { today, formatDay: day, savedAnswer });
    const label = READINESS_LABEL[r.item.id] ?? r.item.text;
    const evidence = evidenceLine(t, r, permits);
    return {
      key: r.item.id,
      status: statusOf(r),
      render: () => (
        <View style={styles.rowBody} testID={`${testID}-row-${r.item.id}`}>
          <Text style={[styles.rowText, r.state === 'n_a' && styles.rowDim]}>{label}</Text>
          <Pressable
            onPress={chip.action ? () => {
              if (chip.action?.kind === 'link') void Linking.openURL(chip.action.url);
              else if (chip.action?.kind === 'ask') onAsk([chip.action.questionId]);
            } : undefined}
            disabled={!chip.action}
            accessibilityRole={chip.action?.kind === 'link' ? 'link' : 'button'}
            accessibilityLabel={chip.label}
            style={[styles.chip, chip.tone === 'unknown' ? styles.chipUnknown : styles.chipPlain]}
            testID={`${testID}-row-${r.item.id}-chip`}
          >
            <Text style={[styles.chipText, chip.tone === 'unknown' && styles.chipUnknownText]} numberOfLines={2}>{chip.label}</Text>
          </Pressable>
          {evidence ? <Text style={styles.evidence}>{evidence}</Text> : null}
          {!summary ? (
            <View style={styles.actions}>
              {r.state === 'unknown' ? (
                r.item.askQuestionId ? (
                  <Button label={t('office.permitPath.ready.ask', 'Ask')} size="sm" variant="secondary" onPress={() => onAsk([r.item.askQuestionId as string])} testID={`${testID}-row-${r.item.id}-ask`} />
                ) : null
              ) : r.state === 'missing' ? (
                <>
                  <Button label={t('office.permitPath.ready.have', 'Have it')} size="sm" onPress={() => attest(r.item.id)} testID={`${testID}-row-${r.item.id}-have`} />
                  {permits.length > 0 ? (
                    <Button label={t('office.permitPath.ready.link', 'Link a permit')} size="sm" variant="secondary" onPress={() => setLinking(linking === r.item.id ? null : r.item.id)} testID={`${testID}-row-${r.item.id}-link`} />
                  ) : null}
                  <Button label={t('office.permitPath.ready.notNeeded', 'Not needed')} size="sm" variant="ghost" onPress={() => notNeeded(r.item.id)} testID={`${testID}-row-${r.item.id}-na`} />
                </>
              ) : (
                <Button label={t('office.permitPath.ready.undo', 'Undo')} size="sm" variant="ghost" onPress={() => onMark(r.item.id, null)} testID={`${testID}-row-${r.item.id}-undo`} />
              )}
            </View>
          ) : null}
          {linking === r.item.id ? (
            <View style={styles.permitPick} testID={`${testID}-row-${r.item.id}-permits`}>
              {permits.map((p) => (
                <Pressable key={p.id} onPress={() => linkPermit(r.item.id, p.id)} style={styles.permitChip} accessibilityRole="button" testID={`${testID}-permit-${p.id}`}>
                  <Text style={styles.chipText}>{`${PERMIT_TYPE_INFO[p.type]?.label ?? p.type}${p.permitNumber ? ` · ${p.permitNumber}` : ''}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ),
    };
  });

  const glyph = (s: CheckStatus) => {
    if (s === 'done') return <View style={[styles.glyph, styles.glyphDone]}><Check size={12} color={c.surface} strokeWidth={3} /></View>;
    if (s === 'failed') return <View style={styles.glyph}><Minus size={12} color={c.textMuted} /></View>;
    if (s === 'active') return <View style={styles.glyph}><HelpCircle size={14} color={c.warningLabel} /></View>;
    return <View style={styles.glyph}><Circle size={14} color={c.textMuted} /></View>;
  };

  return (
    <Card style={styles.card} testID={testID}>
      <Text style={styles.panelHead}>{t('office.permitPath.ready.heading', 'Ready to file?')}</Text>
      <CountRoll key={tally.have} steps={steps} armed={rising} format={tallyText} style={styles.tally} testID={`${testID}-tally`} />
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('office.permitPath.ready.empty', 'Nothing on the checklist yet. Answer the questions above to build it.')}</Text>
      ) : (
        <CheckSync rows={checkRows} renderCheck={glyph} rowStyle={styles.row} testID={`${testID}-rows`} />
      )}
      {summary ? (
        onOpenFull ? <Button label={t('office.permitPath.ready.open', 'Open checklist')} size="sm" variant="secondary" onPress={onOpenFull} containerStyle={styles.alignStart} testID={`${testID}-open`} /> : null
      ) : (
        <View style={styles.actions}>
          <Button label={t('office.permitPath.ready.share', 'Share checklist')} size="sm" variant="secondary" iconLeft={<Share2 size={14} color={c.text} />} onPress={() => { void doShare(); }} testID={`${testID}-share`} />
          {Platform.OS === 'web' ? (
            <Button label={t('office.permitPath.ready.print', 'Print checklist')} size="sm" variant="ghost" iconLeft={<Printer size={14} color={c.text} />} onPress={doPrint} testID={`${testID}-print`} />
          ) : null}
        </View>
      )}
      <Text style={styles.muted}>{t('office.permitPath.ready.private', 'Saved on this device.')}</Text>
    </Card>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { marginBottom: 12, gap: 8 },
    panelHead: { ...Type.headline, color: c.text },
    tally: { ...Type.bodyCompactEmphasized, color: c.text },
    muted: { ...Type.footnote, color: c.textSecondary },
    row: { alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    rowBody: { flex: 1, gap: 4 },
    rowText: { ...Type.bodyCompact, color: c.text },
    rowDim: { color: c.textMuted, textDecorationLine: 'line-through' },
    chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
    chipPlain: { backgroundColor: c.neutralSoft },
    chipUnknown: { backgroundColor: c.warningSoft },
    chipText: { ...Type.footnote, color: c.text },
    chipUnknownText: { color: c.warningLabel },
    evidence: { ...Type.footnote, color: c.successLabel },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
    alignStart: { alignSelf: 'flex-start' },
    permitPick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    permitChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: c.accent },
    glyph: { width: 20, height: 20, borderRadius: Tokens.radius.full, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginTop: 2 },
    glyphDone: { backgroundColor: c.accent },
  });
}

export default ReadinessPanel;
