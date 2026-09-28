// scripts/validate-i18n-hermes.ts — run the i18n layer under the REAL Hermes
// binary this app ships (RN 0.81) and compare against goldens.
//
// Why: jest and validate-i18n run on Node's ICU, which cannot see iOS. Hermes
// has no Intl.PluralRules, Apple's NumberFormatter rounds half-to-even, and
// es-* Intl output differs from browsers. The i18n layer is built to avoid all
// three (own plural rules, integer-cent rounding, own Spanish date tables);
// this proves it on the engine that matters.
//
// How: `bun build --target=browser` bundles a tiny entry that imports the pure
// i18n modules into one IIFE, then `hermes` runs it and prints JSON, which is
// compared to the same goldens computed under bun (and to fixed strings).
//
// Run: bun run test:i18n-hermes. Skips (exit 0, loudly) when the Hermes binary
// is missing — non-Mac CI.

import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERMES = join(ROOT, 'node_modules/react-native/sdks/hermesc/osx-bin/hermes');

if (!existsSync(HERMES)) {
  console.warn(`! validate-i18n-hermes SKIPPED: no Hermes binary at ${HERMES} (non-Mac host). Run on a Mac before a release.`);
  process.exit(0);
}

// The probe: plain values only, so the same code runs under bun and Hermes.
const PROBE = `
import { t, tn, setLang } from '${ROOT}/i18n/core';
import { pluralCategory } from '${ROOT}/i18n/plural';
import { pseudoize } from '${ROOT}/i18n/pseudo';
import { fnv1a32 } from '${ROOT}/i18n/hash';
import { formatDateL, formatDateOptsL, formatTimeL, formatMoneyCentsL, formatCalendarDayL, formatRelativeL } from '${ROOT}/i18n/format';

const d = new Date(2026, 8, 27, 15, 5);
const now = new Date(2026, 8, 27, 14, 0).getTime();
const forms = { one: '{count} open item', other: '{count} open items' };
const out = {
  pluralRulesPresent: typeof Intl.PluralRules !== 'undefined',
  plural: [0, 1, 2, 5, 1000000, 2000000, 1000001, -1].map((n) => pluralCategory('es', n) + '/' + pluralCategory('en', n)),
  tEs: t('field.dfr.weather', 'Weather', undefined, 'es'),
  tEn: t('field.dfr.weather', 'Weather', undefined, 'en'),
  tnEs: [0, 1, 3, 1000000].map((n) => tn('field.punch.openCount', n, forms, undefined, 'es')),
  tnEn: [0, 1, 3].map((n) => tn('field.punch.openCount', n, forms, undefined, 'en')),
  pseudo: pseudoize('Assigned to {name}'),
  hash: fnv1a32('Daily Report — ñ'),
  esDates: ['day', 'dayYear', 'weekdayDay', 'long', 'monthYear', 'weekday'].map((s) => formatDateL(d, s as never, 'es')),
  esNumeric: formatDateOptsL(d, { month: 'numeric', day: 'numeric', year: 'numeric' }, 'es'),
  esTz: formatDateOptsL(Date.UTC(2026, 8, 27, 2), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }, 'es'),
  esTime: [formatTimeL(d, 'es'), formatTimeL(new Date(2026, 8, 27, 0, 7), 'es'), formatTimeL(new Date(2026, 8, 27, 12, 0), 'es')],
  esCal: formatCalendarDayL('2026-09-27', undefined, 'es'),
  esRel: [10000, 300000, 7200000, 108000000, 259200000].map((ms) => formatRelativeL(new Date(now - ms).toISOString(), now, 'es')),
  cents: [123450, 123449, -150, 0, 123456789, 250, -250].map((c) => formatMoneyCentsL(c, 'es', { decimals: 0 }) + '|' + formatMoneyCentsL(c, 'en')),
};
setLang('es');
(out as Record<string, unknown>).moduleLang = t('field.dfr.weather', 'Weather');
const print0 = (globalThis as { print?: (s: string) => void }).print;
if (print0) print0(JSON.stringify(out)); else console.log(JSON.stringify(out));
`;

const GOLDEN = {
  plural: ['other/other', 'one/one', 'other/other', 'other/other', 'many/other', 'many/other', 'other/other', 'one/other'],
  tEs: 'Clima',
  tEn: 'Weather',
  tnEs: ['0 pendientes abiertos', '1 pendiente abierto', '3 pendientes abiertos', '1000000 pendientes abiertos'],
  tnEn: ['0 open items', '1 open item', '3 open items'],
  esDates: ['27 sept', '27 sept 2026', 'dom 27 sept', 'domingo, 27 de septiembre de 2026', 'septiembre de 2026', 'domingo'],
  esNumeric: '27 sept 2026',
  esTz: 'sáb 26 sept',
  esTime: ['3:05 p.m.', '12:07 a.m.', '12:00 p.m.'],
  esCal: '27 sept 2026',
  esRel: ['ahora mismo', 'hace 5 min', 'hace 2 h', 'ayer', 'hace 3 días'],
  // Integer-cent rounding: 123450 → $1,235 on Hermes too (Apple's half-even would give $1,234).
  cents: ['$1,235|$1,234.50', '$1,234|$1,234.49', '-$2|-$1.50', '$0|$0.00', '$1,234,568|$1,234,567.89', '$3|$2.50', '-$3|-$2.50'],
  moduleLang: 'Clima',
};

const dir = mkdtempSync(join(tmpdir(), 'i18n-hermes-'));
let failures = 0;
try {
  const entry = join(dir, 'probe.ts');
  const bundle = join(dir, 'probe.js');
  writeFileSync(entry, PROBE);
  const b = spawnSync('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${bundle}`], { encoding: 'utf8' });
  if (b.status !== 0) {
    console.error('✗ bun build failed\n' + b.stderr + b.stdout);
    process.exit(1);
  }
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
    if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
    return JSON.parse(r.stdout.trim().split('\n').pop() as string) as Record<string, unknown>;
  };
  const hermes = run(HERMES, [bundle]);
  const bunOut = run('bun', [bundle]);

  const check = (label: string, cond: boolean, detail?: string) => {
    if (cond) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
  };
  console.log(`Hermes: ${HERMES}`);
  check('Hermes has no Intl.PluralRules (the reason plural.ts exists)', hermes.pluralRulesPresent === false, `present=${hermes.pluralRulesPresent}`);
  for (const [k, want] of Object.entries(GOLDEN)) {
    check(`hermes ${k}`, JSON.stringify(hermes[k]) === JSON.stringify(want), `got ${JSON.stringify(hermes[k])}\n      want ${JSON.stringify(want)}`);
  }
  for (const k of ['pseudo', 'hash', ...Object.keys(GOLDEN)]) {
    check(`hermes ≡ bun: ${k}`, JSON.stringify(hermes[k]) === JSON.stringify(bunOut[k]), `hermes ${JSON.stringify(hermes[k])}\n      bun    ${JSON.stringify(bunOut[k])}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${failures ? '✗' : '✓'} validate-i18n-hermes: ${failures} failed`);
process.exit(failures ? 1 : 0);
