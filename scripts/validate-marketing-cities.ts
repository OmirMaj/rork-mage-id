// scripts/validate-marketing-cities.ts — the two city pages
// (marketing/cities/new-york-city.html, marketing/cities/baltimore.html),
// with every claim on them pinned to the code it describes.
//
// WHY. The app reads real New York City and Baltimore depth (the NYC building
// record, DOB review times, Baltimore City vs County from the parcel, the
// codes in force, the permit offices, Inspection Ready), and until these two
// pages the marketing site said none of it. A page like this goes stale the
// day a dataset is renamed or an edition changes, so the lists are typed by
// hand on the page and checked here against the constants:
//
//   NYC        DATASETS[RECORD_DATASET_IDS] names (normalize.ts), their count
//              word, BUILDING_RECORD_NOT_CHECKED (utils/buildingRecord.ts),
//              the 'New York City' LOCAL_ADOPTIONS row's authorityName, code
//              name and edition, and the Queens postal names (postalCity).
//   Baltimore  both rows' authorityName, every code name, every edition next
//              to its family, the statewide proposal dates (the Maryland
//              STATE_ADOPTIONS notes), MD_NOT_CHECKED_CITY / _COUNTY and
//              MD_LINKS_CITY / _COUNTY labels and URLs (md.ts).
//   Both       the plans line names REQUIRED_TIER.ai_code_check and its list
//              price; "on every plan" only while building-record still
//              accepts 'free'; no construction-answer pitch while
//              construction-answer still needs ANTHROPIC_API_KEY; banned
//              claims; the VOICE §7 confirm line exactly once; the head,
//              image and voice rules of validate-marketing-seo.ts; the
//              Inspection Ready window equals PREP_WINDOW_DAYS; each page
//              is in sitemap.xml.
//
// HOW THE PAGE IS READ. Each pinned claim lives in an element carrying
// data-pin="<name>" (nyc-count, nyc-datasets, nyc-not-checked, nyc-codes,
// nyc-queens, codes-city, codes-county, md-proposal, md-city-not-checked,
// md-county-not-checked, md-links-city, md-links-county, plans). A reskin
// keeps those attributes; drop one and the check names it.
//
// CONTRACT (the redesign lanes call these on reskinned pages):
//   export const CITY_PAGES: Record<'nyc'|'baltimore', string>   repo-relative
//   export function cityClaimProblems(html, city): string[]
//
// Run: bun run scripts/validate-marketing-cities.ts
// Section 0 is the negative fixtures: each breaks one claim on a copy of the
// real page and must be caught, or the run exits 1.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, RECORD_DATASET_IDS } from '../supabase/functions/building-record/normalize';
import { MD_NOT_CHECKED_CITY, MD_NOT_CHECKED_COUNTY, MD_LINKS_CITY, MD_LINKS_COUNTY, type MdLink } from '../supabase/functions/building-record/md';
import { BUILDING_RECORD_NOT_CHECKED } from '../utils/buildingRecord';
import { LOCAL_ADOPTIONS, STATE_ADOPTIONS, type LocalAdoption } from '../utils/codeJurisdiction';
import { REQUIRED_TIER } from '../utils/featureTiers';
import { LIST_PRICE_MONTHLY, type PaidTier } from '../constants/pricing';
import {
  decodeEntities, fileToUrl, headProblems, imgProblems, proseOf, stripNonContent, titleCaseProblems, voiceProblems,
} from './validate-marketing-seo';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKETING = join(ROOT, 'marketing');

export type City = 'nyc' | 'baltimore';
export const CITY_PAGES: Record<City, string> = {
  nyc: 'marketing/cities/new-york-city.html',
  baltimore: 'marketing/cities/baltimore.html',
};

const CONFIRM = 'Confirm with your building department before you build.';
const BANNED: RegExp[] = [
  /cites? the (actual )?code|verified code|clean building|all clear|compliant building|files? (your )?permits|better than UpCodes|tristate building record|\d+%\s*(ROI|return)/i,
  /the only [^.]{0,40}app/i,
];
const ASK_ANY = /ask any (construction|code) question/i;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// ── Reading the page ────────────────────────────────────────────────────────

/** Curly quotes to straight, no-break spaces to spaces, runs of space to one. */
export function norm(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** The inner HTML of every element carrying data-pin="<pin>" (tags balanced). */
export function pinnedAll(html: string, pin: string): string[] {
  const body = stripNonContent(html);
  const out: string[] = [];
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\sdata-pin="${pin}"[^>]*>`, 'g');
  for (const m of body.matchAll(open)) {
    const tag = m[1].toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tags.lastIndex = start;
    let depth = 1;
    for (let t = tags.exec(body); t; t = tags.exec(body)) {
      if (t[0].endsWith('/>')) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) { out.push(body.slice(start, t.index)); break; }
    }
  }
  return out;
}

/** The one pinned element's visible text, or a problem naming what is wrong. */
function pinText(html: string, pin: string, say: (s: string) => void): string | null {
  const all = pinnedAll(html, pin);
  if (all.length !== 1) { say(`expected one element with data-pin="${pin}", found ${all.length}`); return null; }
  return norm(proseOf(all[0]));
}

/** What a pinned list says beyond the code's items. Empty = nothing extra. */
function leftover(text: string, items: readonly string[]): string {
  let rest = text.replace(/not checked:?/i, ' ');
  for (const it of items) rest = rest.split(norm(it)).join(' ');
  return rest.replace(/[\s,.;:·]+/g, ' ').trim();
}

// ── The code side ───────────────────────────────────────────────────────────

const read = (rel: string) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };

function localRow(name: string): LocalAdoption | undefined {
  return LOCAL_ADOPTIONS.find(r => r.name === name);
}

/** The tiers building-record's requireTier accepts, read from its source. */
export function buildingRecordTiers(src: string): string[] | null {
  const m = /requireTier\(\s*req\s*,\s*\[([^\]]*)\]\s*,\s*'building_record'\s*\)/.exec(src);
  return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]) : null;
}

/** The two dates in the Maryland row's 2024-proposal sentence, or null when it is reworded. */
export function mdProposalDates(notes: string): { proposed: string; checked: string } | null {
  const p = /proposal in the Maryland Register on (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(notes);
  const c = /no effective date when MAGE checked it on (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(notes);
  return p && c ? { proposed: p[1], checked: c[1] } : null;
}

/**
 * A block of page text against one LOCAL_ADOPTIONS row: the authority by its
 * exact name, every code name, and every edition. A family code (IBC, NEC…)
 * must appear, and the nearest year before EVERY mention of it in the block
 * must be its edition ("the 2021 IBC, IRC and IECC and the 2020 NEC"). A
 * LOCAL code carries its edition in its name or within 40 characters after it.
 */
export function codesBlockProblems(text: string, row: LocalAdoption, where: string): string[] {
  const p: string[] = [];
  if (!text.includes(norm(row.authorityName))) p.push(`${where}: the authority must read exactly "${row.authorityName}" (LOCAL_ADOPTIONS '${row.name}')`);
  for (const name of new Set(row.codes.map(c => c.name).filter((n): n is string => !!n))) {
    if (!text.includes(norm(name))) p.push(`${where}: code "${name}" is missing (LOCAL_ADOPTIONS '${row.name}')`);
  }
  for (const c of row.codes) {
    if (c.family === 'LOCAL') {
      const name = norm(c.name ?? '');
      const at = name ? text.indexOf(name) : -1;
      if (at < 0) continue; // reported above
      if (!name.includes(c.edition) && !text.slice(at + name.length, at + name.length + 40).includes(c.edition)) {
        p.push(`${where}: "${c.name}" needs its edition ${c.edition} beside it`);
      }
      continue;
    }
    const hits = [...text.matchAll(new RegExp(`\\b${c.family}\\b`, 'g'))];
    if (hits.length === 0) { p.push(`${where}: ${c.edition} ${c.family} is missing (LOCAL_ADOPTIONS '${row.name}')`); continue; }
    for (const h of hits) {
      const years = [...text.slice(0, h.index).matchAll(/\b(?:19|20)\d{2}\b/g)];
      const near = years.length ? years[years.length - 1][0] : 'no year';
      if (near !== c.edition) p.push(`${where}: ${c.family} reads as ${near}, the code says ${c.edition} (LOCAL_ADOPTIONS '${row.name}')`);
    }
  }
  return p;
}

function notCheckedProblems(text: string, items: readonly string[], where: string, from: string): string[] {
  const p: string[] = [];
  for (const it of items) if (!text.includes(norm(it))) p.push(`${where}: "Not checked" item missing: "${it}" (${from})`);
  const extra = leftover(text, items);
  if (extra) p.push(`${where}: the "Not checked" list says more than ${from}: "${extra}"`);
  return p;
}

function linkProblems(inner: string, links: readonly MdLink[], where: string, from: string): string[] {
  const p: string[] = [];
  const anchors = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({
    href: decodeEntities(/\shref="([^"]*)"/i.exec(m[1])?.[1] ?? ''),
    label: norm(proseOf(m[2])),
  }));
  for (const l of links) {
    if (!anchors.some(a => a.href === l.url && a.label === norm(l.label))) p.push(`${where}: no link "${l.label}" → ${l.url} (${from})`);
  }
  if (anchors.length !== links.length) p.push(`${where}: ${anchors.length} links, ${from} has ${links.length}`);
  return p;
}

// ── The claims ──────────────────────────────────────────────────────────────

export interface CityCodeFacts {
  buildingRecordSrc: string;
  constructionAnswerSrc: string;
  inspectionPrepSrc: string;
}
const realFacts = (): CityCodeFacts => ({
  buildingRecordSrc: read('supabase/functions/building-record/index.ts'),
  constructionAnswerSrc: read('supabase/functions/construction-answer/index.ts'),
  inspectionPrepSrc: read('utils/inspectionPrep.ts'),
});

export function cityClaimProblems(html: string, city: City, facts: CityCodeFacts = realFacts()): string[] {
  const rel = relative(MARKETING, join(ROOT, CITY_PAGES[city]));
  const p: string[] = [];
  const say = (s: string) => p.push(`${rel}: ${s}`);

  // Shared marketing rules.
  p.push(...headProblems(html, rel), ...imgProblems(html, rel), ...voiceProblems(proseOf(html), rel), ...titleCaseProblems(html, rel));

  const prose = norm(proseOf(html));
  const metas = [...stripNonContent(html).matchAll(/<meta\b[^>]*\scontent="([^"]*)"/gi)].map(m => decodeEntities(m[1])).join(' ');
  const claimText = `${prose} ${norm(metas)}`;
  for (const re of BANNED) {
    const m = re.exec(claimText);
    if (m) say(`banned claim "${m[0]}" ("…${claimText.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)}…")`);
  }
  const answerDark = /ANTHROPIC_API_KEY/.test(facts.constructionAnswerSrc);
  if (answerDark) {
    const m = ASK_ANY.exec(claimText);
    if (m) say(`"${m[0]}" sells construction answers, which stay dark while construction-answer/index.ts needs ANTHROPIC_API_KEY`);
  }
  const confirms = prose.split(CONFIRM).length - 1;
  if (confirms !== 1) say(`"${CONFIRM}" must appear exactly once (docs/VOICE.md §7 item 4), found ${confirms}`);

  // Inspection Ready's window is the code's.
  if (/Inspection Ready/.test(prose)) {
    const w = /export const PREP_WINDOW_DAYS = (\d+);/.exec(facts.inspectionPrepSrc);
    if (!w) say('cannot read PREP_WINDOW_DAYS from utils/inspectionPrep.ts: the parser is blind');
    else {
      const n = Number(w[1]);
      if (!new RegExp(`\\b(${WORDS[n] ?? n}|${n}) days\\b`, 'i').test(prose)) say(`Inspection Ready must name its ${n}-day window (PREP_WINDOW_DAYS = ${n})`);
    }
  }

  // The plans line.
  const plans = pinText(html, 'plans', say);
  if (plans !== null) {
    const tier = REQUIRED_TIER.ai_code_check;
    if (tier === 'free') {
      if (!/every plan/i.test(plans)) say('REQUIRED_TIER.ai_code_check is free: the plans line must say code checks are on every plan');
    } else {
      const word = tier[0].toUpperCase() + tier.slice(1);
      if (!new RegExp(`\\b${word}\\b`).test(plans)) say(`the plans line must name ${word} (REQUIRED_TIER.ai_code_check = '${tier}'): "${plans}"`);
      const price = `${LIST_PRICE_MONTHLY[tier as PaidTier]}/mo`;
      if (!plans.includes(price)) say(`the plans line must carry the list price ${price} (constants/pricing.ts): "${plans}"`);
    }
    if (answerDark && /\bBusiness\b/.test(plans)) say('the plans line names Business, the construction-answer tier, while construction-answer/index.ts needs ANTHROPIC_API_KEY');
    if (/building record[^.]*every plan/i.test(plans)) {
      const tiers = buildingRecordTiers(facts.buildingRecordSrc);
      if (!tiers) say("cannot read building-record/index.ts requireTier(…, 'building_record'): the parser is blind");
      else if (!tiers.includes('free')) say(`the plans line puts the building record on every plan, but building-record accepts only ${tiers.join(', ')}`);
    }
  }

  if (city === 'nyc') {
    const n = RECORD_DATASET_IDS.length;
    const count = pinText(html, 'nyc-count', say);
    if (count !== null && !new RegExp(`\\b${WORDS[n] ?? n} Department of Buildings datasets\\b`, 'i').test(count)) {
      say(`the dataset count must read "${WORDS[n] ?? n} Department of Buildings datasets" (RECORD_DATASET_IDS has ${n})`);
    }
    const list = pinnedAll(html, 'nyc-datasets');
    if (list.length !== 1) say(`expected one element with data-pin="nyc-datasets", found ${list.length}`);
    else {
      const items = [...list[0].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => norm(proseOf(m[1])));
      for (const id of RECORD_DATASET_IDS) {
        if (!items.includes(norm(DATASETS[id].name))) say(`dataset "${DATASETS[id].name}" (${id}) is missing from the list (normalize.ts DATASETS)`);
      }
      const known = new Set(RECORD_DATASET_IDS.map(id => norm(DATASETS[id].name)));
      for (const it of items) if (!known.has(it)) say(`the list names "${it}", which is not a RECORD_DATASET_IDS dataset`);
    }
    const gap = pinText(html, 'nyc-not-checked', say);
    if (gap !== null) p.push(...notCheckedProblems(gap, BUILDING_RECORD_NOT_CHECKED, rel, 'BUILDING_RECORD_NOT_CHECKED'));
    const row = localRow('New York City');
    const codes = pinText(html, 'nyc-codes', say);
    if (!row) say("LOCAL_ADOPTIONS has no 'New York City' row");
    else if (codes !== null) p.push(...codesBlockProblems(codes, row, `${rel} [nyc-codes]`));
    const queens = pinText(html, 'nyc-queens', say);
    if (queens !== null && row) {
      const names = queens.split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
      if (names.length === 0) say('the Queens postal-name example is empty');
      for (const nm of names) {
        if (!(row.postalCity ?? []).includes(nm.toLowerCase())) say(`"${nm}" is not a Queens postal name the 'New York City' row resolves (postalCity)`);
      }
    }
  } else {
    for (const [pin, name] of [['codes-city', 'Baltimore City'], ['codes-county', 'Baltimore County']] as const) {
      const row = localRow(name);
      const text = pinText(html, pin, say);
      if (!row) say(`LOCAL_ADOPTIONS has no '${name}' row`);
      else if (text !== null) p.push(...codesBlockProblems(text, row, `${rel} [${pin}]`));
    }
    const md = STATE_ADOPTIONS.find(r => r.state === 'MD');
    const dates = md?.notes ? mdProposalDates(md.notes) : null;
    const proposal = pinText(html, 'md-proposal', say);
    if (!dates) say('the Maryland STATE_ADOPTIONS notes no longer carry the 2024-proposal sentence: reread the row and rewrite md-proposal');
    else if (proposal !== null) {
      if (!proposal.includes(dates.proposed)) say(`md-proposal must give the proposal date ${dates.proposed} (Maryland row notes)`);
      if (!proposal.includes(dates.checked)) say(`md-proposal must give the last-checked date ${dates.checked} (Maryland row notes)`);
    }
    const city = pinText(html, 'md-city-not-checked', say);
    if (city !== null) p.push(...notCheckedProblems(city, MD_NOT_CHECKED_CITY, `${rel} [City]`, 'MD_NOT_CHECKED_CITY'));
    const county = pinText(html, 'md-county-not-checked', say);
    if (county !== null) p.push(...notCheckedProblems(county, MD_NOT_CHECKED_COUNTY, `${rel} [County]`, 'MD_NOT_CHECKED_COUNTY'));
    for (const [pin, links, from] of [['md-links-city', MD_LINKS_CITY, 'MD_LINKS_CITY'], ['md-links-county', MD_LINKS_COUNTY, 'MD_LINKS_COUNTY']] as const) {
      const all = pinnedAll(html, pin);
      if (all.length !== 1) say(`expected one element with data-pin="${pin}", found ${all.length}`);
      else p.push(...linkProblems(all[0], links, `${rel} [${pin}]`, from));
    }
  }
  return p;
}

/** Each city page's URL is a <loc> in sitemap.xml. */
export function citySitemapProblems(xml: string): string[] {
  const locs = new Set([...stripNonContent(xml).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1].trim()));
  return (Object.values(CITY_PAGES)).map(f => fileToUrl(join(ROOT, f), MARKETING))
    .filter(u => !locs.has(u)).map(u => `sitemap.xml: ${u} is not listed`);
}

// ── 0. Negative fixtures ────────────────────────────────────────────────────
const page = (c: City) => { try { return readFileSync(join(ROOT, CITY_PAGES[c]), 'utf8'); } catch { return ''; } };
/** A mutation that matched nothing would make a fixture pass for the wrong reason. */
function mutate(src: string, from: string | RegExp, to: string): string {
  const out = typeof from === 'string' ? src.split(from).join(to) : src.replace(from, to);
  if (out === src) throw new Error(`fixture mutation did not apply: ${String(from).slice(0, 60)}`);
  return out;
}

export const FIXTURES: { name: string; expect: RegExp; run: () => string[] }[] = [
  { name: 'NYC page missing "DOB ECB Violations"', expect: /"DOB ECB Violations" \(6bgk-3dad\) is missing/, run: () => cityClaimProblems(mutate(page('nyc'), /<li\b[^>]*>DOB ECB Violations<\/li>\s*/, ''), 'nyc') },
  { name: 'NYC page listing a dataset the code does not read', expect: /not a RECORD_DATASET_IDS dataset/, run: () => cityClaimProblems(mutate(page('nyc'), /(<li\b[^>]*>DOB Violations<\/li>)/, '$1<li>HPD Violations</li>'), 'nyc') },
  { name: 'NYC page with the dataset count wrong', expect: /dataset count must read "seven/, run: () => cityClaimProblems(mutate(page('nyc'), 'reads seven Department', 'reads eight Department'), 'nyc') },
  { name: 'NYC page saying "clean building"', expect: /banned claim "clean building"/, run: () => cityClaimProblems(mutate(page('nyc'), 'shows each open item with its date.', 'shows each open item with its date, or tells you it is a clean building.'), 'nyc') },
  { name: 'NYC "Not checked" list missing DEP', expect: /"Not checked" item missing: "DEP"/, run: () => cityClaimProblems(mutate(page('nyc'), 'FDNY, DEP, ', 'FDNY, '), 'nyc') },
  { name: 'NYC "Not checked" list with an item the code does not have', expect: /says more than BUILDING_RECORD_NOT_CHECKED: "Con Ed"/, run: () => cityClaimProblems(mutate(page('nyc'), 'DOT, BIS-only', 'DOT, Con Ed, BIS-only'), 'nyc') },
  { name: 'NYC authority renamed', expect: /authority must read exactly "New York City Department of Buildings"/, run: () => cityClaimProblems(mutate(page('nyc'), 'enforced by the New York City Department of Buildings', 'enforced by the NYC DOB'), 'nyc') },
  { name: 'NYC code edition drifted', expect: /"NYC Construction Codes" needs its edition 2022/, run: () => cityClaimProblems(mutate(page('nyc'), 'NYC Construction Codes (2022 edition)', 'NYC Construction Codes (2014 edition)'), 'nyc') },
  { name: 'NYC Queens example the resolver refuses', expect: /"Floral Park" is not a Queens postal name/, run: () => cityClaimProblems(mutate(page('nyc'), 'Astoria and Flushing', 'Astoria and Floral Park'), 'nyc') },
  { name: 'NYC page selling "Ask any construction question"', expect: /sells construction answers/, run: () => cityClaimProblems(mutate(page('nyc'), 'before you promise a start date.', 'before you promise a start date. Ask any construction question.'), 'nyc') },
  { name: 'NYC Inspection Ready window drifted', expect: /must name its \d+-day window/, run: () => cityClaimProblems(page('nyc').split('three days').join('five days'), 'nyc') },
  { name: 'NYC title over 60 characters (seo headProblems)', expect: /<title> is \d+ characters/, run: () => cityClaimProblems(mutate(page('nyc'), '<title>Construction software for New York City GCs', '<title>Construction software for New York City general contractors and builders'), 'nyc') },
  { name: 'Baltimore page with "Bill 49-23"', expect: /code "Baltimore County Building Code, Bill 49-24" is missing/, run: () => cityClaimProblems(mutate(page('baltimore'), 'Bill 49-24', 'Bill 49-23'), 'baltimore') },
  { name: 'Baltimore County IPC edition drifted', expect: /IPC reads as 2018, the code says 2021/, run: () => cityClaimProblems(mutate(page('baltimore'), '(2021 IPC)', '(2018 IPC)'), 'baltimore') },
  { name: 'Baltimore City NEC edition drifted', expect: /NEC reads as 2023, the code says 2020/, run: () => cityClaimProblems(mutate(page('baltimore'), 'the 2020 NEC', 'the 2023 NEC'), 'baltimore') },
  { name: 'Baltimore County NEC missing', expect: /2026 NEC is missing/, run: () => cityClaimProblems(mutate(page('baltimore'), ' the 2026 NEC;', ''), 'baltimore') },
  { name: 'Baltimore City authority shortened', expect: /authority must read exactly "Baltimore City Department of Housing & Community Development/, run: () => cityClaimProblems(mutate(page('baltimore'), 'Housing &amp; Community Development (DHCD)', 'Housing (DHCD)'), 'baltimore') },
  { name: 'Baltimore proposal date drifted', expect: /proposal date 26 June 2026/, run: () => cityClaimProblems(mutate(page('baltimore'), 'on 26 June 2026', 'on 1 July 2026'), 'baltimore') },
  { name: 'Baltimore County "Not checked" item missing', expect: /"Not checked" item missing: "Certificates of occupancy \(no County dataset read\)"/, run: () => cityClaimProblems(mutate(page('baltimore'), /<li>Certificates of occupancy \(no County dataset read\)<\/li>\s*/, ''), 'baltimore') },
  { name: 'Baltimore E-Permits link URL drifted', expect: /no link "E-Permits search"/, run: () => cityClaimProblems(mutate(page('baltimore'), 'https://aca-prod.accela.com/BALTIMORE/Default.aspx', 'https://cels.baltimorehousing.org/Search_TM_MAP.aspx'), 'baltimore') },
  { name: 'Baltimore County link label drifted', expect: /no link "County permit portal"/, run: () => cityClaimProblems(mutate(page('baltimore'), '>County permit portal<', '>Permits portal<'), 'baltimore') },
  { name: 'confirm line twice', expect: /must appear exactly once .* found 2/, run: () => cityClaimProblems(mutate(page('baltimore'), '<p>A layer that can', '<p>Confirm with your building department before you build.</p><p>A layer that can'), 'baltimore') },
  { name: 'confirm line missing', expect: /must appear exactly once .* found 0/, run: () => cityClaimProblems(mutate(page('nyc'), 'Confirm with your building department before you build.', 'Check with the city.'), 'nyc') },
  { name: 'plans line without Pro', expect: /the plans line must name Pro/, run: () => cityClaimProblems(mutate(page('nyc'), '<strong>Pro, $29/mo</strong>', '<strong>paid plans, $29/mo</strong>'), 'nyc') },
  { name: 'plans line with the wrong price', expect: /list price \$29\/mo/, run: () => cityClaimProblems(mutate(page('baltimore'), 'Pro, $29/mo', 'Pro, $25/mo'), 'baltimore') },
  { name: 'plans line selling Business', expect: /names Business, the construction-answer tier/, run: () => cityClaimProblems(mutate(page('nyc'), '<strong>Pro, $29/mo</strong>.', '<strong>Pro, $29/mo</strong>. Construction answers are on Business.'), 'nyc') },
  { name: '"every plan" while building-record drops free', expect: /accepts only pro, business, enterprise/, run: () => cityClaimProblems(page('nyc'), 'nyc', { ...realFacts(), buildingRecordSrc: "await requireTier(req, ['pro', 'business', 'enterprise'], 'building_record');" }) },
  { name: 'a pinned element dropped by a reskin', expect: /expected one element with data-pin="md-county-not-checked", found 0/, run: () => cityClaimProblems(mutate(page('baltimore'), ' data-pin="md-county-not-checked"', ''), 'baltimore') },
  { name: '"the only … app" absolute', expect: /banned claim "the only/, run: () => cityClaimProblems(mutate(page('baltimore'), 'which one your jobsite is in.', 'which one your jobsite is in. It is the only Baltimore app that does.'), 'baltimore') },
  { name: 'sitemap without the city pages', expect: /cities\/baltimore\.html is not listed/, run: () => citySitemapProblems('<urlset><url><loc>https://mageid.app/</loc></url></urlset>') },
];
export const CLEAN_FIXTURES: { name: string; run: () => string[] }[] = [
  { name: 'the NYC page as committed', run: () => cityClaimProblems(page('nyc'), 'nyc') },
  { name: 'the Baltimore page as committed', run: () => cityClaimProblems(page('baltimore'), 'baltimore') },
  { name: 'a sitemap listing both pages', run: () => citySitemapProblems('<urlset><url><loc>https://mageid.app/cities/new-york-city.html</loc></url><url><loc>https://mageid.app/cities/baltimore.html</loc></url></urlset>') },
];

// ── Entry point ─────────────────────────────────────────────────────────────
function main(): number {
  let pass = 0, fail = 0;
  const ok = (name: string, problems: string[]) => {
    if (problems.length === 0) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗', name); for (const s of problems.slice(0, 30)) console.log('      ', s); if (problems.length > 30) console.log(`       …and ${problems.length - 30} more`); }
  };

  console.log('\n0. negative fixtures (each must be caught)');
  for (const fx of FIXTURES) {
    let got: string[];
    try { got = fx.run(); } catch (e) { got = []; console.log('       fixture threw:', (e as Error).message); }
    ok(`caught: ${fx.name}`, got.some(g => fx.expect.test(g)) ? []
      : [`expected a problem matching ${fx.expect} — the check that should catch it is blind`, ...got.slice(0, 8).map(g => `(got) ${g}`)]);
  }
  for (const fx of CLEAN_FIXTURES) ok(`clean fixture stays clean: ${fx.name}`, fx.run());

  console.log('\n1. city pages');
  for (const [city, rel] of Object.entries(CITY_PAGES) as [City, string][]) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) { ok(`${rel} exists`, [`${rel} is missing`]); continue; }
    ok(`claims pinned to the code: ${rel}`, cityClaimProblems(readFileSync(file, 'utf8'), city));
  }

  console.log('\n2. sitemap');
  ok('sitemap.xml lists both city pages', citySitemapProblems(readFileSync(join(MARKETING, 'sitemap.xml'), 'utf8')));

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main());
