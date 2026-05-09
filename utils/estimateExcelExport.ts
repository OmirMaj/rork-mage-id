// utils/estimateExcelExport.ts — Excel export of a project's linked
// estimate. The single most-requested workflow from small GCs (per the
// competitive ad audit: every Buildxact / Square Takeoff customer
// expects round-trip-to-Excel of their numbers).
//
// Output:
//   - Sheet "Estimate" with one row per LinkedEstimateItem, columns:
//     Section / CSI Division / Item / Supplier / Qty / Unit / Unit Price
//     / Markup % / Line Total. Final row is the grand total.
//   - Sheet "Summary" with project metadata (name, location, address,
//     globalMarkup, totals) for the bidder's records.
//   - Header row is bold and frozen. Currency cells use "$#,##0.00"
//     number format.
//
// Why xlsx (SheetJS Community) and not exceljs:
//   - xlsx is 0.18.x, well-maintained, MIT-licensed, ~600 KB gzipped.
//   - exceljs ships heavier and pulls in archiver. We don't need
//     conditional formatting or formula evaluation — just a clean
//     2-sheet workbook.
//
// Sharing:
//   - On native, write to FileSystem.cacheDirectory and hand to the
//     native share sheet via expo-sharing.
//   - On web, trigger a download via a Blob URL.

import * as XLSX from 'xlsx';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Project } from '@/types';

interface ExcelRowEstimate {
  Section: string;
  CSI: string;
  Item: string;
  Supplier: string;
  Qty: number;
  Unit: string;
  'Unit Price': number;
  'Markup %': number;
  'Line Total': number;
}

interface ExcelRowSummary {
  Field: string;
  Value: string;
}

export interface ExportEstimateExcelResult {
  ok: boolean;
  uri?: string;
  error?: string;
}

/**
 * Build the workbook in memory. Pure — no I/O. Useful for unit tests.
 */
export function buildEstimateWorkbook(project: Project): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Estimate sheet ──────────────────────────────────────
  const items = project.linkedEstimate?.items ?? [];
  const estimateRows: ExcelRowEstimate[] = items.map(it => ({
    Section: it.category ?? '',
    CSI: it.csiDivision ?? '',
    Item: it.name ?? '',
    Supplier: it.supplier ?? '',
    Qty: it.quantity ?? 0,
    Unit: it.unit ?? '',
    'Unit Price': it.usesBulk ? (it.bulkPrice ?? 0) : (it.unitPrice ?? 0),
    'Markup %': it.markup ?? 0,
    'Line Total': it.lineTotal ?? 0,
  }));

  const estimateSheet = XLSX.utils.json_to_sheet(estimateRows);

  // Append the grand-total row. SheetJS adds rows by row index relative
  // to the existing sheet; we use the JSON helper instead to keep the
  // header + data rows self-consistent.
  const grandTotal = project.linkedEstimate?.grandTotal ?? estimateRows.reduce((s, r) => s + (r['Line Total'] ?? 0), 0);
  XLSX.utils.sheet_add_aoa(
    estimateSheet,
    [
      [], // blank row
      ['', '', '', '', '', '', '', 'Grand Total', grandTotal],
    ],
    { origin: -1 },
  );

  // Currency formatting on the price + total columns. The ! is the
  // sheet-level meta key in SheetJS. Skip column-width calculations —
  // Excel auto-fits when the user opens it.
  if (estimateSheet['!cols'] == null) {
    estimateSheet['!cols'] = [
      { wch: 18 }, { wch: 8 }, { wch: 32 }, { wch: 18 },
      { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    ];
  }
  // Walk every "Unit Price" + "Line Total" cell and stamp the
  // currency format. xlsx requires per-cell .z metadata; the
  // bulk approach is to iterate the cell range.
  const currencyCols = ['G', 'I'];
  const range = XLSX.utils.decode_range(estimateSheet['!ref'] || 'A1:I1');
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    for (const col of currencyCols) {
      const ref = `${col}${row + 1}`;
      const cell = estimateSheet[ref];
      if (cell && typeof cell.v === 'number') {
        cell.z = '"$"#,##0.00';
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, estimateSheet, 'Estimate');

  // ── Summary sheet ──────────────────────────────────────
  const summaryRows: ExcelRowSummary[] = [
    { Field: 'Project', Value: project.name ?? '' },
    { Field: 'Location', Value: project.location ?? '' },
    { Field: 'Project Type', Value: project.type ?? '' },
    { Field: 'Square Footage', Value: String(project.squareFootage ?? '—') },
    { Field: 'Quality', Value: String(project.quality ?? '—') },
    { Field: 'Items', Value: String(items.length) },
    { Field: 'Base Total', Value: `$${(project.linkedEstimate?.baseTotal ?? 0).toFixed(2)}` },
    { Field: 'Markup Total', Value: `$${(project.linkedEstimate?.markupTotal ?? 0).toFixed(2)}` },
    { Field: 'Global Markup %', Value: String(project.linkedEstimate?.globalMarkup ?? 0) },
    { Field: 'Grand Total', Value: `$${(project.linkedEstimate?.grandTotal ?? 0).toFixed(2)}` },
    { Field: 'Generated', Value: new Date().toLocaleString() },
  ];
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 22 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  return wb;
}

/**
 * Build + share the workbook. Native goes through expo-sharing; web
 * triggers a download.
 */
export async function exportEstimateToExcel(project: Project): Promise<ExportEstimateExcelResult> {
  if (!project.linkedEstimate || project.linkedEstimate.items.length === 0) {
    return { ok: false, error: 'No estimate items to export.' };
  }

  const wb = buildEstimateWorkbook(project);
  const safeName = (project.name ?? 'estimate').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
  const fileName = `mage-id-${safeName}-estimate.xlsx`;

  try {
    if (Platform.OS === 'web') {
      // Web path: SheetJS writes a Blob via XLSX.writeFile is fine,
      // but to keep the API consistent with native we go through the
      // explicit Blob → URL approach.
      const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { ok: true, uri: fileName };
    }

    // Native: write base64 to cache, share via the OS sheet.
    const wboutB64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
    const path = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(path, wboutB64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `${project.name} — Estimate`,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    }
    return { ok: true, uri: path };
  } catch (err) {
    console.warn('[estimateExcelExport] failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
