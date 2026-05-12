// app/project-files.tsx — per-project shared drive (v1.1 of the
// "Documents 2.0" experience flagged in the launch-prep audit).
//
// This screen replaces the audit-flagged "passive aggregator"
// /documents page for the per-project use case. /documents stays as
// the cross-project rollup; this screen is the project-scoped folder
// tree where uploads + per-project files live.
//
// Reached from project-detail's Documents tile (and from any other
// "open this project's drive" action).

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import { ProjectFilesBrowser } from '@/components/ProjectFilesBrowser';

export default function ProjectFilesScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : null;

  useEffect(() => {
    // Defensive: if someone navigates here without a projectId,
    // bounce them to the projects list rather than render an
    // ambiguous empty state.
    if (!projectId) {
      router.replace('/(tabs)/(home)' as never);
    }
  }, [projectId, router]);

  if (!projectId || !project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <AlertTriangle size={28} color={Colors.warning} />
          <Text style={styles.notFoundTitle}>Project not found</Text>
          <Text style={styles.notFoundBody}>
            This project link may be expired or you may not have access. Open the
            Projects tab to pick another one.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(tabs)/(home)' as never)}
          >
            <Text style={styles.primaryBtnText}>Open Projects</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <ChevronLeft size={22} color={themeColors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Files</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <ProjectFilesBrowser projectId={projectId} projectName={project.name} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  headerBar: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 0.5, borderBottomColor: t.line,
  },
  headerBack: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.surfaceAlt,
  },
  headerTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 32, gap: 8 },
  notFoundTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 8 },
  notFoundBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  primaryBtn: {
    paddingHorizontal: 18, paddingVertical: 12, marginTop: 16,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent,
  },
  primaryBtnText: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.surface },
});
