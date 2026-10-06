// utils/punchSealHtml.ts — the sealed final punch, printed (lane SEAL).
//
// PURE. Renders ONLY the stored punch_seals row: the manifest the server
// hashed, the signer, the stroke paths, the server's time, the record id and
// the hash. Nothing here reads the phone's punch list, the clock, storage or
// the network. The caller resolves the photos (the after photos from the
// SEALED copies in punch-seals, the before photos from project-photos) and
// passes them keyed by storage path; a photo it could not resolve prints as a
// sentence, never a blank tile, and a before photo that never uploaded prints
// "Before photo not on file".
//
// English (docs/I18N.md, PDFs). No "MAGE ID" anywhere on the record: the seal
// is the contractor's record, not ours. Every piece of stored text goes through
// escHtml.
import type { PunchSeal } from '@/types';
import { PDF_PALETTE, escHtml, pdfSectionHeader, pdfShell } from '@/utils/pdfDesign';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';

export const PUNCH_SEAL_HTML_COPY = {
  eyebrow: 'Sealed Record',
  title: 'Final Punch Accepted',
  statement: (day: string) =>
    `This record certifies that the punch items below were closed, each with an after photo, as of ${day}. It is not a warranty, not a lien release, and it does not release retainage or any payment.`,
  acceptanceHeading: 'Client Acceptance',
  itemsHeading: 'Punch items',
  verifyHeading: 'How to Check This Record',
  verifyBody:
    'The record hash is the SHA-256 of the stored record in canonical JSON. Each after photo was copied into write-once storage when the record was sealed, and its SHA-256 is listed beside it.',
  beforeNotOnFile: 'Before photo not on file',
  photoNotLoaded: 'This photo could not be loaded for this copy.',
  photoOverBudget: 'Not printed. This copy reached its size limit.',
  webPrintedLine: 'Printed from the sealed record. The stored PDF copy is made in the phone app.',
  noLocation: 'No location',
} as const;

export interface PunchSealHtmlOptions {
  /** The company's name for the header ('' prints none). */
  companyName: string;
  /** Resolved image sources keyed by storage path (data: URIs on native, signed URLs on web). */
  photos: Readonly<Record<string, string>>;
  /** Paths left out because the copy reached its size limit (said so, never blank). */
  omitted?: readonly string[];
  /** 'web' adds the printed-from-the-record line (there is no stored PDF from a browser). */
  mode: 'native' | 'web';
}

function day(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatCalendarDay(calendarDayOf(iso) ?? iso, undefined, 'en');
}

const mono = (s: string) => `<span style="font-family:Menlo,Consolas,monospace;font-size:10px;word-break:break-all">${escHtml(s)}</span>`;

function photoCell(label: string, path: string | null, opts: Pick<PunchSealHtmlOptions, 'photos' | 'omitted'>, missingLine: string): string {
  const photos = opts.photos;
  const head = `<div style="font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${PDF_PALETTE.textMuted};margin-bottom:4px">${escHtml(label)}</div>`;
  if (!path) return `${head}<div style="font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(missingLine)}</div>`;
  const src = photos[path];
  if (!src && opts.omitted?.includes(path)) return `${head}<div style="font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(PUNCH_SEAL_HTML_COPY.photoOverBudget)}</div>`;
  if (!src) return `${head}<div style="font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(PUNCH_SEAL_HTML_COPY.photoNotLoaded)}</div>`;
  return `${head}<img src="${escHtml(src)}" alt="" style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;border:1px solid ${PDF_PALETTE.hairline2}" />`;
}

/** The file title for the share sheet / print dialog. */
export function punchSealFileTitle(projectName: string): string {
  const name = projectName.trim() || 'Project';
  return `Final punch record - ${name}`;
}

export function buildPunchSealHtml(seal: PunchSeal, opts: PunchSealHtmlOptions): string {
  const m = seal.manifest;
  const projectName = m?.project?.name ?? '';
  const sealedDay = day(seal.sealedAt);
  const items = Array.isArray(m?.items) ? m.items : [];

  const header = opts.companyName.trim()
    ? `<div style="font-size:20px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:18px">${escHtml(opts.companyName.trim())}</div>`
    : '';

  const title = `<div style="margin-bottom:14px">
    <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:${PDF_PALETTE.ink};color:${PDF_PALETTE.brandOnInk};font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:10px">${escHtml(PUNCH_SEAL_HTML_COPY.eyebrow)}</div>
    <div style="font-size:24px;font-weight:700;color:${PDF_PALETTE.text}">${escHtml(PUNCH_SEAL_HTML_COPY.title)}</div>
    ${projectName ? `<div style="font-size:13px;color:${PDF_PALETTE.text2};margin-top:4px">${escHtml(projectName)}</div>` : ''}
  </div>`;

  const statement = `<p style="font-size:12px;margin-bottom:14px">${escHtml(PUNCH_SEAL_HTML_COPY.statement(sealedDay))}</p>`;

  const metaRows: [string, string][] = [
    ['Sealed', `${escHtml(sealedDay)} &middot; ${mono(seal.sealedAt)}`],
    ['Accepted by', `${escHtml(seal.signerName)}${seal.signerRole ? ` (${escHtml(seal.signerRole)})` : ''}, in person`],
    ['Items', escHtml(String(seal.itemCount))],
    ['Record ID', mono(seal.id)],
    ['Record Hash (SHA-256)', mono(seal.manifestHash)],
  ];
  const meta = `<table style="margin-bottom:8px">${metaRows.map(([k, v]) => `<tr><td style="width:150px;padding:4px 0;color:${PDF_PALETTE.textMuted};font-size:11px">${escHtml(k)}</td><td style="padding:4px 0;font-size:11.5px">${v}</td></tr>`).join('')}</table>`;

  const sig = `<svg width="240" height="96" viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" style="border-bottom:1px solid ${PDF_PALETTE.hairline}">${
    seal.signaturePaths.map((d) => `<path d="${escHtml(d)}" stroke="#0B0D10" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />`).join('')
  }</svg>`;
  const acceptance = `${pdfSectionHeader(PUNCH_SEAL_HTML_COPY.acceptanceHeading)}
    <p style="font-size:11.5px;margin-bottom:6px">${escHtml(m?.statement?.text ?? '')}</p>
    <div style="font-size:10px;color:${PDF_PALETTE.textMuted};margin-bottom:10px">Acceptance text version ${escHtml(seal.consentVersion)}</div>
    <div class="no-break">${sig}<div style="font-size:11px;margin-top:4px">${escHtml(seal.signerName)} &middot; ${escHtml(sealedDay)}</div></div>`;

  const rows = items.map((it, i) => `<div class="no-break" style="border:1px solid ${PDF_PALETTE.hairline2};border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="font-size:12.5px;font-weight:700">${i + 1}. ${escHtml(it.description)}</div>
      <div style="font-size:11px;color:${PDF_PALETTE.text2};margin:2px 0 8px">${escHtml(it.location || PUNCH_SEAL_HTML_COPY.noLocation)}${it.closedAt ? ` &middot; Closed ${escHtml(day(it.closedAt))}` : ''}</div>
      <table style="table-layout:fixed"><tr>
        <td style="padding-right:6px">${photoCell('Before', it.beforePhoto, opts, PUNCH_SEAL_HTML_COPY.beforeNotOnFile)}</td>
        <td style="padding-left:6px">${photoCell('After', it.afterPhoto?.path ?? null, opts, PUNCH_SEAL_HTML_COPY.photoNotLoaded)}</td>
      </tr></table>
      <div style="margin-top:6px;font-size:9.5px;color:${PDF_PALETTE.textMuted}">After photo SHA-256 ${mono(it.afterPhoto?.sha256 ?? '')}</div>
    </div>`).join('');

  const verify = `${pdfSectionHeader(PUNCH_SEAL_HTML_COPY.verifyHeading)}<p style="font-size:11px">${escHtml(PUNCH_SEAL_HTML_COPY.verifyBody)}</p>`;
  const webLine = opts.mode === 'web'
    ? `<p style="font-size:11px;font-style:italic;color:${PDF_PALETTE.text2};margin-top:14px">${escHtml(PUNCH_SEAL_HTML_COPY.webPrintedLine)}</p>`
    : '';
  const footer = `<div style="margin-top:30px;padding-top:12px;border-top:1px solid ${PDF_PALETTE.hairline};text-align:center;font-size:9.5px;color:${PDF_PALETTE.textMuted}">Record ${mono(seal.id)} &middot; SHA-256 ${mono(seal.manifestHash)}</div>`;

  return pdfShell({
    title: punchSealFileTitle(projectName),
    branding: { companyName: opts.companyName, contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' },
    bodyHtml: `${header}${title}${statement}${meta}${webLine}${acceptance}${pdfSectionHeader(PUNCH_SEAL_HTML_COPY.itemsHeading)}${rows}${verify}${footer}`,
  });
}
