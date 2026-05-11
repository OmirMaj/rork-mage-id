// csvExport.ts — generic CSV export helper.
//
// Why this exists: Buildertrend's #1 negative-review theme on G2 was
// "extremely difficult to export information." MAGE ID makes data
// liberation a one-tap path on every list that uses this.
//
// Two-sided use:
//   GC side: invoices, contacts, subs, daily reports, 1099 export
//   Homeowner side: bid offers received, selections + budgets
//
// Cost: zero (pure JS + expo-sharing + expo-file-system, all already
// in the bundle).

// expo-file-system/legacy exposes the classic top-level API
// (cacheDirectory, writeAsStringAsync, EncodingType). The modern
// surface moved these to a File class; we use the legacy surface
// to match the rest of the codebase.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Convert an array of objects to a CSV string.
 *
 * - Quotes are doubled per RFC 4180 (`O'Hara` → `"O'Hara"` if commas
 *   present; `Say "hi"` → `"Say ""hi"""`).
 * - Fields containing commas, quotes, or newlines are quoted.
 * - Falsy values render as empty strings (not "null" or "undefined").
 * - Dates render as ISO strings.
 * - Objects/arrays render as JSON.
 *
 * @param rows  Data rows. Headers come from the keys of the first row
 *              (or from the explicit `columns` arg if provided).
 * @param columns  Optional ordered list of column keys + labels.
 *                  Without this, columns derive from `Object.keys(rows[0])`.
 */
export function toCSV<T>(
  rows: readonly T[],
  columns?: { key: keyof T; label: string }[],
): string {
  if (rows.length === 0) return '';

  // If no explicit columns are given, derive from the first row's
  // enumerable keys. Cast is safe because we only use the keys for
  // indexing — the runtime value lookup is what produces the string.
  const cols = columns ?? (Object.keys(rows[0] as object) as (keyof T)[]).map(k => ({ key: k, label: String(k) }));
  const headerLine = cols.map(c => csvField(c.label)).join(',');
  const dataLines = rows.map(row =>
    cols.map(c => csvField(formatValue((row as Record<string, unknown>)[c.key as string]))).join(','),
  );
  return [headerLine, ...dataLines].join('\n');
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvField(s: string): string {
  if (s.length === 0) return '';
  const needsQuote = /[",\n\r]/.test(s);
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Generate a CSV file and open the system share sheet (iOS/Android)
 * or trigger a browser download (web). On web, no expo-sharing needed
 * — we use a Blob + invisible <a download> click.
 *
 * @param fileName  e.g. "invoices-2026-05-11.csv". `.csv` appended if missing.
 * @param csv  The CSV string from `toCSV()`.
 */
export async function exportCSV(fileName: string, csv: string): Promise<void> {
  const safeName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;

  if (Platform.OS === 'web') {
    // Web path — Blob + <a download>. No deps needed.
    if (typeof document === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  // Native path — write to cache dir + open share sheet.
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('No cache directory available');
  const path = cacheDir + safeName;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export CSV',
      UTI: 'public.comma-separated-values-text',
    });
  } else {
    // Share unavailable (rare on iOS/Android) — surface the path so
    // the caller can show it. This case is mostly Android emulator.
    console.warn('[csvExport] Sharing unavailable; file saved at', path);
  }
}

/**
 * Build a filename like "invoices-2026-05-11.csv" from a base name.
 * Includes today's date in the format the user expects (ISO-ish).
 */
export function dateStampedName(base: string): string {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10);
  return `${base}-${stamp}.csv`;
}
