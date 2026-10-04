// components/codeCard/CodeCardRow.tsx — one requirement on one line, for long
// lists (10+ items) and the plan code check. The number goes in the row
// ("Drawn 4½ in."), so the row answers without opening.
//
// Status marks: fix = amber stripe + warning (the drawing is wrong — the one
// real warning), ask = question, ok = check (the AI's read, not an approval),
// none = a plain dash for Ask answers. 56 pt or taller.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, CircleCheck, CircleHelp, CircleMinus, MapPin, TriangleAlert } from 'lucide-react-native';
import type { CodeCardItem } from '@/utils/codeCard/types';
import { stageLabel } from '@/utils/codeCard/verdict';
import { evidenceView } from '@/utils/codeCard/evidence';
import { useCodeCardPalette, type CodeCardPalette } from './palette';
import { EvidenceBars } from './EvidenceMeter';

export interface CodeCardRowProps {
  item: CodeCardItem;
  onPress?: (item: CodeCardItem) => void;
  /** Show the inspection in the row (By status view). Off inside a By inspection group. */
  showStage?: boolean;
  /** Show the edition beside the section (Ask answers). */
  edition?: string | null;
  /** Draw the hairline above (every row but the first in a group). */
  ruled?: boolean;
  sunlight?: boolean;
  testID?: string;
}

/** Who the "ask" row's question is for. */
export function askTarget(item: Pick<CodeCardItem, 'status' | 'question'>): string | null {
  if (item.status !== 'ask') return null;
  return (item.question ?? '').trim() ? 'Ask architect' : 'Ask town';
}

export function CodeCardRow({ item, onPress, showStage = true, edition, ruled, sunlight, testID }: CodeCardRowProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const tid = testID ?? `code-row-${item.id}`;
  const status = item.status;
  const Icon = status === 'fix' ? TriangleAlert : status === 'ask' ? CircleHelp : status === 'ok' ? CircleCheck : CircleMinus;
  const iconColor = status === 'fix' ? P.warnLabel : status === 'ok' ? P.success : P.ink2;
  const target = askTarget(item);
  const ev = evidenceView(item.evidence);
  const statusWord = status === 'fix' ? 'Fix' : status === 'ask' ? 'Needs an answer' : status === 'ok' ? 'Looks right on the drawing' : '';

  const content = (
    <>
      {status === 'fix' ? <View style={styles.stripe} /> : null}
      <View style={styles.st}><Icon size={19} color={iconColor} strokeWidth={2.2} /></View>
      <View style={styles.main}>
        <Text style={[styles.v, status === 'ok' && styles.vOk]}>{item.summary}</Text>
        <View style={styles.m}>
          {item.observed ? <Text style={styles.obs}>{item.observed}</Text> : null}
          <Text style={styles.sec}>{item.section}</Text>
          {edition ? <Text style={styles.mText}>{edition}</Text> : null}
          {status ? null : (
            <View style={styles.ev}>
              <EvidenceBars evidence={item.evidence} sunlight={sunlight} />
              <Text style={styles.mText}>{ev.tone === 'government' ? ev.short : 'Recall'}</Text>
            </View>
          )}
          {item.location ? (
            <View style={styles.loc}>
              <MapPin size={12} color={P.accentLabel} strokeWidth={2} />
              <Text style={styles.locText}>{item.location}</Text>
            </View>
          ) : null}
          {target ? <View style={styles.to}><Text style={styles.toText}>{target}</Text></View> : null}
          {showStage && item.stage ? <Text style={styles.insp}>{stageLabel(item.stage)}</Text> : null}
        </View>
      </View>
      {onPress ? <ChevronRight size={16} color={P.ink3} strokeWidth={2} style={styles.chev} /> : <View style={styles.chevGap} />}
    </>
  );

  const a11y = [statusWord, item.summary, item.observed, item.section, item.location, target].filter(Boolean).join('. ');
  if (!onPress) {
    return <View style={[styles.row, ruled && styles.ruled]} accessible accessibilityLabel={a11y} testID={tid}>{content}</View>;
  }
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, ruled && styles.ruled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${a11y}. Open the full card.`}
      testID={tid}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 56, paddingVertical: 11, paddingLeft: 14, paddingRight: 12 },
    ruled: { borderTopWidth: P.rule, borderTopColor: P.line },
    pressed: { backgroundColor: P.soft },
    stripe: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: P.warnLabel },
    st: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    main: { flex: 1 },
    v: { fontSize: 15 + P.bump, lineHeight: 19.5 + P.bump, fontWeight: '500', color: P.ink },
    vOk: { fontWeight: '400', color: P.ink2 },
    m: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 3, marginTop: 4 },
    obs: { fontSize: 12.5 + P.bump / 2, fontWeight: '700', color: P.ink },
    sec: { fontSize: 12.5 + P.bump / 2, fontWeight: '700', color: P.ink },
    mText: { fontSize: 12.5 + P.bump / 2, fontWeight: '500', color: P.ink2 },
    ev: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
    loc: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    locText: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.accentLabel },
    to: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: P.soft },
    toText: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.ink },
    insp: { fontSize: 12.5 + P.bump / 2, fontWeight: '500', color: P.ink3 },
    chev: { marginTop: 3 },
    chevGap: { width: 16 },
  });
