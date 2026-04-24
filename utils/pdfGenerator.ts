import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding, Project, ChangeOrder, Invoice, DailyFieldReport, ScheduleTask } from '@/types';

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
    : `<div class="company-header"><div class="company-name">Change Order</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:28px; font-weight:800; color:#1A6B3C; }
    .company-info-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 20px; margin-top:10px; }
    .info-item { font-size:11px; color:#555; } .info-label { font-weight:600; color:#333; margin-right:4px; }
    .co-header { background:#f8f9fa; border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #FF9500; }
    .co-title { font-size:20px; font-weight:700; color:#1a1a1a; } .co-meta { font-size:11px; color:#666; margin-top:4px; }
    .status-badge { display:inline-block; padding:4px 12px; border-radius:6px; font-size:11px; font-weight:700; text-transform:uppercase; }
    .status-draft { background:#f0f0f0; color:#666; } .status-sent { background:#EBF3FF; color:#007AFF; }
    .status-approved { background:#E8FAF0; color:#34C759; } .status-rejected { background:#FFF0EF; color:#FF3B30; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    th { background:#1A6B3C08; padding:8px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; letter-spacing:0.5px; border-bottom:2px solid #1A6B3C20; }
    td { padding:7px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .summary-box { background:#f8f9fa; border-radius:8px; padding:16px; border:1px solid #e8e8e8; }
    .summary-row { display:flex; justify-content:space-between; padding:5px 0; font-size:13px; }
    .summary-row.total { font-size:18px; font-weight:800; color:#1A6B3C; padding:10px 0 0; }
    .summary-divider { height:2px; background:#1A6B3C; margin:8px 0; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="co-header">
    <div class="co-title">Change Order #${co.number}</div>
    <div class="co-meta">Project: ${escapeHtml(project.name)} &middot; Date: ${now} &middot; <span class="status-badge status-${co.status}">${co.status}</span></div>
    ${co.description ? `<p style="margin-top:8px;font-size:12px;color:#333">${escapeHtml(co.description)}</p>` : ''}
    ${co.reason ? `<p style="margin-top:4px;font-size:11px;color:#666">Reason: ${escapeHtml(co.reason)}</p>` : ''}
  </div>
  <h2 style="font-size:16px;font-weight:700;color:#1A6B3C;margin:20px 0 12px;border-bottom:2px solid #1A6B3C20;padding-bottom:6px;">Line Items</h2>
  <table><thead><tr>
    <th style="text-align:left;width:35%">Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th style="text-align:right">Total</th>
  </tr></thead><tbody>
    ${co.lineItems.map((item, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(item.name)}${item.isNew ? ' <span style="color:#FF9500;font-size:9px">[NEW]</span>' : ''}</td><td>${item.quantity}</td><td>${escapeHtml(item.unit)}</td><td>${formatCurrency(item.unitPrice)}</td><td style="text-align:right;font-weight:600">${formatCurrency(item.total)}</td></tr>`).join('')}
  </tbody></table>
  <div class="summary-box">
    <div class="summary-row"><span>Original Contract Value</span><span>${formatCurrency(co.originalContractValue)}</span></div>
    <div class="summary-row" style="color:${co.changeAmount >= 0 ? '#FF9500' : '#34C759'}"><span>This Change Order</span><span>${co.changeAmount >= 0 ? '+' : ''}${formatCurrency(co.changeAmount)}</span></div>
    <div class="summary-divider"></div>
    <div class="summary-row total"><span>New Contract Total</span><span>${formatCurrency(co.newContractTotal)}</span></div>
  </div>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e5e5">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:20px">Client Approval</div>
    <div style="display:flex;gap:40px">
      <div><div style="width:200px;height:1px;background:#333;margin-bottom:8px;margin-top:30px"></div><div style="font-size:11px;color:#888">Client Signature</div></div>
      <div><div style="width:120px;height:1px;background:#333;margin-bottom:8px;margin-top:30px"></div><div style="font-size:11px;color:#888">Date</div></div>
    </div>
  </div>
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Change Order #${co.number} &middot; ${now}</div>
</body></html>`;
}

function buildInvoiceHtml(inv: Invoice, project: Project, branding: CompanyBranding): string {
  const now = new Date(inv.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dueDate = new Date(inv.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div>
        ${branding.tagline ? `<div style="font-size:13px;color:#666;margin-top:4px;font-style:italic">${escapeHtml(branding.tagline)}</div>` : ''}
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.address ? `<div class="info-item"><span class="info-label">Address</span><span>${escapeHtml(branding.address)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div></div>`
    : `<div class="company-header"><div class="company-name">Invoice</div></div>`;

  const termsLabel = inv.paymentTerms.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:28px; font-weight:800; color:#1A6B3C; }
    .company-info-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 20px; margin-top:10px; }
    .info-item { font-size:11px; color:#555; } .info-label { font-weight:600; color:#333; margin-right:4px; }
    .inv-header { background:linear-gradient(135deg,#f8f9fa,#eef2f0); border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #1A6B3C; display:flex; justify-content:space-between; }
    .inv-title { font-size:20px; font-weight:700; } .inv-meta { font-size:11px; color:#666; margin-top:4px; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    th { background:#1A6B3C08; padding:8px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; letter-spacing:0.5px; border-bottom:2px solid #1A6B3C20; }
    td { padding:7px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .summary-box { background:#f8f9fa; border-radius:8px; padding:16px; border:1px solid #e8e8e8; }
    .summary-row { display:flex; justify-content:space-between; padding:5px 0; font-size:13px; }
    .summary-row.total { font-size:18px; font-weight:800; color:#1A6B3C; padding:10px 0 0; }
    .summary-divider { height:2px; background:#1A6B3C; margin:8px 0; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="inv-header">
    <div>
      <div class="inv-title">${inv.type === 'progress' ? 'Progress Bill' : 'Invoice'} #${inv.number}</div>
      <div class="inv-meta">Project: ${escapeHtml(project.name)}</div>
      ${inv.type === 'progress' && inv.progressPercent ? `<div class="inv-meta">Progress: ${inv.progressPercent}% of contract</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="inv-meta">Issue Date: ${now}</div>
      <div class="inv-meta">Due Date: ${dueDate}</div>
      <div class="inv-meta">Terms: ${termsLabel}</div>
    </div>
  </div>
  <table><thead><tr>
    <th style="text-align:left;width:35%">Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th style="text-align:right">Total</th>
  </tr></thead><tbody>
    ${inv.lineItems.map((item, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${escapeHtml(item.unit)}</td><td>${formatCurrency(item.unitPrice)}</td><td style="text-align:right;font-weight:600">${formatCurrency(item.total)}</td></tr>`).join('')}
  </tbody></table>
  <div class="summary-box">
    <div class="summary-row"><span>Subtotal</span><span>${formatCurrency(inv.subtotal)}</span></div>
    <div class="summary-row"><span>Tax (${inv.taxRate}%)</span><span>${formatCurrency(inv.taxAmount)}</span></div>
    <div class="summary-divider"></div>
    <div class="summary-row total"><span>Total Due</span><span>${formatCurrency(inv.totalDue)}</span></div>
    ${inv.amountPaid > 0 ? `<div class="summary-row" style="color:#34C759"><span>Amount Paid</span><span>-${formatCurrency(inv.amountPaid)}</span></div><div class="summary-row" style="font-weight:700;font-size:14px"><span>Balance Due</span><span>${formatCurrency(inv.totalDue - inv.amountPaid)}</span></div>` : ''}
  </div>
  ${inv.notes ? `<div style="margin-top:20px;padding:14px;background:#f8f9fa;border-radius:8px;border:1px solid #e8e8e8"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:6px">Notes</div><p style="font-size:12px;color:#555">${escapeHtml(inv.notes)}</p></div>` : ''}
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Invoice #${inv.number} &middot; ${now}</div>
</body></html>`;
}

function buildDFRHtml(dfr: DailyFieldReport, project: Project, branding: CompanyBranding): string {
  const reportDate = new Date(dfr.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div></div>`
    : `<div class="company-header"><div class="company-name">Daily Field Report</div></div>`;

  const totalWorkers = dfr.manpower.reduce((s, m) => s + m.headcount, 0);
  const totalHours = dfr.manpower.reduce((s, m) => s + (m.headcount * m.hoursWorked), 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:24px; padding-bottom:20px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:24px; font-weight:800; color:#1A6B3C; }
    .dfr-header { background:#f8f9fa; border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #1A6B3C; }
    .dfr-title { font-size:18px; font-weight:700; } .dfr-meta { font-size:11px; color:#666; margin-top:4px; }
    h2 { font-size:14px; font-weight:700; color:#1A6B3C; margin:20px 0 10px; padding-bottom:6px; border-bottom:2px solid #1A6B3C20; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:11px; }
    th { background:#1A6B3C08; padding:6px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; border-bottom:2px solid #1A6B3C20; }
    td { padding:6px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .section-content { background:#f8f9fa; border-radius:6px; padding:12px; margin-bottom:12px; font-size:12px; color:#333; }
    .weather-grid { display:flex; gap:12px; margin-bottom:16px; }
    .weather-item { flex:1; background:#f8f9fa; border-radius:6px; padding:10px; text-align:center; }
    .weather-label { font-size:9px; font-weight:600; color:#888; text-transform:uppercase; }
    .weather-value { font-size:14px; font-weight:600; color:#333; margin-top:4px; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="dfr-header">
    <div class="dfr-title">Daily Field Report</div>
    <div class="dfr-meta">Project: ${escapeHtml(project.name)} &middot; ${reportDate}</div>
    <div class="dfr-meta">Location: ${escapeHtml(project.location)}</div>
  </div>
  <h2>Weather</h2>
  <div class="weather-grid">
    <div class="weather-item"><div class="weather-label">Temperature</div><div class="weather-value">${escapeHtml(dfr.weather.temperature || 'N/A')}</div></div>
    <div class="weather-item"><div class="weather-label">Conditions</div><div class="weather-value">${escapeHtml(dfr.weather.conditions || 'N/A')}</div></div>
    <div class="weather-item"><div class="weather-label">Wind</div><div class="weather-value">${escapeHtml(dfr.weather.wind || 'N/A')}</div></div>
  </div>
  <h2>Manpower (${totalWorkers} workers &middot; ${totalHours} man-hours)</h2>
  ${dfr.manpower.length > 0 ? `<table><thead><tr><th style="text-align:left">Trade</th><th>Company</th><th>Headcount</th><th>Hours</th><th>Man-Hours</th></tr></thead><tbody>${dfr.manpower.map((m, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(m.trade)}</td><td>${escapeHtml(m.company || '-')}</td><td>${m.headcount}</td><td>${m.hoursWorked}</td><td>${m.headcount * m.hoursWorked}</td></tr>`).join('')}</tbody></table>` : '<div class="section-content">No manpower entries.</div>'}
  <h2>Work Performed</h2>
  <div class="section-content">${dfr.workPerformed ? escapeHtml(dfr.workPerformed).replace(/\n/g, '<br>') : 'No notes.'}</div>
  ${dfr.materialsDelivered.length > 0 ? `<h2>Materials Delivered</h2><div class="section-content"><ul>${dfr.materialsDelivered.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>` : ''}
  ${dfr.issuesAndDelays ? `<h2>Issues &amp; Delays</h2><div class="section-content" style="border-left:3px solid #FF3B30;background:#FFF0EF">${escapeHtml(dfr.issuesAndDelays).replace(/\n/g, '<br>')}</div>` : ''}
  ${dfr.photos.length > 0 ? `<h2>Photos (${dfr.photos.length})</h2><div class="section-content">${dfr.photos.length} photo(s) attached. See digital copy for images.</div>` : ''}
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Daily Field Report &middot; ${reportDate}</div>
</body></html>`;
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
