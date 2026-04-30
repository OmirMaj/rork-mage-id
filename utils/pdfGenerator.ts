import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding, Project, ChangeOrder, Invoice, DailyFieldReport, ScheduleTask, RFI, Submittal } from '@/types';
import { pdfShell, pdfHeader, pdfTitle, pdfFooter, pdfTable, pdfStatGrid, escHtml, fmtMoney, fmtDate, PDF_PALETTE, PDF_DISCLAIMERS } from './pdfDesign';

// Quick Estimate Wizard result shape — kept here as a local type so we
// don't fight the wizard's local Zod inferred type.
export interface QuickEstimateResultForPdf {
  summary: string;
  lineItems: { category: string; description: string; quantity: number; unit: string; unitCost: number; total: number }[];
  subtotal: number;
  contingency: number;
  permits: number;
  total: number;
  notes: string[];
}

export interface QuickEstimateAnswersForPdf {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
}

// Generate a client-friendly estimate number from today's date + a short
// random suffix. Format: EST-YYYYMMDD-XXXX (e.g. EST-20260429-A4F2). The
// date prefix makes it sortable in a contractor's filing system; the
// random suffix avoids collisions when generating multiple in one day.
function generateEstimateNumber(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EST-${yyyy}${mm}${dd}-${suffix}`;
}

function buildQuickEstimateHtml(
  result: QuickEstimateResultForPdf,
  answers: QuickEstimateAnswersForPdf,
  branding: CompanyBranding,
): string {
  const qualityLabel = answers.quality === 'high_end' ? 'High-End' : answers.quality === 'budget' ? 'Budget' : 'Standard';
  const sizeNum = Number(answers.sizeSqft) || 0;
  const costPerSqft = sizeNum > 0 ? result.total / sizeNum : 0;

  // Estimate metadata — every professional estimate has these. The number
  // gives the client a reference for follow-up, "valid until" creates
  // urgency and honesty (prices ARE only good for a window).
  const estimateNumber = generateEstimateNumber();
  const today = new Date();
  const validUntil = new Date(today);
  validUntil.setDate(validUntil.getDate() + 30);
  const preparedDate = fmtDate(today.toISOString());
  const validUntilDate = fmtDate(validUntil.toISOString());

  // Group line items by category — sorted by spend descending. Most-spend
  // first matches what a homeowner naturally wants to scan ("what costs
  // the most?").
  const grouped = new Map<string, typeof result.lineItems>();
  for (const li of result.lineItems) {
    const cat = li.category || 'Other';
    const arr = grouped.get(cat) ?? [];
    arr.push(li);
    grouped.set(cat, arr);
  }
  const categories = Array.from(grouped.keys()).sort((a, b) => {
    const ta = (grouped.get(a) ?? []).reduce((s, li) => s + li.total, 0);
    const tb = (grouped.get(b) ?? []).reduce((s, li) => s + li.total, 0);
    return tb - ta;
  });

  // ── HERO STATS — what a client wants to see in 3 seconds ──
  // Replaced internal-facing labels ("Categories", "Line items") with the
  // four metrics a homeowner and a contractor actually compare on:
  // total, cost-per-sqft, project size, timeline. "Line items: 23" tells
  // the client nothing useful.
  const heroStats: Array<{ label: string; value: string; accent?: 'amber' | 'success' | 'error' }> = [
    { label: 'Estimated total', value: fmtMoney(result.total), accent: 'amber' },
  ];
  if (costPerSqft > 0) heroStats.push({ label: 'Cost per sqft', value: fmtMoney(costPerSqft, { decimals: 0 }) });
  if (sizeNum > 0) heroStats.push({ label: 'Project size', value: `${sizeNum.toLocaleString()} sqft` });
  if (answers.timelineWeeks) heroStats.push({ label: 'Estimated timeline', value: `${answers.timelineWeeks} weeks` });
  // If we don't have size/timeline, fall back to quality + line item count
  // so the grid still has 4 cells.
  while (heroStats.length < 4) {
    if (heroStats.length === 2) heroStats.push({ label: 'Quality tier', value: qualityLabel });
    else if (heroStats.length === 3) heroStats.push({ label: 'Categories', value: String(categories.length) });
    else break;
  }

  // ── PROJECT INFO BLOCK — formal estimate metadata ──
  // Mirrors how a real construction estimate identifies itself: estimate
  // number, prepared date, validity. "Prepared for" is left soft — most
  // GCs send the same PDF to the client by email so the recipient is
  // implicit.
  const projectInfoBlock = `
    <div class="no-break" style="display:flex;gap:20px;margin:18px 0 24px;padding:16px 18px;border:1px solid ${PDF_PALETTE.bone};border-radius:12px;background:${PDF_PALETTE.cream2}">
      <div style="flex:1">
        <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Estimate #</div>
        <div class="num" style="font-size:13px;font-weight:700;color:${PDF_PALETTE.text};margin-top:3px;letter-spacing:0.4px">${escHtml(estimateNumber)}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Prepared on</div>
        <div style="font-size:13px;font-weight:700;color:${PDF_PALETTE.text};margin-top:3px">${escHtml(preparedDate)}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Valid until</div>
        <div style="font-size:13px;font-weight:700;color:${PDF_PALETTE.amberDark};margin-top:3px">${escHtml(validUntilDate)}</div>
      </div>
      ${answers.location ? `<div style="flex:1.5">
        <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Project location</div>
        <div style="font-size:13px;font-weight:700;color:${PDF_PALETTE.text};margin-top:3px">${escHtml(answers.location)}</div>
      </div>` : ''}
    </div>`;

  // ── SCOPE OF WORK ──
  // Plain-language description of what's being built. Critical for a
  // client estimate — if there's a dispute later, "what was promised"
  // starts here. The AI's summary becomes the lead paragraph; the GC's
  // own scope text (from the wizard) is the second paragraph because
  // it's the human-authored ground truth.
  const scopeBlock = (result.summary || answers.scope) ? `
    <div class="no-break" style="margin-bottom:24px">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">Scope of Work</div>
      ${result.summary ? `<div style="font-size:13px;color:${PDF_PALETTE.text};line-height:1.65;margin-bottom:${answers.scope ? '10px' : '0'}">${escHtml(result.summary)}</div>` : ''}
      ${answers.scope && answers.scope !== result.summary ? `<div style="font-size:13px;color:${PDF_PALETTE.text2};line-height:1.65;font-style:italic">${escHtml(answers.scope)}</div>` : ''}
      ${answers.specialRequirements ? `<div style="font-size:12px;color:${PDF_PALETTE.text2};line-height:1.6;margin-top:10px;padding:10px 12px;background:${PDF_PALETTE.bone2}40;border-radius:8px"><strong style="color:${PDF_PALETTE.text}">Special requirements:</strong> ${escHtml(answers.specialRequirements)}</div>` : ''}
    </div>
  ` : '';

  // ── COST DISTRIBUTION CARD with horizontal bars ──
  const categoryBreakdown = result.total > 0 ? `
    <div class="no-break" style="margin:0 0 24px;padding:18px 20px;border-radius:14px;background:#FFF;border:1px solid ${PDF_PALETTE.bone}">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:14px">Cost Distribution</div>
      ${categories.map(cat => {
        const subtotal = (grouped.get(cat) ?? []).reduce((s, li) => s + li.total, 0);
        const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
        return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="font-weight:600;color:${PDF_PALETTE.text}">${escHtml(cat)}</span>
              <span class="num" style="color:${PDF_PALETTE.text2}"><span style="font-weight:700;color:${PDF_PALETTE.text}">${fmtMoney(subtotal)}</span> &middot; ${pct.toFixed(1)}%</span>
            </div>
            <div style="width:100%;height:6px;background:${PDF_PALETTE.bone2};border-radius:3px;overflow:hidden">
              <div style="width:${Math.max(pct, 0.5).toFixed(2)}%;height:100%;background:${PDF_PALETTE.amber};border-radius:3px"></div>
            </div>
          </div>`;
      }).join('')}
    </div>
  ` : '';

  // ── DETAILED LINE ITEMS — by category ──
  const lineItemSections = categories.map(cat => {
    const items = grouped.get(cat)!;
    const subtotal = items.reduce((s, li) => s + li.total, 0);
    const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
    const rows = items.map(li => [
      escHtml(li.description),
      `<span class="num">${escHtml(li.quantity)} ${escHtml(li.unit)}</span>`,
      `<span class="num">${fmtMoney(li.unitCost, { decimals: 2 })}</span>`,
      `<span class="num" style="font-weight:600">${fmtMoney(li.total)}</span>`,
    ]);
    return `
      <div class="no-break" style="margin-bottom:22px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${PDF_PALETTE.ink};padding-bottom:6px;margin-bottom:6px">
          <div style="font-family:'Fraunces',Georgia,serif;font-size:15px;font-weight:700;color:${PDF_PALETTE.ink}">${escHtml(cat)}</div>
          <div style="display:flex;align-items:baseline;gap:10px">
            <span style="font-size:10px;font-weight:700;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">${pct.toFixed(0)}% &middot; ${items.length} item${items.length === 1 ? '' : 's'}</span>
            <span class="num" style="font-size:13px;font-weight:800;color:${PDF_PALETTE.ink}">${fmtMoney(subtotal)}</span>
          </div>
        </div>
        ${pdfTable(
          [
            { header: 'Item', width: '52%' },
            { header: 'Qty', align: 'right', width: '14%' },
            { header: 'Unit cost', align: 'right', width: '17%' },
            { header: 'Total', align: 'right', width: '17%' },
          ],
          rows,
        )}
      </div>`;
  }).join('');

  // ── TOTALS BLOCK ──
  // Big and clear. No "vs target" — that's an internal data point;
  // showing it on the client copy looks like the GC pre-judging their
  // own number. (We can add it back as an in-app preview field if the
  // GC wants to know.)
  const totalsBlock = `
    <div class="no-break" style="margin-top:10px;padding:22px 24px;border-radius:14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone}">
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px"><span style="color:${PDF_PALETTE.text2}">Line items subtotal</span><span class="num" style="font-weight:600">${fmtMoney(result.subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px"><span style="color:${PDF_PALETTE.text2}">Contingency</span><span class="num" style="font-weight:600">${fmtMoney(result.contingency)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px"><span style="color:${PDF_PALETTE.text2}">Permits & fees</span><span class="num" style="font-weight:600">${fmtMoney(result.permits)}</span></div>
      <div style="height:1px;background:${PDF_PALETTE.bone};margin:14px 0"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Estimated total</div>
          ${costPerSqft > 0 ? `<div style="font-size:12px;color:${PDF_PALETTE.text2};margin-top:4px;font-weight:600">${fmtMoney(costPerSqft, { decimals: 0 })} per sqft &middot; ${sizeNum.toLocaleString()} sqft total</div>` : ''}
        </div>
        <div class="num" style="font-family:'Fraunces',Georgia,serif;font-size:36px;font-weight:800;color:${PDF_PALETTE.amber};letter-spacing:-0.5px;line-height:1">${fmtMoney(result.total)}</div>
      </div>
    </div>`;

  // ── INCLUSIONS / EXCLUSIONS ──
  // Inclusions are derived from the actual category list (so it's
  // honest — these are what we estimated). Exclusions are the standard
  // residential boilerplate that catches 90% of "I thought that was
  // included!" disputes. The GC can edit either by hand if they print
  // and mark up the PDF, but the defaults reflect what most contractors
  // include in their fine print.
  const inclusionsBlock = categories.length > 0 ? `
    <div class="no-break" style="margin-top:24px">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">What's Included</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 10px">
        ${categories.map(cat => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${PDF_PALETTE.successTint};color:${PDF_PALETTE.success};font-size:11px;font-weight:600">${escHtml(cat)}</span>`).join('')}
      </div>
      <div style="font-size:11px;color:${PDF_PALETTE.text2};line-height:1.6;margin-top:10px">
        All labor, materials, equipment, supervision, and required permits for the categories above as detailed in the line items.
      </div>
    </div>
  ` : '';

  const exclusionsBlock = `
    <div class="no-break" style="margin-top:18px">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">What's Not Included</div>
      <div style="font-size:11.5px;color:${PDF_PALETTE.text2};line-height:1.7;padding-left:4px">
        &bull; Architectural / engineering / design fees<br/>
        &bull; HOA, city, or third-party plan-review fees beyond standard permits<br/>
        &bull; Asbestos, lead, mold, or other hazardous-material abatement<br/>
        &bull; Unforeseen conditions discovered after demolition begins<br/>
        &bull; Landscaping, fencing, or exterior work outside the stated scope<br/>
        &bull; Owner-supplied materials or fixtures (handled separately)<br/>
        &bull; Sales tax (included where required by law) &middot; Financing costs &middot; Insurance riders
      </div>
    </div>`;

  // ── PAYMENT TERMS ──
  // Industry-standard residential remodel terms. The GC can override by
  // editing the PDF or, eventually, by adjusting in settings. The terms
  // shown reduce ambiguity for the homeowner ("when do I owe what?")
  // which dramatically reduces collection issues.
  const depositPct = 25;
  const completionPct = 10;
  const progressPct = 100 - depositPct - completionPct;
  const depositAmt = result.total * depositPct / 100;
  const progressAmt = result.total * progressPct / 100;
  const completionAmt = result.total * completionPct / 100;
  const paymentTermsBlock = `
    <div class="no-break" style="margin-top:24px">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.text};margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">Payment Terms</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="background:${PDF_PALETTE.cream2}">
          <td style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-weight:600;color:${PDF_PALETTE.text}">Deposit (${depositPct}%)</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};color:${PDF_PALETTE.text2}">Due upon signed agreement, before work begins</td>
          <td class="num" style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};text-align:right;font-weight:700;color:${PDF_PALETTE.text}">${fmtMoney(depositAmt)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-weight:600;color:${PDF_PALETTE.text}">Progress (${progressPct}%)</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};color:${PDF_PALETTE.text2}">Billed against documented progress per contract schedule</td>
          <td class="num" style="padding:10px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};text-align:right;font-weight:700;color:${PDF_PALETTE.text}">${fmtMoney(progressAmt)}</td>
        </tr>
        <tr style="background:${PDF_PALETTE.cream2}">
          <td style="padding:10px 12px;font-weight:600;color:${PDF_PALETTE.text}">Final (${completionPct}%)</td>
          <td style="padding:10px 12px;color:${PDF_PALETTE.text2}">Due at substantial completion, after walk-through and punch list</td>
          <td class="num" style="padding:10px 12px;text-align:right;font-weight:700;color:${PDF_PALETTE.text}">${fmtMoney(completionAmt)}</td>
        </tr>
      </table>
    </div>`;

  // ── ACCEPTANCE / NEXT STEPS ──
  // Soft call-to-action. Doesn't bind the client — that's what the
  // contract is for — but tells them what to do next. Includes the
  // contractor's contact line so the client can reach back without
  // hunting through the document.
  const contactLine = [
    branding.contactName,
    branding.phone,
    branding.email,
  ].filter(Boolean).join(' &middot; ');
  const acceptanceBlock = `
    <div class="no-break" style="margin-top:28px;padding:20px 22px;border-radius:14px;background:${PDF_PALETTE.ink};color:${PDF_PALETTE.cream2}">
      <div style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700;color:${PDF_PALETTE.amber};margin-bottom:8px">Ready to move forward?</div>
      <div style="font-size:12.5px;line-height:1.65;color:${PDF_PALETTE.cream2};margin-bottom:12px">
        To proceed, please reply to this estimate with your approval, and we'll prepare a formal contract reflecting the scope and terms above. Final pricing is locked once the contract is signed and the deposit received.
      </div>
      ${contactLine ? `<div style="font-size:11px;color:${PDF_PALETTE.bone2};border-top:1px solid #FFFFFF20;padding-top:10px;margin-top:10px">Questions? Contact ${contactLine}</div>` : ''}
    </div>`;

  // ── NOTES (kept, but only if the AI returned any) ──
  const notesBlock = result.notes.length === 0 ? '' : `
    <div class="no-break" style="margin-top:18px;padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.amberTint};border:1px solid ${PDF_PALETTE.amber}40">
      <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:${PDF_PALETTE.amber};text-transform:uppercase;margin-bottom:8px">Project Notes</div>
      ${result.notes.map(n => `<div style="font-size:12px;color:${PDF_PALETTE.text};margin-bottom:4px;line-height:1.55">• ${escHtml(n)}</div>`).join('')}
    </div>`;

  // ── BODY ASSEMBLY ──
  // Title eyebrow is "Construction Estimate" (not "Quick Estimate") —
  // "Quick" telegraphs "rushed/cheap" to a client. The doc title in the
  // browser/print preview is also de-AI'd.
  // Disclaimer uses the centralized PDF_DISCLAIMERS.estimate copy, which
  // is professional and frames the doc as an estimate (not a quote)
  // without hinting that AI was involved.
  const bodyHtml = `
    ${pdfHeader(branding)}
    ${pdfTitle({
      eyebrow: 'Construction Estimate',
      title: answers.projectType || 'Project Estimate',
      meta: [], // moved into projectInfoBlock below for a more formal layout
    })}
    ${projectInfoBlock}
    <div style="margin-top:8px">${pdfStatGrid(heroStats)}</div>
    ${scopeBlock}
    ${categoryBreakdown}
    <div style="font-family:'Fraunces',Georgia,serif;font-size:18px;font-weight:700;color:${PDF_PALETTE.text};margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid ${PDF_PALETTE.bone2}">Detailed Line Items</div>
    ${lineItemSections || `<div style="padding:20px;text-align:center;color:${PDF_PALETTE.textMuted};font-style:italic">No line items provided.</div>`}
    ${totalsBlock}
    ${inclusionsBlock}
    ${exclusionsBlock}
    ${paymentTermsBlock}
    ${notesBlock}
    ${acceptanceBlock}
    ${pdfFooter(branding, branding.licenseNumber ? `License #${escHtml(branding.licenseNumber)}` : undefined, PDF_DISCLAIMERS.estimate)}
  `;

  return pdfShell({
    bodyHtml,
    branding,
    title: `Estimate ${estimateNumber} — ${answers.projectType || 'Construction'}`,
  });
}

export async function generateQuickEstimatePDFUri(
  result: QuickEstimateResultForPdf,
  answers: QuickEstimateAnswersForPdf,
  branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildQuickEstimateHtml(result, answers, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    return uri;
  } catch (err) {
    console.error('[PDF] Quick estimate PDF failed:', err);
    return null;
  }
}

export async function shareQuickEstimatePDF(
  result: QuickEstimateResultForPdf,
  answers: QuickEstimateAnswersForPdf,
  branding: CompanyBranding,
): Promise<void> {
  const html = buildQuickEstimateHtml(result, answers, branding);
  const title = `Quick Estimate — ${answers.projectType || 'Construction'}`;

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildSignatureSvg(paths: string[]): string {
  if (!paths || paths.length === 0) return '';
  const pathElements = paths.map(d =>
    `<path d="${escapeHtml(d)}" stroke="#1a1a1a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('');
  return `<svg width="200" height="80" viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" style="border-bottom:1px solid #ccc">${pathElements}</svg>`;
}

function buildEstimateHtml(
  project: Project,
  branding: CompanyBranding,
): string {
  const est = project.linkedEstimate;
  const legacyEst = project.estimate;
  const schedule = project.schedule;
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Company Logo" /></div>`
    : '';

  const companyBlock = branding.companyName
    ? `<div class="company-header">
        ${logoBlock}
        <div class="company-name">${escapeHtml(branding.companyName)}</div>
        ${branding.tagline ? `<div class="tagline">${escapeHtml(branding.tagline)}</div>` : ''}
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.address ? `<div class="info-item"><span class="info-label">Address</span><span>${escapeHtml(branding.address)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div>
      </div>`
    : `<div class="company-header"><div class="company-name">MAGE ID Estimate</div></div>`;

  let itemsHtml = '';

  if (est && est.items.length > 0) {
    itemsHtml = `
      <h2>Materials & Items</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:30%">Item</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Markup</th>
            <th style="text-align:right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${est.items.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${item.quantity} ${escapeHtml(item.unit)}</td>
              <td>${formatCurrency(item.unitPrice)}</td>
              <td>${item.markup}%</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.lineTotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="summary-box">
        <div class="summary-row"><span>Base Cost</span><span>${formatCurrency(est.baseTotal)}</span></div>
        <div class="summary-row"><span>Markup (${est.globalMarkup}%)</span><span>+${formatCurrency(est.markupTotal)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-row total"><span>Estimate Total</span><span>${formatCurrency(est.grandTotal)}</span></div>
      </div>`;
  } else if (legacyEst) {
    itemsHtml = `
      <h2>Materials</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:35%">Item</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${legacyEst.materials.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${item.quantity} ${escapeHtml(item.unit)}</td>
              <td>${formatCurrency(item.unitPrice)}</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.totalPrice)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h2>Labor</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:40%">Role</th>
            <th>Rate/hr</th>
            <th>Hours</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${legacyEst.labor.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.role)}</td>
              <td>${formatCurrency(item.hourlyRate)}</td>
              <td>${item.hours}h</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.totalCost)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="summary-box">
        <div class="summary-row"><span>Materials</span><span>${formatCurrency(legacyEst.materialTotal)}</span></div>
        <div class="summary-row"><span>Labor</span><span>${formatCurrency(legacyEst.laborTotal)}</span></div>
        <div class="summary-row"><span>Permits & Fees</span><span>${formatCurrency(legacyEst.permits)}</span></div>
        <div class="summary-row"><span>Overhead</span><span>${formatCurrency(legacyEst.overhead)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-row"><span>Subtotal</span><span>${formatCurrency(legacyEst.subtotal)}</span></div>
        <div class="summary-row"><span>Tax</span><span>${formatCurrency(legacyEst.tax)}</span></div>
        <div class="summary-row"><span>Contingency</span><span>${formatCurrency(legacyEst.contingency)}</span></div>
        <div class="summary-row savings"><span>Bulk Savings</span><span>-${formatCurrency(legacyEst.bulkSavingsTotal)}</span></div>
        <div class="summary-divider thick"></div>
        <div class="summary-row total"><span>Grand Total</span><span>${formatCurrency(legacyEst.grandTotal)}</span></div>
        ${legacyEst.pricePerSqFt > 0 ? `<div class="summary-row sub"><span>Price per Sq Ft</span><span>${formatCurrency(legacyEst.pricePerSqFt)}</span></div>` : ''}
        ${legacyEst.estimatedDuration ? `<div class="summary-row sub"><span>Est. Duration</span><span>${escapeHtml(legacyEst.estimatedDuration)}</span></div>` : ''}
      </div>`;
  }

  let scheduleHtml = '';
  if (schedule && schedule.tasks.length > 0) {
    const milestones = schedule.tasks.filter(t => t.isMilestone);
    const criticalTasks = schedule.tasks.filter(t => t.isCriticalPath);
    const totalDays = Math.max(1, schedule.totalDurationDays || 1);
    const hasWbs = schedule.tasks.some(t => t.wbsCode);

    // Build month/week tick labels along the top of the timeline.
    // We emit ~10 evenly-spaced ticks regardless of project length so the
    // axis stays legible on long schedules.
    const tickCount = Math.min(10, Math.max(4, Math.floor(totalDays / 7)));
    const tickLabels: string[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const day = Math.round((totalDays * i) / tickCount);
      const leftPct = (i / tickCount) * 100;
      tickLabels.push(
        `<div class="gx-tick" style="left:${leftPct}%">${day === 0 ? 'Start' : `D${day}`}</div>`,
      );
    }

    const ganttRows = schedule.tasks.map((task, i) => {
      const startDay = Math.max(1, task.startDay || 1);
      const dur = Math.max(0, task.durationDays || 0);
      const leftPct = ((startDay - 1) / totalDays) * 100;
      const widthPct = Math.max(0.3, (dur / totalDays) * 100);
      const critical = !!task.isCriticalPath;
      const isSummary = !!(task as ScheduleTask & { isSummary?: boolean }).isSummary;
      const isMilestone = !!task.isMilestone || dur === 0;
      const indent = Math.max(0, (task.outlineLevel ?? 0)) * 10;
      const progress = Math.max(0, Math.min(100, task.progress ?? 0));

      const barStyle = isMilestone
        ? `left:calc(${leftPct}% - 4px);width:8px;height:8px;transform:rotate(45deg);background:${critical ? '#FF3B30' : '#1A6B3C'};top:8px;border-radius:1px;`
        : isSummary
          ? `left:${leftPct}%;width:${widthPct}%;height:5px;background:#1a1a1a;top:10px;border-radius:1px;`
          : `left:${leftPct}%;width:${widthPct}%;height:12px;top:6px;background:${critical ? '#FFDDDA' : '#E8F3EC'};border:1.4px solid ${critical ? '#FF3B30' : '#1A6B3C'};border-radius:3px;`;

      const progressOverlay = !isSummary && !isMilestone && progress > 0
        ? `<div class="gx-progress" style="left:${leftPct}%;width:${(widthPct * progress) / 100}%;top:9px;background:${critical ? '#FF3B30' : '#1A6B3C'};"></div>`
        : '';

      const flags: string[] = [];
      if (task.isMilestone) flags.push('<span class="flag milestone">◆</span>');
      if (task.isCriticalPath) flags.push('<span class="flag critical">C</span>');

      return `
        <tr class="${i % 2 === 0 ? 'alt' : ''}">
          <td class="gx-num">${i + 1}</td>
          <td class="gx-title" style="padding-left:${8 + indent}px">${isSummary ? '<b>' : ''}${escapeHtml(task.title)}${isSummary ? '</b>' : ''}</td>
          ${hasWbs ? `<td class="gx-wbs">${task.wbsCode ? escapeHtml(task.wbsCode) : '-'}</td>` : ''}
          <td class="gx-num">D${task.startDay}</td>
          <td class="gx-num">${task.durationDays}d</td>
          <td class="gx-num">${progress}%</td>
          <td class="gx-crew">${escapeHtml(task.crew || '')}</td>
          <td class="gx-flags">${flags.join(' ') || ''}</td>
          <td class="gx-timeline">
            <div class="gx-bar" style="${barStyle}"></div>
            ${progressOverlay}
          </td>
        </tr>`;
    }).join('');

    scheduleHtml = `
      <div class="page-break"></div>
      <h2>Project Schedule</h2>
      <div class="schedule-stats">
        <div class="schedule-stat"><strong>${schedule.totalDurationDays}</strong> days total</div>
        <div class="schedule-stat"><strong>${schedule.criticalPathDays}</strong> critical path</div>
        <div class="schedule-stat"><strong>${schedule.tasks.length}</strong> tasks</div>
        ${milestones.length > 0 ? `<div class="schedule-stat"><strong>${milestones.length}</strong> milestones</div>` : ''}
      </div>

      <table class="gx-table">
        <colgroup>
          <col style="width:24px" />
          <col style="width:170px" />
          ${hasWbs ? '<col style="width:48px" />' : ''}
          <col style="width:42px" />
          <col style="width:36px" />
          <col style="width:36px" />
          <col style="width:72px" />
          <col style="width:36px" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align:left">Task</th>
            ${hasWbs ? '<th>WBS</th>' : ''}
            <th>Start</th>
            <th>Dur</th>
            <th>%</th>
            <th>Crew</th>
            <th></th>
            <th class="gx-axis-head">
              <div class="gx-ticks">${tickLabels.join('')}</div>
            </th>
          </tr>
        </thead>
        <tbody>${ganttRows}</tbody>
      </table>

      <div class="gx-legend">
        <div class="gx-legend-item"><span class="gx-swatch" style="background:#E8F3EC;border:1.4px solid #1A6B3C"></span>On-time task</div>
        <div class="gx-legend-item"><span class="gx-swatch" style="background:#FFDDDA;border:1.4px solid #FF3B30"></span>Critical</div>
        <div class="gx-legend-item"><span class="gx-swatch" style="background:#1a1a1a;height:4px"></span>Summary roll-up</div>
        <div class="gx-legend-item"><span class="gx-swatch" style="background:#1A6B3C;width:8px;height:8px;transform:rotate(45deg);border-radius:0"></span>Milestone</div>
        <div class="gx-legend-item"><span class="gx-swatch" style="background:#1A6B3C;opacity:0.85;height:5px"></span>% complete</div>
      </div>

      ${criticalTasks.length > 0 ? `
        <h3>Critical Path</h3>
        <div class="critical-path-chain">
          ${criticalTasks.map((t, i) => `
            <span class="critical-node">${escapeHtml(t.title)} (${t.durationDays}d)</span>
            ${i < criticalTasks.length - 1 ? '<span class="critical-arrow">→</span>' : ''}
          `).join('')}
        </div>
      ` : ''}
      ${milestones.length > 0 ? `
        <h3>Milestones</h3>
        <div class="milestones-list">
          ${milestones.map(m => `
            <div class="milestone-item">
              <span class="milestone-flag">◆</span>
              <span class="milestone-name">${escapeHtml(m.title)}</span>
              <span class="milestone-day">Day ${m.startDay}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}`;
  }

  const signatureBlock = branding.signatureData && branding.signatureData.length > 0
    ? `<div class="signature-section">
        <div class="signature-label">Authorized Signature</div>
        <div class="signature-drawing">${buildSignatureSvg(branding.signatureData)}</div>
        ${branding.contactName ? `<div class="signature-name">${escapeHtml(branding.contactName)}</div>` : ''}
        ${branding.companyName ? `<div class="signature-company">${escapeHtml(branding.companyName)}</div>` : ''}
        <div class="signature-date">Date: ${now}</div>
      </div>`
    : `<div class="signature-section">
        <div class="signature-label">Authorized Signature</div>
        <div class="signature-line"></div>
        ${branding.contactName ? `<div class="signature-name">${escapeHtml(branding.contactName)}</div>` : ''}
        <div class="signature-date">Date: _______________</div>
      </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; font-size: 12px; line-height: 1.5; }
  .company-header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 3px solid #1A6B3C; }
  .logo-wrap { margin-bottom: 12px; }
  .company-logo { max-height: 60px; max-width: 240px; object-fit: contain; }
  .company-name { font-size: 28px; font-weight: 800; color: #1A6B3C; letter-spacing: -0.5px; }
  .tagline { font-size: 13px; color: #666; margin-top: 4px; font-style: italic; }
  .company-info-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 20px; margin-top: 10px; }
  .info-item { font-size: 11px; color: #555; }
  .info-label { font-weight: 600; color: #333; margin-right: 4px; }
  .project-info { background: linear-gradient(135deg, #f8f9fa, #eef2f0); border-radius: 8px; padding: 18px; margin-bottom: 24px; border-left: 4px solid #1A6B3C; }
  .project-name { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #1a1a1a; }
  .project-meta { font-size: 11px; color: #666; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  h2 { font-size: 16px; font-weight: 700; color: #1A6B3C; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #1A6B3C20; }
  h3 { font-size: 14px; font-weight: 600; color: #333; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  th { background: #1A6B3C08; padding: 8px 10px; text-align: center; font-weight: 600; color: #555; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; border-bottom: 2px solid #1A6B3C20; }
  td { padding: 7px 10px; text-align: center; border-bottom: 1px solid #eee; }
  tr.alt { background: #fafbfa; }
  .summary-box { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-top: 12px; border: 1px solid #e8e8e8; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; }
  .summary-row.total { font-size: 18px; font-weight: 800; color: #1A6B3C; padding: 10px 0 0; }
  .summary-row.savings { color: #34C759; font-weight: 500; }
  .summary-row.sub { font-size: 11px; color: #888; padding: 2px 0; }
  .summary-divider { height: 1px; background: #ddd; margin: 8px 0; }
  .summary-divider.thick { height: 2px; background: #1A6B3C; }
  .schedule-stats { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .schedule-stat { background: #f0f4f2; border-radius: 6px; padding: 8px 14px; font-size: 12px; border: 1px solid #e0e8e4; }
  .schedule-stat strong { color: #1A6B3C; }
  .flag { font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
  .flag.milestone { background: #FFF3E0; color: #FF9500; }
  .flag.critical { background: #FFF0EF; color: #FF3B30; }
  .critical-path-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 16px; }
  .critical-node { background: #FFF0EF; color: #FF3B30; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 500; }
  .critical-arrow { color: #FF3B30; font-weight: 700; }
  .milestones-list { margin-bottom: 16px; }
  .milestone-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
  .milestone-flag { color: #FF9500; }
  .milestone-name { font-weight: 500; flex: 1; }
  .milestone-day { color: #888; font-size: 11px; }
  .signature-section { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; }
  .signature-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  .signature-drawing { margin-bottom: 8px; }
  .signature-line { width: 200px; height: 1px; background: #333; margin-bottom: 8px; margin-top: 40px; }
  .signature-name { font-size: 13px; font-weight: 600; color: #333; }
  .signature-company { font-size: 11px; color: #666; }
  .signature-date { font-size: 11px; color: #888; margin-top: 4px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 10px; color: #999; }
  .page-break { page-break-before: always; }

  /* Gantt chart (MAGE schedule) */
  .gx-table { table-layout: fixed; width: 100%; font-size: 9.5px; }
  .gx-table thead th { padding: 5px 6px; font-size: 8px; }
  .gx-table td { padding: 4px 6px; font-size: 9.5px; vertical-align: middle; border-bottom: 1px solid #eee; }
  .gx-num { text-align: right; font-variant-numeric: tabular-nums; color: #333; }
  .gx-title { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gx-wbs { text-align: center; color: #666; font-variant-numeric: tabular-nums; }
  .gx-crew { text-align: left; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gx-flags { text-align: center; }
  .gx-timeline { position: relative; height: 22px; padding: 0; background: repeating-linear-gradient(to right, transparent 0 calc(100% / 20 - 1px), #f4f4f4 calc(100% / 20 - 1px) calc(100% / 20)); }
  .gx-bar { position: absolute; box-shadow: 0 1px 0 rgba(0,0,0,0.05); }
  .gx-progress { position: absolute; height: 5px; opacity: 0.9; border-radius: 2px; }
  .gx-axis-head { padding: 0 !important; background: #fafbfa; position: relative; height: 18px; }
  .gx-ticks { position: relative; height: 18px; }
  .gx-tick { position: absolute; top: 3px; font-size: 8px; color: #666; transform: translateX(-50%); }
  .gx-legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 10px 0 16px; padding: 10px 14px; background: #fafbfa; border: 1px solid #eee; border-radius: 6px; font-size: 10px; color: #555; }
  .gx-legend-item { display: flex; align-items: center; gap: 6px; }
  .gx-swatch { display: inline-block; width: 14px; height: 8px; border-radius: 2px; vertical-align: middle; }
  tr { page-break-inside: avoid; }

  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  ${companyBlock}
  <div class="project-info">
    <div class="project-name">${escapeHtml(project.name)}</div>
    <div class="project-meta">
      <span>Date: ${now}</span>
      <span>Location: ${escapeHtml(project.location)}</span>
      ${project.squareFootage > 0 ? `<span>Area: ${project.squareFootage.toLocaleString()} sq ft</span>` : ''}
      <span>Type: ${escapeHtml(project.type.replace(/_/g, ' '))}</span>
    </div>
    ${project.description ? `<p style="margin-top:8px;font-size:12px;color:#555">${escapeHtml(project.description)}</p>` : ''}
  </div>
  ${itemsHtml}
  ${scheduleHtml}
  ${signatureBlock}
  <div class="footer">
    ${branding.companyName ? `Generated by ${escapeHtml(branding.companyName)}` : 'Generated by MAGE ID'} · ${now}
    ${branding.phone ? ` · ${escapeHtml(branding.phone)}` : ''}
    ${branding.email ? ` · ${escapeHtml(branding.email)}` : ''}
  </div>
</body>
</html>`;
}

export async function generateEstimatePDFUri(
  project: Project,
  branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildEstimateHtml(project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Estimate PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating estimate PDF URI:', error);
    return null;
  }
}

export async function generateAndSharePDF(
  project: Project,
  branding: CompanyBranding,
  method: 'email' | 'share',
): Promise<void> {
  console.log('[PDF] Generating PDF for project:', project.name, 'method:', method);
  const html = buildEstimateHtml(project, branding);

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }

  try {
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });
    console.log('[PDF] File created at:', uri);

    if (method === 'share') {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${project.name} Estimate`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        console.log('[PDF] Sharing not available, printing instead');
        await Print.printAsync({ uri });
      }
    } else {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${project.name} Estimate`,
        UTI: 'com.adobe.pdf',
      });
    }
  } catch (error) {
    console.error('[PDF] Error generating PDF:', error);
    throw error;
  }
}

function buildChangeOrderHtml(co: ChangeOrder, project: Project, branding: CompanyBranding): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const D = require('@/utils/pdfDesign') as typeof import('@/utils/pdfDesign');
  const now = D.fmtDate(co.date || new Date().toISOString());
  const pillKind: 'success' | 'warning' | 'error' | 'muted' =
    co.status === 'approved' ? 'success'
    : co.status === 'rejected' ? 'error'
    : co.status === 'draft' || co.status === 'void' ? 'muted'
    : 'warning';

  const titleHtml = D.pdfTitle({
    eyebrow: `Change order #${co.number}`,
    title: project.name,
    subtitle: co.description || undefined,
    meta: [
      { label: 'Date', value: now },
      { label: 'Status', value: D.escHtml(co.status.replace(/_/g, ' ')) },
      ...(co.scheduleImpactDays ? [{ label: 'Schedule impact', value: `${co.scheduleImpactDays} day${co.scheduleImpactDays === 1 ? '' : 's'}` }] : []),
    ],
  });
  const statusBadge = `<div style="margin-bottom:18px">${D.pdfPill(co.status.replace(/_/g, ' '), pillKind)}</div>`;
  const reasonHtml = co.reason
    ? `<div style="background:${D.PDF_PALETTE.cream2};border:1px solid ${D.PDF_PALETTE.bone2};border-radius:12px;padding:14px 18px;margin-bottom:20px"><div style="font-size:9px;font-weight:700;color:${D.PDF_PALETTE.textMuted};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Reason</div><div style="font-size:13px;color:${D.PDF_PALETTE.text};line-height:1.55">${D.escHtml(co.reason)}</div></div>`
    : '';

  const lineRows = co.lineItems.map(li => [
    `<div style="font-weight:600">${D.escHtml(li.name)}${li.isNew ? ` <span style="color:${D.PDF_PALETTE.amber};font-size:9px;font-weight:700;letter-spacing:0.5px;margin-left:4px">[NEW]</span>` : ''}</div>${li.description ? `<div style="font-size:10px;color:${D.PDF_PALETTE.textMuted};margin-top:2px">${D.escHtml(li.description)}</div>` : ''}`,
    `<span class="num">${li.quantity}</span>`,
    D.escHtml(li.unit),
    `<span class="num">${D.fmtMoney(li.unitPrice, { decimals: 2 })}</span>`,
    `<span class="num" style="font-weight:700">${D.fmtMoney(li.total, { decimals: 2 })}</span>`,
  ]);
  const tableHtml = D.pdfSectionHeader('Line items') + D.pdfTable(
    [
      { header: 'Item', align: 'left', width: '38%' },
      { header: 'Qty', align: 'right' },
      { header: 'Unit', align: 'left' },
      { header: 'Unit Price', align: 'right' },
      { header: 'Total', align: 'right' },
    ],
    lineRows,
  );

  const sign = co.changeAmount >= 0 ? '+' : '−';
  const totalsBlock = `<div class="no-break" style="background:${D.PDF_PALETTE.cream2};border:1px solid ${D.PDF_PALETTE.bone2};border-radius:14px;padding:18px 20px;margin-top:18px">
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px"><span style="color:${D.PDF_PALETTE.text2}">Original contract value</span><span class="num">${D.fmtMoney(co.originalContractValue, { decimals: 2 })}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:${co.changeAmount >= 0 ? D.PDF_PALETTE.amberDark : D.PDF_PALETTE.success};font-weight:600"><span>This change order</span><span class="num">${sign}${D.fmtMoney(Math.abs(co.changeAmount), { decimals: 2 })}</span></div>
    <div style="height:1.5px;background:${D.PDF_PALETTE.ink};margin:8px 0"></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0">
      <span style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700">New contract total</span>
      <span class="num" style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:700;color:${D.PDF_PALETTE.amber};letter-spacing:-0.012em">${D.fmtMoney(co.newContractTotal, { decimals: 2 })}</span>
    </div>
  </div>`;

  const sigBlock = `<div class="no-break" style="margin-top:36px;padding-top:24px;border-top:1px solid ${D.PDF_PALETTE.bone}">
    <div style="font-size:9px;font-weight:700;color:${D.PDF_PALETTE.textMuted};letter-spacing:1px;text-transform:uppercase;margin-bottom:24px">Client approval</div>
    <table style="width:100%"><tr>
      <td style="width:65%;padding-right:24px"><div style="border-bottom:1px solid ${D.PDF_PALETTE.text};height:36px"></div><div style="font-size:10px;color:${D.PDF_PALETTE.textMuted};margin-top:6px">Client signature</div></td>
      <td><div style="border-bottom:1px solid ${D.PDF_PALETTE.text};height:36px"></div><div style="font-size:10px;color:${D.PDF_PALETTE.textMuted};margin-top:6px">Date</div></td>
    </tr></table>
  </div>`;

  return D.pdfShell({
    title: `Change order #${co.number} — ${project.name}`,
    branding,
    bodyHtml:
      D.pdfHeader(branding) + titleHtml + statusBadge + reasonHtml + tableHtml + totalsBlock + sigBlock +
      D.pdfFooter(branding, `Change order #${co.number}`, D.PDF_DISCLAIMERS.changeOrder),
  });
}

function buildInvoiceHtml(inv: Invoice, project: Project, branding: CompanyBranding): string {
  // Refreshed to the ink+amber+cream design system shared with every
  // other PDF MAGE ID generates. See utils/pdfDesign.ts for the helpers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const D = require('@/utils/pdfDesign') as typeof import('@/utils/pdfDesign');
  const termsLabel = inv.paymentTerms.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  const balance = Math.max(0, inv.totalDue - inv.amountPaid);

  const headerHtml = D.pdfHeader(branding);
  const titleHtml = D.pdfTitle({
    eyebrow: inv.type === 'progress' ? `Progress invoice #${inv.number}` : `Invoice #${inv.number}`,
    title: project.name,
    subtitle: inv.type === 'progress' && inv.progressPercent
      ? `${inv.progressPercent}% of contract value`
      : undefined,
    meta: [
      { label: 'Issued', value: D.fmtDate(inv.issueDate) },
      { label: 'Due', value: D.fmtDate(inv.dueDate) },
      { label: 'Terms', value: termsLabel },
    ],
  });

  const lineRows = inv.lineItems.map(li => [
    `<div style="font-weight:600">${D.escHtml(li.name)}</div>${li.description ? `<div style="font-size:10px;color:${D.PDF_PALETTE.textMuted};margin-top:2px">${D.escHtml(li.description)}</div>` : ''}`,
    `<span class="num">${li.quantity}</span>`,
    D.escHtml(li.unit),
    `<span class="num">${D.fmtMoney(li.unitPrice, { decimals: 2 })}</span>`,
    `<span class="num" style="font-weight:700">${D.fmtMoney(li.total, { decimals: 2 })}</span>`,
  ]);
  const tableHtml = D.pdfTable(
    [
      { header: 'Item', align: 'left', width: '38%' },
      { header: 'Qty', align: 'right' },
      { header: 'Unit', align: 'left' },
      { header: 'Unit Price', align: 'right' },
      { header: 'Total', align: 'right' },
    ],
    lineRows,
  );

  const totalsRows = [
    `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px"><span style="color:${D.PDF_PALETTE.text2}">Subtotal</span><span class="num">${D.fmtMoney(inv.subtotal, { decimals: 2 })}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px"><span style="color:${D.PDF_PALETTE.text2}">Tax (${inv.taxRate}%)</span><span class="num">${D.fmtMoney(inv.taxAmount, { decimals: 2 })}</span></div>`,
    inv.retentionAmount && inv.retentionAmount > 0
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px"><span style="color:${D.PDF_PALETTE.text2}">Retainage${inv.retentionPercent ? ` (${inv.retentionPercent}%)` : ''}</span><span class="num">−${D.fmtMoney(inv.retentionAmount, { decimals: 2 })}</span></div>`
      : '',
  ].filter(Boolean).join('');
  const totalsBlock = `<div style="background:${D.PDF_PALETTE.cream2};border:1px solid ${D.PDF_PALETTE.bone2};border-radius:14px;padding:18px 20px;margin-top:18px">
    ${totalsRows}
    <div style="height:1.5px;background:${D.PDF_PALETTE.ink};margin:8px 0"></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0">
      <span style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700">Total Due</span>
      <span class="num" style="font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:700;color:${D.PDF_PALETTE.amber};letter-spacing:-0.012em">${D.fmtMoney(inv.totalDue, { decimals: 2 })}</span>
    </div>
    ${inv.amountPaid > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;color:${D.PDF_PALETTE.success}"><span>Paid to date</span><span class="num">−${D.fmtMoney(inv.amountPaid, { decimals: 2 })}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0 0;border-top:1px solid ${D.PDF_PALETTE.bone2};margin-top:6px">
        <span style="font-family:'Fraunces',Georgia,serif;font-size:14px;font-weight:700">${balance > 0 ? 'Balance due' : 'Paid in full'}</span>
        <span class="num" style="font-family:'Fraunces',Georgia,serif;font-size:18px;font-weight:700;color:${balance > 0 ? D.PDF_PALETTE.amberDark : D.PDF_PALETTE.success}">${D.fmtMoney(balance, { decimals: 2 })}</span>
      </div>
    ` : ''}
  </div>`;

  const notesHtml = inv.notes
    ? `<div style="margin-top:18px;padding:14px 16px;background:${D.PDF_PALETTE.cream2};border-radius:12px;border:1px solid ${D.PDF_PALETTE.bone2}">
        <div style="font-size:9px;font-weight:700;color:${D.PDF_PALETTE.textMuted};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Notes</div>
        <div style="font-size:12px;color:${D.PDF_PALETTE.text2};line-height:1.55;white-space:pre-wrap">${D.escHtml(inv.notes)}</div>
      </div>`
    : '';

  return D.pdfShell({
    title: `Invoice #${inv.number} — ${project.name}`,
    branding,
    bodyHtml: headerHtml + titleHtml + tableHtml + totalsBlock + notesHtml +
      D.pdfFooter(branding, `Invoice #${inv.number}`, D.PDF_DISCLAIMERS.invoice),
  });
}

function buildDFRHtml(dfr: DailyFieldReport, project: Project, branding: CompanyBranding): string {
  const reportDate = new Date(dfr.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div></div>`
    : `<div class="company-header"><div class="company-name">Daily Field Report</div></div>`;

  // Refreshed to the ink+amber+cream design system. Same data, premium look.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const D = require('@/utils/pdfDesign') as typeof import('@/utils/pdfDesign');
  const totalWorkers = dfr.manpower.reduce((s, m) => s + m.headcount, 0);
  const totalHours = dfr.manpower.reduce((s, m) => s + (m.headcount * m.hoursWorked), 0);

  const headerHtml = D.pdfHeader(branding);
  const titleHtml = D.pdfTitle({
    eyebrow: 'Daily field report',
    title: project.name,
    subtitle: reportDate,
    meta: [
      { label: 'Location', value: project.location || '—' },
      { label: 'Crew', value: `${totalWorkers} on site` },
      { label: 'Man-hours', value: `${totalHours} hrs` },
    ],
  });

  const weatherStats = D.pdfStatGrid([
    { label: 'Temperature', value: dfr.weather.temperature || '—' },
    { label: 'Conditions', value: dfr.weather.conditions || '—' },
    { label: 'Wind', value: dfr.weather.wind || '—' },
  ]);

  const manpowerHtml = dfr.manpower.length > 0
    ? D.pdfSectionHeader('Manpower') + D.pdfTable(
        [
          { header: 'Trade', align: 'left', width: '30%' },
          { header: 'Company', align: 'left' },
          { header: 'Headcount', align: 'right' },
          { header: 'Hours', align: 'right' },
          { header: 'Man-Hours', align: 'right' },
        ],
        dfr.manpower.map(m => [
          `<span style="font-weight:600">${D.escHtml(m.trade)}</span>`,
          D.escHtml(m.company || '—'),
          `<span class="num">${m.headcount}</span>`,
          `<span class="num">${m.hoursWorked}</span>`,
          `<span class="num" style="font-weight:700">${m.headcount * m.hoursWorked}</span>`,
        ]),
      )
    : '';

  const blockStyle = `background:${D.PDF_PALETTE.cream2};border:1px solid ${D.PDF_PALETTE.bone2};border-radius:12px;padding:14px 18px;margin-bottom:14px;font-size:13px;color:${D.PDF_PALETTE.text2};line-height:1.55;white-space:pre-wrap`;
  const issueStyle = `background:${D.PDF_PALETTE.errorTint};border:1px solid #f5c8bf;border-left:4px solid ${D.PDF_PALETTE.error};border-radius:12px;padding:14px 18px;margin-bottom:14px;font-size:13px;color:${D.PDF_PALETTE.text};line-height:1.55;white-space:pre-wrap`;

  const workHtml = D.pdfSectionHeader('Work performed') +
    `<div style="${blockStyle}">${dfr.workPerformed ? D.escHtml(dfr.workPerformed) : 'No narrative recorded.'}</div>`;
  const materialsHtml = dfr.materialsDelivered.length > 0
    ? D.pdfSectionHeader('Materials delivered') +
      `<div style="${blockStyle}">${dfr.materialsDelivered.map(m => `&middot; ${D.escHtml(m)}`).join('<br/>')}</div>`
    : '';
  const issuesHtml = dfr.issuesAndDelays
    ? D.pdfSectionHeader('Issues & delays') +
      `<div style="${issueStyle}">${D.escHtml(dfr.issuesAndDelays)}</div>`
    : '';
  const photosHtml = dfr.photos.length > 0
    ? D.pdfSectionHeader('Photos') +
      `<div style="${blockStyle}">${dfr.photos.length} photo${dfr.photos.length === 1 ? '' : 's'} attached — see digital copy for full resolution.</div>`
    : '';

  return D.pdfShell({
    title: `Daily field report — ${project.name} — ${reportDate}`,
    branding,
    bodyHtml:
      headerHtml + titleHtml + weatherStats + manpowerHtml + workHtml + materialsHtml + issuesHtml + photosHtml +
      D.pdfFooter(branding, `Daily field report · ${reportDate}`, D.PDF_DISCLAIMERS.dfr),
  });
}

// RFI log
//
// One PDF that summarizes every RFI on a project — the document a GC hands the
// architect at the project meeting or attaches to a closeout binder. Each RFI
// gets a card with number, subject, status, dates, question, and (if answered)
// the official response. The status legend at the top is what most architects
// look at first to triage.
//
// We render ALL RFIs (not paginated). For typical projects this is dozens, not
// thousands. If we ever exceed ~200 we'd want a "filter by status" prompt
// before rendering — Print.printToFileAsync builds one giant HTML doc, and
// massive HTML can OOM on lower-end Android.
function formatRfiDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildRFILogHtml(rfis: RFI[], project: Project, branding: CompanyBranding): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div>
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div></div>`
    : `<div class="company-header"><div class="company-name">RFI Log</div></div>`;

  // sort: open + overdue first, then open, then answered, then closed/void; tiebreak by RFI number desc.
  const today = new Date();
  const sorted = [...rfis].sort((a, b) => {
    const score = (r: RFI) => {
      if (r.status === 'open') {
        const due = new Date(r.dateRequired);
        if (!Number.isNaN(due.getTime()) && due < today) return 0;
        return 1;
      }
      if (r.status === 'answered') return 2;
      if (r.status === 'closed') return 3;
      return 4; // void
    };
    const da = score(a); const db = score(b);
    if (da !== db) return da - db;
    return b.number - a.number;
  });

  const counts = {
    open: rfis.filter(r => r.status === 'open').length,
    answered: rfis.filter(r => r.status === 'answered').length,
    closed: rfis.filter(r => r.status === 'closed').length,
    overdue: rfis.filter(r => r.status === 'open' && new Date(r.dateRequired) < today).length,
  };

  const summaryRow = `<div class="rfi-summary">
    <div class="rfi-summary-item"><span class="num">${rfis.length}</span><span class="lbl">Total</span></div>
    <div class="rfi-summary-item warn"><span class="num">${counts.open}</span><span class="lbl">Open</span></div>
    <div class="rfi-summary-item alert"><span class="num">${counts.overdue}</span><span class="lbl">Overdue</span></div>
    <div class="rfi-summary-item info"><span class="num">${counts.answered}</span><span class="lbl">Answered</span></div>
    <div class="rfi-summary-item ok"><span class="num">${counts.closed}</span><span class="lbl">Closed</span></div>
  </div>`;

  const tableRows = sorted.map((r, i) => {
    const isOverdue = r.status === 'open' && new Date(r.dateRequired) < today;
    const statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    return `<tr class="${i % 2 === 0 ? 'alt' : ''}">
      <td style="text-align:center;font-weight:700">#${r.number}</td>
      <td style="text-align:left;font-weight:500">${escapeHtml(r.subject)}</td>
      <td style="text-align:left">${escapeHtml(r.assignedTo || '—')}</td>
      <td style="text-align:center">${formatRfiDate(r.dateSubmitted)}</td>
      <td style="text-align:center;${isOverdue ? 'color:#FF3B30;font-weight:700' : ''}">${formatRfiDate(r.dateRequired)}${isOverdue ? ' ⚠' : ''}</td>
      <td style="text-align:center"><span class="status-pill status-${r.status}">${statusLabel}</span></td>
    </tr>`;
  }).join('');

  const detailCards = sorted.map(r => {
    const isOverdue = r.status === 'open' && new Date(r.dateRequired) < today;
    return `<div class="rfi-card${isOverdue ? ' overdue' : ''}">
      <div class="rfi-card-head">
        <div class="rfi-card-title"><span class="rfi-num">RFI #${r.number}</span> ${escapeHtml(r.subject)}</div>
        <span class="status-pill status-${r.status}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
      </div>
      <div class="rfi-meta-grid">
        ${r.submittedBy ? `<div><span>Submitted By</span><strong>${escapeHtml(r.submittedBy)}</strong></div>` : ''}
        ${r.assignedTo ? `<div><span>Assigned To</span><strong>${escapeHtml(r.assignedTo)}</strong></div>` : ''}
        <div><span>Submitted</span><strong>${formatRfiDate(r.dateSubmitted)}</strong></div>
        <div><span>Required</span><strong style="${isOverdue ? 'color:#FF3B30' : ''}">${formatRfiDate(r.dateRequired)}</strong></div>
        ${r.dateResponded ? `<div><span>Responded</span><strong>${formatRfiDate(r.dateResponded)}</strong></div>` : ''}
        <div><span>Priority</span><strong style="${r.priority === 'urgent' ? 'color:#FF3B30' : r.priority === 'normal' ? 'color:#1A6B3C' : 'color:#888'}">${r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}</strong></div>
        ${r.linkedDrawing ? `<div><span>Linked Drawing</span><strong>${escapeHtml(r.linkedDrawing)}</strong></div>` : ''}
      </div>
      <div class="rfi-section">
        <div class="rfi-section-label">Question</div>
        <div class="rfi-section-body">${escapeHtml(r.question).replace(/\n/g, '<br>')}</div>
      </div>
      ${r.response ? `<div class="rfi-section response">
        <div class="rfi-section-label">Response</div>
        <div class="rfi-section-body">${escapeHtml(r.response).replace(/\n/g, '<br>')}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:36px; font-size:11.5px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:24px; padding-bottom:18px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:10px; } .company-logo { max-height:54px; max-width:240px; object-fit:contain; }
    .company-name { font-size:24px; font-weight:800; color:#1A6B3C; }
    .company-info-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 20px; margin-top:8px; }
    .info-item { font-size:10px; color:#555; } .info-label { font-weight:600; color:#333; margin-right:4px; }
    .doc-header { background:#f8f9fa; border-radius:8px; padding:16px; margin-bottom:18px; border-left:4px solid #007AFF; }
    .doc-title { font-size:18px; font-weight:700; }
    .doc-meta { font-size:10.5px; color:#666; margin-top:4px; }
    .rfi-summary { display:flex; gap:8px; margin-bottom:20px; }
    .rfi-summary-item { flex:1; background:#f8f9fa; border-radius:8px; padding:10px 8px; text-align:center; border:1px solid #e8e8e8; }
    .rfi-summary-item .num { display:block; font-size:20px; font-weight:800; color:#1a1a1a; }
    .rfi-summary-item .lbl { display:block; font-size:9px; font-weight:600; color:#666; text-transform:uppercase; margin-top:2px; letter-spacing:0.5px; }
    .rfi-summary-item.warn .num { color:#FF9500; } .rfi-summary-item.alert .num { color:#FF3B30; }
    .rfi-summary-item.info .num { color:#007AFF; } .rfi-summary-item.ok .num { color:#34C759; }
    h2 { font-size:14px; font-weight:700; color:#1A6B3C; margin:18px 0 8px; padding-bottom:5px; border-bottom:2px solid #1A6B3C20; }
    table { width:100%; border-collapse:collapse; margin-bottom:18px; font-size:10.5px; }
    th { background:#1A6B3C08; padding:7px 8px; text-align:center; font-weight:700; color:#555; text-transform:uppercase; font-size:9px; letter-spacing:0.5px; border-bottom:2px solid #1A6B3C20; }
    td { padding:6px 8px; text-align:center; border-bottom:1px solid #eee; vertical-align:top; }
    tr.alt { background:#fafbfa; }
    .status-pill { display:inline-block; padding:2px 8px; border-radius:4px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; }
    .status-open { background:#FFF7E6; color:#FF9500; }
    .status-answered { background:#EBF3FF; color:#007AFF; }
    .status-closed { background:#E8FAF0; color:#34C759; }
    .status-void { background:#f0f0f0; color:#888; }
    .rfi-card { background:#fff; border:1px solid #e8e8e8; border-radius:8px; padding:14px; margin-bottom:12px; page-break-inside:avoid; }
    .rfi-card.overdue { border-left:4px solid #FF3B30; }
    .rfi-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px; }
    .rfi-card-title { font-size:14px; font-weight:700; color:#1a1a1a; flex:1; }
    .rfi-num { color:#007AFF; margin-right:6px; }
    .rfi-meta-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px 14px; padding:8px 10px; background:#fafbfa; border-radius:6px; margin-bottom:10px; }
    .rfi-meta-grid > div { display:flex; flex-direction:column; }
    .rfi-meta-grid span { font-size:8.5px; color:#888; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; }
    .rfi-meta-grid strong { font-size:11px; color:#1a1a1a; font-weight:600; }
    .rfi-section { margin-top:8px; }
    .rfi-section-label { font-size:9px; font-weight:700; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; }
    .rfi-section-body { font-size:11.5px; color:#333; padding:8px 10px; background:#f8f9fa; border-radius:6px; border-left:3px solid #ccc; }
    .rfi-section.response .rfi-section-body { background:#EBF3FF; border-left-color:#007AFF; }
    .footer { margin-top:30px; padding-top:14px; border-top:1px solid #e5e5e5; text-align:center; font-size:9.5px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="doc-header">
    <div class="doc-title">RFI Log</div>
    <div class="doc-meta">Project: ${escapeHtml(project.name)}${project.location ? ` &middot; ${escapeHtml(project.location)}` : ''}</div>
    <div class="doc-meta">Generated: ${now}</div>
  </div>
  ${summaryRow}
  ${rfis.length === 0 ? '<div style="text-align:center;padding:40px;color:#888;font-size:13px">No RFIs on this project yet.</div>' : `
    <h2>Summary</h2>
    <table>
      <thead><tr>
        <th style="text-align:center;width:8%">No.</th>
        <th style="text-align:left">Subject</th>
        <th style="text-align:left;width:18%">Assigned</th>
        <th style="text-align:center;width:12%">Submitted</th>
        <th style="text-align:center;width:12%">Required</th>
        <th style="text-align:center;width:12%">Status</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <h2>Detail</h2>
    ${detailCards}
  `}
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}RFI Log &middot; ${escapeHtml(project.name)} &middot; ${now}</div>
</body></html>`;
}

export async function generateRFILogPDFUri(
  rfis: RFI[], project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildRFILogHtml(rfis, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] RFI Log PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating RFI log PDF URI:', error);
    return null;
  }
}

export async function generateRFILogPDF(
  rfis: RFI[], project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating RFI Log PDF, count:', rfis.length);
  const html = buildRFILogHtml(rfis, project, branding);
  await shareHtml(html, `${project.name} - RFI Log`);
}

export async function generateChangeOrderPDFUri(
  co: ChangeOrder, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildChangeOrderHtml(co, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] CO PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating CO PDF URI:', error);
    return null;
  }
}

export async function generateInvoicePDFUri(
  inv: Invoice, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildInvoiceHtml(inv, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Invoice PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating invoice PDF URI:', error);
    return null;
  }
}

export async function generateDFRPDFUri(
  dfr: DailyFieldReport, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildDFRHtml(dfr, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] DFR PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating DFR PDF URI:', error);
    return null;
  }
}

export async function generateChangeOrderPDF(
  co: ChangeOrder, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating CO PDF:', co.id);
  const html = buildChangeOrderHtml(co, project, branding);
  await shareHtml(html, `${project.name} - CO #${co.number}`);
}

export async function generateInvoicePDF(
  inv: Invoice, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating Invoice PDF:', inv.id);
  const html = buildInvoiceHtml(inv, project, branding);
  await shareHtml(html, `${project.name} - Invoice #${inv.number}`);
}

export async function generateDFRPDF(
  dfr: DailyFieldReport, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating DFR PDF:', dfr.id);
  const html = buildDFRHtml(dfr, project, branding);
  await shareHtml(html, `${project.name} - Daily Report`);
}

async function shareHtml(html: string, title: string, method?: 'share' | 'email', recipient?: string, message?: string): Promise<void> {
  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (method === 'email' && recipient) {
      const subject = encodeURIComponent(title);
      const body = encodeURIComponent(message || `Please find attached: ${title}`);
      const mailUrl = `mailto:${recipient}?subject=${subject}&body=${body}`;
      const { openURL } = await import('expo-linking');
      await openURL(mailUrl).catch(() => {});
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    } else {
      await Print.printAsync({ uri });
    }
  } catch (error) {
    console.error('[PDF] Error:', error);
    throw error;
  }
}

export function buildEstimateTextForEmail(
  project: Project,
  branding: CompanyBranding,
): string {
  let text = '';
  const divider = '━'.repeat(40);

  if (branding.companyName) {
    text += `${branding.companyName.toUpperCase()}\n`;
    if (branding.tagline) text += `${branding.tagline}\n`;
    text += `${divider}\n\n`;
  }

  text += `PROJECT ESTIMATE\n`;
  text += `${divider}\n`;
  text += `Project: ${project.name}\n`;
  text += `Location: ${project.location}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n`;
  if (project.squareFootage > 0) text += `Area: ${project.squareFootage.toLocaleString()} sq ft\n`;
  if (project.description) text += `Description: ${project.description}\n`;
  text += '\n';

  const est = project.linkedEstimate;
  if (est && est.items.length > 0) {
    text += `ITEMS\n${divider}\n`;
    est.items.forEach((item, i) => {
      text += `${i + 1}. ${item.name}\n`;
      text += `   ${item.quantity} ${item.unit} @ ${formatCurrency(item.unitPrice)} (${item.markup}% markup)\n`;
      text += `   Line Total: ${formatCurrency(item.lineTotal)}\n\n`;
    });
    text += `${divider}\n`;
    text += `Base Cost:    ${formatCurrency(est.baseTotal)}\n`;
    text += `Markup:       +${formatCurrency(est.markupTotal)}\n`;
    text += `TOTAL:        ${formatCurrency(est.grandTotal)}\n\n`;
  }

  const legacyEst = project.estimate;
  if (legacyEst && (!est || est.items.length === 0)) {
    text += `COST SUMMARY\n${divider}\n`;
    text += `Materials:     ${formatCurrency(legacyEst.materialTotal)}\n`;
    text += `Labor:         ${formatCurrency(legacyEst.laborTotal)}\n`;
    text += `Permits:       ${formatCurrency(legacyEst.permits)}\n`;
    text += `Overhead:      ${formatCurrency(legacyEst.overhead)}\n`;
    text += `${divider}\n`;
    text += `Subtotal:      ${formatCurrency(legacyEst.subtotal)}\n`;
    text += `Tax:           ${formatCurrency(legacyEst.tax)}\n`;
    text += `Contingency:   ${formatCurrency(legacyEst.contingency)}\n`;
    text += `Bulk Savings:  -${formatCurrency(legacyEst.bulkSavingsTotal)}\n`;
    text += `${divider}\n`;
    text += `GRAND TOTAL:   ${formatCurrency(legacyEst.grandTotal)}\n`;
    if (legacyEst.pricePerSqFt > 0) text += `Per Sq Ft:     ${formatCurrency(legacyEst.pricePerSqFt)}\n`;
    text += '\n';
  }

  const schedule = project.schedule;
  if (schedule && schedule.tasks.length > 0) {
    text += `SCHEDULE\n${divider}\n`;
    text += `Duration: ${schedule.totalDurationDays} days\n`;
    text += `Critical Path: ${schedule.criticalPathDays} days\n`;
    text += `Tasks: ${schedule.tasks.length}\n\n`;
    schedule.tasks.forEach((task, i) => {
      const flags: string[] = [];
      if (task.isMilestone) flags.push('[Milestone]');
      if (task.isCriticalPath) flags.push('[Critical]');
      text += `${i + 1}. ${task.title} ${flags.join(' ')}\n`;
      text += `   ${task.phase} · Day ${task.startDay} · ${task.durationDays}d · ${task.crew} · ${task.progress}%\n`;
    });
    text += '\n';
  }

  if (branding.contactName || branding.phone || branding.email) {
    text += `${divider}\nCONTACT\n`;
    if (branding.contactName) text += `${branding.contactName}\n`;
    if (branding.phone) text += `${branding.phone}\n`;
    if (branding.email) text += `${branding.email}\n`;
    if (branding.address) text += `${branding.address}\n`;
    if (branding.licenseNumber) text += `License: ${branding.licenseNumber}\n`;
  }

  return text;
}

/* ============================================================
 * SUBMITTAL PDF
 *
 * Submittals are the formal product/material approval workflow on
 * a construction project. The PDF shows: spec section + title at the
 * top, who submitted/when, the required-by date, and a chronological
 * review-cycle table (each cycle = a reviewer, status, date, comments).
 * Looks like a transmittal slip an architect would countersign and
 * fax back in 1995, only better.
 * ============================================================ */
function statusColor(status: string): string {
  switch (status) {
    case 'approved': return '#2E7D32';
    case 'approved_as_noted': return '#1565C0';
    case 'in_review': return '#1565C0';
    case 'pending': return '#C77700';
    case 'revise_resubmit': return '#C62828';
    case 'rejected': return '#C62828';
    default: return '#666';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildSubmittalHtml(s: Submittal, project: Project, branding: CompanyBranding): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const submittedDate = s.submittedDate ? new Date(s.submittedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const requiredDate = s.requiredDate ? new Date(s.requiredDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const cycleRows = s.reviewCycles.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#999;padding:18px;">No review cycles yet.</td></tr>`
    : s.reviewCycles
        .slice()
        .sort((a, b) => a.cycleNumber - b.cycleNumber)
        .map(c => `
          <tr>
            <td style="text-align:center;font-weight:700;">#${c.cycleNumber}</td>
            <td>${escapeHtml(c.reviewer || '—')}</td>
            <td style="text-align:center;">${c.sentDate ? new Date(c.sentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
            <td style="text-align:center;">${c.returnDate ? new Date(c.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '<em style="color:#999;">Pending</em>'}</td>
            <td style="text-align:center;"><span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${statusColor(c.status)}22;color:${statusColor(c.status)};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">${statusLabel(c.status)}</span></td>
          </tr>
          ${c.comments ? `<tr><td></td><td colspan="4" style="font-style:italic;color:#444;font-size:12px;background:#fafafa;padding:8px 12px;border-left:3px solid ${statusColor(c.status)};">${escapeHtml(c.comments)}</td></tr>` : ''}
        `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" />
<style>
  @page { margin: 0.6in; }
  body { font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; font-size: 13px; line-height: 1.4; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${statusColor(s.currentStatus)}; padding-bottom: 12px; margin-bottom: 18px; }
  .header h1 { margin: 0; font-size: 24px; letter-spacing: -0.5px; }
  .header .meta { text-align: right; font-size: 11px; color: #666; line-height: 1.5; }
  .doc-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
  .doc-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .doc-label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .doc-value { color: #111827; font-weight: 600; font-size: 13px; }
  .status-pill { display: inline-block; padding: 4px 12px; border-radius: 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
  h2 { font-size: 14px; margin: 18px 0 8px; color: #111; text-transform: uppercase; letter-spacing: 0.6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th { background: #1a1a2e; color: #fff; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 10px; color: #999; padding: 8px 0; border-top: 1px solid #eee; background: #fff; }
  .attachments { background: #fff; border: 1px dashed #d1d5db; border-radius: 8px; padding: 10px 14px; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Submittal #${s.number}</h1>
      <div style="margin-top:4px;color:#666;font-size:12px;">${escapeHtml(project.name)}</div>
    </div>
    <div class="meta">
      ${branding.companyName ? `<strong>${escapeHtml(branding.companyName)}</strong><br/>` : ''}
      ${branding.licenseNumber ? `License #${escapeHtml(branding.licenseNumber)}<br/>` : ''}
      Generated ${now}
    </div>
  </div>

  <div class="doc-card">
    <div class="doc-row"><span class="doc-label">Title</span><span class="doc-value">${escapeHtml(s.title)}</span></div>
    <div class="doc-row"><span class="doc-label">Spec Section</span><span class="doc-value">${escapeHtml(s.specSection || '—')}</span></div>
    <div class="doc-row"><span class="doc-label">Submitted By</span><span class="doc-value">${escapeHtml(s.submittedBy || '—')}</span></div>
    <div class="doc-row"><span class="doc-label">Submitted</span><span class="doc-value">${submittedDate}</span></div>
    <div class="doc-row"><span class="doc-label">Required By</span><span class="doc-value">${requiredDate}</span></div>
    <div class="doc-row"><span class="doc-label">Current Status</span><span class="status-pill" style="background:${statusColor(s.currentStatus)}22;color:${statusColor(s.currentStatus)};">${statusLabel(s.currentStatus)}</span></div>
  </div>

  <h2>Review Cycles (${s.reviewCycles.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width:8%;">Cycle</th>
        <th style="text-align:left;">Reviewer</th>
        <th style="width:14%;">Sent</th>
        <th style="width:14%;">Returned</th>
        <th style="width:18%;">Status</th>
      </tr>
    </thead>
    <tbody>${cycleRows}</tbody>
  </table>

  ${s.attachments && s.attachments.length > 0 ? `
    <h2>Attachments (${s.attachments.length})</h2>
    <div class="attachments">${s.attachments.map(a => `&bull; ${escapeHtml(a)}`).join('<br/>')}</div>
  ` : ''}

  <div class="footer">
    ${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Submittal #${s.number} &middot; ${escapeHtml(project.name)} &middot; ${now}
  </div>
</body>
</html>`;
}

export async function generateSubmittalPDFUri(
  submittal: Submittal, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildSubmittalHtml(submittal, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Submittal PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating submittal PDF URI:', error);
    return null;
  }
}

export async function generateSubmittalPDF(
  submittal: Submittal, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating Submittal PDF, id:', submittal.id);
  const html = buildSubmittalHtml(submittal, project, branding);
  await shareHtml(html, `${project.name} - Submittal #${submittal.number}`);
}

export function buildSubmittalEmailHtml(opts: {
  companyName: string;
  recipientName?: string;
  projectName: string;
  submittalNumber: number;
  submittalTitle: string;
  specSection?: string;
  status: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}): string {
  const { companyName, recipientName, projectName, submittalNumber, submittalTitle, specSection, status, message, contactName, contactEmail, contactPhone } = opts;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Submittal #${submittalNumber}</p>
          <h2 style="margin:0 0 6px;color:#111827;font-size:20px;">${escapeHtml(submittalTitle)}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">${escapeHtml(projectName)}${specSection ? ` &middot; Spec ${escapeHtml(specSection)}` : ''}</p>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${escapeHtml(recipientName)},</p>` : ''}
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${escapeHtml(message)}</p>` : `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">Please review the attached submittal package and reply with your action code when ready.</p>`}
          <div style="background:#f9fafb;border-radius:8px;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Current Status</p>
            <p style="margin:6px 0 0;color:${statusColor(status)};font-size:16px;font-weight:700;">${statusLabel(status)}</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 8px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Action codes</p>
              <p style="margin:0 0 4px;color:#111827;font-size:13px;line-height:1.55;"><strong style="color:#16a34a;">Approved</strong> &middot; proceed as submitted</p>
              <p style="margin:0 0 4px;color:#111827;font-size:13px;line-height:1.55;"><strong style="color:#0891b2;">Approved as Noted</strong> &middot; proceed with the noted comments</p>
              <p style="margin:0 0 4px;color:#111827;font-size:13px;line-height:1.55;"><strong style="color:#d97706;">Revise &amp; Resubmit</strong> &middot; revise per comments and re-submit</p>
              <p style="margin:0;color:#111827;font-size:13px;line-height:1.55;"><strong style="color:#dc2626;">Rejected</strong> &middot; not in compliance with contract documents</p>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;color:#374151;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;">
            <strong>How to respond:</strong> reply to this email with your action code (and any markups attached). Your response will be filed against Submittal #${submittalNumber} for this project.
          </p>
          <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            ${contactName ? `Contact: ${escapeHtml(contactName)}` : ''}
            ${contactEmail ? ` &middot; ${escapeHtml(contactEmail)}` : ''}
            ${contactPhone ? ` &middot; ${escapeHtml(contactPhone)}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
