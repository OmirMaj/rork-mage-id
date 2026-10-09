// components/livingModel/jobReplay3DProps.ts — what the 3D view is handed, on
// the web (JobReplay3D.web.tsx) and on the phone (JobReplay3D.tsx, which draws nothing).
import type { RoomMoment } from '@/utils/livingModel/replayCore';
import type { JobModel } from '@/utils/livingModel/types';

export interface JobReplay3DProps {
  model: JobModel;
  level: number;
  moments: Map<string, RoomMoment>;
  selectedId: string | null;
  onSelect: (roomId: string | null) => void;
  /** Called once when the browser cannot start the 3D view, so the screen can draw the flat one. */
  onUnavailable: () => void;
  /** The week line for the corner card ("Week 3 of 10"). */
  weekLine: string;
  atToday: boolean;
  height: number;
}
