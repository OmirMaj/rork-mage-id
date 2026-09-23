// scripts/validate-w5-buyout-screens.ts — wave 5, lane buyout: the buyout
// screens and the A401 subcontract.
//
//   #11  package budgets are AT COST; a budget stored at sell is flagged
//        "Budget includes markup — review" and never counted as savings.
//   #92  deleting a bid is behind a destructive confirm naming vendor and
//        amount; a sub-filed bid warns his link is closed; the awarded bid
//        cannot be deleted.
//   #95  a bid with no dollar amount is never saved at $0, never LOWEST, has
//        no Award button, and a refused award says so.
//   #98  the A401 is numbered by its award commitment and carries a retainage
//        rate from resolveRetainagePercent (or a blank) — never "#1" and 10%.
//   #23  (carry) the award gate's "Open COI vault" opens on that sub.
//   #147 (carry, CONTRACT 25) a blocked PDF window on web throws the sentence
//        the screen shows through pdfFailureMessage, instead of silence.
//
// Run: bun run scripts/validate-w5-buyout-screens.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bidAmountOf, compareBidsForMatrix, parseBidAmountInput } from '../utils/bulkSavings';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.info('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}
/** The body of `const <name> = useCallback(` up to the next top-level `const handle`. */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) return '';
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

const list = stripComments(read('app/buyout.tsx'));
const screen = stripComments(read('app/buyout-package.tsx'));

// ── #95 — bid amounts, executed ─────────────────────────────────────────────
console.info('\n#95 a bid amount is a real, positive number to the cent');
eq('"4,800" is 4800 (it used to be NaN)', parseBidAmountInput('4,800'), 4800);
eq('"$12,345.50" is 12345.5', parseBidAmountInput('$12,345.50'), 12345.5);
eq('a third decimal is rounded to the cent', parseBidAmountInput('10.005'), 10.01);
eq('0 is refused', parseBidAmountInput('0'), null);
eq('empty is refused', parseBidAmountInput(''), null);
eq('two decimal points are refused, not guessed', parseBidAmountInput('4.800.50'), null);
eq('words are refused', parseBidAmountInput('forty-eight hundred'), null);
// Integration review (wave 5): the fields are decimal-pad keyboards, which type
// ',' as the decimal mark in comma-decimal locales. Stripping everything but
// digits and '.' turned a $4,800.50 bid into $480,050.
eq('a comma decimal "4800,50" is refused, never read as 480050', parseBidAmountInput('4800,50'), null);
eq('European grouping "1.234,56" is refused, never read as 1.23', parseBidAmountInput('1.234,56'), null);
eq('a negative "-500" is refused, never read as 500', parseBidAmountInput('-500'), null);
eq('US grouping with cents still reads "1,234,567.89"', parseBidAmountInput('1,234,567.89'), 1234567.89);
eq('a trailing point "4800." reads as 4800', parseBidAmountInput('4800.'), 4800);
ok('an unreadable package budget is refused and said, not saved as $0',
  /const parsedBudget = budgetText \? parseBidAmountInput\(newPkgBudget\) : 0;/.test(list)
  && /if \(parsedBudget == null\) \{\s*showAlert\('Check the budget'/.test(list));
eq('a stored $0 has no amount', bidAmountOf({ amount: 0 }), null);
eq('a stored NaN has no amount', bidAmountOf({ amount: Number.NaN }), null);
const sorted = [
  { id: 'zero', amount: 0 }, { id: 'hi', amount: 9000 }, { id: 'nan', amount: Number.NaN }, { id: 'lo', amount: 4800 },
].sort(compareBidsForMatrix).map(b => b.id);
eq('a bid with no amount sorts LAST, never first (no LOWEST badge)', sorted.slice(0, 2), ['lo', 'hi']);
eq('leveled totals still order the priced bids',
  [{ id: 'a', amount: 5000, normalizedAdjustment: 1000 }, { id: 'b', amount: 5500 }].sort(compareBidsForMatrix).map(b => b.id), ['b', 'a']);

console.info('\n#95 the screen');
const voice = handlerBody(screen, 'handleVoiceBid');
ok('a voice bid with no amount is NOT saved at $0', !/amount:\s*partial\.amount\s*\|\|\s*0/.test(screen));
ok('…it opens the Add-bid sheet prefilled, with the note', /if \(amount == null\)[\s\S]*setShowAddBid\(true\)/.test(voice)
  && /We didn't catch a dollar amount — type it in\./.test(voice));
ok('…and a parse that caught nothing keeps the raw dictation in Includes', /setNewIncludes\(caughtNothing \? transcript\.trim\(\)/.test(voice));
const addBid = handlerBody(screen, 'handleAddBid');
ok('the hand-entry form parses through parseBidAmountInput, not Number(newAmount)',
  /parseBidAmountInput\(newAmount\)/.test(addBid) && !/Number\(newAmount\)/.test(screen));
ok('the amount fields use the decimal pad', (screen.match(/keyboardType="decimal-pad"/g) ?? []).length >= 2 && !/value=\{newAmount\}[^\n]*keyboardType="numeric"/.test(screen));
ok('the matrix sorts through compareBidsForMatrix', /\[\.\.\.bids\]\.sort\(compareBidsForMatrix\)/.test(screen));
ok('LOWEST needs a priced bid and two priced bids', /const isLowest = priced && i === 0 && pricedBids\.length > 1;/.test(screen));
ok('the median ignores unpriced bids', /const leveledTotals = pricedBids\.map/.test(screen));
ok('an unpriced bid shows "Needs an amount" instead of Award', /priced \? \([\s\S]{0,200}styles\.awardBtn[\s\S]{0,1400}Needs an amount — tap to add it/.test(screen));
ok('the card edits the amount through updateBidPackageBid', /updateBidPackageBid\(amountEditBidId, \{ amount \}\)/.test(screen));
ok('a sub\'s own number is not editable from the card', /const canEditAmount = !filedBySub && !isAwardedBid;/.test(screen));
const award = handlerBody(screen, 'handleAward');
const amountCheck = award.indexOf('bidAmountOf(bid) == null');
ok('handleAward checks the amount BEFORE the compliance dialogs',
  amountCheck > -1 && amountCheck < award.indexOf('reviewAwardCompliance('));
ok('a refused award says so instead of closing silently',
  /if \(!commitmentId\) \{[\s\S]{0,200}showAlert\('Not awarded'/.test(award));

// ── #92 — delete behind a confirm ───────────────────────────────────────────
console.info('\n#92 deleting a bid');
ok('the trash icon no longer deletes on one tap', !/onPress=\{\(\) => deleteBidPackageBid\(bid\.id\)\}/.test(screen));
ok('it opens handleDeleteBid', /onPress=\{\(\) => handleDeleteBid\(bid, filedBySub\)\}/.test(screen));
const del = handlerBody(screen, 'handleDeleteBid');
ok('the confirm names the vendor and the amount', /Delete \$\{who\}'s bid\$\{amount != null \? ` of \$\{formatMoney\(amount\)\}`/.test(del));
ok('it is destructive and only its button deletes', /style: 'destructive', onPress: \(\) => deleteBidPackageBid\(bid\.id\)/.test(del));
ok('a sub-filed bid warns that his link is closed', /if \(filedBySub\)[\s\S]{0,300}That link is closed now/.test(del));
ok('the awarded bid cannot be deleted, and says why', /Can't delete the awarded bid/.test(del) && /pkg\.awardedBidId === bid\.id/.test(del));
ok('an invite whose bid was deleted says so instead of "in the matrix below"',
  /inv\.status === 'bid_deleted' \|\| !inv\.bidId/.test(screen) && /their bid was deleted — re-invite them for a new number/.test(screen));

// ── #11 — budgets at cost ───────────────────────────────────────────────────
console.info('\n#11 package budgets are at cost');
ok('the new-package budget sums lineCost, not lineTotal',
  /\.reduce\(\(s, i\) => s \+ lineCost\(i\), 0\)/.test(list) && !/\.reduce\(\(s, i\) => s \+ i\.lineTotal, 0\)/.test(list));
ok('the auto-fill keeps cents (no Math.round(computedBudget))', !/Math\.round\(computedBudget\)/.test(list));
ok('the field reads "Budget at cost", with the sell subtotal beside it',
  /Budget at cost<\/Text>/.test(list) && /your sell subtotal for it is \$\{formatMoney\(pickedSellSubtotal\)\}/.test(list));
ok('the explainer compares the award to COST', /what your estimate says that work costs you — before your markup/.test(list));
ok('a typed "12,000" budget is not read as 0', /parseBidAmountInput\(newPkgBudget\)/.test(list) && !/Number\(newPkgBudget\)/.test(list));
ok('sell-basis packages are left out of savings-to-date and flagged',
  /\.filter\(p => p\.status === 'awarded' && !sellBasisIds\.has\(p\.id\)\)/.test(list) && /Budget includes markup — review/.test(list));
ok('the package screen withholds savings on a sell-basis budget, with a one-tap fix',
  /sellBasis \? \(/.test(screen) && /Budget includes markup — review/.test(screen)
  && /updateBidPackage\(pkg\.id, \{ estimateBudget: costBudget \}\)/.test(screen));
ok('the award dialog does not print sell-basis "savings"', /if \(sellBasis\) \{[\s\S]{0,200}not shown — this package\\'s budget includes your markup/.test(award));

// ── #98 + #147 + #23 — the subcontract and the carries ───────────────────────
console.info('\n#98 the A401 subcontract');
const a401 = handlerBody(screen, 'handleGenerateSubcontract');
ok('no hard-coded subcontract #1', !/subcontractNumber:\s*1\b/.test(screen));
ok('no hard-coded 10% retainage', !/retainagePercent:\s*10\b/.test(screen));
ok('the number is the award commitment\'s own', /awardedCommitmentOf\(pkg, commitments\)/.test(a401) && /subcontractNumber: commitment\.number/.test(a401));
ok('no commitment → no number, and says why', /Subcontract number assigned on award/.test(a401));
ok('the sum is the commitment amount', /contractSum: commitment\.amount/.test(a401));
ok('retainage is resolved, with its source label shown before rendering',
  /resolveRetainagePercent\(\{/.test(a401) && /\$\{retainage\.percent\}% — \$\{retainage\.label\}/.test(a401));
ok('no rate on file → ask: blank, or set it on the project', /if \(retainage\.needsAsk\)[\s\S]{0,900}Print it blank[\s\S]{0,80}render\(null\)/.test(a401));
ok('a failed PDF shows pdfFailureMessage and no success haptic',
  /catch \(err\) \{[\s\S]{0,200}pdfFailureMessage\(err,/.test(a401));
ok('#23 "Open COI vault" opens on that sub', /pathname: '\/coi-vault', params: \{ subId: sub\.id \}/.test(screen) && !/router\.push\('\/coi-vault' as never\)/.test(screen));

// Executed: the A401 renderer and its web print path, native modules stubbed.
interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
interface BunGlobal { plugin(def: { name: string; setup: (b: VirtualModuleBuilder) => void }): void }
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('\n✗ must run under bun\n'); process.exit(1); }
let printed = '';
let blocked = false;
const BLOCKED = 'Your browser blocked the PDF window. Allow pop-ups for app.mageid.app and try again.';
bun.plugin({
  name: 'stub-native-for-aia',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'web' } }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: { printToFileAsync: async () => ({ uri: 'x' }), printAsync: async () => {} }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('@/utils/platformFile', () => ({
      exports: { openPrintWindowOrThrow: (html: string) => { if (blocked) throw new Error(BLOCKED); printed = html; } },
      loader: 'object',
    }));
  },
});
(globalThis as unknown as { window: unknown }).window = {};
const { generateA401PDF } = await import('../utils/aiaForms');
const BRAND = { companyName: 'Acme GC', address: '', phone: '', email: '', licenseNumber: '', tagline: '', contactName: '' };
const DATA = {
  subcontractNumber: 'BO-3', agreementDate: '2026-09-23T12:00:00.000Z', contractorName: 'Acme GC',
  subcontractorName: 'Ace Plumbing', ownerName: 'Owner', projectName: 'Henderson', scopeDescription: 'PEX',
  contractSum: 48200, retainagePercent: 5 as number | null, paymentTerms: 'Net 30',
};
await generateA401PDF(DATA as never, BRAND as never);
ok('the PDF is titled by the commitment number', /Subcontract BO-3/.test(printed) && !/Subcontract #1\b/.test(printed));
ok('the confirmed rate is printed', /5% of each progress payment/.test(printed));
await generateA401PDF({ ...DATA, retainagePercent: null } as never, BRAND as never);
ok('no rate → a blank to be agreed, never an invented 10%', /____% of each progress payment \(to be agreed\)/.test(printed) && !/10% of each/.test(printed));
blocked = true;
let threw = '';
try { await generateA401PDF(DATA as never, BRAND as never); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
eq('#147 a blocked window on web THROWS the blocked sentence (it used to resolve as if printed)', threw, BLOCKED);
const aia = stripComments(read('utils/aiaForms.ts'));
ok('#147 renderAndShare prints through openPrintWindowOrThrow, keeping the window guard',
  /if \(typeof window !== 'undefined'\) openPrintWindowOrThrow\(html\);/.test(aia) && !/window\.open\(/.test(aia));
ok('A401Data.subcontractNumber is a string', /subcontractNumber: string;/.test(aia));

console.info(`\n${fail === 0 ? `validate-w5-buyout-screens: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
