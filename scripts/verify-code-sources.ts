// scripts/verify-code-sources.ts — fetch every cited page in the code-adoption
// table and check that it actually SAYS the editions the row claims.
//
// WHY THIS EXISTS
//   scripts/validate-code-jurisdiction.ts checks the SHAPE of a citation: that
//   sourceUrl looks like a URL and that checkedOn is recent. It has never
//   opened one. So a row with a real, reachable, freshly-dated URL and a
//   recalled edition passes the whole suite in silence — and that is exactly
//   what happened. A row shipped:
//
//       { family: 'NEC', edition: '2023' }   // Dallas
//
//   while the page it cites says, verbatim:
//
//       CHAPTER 56: 2020 National Electrical Code with Dallas Amendments
//       (effective June 13, 2022)
//
//   A contractor would have priced Dallas electrical a full NEC cycle ahead of
//   what Dallas enforces. Every automated check was green.
//
//   This script closes that hole the only way it can be closed: by reading the
//   page. For each claimed code it finds where the page names that code family
//   and collects the years printed next to it, then compares. It reports
//   MISMATCH when the page names a different year, UNCONFIRMED when it cannot
//   find the phrase at all, UNREACHABLE when the citation will not load, and
//   MANUAL when the citation is a PDF. Only MISMATCH and UNREACHABLE fail the
//   run — an unreachable source is surfaced, never quietly passed.
//
// HOW TO RUN IT — this is NOT part of ship-check, on purpose: it needs the
// network, it hits ~30 government sites, and several of them rate-limit.
//
//     bun run scripts/verify-code-sources.ts            # every row
//     bun run scripts/verify-code-sources.ts dallas la  # rows matching a term
//
// WHAT IT CANNOT DO
//   It is a smoke alarm, not a judge. UNCONFIRMED is common and usually
//   innocent (the page states the code in an image, a table, or a PDF this
//   script will not parse). MISMATCH is the one that matters: it means the
//   page and the row disagree about a year, which is the shape of the bug
//   above. Read the page yourself before changing a row either way — and when
//   you do, update `checkedOn`.
//
//   MANUAL means the citation is a PDF. Several rows (Ohio, Minnesota, San
//   Antonio, Los Angeles) cite one on purpose, because the PDF is the document
//   that states the adoption. This script will not parse them — a half-decoded
//   PDF produces confident nonsense, which is the failure mode the whole file
//   exists to stop — so it says so and moves on. `pdftotext -layout` them.
//
//   UNREACHABLE is not "fine either". Government sites break in two ways this
//   hits constantly: mass.gov 403s anything automated, and dallascityhall.com
//   serves an incomplete TLS chain that bun's fetch (correctly) refuses even
//   though `curl` accepts it. Both are reported and both exit non-zero. Do NOT
//   "fix" that by disabling certificate verification — a checker that lies
//   about the transport is worth less than no checker. Open the page in a
//   browser, or fetch it with curl and read it.
//
//   VERIFIED BEHAVIOUR: run against a local copy of the Dallas page, the
//   detector reports the NEC as {2020, 2022} — so the old `NEC 2023` row
//   raises MISMATCH and the corrected `NEC 2020` row passes.

import { LOCAL_ADOPTIONS, STATE_ADOPTIONS, type AdoptedCode, type LocalAdoption, type StateAdoption } from '../utils/codeJurisdiction';

type Row = StateAdoption | LocalAdoption;

const ALL: readonly Row[] = [...STATE_ADOPTIONS, ...LOCAL_ADOPTIONS];
const labelOf = (e: Row) => ('name' in e ? `${e.name}, ${e.state}` : `${(e as StateAdoption).stateName} (state)`);

/** How each family is SPELLED on an authority's page. `NEC` has two spellings
 *  in real life — the name and the NFPA number — and both count. */
const FAMILY_PHRASES: Record<string, RegExp[]> = {
  IBC: [/international\s+building\s+code/gi],
  IRC: [/international\s+residential\s+code/gi],
  IECC: [/international\s+energy\s+conservation\s+code/gi],
  IEBC: [/international\s+existing\s+building\s+code/gi],
  IPC: [/international\s+plumbing\s+code/gi],
  IMC: [/international\s+mechanical\s+code/gi],
  IFC: [/international\s+fire\s+code/gi],
  // Dallas prints "International Fuel & Gas Code". The ampersand is theirs.
  IFGC: [/international\s+fuel\s*(?:&|and)?\s*gas\s+code/gi],
  NEC: [/national\s+electrical\s+code/gi, /nfpa\s*70\b/gi],
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ');
}

type Fetched =
  | { ok: true; text: string }
  /** `manual` = nothing is wrong, this format just needs a human (a PDF). */
  | { ok: false; why: string; manual?: boolean };

async function fetchText(url: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 5));
    if (head.startsWith('%PDF')) {
      // Deliberately NOT parsed. A half-decoded PDF would produce confident
      // nonsense, which is the failure mode this whole file exists to stop.
      return { ok: false, why: 'PDF — read it yourself (e.g. `pdftotext -layout`)', manual: true };
    }
    return { ok: true, text: htmlToText(new TextDecoder('utf-8', { fatal: false }).decode(buf)) };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/** The 4-digit year a row's edition string carries: '2021' and
 *  '8th Edition (2023)' both yield 2023/2021; a nameless edition yields null. */
function claimedYear(c: AdoptedCode): string | null {
  const m = c.edition.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

/** Every year printed within ~60 characters of a mention of this family. */
function yearsNear(text: string, patterns: RegExp[]): Set<string> {
  const out = new Set<string>();
  for (const base of patterns) {
    const re = new RegExp(base.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const window = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      for (const y of window.match(/\b(19|20)\d{2}\b/g) ?? []) out.add(y);
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
  }
  return out;
}

const terms = process.argv.slice(2).map((s) => s.toLowerCase());
const rows = terms.length
  ? ALL.filter((e) => terms.some((t) => labelOf(e).toLowerCase().includes(t) || e.sourceUrl.toLowerCase().includes(t)))
  : ALL;

let mismatches = 0;
let unreachable = 0;
let manual = 0;
let unconfirmed = 0;
let confirmed = 0;

console.log(`\nfetching ${rows.length} cited page(s)…\n`);

for (const row of rows) {
  const who = labelOf(row);
  const got = await fetchText(row.sourceUrl);
  if (!got.ok) {
    if (got.manual) {
      manual += 1;
      console.log(`· ${who}\n    ${row.sourceUrl}\n    MANUAL: ${got.why}`);
    } else {
      unreachable += 1;
      console.log(`✗ ${who}\n    ${row.sourceUrl}\n    UNREACHABLE: ${got.why}`);
    }
    continue;
  }
  const text = got.text;
  const lines: string[] = [];
  for (const c of row.codes) {
    const year = claimedYear(c);
    const patterns = FAMILY_PHRASES[c.family];
    if (c.family === 'LOCAL' || !patterns) {
      // A LOCAL code has no model-code phrase to look for; check the row's own
      // name, or failing that the bare year.
      const needle = c.name ?? c.edition;
      const found = text.toLowerCase().includes(needle.toLowerCase()) || (year !== null && text.includes(year));
      if (found) { confirmed += 1; lines.push(`      ok        ${c.family} ${c.edition} — the page carries this name or year`); }
      else { unconfirmed += 1; lines.push(`      UNCONFIRM ${c.family} ${c.edition} — "${needle}" not found on the page`); }
      continue;
    }
    const years = yearsNear(text, patterns);
    if (years.size === 0) {
      unconfirmed += 1;
      lines.push(`      UNCONFIRM ${c.family} ${c.edition} — the page never names this code family near a year`);
    } else if (year !== null && years.has(year)) {
      confirmed += 1;
      lines.push(`      ok        ${c.family} ${c.edition}`);
    } else {
      mismatches += 1;
      lines.push(`      MISMATCH  row claims ${c.family} ${c.edition}; the page prints ${[...years].sort().join(', ')} next to that code`);
    }
  }
  const bad = lines.some((l) => l.includes('MISMATCH'));
  console.log(`${bad ? '✗' : '·'} ${who}\n    ${row.sourceUrl}\n${lines.join('\n')}`);
}

console.log(
  `\n${confirmed} edition(s) confirmed on the page, ${mismatches} MISMATCH, ${unconfirmed} unconfirmed, `
  + `${unreachable} unreachable source(s), ${manual} source(s) needing a human (PDF).`,
);
if (mismatches > 0) {
  console.log('\nA MISMATCH means the row and its own citation disagree about a year.');
  console.log('Read the page and fix the row (or the citation). Then update checkedOn.');
}
process.exit(mismatches > 0 || unreachable > 0 ? 1 : 0);
