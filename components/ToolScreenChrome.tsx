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
// Pure presentation — selection state lives in the host screen.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, FolderOpen, Plus } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import EmptyState from '@/components/EmptyState';
import type { Project } from '@/types';

// ─── ToolHeader ───────────────────────────────────────────────────────────────

export function ToolHeader({ eyebrow, title, right }: {
  /** Small uppercase context line, e.g. "AI PUNCH · MAGE". */
  eyebrow: string;
  /** The screen (or selected project) name. */
  title: string;
  /** Optional right-slot action; a spacer keeps the title centered-left. */
  right?: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
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

export function ToolProjectPicker({ toolName, message, projects, onPick }: {
  /** Used in the section title + no-projects empty state. */
  toolName: string;
  /** One sentence: what this tool does and why it needs a project. */
  message: string;
  projects: Project[];
  onPick: (projectId: string) => void;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  if (projects.length === 0) {
    return (
      <View style={styles.pickerEmptyWrap}>
        <EmptyState
          icon={<FolderOpen size={36} color={t.accent} strokeWidth={1.6} />}
          title="No projects yet"
          message={`${message} Create a project first so the results have somewhere to land.`}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as never)}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pickerContent} showsVerticalScrollIndicator={false}>
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
});
