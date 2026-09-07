// scripts/verify-code-sources.ts — fetch every cited page in the code-adoption
// table, check that it actually SAYS the editions the row claims, and write
// down what it found so the offline validator can hold the table to it.
//
// WHY THIS EXISTS
//   scripts/validate-code-jurisdiction.ts checks the SHAPE of a citation: that
//   sourceUrl looks like a URL and that checkedOn is recent. It had never
//   opened one. So a row with a real, reachable, freshly-dated URL and a
//   recalled edition passed the whole suite in silence — and that is exactly
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
//   POSTSCRIPT, because the table now says 2023 again and that is NOT a
//   relapse: Dallas really did adopt the 2023 NEC, by Ordinance No. 33081,
//   effective 23 May 2025, and the row cites the executed ordinance. The
//   landing page quoted above simply never caught up. So this script's own
//   founding example has an ending: matching a row against a department's
//   summary page is a floor, not a ceiling. Where an enacted ordinance exists,
//   cite the ordinance — a page can go stale, an ordinance cannot.
//
//   This script closes that hole the only way it can be closed: by reading the
//   page. For each claimed code it finds where the page names that code family
//   and collects the years printed next to it, then compares.
//
//   It has since caught a second one of exactly the same shape, which is the
//   argument for keeping it: Minnesota shipped `{ family: 'NEC', edition:
//   '2020' }` while Minnesota Rules 1315.0200 says "the 2023 edition of the
//   National Electrical Code (NEC) as approved by the American National
//   Standards Institute (ANSI/NFPA 70-2023)". The row's own citation was a DLI
//   fact-sheet PDF about the RESIDENTIAL code, which never mentions the NEC at
//   all — so nothing could ever have contradicted it.
//
// AND WHY IT NOW WRITES A RECEIPT
//   Reading the page is useless if the reading is thrown away: ship-check runs
//   offline, so it could still only see the shape. Every run therefore records
//   its verdicts — per row, per code, with the sentence it matched — into
//
//       utils/codeJurisdiction.receipt.json      (committed)
//
//   scripts/validate-code-jurisdiction.ts reads that file and refuses any row
//   whose claims are not covered by a fresh, `confirmed` receipt. Because the
//   receipt records the family, the edition AND the citation of every claim,
//   editing any of them without re-running this script fails ship-check. You
//   can no longer change what the table asserts without opening a page.
//
// HOW TO RUN IT — this is NOT part of ship-check, on purpose: it needs the
// network, it hits ~30 government sites, and several of them rate-limit.
//
//     bun run scripts/verify-code-sources.ts            # every row
//     bun run scripts/verify-code-sources.ts dallas la  # rows matching a term
//
//   A filtered run MERGES into the receipt — it re-verifies the rows you named
//   and leaves the rest of the file alone — so you can re-check one row after
//   editing it without blanking everyone else's evidence.
//
// WHAT IT CANNOT DO
//   It is a smoke alarm, not a judge, and it is much better at catching a
//   wrong year than at catching a right year quoted out of context. It reads
//   text, not meaning: a page that prints "2021 International Residential
//   Code" inside a note explaining what some OTHER code references will be
//   reported `confirmed`, because the words really are there. That is why the
//   receipt stores the matched sentence — so a human can see WHAT confirmed a
//   claim, not just that something did. Virginia's IRC row was deleted for
//   precisely this reason: it would have passed this script, off a note that
//   13VAC5-63-10 itself says is "information only".
//
//   So: MISMATCH is close to proof of a bug. `confirmed` is evidence, not
//   absolution. Read the page before changing a row either way — and when you
//   do, update `checkedOn` and re-run this.
//
//   VERIFIED BEHAVIOUR: run against a local copy of the Dallas know_code page,
//   the detector reports the NEC as {2020, 2022} — which is why that page is
//   no longer the NEC citation. It is the page's reading that is stale, not
//   the detector's.
//
//   AND IT NO LONGER CRIES WOLF AT WHAT IT STRUCTURALLY CANNOT FETCH. Some of
//   these sources 403 every script (dos.ny.gov's Cloudflare interstitial,
//   www.mass.gov), serve a broken TLS chain (dallascityhall.com) or are 40 MB
//   scans. Reporting those as failures forever trains people to ignore the
//   output. When a fetch fails and the committed receipt already holds a
//   `confirmed`, evidenced verdict for that exact claim id, this run carries
//   it forward and reports it RECEIPTED instead. See the block by `receipted`
//   for the three things that stop that from being a rubber stamp.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_ADOPTIONS,
  STATE_ADOPTIONS,
  codeClaimId,
  codeReceiptKey,
  type AdoptedCode,
  type CodeVerdict,
  type LocalAdoption,
  type StateAdoption,
} from '../utils/codeJurisdiction';

type Row = StateAdoption | LocalAdoption;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = join(ROOT, 'utils', 'codeJurisdiction.receipt.json');

const ALL: readonly Row[] = [...STATE_ADOPTIONS, ...LOCAL_ADOPTIONS];
const labelOf = (e: Row) => ('name' in e ? `${e.name}, ${e.state}` : `${(e as StateAdoption).stateName} (state)`);

/**
 * How each family is SPELLED on an authority's page.
 *
 * Both the full name and the abbreviation count, because real adoption
 * language uses both and sometimes ONLY the abbreviation: Ohio's Board of
 * Building Standards states its whole adoption as "Adoption by reference —
 * 2021 ICC model codes IBC, IMC, IPC, IFGC, IECC and IEBC", and matching only
 * "International Building Code" reported three true rows unconfirmed. `NEC`
 * additionally answers to the NFPA number.
 *
 * The abbreviations are word-bounded and still have to land within the year
 * window, which is what keeps them from matching prose — and every match is
 * written into the receipt as a quoted sentence, so a lucky hit is visible
 * rather than silent.
 */
const FAMILY_PHRASES: Record<string, RegExp[]> = {
  IBC: [/international\s+building\s+code/gi, /\bIBC\b/g],
  IRC: [/international\s+residential\s+code/gi, /\bIRC\b/g],
  IECC: [/international\s+energy\s+conservation\s+code/gi, /\bIECC\b/g],
  IEBC: [/international\s+existing\s+building\s+code/gi, /\bIEBC\b/g],
  IPC: [/international\s+plumbing\s+code/gi, /\bIPC\b/g],
  IMC: [/international\s+mechanical\s+code/gi, /\bIMC\b/g],
  IFC: [/international\s+fire\s+code/gi, /\bIFC\b/g],
  // Dallas prints "International Fuel & Gas Code". The ampersand is theirs.
  IFGC: [/international\s+fuel\s*(?:&|and)?\s*gas\s+code/gi, /\bIFGC\b/g],
  // Philadelphia's L&I prints "2020 National Electric Code" — no "-al". That
  // one missing suffix reported a correctly-cited row as unconfirmed, which is
  // how a good source gets thrown away and replaced with something worse.
  NEC: [/national\s+electric(?:al)?\s+code/gi, /nfpa\s*70\b/gi, /\bNEC\b/g],
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * HTML → the words a reader would see.
 *
 * The entity and zero-width handling is not fussiness; it is the difference
 * between confirming a row and falsely reporting a good citation as
 * unverifiable. Real pages in this table break naive matching in three ways:
 * Houston splits a sentence with a `<strong>` mid-clause, Dallas writes its
 * chapter headings with `&#58;&#160;` and a ZERO-WIDTH SPACE inside "Code with
 * Dallas Amendments", and several sites use curly quotes as hex entities.
 * Every one of those produced a false negative before this ran.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/gi, '"')
    .replace(/&(lt|gt);/gi, (_, t) => (t.toLowerCase() === 'lt' ? '<' : '>'))
    .replace(/&amp;/gi, '&')
    // Soft hyphens and zero-width joiners/spaces sit INSIDE words and would
    // otherwise split a code's name in half.
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Re-space text a PDF extractor ran together, and ONLY that.
 *
 * Verified by hand 2026-09-07 on the executed Dallas ordinance (No. 33081,
 * adopting the 2023 NEC): `pdftotext -layout` renders that document as
 * "The2023 National Electrical Code" and "adoptingthe2}23 Edition" — the space
 * between a word and the year is simply gone, and one glyph is mis-decoded.
 * The family patterns and the year both matched fine on their own; what failed
 * was the PROXIMITY test, because "The2023" is one token. The tool reported
 * UNCONFIRMED on a claim its own cited page states five times.
 *
 * That direction of error is the dangerous one for this tool: a false
 * UNCONFIRMED trains whoever runs it next to overrule the checker, which is
 * exactly how the fabricated edition got in. So: insert a space at
 * letter→digit and digit→letter boundaries. This can only ever SPLIT a token,
 * never join two — it cannot manufacture a proximity that the page does not
 * have, so it cannot turn a real UNCONFIRMED into a false confirmation.
 */
function respacePdfText(text: string): string {
  return text
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ');
}

/**
 * PDF → text, via `pdftotext -layout`.
 *
 * This used to refuse PDFs outright and print "read it yourself", which left
 * four rows (Ohio, Minnesota, Los Angeles, San Antonio) permanently unchecked
 * — and those rows cite a PDF precisely BECAUSE the PDF is the document that
 * states the adoption, so they were the rows that most needed reading. Shelling
 * out to poppler is a far smaller risk than a hand-rolled PDF decoder: if
 * pdftotext is absent, or produces nothing, we say so and report `manual`
 * rather than guessing. A half-decoded PDF producing confident nonsense is the
 * failure mode this whole file exists to stop.
 */
function pdfToText(bytes: Uint8Array): { ok: true; text: string } | { ok: false; why: string } {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  if (probe.error) {
    return { ok: false, why: 'source is a PDF and `pdftotext` is not installed (brew install poppler)' };
  }
  let dir = '';
  try {
    dir = mkdtempSync(join(tmpdir(), 'code-src-'));
    const pdf = join(dir, 'src.pdf');
    const txt = join(dir, 'src.txt');
    writeFileSync(pdf, bytes);
    const run = spawnSync('pdftotext', ['-layout', pdf, txt], { encoding: 'utf8' });
    if (run.status !== 0) {
      return { ok: false, why: `pdftotext exited ${run.status}: ${(run.stderr ?? '').trim().slice(0, 200)}` };
    }
    const text = readFileSync(txt, 'utf8').replace(/\s+/g, ' ').trim();
    if (text.length < 40) {
      // Almost certainly a scanned page image. Refuse rather than "confirm"
      // a row against 12 characters of header.
      return { ok: false, why: 'PDF produced almost no text — probably a scan; it needs OCR or a human' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

type Fetched =
  | { ok: true; text: string; kind: 'html' | 'pdf' }
  /** `manual` = nothing is wrong with the network, this source needs a human. */
  | { ok: false; why: string; manual?: boolean };

/** One fetch per URL per run — rows share citations, and several of these
 *  hosts rate-limit. */
const CACHE = new Map<string, Fetched>();

async function fetchText(url: string): Promise<Fetched> {
  const hit = CACHE.get(url);
  if (hit) return hit;
  const got = await fetchTextUncached(url);
  CACHE.set(url, got);
  return got;
}

async function fetchTextUncached(url: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 5));
    if (head.startsWith('%PDF')) {
      const pdf = pdfToText(buf);
      return pdf.ok ? { ok: true, text: respacePdfText(pdf.text), kind: 'pdf' } : { ok: false, why: pdf.why, manual: true };
    }
    // An HTML body from a URL that ends .pdf is an ERROR PAGE, never the
    // document. Verified 2026-09-07: web.archive.org serves the executed Dallas
    // ordinance as `application/pdf` to curl (HTTP 200, 1.7 MB) while answering
    // node's fetch with an HTML 503 — and htmlToText happily turned that error
    // page into "text" that names no code family, which the checker reported as
    // UNCONFIRMED against a document that states the claim five times.
    //
    // A false UNCONFIRMED is the worst output this tool has. It teaches whoever
    // runs it next to overrule the checker, and overruling the checker is how
    // the fabricated edition got in. So refuse to read it: `unreachable` is a
    // verdict the committed receipt is allowed to cover, `unconfirmed` is not.
    if (/\.pdf(?:[?#]|$)/i.test(new URL(url).pathname + new URL(url).search)) {
      return { ok: false, why: 'the URL ends .pdf but the body is not a PDF — an error page, not the document' };
    }
    return { ok: true, text: htmlToText(new TextDecoder('utf-8', { fatal: false }).decode(buf)), kind: 'html' };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/** The 4-digit year a row's edition string carries: '2021' and
 *  '8th Edition (2023)' both yield 2021/2023; a nameless edition yields null. */
function claimedYear(c: AdoptedCode): string | null {
  const m = c.edition.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

/** Every year printed within ~60 characters of a mention of this family, and
 *  for each, the sentence fragment it was found in — that fragment is what
 *  lands in the receipt as evidence. */
function yearsNear(text: string, patterns: RegExp[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const base of patterns) {
    const re = new RegExp(base.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const window = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      for (const y of window.match(/\b(19|20)\d{2}\b/g) ?? []) {
        if (!out.has(y)) out.set(y, window.trim());
      }
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// The receipt
// ─────────────────────────────────────────────────────────────────────

interface ReceiptCode {
  family: string;
  edition: string;
  /** The page THIS claim was checked against (a row's own, or the code's). */
  sourceUrl: string;
  /** Exactly the string codeClaimId() builds, so the validator can compare. */
  claimId: string;
  verdict: CodeVerdict;
  /** The text on the page that decided it. Present for confirmed/mismatch. */
  evidence?: string;
  /**
   * WHO read the page. Not decoration — this file is not all machine-written.
   * Claims whose sources no script can fetch (see RECEIPTED below) are seeded
   * by a human-driven pass, and a receipt that hid that would be lying about
   * its own evidence, which is the failure this module exists to prevent.
   */
  verifiedBy?: string;
  /** ISO date THIS claim was read, which is not always the row's. */
  verifiedOn?: string;
  /** The URL the evidence came off, when that is not the URL it cites — an
   *  Internet Archive capture of a bot-blocked page, typically. */
  readFrom?: string;
}

interface ReceiptRow {
  label: string;
  /** ISO date this script last read the pages for this row. */
  verifiedOn: string;
  /** The row's `checkedOn` at that moment — so editing it invalidates this. */
  checkedOn: string;
  sourceUrl: string;
  codes: ReceiptCode[];
}

interface Receipt {
  $comment: string;
  tool: string;
  rows: Record<string, ReceiptRow>;
}

function loadReceipt(): Receipt {
  try {
    const parsed = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')) as Partial<Receipt>;
    if (parsed && typeof parsed === 'object' && parsed.rows && typeof parsed.rows === 'object') {
      return { $comment: '', tool: '', rows: parsed.rows as Record<string, ReceiptRow> };
    }
  } catch {
    /* no receipt yet, or an unreadable one — rebuild it */
  }
  return { $comment: '', tool: '', rows: {} };
}

const today = new Date().toISOString().slice(0, 10);

const READ_BY_THIS_SCRIPT = 'scripts/verify-code-sources.ts — this script fetched the page itself';

/**
 * The receipt's own header. It used to open "GENERATED by
 * scripts/verify-code-sources.ts — do not hand-edit", and by 2026-09-07 that
 * was no longer true: a 23-jurisdiction verification pass seeded most of the
 * file by hand, because several of these sources cannot be fetched by any
 * script. A receipt that misstated where its evidence came from would be the
 * same class of defect as a row that misstates its code edition, so the header
 * now says which entries came from where and points at `verifiedBy`.
 */
const RECEIPT_COMMENT = [
  'Evidence that every code edition in utils/codeJurisdiction.ts was read off a page, and by whom.',
  'scripts/validate-code-jurisdiction.ts fails ship-check if a row is missing here, is not "confirmed", or no longer matches the claim that was verified.',
  '',
  'PROVENANCE — this file is NOT all machine-written, and saying otherwise would be the exact defect the module exists to prevent.',
  'Read `verifiedBy` on each claim. Entries marked "scripts/verify-code-sources.ts" were written by that script from its own fetch, and re-running it rewrites them.',
  'Entries marked "verification sweep 2026-09-07" were seeded by hand from a 23-jurisdiction verification pass in which agents fetched the pages themselves — through a real browser, curl, pdftotext or the Internet Archive — because several of these sources cannot be fetched by the script at all.',
  '`readFrom`, where present, is the URL the evidence was actually read from when that differs from the URL the claim cites (e.g. an Internet Archive capture of a bot-blocked page).',
  '',
  'EXPECT verify-code-sources.ts TO REPORT SOME OF THESE UNREACHABLE, FOREVER. dos.ny.gov is behind a Cloudflare interstitial that 403s every script; www.mass.gov 403s automation the same way; dallascityhall.com serves an incomplete TLS chain; and two cited ordinances are 34-44 MB PDFs that can time out.',
  'The script treats such a claim as receipted rather than failed when this file already holds a confirmed verdict for it. A MISMATCH is never acceptable.',
  '',
  'To regenerate the machine-checkable half: bun run scripts/verify-code-sources.ts',
].join(' ');

// ─────────────────────────────────────────────────────────────────────

const terms = process.argv.slice(2).map((s) => s.toLowerCase());
const rows = terms.length
  ? ALL.filter((e) => terms.some((t) => labelOf(e).toLowerCase().includes(t) || e.sourceUrl.toLowerCase().includes(t)))
  : ALL;

const receipt = loadReceipt();
/** The committed receipt AS IT STOOD before this run — the only thing that can
 *  answer "was this claim already proved by someone who could open the page?" */
const priorRows: Record<string, ReceiptRow> = JSON.parse(JSON.stringify(receipt.rows));

const tally: Record<CodeVerdict, number> = {
  confirmed: 0, mismatch: 0, unconfirmed: 0, unreachable: 0, manual: 0,
};

/**
 * SOME SOURCES CANNOT BE FETCHED BY A SCRIPT, EVER — and punishing the row for
 * that is how a checker teaches people to ignore it.
 *
 * dos.ny.gov sits behind a Cloudflare interstitial that 403s every automated
 * client; www.mass.gov serves a 14 kB block page to the same; dallascityhall
 * .com ships an incomplete TLS chain that every correct client refuses; and
 * two of the cited ordinances are 34-44 MB scans that can time out. Every one
 * of those pages HAS been read — in a browser, through the Internet Archive,
 * or with pdftotext — and utils/codeJurisdiction.receipt.json records what
 * they said and who read them.
 *
 * So when a fetch fails and the committed receipt already holds a `confirmed`
 * verdict WITH EVIDENCE for that exact claim id, this run carries that entry
 * forward and counts it here instead of as a failure. Three things keep that
 * from becoming a rubber stamp:
 *   - it matches on the claim id, so changing a family, an edition or a
 *     citation drops the cover instantly;
 *   - it never converts a reachable page's verdict — a MISMATCH is still a
 *     hard failure, and an unconfirmed claim still fails;
 *   - the carried entry keeps its own `verifiedBy`/`verifiedOn`, and a row
 *     where NOTHING was freshly read keeps its old `verifiedOn`, so the
 *     validator's one-year staleness check still eventually forces a human
 *     back to the page.
 */
let receipted = 0;

console.log(`\nverifying ${rows.length} row(s)…\n`);

for (const row of rows) {
  const who = labelOf(row);
  const lines: string[] = [];
  const seen = new Set<string>();
  const entries: ReceiptCode[] = [];
  const wasReceipted = priorRows[codeReceiptKey(row)];
  /** A confirmed, evidenced entry for this exact claim in the committed file. */
  const priorProofOf = (claimId: string): ReceiptCode | undefined =>
    (wasReceipted?.codes ?? []).find(
      (p) => p.claimId === claimId && p.verdict === 'confirmed' && typeof p.evidence === 'string' && p.evidence.trim() !== '',
    );
  let readFresh = 0;

  for (const c of row.codes) {
    const url = c.sourceUrl ?? row.sourceUrl;
    if (!seen.has(url)) { seen.add(url); }
    const got = await fetchText(url);
    const base: Omit<ReceiptCode, 'verdict'> = {
      family: c.family,
      edition: c.edition,
      sourceUrl: url,
      claimId: codeClaimId(c, row.sourceUrl),
      verifiedBy: READ_BY_THIS_SCRIPT,
      verifiedOn: today,
    };
    const cite = c.sourceUrl ? `  ← ${c.sourceUrl}` : '';

    if (!got.ok) {
      // Already proved by someone who could open it? Then this is a limit of
      // the fetcher, not a hole in the table. Carry the evidence forward
      // untouched — including who read it and when — and say so.
      const proof = priorProofOf(base.claimId);
      if (proof) {
        receipted += 1;
        entries.push({ ...base, ...proof, verdict: 'confirmed' });
        lines.push(`      RECEIPTED ${c.family} ${c.edition} — ${got.why}; the committed receipt proves it (${proof.verifiedBy ?? 'source unrecorded'})${cite}`);
        continue;
      }
      const verdict: CodeVerdict = got.manual ? 'manual' : 'unreachable';
      tally[verdict] += 1;
      entries.push({ ...base, verdict, evidence: got.why });
      lines.push(`      ${verdict === 'manual' ? 'MANUAL   ' : 'UNREACH  '} ${c.family} ${c.edition} — ${got.why}${cite}`);
      continue;
    }

    readFresh += 1;
    const text = got.text;
    const year = claimedYear(c);
    const patterns = FAMILY_PHRASES[c.family];

    if (c.family === 'LOCAL' || !patterns) {
      // A LOCAL code has no model-code phrase to look for, so we look for the
      // code's own name — and failing that, for the edition year standing next
      // to the word "code".
      //
      // That second test used to be a bare `text.includes(year)`, which is not
      // a check at all: every one of these pages prints the current year in a
      // copyright line or a news date, so ANY row claiming a current edition
      // confirmed itself. Requiring the year to sit beside the word "code"
      // costs nothing on a real adoption page and refuses a footer.
      const needle = c.name ?? c.edition;
      const at = text.toLowerCase().indexOf(needle.toLowerCase());
      const nearCode = year === null ? undefined : yearsNear(text, [/\bcode\b/gi]).get(year);
      if (at >= 0) {
        tally.confirmed += 1;
        entries.push({ ...base, verdict: 'confirmed', evidence: text.slice(Math.max(0, at - 40), at + 140).trim() });
        lines.push(`      ok        ${c.family} ${c.edition} — the page names this code${cite}`);
      } else if (nearCode) {
        tally.confirmed += 1;
        entries.push({ ...base, verdict: 'confirmed', evidence: nearCode });
        lines.push(`      ok        ${c.family} ${c.edition} — the page prints ${year} beside "code"${cite}`);
      } else {
        tally.unconfirmed += 1;
        entries.push({ ...base, verdict: 'unconfirmed', evidence: `neither "${needle}" nor ${year ?? 'its edition'} beside "code" appears on the page` });
        lines.push(`      UNCONFIRM ${c.family} ${c.edition} — "${needle}" not found on the page${cite}`);
      }
      continue;
    }

    const years = yearsNear(text, patterns);
    if (years.size === 0) {
      tally.unconfirmed += 1;
      entries.push({ ...base, verdict: 'unconfirmed', evidence: 'the page never names this code family near a year' });
      lines.push(`      UNCONFIRM ${c.family} ${c.edition} — the page never names this code family near a year${cite}`);
    } else if (year !== null && years.has(year)) {
      tally.confirmed += 1;
      entries.push({ ...base, verdict: 'confirmed', evidence: years.get(year) });
      lines.push(`      ok        ${c.family} ${c.edition}${cite}`);
    } else {
      tally.mismatch += 1;
      const printed = [...years.keys()].sort().join(', ');
      entries.push({ ...base, verdict: 'mismatch', evidence: `the page prints ${printed} next to this code family` });
      lines.push(`      MISMATCH  row claims ${c.family} ${c.edition}; the page prints ${printed} next to that code${cite}`);
    }
  }

  receipt.rows[codeReceiptKey(row)] = {
    label: who,
    // A row where NOTHING was actually read today does not get today's date.
    // Re-running a fetcher against a host that always 403s is not evidence,
    // and stamping it as if it were would quietly reset the validator's
    // one-year clock forever — the row would never come back for a human.
    verifiedOn: readFresh > 0 ? today : (wasReceipted?.verifiedOn ?? today),
    checkedOn: row.checkedOn,
    sourceUrl: row.sourceUrl,
    codes: entries,
  };

  const bad = entries.some((e) => e.verdict !== 'confirmed');
  console.log(`${bad ? '✗' : '·'} ${who}\n    ${row.sourceUrl}\n${lines.join('\n')}`);
}

// A row deleted from the table must not keep a receipt — stale evidence for a
// jurisdiction nobody serves any more is exactly the kind of thing that gets
// copied back in later.
const live = new Set(ALL.map(codeReceiptKey));
const orphans = Object.keys(receipt.rows).filter((k) => !live.has(k));
for (const k of orphans) delete receipt.rows[k];

const ordered: Record<string, ReceiptRow> = {};
for (const row of ALL) {
  const k = codeReceiptKey(row);
  if (receipt.rows[k]) ordered[k] = receipt.rows[k];
}

writeFileSync(
  RECEIPT_PATH,
  `${JSON.stringify(
    {
      $comment: RECEIPT_COMMENT,
      tool: 'scripts/verify-code-sources.ts',
      rows: ordered,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// `receipted` is deliberately NOT a failure: it is a claim this script cannot
// fetch and the committed receipt already proves. Everything else still is.
const failures = tally.mismatch + tally.unconfirmed + tally.unreachable + tally.manual;
console.log(
  `\n${tally.confirmed} edition(s) confirmed on the page, ${receipted} carried by the committed receipt `
  + `(source unfetchable from a script), ${tally.mismatch} MISMATCH, `
  + `${tally.unconfirmed} unconfirmed, ${tally.unreachable} unreachable, ${tally.manual} needing a human.`,
);
console.log(`receipt written: utils/codeJurisdiction.receipt.json (${Object.keys(ordered).length} rows${orphans.length ? `, ${orphans.length} orphan(s) pruned` : ''})`);

if (tally.mismatch > 0) {
  console.log('\nA MISMATCH means the row and its own citation disagree about a year.');
  console.log('Read the page and fix the row (or the citation). Then update checkedOn.');
}
if (tally.unconfirmed > 0) {
  console.log('\nAn UNCONFIRMED claim is not allowed to ship. Either cite a page that states it');
  console.log('(AdoptedCode.sourceUrl can point one code at its own document), or delete the claim.');
}
process.exit(failures > 0 ? 1 : 0);
