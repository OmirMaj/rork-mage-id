// utils/codeCard/reset.ts — the code cards' side of the tenant wipe.
//
// WHY THIS EXISTS. Pins, saved cards and the Sunlight preference are kept on
// the device under `mageid_code_*` keys, and wipeLocalUserCache
// (contexts/AuthContext.tsx) sweeps those keys on a sign-out or a tenant
// switch. But each store also holds its state in MODULE MEMORY, which a
// storage sweep cannot reach, and a store writes its WHOLE state on the next
// change. Without this, user B's first pin on a shared phone wrote user A's
// pins straight back under the key the wipe had just removed (the same class
// as clearPlanSheetUrlCache, which sits next to this call).
//
// THE RULE: after this runs, nothing the previous user pinned or saved is in
// memory, and no later write can carry it. It reads nothing and writes
// nothing; removing the keys stays the sweep's job.
//
// Pure of React and RN, and it never CREATES a store: one that was never used
// holds nothing.

import { resetCodePinStore } from './pins';
import { resetCodeSavedStore } from './saved';
import { resetSunlight } from './sunlight';

export function resetCodeCardStores(): void {
  resetCodePinStore();
  resetCodeSavedStore();
  resetSunlight();
}
