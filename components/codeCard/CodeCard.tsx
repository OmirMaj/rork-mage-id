// components/codeCard/CodeCard.tsx — one requirement, answer first.
//
//   [REQUIRED]  Final inspection · AI guess                    SAMPLE
//   Guards on every open side, at least 36 in. high.          ← our words, 21 pt
//   why-here or MAGE-calculator line
//   threshold tape (only from structured numbers)
//   R312.1 · 2025 RCNYS                    ▂▄▆█ Model recall · confirm
//   ─────────────────────────────────────────────────────────────────
//   Official text FREE │ Checklist │ Ask town │ ⋯                 ← 50 pt
//
// THE RULES IT KEEPS: the summary is MAGE's own words (parse.ts dropped any
// item whose summary failed summaryEchoCheck); the section and the edition
// always show; recall says so in the same place at the same size; amber only
// for "close to the line"; Official text copies the section and opens the
// whole volume (never a section link); every blocked button says why.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookOpen, Calculator, ClipboardCheck, Ellipsis, Info, MapPin, MessageCircleQuestion, TriangleAlert } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { DISPLAY_FONT } from '@/constants/typography';
import type { CodeCardItem, CodeJobValue, CodeJurisdictionInfo } from '@/utils/codeCard/types';
import { canRecheck, effectiveVerdict, recheck, stageInspectionLabel } from '@/utils/codeCard/verdict';
import { editionForItem } from '@/utils/codeCard/jurisdiction';
import {
  defaultOfficialTextDeps,
  officialTextPlan,
  officialTextToast,
  runOfficialText,
  type OfficialTextDeps,
} from '@/utils/codeCard/officialText';
import { useCodeCardPalette, type CodeCardPalette } from './palette';
import { SampleTag, VerdictTag } from './VerdictTag';
import { EvidenceMeter } from './EvidenceMeter';
import { ThresholdTape } from './ThresholdTape';
import { BlockedNote, type CodeCardAction } from './parts';

export const CLOSE_TO_LINE_NOTE = 'Close to the line: within 2 in. of the trigger. Measure again on site before you build to it.';
export const EDITION_NOT_CONFIRMED = 'Edition not confirmed';

export interface CodeCardProps {
  item: CodeCardItem;
  info?: CodeJurisdictionInfo | null;
  sample?: boolean;
  sunlight?: boolean;
  /** The re-measured number, when it differs from the item's own. */
  jobValue?: CodeJobValue;
  /** Tap on the card body: open the full card (CodeCardSheet). */
  onOpen?: (item: CodeCardItem) => void;
  checklist?: CodeCardAction;
  askTown?: CodeCardAction;
  /** The ⋯ button. Defaults to onOpen. */
  onMore?: (item: CodeCardItem) => void;
  /** Injected in tests; the app uses the real clipboard + browser. */
  officialTextDeps?: OfficialTextDeps;
  testID?: string;
}

export function CodeCard({
  item, info, sample, sunlight, jobValue, onOpen, checklist, askTown, onMore, officialTextDeps, testID,
}: CodeCardProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const [note, setNote] = useState<string | null>(null);
  const tid = testID ?? `code-card-${item.id}`;

  const jv = jobValue ?? item.jobValue;
  const verdict = effectiveVerdict(item, jv);
  const recheckable = !!jv && canRecheck({ jobValue: jv, trigger: item.trigger });
  const close = recheckable && jv && item.trigger ? recheck(jv, item.trigger).closeToLine : false;
  const edition = editionForItem(item, info);
  const plan = officialTextPlan(item, info);
  const stageText = `${stageInspectionLabel(item.stage)}${item.stage && item.stageIsGuess ? ' · AI guess' : ''}`;
  const more = onMore ?? onOpen;

  const onOfficial = async () => {
    if (!plan.available) { setNote(plan.blockedReason); return; }
    const result = await runOfficialText(plan, officialTextDeps ?? defaultOfficialTextDeps());
    setNote(officialTextToast(plan, result));
  };

  const press = (label: string, action: CodeCardAction | undefined) => () => {
    if (!action) return;
    if (action.kind === 'ready') { setNote(null); action.onPress(); }
    else if (action.kind === 'blocked') setNote(`${label}: ${action.reason}`);
  };

  const cell = (key: string, label: string, Icon: typeof BookOpen, action: CodeCardAction | undefined) => {
    const done = action?.kind === 'done';
    const blocked = !action || action.kind === 'blocked';
    const text = done ? (action as { label: string }).label : action?.kind === 'ready' && action.label ? action.label : label;
    const color = done ? P.successLabel : blocked ? P.ink3 : P.ink2;
    return (
      <Pressable
        key={key}
        onPress={press(label, action ?? { kind: 'blocked', reason: 'Not available here.' })}
        style={({ pressed }) => [styles.act, styles.actRule, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={blocked ? `${label}, not available` : text}
        accessibilityState={{ disabled: blocked, checked: done ? true : undefined }}
        testID={`${tid}-${key}`}
      >
        {P.sunlight ? null : <Icon size={17} color={color} strokeWidth={1.9} />}
        <Text style={[styles.actLabel, { color }]} numberOfLines={1}>{text}</Text>
      </Pressable>
    );
  };

  const body = (
    <>
      <View style={styles.top}>
        <VerdictTag verdict={verdict} sunlight={sunlight} testID={`${tid}-verdict`} />
        <Text style={styles.stage} numberOfLines={1}>{stageText}</Text>
        <View style={styles.spacer} />
        {sample ? <SampleTag sunlight={sunlight} /> : null}
      </View>
      <Text style={styles.verdictLine} accessibilityRole="header">{item.summary}</Text>
      {item.observed ? (
        <Text style={styles.observed}>{item.observed}</Text>
      ) : null}
      {item.why ? (
        <View style={styles.why}>
          <Info size={15} color={P.ink3} strokeWidth={1.9} />
          <Text style={styles.whyText}>{item.why}</Text>
        </View>
      ) : null}
      {item.calc ? (
        <View style={styles.why}>
          <Calculator size={15} color={P.ink3} strokeWidth={1.9} />
          <Text style={styles.whyText}>
            {`${item.calc.expression} = `}
            <Text style={styles.strong}>{item.calc.value}</Text>
            {item.calc.note ? `. ${item.calc.note}` : ''}
            <Text style={styles.calcTag}>{'  MAGE calculator'}</Text>
          </Text>
        </View>
      ) : null}
      {recheckable ? (
        <View style={styles.tape}>
          <ThresholdTape jobValue={jv} trigger={item.trigger} verdict={item.verdict} evidence={item.evidence} sunlight={sunlight} testID={`${tid}-tape`} />
        </View>
      ) : null}
      {close ? (
        <View style={styles.near} accessibilityLiveRegion="polite" testID={`${tid}-near`}>
          <TriangleAlert size={16} color={P.warnLabel} strokeWidth={2} />
          <Text style={styles.nearText}>{CLOSE_TO_LINE_NOTE}</Text>
        </View>
      ) : null}
      <View style={styles.meta}>
        <Text style={styles.sec}>{item.section}</Text>
        <Text style={styles.dot}>{'·'}</Text>
        <Text style={styles.metaText}>{edition ?? EDITION_NOT_CONFIRMED}</Text>
        {item.location ? (
          <View style={styles.loc}>
            <MapPin size={12} color={P.accentLabel} strokeWidth={2} />
            <Text style={styles.locText}>{item.location}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <EvidenceMeter evidence={item.evidence} sunlight={sunlight} testID={`${tid}-evidence`} />
      </View>
    </>
  );

  return (
    <Card pad="none" radius="panel" style={[styles.card, P.sunlight && styles.cardSun]} testID={tid}>
      {onOpen ? (
        <Pressable
          onPress={() => onOpen(item)}
          style={({ pressed }) => [styles.inner, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${item.summary} Open the full card.`}
          testID={`${tid}-open`}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.inner}>{body}</View>
      )}
      <View style={styles.acts}>
        <Pressable
          onPress={() => { void onOfficial(); }}
          style={({ pressed }) => [styles.act, styles.actGo, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={plan.available
            ? `Official text, free. Copies ${plan.copyText} and opens ${plan.viewerShort ?? 'the code'} in ICC's free viewer.`
            : 'Official text, not available'}
          accessibilityState={{ disabled: !plan.available }}
          testID={`${tid}-official`}
        >
          {P.sunlight ? null : <BookOpen size={17} color={plan.available ? P.accentLabel : P.ink3} strokeWidth={1.9} />}
          <Text style={[styles.actLabel, { color: plan.available ? P.accentLabel : P.ink3 }]} numberOfLines={1}>Official text</Text>
          <View style={styles.free}><Text style={styles.freeText}>Free</Text></View>
        </Pressable>
        {cell('checklist', 'Checklist', ClipboardCheck, checklist)}
        {cell('ask', 'Ask town', MessageCircleQuestion, askTown)}
        <Pressable
          onPress={() => (more ? more(item) : setNote('More: open the full card from the list.'))}
          style={({ pressed }) => [styles.act, styles.actRule, styles.actMore, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="More: send to a sub, save, and the full card"
          testID={`${tid}-more`}
        >
          <Ellipsis size={18} color={P.ink2} strokeWidth={1.9} />
        </Pressable>
      </View>
      <BlockedNote text={note} sunlight={sunlight} testID={`${tid}-note`} />
    </Card>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    card: { overflow: 'hidden' },
    cardSun: { borderWidth: 2, borderColor: P.line, backgroundColor: P.surface },
    inner: { paddingVertical: 14, paddingHorizontal: 16 },
    pressed: { backgroundColor: P.soft },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    stage: { flexShrink: 1, fontSize: 13 + P.bump / 2, fontWeight: '500', color: P.ink3 },
    spacer: { flex: 1 },
    verdictLine: { fontFamily: DISPLAY_FONT.semibold, fontSize: 21 + P.bump, lineHeight: 25 + P.bump, color: P.ink },
    observed: { marginTop: 6, fontSize: 14.5 + P.bump, fontWeight: '700', color: P.ink },
    why: { flexDirection: 'row', gap: 8, marginTop: 9 },
    whyText: { flex: 1, fontSize: 14.5 + P.bump, lineHeight: 20.5 + P.bump, color: P.ink2 },
    strong: { fontWeight: '700', color: P.ink },
    calcTag: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: P.ink3 },
    tape: { marginTop: 12 },
    near: { flexDirection: 'row', gap: 8, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: P.warnSoft },
    nearText: { flex: 1, fontSize: 13.5 + P.bump / 2, lineHeight: 19 + P.bump / 2, fontWeight: '500', color: P.ink },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, marginTop: 12 },
    sec: { fontSize: 12.5 + P.bump / 2, fontWeight: '700', color: P.ink },
    dot: { fontSize: 12.5, color: P.ink3 },
    metaText: { fontSize: 12.5 + P.bump / 2, fontWeight: '500', color: P.ink2 },
    loc: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    locText: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.accentLabel },
    acts: { flexDirection: 'row', borderTopWidth: P.rule, borderTopColor: P.line },
    act: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2 },
    actRule: { borderLeftWidth: P.rule, borderLeftColor: P.line },
    actGo: { flex: 1.6 },
    actMore: { flex: 0, width: 50 },
    actLabel: { fontSize: 13.5 + P.bump / 2, fontWeight: '600' },
    free: { paddingHorizontal: 4, paddingVertical: 3, borderRadius: 4, backgroundColor: P.accentSoft },
    freeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: P.accentLabel },
  });
