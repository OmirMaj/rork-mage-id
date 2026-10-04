// components/permitPath/StationDetail.tsx — one station, opened (lane PPUI, M4).
//
// A Sheet on a phone, the right pane on desktop (the screen decides; this is
// the body). The items are grouped "What's needed", "Who does it" and
// "Documents", and EVERY row carries its source chip: ItemRow takes `chip` as a
// required prop and every call site builds it with sourceChipFor(item), so a
// line without a chip cannot be written (validate-permit-path-ui pins this).
//
// The station's confirm line is printed ONCE, at the bottom (PLAN §6.2,
// docs/VOICE.md §7.4): the per-line chip carries "where from", the one line
// carries "check with them".

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ExternalLink, HelpCircle } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button } from '@/components/ui';
import { formatCalendarDayL } from '@/i18n';
import { DepartmentCard } from '@/components/buildingRecord/DepartmentCard';
import { BuildingRecordCard } from '@/components/buildingRecord/BuildingRecordCard';
import InspectionReadyCard from '@/components/inspectionPrep/InspectionReadyCard';
import type { SavedDeptAnswer } from '@/utils/permitPath/deptAnswers';
import type { RouteItem, Station } from '@/utils/permitPath/types';
import { durationSourceLine, sourceChipFor, type SourceChip } from '@/components/permitPath/sourceChip';

export interface StationDetailProps {
  station: Station;
  project: Project | null;
  /** 'YYYY-MM-DD'. */
  today: string;
  savedAnswer?: (id: string) => SavedDeptAnswer | undefined;
  /** Open the ask-the-department sheet for these question ids. */
  onAsk: (questionIds: string[]) => void;
  /** false inside a Sheet that already prints the title. */
  showTitle?: boolean;
  testID?: string;
}

type Group = 'needed' | 'who' | 'documents';

function groupOf(item: RouteItem): Group {
  if (item.kind === 'who') return 'who';
  if (item.kind === 'document') return 'documents';
  return 'needed';
}

const day = (iso: string): string => formatCalendarDayL(iso);

/** One line of the station: its words and, always, where they come from. */
function ItemRow({ item, chip, onAsk, savedAnswer, testID }: { item: RouteItem; chip: SourceChip; onAsk: (ids: string[]) => void; savedAnswer?: (id: string) => SavedDeptAnswer | undefined; testID: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { t } = useT();
  const action = chip.action;
  const press = action
    ? () => {
      if (action.kind === 'link') void Linking.openURL(action.url);
      else onAsk([action.questionId]);
    }
    : undefined;
  // F4 re-ask: a department_said line carries no askQuestionId (the engine
  // nulls it for every certainty but unknown), so the questions come from the
  // saved answer itself.
  const reAskIds = item.answer ? savedAnswer?.(item.answer.id)?.questionIds ?? [] : [];
  const reAsk = reAskIds.length > 0 ? () => onAsk(reAskIds) : item.askQuestionId ? () => onAsk([item.askQuestionId as string]) : undefined;
  return (
    <View style={styles.item} testID={testID}>
      <Text style={styles.itemText}>{item.text}</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={press}
          disabled={!press}
          accessibilityRole={press ? (action?.kind === 'link' ? 'link' : 'button') : 'text'}
          accessibilityLabel={chip.label}
          style={[styles.chip, styles[`tone_${chip.tone}`]]}
          testID={`${testID}-chip`}
        >
          {action?.kind === 'ask' ? <HelpCircle size={12} color={c.warningLabel} /> : null}
          <Text style={[styles.chipText, styles[`toneText_${chip.tone}`]]} numberOfLines={2}>{chip.label}</Text>
          {action?.kind === 'link' ? <ExternalLink size={11} color={c.accentLabel} /> : null}
        </Pressable>
        {chip.staleLabel ? (
          <Pressable
            onPress={reAsk}
            disabled={!reAsk}
            accessibilityRole="button"
            accessibilityLabel={t('office.permitPath.detail.stale', 'Saved over a year ago. Ask again?')}
            style={[styles.chip, styles.tone_unknown]}
            testID={`${testID}-stale`}
          >
            <Text style={[styles.chipText, styles.toneText_unknown]}>{t('office.permitPath.detail.stale', 'Saved over a year ago. Ask again?')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function StationDetail({ station, project, today, savedAnswer, onAsk, showTitle = true, testID = 'permit-path-detail' }: StationDetailProps) {
  const styles = useThemedStyles(makeStyles);
  const { t, tn } = useT();
  const groups: { key: Group; label: string; items: RouteItem[] }[] = [
    { key: 'needed', label: t('office.permitPath.detail.needed', 'What’s needed'), items: station.items.filter((i) => groupOf(i) === 'needed') },
    { key: 'who', label: t('office.permitPath.detail.who', 'Who does it'), items: station.items.filter((i) => groupOf(i) === 'who') },
    { key: 'documents', label: t('office.permitPath.detail.documents', 'Documents'), items: station.items.filter((i) => groupOf(i) === 'documents') },
  ];
  const askIds = station.items.filter((i) => i.certainty === 'unknown' && i.askQuestionId).map((i) => i.askQuestionId as string);
  const chipOpts = { today, formatDay: day, savedAnswer };
  const d = station.duration;

  return (
    <View style={styles.wrap} testID={testID}>
      {showTitle ? <Text style={styles.stationHead}>{station.title}</Text> : null}
      <Text style={styles.muted}>{station.state === 'not_needed' && station.notNeededBecause ? station.notNeededBecause : station.summary}</Text>

      {askIds.length >= 2 ? (
        <Button
          label={tn('office.permitPath.detail.askAll', askIds.length, { one: 'Ask about 1', other: 'Ask about all {count}' })}
          variant="secondary"
          size="sm"
          onPress={() => onAsk(askIds)}
          testID={`${testID}-ask-all`}
          containerStyle={styles.askAll}
        />
      ) : null}

      {station.items.length === 0 ? (
        <Text style={styles.muted}>{t('office.permitPath.detail.empty', 'Nothing listed for this station yet.')}</Text>
      ) : null}

      {groups.filter((g) => g.items.length > 0).map((g) => (
        <View key={g.key} style={styles.group}>
          <Text style={styles.eyebrow}>{g.label}</Text>
          {g.items.map((item) => (
            <ItemRow key={item.id} item={item} chip={sourceChipFor(item, chipOpts)} onAsk={onAsk} savedAnswer={savedAnswer} testID={`${testID}-item-${item.id}`} />
          ))}
        </View>
      ))}

      <View style={styles.group} testID={`${testID}-duration`}>
        <Text style={styles.eyebrow}>{t('office.permitPath.detail.howLong', 'How long')}</Text>
        <Text style={[styles.itemText, d.kind === 'unknown' && styles.unknownText]}>{d.label}</Text>
        {d.detail ? <Text style={styles.muted}>{d.detail}</Text> : null}
        <Text style={styles.muted}>{durationSourceLine(d, day)}</Text>
      </View>

      {project && station.id === 'checks' ? <View style={styles.embed}><BuildingRecordCard project={project} variant="compact" testID={`${testID}-building-record`} /></View> : null}
      {project && station.id === 'filing' ? <View style={styles.embed}><DepartmentCard project={project} testID={`${testID}-department`} /></View> : null}
      {project && station.id === 'work' ? <View style={styles.embed}><InspectionReadyCard project={project} /></View> : null}

      <Text style={styles.confirm} testID={`${testID}-confirm`}>{station.confirmLine}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 10 },
    stationHead: { ...Type.serifHeadline, color: c.text },
    muted: { ...Type.footnote, color: c.textSecondary },
    askAll: { alignSelf: 'flex-start' },
    group: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    eyebrow: { ...Type.footnoteEmphasized, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    item: { gap: 4, paddingVertical: 4 },
    itemText: { ...Type.bodyCompact, color: c.text },
    unknownText: { color: c.warningLabel },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
    chipText: { ...Type.footnote, flexShrink: 1 },
    tone_source: { backgroundColor: c.accentSoft },
    tone_department: { backgroundColor: c.successSoft },
    tone_records: { backgroundColor: c.neutralSoft },
    tone_answer: { backgroundColor: c.neutralSoft },
    tone_ai: { backgroundColor: c.neutralSoft, borderWidth: 1, borderColor: c.line, borderStyle: 'dashed' },
    tone_unknown: { backgroundColor: c.warningSoft },
    toneText_source: { color: c.accentLabel },
    toneText_department: { color: c.successLabel },
    toneText_records: { color: c.text },
    toneText_answer: { color: c.text },
    toneText_ai: { color: c.textSecondary },
    toneText_unknown: { color: c.warningLabel },
    embed: { paddingTop: 6 },
    confirm: { ...Type.footnoteEmphasized, color: c.text, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  });
}

export default StationDetail;
