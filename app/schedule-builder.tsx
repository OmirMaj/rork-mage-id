// app/schedule-builder.tsx — hosts the AI Schedule Builder interview. The AI
// alternative to the template picker: answer a few grounded questions → generate.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ScheduleBuilderInterview from '@/components/schedule/ScheduleBuilderInterview';

export default function ScheduleBuilderScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <ScheduleBuilderInterview projectId={projectId ?? ''} />;
}
