// scripts/validate-crew-language.ts — a crew member's language (wave-next W3, lane ESTICKET).
//
// crew_members.preferred_language (migration 20260928120000) is the language
// of what WE SEND a crew member: texts and invites (docs/I18N.md §9,
// i18n/recipient.ts). This proves the client side of it:
//
//   A. The two pure helpers in contexts/CrewContext.tsx, run AS WRITTEN (their
//      source is cut out of the file and transpiled, so a planted defect in
//      the context turns this red):
//      crewLanguageFromRow — only 'en' / 'es' read as a language; NULL,
//        'es-MX', 'ES', 'spanish' read as not set (never guessed).
//      crewLanguageColumn  — nothing at all while the language row is hidden
//        (LANGUAGE_PICKER_ENABLED false) or when the caller did not pass the
//        key; otherwise 'en' / 'es' as themselves and anything else as NULL
//        (the column's CHECK refuses other values, and a refused write is
//        terminal in the offline queue).
//   B. The wiring: the row mapper reads the column, the insert and the update
//      carry it through crewLanguageColumn(…, LANGUAGE_PICKER_ENABLED), and the
//      flag is false today (so no language is sent and the English screens are
//      unchanged).
//   C. The crew form: the Language row renders nothing while the flag is off,
//      offers Not set / English / Español (endonyms, never translated), saves
//      only a change, and nothing derives a language from a name.
//
// Run: bun run scripts/validate-crew-language.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc checks scripts/ against the app's react-native lib set, which has no Bun
// global; the one API used here is declared rather than pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const ctx = read('contexts/CrewContext.tsx');
const crew = read('app/crew.tsx');
const flags = read('i18n/flags.ts');

/** Cut `export function <name>(…) { … }` out of a source file. The body opens
 *  at the first `{` that ends a line (an inline object return type never
 *  does) and closes at its matching brace. */
function cutFunction(src: string, name: string): string {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) return '';
  const open = src.indexOf('{\n', at);
  let depth = 0;
  let j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at, j + 1).replace(/^export /, '');
}

function load<T>(name: string): T | null {
  const code = cutFunction(ctx, name);
  if (!code) return null;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${code}\nexport default ${name};`);
  const body = js.replace(/export default ([A-Za-z]+);?\s*$/, 'return $1;');
  try {
    return new Function(body)() as T;
  } catch (e) {
    console.error(e);
    return null;
  }
}

console.log('\nA. the pure helpers, run as written in contexts/CrewContext.tsx');
type FromRow = (v: unknown) => 'en' | 'es' | null;
type Column = (m: { preferredLanguage?: unknown }, enabled: boolean) => { preferred_language: unknown } | undefined;
const fromRow = load<FromRow>('crewLanguageFromRow');
const column = load<Column>('crewLanguageColumn');
ok('crewLanguageFromRow is defined in CrewContext', typeof fromRow === 'function');
ok('crewLanguageColumn is defined in CrewContext', typeof column === 'function');
if (fromRow) {
  ok("'en' reads as English", fromRow('en') === 'en');
  ok("'es' reads as Spanish", fromRow('es') === 'es');
  ok('NULL stays not set (null)', fromRow(null) === null);
  ok('a missing column is not set (null)', fromRow(undefined) === null);
  for (const v of ['es-MX', 'ES', 'spanish', 'Español', 'xx', 'fr', '', 1, true]) {
    ok(`${JSON.stringify(v)} is not guessed into a language`, fromRow(v) === null, fromRow(v));
  }
}
if (column) {
  ok('flag off: nothing is sent, even with a language set', column({ preferredLanguage: 'es' }, false) === undefined);
  ok('flag off: nothing is sent for a clear', column({ preferredLanguage: null }, false) === undefined);
  ok('flag on, key not passed (a name-only edit): nothing is sent', column({}, true) === undefined);
  ok("flag on: 'es' goes as 'es'", JSON.stringify(column({ preferredLanguage: 'es' }, true)) === '{"preferred_language":"es"}');
  ok("flag on: 'en' goes as 'en'", JSON.stringify(column({ preferredLanguage: 'en' }, true)) === '{"preferred_language":"en"}');
  ok('flag on: Not set goes as NULL', JSON.stringify(column({ preferredLanguage: null }, true)) === '{"preferred_language":null}');
  ok('flag on: a key passed as undefined (a clear) goes as NULL', JSON.stringify(column({ preferredLanguage: undefined }, true)) === '{"preferred_language":null}');
  for (const v of ['es-MX', 'fr', 'xx', 'ES', '']) {
    ok(`flag on: ${JSON.stringify(v)} is never sent as itself (NULL; the CHECK would refuse it)`, JSON.stringify(column({ preferredLanguage: v }, true)) === '{"preferred_language":null}', column({ preferredLanguage: v }, true));
  }
}

console.log('\nB. the context wiring');
const mapRow = ctx.slice(ctx.indexOf('function mapRow('), ctx.indexOf('function toRow('));
const toRow = ctx.slice(ctx.indexOf('function toRow('), ctx.indexOf('export const [CrewProvider'));
const upd = ctx.slice(ctx.indexOf('const updateCrewMember = useCallback('), ctx.indexOf('const deleteCrewMember = useCallback('));
ok('the row mapper reads preferred_language through crewLanguageFromRow', /preferredLanguage: crewLanguageFromRow\(r\.preferred_language\),/.test(mapRow));
ok('the insert row carries it only through crewLanguageColumn(m, LANGUAGE_PICKER_ENABLED)',
  /\.\.\.crewLanguageColumn\(m, LANGUAGE_PICKER_ENABLED\),/.test(toRow) && !/preferred_language:/.test(toRow));
ok('the update carries it only through crewLanguageColumn(changes, LANGUAGE_PICKER_ENABLED), in the same queued write',
  /supabaseWrite\('crew_members', 'update', \{ \.\.\.crewMemberUpdateRow\(id, changes, next\.updatedAt\), \.\.\.crewLanguageColumn\(changes, LANGUAGE_PICKER_ENABLED\) \}\)/.test(upd)
  && (upd.match(/supabaseWrite\(/g) ?? []).length === 1);
ok('the flag comes from i18n/flags', /import \{ LANGUAGE_PICKER_ENABLED \} from '@\/i18n\/flags';/.test(ctx));
ok('LANGUAGE_PICKER_ENABLED is false today (no language is sent; English screens unchanged)', /export const LANGUAGE_PICKER_ENABLED = false;/.test(flags));

console.log('\nC. the crew form');
const rowFn = crew.slice(crew.indexOf('export function CrewLanguageRow('), crew.indexOf('/** Tells a desktop register'));
ok('CrewLanguageRow renders nothing while the flag is off (its first statement after the hook)',
  /const \{ t \} = useT\(\);\s*const styles = useThemedStyles\(makeStyles\);\s*if \(!LANGUAGE_PICKER_ENABLED\) return null;/.test(rowFn));
ok('it offers Not Set (null), English and Español', /\{ value: null, label: t\('field\.crew\.language\.notSet', 'Not Set'\)/.test(rowFn)
  && /\{ value: 'en', label: 'English'/.test(rowFn) && /\{ value: 'es', label: 'Español'/.test(rowFn));
ok('the endonyms are kept as themselves (i18n-keep-english), never translated',
  (rowFn.match(/\/\/ i18n-keep-english: an endonym/g) ?? []).length === 2);
ok('its hint says what the language is for', /t\('field\.crew\.language\.hint', 'Used for texts and invites we send them\.'\)/.test(rowFn));
ok('the edit form and the add sheet both mount it', /<CrewLanguageRow value=\{editLang\}/.test(crew) && /<CrewLanguageRow value=\{newLang\}/.test(crew));
ok('the editor is seeded from the member (NULL stays Not set)', /setEditLang\(member\.preferredLanguage \?\? null\);/.test(crew));
ok('a save sends the language only with the flag on and only when it moved',
  /if \(LANGUAGE_PICKER_ENABLED && editLang !== \(member\.preferredLanguage \?\? null\)\) changes\.preferredLanguage = editLang;/.test(crew));
ok('a new member carries a language only with the flag on and one chosen',
  /\.\.\.\(LANGUAGE_PICKER_ENABLED && newLang \? \{ preferredLanguage: newLang \} : \{\}\),/.test(crew));
ok('nothing derives a language from a name', !/preferredLanguage[^\n]*fullName|fullName[^\n]*preferredLanguage/.test(crew + ctx));

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-crew-language: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
