// components/contract/NyContractChecklist.tsx — the New York home improvement
// contract checklist on a draft contract (utils/nyHomeImprovement).
//
// Read-only and never a block: it lists what New York's General Business Law
// § 771 asks a home improvement contract to contain, marks each item found,
// missing or "check it", and always ends with "This is a checklist, not legal
// advice." No writes, no storage, nothing queued, no AI. The item labels and
// details are legal paraphrase: plain English data from NY_HIC_RULES, never
// routed through t(). Only the card's own chrome goes through t().
//
// Phone: a full-width card above the draft action bar; each row stacks the
// icon, the label and detail, and the citation chip on a second line.
// Desktop: the same card in the contract's form column, the citation chip on
// the row's right. The card collapses to its summary line (local state only),
// and starts collapsed once nothing is missing.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react-native';
import type { CompanyBranding, Project, ProjectContract } from '@/types';
import { Card } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useT } from '@/contexts/LanguageContext';
import { t, tn } from '@/i18n';
import { showAlert } from '@/utils/alert';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import {
  checkNyHomeImprovementContract,
  nyHomeImprovementApplies,
  type NyCheckItem,
  type NyCheckStatus,
} from '@/utils/nyHomeImprovement';

export interface NyContractChecklistProps {
  project: Project | undefined;
  contract: ProjectContract;
  branding: CompanyBranding | undefined;
  /** Opens the company profile, offered on a missing profile item. */
  onOpenProfile?: () => void;
  /** Bumped by the sign gate's "Review the list": the card opens and scrolls into view. */
  revealSignal?: number;
  /** The screen's scroll view, so a reveal can bring the card into view. */
  scrollRef?: React.RefObject<ScrollView | null>;
  testID?: string;
}

export function NyContractChecklist({
  project, contract, branding, onOpenProfile, revealSignal = 0, scrollRef, testID = 'contract-ny-checklist',
}: NyContractChecklistProps): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useT();
  const { isDesktop } = useResponsiveLayout();

  const applies = useMemo(() => nyHomeImprovementApplies({
    project: project ?? null,
    branding: branding ?? null,
    contractValueCents: Math.round((contract.contractValue ?? 0) * 100),
  }), [project, branding, contract.contractValue]);
  const result = useMemo(
    () => checkNyHomeImprovementContract({ contract, branding }),
    [contract, branding],
  );

  // null = the default (open while something is missing); a tap pins it.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? result.missing > 0;
  const layoutY = useRef<number | null>(null);
  useEffect(() => {
    if (revealSignal <= 0) return;
    setUserOpen(true);
    const y = layoutY.current;
    if (y != null) scrollRef?.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  }, [revealSignal, scrollRef]);

  if (applies.applies === 'no') return null;

  const maybeLine = applies.applies !== 'maybe' ? null
    : applies.reason === 'no-state'
      ? t('office.nyContract.maybe.noState', 'The jobsite address has no state. If the jobsite is in New York, this list applies.')
      : applies.reason === 'new-home'
        ? t('office.nyContract.maybe.newHome', 'New York’s rule covers work on existing homes. It may not apply to building a new home.')
        : t('office.nyContract.maybe.amount', 'New York’s rule covers contracts over $500 with the same owner. Check whether this project counts.');

  const summary = result.missing === 0
    ? t('office.nyContract.allFound', 'Nothing missing. Check the flagged items with your counsel.')
    : t('office.nyContract.summary', '{missing} missing · {check} to check', { missing: result.missing, check: result.toCheck });

  const statusWord: Record<NyCheckStatus, string> = {
    found: t('office.nyContract.status.found', 'Found'),
    missing: t('office.nyContract.status.missing', 'Missing'),
    check: t('office.nyContract.status.check', 'Found wording, check it'),
  };
  const counsel = t('office.nyContract.counsel', 'To be confirmed by counsel');
  const openProfile = t('office.nyContract.openProfile', 'Open company profile');
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View onLayout={(e) => { layoutY.current = e.nativeEvent.layout.y; }} style={styles.outer}>
      <Card radius="panel" pad={16} style={styles.wrap} testID={testID}>
        <Pressable
          onPress={() => setUserOpen(!open)}
          style={styles.headerRow}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${t('office.nyContract.title', 'New York Contract Checklist')}. ${summary}`}
          testID="contract-ny-toggle"
        >
          <View style={styles.headerText}>
            <Text style={styles.cardHeading} accessibilityRole="header">
              {t('office.nyContract.title', 'New York Contract Checklist')}
            </Text>
            <Text style={result.missing > 0 ? styles.summaryWarn : styles.summary} testID="contract-ny-summary">{summary}</Text>
          </View>
          <Chevron size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>

        {maybeLine ? <Text style={styles.maybe} testID="contract-ny-maybe">{maybeLine}</Text> : null}

        {open ? (
          <View style={styles.list}>
            {result.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                isDesktop={isDesktop}
                statusWord={statusWord[item.status]}
                counsel={counsel}
                openProfile={item.profileField && item.status === 'missing' ? onOpenProfile : undefined}
                openProfileLabel={openProfile}
                styles={styles}
                colors={colors}
              />
            ))}
            <Text style={styles.reminder}>{t('office.nyContract.reminder', 'Give the owner a signed copy before work starts.')}</Text>
          </View>
        ) : null}

        <Text style={styles.disclaimer} testID="contract-ny-disclaimer">
          {t('office.nyContract.disclaimer', 'This is a checklist, not legal advice.')}
        </Text>
      </Card>
    </View>
  );
}

function ItemRow({ item, isDesktop, statusWord, counsel, openProfile, openProfileLabel, styles, colors }: {
  item: NyCheckItem;
  isDesktop: boolean;
  statusWord: string;
  counsel: string;
  openProfile?: () => void;
  openProfileLabel: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const Icon = item.status === 'found' ? CheckCircle2 : item.status === 'missing' ? XCircle : AlertCircle;
  const tint = item.status === 'found' ? colors.success : item.status === 'missing' ? colors.danger : colors.warningLabel;
  const statusStyle = item.status === 'found' ? styles.statusFound : item.status === 'missing' ? styles.statusMissing : styles.statusCheck;
  const chip = (
    <Pressable
      onPress={() => { void Linking.openURL(item.sourceUrl).catch(() => {}); }}
      style={styles.chip}
      hitSlop={10}
      accessibilityRole="link"
      accessibilityLabel={`${item.citation}, opens the statute`}
      testID={`contract-ny-cite-${item.id}`}
    >
      <Text style={styles.chipText}>{item.citation}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row} testID={`contract-ny-item-${item.id}`}>
      <View style={styles.rowMain}>
        <Icon size={18} color={tint} strokeWidth={1.75} />
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>{item.label}</Text>
          <Text style={statusStyle}>{statusWord}</Text>
          <Text style={styles.rowDetail}>{item.detail}</Text>
          {item.counselConfirm ? <Text style={styles.counsel}>{counsel}</Text> : null}
          {openProfile ? (
            <Pressable onPress={openProfile} hitSlop={10} accessibilityRole="button" style={styles.profileLink} testID={`contract-ny-profile-${item.id}`}>
              <Text style={styles.profileLinkText}>{openProfileLabel}</Text>
            </Pressable>
          ) : null}
          {!isDesktop ? <View style={styles.chipLinePhone}>{chip}</View> : null}
        </View>
        {isDesktop ? chip : null}
      </View>
    </View>
  );
}

/**
 * The sign gate's warning, raised by app/contract.tsx when the checklist
 * applies and something is missing. Never a block: "Continue" proceeds to the
 * same gates Sign & send already runs; "Review the list" signs nothing (it is
 * also the cancel, so a web backdrop tap reviews rather than signs).
 */
export function askNyMissingItems(missing: number, actions: { onReview: () => void; onContinue: () => void }): void {
  showAlert(
    t('office.nyContract.alert.title', 'Some New York items are missing.'),
    tn('office.nyContract.alert.body', missing, {
      one: '{count} item on the New York checklist is missing. You can still send it.',
      other: '{count} items on the New York checklist are missing. You can still send it.',
    }),
    [
      { text: t('office.nyContract.alert.review', 'Review the List'), style: 'cancel', onPress: actions.onReview },
      { text: t('office.nyContract.alert.continue', 'Continue'), onPress: actions.onContinue },
    ],
  );
}

export default NyContractChecklist;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  outer: { width: '100%', marginBottom: Tokens.spacing.md },
  wrap: { gap: Tokens.spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, minHeight: 44 },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  cardHeading: { ...Type.subheadEmphasized, color: c.text },
  summary: { ...Type.footnote, color: c.textSecondary },
  summaryWarn: { ...Type.footnoteEmphasized, color: c.warningLabel },
  maybe: { ...Type.footnote, color: c.warningLabel },
  list: { gap: Tokens.spacing.sm },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingTop: Tokens.spacing.sm },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.sm },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { ...Type.subhead, color: c.text },
  statusFound: { ...Type.caption1, color: c.successLabel },
  statusMissing: { ...Type.caption1, color: c.dangerLabel },
  statusCheck: { ...Type.caption1, color: c.warningLabel },
  rowDetail: { ...Type.footnote, color: c.textSecondary },
  counsel: { ...Type.caption1, color: c.textMuted, fontStyle: 'italic' },
  chipLinePhone: { flexDirection: 'row', marginTop: 4 },
  chip: {
    alignSelf: 'flex-start', flexShrink: 0, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Tokens.radius.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, backgroundColor: c.neutralSoft,
  },
  chipText: { ...Type.caption1, color: c.textSecondary },
  profileLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  profileLinkText: { ...Type.footnoteEmphasized, color: c.accentLabel },
  reminder: { ...Type.footnote, color: c.textSecondary, paddingTop: Tokens.spacing.xs },
  disclaimer: { ...Type.footnoteEmphasized, color: c.textMuted },
});
