# Worker Profile + ID Scan — Design Spec

**Goal:** A verified, portable construction-worker identity — ID-verified + cert-verified — that a GC creates for their crew (immediate roster + Safety-compliance value) and a worker can **claim** to make portable, public, and hireable. It is the person-anchor for Safety certifications and is built so verified workers *can* feed the Hire marketplace later (which stays gated off for now).

**Naming note:** the entity is **`CrewMember`**, NOT `WorkerProfile` — `WorkerProfile` already exists in `types/index.ts:2995` as the Hire-marketplace jobseeker listing (`bio`/`availability`/`hourlyRate`, consumed by `contexts/HireContext.tsx`). We do not touch that type; a claimed `CrewMember` can later *surface as* a marketplace `WorkerProfile`, but they are distinct records.

**Architecture:** New company-scoped `CrewMember` entity in a dedicated `CrewContext` (`createContextHook`, mounted under `ProjectProvider`), offline-first via `supabaseWrite`, persisted under `tertiary_crew_members`. ID/cert extraction runs in one new Deno edge function `scan-credential` (a near-clone of `analyze-photos`: `requireTier` + `MONTHLY_CAPS` metering + `urlGuard` SSRF + Gemini-Flash strict-JSON). Sensitive image handling follows the private, path-not-URL `sub-documents` bucket precedent. Business-tier gated. OTA-safe (no native deps; camera/photo via existing `expo-image-picker`).

---

## Scope (v1)

CrewMember CRUD + roster; ID scan (extract-then-purge default) → verified badge; cert attachment (anchor for Safety Wave B certs); project assignment; the GC→worker **claim** flow (invite magic-link); Hire-marketplace surfacing built but **gated off**.

---

## Data model (new types in `types/index.ts`)

### `CrewMember` — collection `tertiary_crew_members` (company-scoped, RLS)
- `id`, `companyUserId` (owning GC), `createdAt`, `updatedAt`
- **Identity:** `fullName: string`, `trades: string[]`, `phone?: string`, `email?: string`, `photoUrl?: string`, `status: 'active' | 'inactive'`
- **ID verification:** `idVerified: boolean`, `idType?: 'drivers_license' | 'state_id' | 'passport' | 'other'`, `idMaskedLast4?: string`, `idExpiry?: string`, `idIssuer?: string`, `idScannedAt?: string`, `idImagePath?: string` (present ONLY if the GC opted to retain the raw image — default `undefined` after purge)
- **Claim (hybrid ownership):** `claimToken?: string`, `claimedByUserId?: string`, `claimedAt?: string`, `isPublic: boolean` (worker-controlled; default `false`), `marketplaceProfileId?: string` (link to a Hire `WorkerProfile` when surfaced)
- **Assignment:** `projectIds: string[]`

### `Certification.workerId?` (added in Safety Wave B, referenced here)
Safety Wave B ships **after** this feature, so its `Certification` type will include `workerId?: string` (→ `CrewMember.id`) from the start — no free-text `holderName` backfill. This spec owns the anchor contract; Wave B owns the `Certification` record.

---

## `scan-credential` edge function (new — Deno, mirrors `analyze-photos`)

One function serves both ID and cert extraction (DRY):
- **Input:** `{ kind: 'government_id' | 'certification', imageBase64?: string, imageUrl?: string }`
- **Gate:** `requireTier(req, ['business'], 'scan_credential')`; if `imageUrl`, `validateFetchableUrl(u)` before any fetch (SSRF).
- **Metering:** `aiUsageIncrement(userId, 'scan_credential')` against a `MONTHLY_CAPS[tier].scan_credential` cap (add the key to all four tiers in `_shared/auth.ts`; e.g. free 0 / pro 20 / business 60 / enterprise 150), 429 on exceed.
- **Model:** `gemini-2.5-flash`, strict server-side JSON shaping. Returns for `government_id`: `{ fullName, idType, idNumberFull, dob, expiry, issuer }`; for `certification`: `{ certType, certNumber, issuer, issuedDate, expiresDate }`.
- **The server returns the extracted fields only** — it never persists the image. Persistence + purge/mask happen client-side per policy below.

---

## ID-scan flow (extract-then-purge default)

1. **Consent gate** — before capture, an explicit checkbox: *"I have this person's consent to scan and store their ID information."* No scan without it.
2. **Capture** — `expo-image-picker` (camera or library).
3. **Scan** — call `scan-credential` with `kind:'government_id'`; client also enforces the daily text/vision cap via `checkAILimit`/`recordAIUsage`.
4. **Review/correct** — user confirms/edits the extracted fields.
5. **Save (default = extract-then-purge):** persist to the CrewMember only `idVerified:true`, `idType`, `idMaskedLast4` (last 4 of `idNumberFull`), `idExpiry`, `idIssuer`, `idScannedAt`; **discard the raw image** (never uploaded).
6. **Opt-in retain (owner toggle):** if the GC explicitly opts in, upload the raw image to a new **private, RLS-scoped `worker-ids` bucket** and store only `idImagePath` (path, never a durable signed URL — mirror `utils/storage.ts` `sub-documents`).

Cert scanning reuses the same flow with `kind:'certification'` and writes to the Wave B `Certification` record (`workerId` set).

---

## Claim flow (hybrid — GC-created, worker-claimable)

- GC creates the `CrewMember` and (optionally) scans ID/certs → immediate roster + compliance value, **no worker signup required**.
- GC can **invite** the worker: generate `claimToken`, send a magic-link (reuse the existing magic-link infra). Worker opens it → authenticates → `claimedByUserId`/`claimedAt` set; the worker can now edit their own profile and control `isPublic`.
- **Design-for-Hire, gate later:** when `isPublic && claimedByUserId && HIRE_ENABLED`, the claimed CrewMember surfaces as a marketplace `WorkerProfile` (carrying the ID-verified + verified-cert trust badges). `HIRE_ENABLED` stays `false` for now — the surfacing path is written but gated, so flipping the flag lights up verified listings without a rebuild.

---

## PII / security / compliance (the crux)

- **Consent** captured at scan time (step 1).
- **Default extract-then-purge**; masked last-4 only; raw image never stored unless the GC opts in.
- **Opt-in raw storage** → private `worker-ids` bucket, RLS-scoped to the owning GC, path-only reference, no durable URL.
- **Retention/deletion:** deleting a CrewMember purges any retained image; a claimed worker can request deletion of their data. Document a retention window.
- **RLS:** a CrewMember is visible only to the owning GC (and, once claimed, the worker); public marketplace fields are exposed only when `isPublic && claimed && HIRE_ENABLED`.
- **Explicitly OUT of scope:** legal I-9 / work-authorization / identity verification. MAGE *captures and attaches* an ID; it does **not** legally verify identity or eligibility. State this in-product near the scan action.

---

## Tier gating

- GC creation / scanning / roster management: **Business+** (`hooks/useTierAccess.ts` `FeatureKey` `'crew_management'` → `'business'`; server `requireTier(['business'])`).
- A **claimed worker editing their own profile is free** (the worker is not necessarily a paying GC) — the claim/self-edit path is not tier-gated; only GC-side management + scanning is.

---

## Screens

- **`app/crew.tsx`** — roster list (verified badges, expiring-cert flags) → member detail modal (profile, ID-verified badge, certs, assigned projects, **Scan ID**, **Invite to claim**). Modal-in-screen pattern (mirror `app/punch-list.tsx`).
- **ID-scan sub-flow** — consent → capture → review extracted fields → save (with the retain toggle).
- Nav: add a **"Crew"** entry to `DesktopSidebar` NETWORK section (`{ key:'crew', label:'Crew', icon: IdCard, route:'/crew', section:'NETWORK', requires:'crew_management' }`). lucide `IdCard`/`UserCheck`/`ShieldCheck`.

---

## Integration points

- **Safety Wave B certs** — `Certification.workerId` → `CrewMember.id` (single person store).
- **Hire marketplace** — claimed public CrewMembers surface as `WorkerProfile` listings (gated by `HIRE_ENABLED`).
- **Sub portal** — a sub's workers can be CrewMembers; claim via the existing portal magic-link infra.
- **Offline** — all writes via `supabaseWrite`; images via the existing bucket/upload path.

---

## Testing (pure-fn validators, no jest, wired into `ship-check`)

- `scripts/validate-crew.ts` against `utils/crew/*`:
  - ID-number masking → `idMaskedLast4` (last 4, non-digits stripped, short numbers handled),
  - verified-badge derivation (idVerified requires a completed scan/confirm),
  - claim-token generation/validation (format + single-use),
  - cert-expiry status reuse (shared with Wave B),
  - the `isPublic && claimed && HIRE_ENABLED` surfacing guard (returns not-surfaced when the flag is off).

---

## Migration (additive, owner-applied via Supabase MCP — never `db push`)

- Additive table `crew_members` (company/user-scoped, RLS), mirrored into `supabase/schema.sql`; file `supabase/migrations/<timestamp>_crew_members.sql` (after the safety migrations).
- A new private storage bucket `worker-ids` (RLS-scoped) — bucket creation is an owner-run Supabase config step (documented, not auto-applied).
- Apply migration before the OTA that writes the table (PGRST204 gate).

---

## Build order

**Worker Profile ships BEFORE Safety Wave B**, so Wave B's `Certification` includes `workerId` from the start. Revised queue after Safety Wave A: **Worker Profile → Safety Wave B → WIP.**

---

## Out of scope (v1 / future)

- Legal identity / work-authorization verification, background checks.
- Live Hire marketplace launch (surfacing built, `HIRE_ENABLED` stays off).
- Worker self-signup (v1 onboarding is claim-via-invite only).
- Auto-linking CrewMembers to schedule/daily-report crew (kept loose in v1).
