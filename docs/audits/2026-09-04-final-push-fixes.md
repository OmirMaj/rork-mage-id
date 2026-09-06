# Final-push fixes — what actually changed (branch `claude/final-push-fixes`)

Companion to `docs/audits/2026-09-03-final-push-audit.md` (211 findings). That
document says what was wrong. This one says what was done, what was left, and
what a reviewer should not have to rediscover.

Every task below was written by one implementer and then attacked by a separate
adversarial reviewer with no stake in the code. Several took three or four
rounds; the rounds are worth reading, because in four cases the *fix* was the
bug — the review caught a regression the implementer had just introduced.

Deploy steps are NOT here. They are in
`docs/deploy/2026-09-04-final-push-deploy.md`, and nothing in this branch has
been applied, deployed, pushed, or built.

---

## The four defects the reviews caught that the fixes introduced

Recording these first because they are the argument for the review pass.

1. **An editor could not save anything.** The first shared-project fix omitted
   `user_id` from the upsert to stop collaborators re-owning a row. Both tables
   declare it `NOT NULL`, and Postgres evaluates that before `ON CONFLICT`, so
   every editor write failed 23502 and the queue discarded it as terminal. The
   ownership freeze trigger already prevented re-owning; the upsert became a
   PATCH.
2. **An editor could null the owner's estimate.** With the money columns split
   across two tables, a collaborator whose `project_financials` read failed
   stored `estimate: null` locally and echoed it back on the next unrelated
   edit. Two rounds: the first fix covered the failed-read case, the second the
   pre-backfill case (no financials row yet, money still in the legacy column).
3. **A single successful token refresh signed the user out.** The new
   session-expiry guard counted rejections per *caller*, so ten concurrent
   requests hitting one rotated token tripped the chain and signed out a session
   that had just refreshed fine — in exactly the scenario the guard was for.
4. **A cross-tenant delete, twice.** The account-deletion rewrite keyed
   tenant-scoped deletes on a portal id the client mints. First round: spoof the
   id onto your own project and delete the victim's rows. Second round, after
   the resolver was added: the id is a *string* handed to a `.in()` filter, and
   `postgrest-js` quotes without escaping, so `x","<victim id>` splits into two
   values. Proved against live PostgREST, then closed with a charset gate,
   per-id equality filters, and two database check constraints.

---

## By task

### A1 — edge auth and the notify fan-out
`supabase/config.toml` (new, 62 functions) pins `verify_jwt` per function so a
redeploy stops silently resetting the gateway flag; four functions are live with
it wrong today and every cron fire since July has 401'd. `notify` gained a pure
guard module with real unit tests, a cron-secret trigger path, and three
authorisation fixes: a sub-portal access token could be steered by any signed-in
caller into an email they receive; RFP question text is now read from the stored
row rather than the caller's payload; a sub-invoice notification must name a row
the caller's own portal link owns. Anonymous portal callers must now present the
portal token — which means the static page has to ship *before* the function.

### A2 — the Stripe money loop
Payment links are single-use, carry their amount, and retire the link they
replace. The webhook claims each event before processing and releases it with a
token, credits net of unreleased retention, and no longer deactivates links that
are not ours. Migration `20260904100100` adds the columns; it is a hard gate,
because the new webhook names one of them in its credit update and would fail
every payment until it exists.

### A3 — edge hardening and AI honesty on the server
The embedding model was shut down by Google in January; replaced and the vector
width pinned. Unsubscribe tokens went from a non-cryptographic hash to a
purpose-bound HMAC, with a dated 30-day grace so links already in inboxes keep
working. Six functions that trusted a user id in the request body now verify the
JWT. Every AI relay meters fail-closed, charges only after the model answers,
has an upstream timeout, and returns a literal error code instead of the
upstream text. Two relays nobody had listed were found leaking raw model output
and brought onto the same shape. A relay that let any account mint an
unsubscribe token for any address was closed. Client IP keying moved off the
spoofable first proxy hop in five functions.

### A4 — database security and account deletion
Default execute privileges revoked with an explicit grant matrix; QBO OAuth
tokens locked to the service role; storage read/write bound to project
membership; portal tokens gained expiry and a rotation RPC; account deletion now
fails closed before it deletes anything, aborts before touching storage, and
resolves portal ids against the caller's own projects. The whole set was
executed twice against a scratch Postgres loaded from the production schema. A
trigger that mints portal tokens raises `42883` in production today because its
search path cannot see `gen_random_bytes`; that is repaired in the same batch.

### B1 — project state, money columns, and the provider tree
Tax rate 0 no longer coerces to 7.5. Outstanding balances and the paid flip are
net of unreleased retention everywhere. Collaborators no longer receive the
portal token and passcode. Child collections keep local-only rows when a server
read lands. Pending writes flush on background and on web page-hide. The role a
collaborator actually has now comes from the membership table rather than a JSON
list the invite flow never writes.

### B2 — the offline queue and the session boundary
The flush is bound to a session: every entry is tagged at enqueue, the session
is re-checked before every batch and every send, and a queue belonging to
someone else is never dispatched. A parent that is still queued no longer burns
its children's retry budget, and a parent that is doomed takes its children with
it — including their photos. The last-user marker is never stamped over a queue
that has not been narrowed first. Storage rejections while a project row is
still queued are retried, not discarded.

### B3 — the invoice and cost engines
Retention is netted consistently across invoices, aging, cash flow, WIP, the
PDF, the portal, and the 1099 export, with the 2026 threshold change carried and
2027 marked provisional rather than invented. Releasing retention on a settled
invoice reopens it and restarts the due-date clock, so the released money is
collectible without being instantly "30 days late". Platform fee copy comes from
one table instead of four hard-coded strings that were all wrong. Cost seeds
sync again: every upsert had been carrying a column the table does not have, so
production held zero of them and the cost book was device-only for everyone.

### B4 — dates, dead ends, and reachability
Three wrong-day defects: a month-end rollover written into warranty end dates, a
day-walk that broke across the November fall-back, and a duplicated day-number
helper that ignored jobsite closures. The desktop grid was the last surface
still blind to closures and now agrees with the engine. Ten features that
existed but could not be reached from the phone were given entries, and twelve
navigation parameters no screen reads were removed.

### B5 — AI honesty on the client
The grounding chip now counts exactly the facts that went into the prompt, on
every path including refinement, and says whether they were measured from closed
jobs or typed in by hand. A rate the contractor typed is never described as
history. The code-check flow stopped implying it looks anything up. Brain Watch
no longer shows "all clear" when the backend is unreachable.

---

## Guards

Every fix landed with a guard, and every guard runs. `validate-guard-coverage`
enforces that each `scripts/validate-*.ts` is reachable from `ship-check`; the
chain is 221 steps. Ten of the new guards were mutation-tested by their
reviewer — broken deliberately in a scratch copy to confirm they fail — because
a guard that cannot fail is worse than no guard.

The one guard that is slow is `test:native-surface`: it runs a real
`expo export` and greps the bundle for native modules the app does not declare.
That is the check that would have caught the build that rolled back silently.

## Not done, deliberately

- Four migrations are parked in `supabase/migrations/held/` with a README naming
  each precondition. Two are older; two are new. None may be swept up by a bulk
  push.
- `AUTH-F8` (portal token rotation) is server-side ready but has no client
  caller, and the owner's next project sync would push the old token back. It is
  not closed for users.
- The phase-2 column drop stays held until the OTA is verified on a device.
- The founder decisions from the audit are still founder decisions.
