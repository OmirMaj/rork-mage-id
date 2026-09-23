// validate-w5-estimating-screens.ts — wave 5, lane "estimating": the screen
// wiring for each finding. The arithmetic lives in
// validate-w5-estimating-money.ts; this checks the screens CALL it, and runs
// the one piece of screen logic that can be lifted (Cost X-Ray's summary).
//
// Run: bun run scripts/validate-w5-estimating-screens.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAppStorageKey } from '@/utils/localCacheKeys';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' | 'tsx' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, why = '') => {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
};
/** The body of `const <name> = useCallback(` … up to its deps array. */
const callbackBody = (src: string, name: string): string => {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  const end = src.indexOf('\n  }, [', at);
  return end < 0 ? '' : src.slice(at, src.indexOf('\n', end + 1));
};

// ── #8 Drawing Analyzer ────────────────────────────────────────────────────
console.log('\n#8 app/drawing-analyzer.tsx');
{
  const src = code('app/drawing-analyzer.tsx');
  const use = callbackBody(src, 'handleUseAsEstimate');
  ok('handleUseAsEstimate builds its lines with analyzerCostItems (the contingency row included)', /analyzerCostItems\(result\.lineItems/.test(use) && /result\.totals/.test(use));
  ok('…writes a new estimate through buildNewEstimate at HIS markup', /buildNewEstimate\(costItems, markupPct/.test(use));
  ok('…never a hard-coded at-cost estimate', !/globalMarkup:\s*0/.test(src) && !/markupTotal:\s*0/.test(use));
  ok('…refuses an unanswered markup ("Set your markup first")', /if \(!isMarkupSet\(markupPct\)\)/.test(use) && /Set your markup first/.test(use));
  ok('…reads the markup he gave (markupDecided), not a default', /markupDecided === true \? savedMarkup : null/.test(src));
  ok('…asks Replace / Append when the project already has an estimate, naming its total', /existing\.items\.length > 0/.test(use) && /This project already has an estimate/.test(use) && /formatMoney\(existing\.grandTotal/.test(use));
  ok('…Append carries the existing estimate\'s ratio (appendAtEstimateRatio)', /appendAtEstimateRatio\(existing, costItems/.test(use));
  ok('…the replaced estimate is kept as a \'manual\' revision', /reason: 'manual', note: 'Replaced from the AI Drawing Analyzer'/.test(use) && !/pre_overwrite/.test(use));
  ok('…and getProject is a dependency (reads the live project)', /\}, \[[^\]]*getProject[^\]]*\]\);$/.test(use));
  ok('the result card shows the markup row the gate points at', /testID="analyzer-markup-row"/.test(src) && /onChooseMarkup=\{recordMarkupDecision\}/.test(src));
  // #124 carry
  ok('#124: a cap / tier refusal offers the upgrade path, not a retry', /edgeErrorCode\(e\)/.test(src) && /code === 'monthly_cap_reached' \|\| code === 'tier_required'/.test(src) && /router\.push\('\/paywall'/.test(src));
}

// ── #9 / #88 / #124 Cost X-Ray ────────────────────────────────────────────
console.log('\n#9 / #88 / #124 app/cost-xray.tsx');
{
  const raw = read('app/cost-xray.tsx');
  const src = code('app/cost-xray.tsx');
  ok('#9: no copy promises the lines are GC-only', !/GC-only/.test(src));
  // w5-join-screens landed the client-view half (xray.clientVisible false →
  // one neutral 'Contingency' scope line), so the copy now says exactly that.
  ok('#9: the review copy says the proposal shows only a Contingency total, never the finding', /as one \\u201cContingency\\u201d line, never the finding/.test(src) && !/named on the client/.test(src));
  ok('#9: isAllowance is NOT flipped (allowance semantics unchanged)', /isAllowance: true/.test(src));
  const apply = callbackBody(src, 'applyToEstimate');
  ok('#88: no separate "No estimate yet" alert before the summary', !/'No estimate yet'/.test(apply));
  ok('#88: lines are counted inside the branch that wrote them', /linesAdded = newItems\.length;/.test(apply) && apply.indexOf('linesAdded = newItems.length') > apply.indexOf('commitEstimatePatch('));
  ok('#88: verify tasks are counted as every accepted tell', /verifyTasks: accepted\.length/.test(apply));
  ok('#88: the apply bar relabels when there is no estimate', /Create \$\{accepted\.length\} verify task/.test(src) && /No estimate on this project — contingency won&apos;t be added/.test(src));
  ok('#124: the function error goes through edgeFunctionError', /throw await edgeFunctionError\(fnErr, 'Cost X-Ray failed'\)/.test(src));
  ok('#124: a cap / tier refusal is not the "offline, retry" state', /code === 'monthly_cap_reached' \|\| code === 'tier_required'/.test(src) && /router\.push\('\/paywall'/.test(src));

  // Execute the summary out of the shipped file.
  const start = raw.indexOf('function xrayApplySummary(');
  const end = raw.indexOf('\n}\n', start);
  ok('#88: xrayApplySummary is liftable', start > 0 && end > start);
  type Summary = (r: { verifyTasks: number; linesAdded: number; dollarsAdded: number; pricedNotAdded: number; dollarsNotAdded: number }) => string;
  const summary: Summary = start > 0 && end > start
    ? new Function('formatMoney', `${new Bun.Transpiler({ loader: 'ts' }).transformSync(raw.slice(start, end + 2))}\nreturn xrayApplySummary;`)(
      (n: number) => `$${n.toLocaleString('en-US')}`,
    ) as Summary
    : () => '';
  const none = summary({ verifyTasks: 2, linesAdded: 0, dollarsAdded: 0, pricedNotAdded: 1, dollarsNotAdded: 3600 });
  ok('#88: no estimate → it says the $ were NOT added, and nothing "added to your estimate"', /\$3,600 of hidden-condition contingency was NOT added/.test(none) && !/added to your estimate/.test(none), none);
  ok('#88: …and counts every accepted tell as a verify task', /2 field-verify tasks created/.test(none));
  const some = summary({ verifyTasks: 3, linesAdded: 2, dollarsAdded: 5000, pricedNotAdded: 0, dollarsNotAdded: 0 });
  ok('#88: with an estimate it reports the lines the patch carried', /2 hidden-condition lines \(\+\$5,000\) added to your estimate/.test(some) && !/NOT added/.test(some), some);
}

// ── #10 decimal keypads ───────────────────────────────────────────────────
console.log('\n#10 money and percent fields take a decimal');
{
  const numericCount = (rel: string) => (code(rel).match(/inputMode="numeric"/g) ?? []).length;
  ok('quick-quote: no money/percent box on the digits-only pad', numericCount('app/quick-quote.tsx') === 0 && (code('app/quick-quote.tsx').match(/inputMode="decimal"/g) ?? []).length === 3);
  ok('quick-quote: parseAmount reads through parseDecimalInput (\'7,5\' is 7.5, not 75)', /parseDecimalInput\(s\)/.test(code('app/quick-quote.tsx')) && !/replace\(\/\[\^0-9\.\]\/g/.test(code('app/quick-quote.tsx')));
  for (const f of ['app/smart-proposal.tsx', 'app/win-optimizer.tsx']) {
    const s = code(f);
    ok(`${f}: job cost and markup are decimal; only "Competing bids" stays a whole-number pad`, numericCount(f) === 1 && (s.match(/inputMode="decimal"/g) ?? []).length === 2 && /value=\{competitorsStr\}[\s\S]{0,200}inputMode="numeric"/.test(s));
    ok(`${f}: cost and markup parse through parseDecimalInput`, /parseDecimalInput\(costStr\)/.test(s) && /parseDecimalInput\(markupStr\)/.test(s));
  }
  const pi = code('app/plan-intelligence.tsx');
  ok('plan-intelligence: Your $/SF and Square feet are decimal', numericCount('app/plan-intelligence.tsx') === 0 && /value=\{rateStr\}[^\n]*inputMode="decimal"/.test(pi) && /value=\{sqftStr\}[^\n]*inputMode="decimal"/.test(pi));
  ok('plan-intelligence: a typed 0 $/SF is kept, not swallowed by `|| rate`', /rateIn == null \? room\.ratePerSqft : Math\.max\(0, rateIn\)/.test(pi));
}

// ── #90 Quick Quote screen ────────────────────────────────────────────────
console.log('\n#90 app/quick-quote.tsx + app/smart-proposal.tsx');
{
  const q = code('app/quick-quote.tsx');
  ok('the screen totals come from quickQuoteTotals (what the quote saves)', /quickQuoteTotals\(\{/.test(q));
  ok('the totals and the saved alert print cents', /formatMoney\(total, 2\)/.test(q) && /formatMoney\(quote\.tiers\[0\]\?\.price \?\? 0, 2\)/.test(q));
  ok('the share text gets his saved licence number (both sends)', (q.match(/proposalToShareText\((quote|record), \{ licenseNumber \}\)/g) ?? []).length === 2);
  const sp = code('app/smart-proposal.tsx');
  ok('smart-proposal passes his saved licence to the tiers and the share text', /licenseNumber,\n\s*\}\);/.test(sp) && /proposalToShareText\(record, \{ licenseNumber \}\)/.test(sp));
}

// ── #55 / #93 the Full Estimator ──────────────────────────────────────────
console.log('\n#55 / #93 app/(tabs)/estimate/full.tsx + components/PDFPreSendSheet.tsx');
{
  const full = code('app/(tabs)/estimate/full.tsx');
  const email = callbackBody(full, 'handleShareEmail');
  ok('#55: the email body is built by buildEstimateEmailBody', /buildEstimateEmailBody\(\{/.test(email));
  ok('#55: no "Markup:" field and no cost unit price in the handler', !/Markup:/.test(email) && !/\/\$\{item\.material\.unit\}/.test(email) && !/adjustedRate\.toFixed/.test(email));
  ok('#93: bulk savings reach the PDF only when the section is ticked', /options\.sections\.some\(s => s\.id === 'bulk_savings' && s\.enabled\)/.test(full));
  ok('#93: …at both send sites', (full.match(/bulkSavingsTotal: bulkSavingsForPdf\(options\)/g) ?? []).length === 2 && !/bulkSavingsTotal: showBulkSavings \?/.test(full));
  ok('#93: closing the confirm-link popup without linking clears the picked project', /const closeConfirmLink = useCallback\(\(\) => \{\s*setShowConfirmLink\(false\);\s*setPendingLinkProject\(null\);/.test(full));
  ok('#93: …on every close path (X, backdrop, Android back)', !/\(\) => setShowConfirmLink\(false\)/.test(full) && (full.match(/closeConfirmLink\b/g) ?? []).length >= 7);
  const sheet = code('components/PDFPreSendSheet.tsx');
  const estAt = sheet.indexOf("case 'estimate': {");
  const est = estAt < 0 ? '' : sheet.slice(estAt, sheet.indexOf("case 'invoice':", estAt));
  ok('#93: the estimate sections block is found', est.length > 0);
  ok('#93: Bulk Savings defaults OFF', /\{ id: 'bulk_savings', label: 'Bulk Savings Breakdown', enabled: false \}/.test(est) && !/enabled: true/.test(est));
  ok('#93: no dead estimate toggles (Line Items / Cost Summary / Schedule / Branding)', !/line_items|cost_summary|schedule_summary|'branding'/.test(est));
  ok('#93: the sections block hides when there is nothing to toggle', /\{sections\.length > 0 && \(/.test(sheet));
}

// ── #87 / #6 Visual Takeoff + Plan Intelligence ───────────────────────────
console.log('\n#87 / #6 app/area-takeoff.tsx + app/plan-intelligence.tsx');
{
  const at = code('app/area-takeoff.tsx');
  ok('#87: the result card offers a job picker instead of "Open this from a project"', /testID="takeoff-job-picker"/.test(at) && !/Open this from a project/.test(at));
  ok('#87: no job with an estimate → "Build an estimate"', /testID="takeoff-build-estimate"/.test(at) && /\/estimate-wizard/.test(at));
  ok('#87: a scale saves under the SHEET\'s project, not the job picked now', /projectId: sheetProjectId/.test(at) && !/planSheetId: sheetId, projectId,/.test(at));
  for (const f of ['app/area-takeoff.tsx', 'app/plan-intelligence.tsx']) {
    const s = code(f);
    ok(`#6: ${f} no longer imports isAtCostLine`, !/isAtCostLine/.test(s));
  }
  ok('#6: every appended takeoff line takes the estimate ratio', /const ratio = est\.baseTotal > 0 \? est\.markupTotal \/ est\.baseTotal : 0;/.test(at));
  ok('#6: …and every appended plan room too', /const ratio = est\.baseTotal > 0 \? est\.markupTotal \/ est\.baseTotal : 0;/.test(code('app/plan-intelligence.tsx')));
}

// ── #89 / #91 / #148 the takeoff's priced estimate ────────────────────────
console.log('\n#89 / #91 / #148 app/takeoff-estimate.tsx');
{
  const raw = read('app/takeoff-estimate.tsx');
  const src = code('app/takeoff-estimate.tsx');
  const prefix = (raw.match(/const DRAFT_PREFIX = '([^']+)'/) ?? [])[1] ?? '';
  ok('#89: the draft key is mageid_-prefixed (inside the tenant sweep)', isAppStorageKey(`${prefix}p1`) && prefix.startsWith('mageid_'));
  ok('#89: …and NOT under mageid_takeoff:: (listTakeoffKeys would read it as a takeoff)', !`${prefix}p1`.startsWith('mageid_takeoff::'));
  ok('#89: the draft is read before the auto-price effect may run', /if \(!takeoff \|\| !draftChecked \|\| staleDraft \|\| pricing \|\| lines\.length > 0\) return;/.test(src));
  ok('#89: …restored only when it priced THIS takeoff', /draft\.takeoffSavedAt === takeoff\.savedAt/.test(src) && /Takeoff changed since you priced it — re-price\?/.test(src));
  ok('#89: every storage call is in try/catch', (raw.match(/async function (readDraft|writeDraft|clearDraft)[\s\S]*?\n\}/g) ?? []).every(f => /try \{/.test(f) && /catch/.test(f)) && (raw.match(/async function (readDraft|writeDraft|clearDraft)/g) ?? []).length === 3);
  ok('#89: leaving with unsaved edits asks ("Discard your price edits?")', /usePreventRemove\(dirty && !saving/.test(src) && /'Discard your price edits\?'/.test(src));
  ok('#89: the draft is cleared on a save and on Regenerate', /markSaved\(\);/.test(callbackBody(src, 'doReplace')) && /markSaved\(\);/.test(callbackBody(src, 'doAppend')) && /void clearDraft\(draftKey\);\s*setDirty\(false\);\s*setLines\(\[\]\);/.test(src));
  const replace = callbackBody(src, 'doReplace');
  ok('#91: Replace is footed by buildNewEstimate (withMarkup), not the raw totals memo', /buildNewEstimate\(costItems\(\), markupPct/.test(replace) && !/baseTotal: totals\.subtotal/.test(replace));
  ok('#91: …and its alert prints the stored total to the cent', /formatMoney\(linkedEstimate\.grandTotal, 2\)/.test(replace));
  ok('#91: Append rounds each new line and moves the totals by rounded sums', /appendAtEstimateRatio\(est, costItems\(\), markupPct\)/.test(callbackBody(src, 'doAppend')));
  ok('#91: the totals bar reads the same footed estimate', /const est = buildNewEstimate\(takeoffCostItems\(lines\)/.test(src));
  ok('#148: price and quantity parse with parseMoneyInput', /parseMoneyInput\(qty\)/.test(src) && /parseMoneyInput\(price\)/.test(src) && !/parseFloat\(price\)/.test(src) && !/parseFloat\(qty\)/.test(src));
  ok('#148: an unreadable box keeps the old value and says why', /priceIn == null \? line\.unitPrice/.test(src) && /qtyIn == null \? line\.quantity/.test(src) && /Done keeps the current/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
