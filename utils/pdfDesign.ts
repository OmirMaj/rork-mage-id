// pdfDesign.ts — shared visual system for every PDF MAGE ID generates.
//
// Why centralized: invoices, daily reports, AIA pay apps, change orders,
// closeout packets, and the lender draw bundle all need to feel like
// they came from the same business. One place for the palette, type,
// scaffolding, header + footer, stat cards, and money/date formatting.
//
// Mirrors the marketing-site palette (ink + amber + cream + Fraunces
// hero / system body) so the PDFs match what clients see in the portal.
//
// Renderers should compose `pdfShell({ title, eyebrow, bodyHtml, branding })`
// with their own bodyHtml — that gets the consistent header (logo + company
// name + contact strip), title block, footer, and base styles for free.

import type { CompanyBranding } from '@/types';

export const PDF_PALETTE = {
  ink: '#0B0D10',
  ink2: '#1A1D22',
  amber: '#FF6A1A',
  amberDark: '#E5570F',
  amberTint: '#FFF1E6',
  cream: '#F4EFE6',
  cream2: '#FAF7F0',
  surface: '#FFFFFF',
  bone: '#E8DFCD',
  bone2: '#F1EAD9',
  text: '#0B0D10',
  text2: '#4A5159',
  textMuted: '#8B9099',
  success: '#1E8E4A',
  successTint: '#E8F5ED',
  warning: '#C26A00',
  warningTint: '#FFF4E0',
  error: '#C0392B',
  errorTint: '#FBEAE7',
};

export function escHtml(text: string | number | null | undefined): string {
  if (text == null) return '';
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

export function fmtMoney(n: number | null | undefined, opts?: { decimals?: number }): string {
  if (n == null || isNaN(n)) return '—';
  const d = opts?.decimals ?? 0;
  return '$' + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Header block — logo (or M monogram fallback) + company name + tagline +
// contact strip (contact, phone, email, license) wrapped in a centered
// hero rule. Inverts black-on-cream so the brand reads loud.
export function pdfHeader(branding: CompanyBranding): string {
  const logo = branding.logoUri
    ? `<img src="${escHtml(branding.logoUri)}" alt="" style="max-height:46px;max-width:200px;object-fit:contain;margin-bottom:8px" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:11px;background:${PDF_PALETTE.ink};color:${PDF_PALETTE.amber};font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:22px;margin-bottom:8px">${escHtml((branding.companyName || 'M').charAt(0).toUpperCase())}</div>`;

  const contactBits = [
    branding.contactName ? `<span><strong>${escHtml(branding.contactName)}</strong></span>` : '',
    branding.phone ? `<span>${escHtml(branding.phone)}</span>` : '',
    branding.email ? `<span>${escHtml(branding.email)}</span>` : '',
    branding.licenseNumber ? `<span>License ${escHtml(branding.licenseNumber)}</span>` : '',
  ].filter(Boolean).join(' &middot; ');

  return `<div style="text-align:center;padding:0 0 24px;border-bottom:1px solid ${PDF_PALETTE.bone};margin-bottom:32px">
    ${logo}
    <div style="font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:700;letter-spacing:-0.018em;color:${PDF_PALETTE.text}">${escHtml(branding.companyName || 'MAGE ID')}</div>
    ${branding.tagline ? `<div style="font-size:12px;color:${PDF_PALETTE.text2};margin-top:4px;font-style:italic">${escHtml(branding.tagline)}</div>` : ''}
    ${branding.address ? `<div style="font-size:11px;color:${PDF_PALETTE.textMuted};margin-top:6px">${escHtml(branding.address)}</div>` : ''}
    ${contactBits ? `<div style="font-size:11px;color:${PDF_PALETTE.text2};margin-top:6px">${contactBits}</div>` : ''}
  </div>`;
}

// Title block — eyebrow (uppercase amber pill), big serif title, optional
// subtitle. Sits below the header.
export function pdfTitle(opts: { eyebrow?: string; title: string; subtitle?: string; meta?: Array<{ label: string; value: string }> }): string {
  const eyebrowHtml = opts.eyebrow
    ? `<div style="display:inline-block;padding:5px 12px;border-radius:999px;background:${PDF_PALETTE.ink};color:${PDF_PALETTE.amber};font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:12px">${escHtml(opts.eyebrow)}</div>`
    : '';
  const subtitleHtml = opts.subtitle
    ? `<div style="font-size:13px;color:${PDF_PALETTE.text2};margin-top:6px">${escHtml(opts.subtitle)}</div>`
    : '';
  const metaHtml = opts.meta && opts.meta.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:14px;padding-top:14px;border-top:1px solid ${PDF_PALETTE.bone2}">${opts.meta.map(m => `<div><div style="font-size:9px;color:${PDF_PALETTE.textMuted};font-weight:700;letter-spacing:1px;text-transform:uppercase">${escHtml(m.label)}</div><div style="font-size:13px;font-weight:700;color:${PDF_PALETTE.text};margin-top:2px">${escHtml(m.value)}</div></div>`).join('')}</div>`
    : '';
  return `<div style="margin-bottom:28px">
    ${eyebrowHtml}
    <h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:${PDF_PALETTE.text};margin:0">${escHtml(opts.title)}</h1>
    ${subtitleHtml}
    ${metaHtml}
  </div>`;
}

// Stat card grid — used for AIA totals, project KPIs, etc. Each card
// has an uppercase label + serif value.
export function pdfStatGrid(stats: Array<{ label: string; value: string; accent?: 'amber' | 'success' | 'error' }>): string {
  const tint = (a?: string) => a === 'amber' ? PDF_PALETTE.amberDark
    : a === 'success' ? PDF_PALETTE.success
    : a === 'error' ? PDF_PALETTE.error
    : PDF_PALETTE.text;
  return `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin-bottom:24px;table-layout:fixed">
    <tr>${stats.map(s => `<td style="background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone2};border-radius:12px;padding:14px 16px;vertical-align:top">
      <div style="font-size:9px;color:${PDF_PALETTE.textMuted};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">${escHtml(s.label)}</div>
      <div style="font-family:'Fraunces',Georgia,serif;font-size:18px;font-weight:700;letter-spacing:-0.012em;color:${tint(s.accent)}">${escHtml(s.value)}</div>
    </td>`).join('')}</tr>
  </table>`;
}

// Section header — used between blocks within a PDF body.
export function pdfSectionHeader(label: string): string {
  return `<div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${PDF_PALETTE.text};margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">${escHtml(label)}</div>`;
}

// Pill — for status badges in the body (Approved / Pending / etc.)
export function pdfPill(label: string, kind: 'success' | 'warning' | 'error' | 'amber' | 'muted' = 'muted'): string {
  const palette = {
    success: { bg: PDF_PALETTE.successTint, fg: PDF_PALETTE.success },
    warning: { bg: PDF_PALETTE.warningTint, fg: PDF_PALETTE.warning },
    error: { bg: PDF_PALETTE.errorTint, fg: PDF_PALETTE.error },
    amber: { bg: PDF_PALETTE.amberTint, fg: PDF_PALETTE.amberDark },
    muted: { bg: PDF_PALETTE.bone2, fg: PDF_PALETTE.text2 },
  }[kind];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${palette.bg};color:${palette.fg};font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase">${escHtml(label)}</span>`;
}

// Footer — branded sign-off. Always present, so PDFs feel finished.
export function pdfFooter(branding: CompanyBranding, extra?: string): string {
  const company = branding.companyName || 'MAGE ID';
  return `<div style="margin-top:40px;padding-top:16px;border-top:1px solid ${PDF_PALETTE.bone};text-align:center;font-size:10px;color:${PDF_PALETTE.textMuted};line-height:1.6">
    ${extra ? `<div style="margin-bottom:6px">${extra}</div>` : ''}
    <div>${escHtml(company)} &middot; Built with <span style="color:${PDF_PALETTE.text};font-weight:600">MAGE ID</span> &middot; mageid.app</div>
  </div>`;
}

// Top-level wrapper: html + base styles. Every PDF passes through this.
export function pdfShell(opts: {
  bodyHtml: string;
  branding: CompanyBranding;
  title: string;        // for the <title> tag — used in print preview
  pageMargin?: string;  // CSS margin for the body, e.g. '36px 40px'
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHtml(opts.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: ${PDF_PALETTE.text};
    background: ${PDF_PALETTE.surface};
    font-size: 12px;
    line-height: 1.55;
    padding: ${opts.pageMargin ?? '36px 40px'};
    -webkit-font-smoothing: antialiased;
  }
  table { border-collapse: collapse; width: 100%; }
  td, th { vertical-align: top; }
  .num { font-variant-numeric: tabular-nums; }
  /* Print rules — keep page breaks clean */
  @media print {
    body { padding: 24px 28px; }
    .no-break { page-break-inside: avoid; }
  }
</style>
</head>
<body>
${opts.bodyHtml}
</body>
</html>`;
}

// Generic helper for tables that show line items / SOV / etc.
// Pass column defs and rows; produces a clean ink-on-cream table.
export interface TableColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}
export function pdfTable(columns: TableColumn[], rows: string[][]): string {
  const headHtml = columns.map(c => `<th style="text-align:${c.align ?? 'left'};font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${PDF_PALETTE.textMuted};padding:10px 8px;border-bottom:2px solid ${PDF_PALETTE.bone};${c.width ? `width:${c.width};` : ''}">${escHtml(c.header)}</th>`).join('');
  const bodyHtml = rows.map((row, ri) => {
    const cells = row.map((cell, ci) => `<td style="text-align:${columns[ci]?.align ?? 'left'};padding:10px 8px;border-bottom:1px solid ${PDF_PALETTE.bone2};font-size:11.5px">${cell}</td>`).join('');
    const alt = ri % 2 === 1 ? `style="background:${PDF_PALETTE.cream2}"` : '';
    return `<tr ${alt}>${cells}</tr>`;
  }).join('');
  return `<table style="margin-bottom:18px"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}
