# Item 6 — Shared-Schedule Supabase-Snapshot URL Fallback — Design

Extends v2.3 wedge P1, which currently throws a typed `ShareTokenTooLargeError` when the base64 share token exceeds 6000 chars. Item 6 turns the typed error into a graceful fallback: write the schedule snapshot to a new `shared_schedule_snapshots` table and use a short row-id token instead of the full base64 payload.

**Status:** Design only. Implementation deferred to a fresh session. Item 6 of 8 in the 2026-05-20 audit-derived ship queue. Was the only item NOT executed inline because of the new-prod-migration + new-auth-perimeter risk.

Build target: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Live Supabase project `nteoqhcswappxxjlpvap`.

## 1. Problem

v2.3 P1 closed the silent-broken-URL bug by throwing `ShareTokenTooLargeError` when the token exceeds 6000 chars. The user-facing UX today: friendly Alert "Schedule too large to share via link — reduce the task count or use the sub-portal." That's a dead-end for large schedules.

The audit (T3 from `docs/superpowers/audits/2026-05-20-session-end-audit.md`) flagged the active version: write the payload to a new server-side table, generate a short ID, share that. Mirrors the proven `sub_portal_snapshots` pattern from S3-era work.

## 2. Architecture comparison vs `sub_portal_snapshots`

| Aspect | `sub_portal_snapshots` (existing) | `shared_schedule_snapshots` (new) |
|---|---|---|
| Auth model | GC creates with passcode; subs redeem via passcode | "Anyone with URL" — no passcode, but TTL-bounded |
| Write path | GC's authed client | GC's authed client (same as sub-portal) |
| Read path | Static portal HTML at `mageid.app/sub-portal/?id=…` | `app/shared-schedule.tsx` directly (RN route) |
| RLS | Owner-only write + passcode-gated read RPC | Owner-only write + public-token read RPC |
| Token model | UUID + 6-digit passcode | UUID (acts as bearer token; entropy = UUID space) |
| Expiry | None today | **REQUIRED**: 30-day default TTL via `expires_at` column + scheduled cleanup |

The new table is similar in shape but has a different security posture: the URL IS the secret. No passcode. TTL bounds the leak window.

## 3. Schema

```sql
create table public.shared_schedule_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payload jsonb not null,             -- the SharedSchedulePayload JSON
  task_count int not null,            -- denormalized for UI display
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_accessed_at timestamptz        -- for analytics / extend-TTL logic
);

create index shared_schedule_snapshots_user_idx
  on public.shared_schedule_snapshots (user_id, created_at desc);

create index shared_schedule_snapshots_expires_idx
  on public.shared_schedule_snapshots (expires_at)
  where expires_at > now();

alter table public.shared_schedule_snapshots enable row level security;

-- Owner-only insert/update/delete; no policy for SELECT (use the RPC instead).
create policy shared_schedule_snapshots_owner_write
  on public.shared_schedule_snapshots
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anyone (authed or anon) can read via the RPC, which enforces expiry.
create or replace function public.fetch_shared_schedule(
  snapshot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  select id, payload, expires_at
    into rec
    from shared_schedule_snapshots
   where id = snapshot_id
     and expires_at > now()
   limit 1;
  if not found then
    return null;
  end if;
  -- Best-effort touch for analytics; no-op if it fails.
  update shared_schedule_snapshots
     set last_accessed_at = now()
   where id = snapshot_id;
  return rec.payload;
end;
$$;

revoke all on function public.fetch_shared_schedule(uuid) from public;
grant execute on function public.fetch_shared_schedule(uuid) to anon, authenticated;
```

Pattern matches `portal_sign_contract` from the May 18 portal-write-rpc-hardening migration (the proven SECURITY DEFINER RPC pattern).

## 4. App-side changes

### 4.1 `utils/scheduleOps.ts` — fallback in `encodeShareToken`

The current throw becomes a TRY-DIRECT-FIRST: attempt the in-URL base64. If oversize, **don't throw** — caller should use the snapshot path instead. Best UX is to return a discriminated union:

```ts
export type ShareTokenResult =
  | { kind: 'inline'; token: string }
  | { kind: 'oversize'; tokenLength: number; maxLength: number };

export function tryEncodeShareToken(payload: SharedSchedulePayload): ShareTokenResult {
  // ... existing encoding logic ...
  const token = b64.replace(...);
  if (token.length > MAX_SHARE_TOKEN_LENGTH) {
    return { kind: 'oversize', tokenLength: token.length, maxLength: MAX_SHARE_TOKEN_LENGTH };
  }
  return { kind: 'inline', token };
}
```

Keep `encodeShareToken` + `ShareTokenTooLargeError` exports for v2.3-P1 callers (deprecate gradually). New callers use `tryEncodeShareToken`.

### 4.2 `app/schedule-pro.tsx` — fallback path on oversize

In `handleShare`:

```ts
const result = tryEncodeShareToken(payload);
let url: string;
if (result.kind === 'inline') {
  url = `/shared-schedule?t=${result.token}`;
} else {
  // Oversize — write snapshot to Supabase + use short ID.
  const { data, error } = await supabase
    .from('shared_schedule_snapshots')
    .insert({
      user_id: user.id,
      project_id: project.id,
      payload,                                // jsonb auto-serialized
      task_count: payload.tasks.length,
    })
    .select('id')
    .single();
  if (error || !data) {
    Alert.alert(
      'Could not save snapshot',
      `Try again or reduce the task count. (${error?.message ?? 'unknown error'})`
    );
    return;
  }
  url = `/shared-schedule?s=${data.id}`;       // note: `s=` not `t=`
}
```

Two URL params: `t=` for inline base64 (existing), `s=` for snapshot ID (new). The receiver tells them apart.

### 4.3 `app/shared-schedule.tsx` — read path

Currently:
```ts
const { t } = useLocalSearchParams<{ t?: string }>();
const payload = useMemo(() => (t ? decodeShareToken(String(t)) : null), [t]);
```

Extend to handle both:
```ts
const { t, s } = useLocalSearchParams<{ t?: string; s?: string }>();
const [payload, setPayload] = useState<SharedSchedulePayload | null>(null);
const [loadError, setLoadError] = useState<string | null>(null);

useEffect(() => {
  if (t) {
    const decoded = decodeShareToken(String(t));
    setPayload(decoded);
    if (!decoded) setLoadError('Invalid share link');
    return;
  }
  if (s) {
    void (async () => {
      const { data, error } = await supabase.rpc('fetch_shared_schedule', { snapshot_id: String(s) });
      if (error) { setLoadError(`Could not load snapshot: ${error.message}`); return; }
      if (!data) { setLoadError('Snapshot expired or not found'); return; }
      setPayload(data as SharedSchedulePayload);
    })();
    return;
  }
  setLoadError('No share parameter');
}, [t, s]);
```

### 4.4 Static sub-portal HTML — NO CHANGES

`marketing/sub-portal/index.html` doesn't share schedules — that's a separate path. Item 6 is mobile-app-only.

## 5. Security considerations

1. **URL IS the secret.** Snapshot UUID is 36 characters of entropy (~122 bits). Brute-force is intractable. Acceptable for "anyone with the URL" semantics.
2. **TTL** bounds the leak window. Default 30 days. Future: user-configurable per-share.
3. **No PII concerns beyond what's already in the schedule payload.** Schedule payloads include task names, dates, sub names — same info the inline base64 today carries. Moving from URL-payload to DB-payload doesn't change the exposure surface.
4. **Service-role bypass** of RLS happens inside `fetch_shared_schedule` (SECURITY DEFINER); the function itself enforces `expires_at > now()`. No direct table access for anon role.
5. **Quota / rate limiting** for snapshot creation — not designed in v1. A malicious user could spam the table. Mitigation: per-user row count check in the insert + Sentry alerting if a single user exceeds N snapshots/day. Defer to v2.

## 6. Cleanup / TTL enforcement

Two options:
- **pg_cron job** runs nightly to `delete from shared_schedule_snapshots where expires_at < now()`. Clean approach if pg_cron extension is enabled on this project (verify).
- **Lazy cleanup**: `fetch_shared_schedule` only returns non-expired rows; expired rows persist until manually pruned. Simpler but wastes storage.

Recommendation: pg_cron if available, lazy fallback if not. Both keep correctness; the difference is just storage hygiene.

## 7. Migration risk + reversibility

- **Additive only:** new table, new RPC, new policy. Reversible via `drop table shared_schedule_snapshots cascade; drop function fetch_shared_schedule(uuid);`. No existing data touched.
- **No app code break before deploy:** v2.3 P1's typed-error path keeps working. New fallback path activates only when callers switch to `tryEncodeShareToken`.

## 8. Implementation order (next session)

1. **Migration apply** via Supabase MCP: table + indexes + RLS + RPC. Verify via `execute_sql` SELECTs.
2. **`utils/scheduleOps.ts`**: add `ShareTokenResult` + `tryEncodeShareToken`. Keep `encodeShareToken` for back-compat.
3. **`app/schedule-pro.tsx`**: switch `handleShare` to `tryEncodeShareToken` + snapshot fallback. Add `s=` param to URLs on oversize.
4. **`app/shared-schedule.tsx`**: handle both `t=` and `s=` params. Add loading + error states.
5. **Test path**: build a 250-task schedule → tap Share → confirm: oversize path triggers, snapshot row created, `s=` URL works, receiver loads the snapshot.
6. **Ship**: FF-merge + push + OTA + (post-OTA) optional `eas update` if no native runtime changes.

## 9. Verification gates (per task)

- `npx tsc --noEmit` clean
- `execute_sql` confirms the new table + RPC + policy exist
- `execute_sql` confirms `fetch_shared_schedule` honors `expires_at`
- Manual: oversize schedule produces working snapshot URL; non-oversize keeps inline URL

## 10. Out of scope

- Per-share TTL controls (default 30d only)
- Snapshot rotation / regeneration
- Snapshot analytics dashboard (the `last_accessed_at` column enables future work but no UI in v1)
- Encrypted-at-rest snapshots (Supabase encrypts at rest by default; no extra layer)
- Sub-portal-style passcode protection on schedule shares (would need product spec)
