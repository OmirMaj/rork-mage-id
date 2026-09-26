// components/buildingRecord/BuildingRecordCard.tsx — the job's NYC DOB record.
//
// NYC FIRST: for any job outside New York City this renders NOTHING — the hook
// early-outs (no effect, no storage, no network) and the card returns null
// before it draws a single View, so every non-NYC screen is byte-identical.
//
// Honesty rules the text obeys (the words come from summarizeBuildingRecord,
// utils/buildingRecord.ts, and are printed EXACTLY):
//   - never "clean": a dataset that failed reads "not checked", never zero;
//   - a full page reads "at least N";
//   - what MAGE did not check at all is listed under "Not checked:".
// The first lookup is a tap, and the contractor confirms the building before
// any record is fetched — a record for the wrong BIN is worse than none.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { CraneSvg } from '@/components/CraneLoader';
import { useBuildingRecord } from '@/hooks/useBuildingRecord';

export const ZOLA_SEARCH_URL = 'https://zola.planning.nyc.gov/';
const COMPACT_LINES = 3;

function checkedLabel(iso: string | null | undefined): string {
  if (!iso) return 'Checked — date unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Checked — date unknown';
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Checked ${day}, ${time}`;
}

function openUrl(url: string) {
  void Linking.openURL(url).catch(() => {});
}

export function BuildingRecordCard({
  project,
  variant = 'full',
  testID,
}: {
  project: Project | null | undefined;
  variant?: 'full' | 'compact';
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const br = useBuildingRecord(project);
  const [showAll, setShowAll] = useState(false);

  if (!br.supported || br.phase === 'unsupported') return null;

  const tid = testID ?? 'building-record';
  const compact = variant === 'compact';

  let body: React.ReactNode = null;
  switch (br.phase) {
    case 'no_address':
      body = (
        <Text style={styles.muted}>{"Add the job's street address to look up its DOB record."}</Text>
      );
      break;
    case 'idle':
      body = (
        <View style={styles.stack}>
          <Text style={styles.muted}>
            Permits, violations, complaints and zoning from NYC Open Data. You confirm the building first.
          </Text>
          <Button
            label="Look up this building at DOB"
            onPress={br.lookup}
            variant="secondary"
            size="sm"
            testID={`${tid}-lookup`}
          />
        </View>
      );
      break;
    case 'resolving':
    case 'loading':
      body = (
        <View style={styles.row} testID={`${tid}-loading`}>
          <CraneSvg size={28} />
          <Text style={styles.muted}>
            {br.phase === 'resolving' ? 'Finding the building…' : 'Checking NYC Open Data…'}
          </Text>
        </View>
      );
      break;
    case 'confirm':
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline}>Is this the building?</Text>
          {br.candidates.map((c) => (
            <TouchableOpacity
              key={`${c.bin}-${c.bbl}`}
              style={styles.candidate}
              onPress={() => br.confirm(c)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${c.label}, ${c.borough}, BIN ${c.bin}`}
              testID={`${tid}-candidate-${c.bin}`}
            >
              <Text style={styles.candidateText}>{`${c.label} · ${c.borough} · BIN ${c.bin}`}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => openUrl(ZOLA_SEARCH_URL)}
            accessibilityRole="link"
            accessibilityLabel="None of these — search ZoLa"
            testID={`${tid}-none`}
          >
            <Text style={styles.link}>None of these</Text>
          </TouchableOpacity>
        </View>
      );
      break;
    case 'ready': {
      const lines = br.summary.lines;
      const visible = compact && !showAll ? lines.slice(0, COMPACT_LINES) : lines;
      const rec = br.record;
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline} testID={`${tid}-headline`}>{br.summary.headline}</Text>
          {visible.map((line, i) => (
            <Text key={`${i}-${line}`} style={styles.line}>{line}</Text>
          ))}
          {compact && !showAll && lines.length > COMPACT_LINES ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel="Show all building record lines"
              testID={`${tid}-show-all`}
            >
              <Text style={styles.link}>Show all</Text>
            </TouchableOpacity>
          ) : null}
          {rec ? (
            <View style={styles.links}>
              <TouchableOpacity style={styles.linkBtn} onPress={() => openUrl(rec.links.bis)} accessibilityRole="link" accessibilityLabel="Open BIS" testID={`${tid}-bis`}>
                <Text style={styles.link}>BIS</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => openUrl(rec.links.zola)} accessibilityRole="link" accessibilityLabel="Open ZoLa" testID={`${tid}-zola`}>
                <Text style={styles.link}>ZoLa</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => openUrl(rec.links.dobNowPortal)} accessibilityRole="link" accessibilityLabel="Open DOB NOW Public Portal" testID={`${tid}-dobnow`}>
                <Text style={styles.link}>DOB NOW Public Portal</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.footer}>
            <Text style={styles.muted} testID={`${tid}-checked`}>{checkedLabel(rec?.fetchedAt)}</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={br.changeBuilding} accessibilityRole="button" accessibilityLabel="Change building" testID={`${tid}-change`}>
              <Text style={styles.link}>Change building</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
      break;
    }
    case 'error':
      body = (
        <View style={styles.stack}>
          <Text style={styles.line} testID={`${tid}-error`}>{br.error ?? 'Nothing was checked.'}</Text>
          <Button label="Retry" onPress={br.refresh} variant="secondary" size="sm" testID={`${tid}-retry`} />
        </View>
      );
      break;
    default:
      body = null;
  }

  return (
    <Card radius="card" pad={14} style={compact ? styles.wrapCompact : styles.wrap} testID={tid}>
      <View style={styles.eyebrowRow}>
        <EyebrowLabel tone="neutral">NYC DOB record</EyebrowLabel>
        {br.confirmed && br.phase !== 'confirm' ? (
          <Text style={styles.bin} numberOfLines={1}>{`BIN ${br.confirmed.bin}`}</Text>
        ) : null}
      </View>
      {body}
    </Card>
  );
}

export default BuildingRecordCard;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginHorizontal: Tokens.spacing.md, marginTop: Tokens.spacing.md, gap: Tokens.spacing.sm },
    wrapCompact: { marginTop: Tokens.spacing.sm, marginBottom: Tokens.spacing.sm, gap: Tokens.spacing.sm },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm },
    bin: { ...Type.caption1, color: t.textMuted },
    stack: { gap: Tokens.spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    headline: { ...Type.subheadEmphasized, color: t.text },
    line: { ...Type.bodyCompact, color: t.text },
    muted: { ...Type.footnote, color: t.textSecondary },
    candidate: {
      paddingVertical: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
      minHeight: Tokens.touchTarget.min,
      justifyContent: 'center',
    },
    candidateText: { ...Type.bodyCompactEmphasized, color: t.accentLabel },
    links: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.md },
    linkBtn: { paddingVertical: 4 },
    link: { ...Type.footnoteEmphasized, color: t.accentLabel },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm },
  });
