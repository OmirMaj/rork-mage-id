// scripts/validate-spec-book-coverage.ts — audit round 2, finding #22.
//
// Two defects, one screen:
//   1. convert-pdf-to-images compared the WHOLE PDF's page count against the
//      remaining takeoff-page quota while metering only the pages it rendered.
//      A Pro user (30 pages/month) uploading a 212-page spec book — or even the
//      40-page division the helper text told them to split out — was refused
//      for a job that would have rendered and charged 24. extract-submittals
//      had no precheck, so the refusal arrived as "Render failed: Edge Function
//      returned a non-2xx status code".
//   2. The review hero said "38 submittals found" for a read of pages 1–24 of
//      212. Divisions 08/09/23 — the long-lead hardware, ceiling tile and RTU
//      submittals — were simply absent, with nothing on screen saying so.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specCoverage, specUnreadWarning, SPEC_PAGES_PER_PASS } from '../utils/plans/specBookRange';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

console.log('\n1. the review says which pages it read');
const partial = specCoverage(212, 1, 24);
ok('a 24-page read of a 212-page book says both numbers', partial.label === 'Read pages 1–24 of 212', partial.label);
ok('it knows it is not the whole book', partial.complete === false && partial.nextPage === 25 && partial.unread === 188);
ok('the warning names the unread pages and what that means',
  /188 pages from page 25 on were not read/.test(specUnreadWarning(partial) ?? '')
  && /missing from this list/.test(specUnreadWarning(partial) ?? ''), specUnreadWarning(partial) ?? '');

const whole = specCoverage(18, 1, 18);
ok('a book that fits reads as complete', whole.complete && whole.label === 'Read pages 1–18 of 18' && specUnreadWarning(whole) === null, whole.label);
const second = specCoverage(212, 25, 24);
ok('a second pass names its own range', second.label === 'Read pages 25–48 of 212' && second.nextPage === 49, second.label);
ok('a single page is not called "pages 3–3"', specCoverage(9, 3, 1).label === 'Read page 3 of 9');
const unknown = specCoverage(null, 1, 24);
ok('an uncountable PDF never implies the whole book was read',
  unknown.label === 'Read pages 1–24' && unknown.complete === false, unknown.label);
// B4 review: the other direction of the same honesty rule. A 10-page spec
// section — exactly what the pre-upload helper text tells a PM to split a book
// into — whose local pdf-lib count failed came back "The rest of the book from
// page 11 on were not read", though the server rendered the whole thing. A
// render shorter than the cap IS the proof of coverage: the function renders
// min(pdfPageCount - startPage + 1, SPEC_PAGES_PER_PASS).
const shortUnknown = specCoverage(null, 1, 10);
ok('a short book with an unknown page count never claims unread pages',
  shortUnknown.complete === true && shortUnknown.nextPage === null && shortUnknown.unread === 0
  && specUnreadWarning(shortUnknown) === null, JSON.stringify(shortUnknown));
ok('…and still does not invent a total it never learned',
  shortUnknown.label === 'Read pages 1–10' && !/ of /.test(shortUnknown.label) && !/all/i.test(shortUnknown.label), shortUnknown.label);
const shortSecondPass = specCoverage(null, 25, 6);
ok('a short SECOND pass of an uncountable book is complete too',
  shortSecondPass.complete === true && shortSecondPass.label === 'Read pages 25–30', JSON.stringify(shortSecondPass));
ok('a pass that rendered nothing says so', specCoverage(212, 1, 0).label === 'No pages were read');
ok('the per-pass page count is one shared constant', SPEC_PAGES_PER_PASS === 24);

console.log('\n2. the quota check meters what it renders');
const fn = read('supabase/functions/convert-pdf-to-images/index.ts');
ok('renderPageCount is computed BEFORE the quota comparison',
  fn.indexOf('const renderPageCount =') < fn.indexOf('> remaining'), 'the old order compared the whole PDF and charged the rendered pages');
ok('the comparison is against the pages that will render, not the PDF length',
  /if \(renderPageCount > remaining\)/.test(fn) && !/if \(pdfPageCount > remaining\)/.test(fn));
ok('the refusal says both numbers when they differ', /would render \$\{renderPageCount\} pages \(of \$\{pdfPageCount\}\)/.test(fn));
ok('CloudConvert renders the requested range', /pages: `\$\{startPage\}-\$\{startPage \+ renderPageCount - 1\}`/.test(fn));
ok('a later pass returns real document page numbers', /const pageNumber = startPage \+ i;/.test(fn));
ok('a startPage past the end is refused before any spend', /start_page_past_end/.test(fn) && fn.indexOf('start_page_past_end') < fn.indexOf('createSignedUrl'));
ok('the response carries the page total and what was rendered',
  /pageCount: pdfPageCount,/.test(fn) && /renderedPageCount: outputs\.length,/.test(fn) && /startPage,/.test(fn));
ok('the charge is still the pages actually produced', /aiUsageIncrement\(auth\.userId, 'takeoff_pages', outputs\.length\)/.test(fn));

console.log('\n3. the screen prechecks and discloses');
const screen = read('app/extract-submittals.tsx');
ok('the screen counts the PDF before uploading it', /countPdfPages\(asset\.uri\)/.test(screen));
// B5 review: the precheck used to hand confirmQuotaFits min(pageCount, 24) —
// a number that is the PASS, not the document — and that helper states it as
// the document: "That PDF is 24 pages but you have 5 … trim it to 5 pages or
// fewer", about a 212-page book. It also guessed 24 when the count was unknown,
// hard-blocking an 8-page scope letter with 10 pages of quota left (there is no
// "proceed anyway" branch) on a job the server would have rendered for 8.
ok('the precheck only runs when the pass IS the whole document',
  /if \(pageCount !== null && pageCount <= SPEC_PAGES_PER_PASS\) \{/.test(screen)
  && /confirmQuotaFits\(pageCount, asset\.name/.test(screen));
ok('the precheck never states a page count the file does not have',
  !/confirmQuotaFits\(willRender/.test(screen) && !/Math\.min\(pageCount, SPEC_PAGES_PER_PASS\)/.test(screen)
  && !/pageCount === null \? SPEC_PAGES_PER_PASS/.test(screen),
  'confirmQuotaFits words its refusal as "That PDF is N pages" — N must be the PDF');
ok('an uncountable PDF is not blocked on a guess, like plans.tsx and takeoff.tsx',
  /pageCount !== null/.test(screen) && !/willRender/.test(screen));
ok('a longer book is left to the server, which now meters the pass and says both numbers',
  /would render \$\{renderPageCount\} pages \(of \$\{pdfPageCount\}\)/.test(fn));
ok('the render request and the precheck use the same constant', /maxPages: SPEC_PAGES_PER_PASS/.test(screen));
ok('the hero states the pages read', /coverage\.label/.test(screen));
ok('an incomplete read carries a warning on the review screen', /specUnreadWarning\(coverage\)/.test(screen));
ok('the helper text no longer hides the limit in a pre-upload bullet only',
  /the review screen says which pages were read/.test(screen));
ok('analyze-spec-book still reads at most one pass worth of pages',
  new RegExp(`selectPageSource\\(req, ${SPEC_PAGES_PER_PASS}\\)`).test(read('supabase/functions/analyze-spec-book/index.ts')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
