// ownerSharing — what a contractor's OWN relationships may reach the owner.
//
// WHY (Phase 0, founder decision 5, 2026-09-23). The closeout block of the
// client portal, the Home Passport and Ask Your Home all handed the owner two
// things that belong to the GC, not to the house:
//
//   • supplier names — where each finish was bought, and every vendor the GC
//     raised a purchase order with. That is the GC's pricing relationship.
//   • a subcontractor's direct contact — name, phone, email. A sub the GC may
//     not want the owner calling direct.
//
// The brand, model and serial of what was installed ARE the owner's and always
// show. The two above reach the owner only when the GC switches them on for
// that job (ClientPortalSettings.shareSupplierNames / shareTradeContacts, set
// from the closeout binder screen). Both are OFF by default, and a portal
// saved before the switches existed has neither key, so it reads OFF too.
//
// One reader, strict `=== true`: a missing key, `undefined`, a string "true"
// from a hand-edited jsonb row — anything but a real boolean true — is off.
// The portal snapshot, the consumer passport inputs and the closeout binder's
// passport generation all ask this function, so the three surfaces cannot
// disagree about one job.
//
// Types only, no runtime imports: consumerPassport and portalSnapshot are both
// bun-runnable and this must not drag anything into either.

import type { ClientPortalSettings } from '@/types';

export interface OwnerSharing {
  /** Supplier names on finishes, and purchase-order vendors as contractors. */
  supplierNames: boolean;
  /** A subcontractor's contact name, phone and email. */
  tradeContacts: boolean;
}

/** Nothing shared — the default for every job, new or old. */
export const OWNER_SHARING_OFF: Readonly<OwnerSharing> = Object.freeze({
  supplierNames: false,
  tradeContacts: false,
});

export function ownerSharingFor(
  portal: Pick<ClientPortalSettings, 'shareSupplierNames' | 'shareTradeContacts'> | null | undefined,
): OwnerSharing {
  return {
    supplierNames: portal?.shareSupplierNames === true,
    tradeContacts: portal?.shareTradeContacts === true,
  };
}

/**
 * May content baked under `bakedWith` be shown under `now`? Only when it
 * carries nothing `now` has switched off. A bake with no record of its
 * settings predates the switches — it was built with everything in — so it is
 * treated as having shared both, and is held back until the GC regenerates it.
 */
export function bakedSharingAllowed(
  bakedWith: Partial<OwnerSharing> | null | undefined,
  now: OwnerSharing,
): boolean {
  const supplier = bakedWith ? bakedWith.supplierNames === true : true;
  const trade = bakedWith ? bakedWith.tradeContacts === true : true;
  return (!supplier || now.supplierNames) && (!trade || now.tradeContacts);
}
