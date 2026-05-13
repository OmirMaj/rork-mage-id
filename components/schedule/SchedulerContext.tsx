// components/schedule/SchedulerContext.tsx — Phase 27.
//
// Shared state across all scheduler tabs so they don't have to receive
// 15 props each from the top-level schedule-pro screen. The provider
// wraps SchedulerTabShell; each tab content component pulls via
// useScheduler().

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ScheduleTask, ProjectSchedule } from '@/types';

export type ViewScale = 'days' | 'weeks' | 'months';

export interface CpmResult {
  criticalPathDays: number;
  slipDaysVsBaseline: number;
  criticalTaskIds: ReadonlyArray<string>;
}

export interface SchedulerContextValue {
  schedule: ProjectSchedule;
  tasks: ReadonlyArray<ScheduleTask>;
  cpm: CpmResult;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  viewScale: ViewScale;
  setViewScale: (s: ViewScale) => void;
}

const Ctx = createContext<SchedulerContextValue | null>(null);

export interface SchedulerProviderProps {
  schedule: ProjectSchedule;
  cpm: CpmResult;
  children: ReactNode;
}

export function SchedulerProvider({ schedule, cpm, children }: SchedulerProviderProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState<ViewScale>('weeks');

  const value = useMemo<SchedulerContextValue>(() => ({
    schedule,
    tasks: schedule.tasks ?? [],
    cpm,
    selectedTaskId,
    setSelectedTaskId,
    viewScale,
    setViewScale,
  }), [schedule, cpm, selectedTaskId, viewScale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScheduler(): SchedulerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScheduler must be used inside <SchedulerProvider>');
  return v;
}
