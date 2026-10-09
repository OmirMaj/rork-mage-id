# Account Deletion And Signed Records

For the founder and his attorney. Written 2026-10-09 from the code (lane PROTECT-SERVER). Not legal advice. Nothing here has been decided; one safe change has been built and is described at the end.

## The Question

A contractor can delete his account from inside the app (Apple requires this). Some of what is deleted with it was signed by someone else: a client, a subcontractor, an owner's representative. Those people may need that record later, and the contractor is the one person who can erase it. What should be kept, for whom, and for how long?

## What Is Deleted Today

`supabase/functions/delete-account/index.ts` runs in four steps: read what the account owns, delete rows, delete files, delete the login. Signed records go in two ways.

**Deleted by name** (the function lists the table):

| Record | Table | Who signed | How it goes |
|---|---|---|---|
| Client's change order approval, with name, email, signature image, consent text and document fingerprint | `change_order_approvals` | The client, in the portal (or the contractor on the client's behalf on his own phone) | `TENANT_SCOPED_DELETES`, by portal id and by project id (`index.ts`, the entries for `change_order_approvals`) |
| Client's budget proposals and the portal decision log | `portal_budget_proposals`, `portal_decision_audit` | The client | Same list |
| Invoices a subcontractor submitted through the sub portal | `sub_submitted_invoices` | The subcontractor | Same list |
| Sealed final punch record (client signed in person) and its PDF and signature images | `punch_seals`, bucket `punch-seals` | The client, on the contractor's phone | `USER_SCOPED_TABLES` and the bucket sweep |
| Pay applications, including certified ones | `aia_pay_apps` | Contractor; architect certification where recorded | `USER_SCOPED_TABLES` |

**Deleted by a foreign key nobody wrote down** (the function does not name the table; the database removes the rows when the project or the login is deleted):

| Record | Table | Foreign keys (`supabase/schema.sql`) |
|---|---|---|
| Lien waivers, including ones a subcontractor signed through a signing link | `lien_waivers` | `project_id` to `projects` ON DELETE CASCADE (line 2388); `user_id` to `auth.users` ON DELETE CASCADE (line 2389) |
| Contracts and proposals signed by the homeowner and the contractor, and the signed PDF in `secure-contracts` | `project_contracts` | `project_id` CASCADE (2418); `user_id` CASCADE (2419) |
| Field tickets (time and material) signed by the owner's representative, on the contractor's own projects | `field_tickets` | `user_id` CASCADE (2376) |
| Change orders themselves | `change_orders` | `project_id` CASCADE (2343); `user_id` CASCADE (2344) |

So the answer to "what happens to lien waivers" is: every one of them is deleted, signed or not, by cascade. The earlier map could not tell; this is confirmed from the schema.

**Already kept today** (the function hands these over instead of deleting): work the departing person logged on someone else's job as a team member, including signed field tickets on that job. They move to the job's owner (`index.ts`, step 2-0).

**Not reached at all:** copies already downloaded, emailed PDFs, Stripe's payment records, anything the client saved from the portal.

## What A Deleted Record Leaves Behind Today

Nothing. After deletion there is no row, no file and no log entry that shows a client approved change order 4 on a given date. The client's only proof is whatever she saved herself.

## The Options

These are choices of policy. They are not mutually exclusive; A is built, B to E are not.

**A. Tombstones only (built, see below).** Keep no content. Keep one small row per signed record: what kind it was, its id, when it was signed, a fingerprint of it, and when the account was deleted. No names, no signatures, no amounts.
- Keeps: proof that a signed record existed and was deleted with the account on a date. If the client kept her own copy of the signed document, its fingerprint can be matched.
- For whom: anyone who can get MAGE ID to look (through support or legal process). No one can read it in the app.
- Does not help a client who kept no copy.
- Privacy Policy would say: "When an account is deleted we keep a record that a signed document existed (its type, its date and a fingerprint of it), with no names and no content."

**B. Keep the signed record itself, with the contractor's link removed, for a set period.** The approval or waiver row stays (signer name, signature, document fingerprint, signed time), detached from the deleted account and readable only by MAGE ID staff.
- Keeps: the client's or subcontractor's actual proof.
- For whom: the person who signed, on request, and anyone with legal process.
- Cost: it is personal data of the signer kept after the account that collected it is gone, so it needs a stated period, a stated reason and a way for the signer to ask for it or ask for its removal. The contractor's own deletion request is only partly honoured, and the policy must say so before he signs up.
- Privacy Policy would say: "Documents signed by another person (a client's approval, a subcontractor's lien waiver) are kept for N years after an account is deleted, so that the person who signed can still obtain their record. They are not shown to anyone else."
- Counsel sets N. Contract and lien claim limitation periods are the usual yardstick.

**C. Hand the record to the person who signed.** Before deleting, email each signer a copy (the signed PDF) at the address they signed with, then delete as today.
- Keeps: nothing at MAGE ID. The signer holds their own proof.
- Cost: an email to someone who may not expect it, sent because a third party deleted an account. Addresses can be stale. Needs wording from counsel. It also tells the client the contractor closed his account.
- Privacy Policy would say: "When an account is deleted, people who signed documents through it are sent a copy of what they signed."

**D. A waiting period before deletion.** The account is locked at once and removed after N days, during which signers can still open their portal or signing link and download their copy.
- Keeps: nothing in the end.
- Cost: Apple requires that deletion can be started in the app; a short, clearly stated delay is common, but counsel should confirm the wording. The current policy says "within 30 days", which leaves room.

**E. A legal hold switch.** A staff-only flag on an account that makes account deletion refuse while a dispute is known. Independent of A to D and worth having with any of them.
- Privacy Policy would say: "We may keep data we are legally required to keep, or that is subject to a legal hold."

## What Cannot Be Decided In Code

- How long (B, D).
- Whether a subcontractor's signed lien waiver is the contractor's data to delete at all, or a record of both parties.
- Whether deleting it while a dispute is foreseeable creates exposure for MAGE ID or only for the contractor.
- What the signer must be told at signing time about retention (it belongs in the "Terms For This Page" the build list calls for).
- Whether contractor-entered signatures (client approvals captured on the contractor's phone, paper waivers typed in by the contractor) are treated the same as ones the signer made themselves.

## The One Change Built Now

It changes nothing about what is deleted.

- Migration `supabase/migrations/20261009110000_signed_record_tombstones.sql`: table `public.signed_record_tombstones` and function `public.tombstone_signed_records(user id, project ids, portal ids)`.
- `delete-account` calls the function once, after it has worked out which projects and portals the account owns and before its first write (step 1b).
- One row per signed record: change order approvals (all decisions), signed lien waivers, contracts with any signature, field tickets with an authorization on the account's own projects, pay applications with a certification date, sealed punch records.
- Each row: record kind, record id, the client portal's id for approvals, the signed time, a SHA-256 of the row as it stood (the waiver's signing key left out), the record's own stored document fingerprint where it had one, a non-reversible marker of the deleted account, and the time the tombstone was written.
- No name, email, signature, amount, address or token is copied. The proof script checks that.
- Service role reads it. No one can change or delete a row. There is no retention job: the period is counsel's call.
- It is best effort. If the function is missing or fails, deletion goes ahead exactly as today and the response says tombstones were not written. A person's right to delete does not wait on a bookkeeping row.
- A tombstone is written at the start of the run. If the run stops before deleting, the record still exists; a tombstone proves deletion only together with the record's absence.

## What The Privacy Policy Says Today

`marketing/privacy.html:146`: "When you delete your account, your account, every project you own and the files you uploaded are permanently removed within 30 days." Under option A that sentence needs the one addition above. Under B it is no longer true as written.

Acceptance records are a separate, smaller case: `public.legal_acceptances` rows are kept after deletion with the account id removed and a non-reversible marker (migration `20261009100000_legal_acceptances.sql`). The policy should say: "We keep a record that the Terms and Privacy Policy were accepted, and when, after an account is deleted. It no longer identifies the account."
