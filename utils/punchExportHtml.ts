// utils/punchExportHtml.ts — the punch list PDF, as HTML. PURE.
//
// WHY THESE CHOICES (all measured on expo-print 15.0.8's own iOS pipeline and
// in Chromium, spec §0a — the harness is in the handoff):
//
//   • Photos and plans are <object data> with FALLBACK CONTENT, never <img> or
//     SVG <image>. A failed <img> prints WebKit's blue "?" broken-image icon
//     over whatever sits under it; a failed <object> prints its fallback — here
//     "Photo not available (offline / not uploaded)" on an opaque layer ABOVE
//     the markup, so a missing photo never shows stray arrows either.
//   • Because an <object> can host an HTML or SVG DOCUMENT (which can run
//     script), its source is allow-listed to data:image (never svg+xml) plus
//     the Supabase storage origin, and a CSP meta repeats that allow-list with
//     script-src 'none'. WebKit needs the URL in BOTH img-src and object-src
//     and a CSP-blocked object renders nothing at all, so the code allow-list
//     and the CSP must match exactly — both come from `allowedOrigins`.
//   • Never CSS background-image for photos: it re-encodes (8 MB → 46 MB).
//   • Heights that must fit a page are in px, never inches (iOS prints CSS
//     inches ~1.1–1.2x and pushes the block to the next page).
//   • Markup is drawn as an SVG in a 0..100 viewBox over the photo's centred
//     SQUARE crop — the annotator's own frame (object-fit: cover).
//
// Every user string goes through escHtml. pdfTable cells are RAW HTML, so the
// caller escapes each one here.

import type { CompanyBranding, PhotoMarkup } from '@/types';
import {
  escHtml,
  PDF_PALETTE,
  pdfFooter,
  pdfHeader,
  pdfPill,
  pdfSectionHeader,
  pdfShell,
  pdfStatGrid,
  pdfTable,
  pdfTitle,
} from '@/utils/pdfDesign';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  overCapPhotoText,
  photoSummaryLine,
  PUNCH_EXPORT_CREW_INTERNAL,
  PUNCH_EXPORT_DISCLAIMER,
  PUNCH_EXPORT_INTERNAL_STAMP,
  PUNCH_EXPORT_LANDSCAPE_MIN_ASPECT,
  PUNCH_EXPORT_NOT_PINNED,
  PUNCH_EXPORT_PHOTO_TEXT,
  PUNCH_EXPORT_PLAN_MAX_H_LANDSCAPE_PX,
  PUNCH_EXPORT_PLAN_MAX_H_PX,
  type PunchExportAssets,
  type PunchExportImageAsset,
  type PunchExportImageMime,
  type PunchExportModel,
  type PunchExportRow,
  type PunchExportSheetPage,
  type PunchExportTarget,
  type PunchExportUnavailableReason,
} from '@/utils/punchExportCore';

export const PUNCH_EXPORT_STATUS_ELEMENT_ID = 'pe-status';
export const PUNCH_EXPORT_HINT_ELEMENT_ID = 'pe-hint';

const P = PDF_PALETTE;

// ───────────────────────────────────────────────────────────────────────────
// URL allow-lists and the CSP
// ───────────────────────────────────────────────────────────────────────────

const OBJECT_DATA_PREFIX = /^data:image\/(jpeg|jpg|png|webp|gif|heic|heif);base64,/i;
const LOGO_DATA_PREFIX = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i;
const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

/**
 * The only sources an <object> may load: a raster data:image, or an https URL
 * on an allowed origin (the storage host). Everything else — javascript:,
 * data:text/html, data:image/svg+xml, http:, file:, blob:, other origins — is
 * null, and the caller prints the honest "not available" box instead.
 * The data: check is a PREFIX test on the first 64 chars: never run a regex
 * over a multi-megabyte base64 string.
 */
export function safeObjectSrc(src: string | null | undefined, allowedOrigins: readonly string[]): string | null {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s) return null;
  if (/^data:/i.test(s.slice(0, 5))) return OBJECT_DATA_PREFIX.test(s.slice(0, 64)) ? s : null;
  if (!/^https:/i.test(s.slice(0, 6))) return null;
  try {
    const origin = new URL(s).origin;
    return allowedOrigins.includes(origin) ? s : null;
  } catch {
    return null;
  }
}

/** The logo goes in pdfHeader's <img>, where an SVG cannot run script, so any
 *  https URL or a data:image including svg+xml is fine. Anything else: null
 *  (pdfHeader then draws its monogram). */
export function safeLogoSrc(src: string | null | undefined): string | null {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s) return null;
  if (/^data:/i.test(s.slice(0, 5))) return LOGO_DATA_PREFIX.test(s.slice(0, 64)) ? s : null;
  if (/^https:\/\//i.test(s.slice(0, 8))) return s;
  return null;
}

const ALLOWED_MIMES: readonly PunchExportImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export function objectMime(asset: { mime?: string; src?: string }): PunchExportImageMime {
  if (asset.mime && (ALLOWED_MIMES as readonly string[]).includes(asset.mime)) return asset.mime as PunchExportImageMime;
  const m = /^data:(image\/[a-z+]+);/i.exec(String(asset.src ?? '').slice(0, 40));
  if (m) {
    const t = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
    if ((ALLOWED_MIMES as readonly string[]).includes(t)) return t as PunchExportImageMime;
  }
  return 'image/jpeg';
}

export function buildCsp(allowedOrigins: readonly string[]): string {
  const origins = allowedOrigins.filter(o => ORIGIN_RE.test(o));
  const objectSrc = ['data:', ...origins].join(' ');
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'img-src data: https:',
    `object-src ${objectSrc}`,
    "script-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

// ───────────────────────────────────────────────────────────────────────────
// Markup
// ───────────────────────────────────────────────────────────────────────────

const MARKUP_HEX: Record<'red' | 'yellow' | 'green', string> = {
  red: '#E5484D',
  yellow: '#F5A623',
  green: '#1E8E4A',
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function f2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

type Pt = { x: number; y: number };

function scaled(points: readonly unknown[] | undefined): Pt[] | null {
  if (!Array.isArray(points)) return null;
  const out: Pt[] = [];
  for (const p of points) {
    const q = p as { x?: unknown; y?: unknown } | null;
    if (!q || typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
    out.push({ x: clamp01(q.x) * 100, y: clamp01(q.y) * 100 });
  }
  return out;
}

/**
 * The photo's markup as an SVG over the square cover frame. Print-legible
 * proportions (a little bolder than on screen). 'rectangle' and unknown types
 * are skipped, as PhotoMarkupOverlay skips them; a mark with a non-finite
 * point is skipped rather than drawn at a corner. Colours and attributes never
 * come from data.
 */
export function markupSvg(markup: readonly PhotoMarkup[] | null | undefined): string {
  if (!Array.isArray(markup) || markup.length === 0) return '';
  const parts: string[] = [];
  for (const m of markup) {
    if (!m || typeof m !== 'object') continue;
    // Own-property lookup: '__proto__' / 'constructor' in the data must not
    // reach an SVG attribute.
    const color = typeof m.color === 'string' && Object.prototype.hasOwnProperty.call(MARKUP_HEX, m.color)
      ? MARKUP_HEX[m.color as 'red' | 'yellow' | 'green']
      : MARKUP_HEX.red;
    const pts = scaled(m.points);
    if (!pts) continue;
    const stroke = `stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"`;
    if (m.type === 'arrow') {
      if (pts.length < 2) continue;
      const [a, b] = pts;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 0)) continue;
      const ux = dx / len;
      const uy = dy / len;
      const bx = b.x - ux * 5;
      const by = b.y - uy * 5;
      const l = `${f2(bx + uy * 2.5)},${f2(by - ux * 2.5)}`;
      const r = `${f2(bx - uy * 2.5)},${f2(by + ux * 2.5)}`;
      parts.push(`<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(b.x)}" y2="${f2(b.y)}" ${stroke} />`);
      parts.push(`<polygon points="${f2(b.x)},${f2(b.y)} ${l} ${r}" fill="${color}" />`);
    } else if (m.type === 'circle') {
      if (pts.length < 2) continue;
      const [a, b] = pts;
      const r = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 2;
      if (!(r > 0)) continue;
      parts.push(`<circle cx="${f2((a.x + b.x) / 2)}" cy="${f2((a.y + b.y) / 2)}" r="${f2(r)}" fill="none" ${stroke} />`);
    } else if (m.type === 'freehand') {
      if (pts.length < 2) continue;
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f2(p.x)},${f2(p.y)}`).join(' ');
      parts.push(`<path d="${d}" fill="none" ${stroke} />`);
    } else if (m.type === 'text') {
      const text = typeof m.text === 'string' ? m.text : '';
      if (pts.length < 1 || !text.trim()) continue;
      const { x, y } = pts[0];
      const len = text.length * 2.9 + 3.2;
      parts.push(`<polygon points="${f2(x)},${f2(y - 5)} ${f2(x + len)},${f2(y - 5)} ${f2(x + len)},${f2(y + 2)} ${f2(x)},${f2(y + 2)}" fill="${color}" fill-opacity=".92" />`);
      parts.push(`<text x="${f2(x + 1.6)}" y="${f2(y + 0.4)}" fill="#FFFFFF" font-size="5" font-weight="700" font-family="-apple-system,Helvetica,Arial,sans-serif">${escHtml(text)}</text>`);
    }
  }
  if (parts.length === 0) return '';
  return `<svg class="pe-mk" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Marker position; null when either value is non-finite (the marker is skipped). */
export function pinStyle(x: number, y: number): string | null {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `left:${(clamp01(x) * 100).toFixed(3)}%;top:${(clamp01(y) * 100).toFixed(3)}%`;
}

// ───────────────────────────────────────────────────────────────────────────
// CSS
// ───────────────────────────────────────────────────────────────────────────

const FAIL_BOX = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;font-size:9px;line-height:1.4;color:#6B7079';
const PLAN_BOX = `width:360px;max-width:100%;height:220px;background:#EFEDE8;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:11px;line-height:1.4;color:${P.text2}`;

export const PUNCH_EXPORT_CSS = `
@page { size: letter; margin: 0.5in }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { overflow-wrap: anywhere; }
@media print { body { padding: 0 !important; } .screen-only { display: none !important; } }
.pe-hint { border: 1px solid ${P.bone}; background: ${P.cream2}; color: ${P.text2}; padding: 8px 10px; border-radius: 6px; margin: 0 0 16px; font-size: 11px; }
.pe-internal-stamp { border: 1.5px solid ${P.error}; background: ${P.errorTint}; color: ${P.error}; font-weight: 700; padding: 8px 10px; border-radius: 6px; margin: 0 0 16px; }
.pe-internal { border: 1px solid ${P.error}; background: ${P.errorTint}; color: ${P.error}; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; font-size: 11px; }
.pe-sec-label { font-size: 12px; font-weight: 700; color: ${P.text2}; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .6px; }
.pe-lead { font-size: 13px; font-weight: 700; margin: 0 0 10px; }
.pe-sum-line { font-size: 11px; color: ${P.text2}; margin: -14px 0 14px; }
.pe-photo-line { font-size: 11px; color: ${P.text2}; margin: 0 0 12px; }
.pe-crew-break { page-break-before: always; break-before: page; }
.pe-group { font-size: 13px; font-weight: 700; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid ${P.bone2}; page-break-after: avoid; break-after: avoid; }
.pe-group span { font-weight: 600; font-size: 11px; color: ${P.text2}; }
.pe-card { display: block; page-break-inside: avoid; break-inside: avoid; border: 1px solid ${P.bone}; border-radius: 8px; padding: 10px; margin: 0 0 8px; }
.pe-card-closed { border-color: ${P.bone2}; }
.pe-card-closed .pe-desc { color: ${P.text2}; }
.pe-ct { width: 100%; table-layout: fixed; border-collapse: collapse; }
.pe-ph-cell { width: 34%; vertical-align: top; padding-right: 12px; }
.pe-body { vertical-align: top; }
.pe-ph { position: relative; width: 100%; padding-top: 100%; overflow: hidden; border-radius: 6px; background: #EFEDE8; }
.pe-ph-msg { ${FAIL_BOX}; }
.pe-fail { ${FAIL_BOX}; z-index: 2; background: #EFEDE8; }
.pe-obj { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.pe-mk { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
.pe-top { font-size: 10px; color: ${P.text2}; }
.pe-num { font-size: 15px; font-weight: 800; color: ${P.text}; margin-right: 6px; }
.pe-ref { font-family: Menlo, 'Courier New', monospace; font-size: 9px; color: ${P.text2}; margin-right: 8px; }
.pe-hi { color: ${P.error}; font-weight: 700; margin-left: 6px; }
.pe-pri { color: ${P.textMuted}; margin-left: 6px; }
.pe-overdue { color: ${P.error}; font-weight: 700; margin-left: 6px; }
.pe-today { color: ${P.warning}; font-weight: 700; margin-left: 6px; }
.pe-desc { font-size: 12.5px; font-weight: 600; margin: 6px 0 4px; white-space: pre-wrap; }
.pe-where { font-size: 10px; color: ${P.text}; }
.pe-meta { font-size: 10px; color: ${P.text2}; margin-top: 3px; }
.pe-muted { color: ${P.textMuted}; }
.pe-returned { border-left: 3px solid ${P.error}; background: ${P.errorTint}; padding: 6px 8px; margin-top: 6px; font-size: 10px; white-space: pre-wrap; }
.pe-done { margin-top: 8px; padding-top: 6px; border-top: 1px dashed ${P.bone}; font-size: 10px; line-height: 1.9; color: ${P.text2}; }
.pe-box { display: inline-block; width: 10px; height: 10px; border: 1px solid ${P.text2}; vertical-align: -1px; margin-right: 3px; }
.pe-lbl { margin-left: 10px; }
.pe-line { display: inline-block; width: 56px; border-bottom: 1px solid ${P.textMuted}; margin: 0 0 0 3px; }
.pe-stamp { display: inline-block; border: 1.5px solid ${P.success}; color: ${P.success}; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 4px; letter-spacing: .6px; }
.pe-tbl { table-layout: fixed; font-size: 10.5px; margin-bottom: 18px; }
.pe-tbl th { text-align: left; font-size: 9px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: ${P.textMuted}; padding: 8px 6px; border-bottom: 2px solid ${P.bone}; }
.pe-tbl td { padding: 7px 6px; border-bottom: 1px solid ${P.bone2}; vertical-align: top; }
.pe-tbl tr { page-break-inside: avoid; break-inside: avoid; }
.pe-tbl thead { display: table-header-group; }
.pe-tbl .pe-grp td { font-weight: 700; font-size: 11px; background: ${P.cream2}; color: ${P.text}; }
.pe-tdesc { white-space: pre-wrap; }
.pe-sub { font-size: 9.5px; color: ${P.text2}; margin-top: 2px; }
.pe-tref { font-family: Menlo, 'Courier New', monospace; font-size: 8.5px; color: ${P.text2}; }
.pe-tbl-closed td { color: ${P.text2}; }
.pe-plan { page-break-before: always; break-before: page; }
.pe-plan-land { page: pe-land; }
.pe-plan-sub { font-size: 11px; color: ${P.text2}; margin: -4px 0 10px; }
.pe-plan-natural { position: relative; display: inline-block; line-height: 0; max-width: 100%; }
.pe-plan-obj { display: block; max-width: 100%; max-height: ${PUNCH_EXPORT_PLAN_MAX_H_PX}px; width: auto; height: auto; }
.pe-plan-land .pe-plan-obj { max-height: ${PUNCH_EXPORT_PLAN_MAX_H_LANDSCAPE_PX}px; }
.pe-plan-fail { position: relative; z-index: 3; ${PLAN_BOX}; }
.pe-plan-missing { ${PLAN_BOX}; margin-bottom: 12px; }
.pe-pin { position: absolute; z-index: 2; transform: translate(-50%,-100%); -webkit-transform: translate(-50%,-100%); display: flex; flex-direction: column; align-items: center; line-height: 1; }
.pe-pin-head { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: ${P.error}; color: #FFFFFF; border: 1.5px solid #FFFFFF; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; white-space: nowrap; box-sizing: border-box; }
.pe-pin-tail { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid ${P.error}; }
.pe-pin-closed .pe-pin-head { background: ${P.textMuted}; }
.pe-pin-closed .pe-pin-tail { border-top-color: ${P.textMuted}; }
.pe-legend { margin-top: 14px; }
.pe-legend th, .pe-legend td { overflow-wrap: normal; }
.pe-legend td:nth-child(2), .pe-legend td:nth-child(3) { white-space: nowrap; }
.pe-tref { overflow-wrap: normal; }
.pe-sign { margin-top: 8px; font-size: 11px; color: ${P.text2}; }
.pe-sign-row { display: flex; gap: 16px; margin-top: 22px; font-size: 11px; color: ${P.text}; }
.pe-sign-row div { flex: 1; }
.pe-sign-line { border-bottom: 1px solid ${P.text2}; height: 22px; margin-bottom: 4px; }
.pe-sign-who { font-weight: 700; margin-top: 18px; font-size: 11px; }
`;

const WEB_LANDSCAPE_PAGE_CSS = '@page pe-land { size: letter landscape; margin: 0.5in }';

/** The print tab's first content, written synchronously inside the press. No
 *  script; the opener updates #pe-status through textContent. */
export const PUNCH_EXPORT_PRINT_PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; object-src data: https:; script-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'">
<title>Preparing punch list…</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B0D10;background:#FFFFFF;text-align:center;padding:24px;font-size:15px}</style>
</head><body><div><p id="${PUNCH_EXPORT_STATUS_ELEMENT_ID}">Preparing your punch list…</p><p style="font-size:13px;color:#555B63">On a phone, if this stops moving, switch back to the MAGE ID tab for a moment — phone browsers pause a tab that is in the background.</p></div></body></html>`;

// ───────────────────────────────────────────────────────────────────────────
// Pieces
// ───────────────────────────────────────────────────────────────────────────

function statusTone(status: string): 'error' | 'warning' | 'amber' | 'success' | 'muted' {
  if (status === 'open') return 'error';
  if (status === 'in_progress') return 'warning';
  if (status === 'ready_for_review') return 'amber';
  if (status === 'closed') return 'success';
  return 'muted';
}

function planText(row: PunchExportRow): string {
  const p = row.plan;
  if (p.state === 'pinned') return `${p.sheetLabel} — pin ${row.number}`;
  if (p.state === 'no-position') return `${p.sheetLabel} (pin position missing)`;
  if (p.state === 'sheet-missing') return "pinned on a sheet that's no longer in this project";
  return PUNCH_EXPORT_NOT_PINNED;
}

function unavailableText(reason: PunchExportUnavailableReason, target: PunchExportTarget): string {
  if (reason === 'over_cap') return overCapPhotoText(target);
  if (reason === 'over_size') return PUNCH_EXPORT_PHOTO_TEXT.over_size;
  if (reason === 'over_offline_budget') return PUNCH_EXPORT_PHOTO_TEXT.over_offline_budget;
  return PUNCH_EXPORT_PHOTO_TEXT.unreachable;
}

function photoBox(
  row: PunchExportRow,
  asset: PunchExportImageAsset | undefined,
  overCap: boolean,
  target: PunchExportTarget,
  allowedOrigins: readonly string[],
): string {
  const msg = (t: string) => `<div class="pe-ph"><div class="pe-ph-msg">${escHtml(t)}</div></div>`;
  if (!row.hasPhoto) return msg(PUNCH_EXPORT_PHOTO_TEXT.no_photo);
  if (overCap) return msg(overCapPhotoText(target));
  if (!asset) return msg(PUNCH_EXPORT_PHOTO_TEXT.unreachable);
  if (asset.kind === 'unavailable') return msg(unavailableText(asset.reason, target));
  const src = safeObjectSrc(asset.src, allowedOrigins);
  if (!src) return msg(PUNCH_EXPORT_PHOTO_TEXT.unreachable);
  return `<div class="pe-ph"><object class="pe-obj" data="${escHtml(src)}" type="${escHtml(objectMime(asset))}"><div class="pe-fail">${escHtml(PUNCH_EXPORT_PHOTO_TEXT.unreachable)}</div></object>${markupSvg(row.markup)}</div>`;
}

function dueFlag(row: PunchExportRow): string {
  if (row.daysOverdue && row.daysOverdue > 0) {
    return `<span class="pe-overdue">Overdue ${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'}</span>`;
  }
  if (row.dueToday) return '<span class="pe-today">Due today</span>';
  return '';
}

function metaLine(row: PunchExportRow): string {
  const bits: string[] = [];
  bits.push(row.assignedTo ? `Assigned to ${escHtml(row.assignedTo)}` : '<span class="pe-muted">Unassigned</span>');
  if (row.dueDay || row.dueRaw) bits.push(`Due ${escHtml(row.dueDay ? formatCalendarDay(row.dueDay) : row.dueRaw)}`);
  if (row.createdDay) bits.push(`Logged ${escHtml(formatCalendarDay(row.createdDay))}`);
  if (row.closedDay) bits.push(`Closed ${escHtml(formatCalendarDay(row.closedDay))}`);
  if (row.linkedTaskName) bits.push(`Task: ${escHtml(row.linkedTaskName)}`);
  if (row.photoGps) bits.push(`Photo GPS: ${escHtml(row.photoGps)}`);
  return bits.join(' &middot; ');
}

const DONE_STRIP = '<div class="pe-done"><span class="pe-box"></span>Done<span class="pe-lbl">By</span><span class="pe-line"></span><span class="pe-lbl">Date</span><span class="pe-line"></span><span class="pe-lbl"></span><span class="pe-box"></span>Verified</div>';

function closedStamp(row: PunchExportRow): string {
  const day = row.closedDay ? ` ${formatCalendarDay(row.closedDay).toUpperCase()}` : '';
  return `<div class="pe-done"><span class="pe-stamp">CLOSED${escHtml(day)}</span></div>`;
}

function cardHtml(
  row: PunchExportRow,
  assets: PunchExportAssets,
  overCap: ReadonlySet<string>,
  target: PunchExportTarget,
  allowedOrigins: readonly string[],
): string {
  const top = [
    `<span class="pe-num">#${row.number}</span><span class="pe-ref">ref ${escHtml(row.ref)}</span>`,
    pdfPill(row.statusLabel, statusTone(row.status)),
    row.priority === 'high'
      ? '<span class="pe-hi">High priority</span>'
      : `<span class="pe-pri">${escHtml(row.priorityLabel)} priority</span>`,
    dueFlag(row),
    row.list === 'crew' ? ` ${pdfPill('Internal', 'error')}` : '',
  ].join('');
  const desc = row.description.trim() ? row.description : '(No description)';
  return `<div class="pe-card${row.closed ? ' pe-card-closed' : ''}"><table class="pe-ct"><tr><td class="pe-ph-cell">${photoBox(row, assets.photos.get(row.id), overCap.has(row.id), target, allowedOrigins)}</td><td class="pe-body">
<div class="pe-top">${top}</div>
<div class="pe-desc">${escHtml(desc)}</div>
<div class="pe-where"><b>${escHtml(row.typedLocation || 'No location given')}</b> &middot; Plan: ${escHtml(planText(row))}</div>
<div class="pe-meta">${metaLine(row)}</div>
${row.rejectionNote ? `<div class="pe-returned"><b>Returned:</b> ${escHtml(row.rejectionNote)}</div>` : ''}
${row.closed ? closedStamp(row) : DONE_STRIP}
</td></tr></table></div>`;
}

function tableRowHtml(row: PunchExportRow): string {
  const desc = row.description.trim() ? row.description : '(No description)';
  const sub: string[] = [];
  if (row.priority === 'high') sub.push('<span class="pe-hi" style="margin-left:0">High priority</span>');
  if (row.list === 'crew') sub.push('Internal');
  if (row.rejectionNote) sub.push(`Returned: ${escHtml(row.rejectionNote)}`);
  if (row.linkedTaskName) sub.push(`Task: ${escHtml(row.linkedTaskName)}`);
  const due = row.dueDay || row.dueRaw
    ? `${escHtml(row.dueDay ? formatCalendarDay(row.dueDay) : row.dueRaw)}${row.daysOverdue && row.daysOverdue > 0 ? `<div class="pe-overdue" style="margin-left:0">${row.daysOverdue}d late</div>` : ''}`
    : '—';
  const done = row.closed
    ? `Closed${row.closedDay ? ` ${escHtml(formatCalendarDay(row.closedDay))}` : ''}`
    : '<span class="pe-box"></span><span class="pe-line" style="width:32px"></span>';
  return `<tr${row.closed ? ' class="pe-tbl-closed"' : ''}>
<td><b>#${row.number}</b><div class="pe-tref">${escHtml(row.ref)}</div></td>
<td><div class="pe-tdesc">${escHtml(desc)}</div>${sub.length ? `<div class="pe-sub">${sub.join(' &middot; ')}</div>` : ''}</td>
<td>${escHtml(row.typedLocation || 'No location given')}<div class="pe-sub">Plan: ${escHtml(planText(row))}</div></td>
<td>${row.assignedTo ? escHtml(row.assignedTo) : '<span class="pe-muted">Unassigned</span>'}</td>
<td>${escHtml(row.statusLabel)}</td>
<td>${due}</td>
<td>${done}</td>
</tr>`;
}

function planPageHtml(
  page: PunchExportSheetPage,
  asset: PunchExportImageAsset | undefined,
  target: PunchExportTarget,
  allowedOrigins: readonly string[],
): string {
  const land = target === 'web' && asset?.kind === 'image'
    && typeof asset.width === 'number' && typeof asset.height === 'number'
    && asset.width > 0 && asset.height > 0
    && asset.width / asset.height >= PUNCH_EXPORT_LANDSCAPE_MIN_ASPECT;
  const missingText = 'Plan sheet image not available — the items below are pinned on this sheet.';
  const sub = `${page.pinnedCount} item${page.pinnedCount === 1 ? '' : 's'} on ${page.markers.length} marker${page.markers.length === 1 ? '' : 's'}${page.superseded ? ' · older revision' : ''}`;
  const src = asset?.kind === 'image' ? safeObjectSrc(asset.src, allowedOrigins) : null;
  let image: string;
  if (asset?.kind === 'image' && src) {
    const markers = page.markers.map(m => {
      const style = pinStyle(m.x, m.y);
      if (!style) return '';
      return `<div class="pe-pin${m.allClosed ? ' pe-pin-closed' : ''}" style="${style}"><div class="pe-pin-head">${escHtml(m.label)}</div><div class="pe-pin-tail"></div></div>`;
    }).join('');
    image = `<div class="pe-plan-natural"><object class="pe-plan-obj" data="${escHtml(src)}" type="${escHtml(objectMime(asset))}"><div class="pe-plan-fail">${escHtml(missingText)}</div></object>${markers}</div>`;
  } else {
    image = `<div class="pe-plan-missing">${escHtml(missingText)}</div>`;
  }
  const legend = pdfTable(
    [
      { header: 'Marker', width: '14%' },
      { header: '#', width: '8%' },
      { header: 'Ref', width: '13%' },
      { header: 'Item' },
      { header: 'Location', width: '20%' },
      { header: 'Status', width: '16%' },
    ],
    page.legend.map(l => [
      l.firstOfMarker ? escHtml(l.markerLabel) : '',
      escHtml(`#${l.number}`),
      escHtml(l.ref),
      escHtml(l.description.trim() ? l.description : '(No description)'),
      escHtml(l.location),
      escHtml(l.statusLabel),
    ]),
  );
  return `<section class="pe-plan${land ? ' pe-plan-land' : ''}">${pdfSectionHeader(`Plan — ${page.label}`)}<div class="pe-plan-sub">${escHtml(sub)}</div>${image}<div class="pe-legend">${legend}</div></section>`;
}

// ───────────────────────────────────────────────────────────────────────────
// The document
// ───────────────────────────────────────────────────────────────────────────

const CHARSET_META = '<meta charset="utf-8" />';

export function buildPunchExportHtml(
  model: PunchExportModel,
  rawAssets: PunchExportAssets,
  opts: { includePhotos: boolean; branding: CompanyBranding; target: PunchExportTarget; allowedOrigins: readonly string[] },
): string {
  const { target, allowedOrigins } = opts;
  // A photo whose source fails the allow-list prints as unavailable, so the
  // summary line counts it as unavailable too — never "in this report".
  const safePhotos = new Map<string, PunchExportImageAsset>();
  for (const [id, a] of rawAssets.photos) {
    safePhotos.set(id, a.kind === 'image' && !safeObjectSrc(a.src, allowedOrigins) ? { kind: 'unavailable', reason: 'unreachable' } : a);
  }
  const assets: PunchExportAssets = { ...rawAssets, photos: safePhotos };
  const safeBranding: CompanyBranding = { ...opts.branding, logoUri: safeLogoSrc(opts.branding.logoUri) ?? undefined };
  const cardsMode = opts.includePhotos && model.photoItemIds.length > 0;
  const overCap = new Set(model.photoOverCapIds);
  const title = `Punch list${model.internal ? ' (internal)' : ''} — ${model.projectName} — ${model.generatedDay}`;

  const body: string[] = [];
  body.push(`<style>${PUNCH_EXPORT_CSS}${target === 'web' ? `\n${WEB_LANDSCAPE_PAGE_CSS}\n` : ''}</style>`);
  if (target === 'web') {
    body.push(`<div class="screen-only pe-hint" id="${PUNCH_EXPORT_HINT_ELEMENT_ID}">To save it: use your browser's Print (Ctrl/Cmd+P) and choose "Save as PDF".</div>`);
  }
  body.push(pdfHeader(safeBranding));
  const meta = [
    { label: 'Generated', value: model.generatedAtLabel },
    { label: 'Scope', value: model.scopeLabel },
  ];
  if (safeBranding.contactName) meta.push({ label: 'Prepared by', value: safeBranding.contactName });
  body.push(pdfTitle({
    eyebrow: model.internal ? 'Punch list · Internal' : 'Punch list',
    title: model.projectName,
    subtitle: model.projectAddress || undefined,
    meta,
  }));
  if (model.internal) body.push(`<div class="pe-internal-stamp">${escHtml(PUNCH_EXPORT_INTERNAL_STAMP)}</div>`);

  // ── Summary ───────────────────────────────────────────────────────────
  body.push(pdfSectionHeader('Summary'));
  for (const s of model.sections) {
    const sm = s.summary;
    const closed = sm.byStatus.closed;
    // The crew label already reads "Crew list (internal)", so the suffix is
    // added only when the label does not say it — the summary printed
    // "CREW LIST (INTERNAL) — INTERNAL".
    body.push(`<div class="pe-sec-label">${escHtml(s.label)}${s.internal && !/internal/i.test(s.label) ? ' — internal' : ''}</div>`);
    body.push(`<div class="pe-lead">${sm.notDone} still open (${sm.ready} ready for inspection) · ${sm.overdue} overdue · ${closed} closed</div>`);
    body.push(pdfStatGrid([
      { label: 'Open', value: String(sm.byStatus.open), accent: sm.byStatus.open > 0 ? 'error' : undefined },
      { label: 'In Progress', value: String(sm.byStatus.in_progress) },
      { label: 'Ready for Review', value: String(sm.byStatus.ready_for_review) },
      { label: 'Closed', value: String(closed), accent: 'success' },
      { label: 'Total', value: String(sm.total) },
    ]));
    const dueTail = sm.withDueDate === 0 ? ' · No due dates set' : sm.overdue > 0 ? ` · ${sm.overdue} overdue` : ' · None overdue';
    body.push(`<div class="pe-sum-line">${closed} of ${sm.total} closed (${sm.closedPct}%)${dueTail}</div>`);
    if (s.groups.length >= 2) {
      body.push(`<div class="pe-sec-label">Open by area</div>`);
      body.push(pdfTable(
        [{ header: 'Area' }, { header: 'Still open', align: 'right', width: '16%' }, { header: 'Ready for inspection', align: 'right', width: '22%' }, { header: 'Total', align: 'right', width: '12%' }],
        s.areas.map(a => [escHtml(a.label), escHtml(a.notDone), escHtml(a.ready), escHtml(a.total)]),
      ));
    }
  }
  if (model.assignees.length >= 2) {
    body.push(pdfTable(
      [{ header: 'Assigned to' }, { header: 'Open', align: 'right' }, { header: 'In Progress', align: 'right' }, { header: 'Ready for Review', align: 'right' }, { header: 'Closed', align: 'right' }, { header: 'Total', align: 'right' }],
      model.assignees.map(a => [
        escHtml(a.label),
        escHtml(a.byStatus.open),
        escHtml(a.byStatus.in_progress),
        escHtml(a.byStatus.ready_for_review),
        escHtml(a.byStatus.closed),
        escHtml(a.total),
      ]),
    ));
  }
  if (cardsMode) {
    const line = photoSummaryLine(model, assets, opts.includePhotos);
    if (line) body.push(`<div class="pe-photo-line">${escHtml(line)}</div>`);
  }

  // ── Lists ─────────────────────────────────────────────────────────────
  model.sections.forEach((s, si) => {
    const crewBreak = s.list === 'crew' && model.sections.slice(0, si).some(x => x.list === 'punch');
    const n = s.summary.total;
    const parts: string[] = [];
    parts.push(`<section class="pe-list pe-list-${s.list}${crewBreak ? ' pe-crew-break' : ''}">`);
    parts.push(pdfSectionHeader(`${s.label} — ${n} item${n === 1 ? '' : 's'}`));
    if (s.list === 'crew') parts.push(`<div class="pe-internal">${escHtml(PUNCH_EXPORT_CREW_INTERNAL)}</div>`);
    if (cardsMode) {
      for (const g of s.groups) {
        parts.push(`<div class="pe-group">${escHtml(g.label)} <span>${g.notDone} open of ${g.total}</span></div>`);
        for (const r of g.rows) parts.push(cardHtml(r, assets, overCap, target, allowedOrigins));
      }
    } else {
      parts.push('<table class="pe-tbl"><thead><tr><th style="width:11%">#</th><th style="width:31%">Item</th><th style="width:17%">Where</th><th style="width:13%">Assigned to</th><th style="width:11%">Status</th><th style="width:8%">Due</th><th style="width:9%">Done</th></tr></thead><tbody>');
      for (const g of s.groups) {
        parts.push(`<tr class="pe-grp"><td colspan="7">${escHtml(g.label)} · ${g.notDone} open of ${g.total}</td></tr>`);
        for (const r of g.rows) parts.push(tableRowHtml(r));
      }
      parts.push('</tbody></table>');
    }
    parts.push('</section>');
    body.push(parts.join('\n'));
  });

  // ── Plans ─────────────────────────────────────────────────────────────
  for (const page of model.sheetPages) {
    body.push(planPageHtml(page, assets.sheets.get(page.sheetId), target, allowedOrigins));
  }

  // ── Sign-off (never on an export that carries the internal crew list) ─
  if (model.includeSignOff) {
    const who = (label: string) => `<div class="pe-sign-who">${escHtml(label)}</div><div class="pe-sign-row"><div><div class="pe-sign-line"></div>Name</div><div><div class="pe-sign-line"></div>Signature</div><div><div class="pe-sign-line"></div>Date</div></div>`;
    body.push(`<div class="no-break">${pdfSectionHeader('Sign-off')}<div class="pe-sign">${escHtml(`Signing below confirms the status of each item in this report as shown, generated ${model.generatedAtLabel}.`)}</div>${who('Contractor')}${who("Owner / owner's representative")}</div>`);
  }

  body.push(pdfFooter(
    safeBranding,
    escHtml(`${model.internal ? 'INTERNAL — includes crew list · ' : ''}Punch list · ${model.projectName} · Generated ${model.generatedAtLabel}`),
    PUNCH_EXPORT_DISCLAIMER,
  ));

  const html = pdfShell({ title, branding: safeBranding, bodyHtml: body.join('\n') });
  const at = html.indexOf(CHARSET_META);
  if (at < 0) throw new Error('punchExportHtml: pdfShell no longer writes the charset meta the CSP is anchored to.');
  const cut = at + CHARSET_META.length;
  return `${html.slice(0, cut)}\n<meta http-equiv="Content-Security-Policy" content="${escHtml(buildCsp(allowedOrigins))}">${html.slice(cut)}`;
}
