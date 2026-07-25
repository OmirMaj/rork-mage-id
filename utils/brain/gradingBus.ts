// utils/brain/gradingBus.ts
//
// Lightweight one-listener event bus for triggering grading from non-hook code
// (ProjectContext CO-approval, close-project flow) without creating a circular
// hook dependency.
//
// Usage:
//   // In useBrainGrading: register the gradeNow handler
//   registerGradingHandler(gradeNow);
//   // In ProjectContext CO-approval block:
//   fireGradingEvent(projectId);
//
// No React imports. Pure module singleton.

type GradeHandler = (projectId?: string) => void;

let handler: GradeHandler | null = null;

/** Called by useBrainGrading to register itself as the active grader. */
export function registerGradingHandler(fn: GradeHandler): void {
  handler = fn;
}

/** Called by ProjectContext / close-project to trigger opportunistic grading.
 *  G4: fire-and-forget, never throws. */
export function fireGradingEvent(projectId?: string): void {
  try {
    handler?.(projectId);
  } catch {
    // G4: never propagate
  }
}
