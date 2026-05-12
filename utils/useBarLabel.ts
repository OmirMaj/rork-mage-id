// utils/useBarLabel.ts — Phase 27.
//
// Returns the right label set for a Gantt bar based on its pixel
// width. Inner labels degrade gracefully as the bar shrinks; full
// info always available on hover (tooltip rendered by InteractiveGantt).
//
// NOT a React hook (no use* state) — named that way for stylistic
// consistency with the rest of the hooks folder.

import type { ScheduleTask } from '@/types';

export type BarLabelMode = 'full' | 'name' | 'id' | 'empty';

export interface BarLabelResult {
  /** What to render inside the bar. */
  mode: BarLabelMode;
  /** Text to show inside (may be empty for 'empty' mode). */
  insideText: string;
  /** Text to show RIGHT OF the bar in muted color (narrow mode only). */
  outsideText: string;
  /** Whether to show the % suffix right-aligned inside. Only true for 'full' mode. */
  showPercent: boolean;
}

const WIDE_THRESHOLD = 110;
const MED_THRESHOLD  = 70;
const NARROW_THRESHOLD = 40;

export function useBarLabel(widthPx: number, task: Pick<ScheduleTask, 'id' | 'title' | 'progress'> & { displayId?: string }): BarLabelResult {
  const id = task.displayId ?? formatTaskId(task.id);
  const name = task.title ?? '';

  if (widthPx >= WIDE_THRESHOLD) {
    return { mode: 'full', insideText: `${id} ${name}`, outsideText: '', showPercent: true };
  }
  if (widthPx >= MED_THRESHOLD) {
    return { mode: 'name', insideText: `${id} ${name}`, outsideText: '', showPercent: false };
  }
  if (widthPx >= NARROW_THRESHOLD) {
    return { mode: 'id', insideText: id, outsideText: name, showPercent: false };
  }
  return { mode: 'empty', insideText: '', outsideText: '', showPercent: false };
}

function formatTaskId(id: string | number): string {
  if (typeof id === 'number') return `T${id}`;
  if (id.startsWith('T') && id.length <= 6) return id;
  return `T${id.slice(0, 4)}`;
}
