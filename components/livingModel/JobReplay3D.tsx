// components/livingModel/JobReplay3D.tsx — the phone's side of the 3D view.
//
// THE 3D VIEW IS ON THE WEB ONLY IN PHASE 1. Metro picks JobReplay3D.web.tsx
// for the web bundle and THIS file for iOS and Android, so the phone bundle
// never reads the web file and never resolves the 3D library. This file imports
// nothing 3D and draws nothing: the screen shows the flat replay instead.
// scripts/validate-living-model.ts fails if this file, or any file other than
// JobReplay3D.web.tsx, imports the library.
import type { JobReplay3DProps } from './jobReplay3DProps';

export const JOB_REPLAY_3D_ON_THIS_PLATFORM = false;

export function JobReplay3D(_props: JobReplay3DProps): null {
  return null;
}
