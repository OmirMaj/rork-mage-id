// scripts/validate-env-parity.ts — every EXPO_PUBLIC_* the client reads must be
// accounted for on the EAS production + preview build paths. Audit 2026-09-03
// HEALTH-F8: a laptop `expo export` inlined a live OpenWeather key from the
// gitignored .env while EAS-built binaries (and the docs) had no key — two
// behaviours for one runtimeVersion. Parity means every build path agrees on
// which keys exist.
//
// THREE ways a key can be accounted for:
//   1. declared in eas.json for BOTH profiles (value may be empty);
//   2. FALLBACK_SAFE — the code carries a committed, public-by-design default;
//   3. EAS_ENV_MANAGED — supplied as an EAS *environment variable* rather than
//      an eas.json value, because the value is a real credential and this repo
//      is PUBLIC.
//
// (3) was added 2026-09-07. eas.json had declared
// EXPO_PUBLIC_OPENWEATHER_API_KEY as an EMPTY STRING, which EAS rejects at
// schema validation ("not allowed to be empty") — so no production build could
// start at all. Putting the real value in eas.json was not an option: this repo
// is public. The key moved to `eas env:create --environment production/preview`.
//
// An EAS_ENV_MANAGED key must therefore be ABSENT from eas.json (a re-added
// empty string would break every build again, and a re-added real value would
// leak the credential). That is checked below, so this is not a loophole —
// it trades one declaration site for another and pins both.
//
// Pure node:fs. No react-native import.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['app', 'components', 'utils', 'contexts', 'hooks', 'lib', 'constants'];

/** Keys whose absence is safe because the code carries a committed, public-by-design fallback. */
const FALLBACK_SAFE: Record<string, string> = {
  EXPO_PUBLIC_SUPABASE_URL: 'lib/supabase.ts (hard-coded project URL fallback)',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'lib/supabase.ts (hard-coded anon JWT fallback; public by design)',
  EXPO_PUBLIC_POSTHOG_KEY: 'utils/posthog.ts (write-only project key default)',
  EXPO_PUBLIC_POSTHOG_HOST: 'utils/posthog.ts (default host)',
  EXPO_PUBLIC_PROJECT_ID: 'utils/notifications.ts (falls back to app.json extra.eas.projectId)',
};

/**
 * Keys supplied as EAS environment variables (`eas env:list --environment
 * production`) instead of eas.json values, because the value is a credential
 * and this repo is public. Verify with:
 *     eas env:list --environment production
 *     eas env:list --environment preview
 */
const EAS_ENV_MANAGED: Record<string, string> = {
  EXPO_PUBLIC_OPENWEATHER_API_KEY:
    'EAS env var on production+preview (set 2026-09-07). eas.json declared it as "" which fails EAS schema validation and blocked every production build.',
};

let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond || !detail ? '' : `\n      ${detail}`}`);
  if (!cond) failed++;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const reads = new Map<string, Set<string>>();
for (const d of SOURCE_DIRS) {
  for (const f of walk(join(ROOT, d))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) {
      const key = m[1];
      if (!reads.has(key)) reads.set(key, new Set());
      reads.get(key)!.add(relative(ROOT, f));
    }
  }
}

const eas = JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8')) as { build: Record<string, { env?: Record<string, string> }> };
const declared = (profile: string) => new Set(Object.keys(eas.build[profile]?.env ?? {}));
const prod = declared('production');
const prev = declared('preview');

console.log('env parity (EXPO_PUBLIC_* reads vs eas.json):');
ok('at least one EXPO_PUBLIC_* read was found', reads.size > 0);
for (const [key, files] of [...reads.entries()].sort()) {
  const inProd = prod.has(key);
  const inPrev = prev.has(key);
  const safe = key in FALLBACK_SAFE;
  const easManaged = key in EAS_ENV_MANAGED;
  ok(
    `${key} is declared for production+preview, EAS-managed, or has a located fallback`,
    (inProd && inPrev) || safe || easManaged,
    `read in ${[...files].join(', ')}; production=${inProd} preview=${inPrev}`
      + `${safe ? ` fallback: ${FALLBACK_SAFE[key]}` : ''}`
      + `${easManaged ? ` eas-env: ${EAS_ENV_MANAGED[key]}` : ''}`,
  );
}
for (const key of Object.keys(FALLBACK_SAFE)) {
  ok(`FALLBACK_SAFE entry ${key} is still read somewhere (stale allow-list otherwise)`, reads.has(key));
}
for (const key of Object.keys(EAS_ENV_MANAGED)) {
  ok(`EAS_ENV_MANAGED entry ${key} is still read somewhere (stale allow-list otherwise)`, reads.has(key));
  // The whole point: it must NOT be back in eas.json. An empty string there
  // fails EAS schema validation and blocks every build; a real value there
  // leaks a credential into a public repo.
  ok(
    `${key} is NOT re-declared in eas.json (empty breaks every build; real leaks the key)`,
    !prod.has(key) && !prev.has(key),
    `production=${prod.has(key)} preview=${prev.has(key)} — remove it from eas.json and keep it in EAS env`,
  );
}
// A secret must never be an EXPO_PUBLIC_* value: EXPO_PUBLIC_* is inlined into the bundle.
const suspicious = [...reads.keys()].filter(k => /SECRET|SERVICE_ROLE|PRIVATE|WEBHOOK/.test(k));
ok('no EXPO_PUBLIC_* key name looks like a secret', suspicious.length === 0, suspicious.join(', '));

console.log(`\n${failed === 0 ? 'env parity holds' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
