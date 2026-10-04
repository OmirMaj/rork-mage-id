// components/codeCard/CodeCardList.tsx — a list of code cards that still
// reads at 10+ items.
//
// Two modes, picked from the items (override with `mode`):
//   answer  (Ask / Code Check): "3 requirements" + a Cards / List toggle.
//   plan    (plan code check rows carry a status): the headline ("3 things to
//           fix before you submit."), the tally squares, the three-mark
//           sources key, a By status / By inspection toggle (with the real
//           booked date when the caller has one), and the rows.
// Both end with the bulk bar (56 pt primary, 48 pt secondaries), the
// "Confirm with your building department" block and the not-affiliated line.
//
// The list never sends anything itself: every bulk action is the caller's
// CodeCardAction (ready / done / blocked-with-a-reason).

import React, { useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Bookmark, CalendarDays, Check, ClipboardCheck, FileText, LayoutList, MessageCircleQuestion, Rows3, Send } from 'lucide-react-native';
import { Button, Card, SegmentedControl, layoutNext, useSwapFade } from '@/components/ui';
import { DISPLAY_FONT } from '@/constants/typography';
import type { CodeCardItem, CodeJobValue, CodeJurisdictionInfo, CodeStage } from '@/utils/codeCard/types';
import {
  groupByStage,
  groupByStatus,
  isPlanCheck,
  planHeadline,
  requirementsCount,
  tallyFor,
  tallySquares,
} from '@/utils/codeCard/summary';
import { editionForItem, sourceLine } from '@/utils/codeCard/jurisdiction';
import { withChosenStage } from '@/utils/codeCard/pins';
import type { OfficialTextDeps } from '@/utils/codeCard/officialText';
import { useCodeCardPalette, type CodeCardPalette } from './palette';
import { CodeCard } from './CodeCard';
import { CodeCardRow } from './CodeCardRow';
import { EvidenceBars } from './EvidenceMeter';
import { SampleTag } from './VerdictTag';
import { BlockedNote, ConfirmBlock, NOT_AFFILIATED, type CodeCardAction } from './parts';

export type CodeBulkIcon = 'send' | 'file' | 'save' | 'ask' | 'clip';

export interface CodeBulkAction {
  key: string;
  label: string;
  icon?: CodeBulkIcon;
  action: CodeCardAction;
}

export interface CodeCardListProps {
  items: CodeCardItem[];
  info?: CodeJurisdictionInfo | null;
  mode?: 'answer' | 'plan';
  sample?: boolean;
  sunlight?: boolean;
  /** Plan mode: "Result · 10 checked" by default. */
  eyebrow?: string;
  headline?: string;
  subline?: string;
  /** Plan mode: the sheet the AI read, for the sources key ("A-2"). */
  planSourceLabel?: string | null;
  /** By inspection: the booked date per stage, pre-formatted ("Thu, Oct 9"), or null = not booked. */
  bookedDates?: Partial<Record<CodeStage, string | null>>;
  /** The contractor's own stage edits over the AI's guess. */
  stageOf?: (item: CodeCardItem) => CodeStage | undefined;
  /**
   * The number he re-measured on a card this session (the opened card's − / +),
   * so the card in the list shows the number Save keeps. Undefined = the item's own.
   */
  jobValueOf?: (item: CodeCardItem) => CodeJobValue | undefined;
  /** Answer mode: start in list view. */
  initialView?: 'cards' | 'list';
  onOpen?: (item: CodeCardItem) => void;
  checklistFor?: (item: CodeCardItem) => CodeCardAction | undefined;
  askTownFor?: (item: CodeCardItem) => CodeCardAction | undefined;
  primary?: CodeBulkAction;
  secondary?: CodeBulkAction[];
  officialTextDeps?: OfficialTextDeps;
  testID?: string;
}

const BULK_ICON = { send: Send, file: FileText, save: Bookmark, ask: MessageCircleQuestion, clip: ClipboardCheck } as const;

export const LOOK_RIGHT_NOTE = '“Look right” is the AI’s read of the drawing, not an approval.';
export const ANSWER_FINE_PRINT = `${NOT_AFFILIATED} Requirements are in our own words, with the section and the edition this address follows. Read the full official text free in ICC’s viewer.`;

export function CodeCardList(props: CodeCardListProps) {
  const {
    items, info, sample, sunlight, eyebrow, headline, subline, planSourceLabel, bookedDates, stageOf, jobValueOf,
    initialView, onOpen, checklistFor, askTownFor, primary, secondary, officialTextDeps, testID,
  } = props;
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const mode = props.mode ?? (isPlanCheck(items) ? 'plan' : 'answer');
  const [view, setView] = useState<'cards' | 'list'>(initialView ?? 'cards');
  const [groupBy, setGroupBy] = useState<'status' | 'stage'>('status');
  const [note, setNote] = useState<string | null>(null);
  const swap = useSwapFade(`${view}:${groupBy}`);
  const tid = testID ?? 'code-card-list';

  const tally = tallyFor(items);
  const plan = planHeadline(items);
  const editionSrc = sourceLine(info?.editionSourceUrl, info?.editionCheckedOn);

  const bulkButton = (b: CodeBulkAction, size: 'lg' | 'md', variant: 'primary' | 'secondary') => {
    const Icon = b.icon ? BULK_ICON[b.icon] : null;
    const a = b.action;
    const label = a.kind === 'done' ? a.label : b.label;
    const iconColor = variant === 'primary' ? P.onFill : P.ink2;
    return (
      <Button
        key={b.key}
        label={label}
        size={size}
        variant={variant}
        fullWidth={size === 'lg'}
        disabled={a.kind === 'blocked'}
        iconLeft={a.kind === 'done' ? <Check size={18} color={iconColor} strokeWidth={2.4} /> : Icon ? <Icon size={size === 'lg' ? 19 : 16} color={iconColor} strokeWidth={2} /> : undefined}
        onPress={() => {
          if (a.kind === 'ready') { setNote(null); a.onPress(); }
        }}
        containerStyle={size === 'md' ? styles.secondary : undefined}
        testID={`${tid}-bulk-${b.key}`}
      />
    );
  };
  const blockedReasons = [primary, ...(secondary ?? [])]
    .filter((b): b is CodeBulkAction => !!b && b.action.kind === 'blocked')
    .map((b) => `${b.label}: ${(b.action as { reason: string }).reason}`);

  const rowsBlock = (list: CodeCardItem[], showStage: boolean, key: string) => (
    <Card key={key} pad="none" radius="panel" style={[styles.rows, P.sunlight && styles.rowsSun]}>
      {list.map((item, i) => (
        <CodeCardRow
          key={item.id}
          item={stageOf ? withChosenStage(item, stageOf(item)) : item}
          onPress={onOpen}
          showStage={showStage}
          edition={mode === 'answer' ? editionForItem(item, info) : null}
          info={info}
          ruled={i > 0}
          sunlight={sunlight}
        />
      ))}
    </Card>
  );

  const groupHead = (key: string, label: string, count: number, tone: 'fix' | 'ask' | 'ok' | 'stage', date?: string | null | undefined) => (
    <View key={`h-${key}`} style={styles.grp} accessibilityRole="header">
      <Text style={[styles.grpLabel, tone === 'fix' ? styles.grpFix : tone === 'ok' ? styles.grpOk : null]}>{label}</Text>
      <Text style={styles.grpCount}>{String(count)}</Text>
      <View style={styles.spacer} />
      {date !== undefined ? (
        date ? (
          <View style={styles.grpDate}>
            <CalendarDays size={13} color={P.accentLabel} strokeWidth={2} />
            <Text style={styles.grpDateText}>{date}</Text>
          </View>
        ) : <Text style={styles.grpNot}>Not booked</Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (mode === 'plan') {
    if (groupBy === 'status') {
      body = groupByStatus(items).map((g) => (
        <View key={g.key}>
          {groupHead(g.key, g.label, g.items.length, g.key === 'fix' ? 'fix' : g.key === 'ok' ? 'ok' : 'ask')}
          {rowsBlock(g.items, true, `r-${g.key}`)}
        </View>
      ));
    } else {
      body = groupByStage(items, stageOf).map((g) => (
        <View key={g.key}>
          {groupHead(g.key, g.label, g.items.length, 'stage', bookedDates && g.key !== 'unset' ? bookedDates[g.key] ?? null : undefined)}
          {rowsBlock(g.items, false, `r-${g.key}`)}
        </View>
      ));
    }
  } else if (view === 'list') {
    body = rowsBlock(items, true, 'r-all');
  } else {
    body = (
      <View style={styles.cards}>
        {items.map((item) => (
          <CodeCard
            key={item.id}
            item={stageOf ? withChosenStage(item, stageOf(item)) : item}
            info={info}
            sample={sample}
            sunlight={sunlight}
            jobValue={jobValueOf?.(item)}
            onOpen={onOpen}
            checklist={checklistFor?.(item)}
            askTown={askTownFor?.(item)}
            officialTextDeps={officialTextDeps}
          />
        ))}
      </View>
    );
  }

  return (
    <View testID={tid}>
      {mode === 'plan' ? (
        <>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{eyebrow ?? `Result · ${tally.total} checked`}</Text>
            <View style={styles.spacer} />
            {sample ? <SampleTag sunlight={sunlight} /> : null}
          </View>
          <Text style={styles.headline} accessibilityRole="header">{headline ?? plan.headline}</Text>
          {(subline ?? plan.subline) ? <Text style={styles.subline}>{subline ?? plan.subline}</Text> : null}
          <View style={styles.tally} accessible accessibilityLabel={`${tally.fix} to fix, ${tally.ask} to ask, ${tally.ok} look right`}>
            {tallySquares(items).map((s, i) => (
              <View key={`${s}-${i}`} style={[styles.sq, s === 'fix' ? styles.sqFix : s === 'ok' ? styles.sqOk : styles.sqAsk]} />
            ))}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendSq, styles.sqFix]} /><Text style={styles.legendText}>{`${tally.fix} fix`}</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendSq, styles.sqAsk]} /><Text style={styles.legendText}>{`${tally.ask} ask`}</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendSq, styles.sqOk]} /><Text style={styles.legendText}>{`${tally.ok} look right`}</Text></View>
          </View>
          <Card pad={14} radius="lg" style={[styles.marks, P.sunlight && styles.rowsSun]}>
            <View style={styles.mk}>
              <View style={styles.mkDot} />
              <Text style={styles.mkText}>
                <Text style={styles.mkStrong}>Code edition</Text>
                {info?.editionLabel ? `: ${info.editionLabel}${editionSrc ? `, ${editionSrc}` : ''}.` : ': not confirmed for this address.'}
              </Text>
            </View>
            <View style={styles.mk}>
              <View style={styles.mkBars}><EvidenceBars evidence={null} sunlight={sunlight} /></View>
              <Text style={styles.mkText}>
                <Text style={styles.mkStrong}>Section numbers</Text>
                {': model recall. Confirm before you rely on one.'}
              </Text>
            </View>
            <View style={styles.mk}>
              <View style={styles.mkPen} />
              <Text style={styles.mkText}>
                <Text style={styles.mkStrong}>Plan reading</Text>
                {`: the AI’s read of ${planSourceLabel ?? 'the drawing'}. Check the sheet before you act on it.`}
              </Text>
            </View>
          </Card>
          <SegmentedControl
            options={[
              { value: 'status', label: 'By status', testID: `${tid}-by-status` },
              { value: 'stage', label: 'By inspection', testID: `${tid}-by-stage` },
            ]}
            value={groupBy}
            onChange={(v) => { layoutNext(); setGroupBy(v as 'status' | 'stage'); }}
            accessibilityLabel="Group by"
            style={styles.toggle}
          />
        </>
      ) : (
        <View style={styles.sechead}>
          <Text style={styles.secheadText} accessibilityRole="header">{requirementsCount(items)}</Text>
          <SegmentedControl
            options={[
              { value: 'cards', label: 'Cards', icon: Rows3, accessibilityLabel: 'Show as cards', testID: `${tid}-cards` },
              { value: 'list', label: 'List', icon: LayoutList, accessibilityLabel: 'Show as a list', testID: `${tid}-list` },
            ]}
            value={view}
            onChange={(v) => { layoutNext(); setView(v as 'cards' | 'list'); }}
            accessibilityLabel="View"
          />
        </View>
      )}

      <Animated.View style={swap}>{body}</Animated.View>

      {mode === 'plan' ? <Text style={styles.fine}>{LOOK_RIGHT_NOTE}</Text> : null}

      {primary || (secondary && secondary.length) ? (
        <View style={styles.bulk}>
          {primary ? bulkButton(primary, 'lg', 'primary') : null}
          {secondary && secondary.length ? (
            <View style={styles.bulkRow}>{secondary.map((b) => bulkButton(b, 'md', 'secondary'))}</View>
          ) : null}
          {blockedReasons.length ? <BlockedNote text={blockedReasons.join(' ')} sunlight={sunlight} testID={`${tid}-blocked`} /> : null}
          <BlockedNote text={note} sunlight={sunlight} />
        </View>
      ) : null}

      <ConfirmBlock
        sunlight={sunlight}
        line={mode === 'plan'
          ? `A pre-check of what’s visible on ${planSourceLabel ?? 'the drawing'}, not plan review. ${NOT_AFFILIATED}`
          : `${info?.permitOfficeTitle ? `${info.permitOfficeTitle} issues this permit. ` : ''}Ask town drafts the question, and you send it yourself.`}
        testID={`${tid}-confirm`}
      />
      {mode === 'answer' ? <Text style={styles.fine}>{ANSWER_FINE_PRINT}</Text> : null}
    </View>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    spacer: { flex: 1 },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    eyebrow: { fontSize: 11.5 + P.bump / 2, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', color: P.ink3 },
    headline: { fontFamily: DISPLAY_FONT.semibold, fontSize: 27 + P.bump, lineHeight: 30 + P.bump, color: P.ink },
    subline: { fontSize: 15.5 + P.bump, lineHeight: 21.5 + P.bump, color: P.ink2, marginTop: 8 },
    tally: { flexDirection: 'row', gap: 3, marginTop: 16 },
    sq: { flex: 1, height: 9, borderRadius: 2 },
    sqFix: { backgroundColor: P.warnLabel },
    sqAsk: { borderWidth: 1.5, borderColor: P.ink3 },
    sqOk: { backgroundColor: P.success },
    legend: { flexDirection: 'row', gap: 14, marginTop: 9 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSq: { width: 9, height: 9, borderRadius: 2 },
    legendText: { fontSize: 13 + P.bump / 2, fontWeight: '600', color: P.ink2 },
    marks: { marginTop: 14, gap: 7 },
    mk: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
    mkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: P.success, marginTop: 5, marginLeft: 3, marginRight: 4 },
    mkBars: { width: 14, marginTop: 3 },
    mkPen: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.5, borderColor: P.ink2, marginTop: 3, marginLeft: 2, marginRight: 2 },
    mkText: { flex: 1, fontSize: 13 + P.bump / 2, lineHeight: 17.5 + P.bump / 2, color: P.ink2 },
    mkStrong: { fontWeight: '600', color: P.ink },
    toggle: { marginTop: 16 },
    sechead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    secheadText: { flex: 1, fontSize: 12 + P.bump / 2, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: P.ink2 },
    grp: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 8, marginHorizontal: 2 },
    grpLabel: { fontSize: 12 + P.bump / 2, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', color: P.ink2 },
    grpFix: { color: P.warnLabel },
    grpOk: { color: P.successLabel },
    grpCount: { fontSize: 12 + P.bump / 2, fontWeight: '700', color: P.ink3 },
    grpDate: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    grpDateText: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.accentLabel },
    grpNot: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.ink2 },
    rows: { overflow: 'hidden' },
    rowsSun: { borderWidth: 2, borderColor: P.line, backgroundColor: P.surface },
    cards: { gap: 12 },
    fine: { fontSize: 12.5 + P.bump / 2, lineHeight: 18 + P.bump / 2, color: P.ink3, marginTop: 12, marginHorizontal: 2 },
    bulk: { marginTop: 16, gap: 8 },
    bulkRow: { flexDirection: 'row', gap: 8 },
    secondary: { flex: 1 },
  });
