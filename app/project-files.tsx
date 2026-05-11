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
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Sheet } from '@/components/ui';
import { useProjects } from '@/contexts/ProjectContext';
import { ProjectFilesBrowser } from '@/components/ProjectFilesBrowser';

export default function ProjectFilesScreen() {
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
          <Text
            style={styles.primaryBtn}
            onPress={() => router.replace('/(tabs)/(home)' as never)}
          >
            Open Projects
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Sheet title="Files" onClose={() => router.back()} bodyPadding="none">
        <ProjectFilesBrowser projectId={projectId} projectName={project.name} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: Tokens.spacing['2xl'], gap: Tokens.spacing.xs },
  notFoundTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: Colors.text, marginTop: Tokens.spacing.xs },
  notFoundBody: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  primaryBtn: {
    paddingHorizontal: Tokens.spacing.lg,
    paddingVertical: Tokens.spacing.sm,
    marginTop: Tokens.spacing.md,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.primary,
    color: Colors.surface,
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    overflow: 'hidden' as const,
  },
});
