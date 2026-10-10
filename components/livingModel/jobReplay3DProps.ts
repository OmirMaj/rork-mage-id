// components/livingModel/jobReplay3DProps.ts — what the 3D view is handed, on
// the web (JobReplay3D.web.tsx) and on the phone (JobReplay3D.tsx). onFlat,
// onHold and quality are the phone's own; the web view does not read them.
import type { ModelLook } from '@/utils/livingModel/looks';
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
  /** A narrow screen: the corner card shows the week alone and each room label its name alone. */
  compact: boolean;
  /**
   * The phone only. The view is drawing the flat replay itself, with its own one line (the build has no 3D engine, or
   * the engine would not start), or has gone back to 3D. The screen then leaves out what belongs to a 3D picture.
   */
  onFlat?: (flat: boolean) => void;
  /** The phone only. A finger is on the model (true) or the last one lifted (false): the page behind must not scroll meanwhile. */
  onHold?: (held: boolean) => void;
  /** The phone only. What the 3D view may cost the phone (utils/livingModel/phoneViewCore.PHONE_3D_QUALITY). Standard when left out. */
  quality?: 'standard' | 'high';
  /** Which of the two looks the model is drawn in (utils/livingModel/looks.ts). Game Style, the default, when left out. */
  look?: ModelLook;
}
