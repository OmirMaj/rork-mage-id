// scripts/import-ct-building-officials.ts — regenerate
// utils/generated/ctBuildingOfficials.json from the CT DAS list.
//
// SOURCE: "List of Connecticut Municipal Building Officials", CT Department of
// Administrative Services
//   https://portal.ct.gov/-/media/DAS/OEDM/BO-List/bolist.pdf
// A five-column table (Town/City, Building Official, Address, Email, Phone)
// whose rows wrap over two or three lines and whose column positions move from
// page to page, so every page's header line sets that page's columns.
//
// WHAT IS KEPT per office: the entry name and any qualifier ("City of Groton"),
// full-time / part-time, the address lines verbatim, the first phone, and an
// email ONLY when its domain ends in .gov or .ct.us — a government domain by
// registration. Gmail, Hotmail, iCloud, a regional council's or a school's
// domain are never kept; neither is a town's .org or .com, because nothing in
// the list proves those are the town's own. The Building Official column is
// never read.
// ALIASES: "Byram … See Greenwich" rows are kept as { name, seeTowns }.
// GARBLED ROWS: when a row's address text carries more than one "CT <zip>"
// line (PDF text from two rows printed over each other) the address is left
// out and the reason recorded — never guessed.
//
// THE CENSUS JOIN. CT towns are Census county subdivisions. An office whose
// name is a current town's name gets that town's GEOID. The rest (City of
// Groton, Groton Long Point, Fenwick …) are sub-town offices, matched at run
// time against the Census incorporated place or CDP at the address.
//
// Run:  bun run scripts/import-ct-building-officials.ts [path/to/bolist.pdf]
// Needs pdftotext (poppler) and network for TIGERweb.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_URL = 'https://portal.ct.gov/-/media/DAS/OEDM/BO-List/bolist.pdf';
const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/1/query'
  + "?where=STATE%3D%2709%27&outFields=GEOID,NAME,BASENAME&returnGeometry=false&resultRecordCount=2000&f=json";
const OUT = 'utils/generated/ctBuildingOfficials.json';

/** Entry names the list misspells, each proven by the entry's OWN address
 *  line: "Lisbson (part time) … Lisbon, CT 06351". */
const NAME_FIXES: Record<string, string> = { Lisbson: 'Lisbon' };

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isGovernmentEmail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return /\.gov$/.test(domain) || /\.ct\.us$/.test(domain);
}

interface Word { text: string; col: number }
interface Columns { bo: number; addr: number; email: number; phone: number }

function words(line: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
  return out;
}

type Zone = 'town' | 'bo' | 'addr' | 'phone';
function zone(col: number, c: Columns): Zone {
  if (col >= c.phone - 2) return 'phone';
  if (col >= c.addr - 2) return 'addr';
  if (col >= c.bo - 2) return 'bo';
  return 'town';
}

interface RawRow { town: string[]; addr: string[]; phoneText: string[]; emails: string[] }

const CT_LINE = /\bCT\b/;
const CT_ZIP_LINE = /\bCT\s*\d{5}/;

function parseRows(text: string): { asOf: string; rows: RawRow[] } {
  const asOfM = text.match(/as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!asOfM) throw new Error('list header "as of MM/DD/YYYY" not found');
  const asOf = `${asOfM[3]}-${asOfM[1].padStart(2, '0')}-${asOfM[2].padStart(2, '0')}`;

  const rows: RawRow[] = [];
  let cols: Columns | null = null;
  let cur: RawRow | null = null;
  let pending: RawRow | null = null; // address text that precedes its town line (the Trumbull row)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, ''); // pdftotext opens each page with a form feed
    if (/^Town\/City\s/.test(line)) {
      cols = { bo: line.indexOf('Building Official'), addr: line.indexOf('Address'), email: line.indexOf('Email'), phone: line.indexOf('Phone') };
      continue;
    }
    if (!cols || !line.trim()) continue;
    if (/^Page \d+/.test(line) || /PLEASE EMAIL ALL UPDATES/i.test(line)) continue;

    const ws = words(line);
    // An official's name can start a character or two left of its column
    // ("Colebrook (part time) William …"): on a row's first line the town
    // text ends at the staffing parenthesis.
    const town = ws.filter((w) => zone(w.col, cols!) === 'town').map((w) => w.text).join(' ')
      .replace(/^([^(]*\((?:full\s*time|fulltime|part\s*time)\)).*$/i, '$1');
    const addr = ws.filter((w) => { const z = zone(w.col, cols!); return (z === 'addr') && !w.text.includes('@'); }).map((w) => w.text).join(' ');
    const bo = ws.some((w) => zone(w.col, cols!) === 'bo');
    const phone = ws.filter((w) => zone(w.col, cols!) === 'phone' && !w.text.includes('@')).map((w) => w.text).join(' ');
    const emails = ws.filter((w) => w.text.includes('@')).map((w) => w.text.replace(/[.,;]+$/, ''));

    const startsRecord = /^\S/.test(line) && town && !/^\(/.test(town) && !/^time\)/.test(town);
    if (startsRecord) {
      if (cur) rows.push(cur);
      cur = pending ?? { town: [], addr: [], phoneText: [], emails: [] };
      pending = null;
      cur.town.push(town);
    } else if (cur && town) {
      cur.town.push(town);
    } else if (cur && !town && bo && addr && cur.addr.some((a) => CT_LINE.test(a)) && !/^See\b/.test(cur.addr[0] ?? '')) {
      // The current row's address is already complete ("…, CT 06xxx"), yet a
      // line with an official's name and an address but no town follows: it
      // opens the NEXT row, whose town line comes after it (the Trumbull row).
      pending = pending ?? { town: [], addr: [], phoneText: [], emails: [] };
      if (addr) pending.addr.push(addr);
      if (phone) pending.phoneText.push(phone);
      pending.emails.push(...emails);
      continue;
    }
    if (!cur) continue;
    const target = cur;
    if (addr) target.addr.push(addr);
    if (phone) target.phoneText.push(phone);
    target.emails.push(...emails);
  }
  if (cur) rows.push(cur);
  return { asOf, rows };
}

interface Office {
  id: string;
  name: string;
  qualifier: string | null;
  staffing: 'full time' | 'part time' | null;
  censusGeoid: string | null;
  address: string[];
  addressOmitted: string | null;
  phone: string | null;
  email: string | null;
}
interface Alias { name: string; seeTowns: string[] }

function slug(s: string): string {
  return norm(s).replace(/ /g, '-');
}

function main2(text: string, towns: { GEOID: string; BASENAME: string }[]) {
  const { asOf, rows } = parseRows(text);
  const townByName = new Map(towns.map((t) => [norm(t.BASENAME), t]));
  const offices: Office[] = [];
  const aliases: Alias[] = [];
  for (const r of rows) {
    const townText = collapse(r.town.join(' '));
    const staffing = /\(full\s*time\)|\(fulltime\)/i.test(townText) ? 'full time' : /\(part\s*time\)/i.test(townText) ? 'part time' : null;
    const quals = [...townText.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()).filter((q) => !/^(full\s*time|fulltime|part\s*time)$/i.test(q));
    let name = collapse(townText.replace(/\([^)]*\)/g, ' ').replace(/\(part\b|\btime\)/gi, ' '));
    name = NAME_FIXES[name] ?? name;
    const addrText = collapse(r.addr.join(' '));
    if (/^See\b/.test(addrText)) {
      const seeTowns = addrText.replace(/^See\s+/, '').split(/\s+and\s+/)
        .map((s) => s.replace(/[“”"]/g, '').replace(/^Town of\s+/i, '').trim()).filter(Boolean);
      aliases.push({ name, seeTowns });
      continue;
    }
    const phoneM = collapse(r.phoneText.join(' ')).match(/\(?\d{3}\)?[\s-]\d{3}-\d{4}(?:\s*(?:x|X|Ext\.?|ext\.?)\s*\d+)?/);
    const email = r.emails.find(isGovernmentEmail) ?? null;
    const garbled = r.addr.filter((a) => CT_ZIP_LINE.test(a)).length > 1;
    const qualifier = quals[0] ?? null;
    const town = townByName.get(norm(name));
    const isTownOffice = !!town && (!qualifier || /^Town of /i.test(qualifier));
    offices.push({
      id: slug(qualifier && !/^Town of /i.test(qualifier) ? qualifier : name),
      name,
      qualifier,
      staffing,
      censusGeoid: isTownOffice ? town!.GEOID : null,
      address: garbled ? [] : r.addr.map(collapse),
      addressOmitted: garbled ? 'the list prints two rows over each other here, so the address text is unreadable' : null,
      phone: phoneM ? collapse(phoneM[0]) : null,
      email,
    });
  }
  return { asOf, rows: rows.length, offices, aliases };
}

async function main() {
  const arg = process.argv[2];
  let pdf = arg;
  if (!pdf) {
    const dir = mkdtempSync(join(tmpdir(), 'ct-bolist-'));
    pdf = join(dir, 'bolist.pdf');
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  }
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tiger = await fetch(TIGER_URL).then((r) => r.json()) as { features: { attributes: { GEOID: string; NAME: string; BASENAME: string } }[] };
  const towns = tiger.features.map((f) => f.attributes).filter((t) => !/not defined/i.test(t.NAME));
  const { asOf, rows, offices, aliases } = main2(text, towns);

  const ids = new Set<string>();
  for (const o of offices) { if (ids.has(o.id)) throw new Error(`duplicate office id ${o.id}`); ids.add(o.id); }
  const officeNames = new Set(offices.map((o) => norm(o.name)));
  for (const a of aliases) for (const t of a.seeTowns) if (!officeNames.has(norm(t))) throw new Error(`alias ${a.name} → ${t} names no office`);

  const covered = new Set(offices.map((o) => o.censusGeoid).filter(Boolean));
  const townsWithoutOffice = towns.filter((t) => !covered.has(t.GEOID)).map((t) => t.BASENAME).sort();
  const doc = {
    source: 'CT Department of Administrative Services — List of Connecticut Municipal Building Officials',
    sourceUrl: SOURCE_URL,
    asOf,
    checkedOn: new Date().toISOString().slice(0, 10),
    joinSource: 'US Census TIGERweb current county subdivisions (Places_CouSub_ConCity_SubMCD/MapServer/1)',
    listEntries: rows,
    offices,
    aliases,
    townsWithoutOffice,
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`CT list as of ${asOf}: ${rows} entries = ${offices.length} offices + ${aliases.length} aliases; ${covered.size} of ${towns.length} towns joined`);
  console.log(`  towns with no office row: ${townsWithoutOffice.join(', ') || 'none'}`);
  console.log(`  sub-town offices: ${offices.filter((o) => !o.censusGeoid).map((o) => o.id).join(', ')}`);
  console.log(`  address omitted: ${offices.filter((o) => o.addressOmitted).map((o) => o.id).join(', ') || 'none'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
