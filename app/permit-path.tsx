// app/permit-path.tsx — Permit Path, the job's permit route map (lane PPUI, M7).
//
// "What permits do I need" drawn as one line of eight stations — scope, checks,
// drawings, filing, plan review, permit issued, work and inspections, sign-off
// — each saying what is needed, who does it, how long it takes and where that
// fact came from. A short interview redraws the line live; anything MAGE does
// not know for this building department says "Not known yet · Ask" and opens
// the questions to put to that department (PPASK). "Ready to file?" counts what
// is in hand.
//
// Phone: one scroll; a station opens as a sheet. Desktop web: two panes — the
// spine on the left (420 pt), the station, the interview or the checklist on
// the right. Free on every tier (PLAN F1). Answers and marks are saved on this
// device (F2); department answers sync.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { usePermitPath } from '@/hooks/usePermitPath';
import { Badge, Button, Card, ScreenHeader, SegmentedControl, Sheet } from '@/components/ui';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { NAME_ONLY_BADGE } from '@/utils/permitOffices';
import { RouteSpine } from '@/components/permitPath/RouteSpine';
import { StationDetail } from '@/components/permitPath/StationDetail';
import { InterviewPanel } from '@/components/permitPath/InterviewPanel';
import { ReadinessPanel } from '@/components/permitPath/ReadinessPanel';
import { AskDepartmentSheet } from '@/components/permitPath/AskDepartmentSheet';
import { SaveAnswerSheet } from '@/components/permitPath/SaveAnswerSheet';
import type { StationId } from '@/utils/permitPath/types';

type Pane = 'station' | 'interview' | 'readiness';

export default function PermitPathScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const styles = useThemedStyles(makeStyles);
  const { projects } = useProjects();
  const { projectId: rawId } = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof rawId === 'string' ? rawId : '';
  const project = projects.find((p) => p.id === projectId) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as never));

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader variant="tool" title={t('office.permitPath.screenTitle', 'Permit Path')} onBack={back} />
        <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
          <Card testID="permit-path-empty">
            <Text style={styles.body}>{t('office.permitPath.empty', 'Pick a job to see its permit path.')}</Text>
            {projects.length === 0 ? (
              <Text style={styles.muted}>{t('office.permitPath.noJobs', 'No jobs yet. Create one first.')}</Text>
            ) : (
              <View style={styles.chipWrap}>
                {projects.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => router.setParams({ projectId: p.id })}
                    accessibilityRole="button"
                    style={styles.jobChip}
                    testID={`permit-path-project-${p.id}`}
                  >
                    <Text style={styles.jobChipText} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        </ScrollView>
      </View>
    );
  }
  return <PermitPathBody project={project} onBack={back} />;
}

function PermitPathBody({ project, onBack }: { project: Project; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { t, tn } = useT();
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { isDesktop } = useResponsiveLayout();
  const { permits } = useProjects();
  const pp = usePermitPath(project);
  const route = pp.route;

  const [selected, setSelected] = useState<StationId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pane, setPane] = useState<Pane | null>(null);
  const [interviewOpen, setInterviewOpen] = useState<boolean | null>(null);
  const [askIds, setAskIds] = useState<string[] | null>(null);
  const [saveIds, setSaveIds] = useState<string[] | null>(null);

  const jobPermits = useMemo(() => permits.filter((p) => p.projectId === project.id), [permits, project.id]);
  const missingByStation = useMemo(() => {
    const out: Partial<Record<StationId, number>> = {};
    for (const r of pp.readiness?.rows ?? []) if (r.state === 'missing') out[r.item.station] = (out[r.item.station] ?? 0) + 1;
    return out;
  }, [pp.readiness]);

  if (!route) return null;

  const firstOpen = pp.progress.answered === 0;
  const showInterview = interviewOpen ?? firstOpen;
  const current = route.stations.find((s) => s.state === 'current')?.id ?? route.stations[0]?.id ?? null;
  const shownStationId = selected ?? current;
  const shownStation = route.stations.find((s) => s.id === shownStationId) ?? null;
  const activePane: Pane = pane ?? (firstOpen ? 'interview' : 'station');
  const askAllIds = route.openDeptQuestions.map((q) => q.id);
  const draft = askIds ? pp.askFor(askIds) : null;
  const j = route.jurisdiction;

  const ask = (ids: string[]) => {
    if (!ids.length) return;
    setSheetOpen(false);
    setAskIds(ids);
  };
  const selectStation = (id: StationId) => {
    setSelected(id);
    if (isDesktop) setPane('station');
    else setSheetOpen(true);
  };

  const officeLine = pp.loading && !j.officeTitle
    ? t('office.permitPath.header.looking', 'Looking up the building department…')
    : j.officeTitle
      ? t('office.permitPath.header.office', 'Building department: {office}', { office: j.officeTitle })
      : j.headline ?? t('office.permitPath.header.officeUnknown', 'Building department: not known yet');

  const header = (
    <Card style={styles.block} testID="permit-path-header">
      <View style={styles.headRow}>
        <MapPin size={16} color={c.accent} />
        <Text style={styles.address} numberOfLines={2} testID="permit-path-address">
          {pp.address || t('office.permitPath.header.noAddress', 'No address on this project yet')}
        </Text>
      </View>
      <Text style={styles.office} testID="permit-path-office">{officeLine}</Text>
      {pp.loading && j.officeTitle ? <Text style={styles.muted}>{t('office.permitPath.header.looking', 'Looking up the building department…')}</Text> : null}
      {pp.office ? (
        <View style={styles.badgeRow}>
          <Badge tone={pp.office.verification === 'name-only' ? 'warn' : 'neutral'}>
            {pp.office.verification === 'name-only'
              ? NAME_ONLY_BADGE
              : t('office.permitPath.header.source', 'Contact details from {source}', { source: pp.office.sourceLabel })}
          </Badge>
        </View>
      ) : null}
      {j.officeTitle && j.headline ? <Text style={styles.caution}>{j.headline}</Text> : null}
      {j.cautions.map((line) => <Text key={line} style={styles.caution}>{line}</Text>)}
      {pp.lookupFailed ? (
        <View style={styles.failRow} testID="permit-path-lookup-failed">
          <Text style={styles.caution}>{t('office.permitPath.header.failed', 'Couldn’t look up the building department. Try again.')}</Text>
          <Button label={t('office.permitPath.header.retry', 'Try again')} size="sm" variant="secondary" onPress={pp.retryLookup} testID="permit-path-retry" />
        </View>
      ) : null}
      {route.unknownCount > 0 ? (
        <View style={styles.unknownRow}>
          <Text style={styles.unknown} testID="permit-path-unknown-count">
            {tn('office.permitPath.header.unknown', route.unknownCount, { one: '1 thing not known yet', other: '{count} things not known yet' })}
          </Text>
          {askAllIds.length ? (
            <Button label={t('office.permitPath.header.askAll', 'Ask about all')} size="sm" variant="secondary" onPress={() => ask(askAllIds)} testID="permit-path-ask-all" />
          ) : null}
        </View>
      ) : null}
    </Card>
  );

  const interview = (
    <InterviewPanel
      questions={pp.visibleQuestions}
      answers={pp.answers}
      prefills={pp.prefills}
      progress={pp.progress}
      collapsed={!isDesktop && !showInterview}
      onToggle={() => setInterviewOpen(!showInterview)}
      onAnswer={pp.answer}
      onConfirmPrefill={pp.confirmPrefill}
      explain={pp.explain}
    />
  );

  const spine = (
    <View style={styles.block}>
      <Text style={styles.honesty}>{t('office.permitPath.spine.honesty', 'Every line says where it comes from. Tap a station to see it.')}</Text>
      <RouteSpine route={route} selected={isDesktop ? shownStationId : selected} onSelect={selectStation} missingByStation={missingByStation} />
    </View>
  );

  const readiness = (summary: boolean) => (pp.readiness ? (
    <ReadinessPanel
      rows={pp.readiness.rows}
      tally={pp.readiness.tally}
      permits={jobPermits}
      today={pp.today}
      savedAnswer={pp.savedAnswer}
      onMark={pp.mark}
      onAsk={ask}
      share={pp.shareChecklist}
      summary={summary}
      onOpenFull={() => setPane('readiness')}
    />
  ) : null);

  const detail = shownStation ? (
    <StationDetail station={shownStation} project={project} today={pp.today} savedAnswer={pp.savedAnswer} onAsk={ask} />
  ) : null;

  const footer = (
    <Text style={styles.footer} testID="permit-path-footer">
      {t('office.permitPath.footer', 'MAGE ID organizes what the building department asks for. It doesn’t file, review or approve anything.')}
    </Text>
  );

  const sheets = (
    <>
      {draft ? (
        <AskDepartmentSheet
          visible
          onClose={() => setAskIds(null)}
          draft={draft}
          onSaveAnswer={() => { setSaveIds(draft.questionIds); setAskIds(null); }}
          onAskNext={draft.remaining > 0 ? () => setAskIds(draft.remainingIds) : undefined}
          testID="permit-path-ask"
        />
      ) : null}
      <SaveAnswerSheet
        visible={!!saveIds}
        onClose={() => setSaveIds(null)}
        jurisdiction={{ key: j.key, name: j.officeTitle ?? j.name }}
        questions={saveIds ? pp.questionsFor(saveIds) : []}
        projectId={project.id}
        onSaved={() => setSaveIds(null)}
        testID="permit-path-save"
      />
    </>
  );

  const screenHeader = (
    <ScreenHeader
      variant="tool"
      title={t('office.permitPath.screenTitle', 'Permit Path')}
      subtitle={t('office.permitPath.subtitle', 'What the work needs, who does it and where each fact comes from.')}
      onBack={onBack}
    />
  );

  if (isDesktop) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]} testID="permit-path-screen">
        <Stack.Screen options={{ headerShown: false }} />
        {screenHeader}
        <View style={styles.panes}>
          <ScrollView style={styles.paneLeft} contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
            {header}
            {spine}
            {readiness(true)}
            {footer}
          </ScrollView>
          <ScrollView style={styles.paneRight} contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
            <SegmentedControl<Pane>
              options={[
                { value: 'station', label: t('office.permitPath.pane.station', 'Station'), testID: 'permit-path-pane-station' },
                { value: 'interview', label: t('office.permitPath.pane.interview', 'Questions'), testID: 'permit-path-pane-interview' },
                { value: 'readiness', label: t('office.permitPath.pane.readiness', 'Checklist'), testID: 'permit-path-pane-readiness' },
              ]}
              value={activePane}
              onChange={setPane}
              style={styles.block}
              testID="permit-path-panes"
            />
            {activePane === 'station' ? <Card style={styles.block}>{detail}</Card> : null}
            {activePane === 'interview' ? interview : null}
            {activePane === 'readiness' ? readiness(false) : null}
          </ScrollView>
        </View>
        {sheets}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="permit-path-screen">
      <Stack.Screen options={{ headerShown: false }} />
      {screenHeader}
      <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
        {header}
        {interview}
        {spine}
        {readiness(false)}
        {footer}
      </ScrollView>
      <Sheet
        visible={sheetOpen && !!shownStation}
        onClose={() => setSheetOpen(false)}
        title={shownStation?.title}
        size="wide"
        testID="permit-path-station-sheet"
      >
        {shownStation ? (
          <StationDetail station={shownStation} project={project} today={pp.today} savedAnswer={pp.savedAnswer} onAsk={ask} showTitle={false} />
        ) : null}
      </Sheet>
      {sheets}
    </View>
  );
}

const LEFT_PANE = 420;

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    pad: { padding: 16, gap: 12 },
    panes: { flex: 1, flexDirection: 'row' },
    paneLeft: { width: LEFT_PANE, flexGrow: 0, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.line },
    paneRight: { flex: 1 },
    block: { marginBottom: 4 },
    body: { ...Type.bodyCompact, color: c.text },
    muted: { ...Type.footnote, color: c.textSecondary, marginTop: 4 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    jobChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, maxWidth: 260 },
    jobChipText: { ...Type.footnoteEmphasized, color: c.text },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    address: { ...Type.serifHeadline, color: c.text, flex: 1 },
    office: { ...Type.bodyCompactEmphasized, color: c.text, marginTop: 8 },
    badgeRow: { flexDirection: 'row', marginTop: 6 },
    caution: { ...Type.footnote, color: c.warningLabel, marginTop: 6 },
    failRow: { gap: 6, marginTop: 4 },
    unknownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    unknown: { ...Type.bodyCompactEmphasized, color: c.warningLabel },
    honesty: { ...Type.footnote, color: c.textSecondary, marginBottom: 8, marginLeft: 40 },
    footer: { ...Type.footnote, color: c.textMuted, marginTop: 8 },
  });
}
