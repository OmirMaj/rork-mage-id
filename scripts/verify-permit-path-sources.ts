// scripts/verify-permit-path-sources.ts — fetch every page the Permit Path
// packs cite (utils/permitPath/packs/sources.ts) and check that it still says
// what we read off it.
//
// WHY: scripts/validate-permit-path-facts.ts checks the SHAPE of a citation
// offline. A real, fresh, allowlisted URL next to a recalled claim passes every
// shape check, which is the exact failure utils/codeJurisdiction.ts documents
// (the Dallas NEC row). This script opens the page.
//
// HOW TO RUN IT (needs the network; NOT in ship-check, on purpose):
//
//     bun run scripts/verify-permit-path-sources.ts          # every source
//     bun run scripts/verify-permit-path-sources.ts V7 V12   # some of them
//
// For each SOURCES entry it looks for `phrase` and every `extraPhrases` entry,
// case-insensitive with whitespace collapsed, and prints one verdict per V-n:
//
//   CONFIRMED    every phrase is on the page
//   MISMATCH     the page loaded but a phrase is missing: the page changed.
//                Re-read it. Reword the item to what the page now says, or drop
//                it to a DeptQuestion. Never just edit the phrase to pass.
//   UNREACHABLE  no page arrived (HTTP error, timeout, block). Not a verdict on
//                the claim; try again, or read the page by hand.
//
// After a fully CONFIRMED run, move FACTS_CHECKED_ON (sources.ts) and
// FACTS_CLOCK (validate-permit-path-facts.ts) to the run date.
//
// Exit code: 1 on any MISMATCH, 0 otherwise (UNREACHABLE is reported, not failed).

import { SOURCES, SOURCE_IDS, type SourceId } from '../utils/permitPath/packs/sources';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const NAMED: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: '-',
  mdash: '-',
  sect: '§',
  copy: '©',
  reg: '®',
  ccedil: 'ç',
};

/** HTML → the words a reader sees, normalized for matching. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

/** Lowercase, straight quotes, plain hyphens, no zero-width chars, one space. */
export function normalize(s: string): string {
  return s
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type Verdict = { id: SourceId; verdict: 'CONFIRMED' | 'MISMATCH' | 'UNREACHABLE'; detail: string };

export function judge(id: SourceId, pageText: string): Verdict {
  const page = normalize(pageText);
  const s = SOURCES[id];
  const missing = [s.phrase, ...s.extraPhrases].filter((p) => !page.includes(normalize(p)));
  return missing.length === 0
    ? { id, verdict: 'CONFIRMED', detail: `${1 + s.extraPhrases.length} phrase(s) found` }
    : { id, verdict: 'MISMATCH', detail: `not on the page: ${missing.map((m) => `"${m}"`).join(', ')}` };
}

async function fetchPage(url: string): Promise<{ ok: true; text: string } | { ok: false; why: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const body = await res.text();
    if (body.trim().length < 200) return { ok: false, why: 'empty body' };
    return { ok: true, text: htmlToText(body) };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

if (import.meta.main) {
  const wanted = process.argv.slice(2).map((a) => a.toUpperCase());
  const ids = SOURCE_IDS.filter((id) => wanted.length === 0 || wanted.includes(id));
  // Sequential: nyc.gov rate-limits, and 13 pages take well under a minute.
  const out: Verdict[] = [];
  for (const id of ids) {
    const s = SOURCES[id];
    const got = await fetchPage(s.url);
    const v: Verdict = got.ok ? judge(id, got.text) : { id, verdict: 'UNREACHABLE', detail: got.why };
    out.push(v);
    console.log(`${v.verdict.padEnd(11)} ${id.padEnd(3)} ${s.label} · ${v.detail}`);
  }
  const n = (k: Verdict['verdict']) => out.filter((v) => v.verdict === k).length;
  console.log(`\n${n('CONFIRMED')} confirmed · ${n('MISMATCH')} mismatch · ${n('UNREACHABLE')} unreachable · checkedOn in file ${SOURCES.V1.checkedOn}`);
  if (n('MISMATCH') > 0) process.exit(1);
}
