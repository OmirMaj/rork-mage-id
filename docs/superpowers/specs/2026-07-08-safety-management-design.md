# Safety Management — Design Spec

**Goal:** Give MAGE a full construction safety module (JHAs, toolbox talks, incident/near-miss reporting, hazard log, inspections/audits, certifications, and a reusable forms library) that field crews and PMs actually use daily, differentiated from competitors (JACK App) by AI drafting/detection — closing MAGE's biggest feature gap.

**Architecture:** A dedicated `SafetyContext` (`@nkzw/create-context-hook`) mounted under `ProjectProvider` in `app/_layout.tsx`, so the already-large `ProjectContext` doesn't grow further. Offline-first: every write goes through `utils/offlineQueue.ts` `supabaseWrite`; local state persists to `AsyncStorage` under new `tertiary_*` keys; `OfflineSyncManager` flushes on reconnect. Domain types live in `types/index.ts`. AI runs in new Supabase edge functions behind `requireTier` + metering. UI follows the modal-in-screen tile pattern (`app/safety.tsx` hub → section modals).

**Tech stack:** React Native / Expo (New Arch, OTA-safe — no new native modules), Expo Router typed routes, Supabase (RLS tables + edge functions, Deno), lucide-react-native icons, themed styles (`useThemedStyles`/`useTheme`), amber brand. Reuses existing vision/voice AI relays and the plan-pin infra shipped in `claude/feature-buildout`.

---

## Scope (v1 = "Everything", built in two waves)

**Wave A — daily field core (ship first):** JHAs, Toolbox Talks, Incidents/near-miss, Hazard Log, + the three AI functions.
**Wave B — compliance layer:** Inspections/Audits, Certifications tracking, reusable Forms Library, OSHA-300 export.

Each wave is independently shippable and independently valuable.

---

## Data model (new types in `types/index.ts`)

All records carry `id: string`, `projectId: string`, `createdAt: string`, `createdBy: string`, and (where mutated) `updatedAt`.

### `JobHazardAnalysis` — collection `tertiary_jhas`
- `title: string`, `trade: string`, `taskDescription: string`, `date: string`
- `steps: JHAStep[]` where `JHAStep = { id, step: string, hazards: string[], controls: string[] }`
- `requiredPPE: string[]`
- `signOffs: SafetySignoff[]` where `SafetySignoff = { name: string; role: string; subId?: string; signedAt: string }`
- `planSheetId?: string; pinX?: number; pinY?: number` (optional plan anchor — reuses punchlist pin infra)
- `aiGenerated: boolean`
- `status: 'draft' | 'active' | 'archived'`

### `ToolboxTalk` — collection `tertiary_toolbox_talks`
- `topic: string`, `date: string`, `presenter: string`, `notes: string`, `attachmentUrl?: string`
- `attendees: SafetyAttendee[]` where `SafetyAttendee = { name: string; subId?: string; signedAt?: string }`
- `aiTopicSource?: 'incident' | 'hazard' | 'weather' | 'manual'`

### `SafetyIncident` — collection `tertiary_safety_incidents`
- `type: 'injury' | 'near_miss' | 'property' | 'environmental'`
- `severity: 'low' | 'medium' | 'high' | 'critical'`
- `occurredAt: string`, `description: string`, `location: string`
- `planSheetId?: string; pinX?: number; pinY?: number` (plan anchor)
- `peopleInvolved: { name: string; role: string; injuryDescription?: string }[]`
- `photoUrls: string[]`
- `correctiveActions: { action: string; owner: string; dueDate?: string; done: boolean }[]`
- `oshaRecordable: boolean` (classified by pure fn — see Testing)
- `status: 'open' | 'investigating' | 'closed'`
- `reportedBy: string`

### `Hazard` — collection `tertiary_hazards`
- `description: string`, `location: string`, `photoUrl?: string`
- `severity: 1|2|3|4|5`, `likelihood: 1|2|3|4|5`, `riskScore: number` (severity×likelihood, computed)
- `planSheetId?: string; pinX?: number; pinY?: number`
- `assignedTo?: string`, `dueDate?: string`, `correctiveAction?: string`
- `status: 'open' | 'mitigated' | 'closed'`
- `sourceInspectionId?: string` (set when auto-spawned from a failed inspection item)

### `SafetyInspection` — collection `tertiary_safety_inspections`
- `templateId?: string`, `title: string`, `date: string`, `inspector: string`
- `items: InspectionItem[]` where `InspectionItem = { id; prompt: string; result: 'pass'|'fail'|'na'; note?: string; photoUrl?: string }`
- `score: number` (pass / (pass+fail), computed)
- A `fail` item offers "log as hazard" → creates a `Hazard` with `sourceInspectionId`.

### `Certification` — collection `tertiary_certifications` (person/sub-scoped, not project-scoped)
- `holderName: string`, `subId?: string`, `type: string` (OSHA 10/30, SST, CPR, trade license…)
- `issuedDate?: string`, `expiresDate?: string`, `documentUrl?: string`
- `status: 'valid' | 'expiring' | 'expired'` (computed from `expiresDate`; "expiring" = within 30 days)
- Links to existing `PrequalSafetyRecord` and `tertiary_subcontractors`.

### `SafetyFormTemplate` — collection `tertiary_safety_templates` (company-level)
- `name: string`, `category: 'jha' | 'inspection' | 'general'`, `fields: SafetyFormField[]`
- `SafetyFormField = { id; label: string; type: 'text'|'checkbox'|'select'|'signature'|'photo'; required: boolean; options?: string[] }`
- Lightweight builder — powers reusable inspection checklists + custom forms. No drag-drop builder in v1 (form defined by ordered field list).

### OSHA-300 log
Not a collection — a **computed report** (`utils/oshaLog.ts`) over `SafetyIncident` where `oshaRecordable === true`, exported to PDF/CSV in the OSHA-300 column layout.

---

## AI (new Supabase edge functions — Deno, behind `requireTier` + metering)

1. **`safety-generate-jha`** — input `{ trade, taskDescription, projectContext }` → returns `steps[]` (hazards + controls) + `requiredPPE[]`. User reviews/edits before save; sets `aiGenerated: true`. Metered under the text-AI daily caps (`utils/aiRateLimiter.ts`).
2. **`safety-detect-hazards`** — input a site photo (signed URL, validated via `_shared/urlGuard.ts`) → returns candidate hazards `{ description, severity, likelihood }[]` to prefill the Hazard log. Reuses the `analyze-photos` vision pattern; metered under vision `MONTHLY_CAPS`.
3. **`safety-draft-incident`** — input `{ voiceTranscript?, photoUrls?, notes }` → returns a structured `SafetyIncident` draft (description, type, severity, suggested corrective actions). Metered (text or vision depending on inputs).
4. **Toolbox-topic suggestion** — reuses the existing text relay (no new fn required): suggest talk topics from recent incidents/hazards/trade-on-site/weather.

All AI outputs are **suggestions the user confirms** — never auto-committed. Fail-closed: if the AI call fails, the user still has the manual form.

---

## Integration points

- **Plan viewer** (`app/plan-viewer.tsx`) — hazards and incidents can drop a plan pin using the `planSheetId`/`pinX`/`pinY` fields (same infra as punch items); add a `hazard`/`incident` pin kind to `PIN_COLORS`.
- **Daily reports** (`tertiary_daily_reports`) — DFR surfaces today's toolbox talk + open high-severity hazards; an incident can be created from the DFR.
- **Sub portal** (`marketing/sub-portal/`, `tertiary_sub_portal_links`) — subs sign toolbox talks + JHAs and submit certifications; ties to `PrequalSafetyRecord`.
- **Notifications** (`NotificationProvider`) — expiring certs, new recordable incidents, overdue hazard corrective actions.
- **Tier gating** — Safety module is **Business+** (`hooks/useTierAccess.ts` client gate; `requireTier(['business','enterprise'])` server gate). AI fns metered like other AI features.

---

## Screens (modal-in-screen tile pattern)

- **`app/safety.tsx`** — hub: tiles for JHAs, Toolbox Talks, Incidents, Hazard Log, Inspections, Certifications, Forms. Each tile opens a section modal with a `ChevronLeft` back button (per `app/project-detail.tsx` convention). Register in `app/_layout.tsx`; add to `DesktopSidebar` + tab/nav where appropriate (behind the Business gate).
- **Company-level views** — Certifications dashboard (expiring-soon list) and Forms library live at the company scope, reachable from the hub.
- Icons: lucide (`HardHat`, `ShieldAlert`, `ClipboardCheck`, `TriangleAlert`, `FileText`). No emoji.

---

## Error handling / offline

- All mutations via `supabaseWrite` (optimistic local + queued). Photo uploads follow the existing photo-upload path (`tertiary_photos`).
- AI failures degrade to manual entry (no dead-ends).
- Sign-offs are append-only; a signed JHA/talk is immutable except for archival status.

---

## Migrations (additive, owner-applied via Supabase MCP `apply_migration` — never `db push`)

New tables mirroring the collections above (snake_case), all RLS-scoped to the owning GC; `certifications` and `safety_templates` are company-scoped. Update `supabase/schema.sql` in the same change. Migration is additive/safe; apply before the OTA that writes these tables (same gate discipline as `punch_location`).

---

## Testing (pure-fn validators — repo has no jest — wired into `ship-check`)

- `scripts/validate-safety-risk.ts` — risk-matrix scoring (`riskScore = severity×likelihood`) + banding.
- `scripts/validate-safety-osha.ts` — `oshaRecordable` classification (injury type + treatment beyond first aid, days away, etc.).
- `scripts/validate-safety-cert.ts` — cert status from `expiresDate` (valid/expiring-within-30d/expired) with fixed reference date passed in.
- `scripts/validate-safety-inspection.ts` — inspection score + fail→hazard spawn.
Each tests a pure module in `utils/safety/*`. Add to the `ship-check` script.

---

## Out of scope (v1 / future)

- Drag-drop visual form builder (v1 uses ordered field lists).
- Automatic OSHA e-filing / ITA upload.
- Wearables / real-time location safety.
- Multi-language toolbox talks (P2).
