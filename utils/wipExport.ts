// NOTE: react-native / expo-print / expo-sharing are imported LAZILY inside
// shareWipPeriodPdf. Importing them at module top level pulls react-native's
// Flow-typed entry, which crashes Bun — and scripts/validate-wip.ts imports
// wipPeriodToCSV from this module. Keeping the pure builders (wipPeriodToCSV,
// buildWipHtml) free of top-level native imports keeps the validator runnable.
// (Same pattern the crew / activation-gating validators document.)
import {
  describeWipRowSources, wipRowCostAtCompletion, wipRowHasCostBasis, WIP_COST_TO_DATE_CAVEAT,
  type WipPeriodWithSources, type WipSnapshotRowWithSources,
} from '@/utils/wip';

// Each DERIVED figure is followed immediately by the branch that produced it.
// A surety's first question about a $1.4M contract is where the number came
// from, and before this the answer existed only in deriveOriginalContract's
// branch order — nowhere a GC could reach it (audit 2026-09-07, #26).
//
// THE SIX COLUMNS THIS EXPORT USED TO DROP (audit 2026-09-11), every one of
// them already sitting on the row it was iterating:
//
//   Original Contract and Approved Change Orders — separately, which is how an
//     underwriter sees scope growth. Both are on WipRowInput; only their SUM
//     was printed.
//   Cost to Complete and Gross Profit to Date — both on WipRow. Cost-to-date
//     paired with cost-to-complete is how profit fade is detected; profit to
//     date is what ties the schedule to an income statement.
//   Retainage Held — asked for by name on every surety submission, reported
//     separately from ordinary receivables, and absent from this schedule
//     entirely until 2026-09-11.
//   Loss Job — `anticipatedLoss` carries the app's flagship ASC 605-35 claim
//     and appeared in NO export anywhere. A schedule that books a full loss
//     provision and does not say which job it is on has not disclosed it.
//
// Order follows the surety-template reading order — identity, revenue, cost,
// progress, billing, profit — rather than the order the fields happen to sit in
// on the type.
const CSV_COLUMNS = [
  'Project', 'Loss Job',
  'Original Contract', 'Approved Change Orders',
  'Revised Contract', 'Revised Contract Source',
  'Total Est Cost', 'Total Est Cost Source',
  'Cost to Date', 'Cost to Date Source',
  'Cost to Complete', '% Complete',
  'Earned Revenue', 'Billed to Date', 'Overbilling', 'Underbilling', 'Retainage Held',
  'Gross Profit to Date', 'Est Gross Profit', 'Backlog',
  // PROFIT FADE, IN THE EXPORT (F8 part 2, audit 2026-09-11). It is the
  // surety's central diagnostic — the reason WIP schedules are read period over
  // period rather than as a snapshot — and it reached no export at all: the
  // flag fired on screen and its reason rendered inside a per-project modal.
  // The reasons are the row's OWN, frozen with it, not recomputed against
  // today's book.
  'Watch Flags',
];

/**
 * Retainage on one row, or '' when the row predates the column.
 *
 * A snapshot frozen before 2026-09-11 does not carry retainage, and printing $0
 * for it would assert that the owner is holding nothing back — the opposite of
 * the truth on most contracts, in the cell a surety reads first. Blank is the
 * only honest answer, and it is the same rule the Source cells already follow
 * with WIP_SOURCE_UNRECORDED.
 */
function retainageCell(r: WipSnapshotRowWithSources): string {
  return r.input.retainageHeld == null ? '' : String(Math.round(r.input.retainageHeld));
}

/**
 * THE AS-OF DISCLOSURE AN UNSAVED EXPORT HAS TO CARRY (adversarial review
 * 2026-09-11).
 *
 * The period-end picker defaults to the PRIOR MONTH END inside the first
 * fortnight of a month, which is the day a GC closing his books actually wants
 * — and `exportPeriod` stamps that day onto the live (unsaved) period so the
 * export and the Save it precedes cannot disagree. The consequence, measured on
 * 2026-09-11, was a live PDF headed "As of 2026-08-31" carrying September 11
 * figures: the export had been silently BACKDATED by up to fourteen days.
 *
 * MAGE has no as-of ledger — it cannot restate a book to a past date — so the
 * fix is not to compute August's figures, it is to say so on the document. The
 * Save alert already said it in words; Export PDF and Export CSV never passed
 * through that alert, so the one sentence that made the practice honest reached
 * only the path that did not need it.
 *
 * Returns '' for a SAVED period (its rows really were frozen on its period end)
 * and for a live period whose picked day IS today.
 */
export function wipLiveAsOfNote(
  period: Pick<WipPeriodWithSources, 'id' | 'periodEndDate'>,
  /** Today, as a LOCAL calendar day (utils/calendarDate.todayCalendarDay). */
  liveAsOf: string | undefined,
): string {
  if (period.id !== 'live') return '';
  if (!liveAsOf || liveAsOf === period.periodEndDate) return '';
  return `Figures are as they stand on ${liveAsOf} and are NOT restated to the `
    + `${period.periodEndDate} period end — MAGE does not keep an as-of ledger.`;
}

/**
 * The row's watch flags, as words.
 *
 * '' — never 'none' — when the row predates the column, for the same reason the
 * retainage cell is blank rather than $0: absent means NOT RECORDED, and 'none'
 * would assert that the fade watch ran and found nothing. A row that carries
 * flags and fired none says so explicitly.
 */
function wipRowFlagCell(r: WipSnapshotRowWithSources): string {
  if (!r.flags) return '';
  return r.flags.reasons.length > 0 ? r.flags.reasons.join('; ') : 'No watch flags';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure CSV builder — CPA/QuickBooks-pasteable WIP schedule. */
export function wipPeriodToCSV(
  period: WipPeriodWithSources,
  /** Today, when this is the LIVE (unsaved) period — see `wipLiveAsOfNote`. */
  liveAsOf?: string,
): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of period.rows) {
    const src = describeWipRowSources(r);
    lines.push([
      r.projectName,
      // A word, not a boolean. "LOSS JOB" survives a filter, a sort and a
      // photocopy; `true` in a column headed "Loss Job" does not read as an
      // accounting disclosure.
      r.output.anticipatedLoss ? 'LOSS JOB' : '',
      Math.round(r.input.originalContract),
      Math.round(r.input.approvedChangeOrders),
      Math.round(r.output.revisedContract), src.originalContract,
      // The cost at completion this ROW was struck against — which is
      // costToDate + the entered cost to complete when the GC has revised his
      // forecast, and the derived figure otherwise.
      Math.round(wipRowCostAtCompletion(r)), src.totalEstimatedCost,
      Math.round(r.input.costToDate), src.costToDate,
      Math.round(r.output.costToComplete),
      (r.output.percentComplete * 100).toFixed(1),
      Math.round(r.output.earnedRevenue),
      Math.round(r.input.billedToDate),
      Math.round(r.output.overbilling),
      Math.round(r.output.underbilling),
      retainageCell(r),
      Math.round(r.output.profitToDate),
      // A JOB WITH NO COST BASIS HAS NO MEASURABLE GROSS PROFIT (F14). Its
      // "est gross profit" is the whole contract and its margin is 100%,
      // because deriveOriginalContract falls back to a target budget while
      // deriveEstimatedCost deliberately does not. Printing $900,000 of
      // fabricated profit on a surety document is the worst place for it, so
      // the cell is BLANK — the same rule retainage follows one column over:
      // a figure the schedule cannot defend is not printed as a number.
      wipRowHasCostBasis(r) ? Math.round(r.output.estGrossProfit) : '',
      Math.round(r.output.backlog),
      wipRowFlagCell(r),
    ].map(csvCell).join(','));
  }
  const t = period.portfolioTotals;
  // The TOTAL line's source cells stay empty on purpose: a portfolio sum has no
  // single provenance, and repeating one row's branch across the total would
  // claim the whole column came from it.
  const lossJobs = period.rows.filter((r) => r.output.anticipatedLoss).length;
  const measurable = period.rows.filter(wipRowHasCostBasis);
  lines.push([
    'TOTAL',
    lossJobs > 0 ? `${lossJobs} LOSS JOB${lossJobs === 1 ? '' : 'S'}` : '',
    Math.round(period.rows.reduce((sum, r) => sum + r.input.originalContract, 0)),
    Math.round(period.rows.reduce((sum, r) => sum + r.input.approvedChangeOrders, 0)),
    Math.round(t.revisedContract), '',
    Math.round(t.totalEstimatedCost), '',
    Math.round(t.costToDate), '',
    Math.round(period.rows.reduce((sum, r) => sum + r.output.costToComplete, 0)),
    '',
    Math.round(t.earnedRevenue), Math.round(t.billedToDate),
    Math.round(t.overbilling), Math.round(t.underbilling),
    t.retainageHeld == null ? '' : Math.round(t.retainageHeld),
    Math.round(period.rows.reduce((sum, r) => sum + r.output.profitToDate, 0)),
    // Σ over MEASURABLE jobs only, matching the cells above it and the
    // weighted margin in computeWipPortfolio. `revisedContract −
    // totalEstimatedCost` across the whole book silently re-admitted every
    // costless job's contract as pure profit into the one figure a reader
    // totals by eye.
    Math.round(measurable.reduce((sum, r) => sum + r.output.estGrossProfit, 0)),
    Math.round(t.backlog),
    '',
  ].map(csvCell).join(','));
  // THE LINE THAT MAKES THE TOTAL ROW FOOT (adversarial review 2026-09-11).
  //
  // A surety or a CPA cross-foots the total line of a WIP schedule: Revised
  // Contract − Total Est Cost should equal Est Gross Profit. It does not, and
  // cannot, whenever any job has no cost basis: the contract column sums the
  // WHOLE book (correct — a WIP total row does) while Est Gross Profit is
  // struck on the measurable subset (also correct — a costless job's "gross
  // profit" is its entire contract). Measured on a two-job book: 1,900,000 −
  // 800,000 = 1,100,000 against an Est Gross Profit cell reading 200,000, a
  // $900,000 discrepancy inside one row.
  //
  // Neither half is the thing to change, so the reconciling line is printed
  // instead: the same three columns over the measurable jobs only, which DO
  // foot. A reader adding across is then never off by a figure with no line
  // naming it. Omitted when the book is fully measurable, where TOTAL already
  // foots and a duplicate row would be noise.
  if (measurable.length !== period.rows.length && measurable.length > 0) {
    const mContract = measurable.reduce((sum, r) => sum + r.output.revisedContract, 0);
    const mCost = measurable.reduce((sum, r) => sum + wipRowCostAtCompletion(r), 0);
    const mRow = new Array(CSV_COLUMNS.length).fill('');
    mRow[0] = `MEASURABLE SUBTOTAL (${measurable.length} of ${period.rows.length} jobs)`;
    mRow[CSV_COLUMNS.indexOf('Revised Contract')] = Math.round(mContract);
    mRow[CSV_COLUMNS.indexOf('Total Est Cost')] = Math.round(mCost);
    mRow[CSV_COLUMNS.indexOf('Est Gross Profit')] = Math.round(mContract - mCost);
    lines.push(mRow.map(csvCell).join(','));
  }
  // THE ACCRUAL A CPA ACTUALLY POSTS. ASC 605-35-25-46 requires the whole
  // forecast loss the moment it is evident, per contract and never netted
  // against profitable ones — and the TOTAL line above nets it, because a WIP
  // total row does sum across jobs. So the provision gets its own line rather
  // than being left for the reader to find. Omitted entirely when the book has
  // no loss job, because a "$0 provision" line invites the question of which
  // job it is for.
  if (t.lossProvision != null && t.lossProvision > 0) {
    const provisionRow = new Array(CSV_COLUMNS.length).fill('');
    provisionRow[0] = 'PROVISION FOR LOSS ON UNCOMPLETED CONTRACTS';
    provisionRow[CSV_COLUMNS.indexOf('Gross Profit to Date')] = Math.round(-t.lossProvision);
    lines.push(provisionRow.map(csvCell).join(','));
  }
  // The jobs the margin cannot speak for, named. Suppressing a figure without
  // saying it was suppressed is its own quiet lie, and this is the line that
  // stops the TOTAL above reading as the whole book.
  const noBasis = period.rows.filter((r) => !wipRowHasCostBasis(r));
  if (noBasis.length > 0) {
    const noBasisRow = new Array(CSV_COLUMNS.length).fill('');
    noBasisRow[0] = `NO COST BASIS — ${noBasis.length} contract`
      + `${noBasis.length === 1 ? '' : 's'} (${noBasis.map((r) => r.projectName).join(', ')}) `
      + `carr${noBasis.length === 1 ? 'ies' : 'y'} a contract value with no cost estimate, no signed `
      + 'commitment and nothing spent. '
      + `${noBasis.length === 1 ? 'It is' : 'They are'} EXCLUDED from the gross-profit total and from the `
      + 'weighted margin, because a '
      + 'contract with no cost basis has no measurable margin.';
    noBasisRow[CSV_COLUMNS.indexOf('Revised Contract')] = Math.round(
      noBasis.reduce((sum, r) => sum + r.output.revisedContract, 0),
    );
    lines.push(noBasisRow.map(csvCell).join(','));
  }
  // The backdating disclosure, as its own memo line, for the same reason the
  // provision above gets one: it is a statement about the document rather than
  // a figure in a column, and a reader who does not read it has misdated the
  // whole sheet.
  const asOfNote = wipLiveAsOfNote(period, liveAsOf);
  if (asOfNote) {
    const noteRow = new Array(CSV_COLUMNS.length).fill('');
    noteRow[0] = asOfNote;
    lines.push(noteRow.map(csvCell).join(','));
  }
  // The caveat the exports used to drop rides in the Cost to Date Source cell
  // itself (WIP_SOURCE_LABELS.commitments_and_receipts) rather than as a
  // trailing note, so it lands next to the number in every row and a CPA
  // filtering the sheet cannot lose it.
  return lines.join('\n');
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * A figure a legacy snapshot cannot supply. Blank, never $0 — see
 * `retainageCell`; the same reasoning applies on the page a surety reads.
 */
function orBlank(n: number | null | undefined): string {
  return n == null ? '—' : money(n);
}

function htmlRow(r: WipSnapshotRowWithSources): string {
  // A loss job is named ON ITS OWN ROW. The engine books the entire forecast
  // loss the moment it is evident (ASC 605-35-25-46) and, until 2026-09-11, no
  // export said which job carried it — the reader saw a negative Est GP among
  // eleven other numbers and nothing calling it what it is.
  const loss = r.output.anticipatedLoss;
  return `<tr${loss ? ' class="loss"' : ''}>
    <td class="l">${escapeHtml(r.projectName)}${loss ? ' <span class="lossTag">LOSS JOB</span>' : ''}</td>
    <td>${money(r.input.originalContract)}</td>
    <td>${money(r.input.approvedChangeOrders)}</td>
    <td>${money(r.output.revisedContract)}</td>
    <td>${money(r.input.costToDate)}</td>
    <td>${money(wipRowCostAtCompletion(r))}</td>
    <td>${money(r.output.costToComplete)}</td>
    <td>${(r.output.percentComplete * 100).toFixed(0)}%</td>
    <td>${money(r.output.earnedRevenue)}</td>
    <td>${money(r.input.billedToDate)}</td>
    <td>${money(r.output.overbilling)}</td>
    <td>${money(r.output.underbilling)}</td>
    <td>${orBlank(r.input.retainageHeld)}</td>
    <td>${money(r.output.profitToDate)}</td>
    <td>${wipRowHasCostBasis(r) ? money(r.output.estGrossProfit) : '—'}</td>
    <td>${money(r.output.backlog)}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * The PDF's provenance footnote. This is the document that actually leaves the
 * building, and it used to print eleven columns of dollars with nothing saying
 * where any of them came from — it dropped even the "est. — tap to add labor"
 * caveat the list row on screen has always carried. A banker holding this page
 * asks one question first: what is this contract figure? The answer is here.
 */
function footnotesHtml(period: WipPeriodWithSources): string {
  const items = period.rows.map((r) => {
    const s = describeWipRowSources(r);
    return `<li><b>${escapeHtml(r.projectName)}</b><br/>`
      + `Revised contract ${money(r.output.revisedContract)} — ${escapeHtml(s.originalContract)}<br/>`
      // The cost the ROW WAS STRUCK AGAINST, never the derivation it started
      // from. This footnote printed `input.totalEstimatedCost` — so a job whose
      // GC had entered a cost to complete got a footnote quoting MAGE's
      // superseded $620,000 beside a margin measured against his own $800,000,
      // on the page that exists to explain where the figures come from.
      + `Total estimated cost ${money(wipRowCostAtCompletion(r))} — ${escapeHtml(s.totalEstimatedCost)}<br/>`
      + `Cost to date ${money(r.input.costToDate)} — ${escapeHtml(s.costToDate)}`
      // WATCH FLAGS (F8 part 2). A 17th column would not fit and would not be
      // read; the reason a job is flagged is a SENTENCE, and this is the block
      // that already carries sentences. A row with no `flags` prints nothing —
      // never "no flags", which would assert the watch ran.
      + (r.flags
        ? `<br/><span class="flag">${r.flags.reasons.length > 0
          ? escapeHtml(r.flags.reasons.join(' · '))
          : 'No watch flags on this period'}</span>`
        : '')
      + '</li>';
  }).join('');
  return `<div class="notes">
    <h2>Where these figures come from</h2>
    <ul>${items}</ul>
    <p class="caveat">${escapeHtml(WIP_COST_TO_DATE_CAVEAT)}</p>
  </div>`;
}

/**
 * The loss provision, as its own disclosure below the table.
 *
 * The TOTAL row nets a loss job against the profitable ones — correct for a WIP
 * total, and exactly why the provision cannot be left inside it. ASC
 * 605-35-25-46 requires the entire forecast loss to be recognised as soon as it
 * is evident, per contract; the accrual is the part of that loss the job has
 * not yet run through cost. Rendered only when there IS one: a "$0 provision"
 * line on a healthy book is noise a reader has to resolve.
 */
function provisionHtml(period: WipPeriodWithSources): string {
  const t = period.portfolioTotals;
  const lossRows = period.rows.filter((r) => r.output.anticipatedLoss);
  if (lossRows.length === 0 || !(t.lossProvision != null && t.lossProvision > 0)) return '';
  const names = lossRows.map((r) => escapeHtml(r.projectName)).join(', ');
  return `<div class="provision"><b>Provision for loss on uncompleted contracts —
    ${money(t.lossProvision)}.</b> ${lossRows.length} contract${lossRows.length === 1 ? ' is' : 's are'}
    forecast to finish at a loss (${names}), totalling ${money(t.totalForecastLoss ?? 0)}. The full
    loss is recognised in the period it becomes evident and is not pro-rated by percent complete;
    the provision above is the part of it not yet incurred. A forecast loss on one contract may not
    be offset against profit on another, so the portfolio margin on this schedule does not disclose
    it and this line does.</div>`;
}

/**
 * The contracts the margin cannot speak for, named on the page.
 *
 * `deriveOriginalContract` falls back to a target budget and then a GMP cap for
 * REVENUE; `deriveEstimatedCost` deliberately excludes both, so a job set up
 * with only a budget carries a contract and no cost and reports its entire
 * contract as gross profit at a 100% margin. The row's Est GP cell prints an em
 * dash and the total and the weighted margin exclude it — and this block is
 * what stops that suppression from being silent. The budget standing in as a
 * contract can even have been set by the CLIENT (ProjectTargetBudget.setBy),
 * which is worth a reader knowing before he underwrites against it.
 */
function noCostBasisHtml(period: WipPeriodWithSources): string {
  const rows = period.rows.filter((r) => !wipRowHasCostBasis(r));
  if (rows.length === 0) return '';
  const names = rows.map((r) => escapeHtml(r.projectName)).join(', ');
  const contract = rows.reduce((sum, r) => sum + r.output.revisedContract, 0);
  return `<div class="nobasis"><b>No cost basis — ${rows.length} contract${rows.length === 1 ? '' : 's'}
    totalling ${money(contract)}.</b> ${names} carr${rows.length === 1 ? 'ies' : 'y'} a contract value
    with no cost estimate, no signed subcontract or PO, and nothing spent. A contract with no cost
    basis has no measurable margin, so ${rows.length === 1 ? 'it is' : 'they are'} excluded from the
    estimated gross profit total and from the weighted margin rather than reported at 100%.</div>`;
}

/**
 * The reconciling line under TOTAL, for the same reason the CSV has one:
 * Revised Contract − Est Cost at Completion ≠ Est GP on the total row whenever
 * a job has no cost basis, and a surety cross-foots that row. This one foots.
 * Rendered only when the two differ.
 */
function measurableFootHtml(period: WipPeriodWithSources): string {
  const measurable = period.rows.filter(wipRowHasCostBasis);
  if (measurable.length === period.rows.length || measurable.length === 0) return '';
  const contract = measurable.reduce((sum, r) => sum + r.output.revisedContract, 0);
  const cost = measurable.reduce((sum, r) => sum + wipRowCostAtCompletion(r), 0);
  return `<tr class="subtotal">
    <td class="l">MEASURABLE SUBTOTAL (${measurable.length} of ${period.rows.length} jobs)</td>
    <td></td><td></td><td>${money(contract)}</td>
    <td></td><td>${money(cost)}</td>
    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
    <td>${money(contract - cost)}</td><td></td>
  </tr>`;
}

/** CPA-style WIP schedule HTML for PDF export. */
export function buildWipHtml(
  period: WipPeriodWithSources,
  companyName: string,
  /** Today, when this is the LIVE (unsaved) period — see `wipLiveAsOfNote`. */
  liveAsOf?: string,
): string {
  const t = period.portfolioTotals;
  const asOfNote = wipLiveAsOfNote(period, liveAsOf);
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
    h1 { font-size: 20px; margin: 0; }
    .sub { color: #666; font-size: 12px; margin: 4px 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #ddd; padding: 5px 6px; text-align: right; }
    th { background: #f4f1ea; }
    td.l, th.l { text-align: left; }
    tfoot td { font-weight: 700; background: #faf7f0; }
    tfoot tr.subtotal td { font-weight: 600; background: #fffdf8; color: #555; }
    tr.loss td { background: #fdf3f2; }
    .lossTag { font-size: 8px; font-weight: 700; color: #8a2b22; border: 1px solid #d9a49d;
               border-radius: 3px; padding: 1px 3px; white-space: nowrap; }
    .nobasis { margin-top: 10px; font-size: 10px; color: #333; padding: 8px;
               background: #faf7f0; border: 1px solid #e6ded0; line-height: 1.45; }
    .asof { margin: -10px 0 16px; font-size: 10px; color: #8a2b22; padding: 6px 8px;
            background: #fdf3f2; border: 1px solid #e6c8c3; line-height: 1.45; }
    .provision { margin-top: 10px; font-size: 10px; color: #333; padding: 8px;
                 background: #fdf3f2; border: 1px solid #e6c8c3; line-height: 1.45; }
    .notes { margin-top: 18px; font-size: 10px; color: #333; }
    .notes h2 { font-size: 12px; margin: 0 0 6px; }
    .notes ul { margin: 0; padding-left: 16px; }
    .notes li { margin-bottom: 6px; line-height: 1.45; }
    .flag { color: #8a2b22; font-weight: 700; }
    .caveat { margin-top: 10px; padding: 8px; background: #faf7f0; border: 1px solid #e6ded0; line-height: 1.45; }
  </style></head><body>
    <h1>${escapeHtml(companyName)} — Work-In-Progress Schedule</h1>
    <div class="sub">As of ${escapeHtml(period.periodEndDate)}${period.lockedAt ? ' · LOCKED' : ''}
      · Prepared by management on the percentage-of-completion (cost-to-cost) basis</div>
    ${asOfNote ? `<div class="asof">${escapeHtml(asOfNote)}</div>` : ''}
    <table>
      <thead><tr>
        <th class="l">Project</th><th>Original Contract</th><th>Approved COs</th><th>Revised Contract</th>
        <th>Cost to Date</th><th>Est Cost at Completion</th><th>Cost to Complete</th>
        <th>% Comp</th><th>Earned Rev</th><th>Billed</th><th>Overbill</th><th>Underbill</th>
        <th>Retainage Held</th><th>GP to Date</th><th>Est GP</th><th>Backlog</th>
      </tr></thead>
      <tbody>${period.rows.map(htmlRow).join('')}</tbody>
      <tfoot><tr>
        <td class="l">TOTAL</td>
        <td>${money(period.rows.reduce((sum, r) => sum + r.input.originalContract, 0))}</td>
        <td>${money(period.rows.reduce((sum, r) => sum + r.input.approvedChangeOrders, 0))}</td>
        <td>${money(t.revisedContract)}</td>
        <td>${money(t.costToDate)}</td><td>${money(t.totalEstimatedCost)}</td>
        <td>${money(period.rows.reduce((sum, r) => sum + r.output.costToComplete, 0))}</td>
        <td></td><td>${money(t.earnedRevenue)}</td><td>${money(t.billedToDate)}</td>
        <td>${money(t.overbilling)}</td><td>${money(t.underbilling)}</td>
        <td>${orBlank(t.retainageHeld)}</td>
        <td>${money(period.rows.reduce((sum, r) => sum + r.output.profitToDate, 0))}</td>
        <td>${money(period.rows.filter(wipRowHasCostBasis)
          .reduce((sum, r) => sum + r.output.estGrossProfit, 0))}</td><td>${money(t.backlog)}</td>
      </tr>${measurableFootHtml(period)}</tfoot>
    </table>
    ${noCostBasisHtml(period)}
    ${provisionHtml(period)}
    ${footnotesHtml(period)}
  </body></html>`;
}

/** Render + share the WIP schedule as a PDF (mirrors financialReportPdf). */
export async function shareWipPeriodPdf(
  period: WipPeriodWithSources,
  companyName: string,
  liveAsOf?: string,
): Promise<void> {
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  const { Platform } = await import('react-native');
  const html = buildWipHtml(period, companyName, liveAsOf);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `WIP Report ${period.periodEndDate}`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
