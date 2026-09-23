// sharingFilter — the owner-sharing switches, enforced at ANSWER time.
//
// WHY (Phase 0, founder decision 5; integration review 2026-09-23). A supplier
// name and a sub's direct phone/email reach the owner only while the GC has
// that job's switch on (ClientPortalSettings.shareSupplierNames /
// shareTradeContacts). The index Ask Your Home searches is written from the
// GC's device, diff-only and never pruned, so it cannot be trusted to reflect
// the switch: a flip on another device, a failed re-index, a commitment set
// back to draft — each leaves a copy indexed while the switch was on. The one
// place that always knows the switch as it stands NOW is the projects row
// this function already reads. So the rule lives here:
//
//   • passport:supplier:* docs are dropped unless shareSupplierNames === true
//   • passport:contact:*  docs are dropped unless shareTradeContacts === true
//   • any other passport doc indexed by an older build that still carries a
//     "Supplier: …" / "Contact: …" / "Phone: …" / "Email: …" fact has that
//     fact cut out under the same switches (the pre-Phase-0 builder wrote them
//     inline into the finish and trade docs).
//
// Strict `=== true`, the same reading as utils/passport/ownerSharing.ts: a
// missing key, a string "true", a null client_portal — all off.
//
// Pure, no imports, no Deno globals: scripts/validate-portal-ask-home-sources.ts
// imports and runs it under bun.

export interface OwnerSwitches {
  supplierNames: boolean;
  tradeContacts: boolean;
}

export function ownerSwitchesFromPortal(clientPortal: unknown): OwnerSwitches {
  const cp = clientPortal && typeof clientPortal === "object"
    ? clientPortal as Record<string, unknown>
    : {};
  return {
    supplierNames: cp.shareSupplierNames === true,
    tradeContacts: cp.shareTradeContacts === true,
  };
}

const SUPPLIER_PREFIX = "passport:supplier:";
const CONTACT_PREFIX = "passport:contact:";

// The pre-Phase-0 builder joined each fact with ". " (a dot and a space), so
// splitting on that and dropping the labelled segments removes exactly those
// facts. An email's own dots are never followed by a space, so it stays whole
// inside its segment and goes with it.
const SUPPLIER_FACT = /^Supplier:/;
const CONTACT_FACT = /^(?:Contact|Phone|Email):/;

function scrub(content: string, sw: OwnerSwitches): string {
  if (sw.supplierNames && sw.tradeContacts) return content;
  return content
    .split(/\.\s+/)
    .filter((seg) => !(!sw.supplierNames && SUPPLIER_FACT.test(seg.trim()))
      && !(!sw.tradeContacts && CONTACT_FACT.test(seg.trim())))
    .join(". ");
}

export function applyOwnerSharing<T extends { doc_id: string; content: string }>(
  matches: T[],
  sw: OwnerSwitches,
): T[] {
  const out: T[] = [];
  for (const m of matches) {
    const id = m.doc_id || "";
    if (id.startsWith(SUPPLIER_PREFIX) && !sw.supplierNames) continue;
    if (id.startsWith(CONTACT_PREFIX) && !sw.tradeContacts) continue;
    out.push({ ...m, content: scrub(m.content ?? "", sw) });
  }
  return out;
}
