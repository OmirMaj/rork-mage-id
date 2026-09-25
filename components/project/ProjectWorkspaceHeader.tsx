// components/project/ProjectWorkspaceHeader.tsx — the job page's two header rows.
//
// Desktop only (app/project-detail.tsx mounts it inside its `isDesktop ?`
// branch; the stack header is hidden there, so this carries its actions).
//
//   Row A (56)  Projects › job name / address ········ Ask · Share · Edit · Scan · ⋯
//   Row B (40)  [Pre-Con | Construction | Post-Con | Closeout]  confidence  next step
//
// The phone keeps its own hero card, stage chips and bottom buttons; this file
// never renders there. Every blocked action stays visible and says why
// (ToolbarActions shows the disabledReason); Delete and Leave keep the screen's
// own confirm dialogs (handleDelete / handleLeave), so no second confirm here.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowDownRight, CalendarDays, ChevronLeft, FileText, Mic, Pencil, Share2, ScanLine, Trash2, Archive,
} from 'lucide-react-native';
import type { Invoice, Project, PunchItem, RFI } from '@/types';
import { ToolbarActions, type ToolbarAction } from '@/components/desktop/ToolbarActions';
import { NoticeStrip, type Notice } from '@/components/desktop/NoticeStrip';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import BidConfidenceBadge from '@/components/BidConfidenceBadge';
import { chooseNextStep } from '@/components/NextStepHero';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { displayText } from '@/utils/formatters';
import { PROJECT_STAGES, STAGE_LABELS, type ProjectStage } from '@/utils/projectStage';
import { inPlaceTileForStep, noticeToneForStep } from '@/utils/projectWorkspaceLayout';

export const SHARE_NEEDS_ESTIMATE = 'Build an estimate first — Share sends the estimate.';
export const ROLE_ERROR_NOTICE = "Couldn't verify your access to this job's financials.";

export interface ProjectWorkspaceHeaderProps {
  project: Project;
  // Row B
  currentStage: ProjectStage;
  onStageChange: (stage: ProjectStage) => void;
  invoices: Invoice[];
  rfis: RFI[];
  punchItems: PunchItem[];
  /** The role read failed: the KPI strip leaves the money out, this says why. */
  roleError: boolean;
  /** Opens a section of THIS page (a next step that points back at it). */
  onOpenTile: (key: string) => void;
  // Row A actions
  hasAnyEstimate: boolean;
  onShare: () => void;
  onEdit: () => void;
  editBlockedReason: string | null;
  generatingCloseout: boolean;
  onCloseoutPacket: () => void;
  onAIReport: () => void;
  onExportCalendar: () => void;
  canDelete: boolean;
  canLeave: boolean;
  onDelete: () => void;
  onLeave: () => void;
  /** Leave is running (or flushing first): the reason it is blocked. */
  leaveBusyReason: string | null;
}

export function ProjectWorkspaceHeader(props: ProjectWorkspaceHeaderProps) {
  const {
    project, currentStage, onStageChange, invoices, rfis, punchItems, roleError, onOpenTile,
    hasAnyEstimate, onShare, onEdit, editBlockedReason, generatingCloseout, onCloseoutPacket,
    onAIReport, onExportCalendar, canDelete, canLeave, onDelete, onLeave, leaveBusyReason,
  } = props;
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const router = useRouter();
  const pid = project.id;

  const actions = useMemo<ToolbarAction[]>(() => {
    const list: ToolbarAction[] = [
      {
        key: 'ask', label: 'Ask MAGE', icon: Mic, testID: 'project-copilot-hub-btn',
        onPress: () => router.push(routeHref('/copilot-hub', { projectId: pid })),
      },
      {
        key: 'share', label: 'Share', icon: Share2, testID: 'open-share-modal', onPress: onShare,
        disabled: !hasAnyEstimate, disabledReason: hasAnyEstimate ? null : SHARE_NEEDS_ESTIMATE,
      },
      {
        key: 'edit', label: 'Edit', icon: Pencil, testID: 'edit-project-btn', onPress: onEdit,
        disabled: !!editBlockedReason, disabledReason: editBlockedReason,
      },
      {
        key: 'scan', label: 'Scan', icon: ScanLine, testID: 'project-scan-btn',
        onPress: () => router.push(routeHref('/scan', { projectId: pid })),
      },
      {
        key: 'closeout', label: 'Build closeout packet', icon: Archive, overflow: true,
        testID: 'project-closeout-packet-btn', onPress: onCloseoutPacket,
        disabled: generatingCloseout, disabledReason: generatingCloseout ? 'Already building…' : null,
      },
      { key: 'aiReport', label: 'AI project report', icon: FileText, overflow: true, testID: 'project-ai-report-btn', onPress: onAIReport },
      { key: 'calendar', label: 'Export calendar', icon: CalendarDays, overflow: true, testID: 'project-export-calendar-btn', onPress: onExportCalendar },
    ];
    // The screen's own handlers confirm (and name the job); no second dialog.
    if (canDelete) {
      list.push({ key: 'delete', label: 'Delete project', icon: Trash2, destructive: true, testID: 'delete-project-btn', onPress: onDelete });
    } else if (canLeave) {
      list.push({
        key: 'leave', label: 'Leave project', icon: ArrowDownRight, destructive: true, testID: 'leave-project-btn', onPress: onLeave,
        disabled: !!leaveBusyReason, disabledReason: leaveBusyReason,
      });
    }
    return list;
  }, [router, pid, onShare, hasAnyEstimate, onEdit, editBlockedReason, onCloseoutPacket, generatingCloseout, onAIReport, onExportCalendar, canDelete, canLeave, onDelete, onLeave, leaveBusyReason]);

  const stageOptions = useMemo(
    () => PROJECT_STAGES.map((k) => ({ value: k, label: STAGE_LABELS[k].label, testID: `stage-chip-${k}` })),
    [],
  );

  const step = useMemo(
    () => chooseNextStep({ projects: [project], invoices, rfis, punchItems, scopeToProjectId: pid }),
    [project, invoices, rfis, punchItems, pid],
  );
  const notices = useMemo<Notice[]>(() => {
    const out: Notice[] = [];
    if (roleError) {
      out.push({ id: 'role-error', message: ROLE_ERROR_NOTICE, tone: 'warn', priority: 2, testID: 'project-role-error-notice' });
    }
    if (step) {
      const tile = inPlaceTileForStep(step.href, pid);
      out.push({
        id: `next-step-${step.kind}`,
        message: `${step.title} — ${step.body}`,
        tone: noticeToneForStep(step.tone),
        priority: 1,
        action: {
          label: step.cta,
          onPress: () => {
            if (tile) { onOpenTile(tile); return; }
            router.push(step.href);
          },
        },
        testID: 'project-next-step-notice',
      });
    }
    return out;
  }, [roleError, step, pid, onOpenTile, router]);

  return (
    <View style={styles.root} testID="project-workspace-header">
      <View style={styles.rowA}>
        <View style={styles.titleBlock}>
          <RowLink href={routeHref('/(tabs)/(home)')} style={styles.crumb} accessibilityLabel="Back to your projects" testID="project-breadcrumb-projects">
            <ChevronLeft {...Tokens.iconSize.small} color={t.textSecondary} />
            <Text style={styles.crumbText}>Projects</Text>
          </RowLink>
          <View style={styles.nameBlock}>
            <Text style={styles.name} numberOfLines={1} accessibilityRole="header">{project.name}</Text>
            <Text style={styles.address} numberOfLines={1}>{displayText(project.location, 'No location set')}</Text>
          </View>
        </View>
        <ToolbarActions actions={actions} maxVisible={6} style={styles.toolbar} testID="project-toolbar" />
      </View>
      <View style={styles.rowB}>
        <SegmentedControl
          options={stageOptions}
          value={currentStage}
          onChange={onStageChange}
          accessibilityLabel="Project stage"
        />
        <BidConfidenceBadge project={project} variant="light" />
        <NoticeStrip style={styles.notices} notices={notices} testID="project-notices" />
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { gap: Layout.rowGap },
  rowA: { height: 56, flexDirection: 'row', alignItems: 'center', gap: Layout.groupGap },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 0 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 2, height: Layout.control.sm, paddingHorizontal: 6, borderRadius: Tokens.radius.sm },
  crumbText: { ...Type.footnoteEmphasized, color: t.textSecondary },
  nameBlock: { flexShrink: 1, minWidth: 0, maxWidth: Layout.prose },
  name: { ...Type.title2, color: t.text },
  address: { ...Type.caption1, color: t.textMuted },
  toolbar: { flexGrow: 1 },
  rowB: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 12 },
  notices: { flex: 1, minWidth: 0 },
});

export default ProjectWorkspaceHeader;
