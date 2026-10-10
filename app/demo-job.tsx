// app/demo-job.tsx — the route of the owner's Demo Job builder.
//
// OWNER ONLY, AND ONLY WHILE THE KILL SWITCH IS ON
// (utils/demoJob/allowed.demoJobAllowed). Anyone else is sent home before a
// single hook of the builder mounts. The Settings row has the same gate.
//
// The builder itself is components/demoJob/DemoJobScreen, wired to the app's
// own contexts by hooks/useDemoJobPorts.
import React, { useCallback } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DemoJobScreen } from '@/components/demoJob/DemoJobScreen';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useDemoJobCopy } from '@/hooks/useDemoJobCopy';
import { useDemoJobPorts } from '@/hooks/useDemoJobPorts';
import { useOffline } from '@/hooks/useOnline';
import { todayCalendarDay } from '@/utils/calendarDate';
import { demoJobAllowed } from '@/utils/demoJob/allowed';
import { generateUUID } from '@/utils/generateId';

export default function DemoJobRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user?.id || !demoJobAllowed(user.email)) return <Redirect href="/(tabs)/(home)" />;
  return <DemoJobBuilder userId={user.id} />;
}

function DemoJobBuilder({ userId }: { userId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useDemoJobCopy();
  const ports = useDemoJobPorts();
  const offline = useOffline();
  const { settings, projects, projectsLoaded } = useProjects();
  const startDateOf = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.schedule?.startDate ?? null,
    [projects],
  );
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DemoJobScreen
        ports={ports}
        copy={copy}
        userId={userId}
        contractorName={settings?.branding?.companyName ?? ''}
        today={todayCalendarDay()}
        newProjectId={generateUUID}
        offline={offline}
        ready={projectsLoaded}
        topInset={insets.top}
        onBack={() => router.back()}
        onOpenJob={(projectId) => router.push({ pathname: '/project-detail', params: { id: projectId } })}
        startDateOf={startDateOf}
      />
    </>
  );
}
