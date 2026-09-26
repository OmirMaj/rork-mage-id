// scripts/import-nj-construction-offices.ts — regenerate
// utils/generated/njConstructionOffices.json from the NJ DCA roster.
//
// SOURCE: "Listing of NJ Municipal Construction Code Enforcement Officials",
// NJ Department of Community Affairs, Office of Regulatory Affairs
//   https://www.nj.gov/dca/codes/publications/pdf_ora/muniroster.pdf
// Each entry reads "CODE: NAME, COUNTY", then the office address, then
// "Phone: … Fax: …", then the construction and sub-code officials.
//
// WHAT IS KEPT: the 4-digit municipal code, the municipality and county as the
// roster prints them, the office address lines (verbatim), phone and fax, and
// `dcaEnforced` — true when the roster names the DEPARTMENT OF COMMUNITY AFFAIRS
// as the construction official, i.e. the state enforces the code there.
// WHAT IS NEVER KEPT: the officials' names. Only the lines ABOVE "Phone:" are
// read as address; the official lines are skipped by construction.
//
// THE CENSUS JOIN. The place-lookup edge function answers with a Census county
// subdivision (GEOID). NJ municipalities are county subdivisions one-for-one,
// so each roster entry is matched to the CURRENT TIGERweb county-subdivision
// layer by county + name + type ("HOBOKEN CITY" ↔ "Hoboken city"). Entries
// with no current Census twin (a municipality that has since merged) are kept
// out of `offices` and listed in `unmatched` with the reason.
//
// Run:  bun run scripts/import-nj-construction-offices.ts [path/to/muniroster.pdf]
// Needs pdftotext (poppler) and network for TIGERweb. With no path it downloads
// the PDF from the source URL.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_URL = 'https://www.nj.gov/dca/codes/publications/pdf_ora/muniroster.pdf';
const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/1/query'
  + "?where=STATE%3D%2734%27&outFields=GEOID,NAME,BASENAME,COUNTY&returnGeometry=false&resultRecordCount=2000&f=json";
const OUT = 'utils/generated/njConstructionOffices.json';

/**
 * The three roster entries whose name no rule can join, each pinned to the ONE
 * current Census county subdivision of that type in the same county. Both
 * sides are official; only the spelling differs. Every other entry is joined
 * by rule, and a pinned entry still has to land in its own county.
 */
const CENSUS_NAME_FOR_CODE: Record<string, string> = {
  '0109': 'Estell Manor city',        // roster: ESTELLE MANOR CITY, ATLANTIC
  '0717': 'City of Orange township',  // roster: ORANGE CITY, ESSEX
  '0719': 'South Orange village',     // roster: SOUTH ORANGE VILLAGE TWP, ESSEX
};

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** Roster type word → the Census LSAD word that follows the NAME. */
const TYPE_TO_CENSUS: Record<string, string> = {
  TWP: 'township', TOWNSHIP: 'township', BORO: 'borough', BOROUGH: 'borough',
  CITY: 'city', TOWN: 'town', VILLAGE: 'village',
};

interface RosterEntry {
  code: string;
  name: string;
  county: string;
  address: string[];
  phone: string | null;
  fax: string | null;
  dcaEnforced: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pdfText(pdfPath: string): string {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function parseAsOf(text: string): string {
  const m = text.match(/as of\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!m) throw new Error('roster header "as of <Month DD, YYYY>" not found');
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) throw new Error(`unknown month ${m[1]}`);
  return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function parseRoster(text: string): RosterEntry[] {
  const lines = text.split(/\r?\n/);
  const out: RosterEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\s*(\d{4}):\s+(.+?),\s+([A-Z .'-]+?)\s+COUNTY\s*$/);
    if (!head) continue;
    const address: string[] = [];
    let phone: string | null = null;
    let fax: string | null = null;
    let dcaEnforced = false;
    let j = i + 1;
    // Address: every non-empty line up to "Phone:" (or the official block).
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*Phone:/i.test(l)) {
        const p = l.match(/Phone:\s*([\d()\s-]*\d)/i);
        const f = l.match(/Fax:\s*([\d()\s-]*\d)/i);
        phone = p ? collapse(p[1]) : null;
        fax = f ? collapse(f[1]) : null;
        j++;
        break;
      }
      if (/OFFICIAL:/.test(l) || /^\s*\d{4}:/.test(l)) break;
      if (l.trim()) address.push(collapse(l));
    }
    // Officials: read ONLY to learn whether DCA is the construction official.
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*\d{4}:/.test(l)) break;
      const co = l.match(/^\s*CONSTRUCTION OFFICIAL:\s*(.*)$/);
      if (co) { dcaEnforced = /DEPARTMENT OF COMMUNITY AFFAIRS/.test(co[1]); break; }
    }
    out.push({ code: head[1], name: collapse(head[2]), county: collapse(head[3]), address, phone, fax, dcaEnforced });
  }
  return out;
}

/** Lower-case, punctuation to spaces, and the word "and" dropped, so
 *  "PEAPACK-GLADSTONE" meets "Peapack and Gladstone". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();

interface Cousub { GEOID: string; NAME: string; BASENAME: string; COUNTY: string }

/** "HOBOKEN CITY" → ["hoboken", "city"]; a name with no type word → [name, '']. */
function splitType(name: string): [string, string] {
  const words = name.split(' ');
  const last = words[words.length - 1];
  if (TYPE_TO_CENSUS[last]) return [norm(words.slice(0, -1).join(' ')), TYPE_TO_CENSUS[last]];
  return [norm(name), ''];
}

async function main() {
  const arg = process.argv[2];
  let pdf = arg;
  if (!pdf) {
    const dir = mkdtempSync(join(tmpdir(), 'nj-roster-'));
    pdf = join(dir, 'muniroster.pdf');
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  }
  const text = pdfText(pdf);
  const asOf = parseAsOf(text);
  const roster = parseRoster(text);

  const tiger = await fetch(TIGER_URL).then((r) => r.json()) as { features: { attributes: Cousub }[] };
  const cousubs = tiger.features.map((f) => f.attributes).filter((c) => !/not defined/i.test(c.NAME));
  const countyName = new Map<string, string>(); // county FIPS → roster county name, learned from unambiguous matches

  const offices: unknown[] = [];
  const unmatched: { code: string; name: string; county: string; reason: string }[] = [];
  const byKey = new Map<string, Cousub[]>();
  for (const c of cousubs) {
    const type = norm(c.NAME.slice(c.BASENAME.length));
    const k = `${norm(c.BASENAME)}|${type}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
    if (type) {
      const bare = `${norm(c.BASENAME)}|`;
      byKey.set(bare, [...(byKey.get(bare) ?? []), c]);
    }
  }
  // Pass 1: learn county FIPS ↔ county name from names that are unique statewide.
  for (const e of roster) {
    const [base, type] = splitType(e.name);
    const hits = byKey.get(`${base}|${type}`) ?? [];
    if (hits.length === 1) countyName.set(hits[0].COUNTY, e.county);
  }
  const usedGeoids = new Set<string>();
  for (const e of roster) {
    const [base, type] = splitType(e.name);
    const inCounty = (cs: Cousub[]) => cs.filter((c) => countyName.get(c.COUNTY) === e.county);
    let hits = inCounty(byKey.get(`${base}|${type}`) ?? []);
    // "ATLANTIC CITY" ↔ Census "Atlantic City city": the roster's CITY is
    // part of the name there, and Census adds its own type word after it.
    if (hits.length === 0 && type === 'city') hits = inCounty(byKey.get(`${norm(e.name)}|city`) ?? []);
    const pinned = CENSUS_NAME_FOR_CODE[e.code];
    if (pinned) hits = inCounty(cousubs.filter((c) => c.NAME === pinned));
    // "PRINCETON TWP" ↔ Census "Princeton" (no type word): the only fallback,
    // and only when the bare name is unique within the county.
    if (hits.length === 0) {
      const bare = inCounty(byKey.get(`${base}|`) ?? []).filter((c) => norm(c.NAME) === norm(c.BASENAME));
      if (bare.length === 1) hits = bare;
    }
    if (hits.length !== 1) {
      unmatched.push({ code: e.code, name: e.name, county: e.county, reason: hits.length ? 'several current Census county subdivisions match' : 'no current Census county subdivision (TIGERweb) matches this name in this county' });
      continue;
    }
    if (usedGeoids.has(hits[0].GEOID)) throw new Error(`GEOID ${hits[0].GEOID} matched twice`);
    usedGeoids.add(hits[0].GEOID);
    offices.push({
      code: e.code,
      name: e.name,
      county: e.county,
      censusGeoid: hits[0].GEOID,
      address: e.address,
      phone: e.phone,
      fax: e.fax,
      dcaEnforced: e.dcaEnforced,
    });
  }

  const doc = {
    source: 'NJ Department of Community Affairs — Listing of NJ Municipal Construction Code Enforcement Officials',
    sourceUrl: SOURCE_URL,
    asOf,
    checkedOn: today(),
    joinSource: 'US Census TIGERweb current county subdivisions (Places_CouSub_ConCity_SubMCD/MapServer/1)',
    rosterEntries: roster.length,
    offices,
    unmatched,
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`NJ roster as of ${asOf}: ${roster.length} entries, ${offices.length} joined to Census, ${unmatched.length} unmatched`);
  for (const u of unmatched) console.log(`  unmatched ${u.code} ${u.name}, ${u.county}: ${u.reason}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
