// components/ToolScreenChrome.tsx — shared chrome for the AI tool screens.
//
// Two pieces, both lifted from the plan-intelligence idiom (the app's
// reference AI-tool surface):
//
//   • ToolHeader — the custom in-screen header (back chevron + eyebrow +
//     title) that replaces the default React-Navigation "Back"-pill bar.
//     Screens render <Stack.Screen options={{ headerShown: false }} /> and
//     mount this instead, so every AI door shares one on-brand header.
//   • ToolProjectPicker — the "pick a project" landing used when a tool is
//     opened without a projectId param (Tools hub, search, deep link).
//     Before this existed, ai-punch / compare-drawings / extract-submittals
//     dead-ended on a flat gray "No project selected." (sim-audit #5).
//
// UX-AUDIT-2026-08-03 #3 extended the picker to the seven project-scoped money
// and field screens (invoice, job-costing, daily-report, punch-list, rfi,
// client-portal-setup, closeout-binder) plus schedule-pro, which were still
// telling a user with three live jobs "No project to cost yet". Two cases the
// picker now separates, because they are not the same failure:
//
//   no id at all   → "Pick a project" over the real project list.
//   stale/bad id   → same list, preceded by a notice saying the thing they
//                    asked for is gone. Previously this rendered blank.
//
// And a user with genuinely ZERO projects gets "Create a project" (which opens
// the create sheet directly), never an empty picker.
//
// Pure presentation — selection state lives in the host screen.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, FolderOpen, Plus, AlertTriangle } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import EmptyState from '@/components/EmptyState';
import type { Project } from '@/types';
import { useSafeBack } from '@/hooks/useSafeBack';

// ─── ToolHeader ───────────────────────────────────────────────────────────────

export function ToolHeader({ eyebrow, title, right }: {
  /** Small uppercase context line, e.g. "AI PUNCH · MAGE ID". */
  eyebrow: string;
  /** The screen (or selected project) name. */
  title: string;
  /** Optional right-slot action; a spacer keeps the title centered-left. */
  right?: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // UX-F18: the eight project-scoped tool screens share this chevron; a bare
  // router.back() is dead on a cold-start route, so fall through to home.
  const goBack = useSafeBack();
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={goBack}
        style={styles.headerBtn}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="tool-header-back"
      >
        <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
      </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.headerEyebrow}>{eyebrow}</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      {right ?? <View style={styles.headerBtn} />}
    </View>
  );
}

// ─── ToolProjectPicker ────────────────────────────────────────────────────────

export function ToolProjectPicker({
  toolName, message, projects, onPick, staleProjectId, icon, steps,
}: {
  /** Used in the section title + no-projects empty state. */
  toolName: string;
  /** One sentence: what this tool does and why it needs a project. */
  message: string;
  projects: Project[];
  onPick: (projectId: string) => void;
  /** Set when the screen WAS opened with a projectId that matches no project —
   *  a stale deep link, a shared URL, or a project that has since been deleted.
   *  That is a different failure from "arrived with no id at all": the user
   *  asked for something specific and it is gone, so say so instead of silently
   *  showing a picker (or, as before, a blank screen). */
  staleProjectId?: string;
  /** The host screen's own icon, so the picker keeps that tool's identity in
   *  the zero-projects empty state. Defaults to a folder. */
  icon?: React.ReactNode;
  /** Optional "do this, then this" steps for the zero-projects empty state. */
  steps?: string[];
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  // A user with genuinely zero projects cannot pick one, so the honest next
  // action is to create one — /?openCreate=1 opens the create-project sheet on
  // Home (consumed by app/(tabs)/(home)/index.tsx), rather than dropping them
  // on an empty Projects list to find the "+" themselves.
  const createProject = () =>
    router.push({ pathname: '/' as never, params: { openCreate: '1' } as never });

  if (projects.length === 0) {
    return (
      <View style={styles.pickerEmptyWrap}>
        <EmptyState
          icon={icon ?? <FolderOpen size={36} color={t.accent} strokeWidth={1.6} />}
          title="No projects yet"
          message={
            staleProjectId
              ? `That project no longer exists, and there are no others to open. ${message}`
              : `${message} Create a project first so ${toolName} has somewhere to land.`
          }
          steps={steps}
          actionLabel="Create a project"
          onAction={createProject}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pickerContent} showsVerticalScrollIndicator={false}>
      {staleProjectId ? (
        <View style={styles.staleNotice} testID="tool-picker-stale-notice">
          <AlertTriangle size={16} color={t.warningLabel} strokeWidth={1.9} />
          <Text style={styles.staleNoticeText}>
            That link points at a project that no longer exists. Pick one below to
            open {toolName}.
          </Text>
        </View>
      ) : null}
      <Text style={styles.pickerLead}>{message}</Text>
      <Text style={styles.sectionTitle}>Pick a project</Text>
      {projects.map(p => (
        <TouchableOpacity
          key={p.id}
          style={styles.pickRow}
          onPress={() => onPick(p.id)}
          activeOpacity={0.8}
          testID={`tool-pick-project-${p.id}`}
        >
          <Text style={styles.pickRowTitle} numberOfLines={1}>{p.name}</Text>
          <Plus size={16} color={t.accent} strokeWidth={1.75} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.pickCreateRow}
        onPress={createProject}
        activeOpacity={0.8}
        testID="tool-pick-create-project"
      >
        <Plus size={16} color={t.accent} strokeWidth={1.9} />
        <Text style={styles.pickCreateText}>New project</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles (plan-intelligence idiom) ────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  pickerEmptyWrap: { flex: 1, padding: 16 },
  pickerContent: { padding: 16, paddingBottom: 48 },
  pickerLead: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 16 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },
  pickRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 8,
  },
  pickRowTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  pickCreateRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 12, marginTop: 4,
  },
  pickCreateText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.accent },
  staleNotice: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10,
    backgroundColor: t.warningSoft, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.warningSoft, padding: 12, marginBottom: 14,
  },
  staleNoticeText: {
    flex: 1, fontSize: Type.footnote.fontSize, color: t.warningLabel, lineHeight: 18,
  },
});
