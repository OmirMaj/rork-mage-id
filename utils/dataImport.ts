// dataImport.ts — parse + validate a MAGE ID export file (the JSON produced by
// utils/dataExport.ts) and figure out what's safe to bring in.
//
// Design: NON-DESTRUCTIVE MERGE. We never delete or overwrite existing
// records. Import only adds rows whose id isn't already present, so importing
// the same file twice is a no-op and importing a backup onto a populated
// account is safe. The actual writes go through ProjectContext's existing
// add* functions (app/data-import.tsx) — reusing their proven Supabase
// mapping + offline-queue sync — so imported data is durable, not just local.
//
// v1 imports the collections ProjectContext.importData merges by id with a
// batch-safe, durable (Supabase-synced) path: projects + the two "book of
// business" lists (contacts, subcontractors). Every other collection present
// in an export is detected and surfaced honestly as "not imported yet" — their
// add* paths regenerate ids/numbers or lack a batch-safe sync, so importing
// them idempotently is a deliberate follow-up rather than a silent partial.

import type { DataExportPayload } from '@/utils/dataExport';

/** Collections importData merges losslessly + idempotently in v1. */
export type ImportableKey = 'projects' | 'contacts' | 'subcontractors';

export const IMPORTABLE_COLLECTIONS: { key: ImportableKey; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'subcontractors', label: 'Subcontractors' },
];

/** Collections an export may contain that v1 doesn't import yet (shown to the user). */
export const DEFERRED_COLLECTIONS: { key: keyof DataExportPayload; label: string }[] = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'changeOrders', label: 'Change orders' },
  { key: 'dailyReports', label: 'Daily reports' },
  { key: 'punchItems', label: 'Punch items' },
  { key: 'photos', label: 'Photos' },
  { key: 'rfis', label: 'RFIs' },
  { key: 'submittals', label: 'Submittals' },
  { key: 'warranties', label: 'Warranties' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'communications', label: 'Communications' },
];

export interface ParsedImport {
  data: Partial<DataExportPayload>;
  exportedAt?: string;
  schemaVersion?: number;
}

/**
 * Parse + validate the raw file text. Returns the payload on success, or a
 * human-readable error. We accept anything that looks like a MAGE export
 * (the `exportedBy` stamp or a numeric `schemaVersion`) and that carries at
 * least one recognized collection array.
 */
export function parseMageExport(text: string): { ok: true; result: ParsedImport } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON. Pick the .json file from a MAGE ID export.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Unexpected file shape. Pick the .json file from a MAGE ID export.' };
  }
  const obj = raw as Record<string, unknown>;
  const looksLikeMage =
    obj.exportedBy === 'MAGE ID' || typeof obj.schemaVersion === 'number';
  // At least one known array must be present + actually an array.
  const knownKeys: (keyof DataExportPayload)[] = [
    ...IMPORTABLE_COLLECTIONS.map((c) => c.key),
    ...DEFERRED_COLLECTIONS.map((c) => c.key),
  ];
  const hasAnyCollection = knownKeys.some((k) => Array.isArray(obj[k as string]));
  if (!looksLikeMage || !hasAnyCollection) {
    return { ok: false, error: 'This doesn’t look like a MAGE ID export file.' };
  }

  const data: Partial<DataExportPayload> = {};
  for (const k of knownKeys) {
    const v = obj[k as string];
    if (Array.isArray(v)) {
      // Keep only entries with a string id — everything we import is keyed by id.
      (data as Record<string, unknown>)[k as string] = v.filter(
        (item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
      );
    }
  }

  return {
    ok: true,
    result: {
      data,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : undefined,
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : undefined,
    },
  };
}

/** Split incoming items into those not already present (by id) vs duplicates. */
export function partitionNew<T extends { id: string }>(
  incoming: T[],
  existingIds: Set<string>,
): { toAdd: T[]; duplicates: number } {
  const toAdd: T[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (const item of incoming) {
    if (existingIds.has(item.id) || seen.has(item.id)) {
      duplicates++;
    } else {
      seen.add(item.id);
      toAdd.push(item);
    }
  }
  return { toAdd, duplicates };
}
