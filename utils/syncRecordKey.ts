// utils/syncRecordKey.ts — which RECORD a queued / refused write belongs to.
//
// One rule for utils/offlineQueue's record slot, the flush's per-record group,
// the queue's ordering guard AND utils/syncLedger's Not-saved lines (park,
// fold, Retry, Discard all act on "the record"). A leaf module on purpose: no
// imports, so the bun validators run the real rule.

/**
 * Tables whose primary key is NOT `id` → the column that IS the key. Every
 * other table is keyed on `id` alone.
 *
 * Integration round 3: this used to be one chain for every table (id, then
 * project_id, then portal_id, then sub_portal_id). Rows that carry project_id
 * but are keyed on something else were all "one record" per job: the GC's
 * id-less system notices to the homeowner (portal_messages) — one refused
 * notice parked every later notice of the job, and Discard of it threw them
 * all away — and sub_portal_snapshots (keyed on sub_portal_id, but carrying
 * project_id first in the chain) — the plumber's page upsert FOLDED over the
 * electrician's refused page, so the electrician's page never reached MAGE.
 * Keyed per table, a row is only ever the same record as a row with its own
 * primary key.
 */
export const RECORD_KEY_BY_TABLE: Readonly<Record<string, string>> = {
  project_financials: 'project_id',     // PK project_id
  building_access_rules: 'project_id',  // PK project_id
  wip_cost_overrides: 'project_id',     // PK (user_id, project_id); the ledger is per user already
  cash_flow_settings: 'user_id',        // PK user_id
  portal_snapshots: 'portal_id',        // PK portal_id
  sub_portal_snapshots: 'sub_portal_id', // PK sub_portal_id
};

/**
 * The record a write belongs to — ONE rule for the slot, the flush's group,
 * the queue's ordering guard AND the Not-saved ledger (integration round 2):
 * `id` first; otherwise the table's own primary key (RECORD_KEY_BY_TABLE);
 * otherwise null — an id-less row of an id-keyed table is no record the phone
 * can name, so nothing is ordered or parked behind it. (Round 2 named records
 * by data.id alone before that, so a refused project_financials write had no
 * record id and a Retry of it resent the stale whole row over a later save.)
 */
export function recordIdOf(table: string, data: Record<string, unknown> | undefined): string | null {
  const d = data ?? {};
  const keyCol = RECORD_KEY_BY_TABLE[table];
  const k = d.id ?? (keyCol ? d[keyCol] : undefined);
  if (typeof k === 'string' && k.length > 0) return k;
  if (typeof k === 'number') return String(k);
  return null;
}

