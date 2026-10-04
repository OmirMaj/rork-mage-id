// components/codeCard/ThresholdTape.tsx — this job's number drawn against the
// trigger, on one tape.
//
// RENDERS ONLY FROM STRUCTURED NUMBERS. The caller passes the item's
// `jobValue` and `trigger`; when canRecheck() says no (either missing, units
// differ, not finite) this returns null. Nothing is parsed from prose.
//
// THE TRIGGER IS ALWAYS LABELLED AS MODEL RECALL. The number comes from the
// model's structured output on every card: a government record that names the
// section verifies the section NUMBER, and MAGE holds no record that supplies
// the 30 in. So this component is never handed the citation's evidence, and
// its source line cannot credit the trigger to a government source.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ruler } from 'lucide-react-native';
import type { CodeJobValue, CodeTrigger, CodeVerdict } from '@/utils/codeCard/types';
import { canRecheck, formatJobNumber } from '@/utils/codeCard/verdict';
import { triggerPhrase } from '@/utils/codeCard/shareText';
import { useCodeCardPalette, type CodeCardPalette } from './palette';

export interface ThresholdTapeProps {
  jobValue: CodeJobValue | undefined;
  trigger: CodeTrigger | undefined;
  verdict: CodeVerdict;
  /** Show the "34 in. from sheet A-2 · trigger is model recall" line. Default true. */
  showSource?: boolean;
  sunlight?: boolean;
  testID?: string;
}

export const TRIGGER_RECALL_TAIL = 'trigger is model recall';

/** Where a value sits on the tape, as a percentage (0 at the left). */
export function tapePercent(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(98, Math.max(2, (value / max) * 100));
}

const DASHES = [0, 1, 2, 3, 4];

export function ThresholdTape({ jobValue, trigger, verdict, showSource = true, sunlight, testID }: ThresholdTapeProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  if (!jobValue || !trigger || !canRecheck({ jobValue, trigger })) return null;

  const max = Math.max(jobValue.value, trigger.value) * 1.4 || 1;
  const jobPct = tapePercent(jobValue.value, max);
  const trigPct = tapePercent(trigger.value, max);
  const under = Math.min(jobPct, trigPct);
  const over = Math.max(0, jobPct - trigPct);
  const jobText = formatJobNumber(jobValue.value, jobValue.unit);
  const trigText = `${verdict === 'limit' ? 'Limit' : 'Applies'} ${triggerPhrase(trigger)}`;
  const trigNote = `${formatJobNumber(trigger.value, trigger.unit)} ${TRIGGER_RECALL_TAIL}`;

  // A label sits on the side of its mark that has room: right of it in the
  // left half, ending at it in the right half. No measuring needed.
  const anchored = (pct: number, child: React.ReactNode) =>
    pct >= 50 ? (
      <View style={styles.labelRow}>
        <View style={[styles.labelEnd, { flex: pct }]}>{child}</View>
        <View style={{ flex: 100 - pct }} />
      </View>
    ) : (
      <View style={styles.labelRow}>
        <View style={{ flex: pct }} />
        <View style={[styles.labelStart, { flex: 100 - pct }]}>{child}</View>
      </View>
    );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Job ${jobText}. ${trigText}. The trigger is model recall.`}
    >
      {anchored(jobPct, (
        <Text style={styles.tag} numberOfLines={1}>
          <Text style={styles.key}>Job </Text>
          <Text style={styles.val}>{jobText}</Text>
        </Text>
      ))}
      <View style={styles.trackWrap}>
        <View style={styles.track} />
        <View style={[styles.fillUnder, { width: `${under}%` }]} />
        {over > 0 ? <View style={[styles.fillOver, { left: `${trigPct}%`, width: `${over}%` }]} /> : null}
        <View style={[styles.trigLine, { left: `${trigPct}%` }]}>
          {DASHES.map((d) => <View key={d} style={styles.dash} />)}
        </View>
        <View style={[styles.mark, { left: `${jobPct}%` }]} />
      </View>
      {anchored(trigPct, (
        <Text style={styles.tag} numberOfLines={1}>
          <Text style={styles.key}>{trigText}</Text>
        </Text>
      ))}
      {showSource ? (
        <View style={styles.src}>
          <Ruler size={12} color={P.ink2} strokeWidth={2} />
          <Text style={styles.srcText}>
            {`${jobText} from ${jobValue.sourceLabel} · ${trigNote}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    labelRow: { flexDirection: 'row' },
    labelEnd: { alignItems: 'flex-end' },
    labelStart: { alignItems: 'flex-start' },
    tag: { fontSize: 13 + P.bump / 2, lineHeight: 16 + P.bump / 2 },
    key: { fontSize: 10.5 + P.bump / 2, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: P.ink3 },
    val: { fontSize: 13 + P.bump / 2, fontWeight: '700', color: P.ink },
    trackWrap: { height: 28, justifyContent: 'center', marginVertical: 2 },
    track: { position: 'absolute', left: 0, right: 0, height: 10, borderRadius: 5, backgroundColor: P.surfaceAlt },
    fillUnder: { position: 'absolute', left: 0, height: 10, borderRadius: 5, backgroundColor: P.accent, opacity: 0.3 },
    fillOver: { position: 'absolute', height: 10, backgroundColor: P.accent },
    trigLine: { position: 'absolute', top: 0, bottom: 0, width: 1.5, marginLeft: -0.75, justifyContent: 'space-between' },
    dash: { width: 1.5, height: 3, backgroundColor: P.ink },
    mark: { position: 'absolute', width: 2.5, height: 20, marginLeft: -1.25, borderRadius: 1.25, backgroundColor: P.ink },
    src: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    srcText: { flex: 1, fontSize: 12 + P.bump / 2, lineHeight: 16 + P.bump / 2, fontWeight: '500', color: P.ink2 },
  });
