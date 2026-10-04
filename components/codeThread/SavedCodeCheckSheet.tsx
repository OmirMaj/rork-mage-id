/**
 * SavedCodeCheckSheet — one saved code check, FROZEN as it was run: when,
 * from where, what grounded it, what was sent from the job, what he answered,
 * what came back, and the actions taken on each item.
 *
 * It never re-runs anything on open. "Run it again with today’s data" closes
 * the sheet and opens the Code Check screen with the same source; the saved
 * record stays as it was.
 *
 * The live record is read from useCodeChecks by id (falling back to the
 * prop), so an action taken in this sheet shows 'Added' as soon as the store
 * notes it.
 *
 * iOS MODAL RULE: every navigation closes this sheet first (onClose), then
 * pushes after 350 ms on iOS.
 */
import React from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { SheetOverlay, SheetScrim, useSheetFrame } from '@/components/ui/Sheet';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCodeChecks, useCodeCheckSyncState } from '@/hooks/useCodeChecks';
import { CODE_CHECKS_CAPTION } from '@/utils/codeThread/cloudSync';
import { isStandInLine, passesEchoCheck } from '@/utils/codeCard/echoCheck';
import { codeCheckRoute } from '@/utils/codeThread/actions';
import type { CodeCheckRecord, CodeThreadSection, CodeThreadSourceKind } from '@/utils/codeThread/types';
import type { Project } from '@/types';
import { CodeThreadActions, IOS_MODAL_NAV_DELAY_MS, codeCheckDateLabel } from './CodeThreadActions';

export interface SavedCodeCheckSheetProps {
  record: CodeCheckRecord;
  project: Project;
  visible: boolean;
  onClose: () => void;
}

const SOURCE_LABEL: Record<CodeThreadSourceKind, string> = {
  project: 'Run for this job',
  punch: 'Run from a punch item',
  plan_sheet: 'Run from a plan sheet',
  manual: 'Run by hand',
};

export const BUILDING_RECORD_NOT_CHECKED_TEXT = 'The building record was not checked for this check.';

/** Why a saved code row offers no actions (the result screen's own words). */
export const SAVED_ROW_NO_ACTIONS = 'No actions for this line: it has no requirement in words to put in a permit, a punch item or an RFI.';

/**
 * THE WITHHOLD RULE, on a saved check. A check saved before the own-words gate
 * holds the AI's raw line, and one saved since may hold MAGE's stand-in notice
 * for a line it withheld. The line is shown and filed only when it is a
 * requirement in words: it passes the same gate as a code card
 * (utils/codeCard/echoCheck, the card's cap of 400) and is not a stand-in.
 * Otherwise '': the bullet shows the citation alone and the row offers no
 * actions. The stored record is never changed.
 */
export function savedRequirementWords(requirement: string | null | undefined): string {
  const line = requirement ?? '';
  return line.trim() && !isStandInLine(line.trim()) && passesEchoCheck(line, 400) ? line : '';
}

/**
 * The frozen record's four item lists. `items` is the displayed bullet;
 * `actionTexts[i]` is what an action (punch item / RFI / permit) carries. For
 * 'codes' that is the bare requirement, the same as the result sheet: the
 * recalled code + section number stays on the bullet (labelled by the recall
 * note) and never lands unlabelled in a draft RFI to the architect.
 */
export function recordSections(
  rec: CodeCheckRecord,
): { section: CodeThreadSection; title: string; items: string[]; actionTexts: string[] }[] {
  const r = rec.result;
  const codes = r?.applicableCodes ?? [];
  const plain = (section: CodeThreadSection, title: string, list: string[] | undefined) => {
    const items = list ?? [];
    return { section, title, items, actionTexts: items };
  };
  return [
    {
      section: 'codes',
      title: 'Applicable codes',
      items: codes.map((c) => {
        const words = savedRequirementWords(c.requirement);
        return [c.code, c.section].filter(Boolean).join(' ') + (words ? `: ${words}` : '');
      }),
      actionTexts: codes.map((c) => c.requirement ?? '').map(savedRequirementWords),
    },
    plain('permits', 'Permits', r?.permitsRequired),
    plain('inspections', 'Inspections', r?.inspections),
    plain('violations', 'Common violations', r?.commonViolations),
  ];
}

export function SavedCodeCheckSheet({ record: recordProp, project, visible, onClose }: SavedCodeCheckSheetProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useSheetFrame('panel', { visible, animationType: 'slide' });
  const { checks } = useCodeChecks(recordProp.projectId);
  const syncState = useCodeCheckSyncState(recordProp.projectId);
  const record = checks.find((c) => c.id === recordProp.id) ?? recordProp;
  const g = record.grounding;

  const runAgain = () => {
    onClose();
    const href = codeCheckRoute({ projectId: record.projectId, source: record.source?.kind, sourceId: record.source?.id });
    setTimeout(() => router.push(href), Platform.OS === 'ios' ? IOS_MODAL_NAV_DELAY_MS : 0);
  };

  const sourceLabel = record.source?.label?.trim() || SOURCE_LABEL[record.source?.kind ?? 'manual'] || 'Run by hand';
  const sent = g?.jobDataSent ?? [];
  // The headline as frozen; with none, say 'not checked' only when it wasn't.
  const recordLine = g?.buildingRecordHeadline?.trim()
    ? g.buildingRecordHeadline
    : !g || g.buildingRecordKind === 'not_checked'
      ? BUILDING_RECORD_NOT_CHECKED_TEXT
      : null;

  return (
    <Modal visible={visible} animationType={f.animationType} transparent={f.transparent ?? false} onRequestClose={onClose}>
      <SheetOverlay frame={f}>
        <SheetScrim frame={f} onPress={onClose} />
        <View testID="codethread-saved-sheet" style={[styles.root, { paddingTop: insets.top }, f.card]}>
          <View style={styles.headerBar}>
            <TouchableOpacity style={styles.backBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <ChevronLeft size={22} color={colors.text} strokeWidth={2} />
            </TouchableOpacity>
            <Text style={styles.heading} numberOfLines={1}>{record.categoryLabel || 'Saved code check'}</Text>
            <View style={styles.backBtn} />
          </View>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
            <Text style={styles.meta}>{`${codeCheckDateLabel(record.createdAt)} · ${sourceLabel}`}</Text>
            {g?.chipLabel ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{g.chipLabel}</Text>
              </View>
            ) : null}
            <Text style={styles.body}>
              {`Sent from this project: ${sent.length > 0 ? sent.join(', ') : 'nothing from the project'}`}
            </Text>
            {recordLine ? <Text style={styles.body}>{recordLine}</Text> : null}

            {record.answers?.length ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>What you told it</Text>
                {record.answers.map((a) => (
                  <Text key={a.questionId} style={styles.body}>{`${a.question} ${a.answer}`}</Text>
                ))}
              </View>
            ) : null}

            {record.result?.summary ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Summary</Text>
                <Text style={styles.body}>{record.result.summary}</Text>
              </View>
            ) : null}

            {recordSections(record).map((s) =>
              s.items.length === 0 ? null : (
                <View key={s.section} style={styles.block}>
                  <Text style={styles.blockTitle}>{s.title}</Text>
                  {s.items.map((text, i) => (
                    <View key={`${s.section}-${i}`} style={styles.item}>
                      <Text style={styles.body}>{`• ${text}`}</Text>
                      {/* A code row with no requirement in words has nothing to
                          put in a permit, a punch item or an RFI: it says why. */}
                      {s.section === 'codes' && !s.actionTexts[i] ? (
                        <Text style={styles.fine} testID={`codethread-saved-no-actions-${i}`}>{SAVED_ROW_NO_ACTIONS}</Text>
                      ) : (
                        <CodeThreadActions
                          record={record}
                          project={project}
                          section={s.section}
                          index={i}
                          text={s.actionTexts[i] ?? text}
                          onBeforeNavigate={onClose}
                          key={`${s.section}-${i}-${s.actionTexts[i] ?? ''}`}
                        />
                      )}
                    </View>
                  ))}
                </View>
              ),
            )}

            {record.recallNote ? <Text style={styles.fine}>{record.recallNote}</Text> : null}
            {record.disclaimer ? <Text style={styles.fine}>{record.disclaimer}</Text> : null}
            <Text style={styles.fine}>{CODE_CHECKS_CAPTION[syncState]}</Text>

            <View style={styles.footer}>
              <Button
                label="Run it again with today’s data"
                variant="secondary"
                testID="codethread-run-again"
                onPress={runAgain}
              />
            </View>
          </ScrollView>
        </View>
      </SheetOverlay>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    heading: { ...Type.serifHeadline, color: t.text, flexShrink: 1 },
    scroll: { padding: 16, gap: 10 },
    meta: { ...Type.footnoteEmphasized, color: t.textSecondary },
    chip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.accentSoft },
    chipText: { ...Type.footnoteEmphasized, color: t.accentLabel },
    block: { gap: 6, marginTop: 6 },
    blockTitle: { ...Type.subheadEmphasized, color: t.text },
    item: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
    body: { ...Type.subhead, color: t.text },
    fine: { ...Type.footnote, color: t.textSecondary },
    footer: { marginTop: 12, alignItems: 'flex-start' },
  });

export default SavedCodeCheckSheet;
