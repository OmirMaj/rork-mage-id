// validate-feature-registry-gates.ts — the lock chip must not lie about tier.
//
// WHY THIS EXISTS. A destination names its tier twice: once in
// utils/featureRegistry.ts (`requires`, which Universal Search turns into the
// lock chip and the "requires Business" hint) and once in the screen itself
// (`if (!canAccess('<key>')) return <Paywall …>`). Nothing made them agree.
//
// Three had drifted (audit 2026-08-31 #27):
//
//   margin-board       registry job_costing (pro)     screen portfolio_margin (business)
//   coi-vault          registry prequal_coi (pro)     screen rfis_submittals  (business)
//   plan-intelligence  registry ask_your_plans (biz)  screen ai_estimate_wizard (pro)
//
// Both directions hurt a paying customer. A Pro subscriber searching "margin"
// or "coi" saw NO chip, tapped through, and hit a Business wall — the exact
// dead end the chip exists to prevent. The same subscriber saw a BUSINESS chip
// on Plan Intelligence and never opened a screen they already owned.
//
// tsc cannot see it: both keys are valid FeatureKeys. It is only visible by
// reading two files at once and knowing they must agree.
//
// THE RULE ENFORCED HERE: a registry entry must not advertise a tier that
// DISAGREES with utils/featureTiers.ts for the key its own destination gates
// on. Same shape as scripts/validate-paywall-tiers.ts, deliberately.
//
// Note what this is NOT: it does not require every gated screen to carry a
// `requires` in the registry. ~20 screens gate on canAccess() with no registry
// entry — a real (separate) gap, printed below as a blind spot rather than
// failed on, because a guard that demands 20 unrelated edits gets disabled
// instead of satisfied. It also does not guess: a screen with no parseable
// canAccess() is reported as unverifiable, never accused.
//
// Run via: bun run scripts/validate-feature-registry-gates.ts

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEATURE_REGISTRY } from '@/utils/featureRegistry';
import { REQUIRED_TIER } from '@/utils/featureTiers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\nfeature-registry gates (lock chip vs. the gate it claims to mirror):');

/** Expo Router: '/foo' → app/foo.tsx; '/(tabs)/(home)' → …/index.tsx. */
function screenFileFor(route: string): string | undefined {
  const rel = route.replace(/^\//, '');
  return [join(ROOT, 'app', `${rel}.tsx`), join(ROOT, 'app', rel, 'index.tsx')]
    .find(p => existsSync(p));
}

/** Strip comments so a key named only in prose is never mistaken for a gate.
 *  LINE COMMENTS FIRST: a `/*` inside a `//` comment (app/ask.tsx:3 writes
 *  "utils/oneMind/*") otherwise opens a block comment that runs to the next
 *  `*\/` anywhere in the file — 255 lines of component erased, the screen read
 *  as gating nothing, and this file accuses on exactly that evidence. */
const stripComments = (src: string) =>
  src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const contradictions: string[] = [];
const keyDiffersSameTier: string[] = [];
const falseLocks: string[] = [];
const unverifiable: string[] = [];
const undeclared: string[] = [];

for (const entry of FEATURE_REGISTRY) {
  const file = screenFileFor(entry.route);
  if (!file) continue;                       // validate-feature-search.ts owns this
  const code = stripComments(readFileSync(file, 'utf8'));

  // The screen's own gate. Prefer the unambiguous top-level form
  // `if (!canAccess('key'))`; fall back to any canAccess key in the file.
  const hardGate = code.match(/if\s*\(\s*!\s*canAccess\(\s*['"]([a-z0-9_]+)['"]\s*\)\s*\)/)?.[1];
  const allKeys = [...new Set([...code.matchAll(/canAccess\(\s*['"]([a-z0-9_]+)['"]/g)].map(m => m[1]))];

  if (!entry.requires) {
    // Screen enforces something the chip never mentions. Real gap, not this
    // guard's failure condition — see the header.
    if (hardGate) undeclared.push(`${entry.id} (${entry.route}) gates '${hardGate}' with no registry \`requires\``);
    continue;
  }

  // The registry key appearing anywhere in the screen's canAccess calls is
  // agreement — some screens gate inside a hook or a ternary, not an if.
  if (allKeys.includes(entry.requires)) continue;

  if (!hardGate) {
    // NOT "unverifiable". `allKeys` above already accepts a gate written as a
    // hook, a ternary, anything — this branch means the destination contains no
    // canAccess call AT ALL, so it gates nothing and the chip is a lie in the
    // expensive direction: a free user is told to pay for what they already
    // have. That is how the estimate-wizard false lock reached the app's
    // activation moment (audit 2026-09-07). It fails.
    falseLocks.push(`${entry.id} (${entry.route}) advertises '${entry.requires}'; the screen contains no canAccess() at all`);
    continue;
  }

  const claimed = REQUIRED_TIER[entry.requires];
  const enforced = hardGate in REQUIRED_TIER ? REQUIRED_TIER[hardGate as keyof typeof REQUIRED_TIER] : undefined;
  if (!enforced) {
    unverifiable.push(`${entry.id}: screen gates '${hardGate}', which is not in REQUIRED_TIER`);
  } else if (enforced !== claimed) {
    contradictions.push(
      `${entry.id} (${entry.route}): chip says ${claimed} ('${entry.requires}') ` +
      `but the screen gates '${hardGate}' (${enforced})`,
    );
  } else {
    keyDiffersSameTier.push(`${entry.id}: '${entry.requires}' vs screen '${hardGate}' — same tier (${claimed})`);
  }
}

ok('the registry was walked against real screen files', FEATURE_REGISTRY.length >= 60,
  `only ${FEATURE_REGISTRY.length} entries — has the registry moved?`);

// ── THE CHIP OVER-LOCKS FOR AN INVITED COLLABORATOR ─────────────────────────
// Everything above compares the chip's tier to the screen's tier. Three rows
// have a third party in the conversation: their destination resolves access
// through hooks/useProjectAccess, which is `tier access OR the collaborator
// grant for THIS project` (utils/collaboratorAccess.resolveProjectAccess). The
// four surfaces that paint the chip — components/UniversalSearch.tsx,
// components/DesktopSidebar.tsx, components/CreateMenu.tsx and
// app/(tabs)/discover/tools.tsx — all read own-tier canAccess(entry.requires),
// with no project in hand to ask about. So a free-tier person invited to a
// Business job sees a BUSINESS padlock on a screen that WILL open for them.
//
// The chip is still right for everyone else, and dropping `requires` would
// bring back the worse failure in the other direction (an unwarned wall) for
// every user who is not a collaborator on that project. The fix belongs in the
// four consumers, not in the registry row. What this pins is the SET: a fourth
// row joining it is a deliberate edit, and a screen leaving useProjectAccess
// (which would silently change who gets walled) turns this red.
//
// THE BINDING, NOT THE WORD. A grep for `useProjectAccess` anywhere in the file
// is evaded by the very change it must catch: app/ai-punch.tsx calls the hook
// TWICE — once for the entry gate and once inside AiPunchScreenInner — so
// switching the entry gate to own-tier useTierAccess leaves the string in the
// file and a name-grep green over the exact regression. Trace the identifier
// the entry gate calls back to the hook that bound it.
const entryGateIsProjectAware = (src: string): boolean => {
  const lines = stripComments(src).split('\n');
  const start = lines.findIndex(l => /^export default function\b/.test(l));
  if (start < 0) return false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^\}/.test(lines[i])) { end = i; break; }
  const body = lines.slice(start + 1, end);
  const gate = body.find(l => /^  if \(\s*!\s*\w+\(\s*['"][a-z0-9_]+['"]\s*\)\s*\)/.test(l));
  if (!gate) return false;
  const called = /!\s*(\w+)\(/.exec(gate)![1];
  // Names actually BOUND by a `const { … } = useProjectAccess(…)` in this body:
  // `{ canAccess: onProject }` binds `onProject`, not `canAccess`.
  const bound = new Set<string>();
  for (const l of body) {
    const m = /^  const \{([^}]*)\} = useProjectAccess\(/.exec(l);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop()!.trim();
      if (n) bound.add(n);
    }
  }
  return bound.has(called);
};
const PROJECT_GRANTABLE = ['ai-punch', 'punch-list', 'rfi'];
const grantable = FEATURE_REGISTRY.filter(e => {
  if (!e.requires) return false;
  const f = screenFileFor(e.route);
  return !!f && entryGateIsProjectAware(readFileSync(f, 'utf8'));
}).map(e => e.id).sort();
ok(`the rows whose chip over-locks an invited collaborator are still the ${PROJECT_GRANTABLE.length} named`,
  grantable.join(',') === PROJECT_GRANTABLE.join(','),
  `now [${grantable.join(', ')}], pinned [${PROJECT_GRANTABLE.join(', ')}] — a chipped row whose `
  + 'screen resolves through useProjectAccess shows a padlock to a collaborator who can open it. '
  + 'Add it here only with the consumer fix, or after deciding the false lock is acceptable for it.');

ok(
  'no lock chip advertises a different tier than its destination enforces',
  contradictions.length === 0,
  contradictions.length === 0 ? undefined :
    `${contradictions.length} contradiction(s) — the chip is the app's promise about what a plan includes:\n` +
    contradictions.map(c => `        • ${c}`).join('\n') +
    `\n\n      Set the registry \`requires\` to the key the screen actually gates on.`,
);

ok(
  'no lock chip stands in front of a screen that gates nothing',
  falseLocks.length === 0,
  falseLocks.length === 0 ? undefined :
    `${falseLocks.length} false lock(s) — the chip charges for something the destination gives away:\n` +
    falseLocks.map(c => `        • ${c}`).join('\n') +
    `\n\n      Either drop \`requires\` from the registry row, or point it at the` +
    `\n      screen that actually holds the wall.`,
);

if (keyDiffersSameTier.length > 0) {
  console.log(`  · ${keyDiffersSameTier.length} entry(ies) name a different key than the screen, but the same tier:`);
  for (const s of keyDiffersSameTier) console.log(`      ${s}`);
}
if (unverifiable.length > 0) {
  console.log(`  · ${unverifiable.length} entry(ies) this guard cannot verify (gate is not a plain canAccess call):`);
  for (const s of unverifiable.slice(0, 8)) console.log(`      ${s}`);
  if (unverifiable.length > 8) console.log(`      …and ${unverifiable.length - 8} more`);
}
if (undeclared.length > 0) {
  console.log(`  · ${undeclared.length} screen(s) enforce a gate the registry does not advertise (no chip shown ` +
    `→ the user taps through into a wall). Tracked, not failed — see this file's header:`);
  for (const s of undeclared.slice(0, 8)) console.log(`      ${s}`);
  if (undeclared.length > 8) console.log(`      …and ${undeclared.length - 8} more`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
