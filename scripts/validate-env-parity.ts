// scripts/validate-env-parity.ts — every EXPO_PUBLIC_* the client reads must be
// declared for the EAS production + preview profiles (value may be empty), or
// have an explicit, located fallback. Audit 2026-09-03 HEALTH-F8: a laptop
// `expo export` inlined a live OpenWeather key from the gitignored .env while
// EAS-built binaries (and the docs) had no key — two behaviours for one
// runtimeVersion. Parity means every build path agrees on which keys exist.
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
  ok(
    `${key} is declared for production+preview or has a located fallback`,
    (inProd && inPrev) || safe,
    `read in ${[...files].join(', ')}; production=${inProd} preview=${inPrev}${safe ? ` fallback: ${FALLBACK_SAFE[key]}` : ''}`,
  );
}
for (const key of Object.keys(FALLBACK_SAFE)) {
  ok(`FALLBACK_SAFE entry ${key} is still read somewhere (stale allow-list otherwise)`, reads.has(key));
}
// A secret must never be an EXPO_PUBLIC_* value: EXPO_PUBLIC_* is inlined into the bundle.
const suspicious = [...reads.keys()].filter(k => /SECRET|SERVICE_ROLE|PRIVATE|WEBHOOK/.test(k));
ok('no EXPO_PUBLIC_* key name looks like a secret', suspicious.length === 0, suspicious.join(', '));

console.log(`\n${failed === 0 ? 'env parity holds' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
