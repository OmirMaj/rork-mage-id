// utils/pasteRows.ts — pure parser: clipboard text → task partials. No React, no I/O.
// A plain line becomes a title-only task. A tab-bearing line (copied from
// Excel/Sheets) maps columns → Title · Duration · Phase. Consumed by GridPane's
// web onPaste handler, which hands the result to schedule-pro's bulk-create.

export interface ParsedRow {
  title: string;
  durationDays?: number;
  phase?: string;
}

/** Hard cap so a pathological paste can't spawn thousands of rows in one commit. */
export const MAX_PASTE_ROWS = 200;

// Leading number, optionally decimal — ignores a trailing unit like "d" / "days".
const DUR_RE = /^(\d+(?:\.\d+)?)/;

export function parsePastedRows(text: string): ParsedRow[] {
  if (!text) return [];
  const rows: ParsedRow[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (rows.length >= MAX_PASTE_ROWS) break;

    if (rawLine.indexOf('\t') >= 0) {
      const cols = rawLine.split('\t');
      const title = (cols[0] ?? '').trim();
      if (!title) continue;
      const row: ParsedRow = { title };
      const durMatch = (cols[1] ?? '').trim().match(DUR_RE);
      if (durMatch) {
        const d = Number.parseFloat(durMatch[1]);
        if (Number.isFinite(d) && d > 0) row.durationDays = d;
      }
      const phase = (cols[2] ?? '').trim();
      if (phase) row.phase = phase;
      rows.push(row);
    } else {
      const title = rawLine.trim();
      if (!title) continue;
      rows.push({ title });
    }
  }
  return rows;
}
