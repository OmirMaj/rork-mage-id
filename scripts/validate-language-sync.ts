// validate-language-sync.ts — the account copy of the app language
// (docs/I18N.md §5; wave-next lane I18NWIRE).
//
// A foreman who picks Spanish on one phone must get Spanish on the next. The
// choice lives on profiles.preferred_language; components/LanguageProfileSync.tsx
// moves it, and every decision it makes lives in the pure
// utils/languageSyncCore.ts. This pins:
//   1. decideOnSignIn — the server value wins and is copied to local; NULL keeps
//      the device's choice and writes nothing; a missing column (migration not
//      applied) or a failed read does nothing; a tap made while the read was in
//      flight beats the (older) row;
//   2. serverLanguageFromRead — PostgREST 42703 / PGRST204 are "missing column",
//      anything else that errors is "unavailable", a stored value other than
//      the two exact codes is "not told us";
//   3. decideOnChange — ONE column ({ id, preferred_language }), never 'xx',
//      never signed out, never before the column exists;
//   4. source pins: the Sync's only write names id + preferred_language through
//      supabaseWrite (never ProjectContext.updateSettings, never a direct
//      .update()); its only read selects that one column; the pseudo-locale and
//      the account apply never notify the write path; LanguageProvider sits
//      above AuthProvider and the Sync below it in app/_layout.tsx;
//   5. the migration: four nullable text columns with an en/es CHECK;
//   6. the picker gate: while LANGUAGE_PICKER_ENABLED is false the sync is
//      inert in BOTH directions (no read, no apply, no write), so a dev build
//      talking to the production database can never put Spanish on an
//      account that production, with the picker hidden, could not undo.
//
// Run via: bun run scripts/validate-language-sync.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideOnChange, decideOnSignIn, isMissingColumnError, serverLanguageFromRead,
  type ChangeInput, type SignInInput,
} from '../utils/languageSyncCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped (block, JSX-block and line comments). */
const code = (p: string) => read(p)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

// ── 1. decideOnSignIn ──────────────────────────────────────────────────────
console.log('\n1. sign-in: the account wins; NULL, a missing column or a failed read change nothing');
{
  const si = (server: unknown, lang: 'en' | 'es' = 'en', explicit = false): SignInInput => ({ pickerEnabled: true, server, local: { lang, explicit } });
  eq('server es, device en → apply es, no write', decideOnSignIn(si('es', 'en')), { apply: 'es', write: false });
  eq('server en, device es → apply en (the account beats the device)', decideOnSignIn(si('en', 'es')), { apply: 'en', write: false });
  eq('server es, device es → apply es (source becomes the account)', decideOnSignIn(si('es', 'es')), { apply: 'es', write: false });
  eq('server NULL → keep the device, write nothing', decideOnSignIn(si(null, 'es')), {});
  eq("'missing_column' (migration not applied) → nothing", decideOnSignIn(si('missing_column', 'es')), {});
  eq("'unavailable' (offline / error) → nothing", decideOnSignIn(si('unavailable', 'es')), {});
  for (const junk of ['ES', 'es-MX', 'xx', 'spanish', '', 42, undefined, {}, ['es']]) {
    eq(`server ${JSON.stringify(junk)} is never guessed → nothing`, decideOnSignIn(si(junk, 'en')), {});
  }
  eq('a tap made while the read was in flight beats the older row', decideOnSignIn(si('en', 'es', true)), {});
  eq('…even when the row agrees (nothing to do)', decideOnSignIn(si('es', 'es', true)), {});
  const outcomes = ['es', 'en', null, 'missing_column', 'unavailable', 'xx'].flatMap((s) => [true, false].map((x) => decideOnSignIn(si(s, 'en', x))));
  ok('the sign-in path never writes (write is absent or false in every case)', outcomes.every((d) => d.write === undefined || d.write === false));
}

// ── 2. serverLanguageFromRead / isMissingColumnError ──────────────────────
console.log('\n2. reading the row: missing column vs unavailable vs not told us');
{
  eq("row 'es' → 'es'", serverLanguageFromRead({ data: { preferred_language: 'es' }, error: null }), 'es');
  eq("row 'en' → 'en'", serverLanguageFromRead({ data: { preferred_language: 'en' }, error: null }), 'en');
  eq('row NULL → null (not told us)', serverLanguageFromRead({ data: { preferred_language: null }, error: null }), null);
  eq('no profile row (maybeSingle → data null) → null', serverLanguageFromRead({ data: null, error: null }), null);
  eq("row 'xx' → null (the pseudo-locale is not a language)", serverLanguageFromRead({ data: { preferred_language: 'xx' } }), null);
  eq("row 'ES' → null (strict, never guessed)", serverLanguageFromRead({ data: { preferred_language: 'ES' } }), null);
  eq('Postgres 42703 → missing_column', serverLanguageFromRead({ data: null, error: { code: '42703', message: 'column profiles.preferred_language does not exist' } }), 'missing_column');
  eq('PostgREST PGRST204 → missing_column', serverLanguageFromRead({ data: null, error: { code: 'PGRST204', message: "Could not find the 'preferred_language' column" } }), 'missing_column');
  eq('PGRST204 with no message → missing_column (the code alone decides)', serverLanguageFromRead({ data: null, error: { code: 'PGRST204', message: '' } }), 'missing_column');
  eq('42703 with no message → missing_column', serverLanguageFromRead({ data: null, error: { code: '42703' } }), 'missing_column');
  eq('no code, but the message names the missing column → missing_column', serverLanguageFromRead({ error: { message: 'column profiles.preferred_language does not exist' } }), 'missing_column');
  eq('a network failure → unavailable', serverLanguageFromRead({ data: null, error: { message: 'TypeError: Failed to fetch' } }), 'unavailable');
  eq('a permission error → unavailable', serverLanguageFromRead({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } }), 'unavailable');
  eq('no result at all → unavailable', serverLanguageFromRead(undefined), 'unavailable');
  ok('isMissingColumnError(null) is false', !isMissingColumnError(null) && !isMissingColumnError(undefined));
  ok('an unrelated "does not exist" is not our column', !isMissingColumnError({ message: 'relation "public.profilez" does not exist' }));
}

// ── 3. decideOnChange ─────────────────────────────────────────────────────
console.log('\n3. an explicit choice: one column, never xx, never signed out');
{
  const base: ChangeInput = { pickerEnabled: true, userId: 'u-1', supabaseConfigured: true, lang: 'es' };
  const d = decideOnChange(base);
  eq('signed in + configured + es → write { id, preferred_language }', d, { write: true, row: { id: 'u-1', preferred_language: 'es' } });
  ok('the row names ONLY id and preferred_language', d.write === true && JSON.stringify(Object.keys(d.row).sort()) === '["id","preferred_language"]');
  eq('en is written too (English is a choice, not an absence)', decideOnChange({ ...base, lang: 'en' }), { write: true, row: { id: 'u-1', preferred_language: 'en' } });
  eq("'xx' is never written", decideOnChange({ ...base, lang: 'xx' }), { write: false, reason: 'not_a_language' });
  for (const junk of ['fr', 'ES', 'es-MX', '', null, undefined, 1]) {
    eq(`${JSON.stringify(junk)} is never written`, decideOnChange({ ...base, lang: junk }), { write: false, reason: 'not_a_language' });
  }
  eq('signed out → skip', decideOnChange({ ...base, userId: null }), { write: false, reason: 'signed_out' });
  eq('blank user id → skip', decideOnChange({ ...base, userId: '   ' }), { write: false, reason: 'signed_out' });
  eq('Supabase not configured → skip', decideOnChange({ ...base, supabaseConfigured: false }), { write: false, reason: 'not_configured' });
  eq('the column is known missing → skip (the write would sit in the queue)', decideOnChange({ ...base, columnMissing: true }), { write: false, reason: 'column_missing' });
  eq("'xx' is refused before anything but the picker gate", decideOnChange({ pickerEnabled: true, userId: null, supabaseConfigured: false, lang: 'xx', columnMissing: true }), { write: false, reason: 'not_a_language' });
}

// ── 4. Source pins ────────────────────────────────────────────────────────
console.log('\n4. the component, the context and the layout');
{
  const sync = code('components/LanguageProfileSync.tsx');
  const writes = [...sync.matchAll(/supabaseWrite(?:Detailed)?\(([\s\S]*?)\)(?:\.|;)/g)];
  ok('the Sync makes exactly one supabaseWrite call', writes.length === 1, String(writes.length));
  ok("…to profiles, as an update naming only id and preferred_language",
    /supabaseWrite\('profiles', 'update', \{\s*id: decision\.row\.id,\s*preferred_language: decision\.row\.preferred_language,\s*\}\)/.test(sync));
  ok('…gated on decideOnChange (which refuses xx)', /const decision = decideOnChange\(\{[\s\S]*?lang: chosen,[\s\S]*?\}\);\s*if \(!decision\.write\) return;/.test(sync));
  ok('the Sync never writes through ProjectContext.updateSettings', !/updateSettings|useProjectActions|useCoreData/.test(sync));
  ok('the Sync never calls .update / .insert / .upsert / .delete directly', !/\.(update|insert|upsert|delete)\(/.test(sync));
  const selects = [...sync.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
  ok("its only read selects the one column ('preferred_language')", selects.length === 1 && selects[0] === "'preferred_language'", selects.join(' | '));
  ok('…for the signed-in user, tolerating a missing row (maybeSingle)', /\.from\('profiles'\)\s*\.select\('preferred_language'\)\s*\.eq\('id', userId\)\s*\.maybeSingle\(\)/.test(sync));
  ok('…classified by serverLanguageFromRead and decided by decideOnSignIn', /serverLanguageFromRead\(result\)/.test(sync) && /decideOnSignIn\(\{/.test(sync));
  ok('the read is wrapped (a thrown fetch becomes "unavailable", never a crash)', /try \{[\s\S]*?\.maybeSingle\(\);[\s\S]*?\} catch \{\s*server = 'unavailable';/.test(sync));
  ok('the account value is applied through applyAccountLanguage (source "account")', /applyRef\.current\(decision\.apply\)/.test(sync));
  ok('the Sync subscribes to explicit choices only (subscribeUserChoice)', /subscribeUserChoice\(/.test(sync) && !/subscribe\(\s*\(/.test(sync.replace(/subscribeUserChoice\(/g, '')));
  ok('the Sync renders nothing', /return null;\s*\}\s*(export default|$)/.test(sync));

  const ctx = code('contexts/LanguageContext.tsx');
  const notifies = [...ctx.matchAll(/notifyUserChoice\(/g)].length;
  ok('LanguageContext notifies the write path from exactly the two setLanguage bodies (+ its definition)', notifies === 3, String(notifies));
  const body = (name: string) => {
    // From `const <name> = useCallback(` to the next provider-level `const`.
    const i = ctx.indexOf(`const ${name} = useCallback(`);
    if (i < 0) return '';
    const j = ctx.indexOf('\n  const ', i + 1);
    return j < 0 ? '' : ctx.slice(i, j);
  };
  const setLanguageBody = body('setLanguage');
  const applyBody = body('applyAccountLanguage');
  const pseudoBody = body('setPseudo');
  ok('setLanguage writes local FIRST, then notifies', setLanguageBody.indexOf('writeStoredLanguage(next)') > -1
    && setLanguageBody.indexOf('writeStoredLanguage(next)') < setLanguageBody.indexOf('notifyUserChoice(next)'));
  ok('setLanguage refuses anything but en / es', /if \(next !== 'en' && next !== 'es'\) return;/.test(setLanguageBody));
  ok('applyAccountLanguage never notifies the write path (the account value is not written back)', applyBody.length > 0 && !/notifyUserChoice/.test(applyBody));
  ok('applyAccountLanguage refuses anything but en / es, and marks source "account"', /if \(next !== 'en' && next !== 'es'\) return;/.test(applyBody) && /setSource\('account'\)/.test(applyBody));
  ok("the pseudo-locale is never stored or written (setPseudo has no writeStoredLanguage / notifyUserChoice)",
    pseudoBody.length > 0 && !/writeStoredLanguage|notifyUserChoice/.test(pseudoBody));
  ok('the fallback (outside the provider) setPseudo does not store either', /setPseudo: \(on\) => setLang\(on \? 'xx' : 'en'\),/.test(ctx));
  ok('the hydration effect never notifies the write path', (() => {
    const i = ctx.indexOf('const stored = await readStoredLanguage();');
    const j = ctx.indexOf('setReady(true);', i);
    return i > 0 && j > i && !/notifyUserChoice/.test(ctx.slice(i, j));
  })());
  ok('the "Not built yet" note is gone from the LanguageContext header', !/Not built yet/.test(read('contexts/LanguageContext.tsx')));

  const layout = code('app/_layout.tsx');
  const at = (s: string) => layout.indexOf(s);
  const theme = at('<ThemeProvider>'), themeEnd = at('</ThemeProvider>');
  const lang = at('<LanguageProvider>'), langEnd = at('</LanguageProvider>');
  const auth = at('<AuthProvider>'), authEnd = at('</AuthProvider>');
  const syncAt = at('<LanguageProfileSync />');
  ok('app/_layout.tsx: LanguageProvider sits inside ThemeProvider', theme > -1 && theme < lang && langEnd < themeEnd);
  ok('…and ABOVE AuthProvider (sign-in and sign-up render in the chosen language)', lang > -1 && lang < auth && authEnd < langEnd);
  ok('…the Sync is mounted once, under AuthProvider (and so under LanguageProvider)',
    syncAt > auth && syncAt < authEnd && layout.split('<LanguageProfileSync />').length === 2);
  ok('…next to OfflineSyncManager', /<OfflineSyncManager \/>\s*<LanguageProfileSync \/>/.test(layout));
  ok('the ErrorBoundary fallback never calls useT (it renders outside every provider)', !/useT\(/.test(code('components/ErrorBoundary.tsx')));
}

// ── 5. The migration ──────────────────────────────────────────────────────
console.log('\n5. the preferred_language migration');
{
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_preferred_language\.sql$/.test(f));
  ok('exactly one *_preferred_language.sql migration', files.length === 1, files.join(', '));
  const sql = files[0] ? read(`supabase/migrations/${files[0]}`) : '';
  ok('it sorts after 20260927100000', !!files[0] && files[0].slice(0, 14) > '20260927100000', files[0]);
  for (const t of ['profiles', 'subcontractors', 'crew_members', 'contacts']) {
    ok(`${t}: add column if not exists preferred_language text (nullable, no default)`,
      new RegExp(`alter table public\\.${t}\\s+add column if not exists preferred_language text;`).test(sql));
    ok(`${t}: an idempotent CHECK (null or en / es)`,
      new RegExp(`conname = '${t}_preferred_language_check'[\\s\\S]*?alter table public\\.${t}\\s+add constraint ${t}_preferred_language_check\\s+check \\(preferred_language is null or preferred_language in \\('en', 'es'\\)\\);`).test(sql));
  }
  const body = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  ok('no default, no NOT NULL, no policy, no grant', !/\bdefault\b|not null|create policy|\bgrant\b/i.test(body));
  ok('the header orders it BEFORE the OTA carrying LanguageProfileSync', /APPLY THIS MIGRATION BEFORE THE OTA THAT CONTAINS/.test(sql) && /LanguageProfileSync/.test(sql));
  ok('the header asks for a read-only grants check before and after', /role_table_grants/.test(sql) && /column_privileges/.test(sql));
  ok('it reloads the PostgREST schema cache', /notify pgrst, 'reload schema';\s*$/.test(sql));
}

// ── 6. The picker gate ─────────────────────────────────────────────────────
console.log('\n6. picker hidden: the sync is inert in both directions');
{
  const hidden = [false, undefined, null, 0, 'true', 1] as unknown as boolean[];
  for (const pe of hidden) {
    for (const server of ['es', 'en']) {
      eq(`sign-in, picker ${JSON.stringify(pe)}, server ${server} → nothing applied`,
        decideOnSignIn({ pickerEnabled: pe, server, local: { lang: 'en', explicit: false } }), {});
    }
    for (const lang of ['es', 'en']) {
      eq(`choice ${lang}, picker ${JSON.stringify(pe)} → never written (picker_hidden)`,
        decideOnChange({ pickerEnabled: pe, userId: 'u-1', supabaseConfigured: true, lang }), { write: false, reason: 'picker_hidden' });
    }
  }
  eq('the gate comes first (even before the pseudo-locale refusal)',
    decideOnChange({ pickerEnabled: false, userId: null, supabaseConfigured: false, lang: 'xx', columnMissing: true }), { write: false, reason: 'picker_hidden' });
  eq('picker shown → the account value applies again', decideOnSignIn({ pickerEnabled: true, server: 'es', local: { lang: 'en', explicit: false } }), { apply: 'es', write: false });

  const sync = code('components/LanguageProfileSync.tsx');
  ok('the Sync imports LANGUAGE_PICKER_ENABLED from i18n/flags',
    /import \{ LANGUAGE_PICKER_ENABLED \} from '@\/i18n\/flags';/.test(sync));
  const effects = sync.split('useEffect(').slice(1);
  ok('the Sync has exactly two effects', effects.length === 2, String(effects.length));
  const readEffect = effects.find((e) => e.includes('.maybeSingle()')) ?? '';
  const writeEffect = effects.find((e) => e.includes('supabaseWrite(')) ?? '';
  const gate = 'if (!LANGUAGE_PICKER_ENABLED) return;';
  ok('the sign-in effect returns on the flag BEFORE the read',
    readEffect.indexOf(gate) > -1 && readEffect.indexOf(gate) < readEffect.indexOf(".from('profiles')"));
  ok('…and BEFORE any apply', readEffect.indexOf(gate) > -1 && readEffect.indexOf(gate) < readEffect.indexOf('applyRef.current('));
  ok('the choice listener returns on the flag BEFORE deciding or writing',
    writeEffect.indexOf(gate) > -1 && writeEffect.indexOf(gate) < writeEffect.indexOf('decideOnChange(') && writeEffect.indexOf(gate) < writeEffect.indexOf('supabaseWrite('));
  ok('both decisions are handed the flag too (pickerEnabled: LANGUAGE_PICKER_ENABLED, twice)',
    sync.split('pickerEnabled: LANGUAGE_PICKER_ENABLED,').length === 3);
  ok('the gate is never a hook condition (both useEffect calls stay unconditional)',
    !/if \([^)]*LANGUAGE_PICKER_ENABLED[^)]*\)\s*(\{\s*)?useEffect/.test(sync) && !/LANGUAGE_PICKER_ENABLED\s*&&\s*useEffect/.test(sync));
  const flags = code('i18n/flags.ts');
  ok('i18n/flags.ts: LANGUAGE_PICKER_ENABLED is still false (flipping it is a Phase 1 decision)',
    /export const LANGUAGE_PICKER_ENABLED = false;/.test(flags));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
