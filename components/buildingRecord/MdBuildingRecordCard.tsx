// components/buildingRecord/MdBuildingRecordCard.tsx — the job's Baltimore
// building record: Baltimore City or Baltimore County open data, whichever
// parcel the contractor confirmed.
//
// Mounted ONLY by BuildingRecordCard's MD dispatch line, for a Maryland job.
//
// Honesty rules the text obeys (the words come from summarizeMdBuildingRecord,
// utils/buildingRecord.ts, and are printed EXACTLY):
//   - a part that failed reads "Couldn't read <source> — not checked", never zero;
//   - every line names its source and its as-of date;
//   - nothing calls a building clean or clear; the "Not checked:" line is always shown;
//   - an address outside both governments says so, and is not an error.
// The first lookup is a tap, and the contractor confirms the parcel (and with it
// City or County) before any record is fetched.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { CraneSvg } from '@/components/CraneLoader';
import { useMdBuildingRecord, MD_NO_MATCH_TEXT } from '@/hooks/useMdBuildingRecord';
import { MD_SIDE_NAME, mdRecordLinks, type MdCandidate } from '@/utils/buildingRecord';
// The license notice each side's data needs where it is shown
// (contentfix-specs/RIGHTS-VERDICT.md): Baltimore County's open-data license
// requires its disclaimer, verbatim; the City's Real Property dataset is
// CC BY 3.0, which requires a license link.
import { mdRecordCredit } from '@/utils/contentCredits';

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

/** "620 E 31st St, Baltimore City · block-lot 4074C 009" (+ how it matched). */
export function mdCandidateText(c: MdCandidate): string {
  return c.match === 'approximate' ? `${c.label} (near the address, check it's your parcel)` : c.label;
}

/** The outside-both line. Not an error and not zero. */
export function mdOutsideText(county: string | null): string {
  return `MAGE reads live building records for Baltimore City and Baltimore County only. ${county ? `This address is in ${county}.` : "MAGE couldn't place this address in either."}`;
}

export function MdBuildingRecordCard({
  project,
  variant = 'full',
}: {
  project: Project | null | undefined;
  variant?: 'full' | 'compact';
}) {
  const styles = useThemedStyles(makeStyles);
  const md = useMdBuildingRecord(project);
  const [showAll, setShowAll] = useState(false);

  if (!md.supported || md.phase === 'unsupported') return null;

  const compact = variant === 'compact';
  const sideName = md.confirmed ? MD_SIDE_NAME[md.confirmed.side] : null;
  const credit = mdRecordCredit(md.confirmed?.side);

  let body: React.ReactNode = null;
  switch (md.phase) {
    case 'no_address':
      body = (
        <View style={styles.stack}>
          <Text style={styles.muted}>{"Baltimore records are kept by parcel. MAGE needs the project's street address to find it."}</Text>
          <Button
            label="Add a street address to look up this parcel"
            onPress={() => {}}
            disabled
            variant="secondary"
            size="sm"
            testID="mdrecord-lookup"
          />
        </View>
      );
      break;
    case 'idle':
      body = md.outside ? (
        <View style={styles.stack}>
          <Text style={styles.line} testID="mdrecord-outside">{mdOutsideText(md.outside.county)}</Text>
          <Button label="Look up again" onPress={md.lookup} variant="secondary" size="sm" testID="mdrecord-lookup" />
        </View>
      ) : (
        <View style={styles.stack}>
          <Text style={styles.muted}>
            Permits, open notices, zoning, historic and flood maps from Baltimore City or Baltimore County open data. You confirm the parcel first.
          </Text>
          <Button label="Look up this parcel" onPress={md.lookup} variant="secondary" size="sm" testID="mdrecord-lookup" />
        </View>
      );
      break;
    case 'resolving':
    case 'loading':
      body = (
        <View style={styles.row} testID="mdrecord-loading">
          <CraneSvg size={28} />
          <Text style={styles.muted}>
            {md.phase === 'resolving' ? 'Finding the parcel…' : 'Checking Baltimore open data…'}
          </Text>
        </View>
      );
      break;
    case 'confirm':
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline}>Which parcel is the project on?</Text>
          {md.candidates.map((c, i) => (
            <TouchableOpacity
              key={`${c.side}-${c.key}`}
              style={styles.candidate}
              onPress={() => md.confirm(c)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${mdCandidateText(c)}`}
              testID={`mdrecord-candidate-${i}`}
            >
              <Text style={styles.candidateText}>{mdCandidateText(c)}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.muted}>{"None of these? Check the project's street address."}</Text>
        </View>
      );
      break;
    case 'ready': {
      const lines = md.summary.lines;
      const visible = compact && !showAll ? lines.slice(0, COMPACT_LINES) : lines;
      const rec = md.record;
      const links = mdRecordLinks(rec);
      body = (
        <View style={styles.stack}>
          <Text style={styles.headline} testID="mdrecord-headline">{md.summary.headline}</Text>
          {visible.map((line, i) => (
            <Text key={`${i}-${line}`} style={styles.line} testID={`mdrecord-line-${i}`}>{line}</Text>
          ))}
          {compact && !showAll && lines.length > COMPACT_LINES ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel="Show all building record lines"
              testID="mdrecord-show-all"
            >
              <Text style={styles.link}>Show all</Text>
            </TouchableOpacity>
          ) : null}
          {links.length ? (
            <View style={styles.links}>
              {links.map((l, i) => (
                <TouchableOpacity
                  key={l.url}
                  style={styles.linkBtn}
                  onPress={() => openUrl(l.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${l.label}`}
                  testID={`mdrecord-link-${i}`}
                >
                  <Text style={styles.link}>{l.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {credit?.kind === 'city_cc_by' ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => openUrl(credit.url)}
              accessibilityRole="link"
              accessibilityLabel={`${credit.text}. Opens the Creative Commons license.`}
              testID="mdrecord-license"
            >
              <Text style={styles.license}>{credit.text}</Text>
            </TouchableOpacity>
          ) : null}
          {credit?.kind === 'county_disclaimer' ? (
            <View style={styles.disclaimer} testID="mdrecord-county-disclaimer">
              <Text style={styles.disclaimerTitle}>{credit.title}</Text>
              <Text style={styles.disclaimerText}>{credit.text}</Text>
            </View>
          ) : null}
          <View style={styles.footer}>
            <Text style={styles.muted} testID="mdrecord-checked">{checkedLabel(rec?.fetchedAt)}</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={md.changeBuilding} accessibilityRole="button" accessibilityLabel="Change building" testID="mdrecord-change">
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
          <Text style={styles.line} testID="mdrecord-error">{md.error ?? MD_NO_MATCH_TEXT}</Text>
          <Button label="Retry" onPress={md.refresh} variant="secondary" size="sm" testID="mdrecord-retry" />
        </View>
      );
      break;
    default:
      body = null;
  }

  return (
    <Card radius="card" pad={14} style={compact ? styles.wrapCompact : styles.wrap} testID="mdrecord-card">
      <View style={styles.eyebrowRow}>
        <EyebrowLabel tone="neutral">Building record</EyebrowLabel>
        {sideName && md.phase !== 'confirm' ? (
          <Text style={styles.sideTag} numberOfLines={1} testID="mdrecord-side">{sideName}</Text>
        ) : null}
      </View>
      {body}
    </Card>
  );
}

export default MdBuildingRecordCard;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginHorizontal: Tokens.spacing.md, marginTop: Tokens.spacing.md, gap: Tokens.spacing.sm },
    wrapCompact: { marginTop: Tokens.spacing.sm, marginBottom: Tokens.spacing.sm, gap: Tokens.spacing.sm },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm },
    sideTag: { ...Type.caption1, color: t.textMuted },
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
    license: { ...Type.caption1, color: t.textSecondary, textDecorationLine: 'underline' },
    disclaimer: { gap: 2 },
    disclaimerTitle: { ...Type.footnoteEmphasized, color: t.textSecondary },
    disclaimerText: { ...Type.caption2, color: t.textSecondary },
  });
