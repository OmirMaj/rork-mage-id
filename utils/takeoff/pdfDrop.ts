// utils/takeoff/pdfDrop.ts — list-3 lane TK-c. PURE: what a file dropped on
// the desktop takeoff (the sheet rail or the first-run screen) is allowed to
// be, before anything is read or uploaded. No I/O and no imports; the upload
// itself is hooks/useTakeoffPdfDrop.ts, which mirrors Plans' PDF import.

export interface DroppedFileInfo {
  name: string;
  type: string;
  size: number;
}

/** Same client cap Plans applies before an upload (app/plans.tsx). */
export const PDF_DROP_MAX_BYTES = 500 * 1024 * 1024;

export const PDF_DROP_COPY = {
  none: 'Drop a PDF plan set here.',
  many: 'One PDF at a time.',
  notPdf: 'Only PDFs can be dropped here. Add images from Plans.',
  tooBig: 'Plan PDFs must be under 500 MB. Try splitting it by discipline.',
} as const;

export type PdfDropVerdict = { ok: true; index: 0 } | { ok: false; reason: string };

/** A PDF by its MIME type, or — browsers often leave `type` empty — by a
 *  `.pdf` name in any case. */
export function isPdfFile(f: { name: string; type: string }): boolean {
  const type = (f.type ?? '').trim().toLowerCase();
  if (type === 'application/pdf') return true;
  return /\.pdf$/i.test((f.name ?? '').trim());
}

export function pdfDropVerdict(files: readonly DroppedFileInfo[]): PdfDropVerdict {
  if (!files || files.length === 0) return { ok: false, reason: PDF_DROP_COPY.none };
  if (files.length > 1) return { ok: false, reason: PDF_DROP_COPY.many };
  const f = files[0];
  if (!isPdfFile(f)) return { ok: false, reason: PDF_DROP_COPY.notPdf };
  if (typeof f.size === 'number' && f.size > PDF_DROP_MAX_BYTES) return { ok: false, reason: PDF_DROP_COPY.tooBig };
  return { ok: true, index: 0 };
}

/** A drag that carries files (not text or a link being dragged around the
 *  page). DataTransfer.types is a DOMStringList-like array in every browser. */
export function dragHasFiles(types: readonly string[] | null | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

/** The done line after a drop. Pages arrive unnumbered, named as Plans names
 *  them — the numbering happens in Plans. */
export function pdfDropDoneLine(n: number): string {
  return `${n} ${n === 1 ? 'sheet' : 'sheets'} added. Number the sheets in Plans.`;
}

/** "Saving <n> sheets…" */
export function pdfDropSavingLine(n: number): string {
  return `Saving ${n} ${n === 1 ? 'sheet' : 'sheets'}…`;
}
