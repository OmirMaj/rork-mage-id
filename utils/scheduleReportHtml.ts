import type { ScheduleReportModel, ReportOptions, ReportPaperSize, ReportSectionKey } from '@/utils/scheduleReportModel';

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pageCss(size: ReportPaperSize, orientation: 'landscape' | 'portrait'): string {
  const land = orientation === 'landscape';
  switch (size) {
    case 'letter':  return land ? '11in 8.5in' : '8.5in 11in';
    case 'a4':      return land ? 'A4 landscape' : 'A4 portrait';
    case 'tabloid': return land ? '17in 11in' : '11in 17in';
    case 'arch_d':  return land ? '36in 24in' : '24in 36in';
    case 'arch_e':  return land ? '48in 36in' : '36in 48in';
    case 'a3':
    default:        return land ? 'A3 landscape' : 'A3 portrait';
  }
}

function scale(size: ReportPaperSize): { base: number; h1: number; kpi: number; cell: number; bar: number } {
  switch (size) {
    case 'letter':
    case 'a4':      return { base: 9,  h1: 17, kpi: 14, cell: 7.5, bar: 9 };
    case 'tabloid': return { base: 11, h1: 22, kpi: 18, cell: 9,   bar: 11 };
    case 'arch_d':  return { base: 15, h1: 30, kpi: 24, cell: 12,  bar: 15 };
    case 'arch_e':  return { base: 19, h1: 38, kpi: 30, cell: 15,  bar: 19 };
    case 'a3':
    default:        return { base: 10, h1: 20, kpi: 16, cell: 8,   bar: 10 };
  }
}

type Scale = ReturnType<typeof scale>;

const has = (opts: ReportOptions, k: ReportSectionKey): boolean => opts.sections.includes(k);

export function renderScheduleReportHtml(model: ScheduleReportModel, opts: ReportOptions): string {
  const s = scale(opts.paperSize);
  const margin = opts.paperSize === 'arch_d' || opts.paperSize === 'arch_e' ? '24mm' : '16mm';
  const fit = opts.fitToOnePage ? 'transform: scale(0.92); transform-origin: top left;' : '';
  const breakRule = opts.singleWallSheet ? '' : 'tr, .card, .band, .kpi, .stat, .wk { page-break-inside: avoid; } thead { display: table-header-group; }';
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(model.header.projectName)} — MAGE Schedule Report</title>
<style>
  @page { size: ${pageCss(opts.paperSize, opts.orientation)}; margin: ${margin}; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#111; margin:0; font-size:${s.base}px; ${fit} }
  ${breakRule}
  .R{background:#fff;color:#111;font-size:${s.base}px;line-height:1.3}
  .R .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #FF9500;padding-bottom:8px}
  .R .eb{font-size:8px;font-weight:800;letter-spacing:2px;color:#FF9500;text-transform:uppercase}
  .R h3.t{font-size:${s.h1}px;margin:3px 0 1px}
  .R .s{font-size:9px;color:#777}
  .R .meta{text-align:right;font-size:9px;color:#555;line-height:1.55}.R .meta b{color:#111}
  .K{display:flex;gap:6px;margin:11px 0}
  .K .c{flex:1;border:1px solid #eee;border-top:3px solid #007AFF;border-radius:5px;padding:6px 7px}
  .K .c.g{border-top-color:#137333}.K .c.r{border-top-color:#C2260F}.K .c.a{border-top-color:#FF9500}
  .K .n{font-size:${s.kpi}px;font-weight:800}.K .l{font-size:6.5px;color:#777;text-transform:uppercase;letter-spacing:.3px}
  .K .dd{font-size:6.5px;font-weight:700;margin-top:1px}.K .dd.r{color:#C2260F}.K .dd.g{color:#137333}
  .cols{display:flex;gap:10px;margin-top:4px}.cols>div{flex:1}
  .sh{font-size:8px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#999;margin:10px 0 4px}
  .cp .r{display:flex;justify-content:space-between;padding:2.5px 0;border-bottom:1px solid #f4f4f4}
  .cp .dt{color:#888;font-variant-numeric:tabular-nums;white-space:nowrap}
  .cp .r.crit span:first-child{color:#C2260F;font-weight:600}
  .risk{background:#FFF6F5;border:1px solid #F3D6D2;border-radius:5px;padding:7px}
  .risk .i{display:flex;gap:5px;padding:2px 0;align-items:baseline}
  .tag{font-size:6px;font-weight:800;color:#fff;border-radius:3px;padding:1px 4px;white-space:nowrap}
  .tag.hi{background:#C2260F}.tag.md{background:#FF9500}.tag.lo{background:#8E8E93}.tag.in{background:#7A5AF8}
  .la .wk{margin-bottom:5px}.la .wk b{display:block;font-size:7.5px;color:#007AFF;text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px}
  .la .x{font-size:7.5px;padding:1px 0;color:#333}.la .x .w{color:#999}
  table.G{width:100%;border-collapse:collapse;margin-top:4px}
  table.G th{font-size:6.5px;color:#888;text-transform:uppercase;letter-spacing:.3px;text-align:left;border-bottom:1.5px solid #ccc;padding:3px 4px}
  table.G td{font-size:${s.cell}px;padding:2.5px 4px;border-bottom:1px solid #f4f4f4;vertical-align:middle}
  table.G td.n{text-align:right;font-variant-numeric:tabular-nums}
  table.G tr.ph td{background:#f4f6f8;font-weight:800;font-size:7px;text-transform:uppercase;letter-spacing:.4px;color:#555;padding:3px 4px}
  .tl{position:relative;height:${s.bar}px;background:repeating-linear-gradient(to right,transparent 0 calc(7.14% - 1px),#f3f3f3 calc(7.14% - 1px) 7.14%);border-radius:2px}
  .bl{position:absolute;height:3px;background:#999;opacity:.55;top:${(s.bar - 2).toFixed(0)}px;border-radius:2px}
  .bar{position:absolute;height:${s.bar}px;background:#E5F0FF;border:1px solid #007AFF;border-radius:2px;top:0}
  .bar.c{background:#FFDDDA;border-color:#FF3B30}.bar.s{background:#111;border:0;height:${(s.bar / 2).toFixed(0)}px;top:3px}
  .ms{position:absolute;width:7px;height:7px;background:#007AFF;transform:rotate(45deg);top:2px}
  .prog{position:absolute;height:${s.bar}px;background:#007AFF;opacity:.8;top:0;border-radius:2px}
  .vb{color:#C2260F;font-weight:700}.vg{color:#137333;font-weight:700}
  .ph2{display:flex;align-items:center;gap:6px;font-size:8px;padding:1.5px 0}
  .ph2 .b{flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden}.ph2 .f{height:6px;background:#007AFF}
  .legend{display:flex;gap:12px;flex-wrap:wrap;font-size:7px;color:#666;margin-top:8px;border-top:1px solid #eee;padding-top:6px}
  .sw{display:inline-block;width:12px;height:7px;border-radius:2px;margin-right:3px;vertical-align:middle}
</style></head>
<body>${sectionsHtml(model, opts, s)}</body></html>`;
}

function sectionsHtml(model: ScheduleReportModel, opts: ReportOptions, s: Scale): string {
  return [
    headerHtml(model),
    has(opts, 'kpis') ? kpisHtml(model) : '',
    colsBandHtml(model, opts),
    has(opts, 'gantt') ? ganttHtml(model, opts, s) : '',
    footerBandHtml(model, opts),
    has(opts, 'register') ? registerHtml(model, opts) : '',
    legendHtml(model),
  ].join('\n');
}

function headerHtml(model: ScheduleReportModel): string {
  const h = model.header;
  const sub = [h.location, h.company, h.client].filter((x): x is string => !!x && !!x.trim()).map(esc).join(' · ');
  const blFin = h.baselineFinishIso ? esc(h.baselineFinishIso) : '—';
  const v = h.forecastVarianceDays;
  const vTxt = v != null ? ` (${v > 0 ? '+' : ''}${v}d)` : '';
  const vClass = v != null && v > 0 ? ' style="color:#C2260F"' : '';
  return `<div class="R">
  <div class="hd">
    <div><div class="eb">MAGE Schedule · PM Status Report</div><h3 class="t">${esc(h.projectName)}</h3>
      ${sub ? `<div class="s">${sub}</div>` : ''}</div>
    <div class="meta"><div>Report: <b>${esc(h.reportDateIso)}</b> · Data date: <b>${esc(h.dataDateIso)}</b></div>
      <div>Start: <b>${esc(h.startIso)}</b> · Contract finish: <b>${blFin}</b> · Forecast: <b${vClass}>${esc(h.forecastFinishIso)}${vTxt}</b></div>
      <div>${h.taskCount} tasks · ${h.phaseCount} phases · ${h.spanDays}-day span</div></div>
  </div>`;
}

function kpisHtml(model: ScheduleReportModel): string {
  const k = model.kpis;
  const cards: string[] = [];
  cards.push(`<div class="c g"><div class="n">${k.percentComplete}%</div><div class="l">Complete</div><div class="dd">${k.tasksDone} of ${k.tasksTotal} done</div></div>`);
  if (k.forecastVarianceDays != null) {
    const v = k.forecastVarianceDays;
    const cls = v > 0 ? 'r' : 'g';
    cards.push(`<div class="c ${cls}"><div class="n">${v > 0 ? '+' : ''}${v}d</div><div class="l">Forecast variance</div><div class="dd ${cls}">vs baseline</div></div>`);
  }
  const spiCls = k.spi < 0.95 ? 'r' : 'g';
  const sv = k.svDays;
  const svTxt = sv != null ? `SV ${sv > 0 ? '+' : ''}${sv}d` : 'on plan';
  cards.push(`<div class="c ${spiCls}"><div class="n">${k.spi.toFixed(2)}</div><div class="l">SPI</div><div class="dd ${spiCls}">${esc(svTxt)}</div></div>`);
  cards.push(`<div class="c"><div class="n">${k.criticalCount}</div><div class="l">Critical tasks</div><div class="dd">on driving chain</div></div>`);
  const mtfCls = k.minTotalFloat <= 0 ? 'r' : '';
  cards.push(`<div class="c ${mtfCls}"><div class="n">${k.minTotalFloat}d</div><div class="l">Min total float</div><div class="dd ${mtfCls}">tightest task</div></div>`);
  const behindCls = k.behindCount > 0 ? 'r' : '';
  cards.push(`<div class="c ${behindCls}"><div class="n">${k.behindCount}</div><div class="l">Behind baseline</div><div class="dd ${behindCls}">tasks slipping</div></div>`);
  const overdueCls = k.overdueCount > 0 ? 'r' : '';
  cards.push(`<div class="c ${overdueCls}"><div class="n">${k.overdueCount}</div><div class="l">Overdue</div><div class="dd ${overdueCls}">past finish</div></div>`);
  cards.push(`<div class="c"><div class="n">${k.unstaffedCount}</div><div class="l">Unstaffed / unbooked</div><div class="dd">no crew</div></div>`);
  return `<div class="K">${cards.join('')}</div>`;
}

function colsBandHtml(model: ScheduleReportModel, opts: ReportOptions): string {
  const cols: string[] = [];
  if (has(opts, 'critPath')) {
    const rows = model.criticalPath.map((c) => {
      const title = c.isMilestone ? `◆ ${c.title}` : c.title;
      const dt = c.isMilestone ? esc(c.finishIso) : `${esc(c.startIso)} → ${esc(c.finishIso)}`;
      return `<div class="r crit"><span>${esc(title)}</span><span class="dt">${dt}</span></div>`;
    }).join('');
    cols.push(`<div><div class="sh">Critical path (driving chain)</div><div class="cp">${rows}</div></div>`);
  }
  if (has(opts, 'risks')) {
    const labelByKind: Record<ScheduleReportModel['risks'][number]['kind'], string> = {
      overdue: 'OVERDUE', zero_float: '0 FLOAT', low_float: 'LOW FLOAT', unstaffed: 'UNSTAFFED', behind: 'BEHIND', inspection: 'INSPECTION',
    };
    const items = model.risks.map((r) => {
      const tagCls = r.severity === 'hi' ? 'hi' : r.severity === 'md' ? 'md' : 'lo';
      return `<div class="i"><span class="tag ${tagCls}">${esc(labelByKind[r.kind])}</span><span>${esc(r.text)}</span></div>`;
    }).join('');
    cols.push(`<div><div class="sh">Risk &amp; alerts</div><div class="risk">${items}</div></div>`);
  }
  const col3parts: string[] = [];
  if (has(opts, 'lookahead')) {
    const weeks = model.lookahead.map((w) => {
      const items = w.items.map((it) => {
        const title = it.isMilestone ? `◆ ${it.title}` : it.title;
        const detail = [it.crew, `${it.startIso}–${it.finishIso}`].filter((x) => !!x && !!String(x).trim()).map(esc).join(' · ');
        return `<div class="x">${esc(title)} <span class="w">· ${detail}</span></div>`;
      }).join('');
      return `<div class="wk"><b>${esc(w.weekLabel)}</b>${items}</div>`;
    }).join('');
    col3parts.push(`<div class="sh">3-week look-ahead</div><div class="la">${weeks}</div>`);
  }
  if (has(opts, 'milestones')) {
    const rows = model.milestones.map((m) => {
      const dtCls = m.onTime ? 'vg' : 'vb';
      const vTxt = m.varianceDays == null ? 'on time' : m.varianceDays <= 0 ? 'on time' : `+${m.varianceDays}d`;
      return `<div class="r"><span>◆ ${esc(m.title)}</span><span class="dt ${dtCls}">${esc(m.dateIso)} · ${esc(vTxt)}</span></div>`;
    }).join('');
    col3parts.push(`<div class="sh">Upcoming milestones</div><div class="cp">${rows}</div>`);
  }
  if (col3parts.length) cols.push(`<div>${col3parts.join('')}</div>`);
  if (!cols.length) return '';
  return `<div class="cols">${cols.join('')}</div>`;
}

function ganttHtml(model: ScheduleReportModel, opts: ReportOptions, s: Scale): string {
  const pred = opts.showPredecessors;
  const phasePctByName = new Map<string, number>();
  for (const p of model.phaseProgress) phasePctByName.set(p.phase, p.percent);
  const head = `<tr><th>#</th><th>Task</th><th>Crew</th><th>Start</th><th>Finish</th><th>BL Fin</th><th>Δ</th><th>TF</th><th>FF</th><th>%</th>${pred ? '<th>Pred</th>' : ''}<th>Timeline</th></tr>`;
  const colspan = pred ? 11 : 10;
  let lastPhase: string | null = null;
  const body: string[] = [];
  for (const row of model.ganttRows) {
    if (row.phase !== lastPhase) {
      lastPhase = row.phase;
      const pct = phasePctByName.get(row.phase);
      const label = pct != null ? `${esc(row.phase)} — ${pct}%` : esc(row.phase);
      body.push(`<tr class="ph"><td></td><td colspan="${colspan}">${label}</td></tr>`);
    }
    const dCls = row.deltaDays != null && row.deltaDays > 0 ? ' class="vb"' : '';
    const dTxt = row.deltaDays == null ? '—' : `${row.deltaDays > 0 ? '+' : ''}${row.deltaDays}d`;
    const blFin = row.baselineFinishIso ? esc(row.baselineFinishIso) : '—';
    const tlParts: string[] = [];
    if (row.baselineBar) tlParts.push(`<div class="bl" style="left:${row.baselineBar.leftPct}%;width:${row.baselineBar.widthPct}%"></div>`);
    if (row.isMilestone) {
      tlParts.push(`<div class="ms${row.isCritical ? ' c' : ''}" style="left:${row.bar.leftPct}%${row.isCritical ? ';background:#FF3B30' : ''}"></div>`);
    } else {
      tlParts.push(`<div class="bar${row.isCritical ? ' c' : ''}${row.isSummary ? ' s' : ''}" style="left:${row.bar.leftPct}%;width:${row.bar.widthPct}%"></div>`);
      if (row.percent > 0 && !row.isSummary) {
        tlParts.push(`<div class="prog" style="left:${row.bar.leftPct}%;width:${(row.bar.widthPct * row.percent) / 100}%"></div>`);
      }
    }
    const title = row.isMilestone ? `◆ ${row.title}` : row.title;
    const crewCell = row.crew && row.crew.trim() ? esc(row.crew) : '<span style="color:#C2260F">TBD</span>';
    body.push(
      `<tr><td class="n">${row.index}</td><td>${esc(title)}</td><td>${crewCell}</td>` +
      `<td>${esc(row.startIso)}</td><td>${esc(row.finishIso)}</td><td>${blFin}</td>` +
      `<td${dCls}>${dTxt}</td><td class="n">${row.totalFloat}</td><td class="n">${row.freeFloat}</td><td class="n">${row.percent}%</td>` +
      (pred ? `<td>${esc(row.predecessors) || '—'}</td>` : '') +
      `<td><div class="tl">${tlParts.join('')}</div></td></tr>`
    );
  }
  void s;
  return `<div class="sh">Gantt — current vs baseline (▤ baseline · ▮ critical · ◆ milestone)</div>
<table class="G">${head}${body.join('')}</table>`;
}

function footerBandHtml(model: ScheduleReportModel, opts: ReportOptions): string {
  const cols: string[] = [];
  if (has(opts, 'slippages')) {
    const rows = model.slippages.map((sl) =>
      `<div class="r"><span><span class="vb">+${sl.deltaDays}d</span> ${esc(sl.title)}</span><span class="dt">vs baseline</span></div>`
    ).join('');
    cols.push(`<div><div class="sh">Biggest slippages vs baseline</div><div class="cp">${rows}</div></div>`);
  }
  if (has(opts, 'phaseProgress')) {
    const rows = model.phaseProgress.map((p) => {
      const barCss = p.percent > 0 && p.percent <= 10 ? ';background:#FF9500' : '';
      return `<div class="ph2"><span style="width:96px">${esc(p.phase)}</span><span class="b"><span class="f" style="width:${p.percent}%${barCss}"></span></span><span>${p.percent}%</span></div>`;
    }).join('');
    cols.push(`<div><div class="sh">Progress by phase</div>${rows}</div>`);
  }
  if (has(opts, 'weather')) {
    const rows = model.weatherClosures.map((w) =>
      `<div class="r"><span>${esc(w.label)}</span><span class="dt">${esc(w.note)}</span></div>`
    ).join('');
    cols.push(`<div><div class="sh">Weather &amp; closures (this period)</div><div class="cp">${rows}</div></div>`);
  }
  if (!cols.length) return '';
  return `<div class="cols" style="margin-top:8px">${cols.join('')}</div>`;
}

function registerHtml(model: ScheduleReportModel, opts: ReportOptions): string {
  const pred = opts.showPredecessors;
  const head = `<tr><th>#</th><th>Task</th><th>Phase</th><th>Crew</th><th>Start</th><th>Finish</th><th>%</th>${pred ? '<th>Pred</th>' : ''}</tr>`;
  const body = model.ganttRows.map((row) => {
    const title = row.isMilestone ? `◆ ${row.title}` : row.title;
    const crewCell = row.crew && row.crew.trim() ? esc(row.crew) : '<span style="color:#C2260F">TBD</span>';
    return `<tr><td class="n">${row.index}</td><td>${esc(title)}</td><td>${esc(row.phase)}</td><td>${crewCell}</td>` +
      `<td>${esc(row.startIso)}</td><td>${esc(row.finishIso)}</td><td class="n">${row.percent}%</td>` +
      (pred ? `<td>${esc(row.predecessors) || '—'}</td>` : '') + `</tr>`;
  }).join('');
  return `<div class="sh">Task register</div>
<table class="G">${head}${body}</table>`;
}

function legendHtml(model: ScheduleReportModel): string {
  return `<div class="legend">
    <div><span class="sw" style="background:#E5F0FF;border:1px solid #007AFF"></span>On-time</div>
    <div><span class="sw" style="background:#FFDDDA;border:1px solid #FF3B30"></span>Critical</div>
    <div><span class="sw" style="background:#999;opacity:.55;height:3px"></span>Baseline</div>
    <div><span class="sw" style="background:#007AFF;width:7px;height:7px;transform:rotate(45deg)"></span>Milestone</div>
    <div>TF = total float · FF = free float · Δ = finish vs baseline</div>
    <div style="margin-left:auto;color:#aaa">Generated by MAGE ID · ${esc(model.header.reportDateIso)}</div>
  </div>
</div>`;
}
