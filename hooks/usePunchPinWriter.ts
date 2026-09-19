// hooks/usePunchPinWriter.ts — the ONE place a pin is written for an EXISTING
// punch item: Pin items (app/punch-pin.tsx) and the edit sheet's Pin on plan /
// Move pin / Remove pin (app/punch-list.tsx).
//
// Every write goes through ProjectContext's actions (updatePunchItemPin and the
// drawing-pin actions), so it lands locally at once and queues for the server —
// offline-safe, exactly like every other punch edit. updatePunchItemPin, NOT
// updatePunchItem: that one sends the whole row from this phone's copy, so a
// pin placed on a stale copy put back the status / sub / description another
// device had changed. The pin write names only plan_sheet_id, pin_x, pin_y. The decisions (what to
// send, what happens to a linked plan-viewer marker, how Undo puts it back)
// are pure, in utils/punchPinQueue, and executed by
// scripts/validate-punch-pin-items.ts. One write per gesture, never a loop.

import { useCallback } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import type { PunchItem } from '@/types';
import type { WalkPin } from '@/utils/punchPlanPin';
import {
  CLEAR_PIN_PATCH,
  drawingPinMoveFor,
  drawingPinRemovalFor,
  drawingPinSnapshotOf,
  drawingPinUndoFor,
  linkedDrawingPinFor,
  pinFieldsOf,
  pinPatchFor,
  undoPatchFor,
  type DrawingPinRemoval,
  type PinWrite,
} from '@/utils/punchPinQueue';

export function usePunchPinWriter(projectId: string) {
  const { updatePunchItemPin, drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin } = useProjects();
  const { role } = useProjectRoleState(projectId || undefined);

  /** Put `item` at `after` (or take its pin off when null). Null when there was nothing to write. */
  const writePin = useCallback((item: PunchItem, after: WalkPin | null): PinWrite | null => {
    const before = pinFieldsOf(item);
    const patch = pinPatchFor(before, after);
    if (Object.keys(patch).length === 0) return null;
    updatePunchItemPin(item.id, patch);
    const write: PinWrite = { itemId: item.id, before, after };
    const dp = linkedDrawingPinFor(item.id, drawingPins);
    if (dp && after) {
      updateDrawingPin(dp.id, drawingPinMoveFor(dp, after));
      write.drawingPin = { op: 'move', id: dp.id, before: drawingPinSnapshotOf(dp) };
    } else if (dp && !after) {
      const r = drawingPinRemovalFor(dp, role);
      if (r.action === 'delete') {
        deleteDrawingPin(dp.id);
        write.drawingPin = { op: 'delete', id: dp.id, before: drawingPinSnapshotOf(dp) };
      } else if (r.action === 'unlink') {
        updateDrawingPin(dp.id, { linkedPunchItemId: undefined, kind: r.keptAs });
        write.drawingPin = { op: 'unlink', id: dp.id, before: drawingPinSnapshotOf(dp) };
      }
    }
    return write;
  }, [updatePunchItemPin, drawingPins, updateDrawingPin, deleteDrawingPin, role]);

  /** Reverse one write: the item's three fields exactly, then its marker. */
  const undoPin = useCallback((w: PinWrite) => {
    updatePunchItemPin(w.itemId, undoPatchFor(w));
    const dpUndo = drawingPinUndoFor(w);
    if (!dpUndo) return;
    if (dpUndo.kind === 'update') updateDrawingPin(dpUndo.id, dpUndo.patch);
    else addDrawingPin(dpUndo.pin);
  }, [updatePunchItemPin, updateDrawingPin, addDrawingPin]);

  /** What Remove pin would do to a linked marker — for the confirmation copy. */
  const removalFor = useCallback((item: PunchItem): DrawingPinRemoval =>
    drawingPinRemovalFor(linkedDrawingPinFor(item.id, drawingPins), role), [drawingPins, role]);

  return { writePin, undoPin, removalFor, role, clearPatch: CLEAR_PIN_PATCH };
}
