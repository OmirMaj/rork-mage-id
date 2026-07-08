# Worker Profile + ID Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Each task is independently committable. Run `npx tsc --noEmit` and the relevant `bun run test:*` after every task, and `bun run ship-check` before the final commit. Do NOT push, do NOT open a PR, do NOT apply the migration, and do NOT create the `worker-ids` bucket — those are owner-gated. Work on branch `claude/feature-buildout`.

## Goal

Ship a verified, portable construction-worker identity — a **`CrewMember`** entity that a GC (General Contractor) creates for their crew (immediate roster + Safety-compliance value) and a worker can later **claim** to make portable/public/hireable. It is the person-anchor for Safety Wave B certifications (`Certification.workerId → CrewMember.id`, built AFTER this) and is designed so verified workers *can* feed the Hire marketplace later (surfacing path written but gated behind `HIRE_ENABLED`).

Scope (v1): CrewMember CRUD + roster; ID scan (extract-then-purge default) → verified badge; project assignment; GC→worker claim flow (magic-link invite); marketplace surfacing built but gated off. Business-tier gated. OTA-safe.

## Architecture

- **New entity `CrewMember`** — company-scoped, distinct from the existing marketplace `WorkerProfile` (`types/index.ts:2995`, consumed by `contexts/HireContext.tsx`). We do NOT touch `WorkerProfile`; a claimed `CrewMember` can *surface as* one via a pure mapper.
- **New `CrewContext`** (`@nkzw/create-context-hook`), mounted inside `<ProjectProvider>` in `app/_layout.tsx`. Offline-first via `supabaseWrite` (`utils/offlineQueue.ts`), persisted under AsyncStorage key `tertiary_crew_members`, userId-gated load.
- **Pure crew logic** in `utils/crew/*` (react-native-free) — ID masking, verified-badge derivation, claim-token gen/validation, cert-expiry status (shared with Wave B), marketplace surfacing guard + mapper. Fully unit-tested by `scripts/validate-crew.ts`, wired into `ship-check`.
- **One new Deno edge function `scan-credential`** — a near-clone of `supabase/functions/analyze-photos/index.ts`: `requireTier(['business'])` + `MONTHLY_CAPS[tier].scan_credential` metering + `urlGuard` SSRF + `gemini-2.5-flash` strict-JSON. Serves both `government_id` and `certification` extraction. It returns extracted fields only; it NEVER persists the image.
- **Sensitive-image handling** mirrors the private `sub-documents` precedent (`utils/storage.ts`): records store a PATH (`idImagePath`), never a durable URL. Default flow stores NO image (extract-then-purge). Opt-in retain uploads to a new private RLS bucket `worker-ids` (owner-created).
- **Claim flow** reuses the existing magic-link infra (`MagicLinkHandler` in `app/_layout.tsx` + `supabase/functions/auth-magic-link`).
- **Tier gate**: client `hooks/useTierAccess.ts` FeatureKey `'crew_management' → 'business'`; server `requireTier(req, ['business'], 'scan_credential')`. Claimed-worker self-edit is NOT gated.

## Tech Stack

bun; TypeScript strict (`npx tsc --noEmit`); Expo Router 6 typed routes; `@tanstack/react-query` + Supabase; `expo-image-picker` (already installed, OTA-safe — no new native deps); `lucide-react-native` (`IdCard`, `UserCheck`, `ShieldCheck`, `ScanLine`); amber brand via `useTheme()`/`Colors`; validators are plain bun scripts (NO jest).

---

## File Structure

```
types/index.ts                                  # (edit) + CrewMember, CrewMemberStatus, IdDocumentType, IdScanFields
utils/crew/idMasking.ts                          # NEW pure: maskIdLast4
utils/crew/verifiedBadge.ts                      # NEW pure: computeIdVerified, verifiedBadge
utils/crew/claimToken.ts                         # NEW pure: generateClaimToken, isValidClaimTokenFormat, canClaim
utils/crew/certExpiry.ts                         # NEW pure: certExpiryStatus  (shared w/ Safety Wave B)
utils/crew/surfacing.ts                          # NEW pure: shouldSurfaceToMarketplace, crewMemberToWorkerProfile
utils/crew/index.ts                              # NEW barrel re-export
scripts/validate-crew.ts                         # NEW validator (wired into ship-check + test:crew)
package.json                                     # (edit) add test:crew, append to ship-check
contexts/CrewContext.tsx                         # NEW createContextHook provider
app/_layout.tsx                                  # (edit) mount CrewProvider; Stack.Screen crew + claim-crew; titles; public route
supabase/migrations/20260708130000_crew_members.sql   # NEW additive table + RLS (owner-applied)
supabase/schema.sql                              # (edit) mirror crew_members
hooks/useTierAccess.ts                           # (edit) + 'crew_management' FeatureKey
utils/aiRateLimiterCore.ts                       # (edit) + 'scanCredential' AIFeature + FEATURE_CONFIG
supabase/functions/_shared/auth.ts               # (edit) + scan_credential in MONTHLY_CAPS (all 4 tiers)
supabase/functions/scan-credential/index.ts      # NEW edge function
utils/storage.ts                                 # (edit) + uploadWorkerIdImage (path-only, worker-ids bucket)
utils/crewScan.ts                                # NEW client helper: scanCredential() invoke wrapper
components/DesktopSidebar.tsx                     # (edit) + Crew NavItem (NETWORK, requires crew_management)
app/crew.tsx                                     # NEW roster + member-detail modal + ID-scan sub-flow + invite
app/claim-crew.tsx                               # NEW magic-link claim redemption route
docs/deploy/2026-07-08-crew-worker-ids-bucket.md # NEW owner runbook for the worker-ids bucket + migration
```

---

## Task 1 — Domain types

- [ ] Open `types/index.ts`. Immediately AFTER the `WorkerProfile` interface (ends at `types/index.ts:3010`), add the CrewMember block. Do NOT modify `WorkerProfile`.
- [ ] Add real code:

```ts
// ─── Crew Member (verified, portable worker identity) ─────────────────────
// DISTINCT from the marketplace `WorkerProfile` above. A CrewMember is
// company-scoped, GC-created, and worker-claimable. It is the person-anchor
// for Safety Wave B certifications (Certification.workerId → CrewMember.id,
// added in Wave B which ships AFTER this feature) and can later SURFACE AS a
// marketplace WorkerProfile when claimed + public + HIRE_ENABLED.
export type CrewMemberStatus = 'active' | 'inactive';
export type IdDocumentType = 'drivers_license' | 'state_id' | 'passport' | 'other';

/** Fields returned by the scan-credential edge fn for a government_id. The
 *  raw idNumberFull is used ONCE client-side to derive idMaskedLast4, then
 *  discarded — it is never persisted or synced. */
export interface IdScanFields {
  fullName: string;
  idType: IdDocumentType;
  idNumberFull: string;
  dob: string;
  expiry: string;
  issuer: string;
}

export interface CrewMember {
  id: string;
  /** Owning GC (auth user id). */
  companyUserId: string;
  createdAt: string;
  updatedAt: string;
  // Identity
  fullName: string;
  trades: string[];
  phone?: string;
  email?: string;
  photoUrl?: string;
  status: CrewMemberStatus;
  // ID verification (extract-then-purge default: only masked/derived fields)
  idVerified: boolean;
  idType?: IdDocumentType;
  idMaskedLast4?: string;
  idExpiry?: string;
  idIssuer?: string;
  idScannedAt?: string;
  /** Present ONLY if the GC opted to retain the raw image. A storage PATH in
   *  the private `worker-ids` bucket — never a durable URL. Undefined after
   *  the default purge. */
  idImagePath?: string;
  // Claim (hybrid ownership)
  claimToken?: string;
  claimedByUserId?: string;
  claimedAt?: string;
  /** Worker-controlled marketplace visibility. Default false. */
  isPublic: boolean;
  /** Link to a Hire WorkerProfile once surfaced (HIRE_ENABLED gated). */
  marketplaceProfileId?: string;
  // Assignment
  projectIds: string[];
}
```

- [ ] `npx tsc --noEmit` (expect clean).
- [ ] `git add types/index.ts`
- [ ] `git commit -m "Crew: add CrewMember domain types (distinct from marketplace WorkerProfile)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 2 — Pure crew logic + validator (validator-first TDD)

Write the validator FIRST with the exact expected outputs below, run it (RED — modules don't exist), then implement each pure module until GREEN.

### Step 2a — write the failing validator

- [ ] Create `scripts/validate-crew.ts`:

```ts
// validate-crew.ts — unit tests for the pure crew logic (utils/crew/*).
// Run via: bun run scripts/validate-crew.ts
//
// Bun runs TypeScript natively. utils/crew/* imports NOTHING from
// react-native / AsyncStorage / supabase, so we exercise the pure functions
// directly with no mocking (mirrors scripts/validate-schedule-colors.ts).

import { maskIdLast4 } from '../utils/crew/idMasking';
import { computeIdVerified, verifiedBadge } from '../utils/crew/verifiedBadge';
import { generateClaimToken, isValidClaimTokenFormat, canClaim } from '../utils/crew/claimToken';
import { certExpiryStatus } from '../utils/crew/certExpiry';
import { shouldSurfaceToMarketplace, crewMemberToWorkerProfile } from '../utils/crew/surfacing';
import type { CrewMember } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

console.log('\ncrew logic validation:');

// ── ID masking: strip non-digits, keep last 4, short numbers handled ──
expect('maskIdLast4 DL', maskIdLast4('D1234567'), '4567');
expect('maskIdLast4 with dashes', maskIdLast4('A12-34'), '1234');
expect('maskIdLast4 short (2 digits)', maskIdLast4('99'), '99');
expect('maskIdLast4 empty', maskIdLast4(''), '');
expect('maskIdLast4 no digits', maskIdLast4('no-digits'), '');
expect('maskIdLast4 spaced', maskIdLast4('123 4567 890'), '7890');

// ── Verified-badge derivation: a scan alone is NOT verified ──
expect('computeIdVerified scan+confirm', computeIdVerified({ scanCompleted: true, userConfirmed: true }), true);
expect('computeIdVerified scan only', computeIdVerified({ scanCompleted: true, userConfirmed: false }), false);
expect('computeIdVerified confirm only', computeIdVerified({ scanCompleted: false, userConfirmed: true }), false);
expect('verifiedBadge verified', verifiedBadge({ idVerified: true, idMaskedLast4: '4567' }), 'id_verified');
expect('verifiedBadge flag-set-but-no-scan', verifiedBadge({ idVerified: true, idMaskedLast4: undefined }), 'unverified');
expect('verifiedBadge unverified', verifiedBadge({ idVerified: false, idMaskedLast4: undefined }), 'unverified');

// ── Claim-token format + single-use ──
const tok = generateClaimToken('11111111-2222-4333-8444-555555555555');
expect('generateClaimToken format', tok, 'crew_11111111-2222-4333-8444-555555555555');
expect('isValidClaimTokenFormat good', isValidClaimTokenFormat('crew_11111111-2222-4333-8444-555555555555'), true);
expect('isValidClaimTokenFormat bad prefix', isValidClaimTokenFormat('foo_11111111-2222-4333-8444-555555555555'), false);
expect('isValidClaimTokenFormat too short', isValidClaimTokenFormat('crew_abc'), false);
expect('isValidClaimTokenFormat empty', isValidClaimTokenFormat(''), false);
expect('canClaim unclaimed', canClaim({ claimToken: tok, claimedByUserId: undefined }), true);
expect('canClaim already-claimed (single-use)', canClaim({ claimToken: tok, claimedByUserId: 'u1' }), false);
expect('canClaim no token', canClaim({ claimToken: undefined, claimedByUserId: undefined }), false);

// ── Cert-expiry status (shared with Safety Wave B) ──
expect('certExpiry none', certExpiryStatus(undefined, '2026-07-08'), 'none');
expect('certExpiry empty', certExpiryStatus('', '2026-07-08'), 'none');
expect('certExpiry expired', certExpiryStatus('2026-06-01', '2026-07-08'), 'expired');
expect('certExpiry expiring (12d)', certExpiryStatus('2026-07-20', '2026-07-08'), 'expiring');
expect('certExpiry boundary 30d', certExpiryStatus('2026-08-07', '2026-07-08'), 'expiring');
expect('certExpiry boundary 31d', certExpiryStatus('2026-08-08', '2026-07-08'), 'valid');
expect('certExpiry valid', certExpiryStatus('2026-12-01', '2026-07-08'), 'valid');

// ── Marketplace surfacing guard (HIRE_ENABLED gated) ──
const claimedPublic = { isPublic: true, claimedByUserId: 'u1' };
expect('surface: flag OFF → false', shouldSurfaceToMarketplace(claimedPublic, false), false);
expect('surface: flag ON + claimed + public → true', shouldSurfaceToMarketplace(claimedPublic, true), true);
expect('surface: not public → false', shouldSurfaceToMarketplace({ isPublic: false, claimedByUserId: 'u1' }, true), false);
expect('surface: not claimed → false', shouldSurfaceToMarketplace({ isPublic: true, claimedByUserId: undefined }, true), false);

// ── Surfacing mapper: CrewMember → marketplace WorkerProfile ──
const sampleMember: CrewMember = {
  id: 'cm1', companyUserId: 'gc1', createdAt: '2026-07-08T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z',
  fullName: 'Jane Framer', trades: ['Carpenter'], phone: '555-0100', email: 'jane@example.com',
  status: 'active', idVerified: true, idMaskedLast4: '4567', isPublic: true, projectIds: [],
  claimedByUserId: 'w1',
};
const wp = crewMemberToWorkerProfile(sampleMember);
expect('mapper name', wp.name, 'Jane Framer');
expect('mapper contactEmail', wp.contactEmail, 'jane@example.com');
expect('mapper phone', wp.phone, '555-0100');
expect('mapper tradeCategory', wp.tradeCategory, 'carpenter');
expect('mapper verified → licenses badge', wp.licenses, ['ID Verified']);
expect('mapper availability default', wp.availability, 'available');
expect('mapper createdAt passthrough', wp.createdAt, '2026-07-08T00:00:00Z');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Run `bun run scripts/validate-crew.ts` — expect module-resolution failure (RED). Good.

### Step 2b — implement the pure modules

- [ ] Create `utils/crew/idMasking.ts`:

```ts
// Derive the masked last-4 of a government-ID number. Strips every
// non-digit, then keeps the final 4 digits (fewer if the number is short).
// This is the ONLY ID-number-derived value we ever persist — the raw
// idNumberFull is discarded immediately after this call.
export function maskIdLast4(idNumberFull: string): string {
  const digits = (idNumberFull ?? '').replace(/\D/g, '');
  return digits.slice(-4);
}
```

- [ ] Create `utils/crew/verifiedBadge.ts`:

```ts
// Verified-badge derivation. A raw scan is NOT verification — the GC must
// confirm the extracted fields in the review step. computeIdVerified is the
// gate the ID-scan save path calls; verifiedBadge renders a persisted record.
export function computeIdVerified(params: { scanCompleted: boolean; userConfirmed: boolean }): boolean {
  return params.scanCompleted && params.userConfirmed;
}

/** Badge for a stored CrewMember. 'id_verified' only when the record both
 *  carries the verified flag AND has a masked-last4 (proof a scan happened). */
export function verifiedBadge(cm: { idVerified: boolean; idMaskedLast4?: string }): 'id_verified' | 'unverified' {
  return cm.idVerified && !!cm.idMaskedLast4 ? 'id_verified' : 'unverified';
}
```

- [ ] Create `utils/crew/claimToken.ts`:

```ts
// Claim tokens are single-use invite tokens minted by the GC. The pure parts
// are format + usability; the random UUID is injected so this stays testable
// and side-effect free. The caller passes generateUUID() from utils/generateId.
export function generateClaimToken(uuid: string): string {
  return `crew_${uuid}`;
}

/** crew_ prefix + a UUID-ish tail (hex + dashes, ≥ 20 chars). */
export function isValidClaimTokenFormat(token: string | undefined): boolean {
  return !!token && /^crew_[0-9a-f-]{20,}$/i.test(token);
}

/** Single-use: a member can be claimed only if it carries a well-formed token
 *  and has NOT already been claimed. */
export function canClaim(member: { claimToken?: string; claimedByUserId?: string }): boolean {
  return isValidClaimTokenFormat(member.claimToken) && !member.claimedByUserId;
}
```

- [ ] Create `utils/crew/certExpiry.ts`:

```ts
// Cert-expiry status — shared with Safety Wave B (Wave B's cert screen should
// import certExpiryStatus from here rather than re-implementing certStatus).
// 'expiring' = within 30 days (inclusive). Dates are ISO YYYY-MM-DD.
export type CertExpiryStatus = 'none' | 'valid' | 'expiring' | 'expired';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function certExpiryStatus(expiresDate: string | undefined, today: string): CertExpiryStatus {
  if (!expiresDate) return 'none';
  const exp = Date.parse(expiresDate);
  const now = Date.parse(today);
  if (Number.isNaN(exp) || Number.isNaN(now)) return 'none';
  const days = Math.floor((exp - now) / MS_PER_DAY);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'valid';
}
```

- [ ] Create `utils/crew/surfacing.ts`:

```ts
import type { CrewMember, TradeCategory, WorkerProfile } from '@/types';

// Marketplace surfacing guard. A CrewMember surfaces as a Hire WorkerProfile
// ONLY when it is public, claimed by a worker, AND the launch flag is on.
// HIRE_ENABLED stays false for now, so this returns false in production —
// flipping the flag lights up verified listings with no rebuild.
export function shouldSurfaceToMarketplace(
  member: { isPublic: boolean; claimedByUserId?: string },
  hireEnabled: boolean,
): boolean {
  return member.isPublic && !!member.claimedByUserId && hireEnabled;
}

const TRADE_CATEGORY_MAP: Record<string, TradeCategory> = {
  laborer: 'general_laborer', 'general laborer': 'general_laborer',
  carpenter: 'carpenter', electrician: 'electrician', plumber: 'plumber',
  hvac: 'hvac_tech', 'hvac tech': 'hvac_tech', welder: 'welder', mason: 'mason',
  painter: 'painter', roofer: 'roofer', drywall: 'drywall', flooring: 'flooring',
  concrete: 'concrete_worker', demolition: 'demolition', glazier: 'glazier',
};

function mapTradeToCategory(trade: string): TradeCategory {
  return TRADE_CATEGORY_MAP[trade.trim().toLowerCase()] ?? 'general_laborer';
}

/** Pure mapper: a claimed/public CrewMember → a marketplace WorkerProfile.
 *  Called only when shouldSurfaceToMarketplace(...) is true (i.e. gated). */
export function crewMemberToWorkerProfile(cm: CrewMember): WorkerProfile {
  return {
    id: cm.marketplaceProfileId ?? cm.id,
    name: cm.fullName,
    tradeCategory: mapTradeToCategory(cm.trades[0] ?? ''),
    yearsExperience: 0,
    licenses: cm.idVerified ? ['ID Verified'] : [],
    city: '',
    state: '',
    availability: 'available',
    hourlyRate: 0,
    bio: '',
    pastProjects: [],
    contactEmail: cm.email ?? '',
    phone: cm.phone ?? '',
    createdAt: cm.createdAt,
  };
}
```

- [ ] Create `utils/crew/index.ts` (barrel):

```ts
export { maskIdLast4 } from './idMasking';
export { computeIdVerified, verifiedBadge } from './verifiedBadge';
export { generateClaimToken, isValidClaimTokenFormat, canClaim } from './claimToken';
export { certExpiryStatus, type CertExpiryStatus } from './certExpiry';
export { shouldSurfaceToMarketplace, crewMemberToWorkerProfile } from './surfacing';
```

### Step 2c — wire into ship-check + run GREEN

- [ ] Edit `package.json`. Add the script after `"test:cpm"`:

```json
    "test:crew": "bun run scripts/validate-crew.ts",
```

- [ ] In the same file append `&& bun run test:crew` to the END of the `ship-check` value (after `bun run test:app-slop`):

```json
    "ship-check": "bun run typecheck && bun run lint && bun run test:colors && bun run test:health && bun run test:barlabel && bun run test:gating && bun run test:sched-schema && bun run test:sched-history && bun run test:sched-depcycle && bun run test:sched-copilot && bun run test:cpm && bun run test:safety-risk && bun run test:safety-osha && bun run test:app-slop && bun run test:crew",
```

- [ ] Run `bun run test:crew` — expect `38 passed, 0 failed` (6 masking + 6 verified-badge + 8 claim-token + 7 cert-expiry + 4 surfacing-guard + 7 mapper).
- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add utils/crew/idMasking.ts utils/crew/verifiedBadge.ts utils/crew/claimToken.ts utils/crew/certExpiry.ts utils/crew/surfacing.ts utils/crew/index.ts scripts/validate-crew.ts package.json`
- [ ] `git commit -m "Crew: pure logic (masking, verified badge, claim token, cert expiry, surfacing) + validate-crew in ship-check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 3 — CrewContext + provider mount

- [ ] Create `contexts/CrewContext.tsx`. Mirror the tertiary_* + createContextHook shape from `contexts/HireContext.tsx` / `contexts/ProjectContext.tsx`:

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { CrewMember } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { deleteStorageFile } from '@/utils/storage';
import { generateUUID } from '@/utils/generateId';
import { generateClaimToken } from '@/utils/crew';

const CREW_KEY = 'tertiary_crew_members';

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function saveLocal(key: string, data: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(data)); }
  catch (err) { console.log('[CrewContext] Local save failed for', key, err); }
}

/** Row → CrewMember (snake_case → camelCase). */
function mapRow(r: Record<string, unknown>): CrewMember {
  return {
    id: r.id as string,
    companyUserId: r.user_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    fullName: (r.full_name as string) ?? '',
    trades: (r.trades as string[]) ?? [],
    phone: (r.phone as string | null) ?? undefined,
    email: (r.email as string | null) ?? undefined,
    photoUrl: (r.photo_url as string | null) ?? undefined,
    status: (r.status as CrewMember['status']) ?? 'active',
    idVerified: !!r.id_verified,
    idType: (r.id_type as CrewMember['idType']) ?? undefined,
    idMaskedLast4: (r.id_masked_last4 as string | null) ?? undefined,
    idExpiry: (r.id_expiry as string | null) ?? undefined,
    idIssuer: (r.id_issuer as string | null) ?? undefined,
    idScannedAt: (r.id_scanned_at as string | null) ?? undefined,
    idImagePath: (r.id_image_path as string | null) ?? undefined,
    claimToken: (r.claim_token as string | null) ?? undefined,
    claimedByUserId: (r.claimed_by_user_id as string | null) ?? undefined,
    claimedAt: (r.claimed_at as string | null) ?? undefined,
    isPublic: !!r.is_public,
    marketplaceProfileId: (r.marketplace_profile_id as string | null) ?? undefined,
    projectIds: (r.project_ids as string[]) ?? [],
  };
}

/** CrewMember → row (camelCase → snake_case) for supabaseWrite. */
function toRow(m: CrewMember): Record<string, unknown> {
  return {
    id: m.id, user_id: m.companyUserId, full_name: m.fullName, trades: m.trades,
    phone: m.phone ?? null, email: m.email ?? null, photo_url: m.photoUrl ?? null,
    status: m.status, id_verified: m.idVerified, id_type: m.idType ?? null,
    id_masked_last4: m.idMaskedLast4 ?? null, id_expiry: m.idExpiry ?? null,
    id_issuer: m.idIssuer ?? null, id_scanned_at: m.idScannedAt ?? null,
    id_image_path: m.idImagePath ?? null, claim_token: m.claimToken ?? null,
    claimed_by_user_id: m.claimedByUserId ?? null, claimed_at: m.claimedAt ?? null,
    is_public: m.isPublic, marketplace_profile_id: m.marketplaceProfileId ?? null,
    project_ids: m.projectIds, created_at: m.createdAt, updated_at: m.updatedAt,
  };
}

export const [CrewProvider, useCrew] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;

  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);

  const crewQuery = useQuery({
    queryKey: ['crew_members', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          // Owner rows OR rows the current user has claimed (RLS enforces).
          const { data, error } = await supabase.from('crew_members').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => mapRow(r));
            await saveLocal(CREW_KEY, mapped);
            return mapped;
          }
        } catch (err) { console.log('[CrewContext] fetch failed, using local:', err); }
      }
      return loadLocal<CrewMember[]>(CREW_KEY, []);
    },
    enabled: !!userId,
  });

  useEffect(() => { if (crewQuery.data) setCrewMembers(crewQuery.data); }, [crewQuery.data]);

  const addCrewMember = useCallback((m: CrewMember) => {
    const updated = [m, ...crewMembers];
    setCrewMembers(updated);
    void saveLocal(CREW_KEY, updated);
    if (canSync) void supabaseWrite('crew_members', 'insert', toRow(m));
  }, [crewMembers, canSync]);

  const updateCrewMember = useCallback((id: string, changes: Partial<CrewMember>) => {
    let next: CrewMember | undefined;
    const updated = crewMembers.map(m => {
      if (m.id !== id) return m;
      next = { ...m, ...changes, updatedAt: new Date().toISOString() };
      return next;
    });
    setCrewMembers(updated);
    void saveLocal(CREW_KEY, updated);
    if (canSync && next) void supabaseWrite('crew_members', 'update', toRow(next));
  }, [crewMembers, canSync]);

  const deleteCrewMember = useCallback((id: string) => {
    const target = crewMembers.find(m => m.id === id);
    const updated = crewMembers.filter(m => m.id !== id);
    setCrewMembers(updated);
    void saveLocal(CREW_KEY, updated);
    // Retention/deletion: purge any retained raw ID image from private storage.
    if (target?.idImagePath) void deleteStorageFile('worker-ids', target.idImagePath);
    if (canSync) void supabaseWrite('crew_members', 'delete', { id });
  }, [crewMembers, canSync]);

  const getCrewMember = useCallback((id: string) => crewMembers.find(m => m.id === id) ?? null, [crewMembers]);

  const getCrewForProject = useCallback(
    (projectId: string) => crewMembers.filter(m => m.projectIds.includes(projectId)),
    [crewMembers],
  );

  /** Mint a single-use claim token onto a member (idempotent — keeps an
   *  existing unclaimed token). Returns the token. Sending the magic-link
   *  invite is done by the screen via utils/crewScan → auth-magic-link. */
  const startClaimInvite = useCallback((id: string): string | null => {
    const member = crewMembers.find(m => m.id === id);
    if (!member) return null;
    if (member.claimedByUserId) return member.claimToken ?? null; // already claimed
    const token = member.claimToken ?? generateClaimToken(generateUUID());
    if (!member.claimToken) updateCrewMember(id, { claimToken: token });
    return token;
  }, [crewMembers, updateCrewMember]);

  /** Redeem a claim token as the current user. Called by app/claim-crew.tsx
   *  once the magic-link session is established. Single-use: no-ops if the
   *  member is already claimed by someone else. */
  const claimCrewMember = useCallback((token: string, claimingUserId: string): boolean => {
    const member = crewMembers.find(m => m.claimToken === token);
    if (!member || (member.claimedByUserId && member.claimedByUserId !== claimingUserId)) return false;
    updateCrewMember(member.id, {
      claimedByUserId: claimingUserId,
      claimedAt: new Date().toISOString(),
    });
    return true;
  }, [crewMembers, updateCrewMember]);

  return useMemo(() => ({
    crewMembers,
    isLoading: crewQuery.isLoading,
    addCrewMember,
    updateCrewMember,
    deleteCrewMember,
    getCrewMember,
    getCrewForProject,
    startClaimInvite,
    claimCrewMember,
  }), [crewMembers, crewQuery.isLoading, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember, getCrewForProject, startClaimInvite, claimCrewMember]);
});
```

- [ ] Mount in `app/_layout.tsx`. Add the import beside the other context imports (near line 11):

```ts
import { CrewProvider } from "@/contexts/CrewContext";
```

- [ ] Wrap `CrewProvider` immediately inside `<ProjectProvider>` (so it gets the auth user; `ProjectProvider` is already below `AuthProvider`). NOTE: `<SafetyProvider>` sits BETWEEN `<ProjectProvider>` and `<PropertyProvider>` in the real file — anchor on `<ProjectProvider>` + `<SafetyProvider>`, not `<PropertyProvider>`. Change the JSX at lines 1224–1225 from:

```tsx
                <ProjectProvider>
                  <SafetyProvider>
```
to:
```tsx
                <ProjectProvider>
                  <CrewProvider>
                  <SafetyProvider>
```
and add the matching close tag at lines 1249–1250 — change:
```tsx
                  </SafetyProvider>
                </ProjectProvider>
```
to:
```tsx
                  </SafetyProvider>
                  </CrewProvider>
                </ProjectProvider>
```

This wraps `CrewProvider` directly inside `<ProjectProvider>` (before `<SafetyProvider>`) and closes it after `</SafetyProvider>` (before `</ProjectProvider>`), so `CrewProvider` encloses `SafetyProvider`, `PropertyProvider`, and everything below — all still under the auth user.

- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add contexts/CrewContext.tsx app/_layout.tsx`
- [ ] `git commit -m "Crew: offline-first CrewContext + mount under ProjectProvider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 4 — Migration + schema.sql mirror + worker-ids bucket runbook

The migration is APPLIED BY THE OWNER (Supabase MCP `apply_migration`, never `db push`), and the `worker-ids` bucket is an OWNER config step. This task only writes the files + runbook.

- [ ] Create `supabase/migrations/20260708130000_crew_members.sql`:

```sql
-- 20260708130000_crew_members.sql
-- Worker Profile — CrewMember roster. Additive, company-scoped.
--
-- RLS: a row is visible to its owning GC (auth.uid() = user_id) AND, once
-- claimed, to the claiming worker (auth.uid() = claimed_by_user_id). Only the
-- GC can INSERT (user_id = auth.uid()); the GC OR the claimed worker can
-- UPDATE; only the GC can DELETE. Mirrors the punch_items/jhas ownership
-- pattern (20260708120000_safety_wave_a.sql) plus the claimed-worker overlay.
--
-- Apply to PROD BEFORE the OTA that writes this table (PGRST204 gate — an OTA
-- writing a column the live schema lacks fails silently in supabaseWrite).
--
-- SEPARATE OWNER STEP (not in this migration): create the PRIVATE storage
-- bucket `worker-ids` for opt-in retained raw ID images (path-only refs). See
-- docs/deploy/2026-07-08-crew-worker-ids-bucket.md.

CREATE TABLE IF NOT EXISTS public.crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  trades JSONB DEFAULT '[]'::JSONB,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  -- ID verification (extract-then-purge default: masked/derived fields only)
  id_verified BOOLEAN DEFAULT FALSE,
  id_type TEXT CHECK (id_type IN ('drivers_license', 'state_id', 'passport', 'other')),
  id_masked_last4 TEXT,
  id_expiry TEXT,
  id_issuer TEXT,
  id_scanned_at TIMESTAMPTZ,
  -- Present ONLY on opt-in retain: a PATH in the private worker-ids bucket.
  id_image_path TEXT,
  -- Claim (hybrid ownership)
  claim_token TEXT UNIQUE,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  is_public BOOLEAN DEFAULT FALSE,
  marketplace_profile_id UUID,
  project_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_members_user ON public.crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claimed ON public.crew_members(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claim_token ON public.crew_members(claim_token);

ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

-- SELECT: owning GC or the claimed worker.
CREATE POLICY "crew_select_own_or_claimed" ON public.crew_members
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- INSERT: only the owning GC.
CREATE POLICY "crew_insert_own" ON public.crew_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE: owning GC or the claimed worker (self-edit path is not tier-gated).
CREATE POLICY "crew_update_own_or_claimed" ON public.crew_members
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- DELETE: only the owning GC.
CREATE POLICY "crew_delete_own" ON public.crew_members
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] Mirror the exact `CREATE TABLE ... + indexes + RLS + trigger` block into `supabase/schema.sql` — append a new `-- CREW MEMBERS` section at the end of the file (schema.sql is the single-file source of truth run in the SQL editor). Use identical DDL.
- [ ] Create `docs/deploy/2026-07-08-crew-worker-ids-bucket.md`:

```md
# Crew / Worker-IDs — owner deploy runbook (2026-07-08)

Two owner-only steps. Do BOTH before publishing the OTA that ships app/crew.tsx.

## 1. Apply the migration
Supabase MCP `apply_migration` (project nteoqhcswappxxjlpvap), name `crew_members`,
body = supabase/migrations/20260708130000_crew_members.sql. NEVER `supabase db push`
(divergent history). Verify with `execute_sql`:
`select column_name from information_schema.columns where table_name='crew_members';`

## 2. Create the private `worker-ids` storage bucket
Only needed for the opt-in "retain raw ID image" path (default flow stores NO image).
- Storage → New bucket → name `worker-ids`, **Public = OFF** (private).
- RLS on storage.objects, folder-scoped to the owner (folder[1] = auth.uid()):

```sql
create policy "worker_ids_rw_own" on storage.objects
  for all using (
    bucket_id = 'worker-ids' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'worker-ids' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Retention: deleting a CrewMember purges its retained image (CrewContext.deleteCrewMember →
deleteStorageFile('worker-ids', idImagePath)). Document a retention window in the privacy policy.
```

- [ ] `git add supabase/migrations/20260708130000_crew_members.sql supabase/schema.sql docs/deploy/2026-07-08-crew-worker-ids-bucket.md`
- [ ] `git commit -m "Crew: crew_members migration + schema.sql mirror + worker-ids bucket runbook (owner-applied)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 5 — Tier gate + AI metering keys

- [ ] Edit `hooks/useTierAccess.ts`. Add `'crew_management'` to the `FeatureKey` union under the Business-only group (after `'safety_management'` at line 34):

```ts
  | 'safety_management'
  | 'crew_management'
```

- [ ] In the same file add it to `REQUIRED_TIER` under the Business-only block (after `safety_management: 'business',` at line 93):

```ts
  safety_management: 'business',
  crew_management: 'business',
```

- [ ] Edit `utils/aiRateLimiterCore.ts`. Add `'scanCredential'` to the `AIFeature` union under the Pro+ block (after `'specBookExtract'` at line 39):

```ts
  | 'specBookExtract'
  | 'scanCredential';
```

- [ ] In the same file add its config to `FEATURE_CONFIG` (after `specBookExtract` at line 80):

```ts
  specBookExtract:    { tier: 'smart', proOnly: true, displayName: 'Spec Book Extract' },
  scanCredential:     { tier: 'smart', proOnly: true, displayName: 'ID / Credential Scan' },
```

- [ ] Edit `supabase/functions/_shared/auth.ts` `MONTHLY_CAPS`. Add a `scan_credential` key to EVERY tier block (free/pro/business/enterprise). Insert after each tier's `safety_ai` line:

```ts
  free: {
    ...
    safety_ai: 0,
    scan_credential: 0,
  },
  pro: {
    ...
    safety_ai: 0,
    scan_credential: 20,
  },
  business: {
    ...
    safety_ai: 900,
    scan_credential: 60,
  },
  enterprise: {
    ...
    safety_ai: 1800,
    scan_credential: 150,
  },
```

> **Note on `pro.scan_credential: 20` (dead config, keep it):** this row is unreachable by design — the scan is Business-gated on BOTH the screen (`crew_management → 'business'`) and the server (`requireTier(req, ['business'], …)`), so a Pro user is 403'd before metering ever runs. The `20` follows the spec's stated per-tier numbers (free 0 / pro 20 / business 60 / ent 150) and keeps the `MONTHLY_CAPS` table shape uniform across tiers; it is a deliberate spec choice, not a live cap. Leave it in — do not delete the pro key.

- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add hooks/useTierAccess.ts utils/aiRateLimiterCore.ts supabase/functions/_shared/auth.ts`
- [ ] `git commit -m "Crew: crew_management tier gate + scanCredential AI metering + scan_credential monthly caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 6 — scan-credential edge function

- [ ] Create `supabase/functions/scan-credential/index.ts`. Mirror `analyze-photos/index.ts` (CORS, `requireTier`, `MONTHLY_CAPS`, `urlGuard`, Gemini-Flash, strict server JSON shaping). ONE function serves both `government_id` and `certification`. Business-gated. Returns fields only — NEVER persists the image.

```ts
// scan-credential
//
// Gemini Vision extractor for worker credentials. Two kinds:
//   - 'government_id'  → { fullName, idType, idNumberFull, dob, expiry, issuer }
//   - 'certification'  → { certType, certNumber, issuer, issuedDate, expiresDate }
//
// Business-tier only. The server returns the extracted FIELDS ONLY — it never
// persists the image. Persistence + purge/mask happen client-side per the
// extract-then-purge policy. Modelled on analyze-photos (same auth / CORS /
// SSRF / metering / error shape).
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type ScanKind = 'government_id' | 'certification';
interface ScanRequest {
  kind: ScanKind;
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
}

const ID_PROMPT = `You are reading a US government-issued photo ID (driver's license, state ID, or passport). Extract the fields into strict JSON. Do NOT guess — leave a field as an empty string if it is not clearly legible.

Return a single JSON object:
  - fullName: the person's full name as printed.
  - idType: one of "drivers_license", "state_id", "passport", "other".
  - idNumberFull: the document/license number exactly as printed (letters + digits).
  - dob: date of birth as YYYY-MM-DD if determinable, else "".
  - expiry: expiration date as YYYY-MM-DD if determinable, else "".
  - issuer: the issuing authority (state name for a license/state ID, country for a passport).

Return JSON only — no preamble. If the image is not a government ID, return { "fullName": "", "idType": "other", "idNumberFull": "", "dob": "", "expiry": "", "issuer": "" }.`;

const CERT_PROMPT = `You are reading a construction / trade CERTIFICATION card or certificate (OSHA 10/30, SST, CPR, First Aid, forklift, journeyman license, etc.). Extract the fields into strict JSON. Do NOT guess — leave a field empty if not clearly legible.

Return a single JSON object:
  - certType: the certification name/type as printed ("OSHA 30", "CPR/AED", "Journeyman Electrician").
  - certNumber: the certificate / card number if printed, else "".
  - issuer: the issuing organization/authority.
  - issuedDate: issue date as YYYY-MM-DD if determinable, else "".
  - expiresDate: expiration date as YYYY-MM-DD if determinable, else "".

Return JSON only — no preamble. If the image is not a certification, return { "certType": "", "certNumber": "", "issuer": "", "issuedDate": "", "expiresDate": "" }.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'scan_credential');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: ScanRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  if (body.kind !== 'government_id' && body.kind !== 'certification') {
    return jsonResponse({ success: false, error: 'kind must be "government_id" or "certification"' }, 400);
  }

  // Meter BEFORE the expensive Gemini call.
  const used = await aiUsageIncrement(auth.userId, 'scan_credential');
  const cap = MONTHLY_CAPS[auth.tier].scan_credential;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly credential-scan limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  // Resolve the image: inline base64 (client camera/library file://) OR a URL
  // (SSRF-guarded). One image per call.
  let imageData: string;
  let mimeType: string;
  if (body.imageBase64) {
    const MAX_BYTES = 6 * 1024 * 1024;
    if (body.imageBase64.length > MAX_BYTES) {
      return jsonResponse({ success: false, error: 'Image too large. Capture at ~1200×1600.' }, 413);
    }
    imageData = body.imageBase64;
    mimeType = body.mimeType || 'image/jpeg';
  } else if (body.imageUrl) {
    try { validateFetchableUrl(body.imageUrl); }
    catch { return jsonResponse({ success: false, error: 'URL not allowed' }, 400); }
    try { const f = await fetchAsBase64(body.imageUrl); imageData = f.data; mimeType = f.mimeType; }
    catch { return jsonResponse({ success: false, error: 'Could not load the supplied image' }, 400); }
  } else {
    return jsonResponse({ success: false, error: 'imageBase64 or imageUrl required' }, 400);
  }

  console.log(`[scan-credential] kind=${body.kind} tier=${auth.tier}`);

  const prompt = body.kind === 'government_id' ? ID_PROMPT : CERT_PROMPT;
  const parts: Record<string, unknown>[] = [
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: imageData } },
  ];

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 800 },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 160)}` }, 502);
  }

  const j = await geminiResp.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; }
  catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }

  if (body.kind === 'government_id') {
    const validTypes = ['drivers_license', 'state_id', 'passport', 'other'];
    const t = String(parsed.idType ?? 'other');
    const fields = {
      fullName: String(parsed.fullName ?? '').slice(0, 120),
      idType: validTypes.includes(t) ? t : 'other',
      idNumberFull: String(parsed.idNumberFull ?? '').slice(0, 40),
      dob: String(parsed.dob ?? ''),
      expiry: String(parsed.expiry ?? ''),
      issuer: String(parsed.issuer ?? '').slice(0, 80),
    };
    return jsonResponse({ success: true, fields });
  }

  const fields = {
    certType: String(parsed.certType ?? '').slice(0, 120),
    certNumber: String(parsed.certNumber ?? '').slice(0, 60),
    issuer: String(parsed.issuer ?? '').slice(0, 120),
    issuedDate: String(parsed.issuedDate ?? ''),
    expiresDate: String(parsed.expiresDate ?? ''),
  };
  return jsonResponse({ success: true, fields });
});
```

- [ ] `git add supabase/functions/scan-credential/index.ts`
- [ ] `git commit -m "Crew: scan-credential edge function (business-gated ID + cert extraction, image never persisted)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

> Note: `supabase functions deploy scan-credential` is an OWNER step — do NOT deploy from this session.

---

## Task 7 — Client scan helper + private ID-image upload

- [ ] Edit `utils/storage.ts`. Add a path-only uploader for the private `worker-ids` bucket (mirror `uploadDocument`, but return the PATH, never a signed URL — the record stores the path and re-signs on demand):

```ts
// Upload an opt-in retained raw ID image to the PRIVATE worker-ids bucket.
// Returns the storage PATH (never a durable URL) — mirrors the sub-documents
// precedent. The default ID-scan flow does NOT call this (extract-then-purge).
export async function uploadWorkerIdImage(
  userId: string,
  crewMemberId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/${crewMemberId}/${Date.now()}.jpg`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('worker-ids')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.log('[Storage] Worker-ID upload error:', error.message);
      return null;
    }
    console.log('[Storage] Worker-ID stored (path only):', path);
    return path;
  } catch (err) {
    console.log('[Storage] Worker-ID upload failed:', err);
    return null;
  }
}
```

- [ ] Create `utils/crewScan.ts` — the client invoke wrapper for the edge fn + the magic-link invite helper:

```ts
import { supabase } from '@/lib/supabase';
import type { IdDocumentType } from '@/types';

export interface IdScanResult {
  fullName: string;
  idType: IdDocumentType;
  idNumberFull: string;
  dob: string;
  expiry: string;
  issuer: string;
}
export interface CertScanResult {
  certType: string;
  certNumber: string;
  issuer: string;
  issuedDate: string;
  expiresDate: string;
}

/** Call scan-credential with an inline base64 image (from expo-image-picker
 *  base64:true). Throws with a user-facing message on failure. */
export async function scanGovernmentId(imageBase64: string, mimeType = 'image/jpeg'): Promise<IdScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'government_id', imageBase64, mimeType },
  });
  if (error) throw new Error(error.message || 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as IdScanResult;
}

export async function scanCertification(imageBase64: string, mimeType = 'image/jpeg'): Promise<CertScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'certification', imageBase64, mimeType },
  });
  if (error) throw new Error(error.message || 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as CertScanResult;
}

/** Send a branded magic-link invite so a worker can claim their CrewMember.
 *  The redirectTo carries the claim token; app/claim-crew.tsx redeems it. */
export async function sendClaimInvite(email: string, claimToken: string): Promise<void> {
  const redirectTo = `rork-app://claim-crew?token=${encodeURIComponent(claimToken)}`;
  const { error } = await supabase.functions.invoke('auth-magic-link', {
    body: { email, redirectTo },
  });
  if (error) throw new Error(error.message || 'Could not send invite');
}
```

- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add utils/storage.ts utils/crewScan.ts`
- [ ] `git commit -m "Crew: scanGovernmentId/scanCertification invoke helpers + private worker-ids uploader + claim invite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 8 — Crew roster + member-detail screen + nav

Build `app/crew.tsx` as a single screen using the modal-in-screen pattern. **Mirror `app/punch-list.tsx`** for structure, theming, and the Paywall gate. This task ships the roster + add + member-detail modal; the ID-scan sub-flow (Task 9) and invite wiring (Task 10) extend the SAME file.

### Component spec (`app/crew.tsx`)

- **Imports** (mirror punch-list header): `React, useState, useCallback, useMemo`; RN `View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform, Modal, KeyboardAvoidingView`; `useSafeAreaInsets`; `useRouter, Stack` from expo-router; `* as Haptics`; lucide `Plus, X, ChevronLeft, ChevronRight, IdCard, ShieldCheck, UserCheck, ScanLine, Send, Trash2`; `useTheme`, `useThemedStyles`, `ThemeColors`; `useCrew` from `@/contexts/CrewContext`; `useProjects` (for project assignment picker + names); `useTierAccess`; `Paywall`; `EmptyState`; `Type`, `Tokens`; `generateUUID`; `verifiedBadge, certExpiryStatus` from `@/utils/crew`.
- **Top-level gate** (mirror punch-list lines 51-60): `const { canAccess } = useTierAccess(); if (!canAccess('crew_management')) return <Paywall visible feature="Crew Management" requiredTier="business" onClose={() => router.back()} />;`
- **State**: `crewMembers, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember` from `useCrew()`; `projects` from `useProjects()`; `detailId: string | null` (open member detail); `addOpen: boolean`; add-form fields `fullName`, `tradesText` (comma-split → `trades`), `phone`, `email`.
- **Header**: `<Stack.Screen options={{ title: 'Crew' }} />` + an in-screen header row with title "Crew" and a `Plus` FAB that opens the add modal.
- **Roster list**: `crewMembers.length === 0` → `<EmptyState icon={<IdCard .../>} title="No crew yet" message="Add your first crew member to build a verified roster." actionLabel="Add crew member" onAction={() => setAddOpen(true)} />`. Otherwise map cards: each shows `fullName`, `trades.join(' · ')`, and badges: when `verifiedBadge(m) === 'id_verified'` render a `ShieldCheck` amber chip "ID Verified"; when `m.claimedByUserId` render a `UserCheck` chip "Claimed". (Cert-expiry flags render in the detail once Wave B populates certs; the helper `certExpiryStatus` is imported and ready.) Tap → `setDetailId(m.id)`.
- **Add modal** (`Modal visible={addOpen} animationType="slide"`): title "Add crew member", `ChevronLeft`/`X` to close; `TextInput`s for name (required), trades (comma-separated), phone, email; Save builds a `CrewMember`:

```tsx
const handleAdd = useCallback(() => {
  if (!fullName.trim()) { Alert.alert('Name required'); return; }
  const now = new Date().toISOString();
  addCrewMember({
    id: generateUUID(),
    companyUserId: '', // CrewContext.toRow uses m.companyUserId; set by context via userId — see note
    createdAt: now, updatedAt: now,
    fullName: fullName.trim(),
    trades: tradesText.split(',').map(t => t.trim()).filter(Boolean),
    phone: phone.trim() || undefined,
    email: email.trim() || undefined,
    status: 'active',
    idVerified: false,
    isPublic: false,
    projectIds: [],
  });
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  setAddOpen(false); setFullName(''); setTradesText(''); setPhone(''); setEmail('');
}, [fullName, tradesText, phone, email, addCrewMember]);
```

> **companyUserId note:** the screen has no `userId`. Set `companyUserId` inside `CrewContext.addCrewMember` instead — update Task 3's `addCrewMember` to stamp `companyUserId: userId ?? ''` before persisting (`const stamped = { ...m, companyUserId: userId ?? m.companyUserId }`), and use `stamped` for setState/saveLocal/toRow. Make this edit when implementing this task and re-run `test:crew`/tsc. The screen passes `companyUserId: ''` as a placeholder the context overwrites.

- **Member-detail modal** (`Modal visible={detailId !== null}`): resolve `const member = detailId ? getCrewMember(detailId) : null;`. Sections:
  - Header: `ChevronLeft` back (`setDetailId(null)`), `fullName`, trades, status.
  - **Identity card**: ID-Verified badge (`ShieldCheck` + "ID Verified — {idIssuer} ····{idMaskedLast4}, exp {idExpiry}") when verified, else a muted "ID not verified" row with a **Scan ID** button (`ScanLine`) → Task 9 opens the scan sub-flow. Include the in-product disclaimer line: *"MAGE captures and attaches an ID. It does not legally verify identity or work eligibility."*
  - **Certifications**: a section titled "Certifications" that maps a (currently empty) list — add the comment `// Safety Wave B populates via Certification.workerId === member.id; render certExpiryStatus(cert.expiresDate, today) badges here.`
  - **Assigned projects**: chips of `projects.filter(p => member.projectIds.includes(p.id)).map(p => p.name)` + an "Assign to project" control that toggles a project id into `member.projectIds` via `updateCrewMember(member.id, { projectIds })`.
  - **Claim**: an **Invite to claim** button (`Send`) → Task 10. If `member.claimedByUserId`, show "Claimed" state instead.
  - **Delete**: `Trash2` → `Alert` confirm → `deleteCrewMember(member.id); setDetailId(null);`.
- **Styles**: `useThemedStyles` factory returning a `StyleSheet` keyed on `ThemeColors` (mirror punch-list). Badges use amber accent (`colors.accent`/`colors.accentSoft`), verified uses `colors.success`.

### Nav wiring

- [ ] Edit `components/DesktopSidebar.tsx`. Add `IdCard` to the lucide import (line 9 group). Add the NavItem to `NAV_ITEMS` in the NETWORK section (after the `contacts` entry, line 71):

```ts
  { key: 'crew',              label: 'Crew',             icon: IdCard,          route: '/crew',                             section: 'NETWORK', requires: 'crew_management' },
```

- [ ] Edit `app/_layout.tsx`. Register the route in the Stack (add near the other titled screens, e.g. after `contacts`):

```tsx
      <Stack.Screen
        name="crew"
        options={{
          title: "Crew",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
```

- [ ] In `app/_layout.tsx` `pathToDocumentTitle` `exact` map, add `'/crew': 'Crew',` (near the `/contacts` entry, ~line 103).
- [ ] `npx tsc --noEmit` (clean); `bun run test:crew` (still green after the CrewContext companyUserId edit).
- [ ] `git add app/crew.tsx components/DesktopSidebar.tsx app/_layout.tsx contexts/CrewContext.tsx`
- [ ] `git commit -m "Crew: roster + member-detail screen, sidebar entry, route + title; stamp companyUserId in context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 9 — ID-scan sub-flow (consent → capture → scan → review → save)

Extend `app/crew.tsx` with a nested modal state machine for the ID scan. Default = extract-then-purge (no image stored); opt-in retain uploads to `worker-ids`.

### Spec

- **New imports**: `* as ImagePicker from 'expo-image-picker'`; `useAuth` from `@/contexts/AuthContext`; `useSubscription` from `@/contexts/SubscriptionContext`; `checkAILimit, recordAIUsage` from `@/utils/aiRateLimiter`; `scanGovernmentId` from `@/utils/crewScan`; `uploadWorkerIdImage` from `@/utils/storage`; `maskIdLast4, computeIdVerified` from `@/utils/crew`; lucide `Camera, Image as ImageIcon, Check`.
- **State**: `scanStage: 'closed' | 'consent' | 'capture' | 'scanning' | 'review'`; `consentChecked: boolean`; `capturedUri: string | null`; `capturedBase64: string | null`; `scanFields` (editable copy of `IdScanResult`); `retainImage: boolean` (default false); `scanTargetId: string | null` (the member being scanned). Open from the detail "Scan ID" button: `setScanTargetId(member.id); setScanStage('consent');`.
- **Stage: consent** — a `Modal` with the exact copy checkbox: *"I have this person's consent to scan and store their ID information."* plus the disclaimer *"MAGE captures and attaches an ID. It does not legally verify identity or work eligibility."* The **Continue** button is disabled until `consentChecked`. No scan without it.
- **Stage: capture** — two buttons: **Take photo** (`ImagePicker.launchCameraAsync({ quality: 0.5, base64: true })`) and **Choose photo** (`ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true })`). Request permissions first (mirror `app/ai-punch.tsx` handlers). On pick, store `capturedUri = asset.uri`, `capturedBase64 = asset.base64`, then advance to scan:

```tsx
const runScan = useCallback(async () => {
  if (!capturedBase64) return;
  const { tier } = subscription; // useSubscription()
  const limit = await checkAILimit(tier, 'smart', 'scanCredential');
  if (!limit.allowed) {
    Alert.alert('Scan limit reached', limit.message ?? 'Upgrade to keep scanning.');
    return;
  }
  setScanStage('scanning');
  try {
    const fields = await scanGovernmentId(capturedBase64);
    await recordAIUsage('smart', 'scanCredential');
    setScanFields(fields);
    setScanStage('review');
  } catch (e) {
    Alert.alert('Scan failed', e instanceof Error ? e.message : 'Try a clearer, well-lit photo.');
    setScanStage('capture');
  }
}, [capturedBase64, subscription]);
```

> **Metering-granularity note (intentional):** the client pre-check above uses the DAILY limiter (`checkAILimit(tier, 'smart', 'scanCredential')`), while the server enforces a MONTHLY cap (`MONTHLY_CAPS[tier].scan_credential`, Task 6). These are different counters — a Business user can pass the daily pre-check yet still hit the server 429 after 60 scans in a month. This asymmetry is accepted here (unlike `ai_plan_review_monthly`, which mirrors the monthly counter client-side) BECAUSE the failure is fully surfaced: `scanGovernmentId` re-throws the server's `"Monthly credential-scan limit reached (…)"` message, which the `catch` in `runScan` shows verbatim via `Alert.alert('Scan failed', …)`. The daily pre-check is only a fast-path courtesy gate; the monthly cap is authoritative server-side. Do NOT "fix" this by branching on a daily counter — if a monthly client-side pre-check is ever wanted, mirror the `ai_usage_get` monthly-read pattern instead.

- **Stage: scanning** — a centered spinner + "Reading the ID…".
- **Stage: review** — editable `TextInput`s bound to `scanFields` (fullName, idType picker, idNumberFull, expiry, issuer). A **Retain original image** switch (`retainImage`, default OFF) with helper text *"Off = we keep only the masked last 4 and expiry; the photo is discarded."* **Save** runs the extract-then-purge policy:

```tsx
const handleSaveScan = useCallback(async () => {
  if (!scanTargetId || !scanFields) return;
  const { user } = auth;                       // useAuth()
  const maskedLast4 = maskIdLast4(scanFields.idNumberFull);
  const verified = computeIdVerified({ scanCompleted: true, userConfirmed: true });
  let idImagePath: string | undefined;
  if (retainImage && capturedUri && user?.id) {
    idImagePath = (await uploadWorkerIdImage(user.id, scanTargetId, capturedUri)) ?? undefined;
  }
  updateCrewMember(scanTargetId, {
    idVerified: verified,
    idType: scanFields.idType,
    idMaskedLast4: maskedLast4,
    idExpiry: scanFields.expiry || undefined,
    idIssuer: scanFields.issuer || undefined,
    idScannedAt: new Date().toISOString(),
    idImagePath, // undefined on the default purge path — raw image never uploaded
    // If the extracted name is non-empty and the record had a placeholder, keep the GC's name.
  });
  // Purge the in-memory raw number/image — never persisted.
  setCapturedBase64(null); setCapturedUri(null); setScanFields(null);
  setScanStage('closed'); setConsentChecked(false); setRetainImage(false);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [scanTargetId, scanFields, retainImage, capturedUri, auth, updateCrewMember]);
```

- **Security invariants to preserve** (call these out in code comments): the raw `idNumberFull` and `capturedBase64` are held only in component state, never written to `updateCrewMember` except via `maskIdLast4`; on the default path `idImagePath` stays `undefined` so nothing is uploaded; closing/cancelling any stage clears `capturedBase64`/`capturedUri`.
- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add app/crew.tsx`
- [ ] `git commit -m "Crew: ID-scan sub-flow (consent → capture → scan → review → save), extract-then-purge default + opt-in retain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 10 — Claim/invite flow (magic-link) + gated Hire-surfacing

### Invite (GC side) — extend `app/crew.tsx`

- **Imports**: `startClaimInvite` from `useCrew()`; `sendClaimInvite` from `@/utils/crewScan`.
- The detail modal's **Invite to claim** button:

```tsx
const handleInvite = useCallback(async () => {
  if (!member) return;
  if (!member.email) { Alert.alert('Email needed', 'Add an email to this crew member before inviting.'); return; }
  const token = startClaimInvite(member.id);
  if (!token) { Alert.alert('Could not start invite'); return; }
  try {
    await sendClaimInvite(member.email, token);
    Alert.alert('Invite sent', `${member.fullName} can now claim their profile from their email.`);
  } catch (e) {
    Alert.alert('Invite failed', e instanceof Error ? e.message : 'Try again.');
  }
}, [member, startClaimInvite]);
```

### Claim redemption route — `app/claim-crew.tsx`

- [ ] Create `app/claim-crew.tsx`. It reads `?token=` (`useLocalSearchParams`), waits for the magic-link session (the shared `MagicLinkHandler` in `_layout` sets the session from the URL hash), then calls `claimCrewMember(token, user.id)`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCrew } from '@/contexts/CrewContext';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';

// Worker claim redemption. Opened from the magic-link invite
// (rork-app://claim-crew?token=crew_...). MagicLinkHandler (app/_layout.tsx)
// establishes the session from the URL hash; once authenticated we redeem the
// claim token. Public destination — RootLayoutNav must NOT bounce it to /login
// before the session lands (added to the allow-list below).
export default function ClaimCrewScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { claimCrewMember } = useCrew();
  const [state, setState] = useState<'waiting' | 'done' | 'failed'>('waiting');

  useEffect(() => {
    if (!token) { setState('failed'); return; }
    if (!isAuthenticated || !user?.id) return; // wait for magic-link session
    const ok = claimCrewMember(token, user.id);
    setState(ok ? 'done' : 'failed');
  }, [token, isAuthenticated, user?.id, claimCrewMember]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Claim profile' }} />
      {state === 'waiting' && <><ActivityIndicator color={Colors.primary} /><Text style={styles.msg}>Confirming your profile…</Text></>}
      {state === 'done' && <Text style={styles.msg}>You’ve claimed your crew profile. You can now edit it and control your visibility.</Text>}
      {state === 'failed' && <Text style={styles.msg}>This invite link is invalid or already used. Ask the contractor to resend it.</Text>}
      {state !== 'waiting' && (
        <Text style={styles.link} onPress={() => router.replace('/')}>Go to app</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: 24, gap: 16 },
  msg: { fontSize: Type.body.fontSize, color: Colors.text, textAlign: 'center' },
  link: { fontSize: Type.body.fontSize, color: Colors.primary, fontWeight: '700' },
});
```

- [ ] Register the route in `app/_layout.tsx` Stack:

```tsx
      <Stack.Screen name="claim-crew" options={{ headerShown: false }} />
```

- [ ] In `app/_layout.tsx` `RootLayoutNav`, add `claim-crew` to the public magic-link destinations (mirror `prequal-form`, ~line 388/400). Add a const and include it in the early-return guard:

```tsx
    const inClaimCrew = segments[0] === 'claim-crew';
    ...
    if (inResetPassword || inPrequalForm || inIntegrationsCallback || inClaimCrew) return;
```

- [ ] In `pathToDocumentTitle` add `'/claim-crew': 'Claim profile',`.

### Gated Hire-surfacing

- [ ] Add a surfacing action to `contexts/CrewContext.tsx` that is WRITTEN BUT GATED — it must no-op while `HIRE_ENABLED` is false. Add the import and the callback, and include it in the returned object:

```tsx
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { shouldSurfaceToMarketplace, crewMemberToWorkerProfile } from '@/utils/crew';
```

```tsx
  // Marketplace surfacing — WRITTEN BUT GATED. Returns the mapped WorkerProfile
  // only when the member is public + claimed AND HIRE_ENABLED is on. Today
  // HIRE_ENABLED is false, so this always returns null. When the flag flips,
  // callers (a future Hire wiring) get a ready marketplace listing with the
  // ID-verified trust badge — no rebuild needed.
  const surfaceToMarketplace = useCallback((id: string) => {
    const member = crewMembers.find(m => m.id === id);
    if (!member) return null;
    if (!shouldSurfaceToMarketplace(member, HIRE_ENABLED)) return null;
    return crewMemberToWorkerProfile(member);
  }, [crewMembers]);
```

- [ ] Add `surfaceToMarketplace` to the `useMemo` return object + dependency array.
- [ ] `npx tsc --noEmit` (clean).
- [ ] `git add app/crew.tsx app/claim-crew.tsx app/_layout.tsx contexts/CrewContext.tsx`
- [ ] `git commit -m "Crew: magic-link claim invite + redemption route + gated marketplace surfacing (HIRE_ENABLED off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Final verification

- [ ] Run `bun run ship-check` — expect all validators (including `test:crew`, 38 passed) + `tsc` + `lint` clean.
- [ ] Confirm you did NOT: push, open a PR, run `apply_migration`/`db push`, create the `worker-ids` bucket, or `supabase functions deploy`. Those are owner-gated.
- [ ] Hand off: the owner applies `20260708130000_crew_members.sql`, creates the private `worker-ids` bucket (see `docs/deploy/2026-07-08-crew-worker-ids-bucket.md`), deploys `scan-credential`, THEN publishes the OTA (`eas update --branch production`). Migration + bucket + function must land before the OTA (PGRST204 gate).

## Requirement → task traceability

- CrewMember data model → Task 1. Certification.workerId anchor → noted in Task 1 (Wave B owns the record).
- Pure logic (masking, verified-badge, claim-token, cert-expiry, surfacing guard) + validator in ship-check → Task 2.
- CrewContext + provider mount + offline-first + retention-purge on delete → Task 3.
- Migration + schema.sql + owner-created worker-ids bucket note → Task 4.
- Tier gate (crew_management) + scan_credential monthly cap + client AI meter → Tasks 5 (+ used in 9).
- scan-credential edge fn (business gate, SSRF, metering, image never persisted) → Task 6.
- Client scan helpers + private path-only ID upload → Task 7.
- Roster + member-detail screen + nav (sidebar/route/title) → Task 8.
- ID-scan sub-flow (consent → capture → scan → review → save; extract-then-purge default + opt-in retain) → Task 9.
- Claim/invite via magic-link + gated Hire-surfacing → Task 10.
- Business-tier gated GC management; claimed-worker self-edit NOT gated → Task 5 (client) + Task 4 RLS (server) + Task 10 (claim path unges­ted).
