// components/buildingRecord/NjBuildingRecordCard.tsx — the job's New Jersey
// state permit record (NJ Construction Permit Data, data.nj.gov w9se-dmra).
//
// Mounted ONLY by BuildingRecordCard's one dispatch line, for a job in New
// Jersey (never NYC). The NJ record renders here and nowhere else.
//
// Honesty rules the text obeys (the words come from summarizeNjBuildingRecord,
// utils/buildingRecord.ts, and are printed EXACTLY):
//   - a lookup that failed reads "not checked", never zero;
//   - a full page reads "at least N";
//   - nothing calls a lot clean or clear: the state lists permits and
//     certificates only, and publishes no violations; the caveat and the
//     "Not checked:" line are always shown;
//   - the 'listed' kind is NEUTRAL here (never success-green).
// The first lookup is a tap, and the contractor confirms the tax lot — even a
// lot that matches the street address — before any record is fetched.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { CraneSvg } from '@/components/CraneLoader';
import { useNjBuildingRecord, NJ_NO_MATCH_TEXT } from '@/hooks/useNjBuildingRecord';
import type { NjParcelCandidate } from '@/utils/buildingRecord';

const COMPACT_LINES = 3;

function checkedLabel(iso: string | null | undefined): string {
  if (!iso) return 'Checked, date unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Checked, date unknown';
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Checked ${day}, ${time}`;
}

function openUrl(url: string) {
  void Linking.openURL(url).catch(() => {});
}

function muniLabel(name: string | null, code: string): string {
  return name ? name.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : `municipality ${code}`;
}

/** "Block 199 Lot 1 · 94 WASHINGTON ST · Hoboken City" (+ how it matched). */
export function njCandidateText(c: NjParcelCandidate): string {
  const lot = `Block ${c.block} Lot ${c.lot}${c.qualifier ? ` Qual ${c.qualifier}` : ''}`;
  const base = `${lot} · ${c.propLoc ?? 'street address not published'} · ${muniLabel(c.muniName, c.muniCode)}`;
  if (c.match === 'nearby') return `${base} (near the address, confirm it's your lot)`;
  if (c.match === 'approximate') return `${base} (from the map pin, confirm)`;
  return base;
}

export function NjBuildingRecordCard({
  project,
  variant = 'full',
}: {
  project: Project | null | undefined;
  variant?: 'full' | 'compact';
}) {
  const styles = useThemedStyles(makeStyles);
  const nj = useNjBuildingRecord(project);
  const [showAll, setShowAll] = useState(false);

  if (!nj.supported || nj.phase === 'unsupported') return null;

  const compact = variant === 'compact';

  let body: React.ReactNode = null;
  switch (nj.phase) {
    case 'no_address':
      body = (
        <View style={styles.stack}>
          <Text style={styles.muted}>{"The state's permit data is kept by tax lot. MAGE needs the project's street address to find it."}</Text>
          <Button
            label="Add a street address to look up this lot"
            onPress={() => {}}
            disabled
            variant="secondary"
            size="sm"
            testID="njrecord-lookup"
          />
        </View>
      );
      break;
    case 'idle':
      body = (
        <View style={styles.stack}>
          <Text style={styles.muted}>
            Permits and certificates from the NJ Construction Permit Data. You confirm the tax lot first.
          </Text>
          <Button label="Look Up This Lot" onPress={nj.lookup} variant="secondary" size="sm" testID="njrecord-lookup" />
        </View>
      );
      break;
    case 'resolving':
    case 'loading':
      body = (
        <View style={styles.row} testID="njrecord-loading">
          <CraneSvg size={28} />
          <Text style={styles.muted}>
            {nj.phase === 'resolving' ? 'Finding the tax lot…' : 'Checking the state permit data…'}
          </Text>
        </View>
      );
      break;
    case 'confirm':
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline}>Which tax lot is the project on?</Text>
          {nj.candidates.map((c, i) => (
            <TouchableOpacity
              key={c.pin ?? `${c.muniCode}-${c.block}-${c.lot}-${c.qualifier ?? ''}`}
              style={styles.candidate}
              onPress={() => nj.confirm(c)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${njCandidateText(c)}`}
              testID={`njrecord-candidate-${i}`}
            >
              <Text style={styles.candidateText}>{njCandidateText(c)}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.muted}>{"None of these? Check the project's street address."}</Text>
        </View>
      );
      break;
    case 'ready': {
      const lines = nj.summary.lines;
      const visible = compact && !showAll ? lines.slice(0, COMPACT_LINES) : lines;
      const rec = nj.record;
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline} testID="njrecord-headline">{nj.summary.headline}</Text>
          {visible.map((line, i) => (
            <Text key={`${i}-${line}`} style={styles.line} testID={`njrecord-line-${i}`}>{line}</Text>
          ))}
          {compact && !showAll && lines.length > COMPACT_LINES ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel="Show All State Permit Record Lines"
              testID="njrecord-show-all"
            >
              <Text style={styles.link}>Show All</Text>
            </TouchableOpacity>
          ) : null}
          {rec ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => openUrl(rec.links.dataset)}
              accessibilityRole="link"
              accessibilityLabel="Open the NJ Construction Permit Data Page"
              testID="njrecord-dataset"
            >
              <Text style={styles.link}>NJ Construction Permit Data</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.footer}>
            <Text style={styles.muted} testID="njrecord-checked">{checkedLabel(rec?.fetchedAt)}</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={nj.changeLot} accessibilityRole="button" accessibilityLabel="Change Tax Lot" testID="njrecord-change">
              <Text style={styles.link}>Change Lot</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
      break;
    }
    case 'error':
      body = (
        <View style={styles.stack}>
          <Text style={styles.line} testID="njrecord-error">{nj.error ?? NJ_NO_MATCH_TEXT}</Text>
          <Button label="Retry" onPress={nj.refresh} variant="secondary" size="sm" testID="njrecord-retry" />
        </View>
      );
      break;
    default:
      body = null;
  }

  return (
    <Card radius="card" pad={14} style={compact ? styles.wrapCompact : styles.wrap} testID="njrecord-card">
      <View style={styles.eyebrowRow}>
        <EyebrowLabel tone="neutral">NJ State Permit Record</EyebrowLabel>
        {nj.confirmed && nj.phase !== 'confirm' ? (
          <Text style={styles.lotTag} numberOfLines={1}>{`Block ${nj.confirmed.block} Lot ${nj.confirmed.lot}`}</Text>
        ) : null}
      </View>
      {body}
    </Card>
  );
}

export default NjBuildingRecordCard;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginHorizontal: Tokens.spacing.md, marginTop: Tokens.spacing.md, gap: Tokens.spacing.sm },
    wrapCompact: { marginTop: Tokens.spacing.sm, marginBottom: Tokens.spacing.sm, gap: Tokens.spacing.sm },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm },
    lotTag: { ...Type.caption1, color: t.textMuted },
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
    linkBtn: { paddingVertical: 4 },
    link: { ...Type.footnoteEmphasized, color: t.accentLabel },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm },
  });
