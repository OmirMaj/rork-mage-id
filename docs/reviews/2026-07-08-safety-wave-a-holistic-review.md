# Safety Wave A — Holistic Review Findings (2026-07-08)

4-dimension adversarial review of the shipped Safety Wave A. 15 findings (3 HIGH, 6 MEDIUM, 6 LOW). Fix status tracked as they're closed.

## HIGH
1. **SafetyContext write-only sync** (`contexts/SafetyContext.tsx`) — hydrate reads ONLY AsyncStorage, never queries Supabase. Data loss on reinstall/new device (catastrophic for a compliance log); missing snake→camel load mapping. FIX: add Supabase select+map hydrate per collection (mirror ProjectContext punchItemsQuery), saveLocal+setState, fall back to local on error/!canSync.
2. **Non-namespaced storage keys + no logout clear** (`contexts/SafetyContext.tsx`) — global `tertiary_*` keys, never cleared on account switch. Cross-tenant leak on shared device. FIX: per-userId Supabase hydrate overwrites local; clear arrays on userId change/logout; namespace keys by userId.
3. **Signed JHAs/talks freely editable** (`app/safety-jha.tsx`, `app/safety-toolbox.tsx`) — openEdit ignores signOffs/attendees; handleSave overwrites signed records. Violates spec "sign-offs append-only, immutable except archival". FIX: block/guard edit when signOffs (JHA) or any attendee.signedAt (toolbox) exist.

## MEDIUM
4. **Hazard photo scan unusable in field** (`app/safety-hazards.tsx`) — only a manual URL-paste input; no camera/library picker. Server supports inline base64. FIX: add expo-image-picker capture → base64 → send.
5. **AI metering omits feature key / vision metered as text** (`app/safety-hazards.tsx`, `-jha`, `-incidents`) — checkAILimit(tier,'smart') with no feature arg; hazard vision call metered as generic text. FIX: pass feature keys consistent with app (e.g. 'photoAnalysis' for vision).
6. **createdBy/reportedBy always empty** (all safety screens) — none import useAuth; spec requires createdBy on every record. FIX: wire useAuth, populate createdBy (+reportedBy for incidents).
7. **Unvalidated AI enums persisted** (`app/safety-incidents.tsx`) — handleDraftAI sets type/severity from AI JSON with no union validation. FIX: validate against SafetyIncidentType/Severity unions, fall back.
8. **Edge meter before validation** (`supabase/functions/safety-detect-hazards/index.ts`) — aiUsageIncrement before input/count checks; malformed request burns quota. FIX: move increment after validation + goodPhotos>0.
9. **Wrong meter bucket** (`supabase/functions/safety-detect-hazards/index.ts`) — meters analyze_photos (shared w/ other features) vs dedicated safety_ai; client/server cap divergence. FIX: decide + align client/server (use safety_ai or document).

## LOW
- updateIncident drops reported_by (latent).
- Client safety AI gate uses daily counter not monthly (plan_code_review anti-pattern).
- aiUsageIncrement fails open (pre-existing shared infra).
- Meter not refunded on downstream Gemini failure.
- gemini .json() not wrapped in try/catch (all 3 fns) → uncaught throw, no CORS on 500.
- Increment-before-cap-check: denied retries still increment.
