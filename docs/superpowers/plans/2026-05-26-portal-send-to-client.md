# Send to Client Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit "Send to Client" workflow per portal-bound item (CO, Invoice, AIA, RFI, Submittal default Draft; Daily Report, Photo, Selection, Warranty default Sent with auto-share toggle), plus a project-level Client Outbox tray, plus first-view tracking on the public portal page.

**Architecture:** One shared `PortalState` type sprinkled optionally onto 9 existing item interfaces. Backward-compat rule: `portalState === undefined` ⇒ treated as Sent (so existing client portals don't lose any items overnight). Snapshot filter at `portalSnapshot.ts` reads `lastSentSnapshot` per item so edits-after-send never leak. Notifications reuse the existing `portal_messages` table + `portal_message` push notification type. New tiny `portal-mark-viewed` edge fn captures first-view timestamps from the public portal page.

**Tech Stack:** TypeScript strict, React Native + Expo Router, `@nkzw/create-context-hook` for `ProjectContext`, Supabase Postgres + RLS + Deno edge functions, `supabaseWrite` offline queue, existing `portal_messages` realtime channel.

**Per-task gate (NO unit runner):** `npx tsc --noEmit` clean at the worktree root + grep assertions after each task. Strict TS, no `any`. Do NOT deploy edge fns / apply migrations / `eas update` during the plan — ship is a separate batched step after the final whole-impl review. Worktree root: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`.

**Spec reference:** `docs/superpowers/specs/2026-05-26-portal-send-to-client-design.md`

---

## File Structure

- **Create (5 files):**
  - `components/PortalStatusPill.tsx` — shared pill (Draft / Sent / Viewed / Unsent edits / Recalled)
  - `components/SendToClientButton.tsx` — shared sticky action
  - `app/client-outbox.tsx` — Outbox screen
  - `supabase/functions/portal-mark-viewed/index.ts` — public viewed-at tracker
  - `supabase/migrations/20260527000000_portal_state_columns.sql` — additive jsonb columns + check constraints

- **Modify:**
  - `types/index.ts` — `PortalState` + `portalState?` on 9 interfaces + `ClientPortalSettings.autoShare` group
  - `utils/portalSnapshot.ts` — `isShared()` filter + `lastSentSnapshot` read at 9 sections
  - `contexts/ProjectContext.tsx` — set default `portalState` in 9 `add<Type>` callbacks; new actions `sendToClientPortal`, `recallFromClientPortal`, `batchSendToClientPortal`; expose Outbox query helpers
  - `app/change-order.tsx`, `app/invoice.tsx`, `app/aia-pay-app.tsx`, `app/rfi.tsx`, `app/submittal.tsx` — Tier 1 screens: drop pill + button
  - `app/daily-report.tsx`, `app/selection-category.tsx` (verify exists), `app/warranty-walk.tsx`, photo modal in `app/project-detail.tsx` — Tier 2 screens
  - `app/client-portal-setup.tsx` — Auto-share toggle group
  - `app/project-detail.tsx` — Client Outbox entry row
  - `app/_layout.tsx` — register `client-outbox` Stack screen
  - `marketing/portal/index.html` — call `portal-mark-viewed` on mount

**Field-shape notes the implementer needs:**
- `Project.clientPortal` (NOT `project.portal`) is the canonical settings field — typed as `ClientPortalSettings`.
- AIA item interface is named `SavedAIAPayApp` (NOT `AIAPayApplication`).
- ProjectContext callback for AIA is `addAIAPayApp` (NOT `addAIAPayApplication`).
- Photos have no separate `addPhoto` callback — they're added in the photo modal in `app/project-detail.tsx`. Find the existing add-photo path by grepping `tertiary_photos` or `ProjectPhoto`-shape writes; thread the `portalState` default through that path.
- `Selection` add callback location: search `contexts/ProjectContext.tsx` for `tertiary_selections` writes or the selections-engine; thread `portalState` default similarly.

---

## Task 1: Types — `PortalState` + 9 interface additions + `ClientPortalSettings.autoShare`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the shared `PortalState` interface near the top of the QBO-types section (search for `QboConnection` interface and insert just below it, or another sensible nearby grouping):**

```ts
/**
 * Per-item visibility + lifecycle state for the client portal.
 * `undefined` is treated as Sent by the snapshot filter (backward
 * compat — existing items pre-this-feature shouldn't disappear from
 * active client portals). New items get an explicit default per tier
 * (see Tier 1 / Tier 2 docs in the design spec).
 */
export interface PortalState {
  status: 'draft' | 'sent' | 'recalled';
  /** ISO timestamp of the most recent successful Send action. */
  sentAt?: string;
  /** First-view timestamp written by portal-mark-viewed edge fn. */
  viewedAt?: string;
  /** Increments on every Send. Used to detect unsent edits + clear
   *  viewedAt on re-send so the client should re-view the new
   *  revision. */
  sentVersion?: number;
  /** JSON snapshot of the item at last Send (capped at ~32KB).
   *  The portal renders THIS, not live state — so edits-after-send
   *  never leak to the client. */
  lastSentSnapshot?: string;
}

/**
 * Union of every item kind that participates in the Send-to-Client
 * workflow. Used by SendToClientButton, ProjectContext send/recall
 * actions, the Outbox screen, and the portal-mark-viewed edge fn.
 * Adding a new kind here is the first step for Phase 2 extensibility.
 */
export type SendableItemKind =
  | 'change_order' | 'invoice' | 'aia_pay_app'
  | 'rfi' | 'submittal'
  | 'daily_report' | 'photo' | 'selection' | 'warranty';
```

- [ ] **Step 2: Add `portalState?: PortalState` to each of the 9 affected interfaces. Locate by grep / line:**

Edit `types/index.ts` to add `portalState?: PortalState;` near the end of each of these interfaces (use grep + the line numbers below; place the new field with a one-line JSDoc next to other "qbo*" fields if they exist for consistency):

- `SelectionCategory` (~L376)
- `ChangeOrder` (~L1026)
- `Invoice` (~L1085)
- `SavedAIAPayApp` (~L1147)
- `DailyFieldReport` (~L1271)
- `ProjectPhoto` (~L1811)
- `RFI` (~L2259)
- `Submittal` (~L2306)
- `Warranty` (~L3072)

For each, add this two-line addition right before the interface's closing `}`:

```ts
  // Client portal send/recall lifecycle — Phase 1.
  portalState?: PortalState;
```

- [ ] **Step 3: Add `autoShare` to `ClientPortalSettings`:**

Find `interface ClientPortalSettings` in `types/index.ts` (grep for `showInvoices` will land near it). After the existing `showInvoices: boolean;` line and the other `show*` flags, add the new group:

```ts
  /**
   * Per-type auto-share defaults for Tier 2 items. When true, new items
   * of that type default to portalState.status='sent' on creation
   * (preserves current behavior). When false, new items default to
   * 'draft' and require explicit Send — joining Tier 1's workflow.
   * Undefined behaves as `true` (backward compat).
   */
  autoShare?: {
    dailyReports?: boolean;
    photos?: boolean;
    selections?: boolean;
    warranties?: boolean;
  };
```

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.

Run the grep verifications:
```bash
grep -c "portalState?: PortalState" types/index.ts
```
Expected: `9` (one per interface).

```bash
grep -n "^export interface PortalState\|autoShare?:" types/index.ts
```
Expected: 2 matches (PortalState declaration + autoShare field).

```bash
git add types/index.ts
git commit -m "feat(portal-send): add PortalState type + optional portalState on 9 item interfaces + autoShare toggles"
```

---

## Task 2: Migration — `portal_state` jsonb columns on 9 tables

**Files:**
- Create: `supabase/migrations/20260527000000_portal_state_columns.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 20260527000000_portal_state_columns.sql
-- Additive jsonb `portal_state` columns on every item type that participates
-- in the Send-to-Client workflow. All nullable; an absent column is treated
-- as Sent by the snapshot filter (backward-compat preserved). No backfill.
--
-- The autoShare toggle group lives inside the existing client_portal jsonb
-- on projects — no schema change needed for it.

alter table public.change_orders        add column if not exists portal_state jsonb;
alter table public.invoices             add column if not exists portal_state jsonb;
alter table public.aia_pay_applications add column if not exists portal_state jsonb;
alter table public.rfis                 add column if not exists portal_state jsonb;
alter table public.submittals           add column if not exists portal_state jsonb;
alter table public.daily_field_reports  add column if not exists portal_state jsonb;
alter table public.photos               add column if not exists portal_state jsonb;
alter table public.selections           add column if not exists portal_state jsonb;
alter table public.warranties           add column if not exists portal_state jsonb;

-- Defensive CHECK: the jsonb's `status` key (when present) must be one of
-- the three valid values. Mirrors the TypeScript union; protects against
-- bad writes via the supabase rest API. Allows null jsonb + jsonb without
-- a status key (grandfathered → Sent).
do $$
declare
  t text;
begin
  foreach t in array array[
    'change_orders','invoices','aia_pay_applications','rfis','submittals',
    'daily_field_reports','photos','selections','warranties'
  ] loop
    execute format($f$
      alter table public.%I drop constraint if exists %I;
      alter table public.%I add  constraint %I
        check (portal_state is null
               or not (portal_state ? 'status')
               or portal_state->>'status' in ('draft','sent','recalled'));
    $f$, t, t || '_portal_state_status_check', t, t || '_portal_state_status_check');
  end loop;
end $$;
```

(If any of those table names don't exist in this repo's schema, drop the corresponding `alter table` + skip its CHECK loop entry — verify by `grep -rn "create table.*\.\(change_orders\|invoices\|aia_pay_applications\|rfis\|submittals\|daily_field_reports\|photos\|selections\|warranties\)" supabase/schema.sql supabase/migrations/` before applying. The migration is idempotent via `if not exists` + `drop constraint if exists`.)

- [ ] **Step 2: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0 (no TS impact, but sanity-check repo-wide).
Run:
```bash
grep -c "add column if not exists portal_state jsonb" supabase/migrations/20260527000000_portal_state_columns.sql
```
Expected: `9`.

```bash
git add supabase/migrations/20260527000000_portal_state_columns.sql
git commit -m "feat(portal-send): additive portal_state jsonb columns on 9 item tables"
```

---

## Task 3: `portalSnapshot.ts` — `isShared` filter + `lastSentSnapshot` read at 9 sections

**Files:**
- Modify: `utils/portalSnapshot.ts`

- [ ] **Step 1: Add the helper near the top of `portalSnapshot.ts` (under the existing imports, before the first exported function):**

```ts
import type { PortalState } from '@/types';

/**
 * Per-item visibility gate. Undefined `portalState` is grandfathered as Sent
 * so existing client portals don't lose items overnight when this feature
 * ships. Explicit 'sent' status is also visible. 'draft' and 'recalled' hide.
 */
function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

/**
 * Returns the per-item serializable payload. If `lastSentSnapshot` is set
 * (post-Send), we render that exact snapshot — edits-after-send never leak.
 * Falls back to the live serializer for grandfathered items.
 */
function renderSerialized<T>(item: T & { portalState?: PortalState }, serialize: (i: T) => unknown): unknown {
  const snap = item.portalState?.lastSentSnapshot;
  if (snap) {
    try { return JSON.parse(snap); } catch { /* malformed snapshot → fall through */ }
  }
  return serialize(item);
}
```

- [ ] **Step 2: Apply `isShared` + `renderSerialized` at every section serializer**

For each of the 9 section blocks in the file (search for `portal.showInvoices`, `portal.showChangeOrders`, `portal.showDailyReports`, `portal.showRFIs`, `portal.showPhotos`, and the equivalents for AIA/Submittals/Selections/Warranties — locate each by grepping `if (portal\.show`):

**Before:**
```ts
if (portal.showInvoices && invoices.length) {
  sections.invoices = invoices.map(serializeInvoice);
}
```

**After:**
```ts
if (portal.showInvoices) {
  const visible = invoices.filter(i => isShared(i.portalState));
  if (visible.length) sections.invoices = visible.map(i => renderSerialized(i, serializeInvoice));
}
```

(The exact existing names of each serializer differ by section — match the pattern; replace `serializeInvoice` with whatever the existing block uses. If a section is rendered without an explicit `serialize*` function, inline the closure: `i => renderSerialized(i, (x) => /* existing inline shape */)`.)

Apply this transformation at all 9 sections. Sections without a `portal.show*` toggle (e.g., always-on schedule) are unaffected — `portalState` only gates the 9 listed item types.

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -c "isShared(" utils/portalSnapshot.ts
grep -c "renderSerialized(" utils/portalSnapshot.ts
```
Expected: at least 9 hits each (one filter + one map per section).

```bash
git add utils/portalSnapshot.ts
git commit -m "feat(portal-send): portalSnapshot filters by portalState + renders lastSentSnapshot"
```

---

## Task 4: Shared components — `PortalStatusPill` + `SendToClientButton`

**Files:**
- Create: `components/PortalStatusPill.tsx`
- Create: `components/SendToClientButton.tsx`

- [ ] **Step 1: Create `components/PortalStatusPill.tsx`**

```tsx
// Small status pill rendered next to existing status badges on every
// portal-aware item detail screen. One of: Draft / Sent / Viewed /
// Unsent edits / Recalled. The "Unsent edits" variant is derived from
// updatedAt > sentAt; not a stored status.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { PortalState } from '@/types';

interface Props {
  portalState?: PortalState;
  /** Item-level updatedAt — used to detect "Unsent edits" when
   *  updatedAt > sentAt on a Sent item. */
  itemUpdatedAt?: string;
}

const fmtDate = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
};
const fmtDateTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return ''; }
};

export function PortalStatusPill({ portalState, itemUpdatedAt }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Resolve display state.
  const s = portalState;
  const status = s?.status ?? 'sent'; // grandfathered (undefined) → Sent
  const unsentEdits = status === 'sent' && s?.sentAt && itemUpdatedAt &&
    new Date(itemUpdatedAt).getTime() > new Date(s.sentAt).getTime();

  if (status === 'draft') {
    return <View style={[styles.pill, { backgroundColor: colors.accent + '22' }]}>
      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      <Text style={[styles.label, { color: colors.accent }]}>Draft</Text>
    </View>;
  }
  if (status === 'recalled') {
    return <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
      <Text style={[styles.label, { color: colors.textMuted }]}>Recalled</Text>
    </View>;
  }
  if (unsentEdits) {
    return <View style={[styles.pill, { backgroundColor: '#F59E0B22' }]}>
      <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
      <Text style={[styles.label, { color: '#92400E' }]}>Unsent edits</Text>
    </View>;
  }
  if (s?.viewedAt) {
    return <View style={[styles.pill, { backgroundColor: '#3B82F622' }]}>
      <View style={[styles.dot, { backgroundColor: '#3B82F6' }]} />
      <Text style={[styles.label, { color: '#1E40AF' }]}>{`Viewed · ${fmtDateTime(s.viewedAt)}`}</Text>
    </View>;
  }
  // Sent (or grandfathered)
  return <View style={[styles.pill, { backgroundColor: colors.success + '22' }]}>
    <View style={[styles.dot, { backgroundColor: colors.success }]} />
    <Text style={[styles.label, { color: colors.success }]}>{s?.sentAt ? `Sent · ${fmtDate(s.sentAt)}` : 'Shared'}</Text>
  </View>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.pill,
    alignSelf: 'flex-start' as const,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, letterSpacing: 0.2 },
});
```

- [ ] **Step 2: Create `components/SendToClientButton.tsx`**

```tsx
// Sticky bottom action for portal-aware item detail screens. Renders
// the correct primary action based on portalState + unsent-edits
// state. Calls into ProjectContext for the actual send/recall mutations.

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Send, RotateCcw, Eye } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState, SendableItemKind } from '@/types';

interface Props {
  kind: SendableItemKind;
  itemId: string;
  projectId: string;
  portalState?: PortalState;
  itemUpdatedAt?: string;
  /** Optional client-side validation — disables Send when false. */
  canSend?: boolean;
  /** Optional tooltip shown when canSend=false. */
  canSendReason?: string;
}

export function SendToClientButton({ kind, itemId, projectId, portalState, itemUpdatedAt, canSend = true, canSendReason }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { sendToClientPortal, recallFromClientPortal } = useProjects();
  const [busy, setBusy] = useState(false);

  const status = portalState?.status ?? 'sent';
  const unsentEdits = status === 'sent' && portalState?.sentAt && itemUpdatedAt &&
    new Date(itemUpdatedAt).getTime() > new Date(portalState.sentAt).getTime();

  const doSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try { await sendToClientPortal({ kind, itemId, projectId }); }
    catch (e) { Alert.alert('Send failed', e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  }, [busy, kind, itemId, projectId, sendToClientPortal]);

  const doRecall = useCallback(() => {
    Alert.alert(
      'Recall from client?',
      'The client will see a message saying this item was removed. You can re-send later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Recall', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await recallFromClientPortal({ kind, itemId, projectId }); }
          catch (e) { Alert.alert('Recall failed', e instanceof Error ? e.message : 'Try again.'); }
          finally { setBusy(false); }
        }},
      ],
    );
  }, [kind, itemId, projectId, recallFromClientPortal]);

  if (status === 'draft' || status === 'recalled') {
    return (
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.primary, (busy || !canSend) && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy || !canSend}
          testID={`send-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : status === 'recalled' ? 'Re-send to Client' : 'Send to Client'}</Text>
        </TouchableOpacity>
        {!canSend && canSendReason ? <Text style={styles.hint}>{canSendReason}</Text> : null}
      </View>
    );
  }

  // Sent
  if (unsentEdits) {
    return (
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.primary, busy && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy}
          testID={`resend-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Re-send updated'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
          <RotateCcw size={14} color={colors.textMuted} />
          <Text style={styles.secondaryText}>Recall</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      <View style={styles.statusInline}>
        {portalState?.viewedAt ? <Eye size={14} color={colors.textMuted} /> : null}
        <Text style={styles.statusInlineText}>{portalState?.viewedAt ? 'Client viewed this' : 'Shared with client'}</Text>
      </View>
      <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
        <RotateCcw size={14} color={colors.textMuted} />
        <Text style={styles.secondaryText}>Recall</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.surface,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  primary: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
  secondary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.line,
  },
  secondaryText: { color: t.textMuted, fontSize: 13, fontWeight: '700' as const },
  statusInline: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  statusInlineText: { color: t.textMuted, fontSize: 13, fontWeight: '600' as const },
  hint: { fontSize: 11, color: t.textMuted, marginTop: 4 },
});
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` → EXIT 0.

```bash
git add components/PortalStatusPill.tsx components/SendToClientButton.tsx
git commit -m "feat(portal-send): PortalStatusPill + SendToClientButton shared components"
```

---

## Task 5: `ProjectContext` actions — `sendToClientPortal` / `recallFromClientPortal` / `batchSendToClientPortal`

**Files:**
- Modify: `contexts/ProjectContext.tsx`

- [ ] **Step 1: Implement the actions**

Find the location near other portal-related code in `ProjectContext.tsx` (search for `addChangeOrder`'s neighborhood, or near `tertiary_portal_messages` writes). Add these three callbacks:

```ts
// ── Client Portal Send / Recall / Batch ───────────────────────────────
//
// These actions mutate per-item portalState + write a notification row to
// portal_messages. The supabaseWrite offline queue handles network failures
// — the optimistic local mutation always lands; the server sync flushes
// when connectivity returns.
//
// Snapshot capture: we serialize the item to a JSON string capped at 32KB
// and stash it on portalState.lastSentSnapshot. portalSnapshot.ts reads
// this when present, so edits after Send never reach the client.

const MAX_SNAPSHOT_BYTES = 32_000;
// SendableItemKind is the canonical union — imported from types/index.ts.
// (Defined in Task 1 alongside the PortalState interface.)
import type { SendableItemKind } from '@/types';

interface SendArgs { kind: SendableItemKind; itemId: string; projectId: string; }

const captureSnapshot = (item: unknown): string => {
  try {
    const raw = JSON.stringify(item);
    return raw.length > MAX_SNAPSHOT_BYTES ? raw.slice(0, MAX_SNAPSHOT_BYTES) : raw;
  } catch { return ''; }
};

const itemTypeLabel: Record<SendableItemKind, string> = {
  change_order: 'Change Order', invoice: 'Invoice', aia_pay_app: 'AIA Pay Application',
  rfi: 'RFI', submittal: 'Submittal',
  daily_report: 'Daily Report', photo: 'Photo', selection: 'Selection', warranty: 'Warranty',
};

const tableForKind: Record<SendableItemKind, string> = {
  change_order: 'change_orders', invoice: 'invoices', aia_pay_app: 'aia_pay_applications',
  rfi: 'rfis', submittal: 'submittals',
  daily_report: 'daily_field_reports', photo: 'photos',
  selection: 'selections', warranty: 'warranties',
};

const sendToClientPortal = useCallback(async ({ kind, itemId, projectId }: SendArgs): Promise<void> => {
  // 1. Look up the item from the appropriate local list.
  const item = findItemByKindAndId(kind, itemId); // implement as a small switch over the lists
  if (!item) throw new Error(`Item not found: ${kind}/${itemId}`);

  // 2. Build the new portalState.
  const prevVersion = (item as { portalState?: PortalState }).portalState?.sentVersion ?? 0;
  const nextPortalState: PortalState = {
    status: 'sent',
    sentAt: new Date().toISOString(),
    sentVersion: prevVersion + 1,
    lastSentSnapshot: captureSnapshot(item),
    // Note: viewedAt cleared on re-send. New sends have no viewedAt.
  };

  // 3. Optimistic local mutation (same shape used elsewhere — see
  //    updateChangeOrder/updateInvoice for the existing pattern).
  updateItemPortalState(kind, itemId, nextPortalState);

  // 4. Persist to Supabase via the offline queue.
  if (canSync && userId) {
    void supabaseWrite(tableForKind[kind], 'update', {
      id: itemId,
      portal_state: nextPortalState,
      updated_at: new Date().toISOString(),
    });
  }

  // 5. Insert a portal_messages row so the client gets a push.
  if (canSync && userId) {
    void supabaseWrite('portal_messages', 'insert', {
      project_id: projectId,
      author_type: 'gc',
      body: `📋 New ${itemTypeLabel[kind]} from your builder. Tap to review.`,
      meta: { kind, itemId, sentVersion: nextPortalState.sentVersion },
      created_at: new Date().toISOString(),
    });
  }
}, [canSync, userId, findItemByKindAndId, updateItemPortalState]);

const recallFromClientPortal = useCallback(async ({ kind, itemId, projectId }: SendArgs): Promise<void> => {
  const item = findItemByKindAndId(kind, itemId);
  if (!item) throw new Error(`Item not found: ${kind}/${itemId}`);

  const prev = (item as { portalState?: PortalState }).portalState;
  const nextPortalState: PortalState = {
    ...prev,
    status: 'recalled',
  };
  updateItemPortalState(kind, itemId, nextPortalState);

  if (canSync && userId) {
    void supabaseWrite(tableForKind[kind], 'update', {
      id: itemId,
      portal_state: nextPortalState,
      updated_at: new Date().toISOString(),
    });
    void supabaseWrite('portal_messages', 'insert', {
      project_id: projectId,
      author_type: 'gc',
      body: `Your builder removed a previously shared ${itemTypeLabel[kind]} — please disregard.`,
      meta: { kind, itemId, recall: true },
      created_at: new Date().toISOString(),
    });
  }
}, [canSync, userId, findItemByKindAndId, updateItemPortalState]);

const batchSendToClientPortal = useCallback(async ({ items, projectId }: {
  items: { kind: SendableItemKind; itemId: string }[];
  projectId: string;
}): Promise<{ sent: number }> => {
  if (!items.length) return { sent: 0 };

  // Per-item mutate + supabase upsert.
  for (const { kind, itemId } of items) {
    await sendToClientPortal({ kind, itemId, projectId });
  }

  // ONE consolidated portal_messages row (overrides the per-item rows
  // sent inside the loop — collapse to a single push). Actually, the
  // per-item sendToClientPortal already inserted N rows; for the batch
  // case we prefer ONE summary row instead. To avoid duplicate spam,
  // batchSendToClientPortal SHOULD NOT call sendToClientPortal directly —
  // it should mutate state + write rows inline, then post one summary
  // portal_messages row at the end.

  return { sent: items.length };
}, [sendToClientPortal]);
```

(Implementation note for batch send: the inline version above calls `sendToClientPortal` in a loop, which would create N portal_messages rows. Rewrite `batchSendToClientPortal` to do the local mutations + supabase row updates in a loop, then write exactly ONE summary portal_messages row at the end. The pseudocode comments inside the function spell this out — the implementer should follow that approach.)

Also implement the two private helpers `findItemByKindAndId` and `updateItemPortalState` as small switches over the existing state lists (e.g., `changeOrders`, `invoices`, `aiaPayApps`, etc.) — they're a thin abstraction over the existing `update<Type>` patterns. The implementer can model them after the existing `getInvoice(id)` / `setInvoices` patterns already in the context.

- [ ] **Step 2: Expose the actions on the context return value**

Add `sendToClientPortal`, `recallFromClientPortal`, `batchSendToClientPortal` to the object returned by the `createContextHook` body so consumers can `useProjects().sendToClientPortal({...})`.

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -c "sendToClientPortal\|recallFromClientPortal\|batchSendToClientPortal" contexts/ProjectContext.tsx
```
Expected: at least 6 (3 definitions + 3 return-object entries; more if used internally).

```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(portal-send): send/recall/batchSend actions in ProjectContext + portal_messages dispatch"
```

---

## Task 6: Defaults — set `portalState` per tier in all 9 `add<Type>` callbacks

**Files:**
- Modify: `contexts/ProjectContext.tsx`

- [ ] **Step 1: Add a small helper near the top of the context function body (after the existing state declarations):**

```ts
// Default portalState for newly-created items.
// Tier 1 (CO/Invoice/AIA/RFI/Submittal): always Draft — explicit Send required.
// Tier 2 (Daily Report/Photo/Selection/Warranty): Sent unless the project's
//   per-type autoShare toggle is explicitly false.
const initialPortalState = useCallback(
  (kind: SendableItemKind, projectId: string): PortalState => {
    if (
      kind === 'change_order' || kind === 'invoice' || kind === 'aia_pay_app' ||
      kind === 'rfi' || kind === 'submittal'
    ) {
      return { status: 'draft' };
    }
    // Tier 2: respect per-project autoShare toggle (default ON).
    const proj = projects.find(p => p.id === projectId);
    const auto = proj?.clientPortal?.autoShare ?? {};
    const flagKey: Record<SendableItemKind, keyof NonNullable<typeof auto>> = {
      change_order: 'dailyReports', invoice: 'dailyReports', aia_pay_app: 'dailyReports',
      rfi: 'dailyReports', submittal: 'dailyReports',
      daily_report: 'dailyReports', photo: 'photos',
      selection: 'selections', warranty: 'warranties',
    };
    const enabled = auto[flagKey[kind]] !== false; // undefined → true
    return enabled ? { status: 'sent', sentAt: new Date().toISOString(), sentVersion: 1 } : { status: 'draft' };
  },
  [projects],
);
```

- [ ] **Step 2: Thread the default into each `add<Type>` callback**

For each existing callback below, set `portalState: initialPortalState(<kind>, <projectId>)` on the new item before writing it.

Edit `addChangeOrder` (~L1378):
```ts
const co: ChangeOrder = {
  ...input,
  portalState: initialPortalState('change_order', input.projectId),
  // ... existing fields
};
```

Edit `addInvoice` (~L1454):
```ts
portalState: initialPortalState('invoice', invoice.projectId),
```

Edit `addDailyReport` (~L1666):
```ts
portalState: initialPortalState('daily_report', report.projectId),
```

Edit `addRFI` (~L2364):
```ts
portalState: initialPortalState('rfi', rfi.projectId),
```

Edit `addAIAPayApp` (~L2498):
```ts
portalState: initialPortalState('aia_pay_app', app.projectId),
```

Edit `addSubmittal` (~L2563):
```ts
portalState: initialPortalState('submittal', sub.projectId),
```

Edit `addWarranty` (~L2848):
```ts
portalState: initialPortalState('warranty', w.projectId),
```

For **photos** and **selections** (no obvious `addPhoto`/`addSelection`): grep `contexts/ProjectContext.tsx` for the write callbacks that touch `ProjectPhoto` / `SelectionCategory`. Examples to grep for:
```bash
grep -n "ProjectPhoto\|SelectionCategory\|tertiary_photos\|tertiary_selections" contexts/ProjectContext.tsx
```

Thread `initialPortalState('photo', projectId)` / `initialPortalState('selection', projectId)` into those write paths.

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -c "initialPortalState(" contexts/ProjectContext.tsx
```
Expected: at least 10 (1 definition + 9 callbacks calling it).

```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(portal-send): default portalState per tier in 9 add<Type> callbacks"
```

---

## Task 7: Wire Tier 1 detail screens — CO, Invoice, AIA, RFI, Submittal

**Files:**
- Modify: `app/change-order.tsx`, `app/invoice.tsx`, `app/aia-pay-app.tsx`, `app/rfi.tsx`, `app/submittal.tsx`

For EACH of the 5 screens, do the same 3 changes. Pattern shown for `change-order.tsx` — repeat for the others, substituting the item kind + variable names.

- [ ] **Step 1: Import the two shared components**

At the top of each file, add (the existing imports likely already include several lucide icons + theme; insert after):

```ts
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
```

- [ ] **Step 2: Render the pill near existing status badges**

Find the spot near the top of the rendered detail (where the existing status badge / number lives). Add:

```tsx
<PortalStatusPill portalState={changeOrder.portalState} itemUpdatedAt={changeOrder.updatedAt} />
```

For each screen, substitute the local variable for the item (e.g., `invoice`, `aiaPayApp`, `rfi`, `submittal`). The pill renders inline; it picks its own spacing via `alignSelf: 'flex-start'`.

- [ ] **Step 3: Render the sticky Send button above the existing footer**

Find the screen's bottom sticky action area (each Tier 1 screen has one — search for "Send for approval" or similar primary buttons). Insert the SendToClientButton just above the existing sticky bar (or replace it if there's no other primary action; per-screen judgment).

```tsx
<SendToClientButton
  kind="change_order"
  itemId={changeOrder.id}
  projectId={changeOrder.projectId}
  portalState={changeOrder.portalState}
  itemUpdatedAt={changeOrder.updatedAt}
  canSend={changeOrder.lineItems.length > 0}
  canSendReason={changeOrder.lineItems.length === 0 ? 'Add at least one line item before sending.' : undefined}
/>
```

For each screen, substitute the local variable + kind. Validation rules per screen:
- `change_order` → `lineItems.length > 0`
- `invoice` → `lineItems.length > 0 && totalDue > 0`
- `aia_pay_app` → `status !== 'draft'` (or similar — match the existing send/lock semantics on AIA)
- `rfi` → `question.length > 0`
- `submittal` → `title.length > 0`

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -c "SendToClientButton" app/change-order.tsx app/invoice.tsx app/aia-pay-app.tsx app/rfi.tsx app/submittal.tsx
```
Expected: 5 hits (one per screen).

```bash
git add app/change-order.tsx app/invoice.tsx app/aia-pay-app.tsx app/rfi.tsx app/submittal.tsx
git commit -m "feat(portal-send): wire Send/Recall + status pill on 5 Tier 1 detail screens (CO/Invoice/AIA/RFI/Submittal)"
```

---

## Task 8: Wire Tier 2 detail screens + Auto-share toggle group

**Files:**
- Modify: `app/daily-report.tsx`, `app/selection-category.tsx` (locate via grep — see below), `app/warranty-walk.tsx`, photo modal in `app/project-detail.tsx`
- Modify: `app/client-portal-setup.tsx` (Auto-share toggle group)

- [ ] **Step 1: Wire the pill + button on Tier 2 detail screens**

Same as Task 7's Step 2 + 3 — drop in `<PortalStatusPill />` and `<SendToClientButton />` with the right `kind` + `itemId` + `projectId`.

- `app/daily-report.tsx` → `kind="daily_report"`. Validation: `notes.length > 0 || workItems.length > 0`.
- `app/warranty-walk.tsx` (or the warranty detail equivalent — confirm by grep) → `kind="warranty"`. Validation: `title.length > 0`.
- Selections: locate the detail screen via `grep -rln "SelectionCategory" app/`. Likely `app/selection-category.tsx` or `app/selections.tsx`. Drop in with `kind="selection"`. Validation: `options.length > 0`.
- Photos: photo detail is inside the photo modal in `app/project-detail.tsx`. Locate by grepping for `ProjectPhoto` usage in that file. The pill + button render inside the per-photo modal; with `kind="photo"`. Validation: always `true` (a photo is a photo).

- [ ] **Step 2: Add the Auto-share toggle group to `app/client-portal-setup.tsx`**

Locate `app/client-portal-setup.tsx`. Add a new settings group titled "AUTO-SHARE WITH CLIENT" near the existing portal-section toggles (search for `showInvoices` references). Each toggle binds to the project's `clientPortal.autoShare.<key>` field — fall back to `true` when undefined.

```tsx
<Text style={styles.sectionHeader}>AUTO-SHARE WITH CLIENT</Text>
<Text style={styles.sectionSubtext}>
  When ON, new items of that type are shared with your client the moment you save them.
  When OFF, new items go to your Outbox as Drafts — tap Send to share each one.
</Text>
<View style={styles.group}>
  {([
    ['Daily reports as I save them', 'dailyReports'],
    ['Photos as I upload them',      'photos'],
    ['Selection categories as I curate them', 'selections'],
    ['Warranty docs as I add them',  'warranties'],
  ] as const).map(([label, key]) => {
    const enabled = (project?.clientPortal?.autoShare?.[key] ?? true) === true;
    return (
      <View key={key} style={styles.row}>
        <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
        <Switch
          value={enabled}
          onValueChange={(v) => updateClientPortal({
            autoShare: { ...(project?.clientPortal?.autoShare ?? {}), [key]: v },
          })}
          trackColor={{ false: themeColors.line, true: themeColors.accent }}
        />
      </View>
    );
  })}
</View>
```

(The `updateClientPortal({ ... })` action exists in `client-portal-setup.tsx`'s current code — match the naming convention used by other settings rows in that file. If it doesn't exist as a partial-update helper, splice a setter that does `updateProject({ id, clientPortal: { ...project.clientPortal, autoShare: {...} } })`.)

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -c "SendToClientButton" app/daily-report.tsx app/warranty-walk.tsx app/project-detail.tsx
grep -n "AUTO-SHARE WITH CLIENT" app/client-portal-setup.tsx
```
Expected: at least 1 per screen + the AUTO-SHARE WITH CLIENT header hit.

```bash
git add app/daily-report.tsx app/warranty-walk.tsx app/project-detail.tsx app/client-portal-setup.tsx app/selection-category.tsx
git commit -m "feat(portal-send): wire Send/Recall on 4 Tier 2 screens + auto-share toggle group in client-portal-setup"
```

(If `app/selection-category.tsx` doesn't exist at that exact path, replace with the actual selections detail screen path found via grep.)

---

## Task 9: Client Outbox screen + project-detail entry row + Stack registration

**Files:**
- Create: `app/client-outbox.tsx`
- Modify: `app/project-detail.tsx` (entry row)
- Modify: `app/_layout.tsx` (Stack screen)

- [ ] **Step 1: Create `app/client-outbox.tsx`**

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Send, FileText, DollarSign, Camera, Image as ImageIcon, ListChecks, ClipboardList } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState } from '@/types';

type OutboxRow = {
  kind: 'change_order' | 'invoice' | 'aia_pay_app' | 'rfi' | 'submittal'
       | 'daily_report' | 'photo' | 'selection' | 'warranty';
  itemId: string;
  title: string;
  subtitle: string;
  isUnsentEdit: boolean;
};

export default function ClientOutboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const {
    getProject, batchSendToClientPortal,
    changeOrders, invoices, aiaPayApps, rfis, submittals,
    dailyReports, photos, selections, warranties,
  } = useProjects();
  const [busy, setBusy] = useState(false);

  const project = projectId ? getProject(projectId) : null;

  // Compute the draft + unsent-edit lists per type, then merge.
  const { drafts, unsent } = useMemo(() => {
    const filterFor = <T extends { id: string; projectId: string; portalState?: PortalState; updatedAt?: string }>(
      list: T[], kind: OutboxRow['kind'], buildRow: (i: T) => { title: string; subtitle: string },
    ): { drafts: OutboxRow[]; unsent: OutboxRow[] } => {
      const out = { drafts: [] as OutboxRow[], unsent: [] as OutboxRow[] };
      for (const i of list) {
        if (i.projectId !== projectId) continue;
        const ps = i.portalState;
        const { title, subtitle } = buildRow(i);
        if (ps?.status === 'draft' || ps?.status === 'recalled') {
          out.drafts.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: false });
        } else if (ps?.status === 'sent' && ps.sentAt && i.updatedAt &&
                   new Date(i.updatedAt).getTime() > new Date(ps.sentAt).getTime()) {
          out.unsent.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: true });
        }
      }
      return out;
    };

    const sections = [
      filterFor(changeOrders, 'change_order', co => ({ title: `Change Order #${co.number}`, subtitle: co.description || `+$${co.changeAmount}` })),
      filterFor(invoices,     'invoice',      inv => ({ title: `Invoice #${inv.number}`,  subtitle: `$${inv.totalDue}` })),
      // (Add the other 7 type rows by the same pattern — see implementation note below.)
    ];
    return sections.reduce(
      (acc, s) => ({ drafts: [...acc.drafts, ...s.drafts], unsent: [...acc.unsent, ...s.unsent] }),
      { drafts: [] as OutboxRow[], unsent: [] as OutboxRow[] },
    );
  }, [projectId, changeOrders, invoices, aiaPayApps, rfis, submittals, dailyReports, photos, selections, warranties]);

  const onSendAll = useCallback(async () => {
    if (busy || !drafts.length || !projectId) return;
    setBusy(true);
    try {
      const { sent } = await batchSendToClientPortal({
        items: drafts.map(d => ({ kind: d.kind, itemId: d.itemId })),
        projectId,
      });
      Alert.alert('Sent', `${sent} item${sent === 1 ? '' : 's'} sent to your client.`);
    } catch (e) {
      Alert.alert('Send failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, drafts, projectId, batchSendToClientPortal]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Client Outbox</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.sectionLabel}>{`DRAFTS · ${drafts.length}`}</Text>
        {drafts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in your Outbox</Text>
            <Text style={styles.emptySub}>New Change Orders, Invoices, RFIs, and Submittals start as Drafts. Drafts you haven't sent appear here.</Text>
          </View>
        ) : (
          <>
            {drafts.map(d => (
              <OutboxItemRow key={`${d.kind}-${d.itemId}`} row={d} colors={colors} onPress={() => router.push(routeForKind(d.kind, d.itemId) as any)} />
            ))}
            <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onSendAll} disabled={busy} testID="outbox-send-all">
              <Send size={16} color="#FFFFFF" />
              <Text style={styles.primaryText}>{busy ? 'Sending…' : `Send all ${drafts.length} to client`}</Text>
            </TouchableOpacity>
          </>
        )}

        {unsent.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>{`UNSENT EDITS · ${unsent.length}`}</Text>
            {unsent.map(d => (
              <OutboxItemRow key={`u-${d.kind}-${d.itemId}`} row={d} colors={colors} onPress={() => router.push(routeForKind(d.kind, d.itemId) as any)} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function OutboxItemRow({ row, colors, onPress }: { row: OutboxRow; colors: ThemeColors; onPress: () => void }) {
  const Icon = iconForKind(row.kind);
  return (
    <TouchableOpacity onPress={onPress} style={styles.itemRow} activeOpacity={0.7}>
      <View style={[styles.iconWrap, { backgroundColor: row.isUnsentEdit ? '#F59E0B22' : colors.accent + '22' }]}>
        <Icon size={16} color={row.isUnsentEdit ? '#D97706' : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{row.title}</Text>
        <Text style={styles.itemSub} numberOfLines={1}>{row.subtitle}</Text>
      </View>
      <Text style={[styles.statusInline, { color: row.isUnsentEdit ? '#D97706' : colors.accent }]}>{row.isUnsentEdit ? 'Edited' : 'Draft'}</Text>
    </TouchableOpacity>
  );
}

const iconForKind = (k: OutboxRow['kind']) => {
  switch (k) {
    case 'change_order': return FileText;
    case 'invoice': return DollarSign;
    case 'aia_pay_app': return DollarSign;
    case 'rfi': return ClipboardList;
    case 'submittal': return ClipboardList;
    case 'daily_report': return ClipboardList;
    case 'photo': return Camera;
    case 'selection': return ImageIcon;
    case 'warranty': return ListChecks;
  }
};
const routeForKind = (k: OutboxRow['kind'], id: string): string => {
  switch (k) {
    case 'change_order': return `/change-order?id=${id}`;
    case 'invoice':      return `/invoice?id=${id}`;
    case 'aia_pay_app':  return `/aia-pay-app?id=${id}`;
    case 'rfi':          return `/rfi?id=${id}`;
    case 'submittal':    return `/submittal?id=${id}`;
    case 'daily_report': return `/daily-report?id=${id}`;
    case 'photo':        return `/project-detail?focusPhoto=${id}`;
    case 'selection':    return `/selection-category?id=${id}`;
    case 'warranty':     return `/warranty-walk?id=${id}`;
  }
};

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line },
  backBtn: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  title: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  sectionLabel: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10 },
  emptyCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 20, alignItems: 'center' as const, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '800' as const, color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted, textAlign: 'center' as const, lineHeight: 19 },
  itemRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: t.surface, borderRadius: Tokens.radius.card, marginBottom: 8 },
  iconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
  itemTitle: { fontSize: 15, fontWeight: '700' as const, color: t.text },
  itemSub: { fontSize: 13, color: t.textMuted, marginTop: 1 },
  statusInline: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  primary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 12, paddingVertical: 13, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
});

const styles = makeStyles({} as ThemeColors); // placeholder for icon helper file-scope; the real `styles` comes from useThemedStyles inside the component
```

Note: the file-scope `styles` at the bottom is a TS-ergonomic accident — the real styles come from `useThemedStyles(makeStyles)` inside `ClientOutboxScreen`. If your eslint config dislikes the dead `styles` const at file scope, refactor the helper components to take `styles` as a prop or move them into `ClientOutboxScreen`. The implementer's call.

(Implementation note: the `useMemo` block only assembles 2 of 9 types — implement the remaining 7 (`aiaPayApps`, `rfis`, `submittals`, `dailyReports`, `photos`, `selections`, `warranties`) using the same `filterFor` helper. Match the existing field names from the relevant type interface for `title` and `subtitle` — for example, `rfi.subject` if it exists, else `rfi.question.slice(0, 60)`.)

- [ ] **Step 2: Add the Outbox entry row to `app/project-detail.tsx`**

Find a spot near the existing Portal Messages row (search for `portalMessagesRow`). Add (somewhere near the top of the project's content area):

```tsx
{outboxCount > 0 ? (
  <TouchableOpacity
    style={styles.portalMessagesRow}
    onPress={() => router.push(`/client-outbox?projectId=${project.id}` as any)}
    testID="client-outbox-entry"
  >
    <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
      <Send size={14} color="#fff" />
    </View>
    <Text style={styles.portalMessagesText}>{`Client Outbox · ${outboxCount} draft${outboxCount === 1 ? '' : 's'}`}</Text>
    <Text style={styles.portalMessagesOpen}>Open ›</Text>
  </TouchableOpacity>
) : null}
```

Compute `outboxCount` near the top of the component:
```tsx
const outboxCount = useMemo(() => {
  const isDraft = (s?: PortalState) => s?.status === 'draft' || s?.status === 'recalled';
  const isUnsentEdit = (s?: PortalState, updatedAt?: string) =>
    s?.status === 'sent' && s.sentAt && updatedAt && new Date(updatedAt).getTime() > new Date(s.sentAt).getTime();
  const inProject = <T extends { projectId: string; portalState?: PortalState; updatedAt?: string }>(arr: T[]) =>
    arr.filter(x => x.projectId === project.id && (isDraft(x.portalState) || isUnsentEdit(x.portalState, x.updatedAt))).length;
  return (
    inProject(changeOrders) + inProject(invoices) + inProject(aiaPayApps) +
    inProject(rfis) + inProject(submittals) +
    inProject(dailyReports) + inProject(photos) + inProject(selections) + inProject(warranties)
  );
}, [project.id, changeOrders, invoices, aiaPayApps, rfis, submittals, dailyReports, photos, selections, warranties]);
```

- [ ] **Step 3: Register the Stack screen**

In `app/_layout.tsx`, find the existing `<Stack.Screen ... />` declarations (near the other screens like `qbo-setup`). Add:

```tsx
<Stack.Screen name="client-outbox" options={{ headerShown: false }} />
```

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → EXIT 0.
Run:
```bash
grep -n "client-outbox" app/_layout.tsx app/project-detail.tsx
```
Expected: at least 2 hits.

```bash
git add app/client-outbox.tsx app/project-detail.tsx app/_layout.tsx
git commit -m "feat(portal-send): Client Outbox screen + project-detail entry row + Stack registration"
```

---

## Task 10: `portal-mark-viewed` edge fn + portal HTML integration

**Files:**
- Create: `supabase/functions/portal-mark-viewed/index.ts`
- Modify: `marketing/portal/index.html`

- [ ] **Step 1: Create the edge function**

```ts
// supabase/functions/portal-mark-viewed/index.ts
//
// Public endpoint (no JWT). Called from the static portal page on mount
// with the visible item IDs. Validates the portal accessToken (same trust
// root as portal_sign_contract / portal_choose_selection), then writes
// portal_state.viewed_at on each item — only when null (first-view-only).
//
// Trust root: the access token gates which portal_id the caller can touch.
// We never trust an item_id without confirming it belongs to the matching
// project. RLS isn't applicable here (service-role client + custom auth).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Kind = 'change_order'|'invoice'|'aia_pay_app'|'rfi'|'submittal'|'daily_report'|'photo'|'selection'|'warranty';
const TABLE: Record<Kind, string> = {
  change_order: 'change_orders', invoice: 'invoices', aia_pay_app: 'aia_pay_applications',
  rfi: 'rfis', submittal: 'submittals', daily_report: 'daily_field_reports',
  photo: 'photos', selection: 'selections', warranty: 'warranties',
};

interface Body { portalId: string; accessToken: string; items: { kind: Kind; id: string }[] }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: 'svc not configured' }, 500);

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return json({ success: false, error: 'Bad JSON' }, 400); }
  if (!body.portalId || !body.accessToken || !Array.isArray(body.items)) {
    return json({ success: false, error: 'Missing portalId / accessToken / items' }, 400);
  }
  if (body.items.length > 200) return json({ success: false, error: 'Too many items' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Look up the project by portal_id + verify access token.
  const { data: project, error: projErr } = await svc
    .from('projects')
    .select('id, client_portal')
    .eq('client_portal->>portal_id', body.portalId)
    .maybeSingle();
  if (projErr) return json({ success: false, error: 'project lookup failed' }, 500);
  if (!project) return json({ success: false, error: 'unknown portal' }, 404);

  const portalAccessToken = (project as { client_portal?: { access_token?: string } }).client_portal?.access_token;
  if (!portalAccessToken || portalAccessToken !== body.accessToken) {
    return json({ success: false, error: 'invalid access token' }, 401);
  }

  // 2. For each item: scoped update — only set viewed_at when null
  //    AND the row belongs to this project.
  const nowIso = new Date().toISOString();
  let updated = 0;
  for (const it of body.items) {
    const tbl = TABLE[it.kind];
    if (!tbl) continue;
    // jsonb_set on portal_state with first-view-only guard.
    const { error: updErr } = await svc.rpc('portal_mark_item_viewed', {
      p_table_name: tbl,
      p_item_id: it.id,
      p_project_id: project.id,
      p_now: nowIso,
    }).single();
    if (!updErr) updated += 1;
  }

  return json({ success: true, updated });
});
```

The above relies on a tiny SQL helper RPC `portal_mark_item_viewed` to do the "only-when-null" first-view-only write across 9 tables in a uniform way (each table has the same `portal_state` jsonb column). Add it to the same migration file from Task 2 (or a new follow-up migration if Task 2 is already committed):

```sql
-- Append to 20260527000000_portal_state_columns.sql (or a follow-up migration):
create or replace function public.portal_mark_item_viewed(
  p_table_name text,
  p_item_id    text,
  p_project_id text,
  p_now        timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
begin
  if p_table_name not in (
    'change_orders','invoices','aia_pay_applications','rfis','submittals',
    'daily_field_reports','photos','selections','warranties'
  ) then
    raise exception 'invalid table %', p_table_name;
  end if;
  q := format($q$
    update public.%I
    set portal_state = jsonb_set(
      coalesce(portal_state, '{}'::jsonb),
      '{viewedAt}',
      to_jsonb(%L::timestamptz),
      true
    )
    where id::text = %L
      and project_id::text = %L
      and (portal_state is null or not (portal_state ? 'viewedAt') or portal_state->>'viewedAt' is null)
  $q$, p_table_name, p_now, p_item_id, p_project_id);
  execute q;
end $$;

grant execute on function public.portal_mark_item_viewed(text, text, text, timestamptz) to service_role;
```

(Defensive: the table-name allowlist prevents SQL injection via the dynamic `format()`. Service-role-only grant — the edge fn calls it through service role.)

- [ ] **Step 2: Wire the portal page (`marketing/portal/index.html`) to call this on mount**

Find where the portal page parses its query params and renders sections. After the page successfully loads its payload, queue a small fire-and-forget POST:

```js
// In the portal's JS, after the payload renders:
(function markViewed() {
  try {
    const id = new URL(location.href).searchParams.get('id');
    const token = new URL(location.href).searchParams.get('t') || sessionStorage.getItem('portal_t');
    if (!id || !token) return;
    // Collect visible item IDs from the rendered sections.
    const items = [];
    const collect = (kind, sel) => document.querySelectorAll(sel).forEach(el => {
      const itemId = el.getAttribute('data-item-id');
      if (itemId) items.push({ kind, id: itemId });
    });
    collect('change_order', '[data-section="change-orders"] [data-item-id]');
    collect('invoice',      '[data-section="invoices"] [data-item-id]');
    collect('aia_pay_app',  '[data-section="aia"] [data-item-id]');
    collect('rfi',          '[data-section="rfis"] [data-item-id]');
    collect('submittal',    '[data-section="submittals"] [data-item-id]');
    collect('daily_report', '[data-section="daily-reports"] [data-item-id]');
    collect('photo',        '[data-section="photos"] [data-item-id]');
    collect('selection',    '[data-section="selections"] [data-item-id]');
    collect('warranty',     '[data-section="warranties"] [data-item-id]');
    if (!items.length) return;
    fetch('https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/portal-mark-viewed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalId: id, accessToken: token, items }),
    }).catch(() => { /* fire-and-forget; UX is unaffected if it fails */ });
  } catch { /* never block the portal render */ }
})();
```

(The implementer should verify the section data attributes exist on the rendered DOM; if not, add `data-section` + `data-item-id` to each rendered section in `marketing/portal/index.html`. Match the existing rendering pattern — the portal already has structured per-item rendering for change orders / invoices / etc.)

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` → EXIT 0.

```bash
git add supabase/functions/portal-mark-viewed/index.ts marketing/portal/index.html supabase/migrations/20260527000000_portal_state_columns.sql
git commit -m "feat(portal-send): portal-mark-viewed edge fn + RPC helper + portal HTML beacon"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` clean across the whole repo.
- [ ] `bun run lint` — no new errors (existing lint clean state preserved).
- [ ] **Whole-implementation review** (opus): correctness of `portalState` defaults per tier, no token / PII leakage in portal-mark-viewed (it doesn't see any), RLS owner-scoping on the inner UPDATEs in the RPC (table-name allowlist + project_id scope), `lastSentSnapshot` truncation safety, batch send produces exactly ONE portal_messages row (not N), Tier 2 auto-share toggle interaction with per-item Recall is correct. **No P0/P1 = ship.**
- [ ] **Ship** (separate batched step, NOT during plan execution):
  - Apply migration `20260527000000_portal_state_columns.sql` via Supabase MCP `apply_migration`.
  - Deploy edge fn `portal-mark-viewed` (`--no-verify-jwt`, public endpoint, trust root is the portal access_token).
  - OTA prod + preview channels.
  - Deploy `marketing/portal/index.html` to Netlify via `netlify deploy --dir` (requires user-supplied Netlify PAT).
  - Manual walkthrough: spec §"Testing & ship gates" 6-step sequence.

## Known acceptable deferments (documented in spec)

- Revision history UI (visible CO #4 v1/v2/v3 to contractor) — `sentVersion` captured for future use, not surfaced in this phase.
- Client-side acknowledgment buttons — existing approval RPCs cover their cases.
- Per-photo Send override within a batch — toggle off photos auto-share instead.
- Public portal email digest (daily/weekly) — later phase if needed.

## Notes for future Phase 2

To add a new item type (e.g., "Inspection Reports") to this workflow later:

1. Add `portalState?: PortalState` to the interface in `types/index.ts`.
2. Add the table to the migration column list + `portal_mark_item_viewed` allowlist.
3. Add the filter in `portalSnapshot.ts`.
4. Drop the pill + button in the detail screen.
5. Set the default in the `add<Type>` callback in `ProjectContext.tsx`.
6. Add the kind to `SendableItemKind`, `tableForKind`, `itemTypeLabel`, the Outbox `filterFor` block, and `routeForKind` / `iconForKind`.

~30 minutes per new type. The `PortalState` shape itself stays untouched.
