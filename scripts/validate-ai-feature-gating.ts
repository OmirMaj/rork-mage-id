// scripts/validate-ai-feature-gating.ts — drift guard for the server-side
// per-feature tier gate in the `ai` text relay.
//
// The relay (supabase/functions/ai/index.ts) holds FEATURE_MIN_RANK: an
// allowlist of text-AI features that require a minimum subscription tier. It is
// a SECOND source of truth alongside FEATURE_CONFIG.proOnly (aiRateLimiterCore)
// and useTierAccess. The danger: someone adds a new Pro-only TEXT feature to
// FEATURE_CONFIG but forgets the relay → the client paywalls while the server
// stays open, re-introducing the exact bypass this gate was added to close.
//
// This validator fails if:
//  1. The relay's FEATURE_MIN_RANK doesn't match the canonical expected map.
//  2. A FEATURE_CONFIG entry is proOnly, is NOT a vision feature (those run
//     through their own edge functions, not this text relay), and is MISSING
//     from the relay map.
//  3. A relay-map key isn't a recognised feature id.
import { readFileSync } from 'node:fs';
import { FEATURE_CONFIG, type AIFeature } from '../utils/aiRateLimiterCore';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}

// The canonical set of text-relay features that must be tier-gated server-side,
// with their minimum rank (pro=1, business=2). Keep in sync with the relay.
const EXPECTED: Record<string, number> = {
  bidLeveling: 1,
  weeklyAnalysis: 1,
  aiEstimateWizard: 1,
  cashFlowForecaster: 1,
  fullBudgetDashboard: 2,
};

// proOnly FEATURE_CONFIG features that DON'T go through the text relay — they
// each have their own vision edge function with its own requireTier. They must
// NOT appear in the relay map (dead config / drift trap).
const VISION_FEATURES = new Set<AIFeature>([
  'photoAnalysis', 'drawingAnalysis', 'specBookExtract', 'scanCredential',
]);

// Feature ids the relay gates that are gated client-side via useTierAccess
// (canAccess) rather than FEATURE_CONFIG — so they're valid relay keys but not
// AIFeature entries.
const CANACCESS_GATED = new Set(['cashFlowForecaster', 'fullBudgetDashboard']);

// ── Parse FEATURE_MIN_RANK out of the relay source ─────────────────────────
// Path is relative to the repo root — ship-check runs validators from there.
const relaySrc = readFileSync('supabase/functions/ai/index.ts', 'utf8');
const mapMatch = relaySrc.match(/FEATURE_MIN_RANK\s*:\s*Record<string,\s*number>\s*=\s*\{([\s\S]*?)\}/);
ok('relay defines FEATURE_MIN_RANK', !!mapMatch);
const relayMap: Record<string, number> = {};
if (mapMatch) {
  const body = mapMatch[1];
  const entryRe = /(\w+)\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) relayMap[m[1]] = Number(m[2]);
}

// 1. Relay map exactly matches the canonical expected map.
const relayKeys = Object.keys(relayMap).sort();
const expectedKeys = Object.keys(EXPECTED).sort();
ok('relay map keys match expected set', JSON.stringify(relayKeys) === JSON.stringify(expectedKeys),
  `relay=${JSON.stringify(relayKeys)} expected=${JSON.stringify(expectedKeys)}`);
for (const [k, rank] of Object.entries(EXPECTED)) {
  ok(`relay gates ${k} at rank ${rank}`, relayMap[k] === rank, `got ${relayMap[k]}`);
}

// 2. Every proOnly, non-vision FEATURE_CONFIG feature is present in the relay
//    map (catches a new Pro text feature that forgot the server gate).
for (const [feat, cfg] of Object.entries(FEATURE_CONFIG)) {
  if (cfg.proOnly && !VISION_FEATURES.has(feat as AIFeature)) {
    ok(`proOnly text feature ${feat} is server-gated`, feat in relayMap,
      `add "${feat}" to FEATURE_MIN_RANK in supabase/functions/ai/index.ts (or to VISION_FEATURES if it has its own edge fn)`);
  }
}

// 3. Every relay-map key is a recognised feature id (real AIFeature or a known
//    canAccess-gated id) — catches a typo that would silently never match.
for (const k of relayKeys) {
  ok(`relay key ${k} is a recognised feature id`, (k in FEATURE_CONFIG) || CANACCESS_GATED.has(k));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
