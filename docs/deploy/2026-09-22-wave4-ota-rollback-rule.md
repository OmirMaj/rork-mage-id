# Wave 4 OTA — do not roll it back to ab5bab13

**Rule:** once the wave-4 OTA is live, do NOT republish (roll back to) the
ab5bab13 bundle (OTA 03b6a946) or anything older without first shipping a
forward build whose offline flush sends or keeps `operation: 'rpc'` entries.

**Why.** Wave 4 records an invoice payment as ONE server-side append
(`invoice_append_payment`). Offline, that call is queued as an `rpc` entry in
`mageid_offline_queue`. The ab5bab13 flush (`utils/offlineQueue.ts` ~926-937)
has no `rpc` branch: an unknown operation leaves `error` null, is counted as
processed, and is removed at write-back. A rollback would therefore delete
every queued payment on every phone that had one, with no toast, no Not-saved
line and no Sentry event.

**What the wave-4 bundle already does about the next time.** Its flush keeps any
operation it does not recognise, unchanged, with the rest of its record
("Unknown operation — keeping it queued"), so a later rollback FROM a newer
bundle to this one loses nothing. That guard only protects rollbacks to builds
that contain it — ab5bab13 does not.

**If a rollback is unavoidable:** publish a forward bundle instead (revert the
offending change on top of the wave-4 code), never the old bundle.
