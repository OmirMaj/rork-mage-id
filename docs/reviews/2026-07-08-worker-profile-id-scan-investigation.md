# Worker Profile + ID-Scan — Investigation & Design Memo

**Date:** 2026-07-08
**Status:** Design proposal (read-only investigation — no app code changed)
**Scope:** A **Worker Profile** section (individual field-worker records) + an **ID-scan** flow (camera → extract fields → attach to profile).

---

## 1. How it fits — existing "person" concepts

MAGE has **five** distinct people/party concepts today, and **none** of them is an individual employed/field worker. This is a real gap, not a duplication risk.

| Concept | Type / location | Scope | What it models |
|---|---|---|---|
| **Subcontractor** | `types/index.ts:1694` (`Subcontractor`) | Company | A sub *company* — `companyName`, `contactName`, `trade`, license, COI, W-9. One contact name per company, not a roster. Stored via `ProjectContext`/subs; docs go to the private `sub-documents` bucket (`app/(tabs)/subs/index.tsx:654`). |
| **Contact** | `types/index.ts:2577` (`Contact`) | Company/CRM | A business contact (architect, owner's rep, lender, inspector). Address-book entry, `linkedProjectIds`. Not a worker. |
| **Prequal** | `types/index.ts:1885` `PrequalSafetyRecord`, `:1949` `PrequalPacket` | Per-sub | Compliance packet *for a subcontractor company* (EMR, OSHA 300A, insurance, licenses). Docs stored as **paths** (`coiDocPath`, `w9DocPath`, `PrequalLicense.docPath` `:1919`). Filled via magic-link `app/prequal-form.tsx`, no auth. |
| **Crew (schedule)** | `types/index.ts:462` `crew: string`, `:519` `ProjectResource` | Free-text / resource | Schedule swimlanes. `crew` is a **free-text lane label**; `ProjectResource` is a structured resource, but neither is a person record with contact/ID/certs. |
| **Crew (daily report)** | `types/index.ts:588-591` `crewCount?`, `crewHours?` | Counts | DFR captures head*count* and hours — **numbers, not identities**. |
| **`WorkerProfile` (EXISTING)** | `types/index.ts:2995` | Marketplace | ⚠️ **Name collision.** This is a **Hire-marketplace listing** (`bio`, `availability`, `hourlyRate`, `pastProjects`, `contactEmail`) consumed by `contexts/HireContext.tsx` and the `/hire` tab. It is a *jobseeker profile in a public marketplace*, NOT an employee record. **Do not extend or reuse it for this feature — the name is taken.** |

**Finding:** there is no first-class "this individual person works on my jobs" entity. Subs are companies; contacts are the address book; crew is a text label and a headcount; `WorkerProfile` is a marketplace listing. A new entity is warranted.

**Recommendation:** create a **new company-scoped entity, named `CrewMember`** (avoid `WorkerProfile` — collides with `types/index.ts:2995`). It is *not* project-scoped (a worker moves across jobs), mirroring how `PrequalPacket` is per-sub not per-project. It optionally links to a `Subcontractor` (`subId?`) so a sub-company's people can be rostered under it, and to `Contact` only loosely (they serve different purposes).

---

## 2. Certifications tie-in (Safety Wave B)

Safety Wave B (`docs/superpowers/specs/2026-07-08-safety-management-design.md:64`) adds `Certification` → collection `tertiary_certifications`, **person/sub-scoped**, with `holderName: string`, `subId?: string`, `documentUrl?`, status computed from `expiresDate`. Crucially, **`holderName` is free text** — Wave B has *no person entity* to hang certs on. That is exactly the "two competing person stores" hazard the task warns about.

**Recommendation:** `CrewMember` becomes the **person anchor** that `Certification` attaches to. Add `workerId?: string` to `Certification` (additive, back-compat with the free-text `holderName`). Then:

- A crew member's profile is the natural home for **certs + ID + contact + trade**.
- The Safety "Certifications dashboard" (`spec:104`, expiring-soon list) reads certs joined to crew members instead of loose `holderName` strings.
- The **scanned worker ID becomes just another `Certification`-adjacent document** conceptually, but stored on the profile (see §4). ID expiry can reuse the same "expiring within 30 days" computation the cert validator uses (`spec:127` `validate-safety-cert.ts`).

Net: **one person store (`CrewMember`)**, certs and IDs both reference it. Build `CrewMember` *before or with* Wave B so certs land on a real anchor from day one; if Wave A/B ships first, backfill `workerId` from `holderName`.

---

## 3. Vision/scan pattern — mirror `analyze-photos`

A new **`supabase/functions/scan-id/index.ts`** should be a near-copy of `analyze-photos` (`supabase/functions/analyze-photos/index.ts`). The exact pattern to mirror:

1. **CORS + OPTIONS + POST-only + `jsonResponse` helper** (`analyze-photos/index.ts:42-53, 262-264`).
2. **Auth gate first:** `const auth = await requireTier(req, ['pro','business'], 'scan_id'); if (!auth.ok) return jsonResponse(auth.body, auth.status);` (`:271`, `_shared/auth.ts:102`). Rank-based, so business/enterprise pass automatically.
3. **Monthly metering BEFORE the model call:** `const used = await aiUsageIncrement(auth.userId, 'scan_id'); const cap = MONTHLY_CAPS[auth.tier].scan_id; if (used > cap) return 429` (`:284-293`, `_shared/auth.ts:182,253`). Add a `scan_id` row to every tier in `MONTHLY_CAPS` (`_shared/auth.ts:253-290`).
4. **Input:** accept **inline base64** (`photos[].base64`) as the primary path — camera/library picks are `file://` URIs the server cannot fetch (`:57-61, 311-343`). Optionally accept `photoUrls` for already-uploaded images, but then **every URL must pass `validateFetchableUrl`** (`:348-351`, `_shared/urlGuard.ts:82`) — SSRF guard that pins fetches to the project's own Supabase storage host. Enforce the same per-photo / total size caps (`:315-338`).
5. **Model call:** `gemini-2.5-flash`, `responseMimeType: 'application/json'`, `temperature: 0.2`, `maxOutputTokens` (`:387-398`). Single ID image (cap at 1–2 photos, e.g. front/back).
6. **Prompt → strict JSON schema, then server-side shape/validate** exactly like the `receipt` task (`:473-500`): coerce every field to a string/number, never trust the model shape. Return `{ success: true, data: {...} }`.

**`scan-id` extraction schema** (single object, mirrors `ReceiptOut` shaping):
```
{ documentType, fullName, firstName, lastName, idNumber, dateOfBirth,
  issueDate, expiryDate, issuingAuthority, class/endorsements,
  address?, confidence (0-100) }
```
All returned as **suggestions the user confirms** — same principle the safety spec states (`spec:87`): AI never auto-commits; manual entry is always the fallback.

---

## 4. Document/photo storage

**How images/docs are stored today** (`utils/storage.ts`):
- Helpers upload a `Blob` to a named bucket, then return a **7-day signed URL** or a public URL. Buckets in use: `project-photos` (signed, `:4`), `documents` (signed, `:32`), `profiles` (**public**, `:89`), `branding` (`:60`), `rfp-attachments` (**public**, `:119`), and `sub-documents` (private-per-account, `app/(tabs)/subs/index.tsx:654` — path `${subId}/...`, "Visible only to your account").
- Records store the **storage path**, not a long-lived URL (`Subcontractor.w9DocPath`, `PrequalInsurance.coiDocPath` `:1911`, `PrequalLicense.docPath` `:1919`). Signed URLs are minted on demand — the right pattern for sensitive docs.

**Recommendation for the raw ID image:**
- **New dedicated bucket `worker-ids`, private (never public), RLS-scoped to the owning account** — modeled on `sub-documents`, NOT on the public `profiles`/`rfp-attachments` buckets. Path convention `${userId}/${workerId}/id-${Date.now()}.jpg`.
- Store only the **path** on the `CrewMember`/document record (like `w9DocPath`); mint short-lived signed URLs on view. Do **not** persist a 7-day signed URL for a government ID.
- **Extracted fields** live in the `CrewMember` record (Supabase table + `tertiary_crew_members` AsyncStorage mirror), RLS-scoped to the GC account — same posture as every other `tertiary_*` collection.
- **Access control:** RLS on both the storage bucket and the table so only the owning GC account can read. This must be enforced server-side, not just in UI (same lesson as `_shared/auth.ts:1-12` — UI-only gates were the original security hole).

---

## 5. Offline + tier + nav

- **Offline:** the profile/cert **metadata** writes go through `utils/offlineQueue.ts` `supabaseWrite` (optimistic local + queued, flushed by `OfflineSyncManager`) — same as every other domain write. The **image upload itself is a direct storage call** (not queued), matching the existing photo/W-9 upload paths (`utils/storage.ts:4`, `app/(tabs)/subs/index.tsx:654`); if the device is offline the scan simply waits, and the extracted fields can still be saved optimistically with the image path filled in on reconnect.
- **Tier:** add a `FeatureKey` (e.g. `crew_id_scan` / `worker_profiles`) to `hooks/useTierAccess.ts:8` and a `REQUIRED_TIER` entry (`:~78`). To stay consistent with the Safety module (Business+, `spec:97`) and because certs live in Safety, gate **Worker Profiles + ID scan at Business+** on both client (`useTierAccess`) and server (`requireTier(req, ['business','enterprise'], 'scan_id')`). (Open decision — see below.)
- **Nav:** a **"Crew"** entry in `components/DesktopSidebar.tsx` **NETWORK** section, alongside Subs (`:72`), Contacts (`:71`), Hire (`:74`) — the natural neighborhood for people. Alternatively surface it inside the Safety hub next to Certifications (`spec:103`). Keep the bottom tab bar and sidebar in sync (per CLAUDE.md). Register the route in `app/_layout.tsx`; follow the modal-in-screen tile pattern for the profile detail screen.

---

## Proposed design

### (a) Data model — `CrewMember` (collection `tertiary_crew_members`)
Company-scoped (not project-scoped). New type in `types/index.ts`:
```
CrewMember {
  id: string;
  name: string; firstName?: string; lastName?: string;
  trade?: string;                 // reuse SubTrade / trade strings
  phone?: string; email?: string;
  subId?: string;                 // optional link to a Subcontractor company (roster under a sub)
  role?: 'employee' | 'sub_worker' | '1099';   // employment relationship label (NOT verified)
  // ID document (from scan or manual)
  idDocPath?: string;             // path in private `worker-ids` bucket (NOT a signed URL)
  idType?: string;                // 'drivers_license' | 'state_id' | 'passport' | 'other'
  idNumberLast4?: string;         // store MASKED by default; full number only if owner opts in
  idExpiry?: string;
  idExtractedAt?: string; idExtractionConfidence?: number;
  consentAt?: string; consentBy?: string;   // capture-time consent (see §c)
  status: 'active' | 'inactive';
  notes?: string;
  createdAt: string; updatedAt: string; createdBy: string;
}
```
`Certification` (`spec:64`) gains `workerId?: string`; certs attach here. **Do not touch the existing `WorkerProfile` (`types/index.ts:2995`).**

### (b) ID-scan flow end-to-end
1. **Consent screen** at capture: explain what's captured, who sees it, get an explicit tap → stamp `consentAt`/`consentBy`.
2. **Capture** front (and optionally back) via `expo-image-picker`/camera → inline base64.
3. **`scan-id` edge fn** (§3): `requireTier` → meter → Gemini → strict-shaped JSON.
4. **Review & correct** — user sees extracted fields prefilled, edits/confirms (AI is a suggestion, `spec:87`). Low `confidence` → nudge manual review.
5. **Save decision on the raw image** (owner policy, see §c): **default = extract-then-purge** (do not persist the ID image; keep only extracted fields + `idNumberLast4` masked). **Opt-in = store raw** in the private `worker-ids` bucket, path on record, signed-URL-on-demand.
6. Metadata saved via `supabaseWrite`; image (if kept) uploaded direct.

### (c) PII / security / compliance
- **Consent at capture** — explicit, timestamped (`consentAt`), because this is a government ID.
- **Storage** — private `worker-ids` bucket, **RLS-scoped to the owning account**, never public; store paths not durable URLs; **mask the ID number** (`idNumberLast4`) by default, mirroring `Subcontractor.taxIdLast4` (`types/index.ts:1716`).
- **Retention/deletion** — recommend **extract-then-optionally-purge-raw-image**; provide a "delete ID image" action and cascade image deletion when a `CrewMember` is deleted (`deleteStorageFile`, `utils/storage.ts:147`).
- **Who can view** — only the owning GC account; not exposed in any client/sub portal by default.
- **OUT OF SCOPE (flag explicitly):** this feature **captures and attaches** an ID — it does **NOT** perform **I-9 / legal identity or work-authorization verification, E-Verify, or document authenticity checks**. Marketing/UI must not imply legal verification. No SSN capture.

### (d) Tier gating + AI metering
- Client gate via new `useTierAccess` `FeatureKey`; server gate via `requireTier`. Recommend **Business+** (aligns with Safety/certs).
- Meter `scan_id` per-call in `MONTHLY_CAPS` (`_shared/auth.ts:253`) — add a row to every tier; free = 0 (denied before increment). Suggested starting caps: pro 20 / business 60 / enterprise 150 (tune for the Gemini-Flash cost like the existing rows).

### (e) Composition with Safety Wave B
`CrewMember` is the person anchor; `Certification.workerId` points to it. The Safety certs dashboard, expiring-cert notifications (`spec:96`), toolbox-talk/JHA sign-offs (`SafetySignoff`/`SafetyAttendee`, `spec:28,35`), and incident `peopleInvolved` (`spec:45`) can all reference a `CrewMember` instead of free-text names — one roster, many consumers. Build the person store once.

---

## Open design decisions (product owner)

1. **New entity vs. extend** — confirm **new `CrewMember`** (recommended) vs. extending `Subcontractor`/`Contact`. (Extending is wrong: subs are companies, contacts are the address book; and the `WorkerProfile` name is already taken by the Hire marketplace.)
2. **Store raw ID image vs. extract-only** — default **extract-then-purge**, or offer **opt-in raw storage** in the restricted bucket? Sets the retention policy.
3. **Which tier** — Business+ (recommended, aligns with Safety/certs) vs. Pro+ vs. all-tiers-with-a-scan-cap.
4. **Self-onboarding** — do workers/subs submit their own profile + ID via the sub portal (magic-link, like `prequal-form`), or is this **GC-captured only** in v1? (Self-onboarding widens the PII/consent surface.)
5. **Consent & retention policy wording** — who signs consent (worker vs. GC-attests), retention window, deletion SLA. Needs a real policy string before ship.
6. **Mask vs. full ID number** — default masked last-4 (recommended) vs. owner opt-in to full number.
7. **Sequencing vs. Safety Wave B** — ship `CrewMember` first as the cert anchor, or ship together? Affects whether `Certification.holderName` needs a backfill to `workerId`.
8. **Nav placement** — NETWORK-section "Crew" (recommended) vs. inside the Safety hub next to Certifications.

---

## Top 3 findings
1. **No individual-worker entity exists.** Subs are *companies* (`types/index.ts:1694`), Contacts are the address book (`:2577`), and schedule/DFR "crew" is a free-text label + a headcount (`:462, :588`). The gap is real.
2. **`WorkerProfile` is already taken** — `types/index.ts:2995` is a public **Hire-marketplace listing** (`HireContext`), not an employee record. The new entity must be named differently (recommend `CrewMember`).
3. **Safety Wave B certs have no person anchor** — `Certification.holderName` is free text (`spec:64`). A worker profile should be that anchor (add `Certification.workerId?`) to avoid two competing person stores; and the vision + storage + metering primitives to build the scan already exist (`analyze-photos`, `requireTier`/`MONTHLY_CAPS`, `urlGuard`, `utils/storage.ts` private `sub-documents` bucket).

## Recommended design (5 sentences)
Add a new company-scoped `CrewMember` entity (collection `tertiary_crew_members`, `AsyncStorage` + RLS table, written through `supabaseWrite`), leaving the existing marketplace `WorkerProfile` untouched, and make it the single person anchor that Safety Wave B certifications attach to via a new `Certification.workerId`. Build a `scan-id` edge function as a near-clone of `analyze-photos` — `requireTier(['business','enterprise'],'scan_id')`, `aiUsageIncrement`/`MONTHLY_CAPS` metering, `urlGuard` SSRF, inline-base64 input, `gemini-2.5-flash` with strict server-side JSON shaping — returning extracted ID fields as user-confirmed suggestions. The flow is: consent → capture → `scan-id` → review/correct → save, with the raw image handled by a **default extract-then-purge** policy (mask the ID number to last-4) and an owner opt-in to retain the image in a new **private, RLS-scoped `worker-ids` bucket** storing only the path, never a durable URL. Gate the feature at Business+ on both client (`useTierAccess`) and server, and place a "Crew" entry in the DesktopSidebar NETWORK section (or inside the Safety hub). Explicitly scope **I-9 / legal identity & work-authorization verification OUT** — MAGE captures and attaches an ID, it does not legally verify identity.
