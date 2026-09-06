// scripts/validate-platform-fees.ts — the platform payment fee is ONE table.
//
// Audit 2026-09-03 MONEY-F8 / EDGE-F8: the Stripe platform fee was stated four
// different ways to users (edge function, paywall, payments-setup, payments
// screen) and none matched what was charged — and the edge function took the
// TIER from the client, so a GC sending userTier:'free' paid 0 bps forever.
//
// utils/platformFees.ts is now the single client-side table. Deno cannot
// import from utils/, so supabase/functions/create-payment-link/index.ts
// carries a byte-identical copy. This guard diffs the two object literals and
// fails the build if they drift, then checks the server half of the fix is
// still standing: tier from requireTier (never body.userTier), single-use
// links, no promo codes on invoices, and the minted amount persisted.
//
// Run via: bun run test:platform-fees
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = 'utils/platformFees.ts';
const SERVER = 'supabase/functions/create-payment-link/index.ts';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

const TIERS = ['free', 'pro', 'business', 'enterprise'] as const;

function extractTable(src: string, re: RegExp): { body: string; map: Record<string, number>; order: string[] } | null {
  const m = src.match(re);
  if (!m) return null;
  const map: Record<string, number> = {};
  const order: string[] = [];
  for (const kv of m[1].matchAll(/([a-z_]+)\s*:\s*(-?\d+)/g)) {
    map[kv[1]] = Number(kv[2]);
    order.push(kv[1]);
  }
  return { body: m[1], map, order };
}

// Absence checks must not trip on their own explanation: drop whole-line `//`
// comments and `/* … */` blocks before asserting that something is NOT there.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const clientSrc = read(CLIENT);
const serverSrc = read(SERVER);
const serverCode = stripComments(serverSrc);
ok(`${CLIENT} loaded`, clientSrc.length > 0);
ok(`${SERVER} loaded`, serverSrc.length > 0);

// ── 1. the two tables are byte-identical ────────────────────────────────────
const client = extractTable(clientSrc, /export const PLATFORM_FEE_BPS\s*:\s*Record<FeeTier,\s*number>\s*=\s*\{([\s\S]*?)\};/);
const server = extractTable(serverSrc, /const PLATFORM_FEE_BPS\s*:\s*Record<Tier,\s*number>\s*=\s*\{([\s\S]*?)\};/);
ok('client exports PLATFORM_FEE_BPS: Record<FeeTier, number>', !!client);
ok('edge function declares PLATFORM_FEE_BPS: Record<Tier, number>', !!server,
  'create-payment-link must carry the table as a const literal (it cannot import utils/platformFees.ts)');

if (client && server) {
  ok('client table has exactly the four tiers, in rank order',
    JSON.stringify(client.order) === JSON.stringify(TIERS),
    `got ${JSON.stringify(client.order)}`);
  for (const t of TIERS) {
    ok(`${t}: client ${client.map[t]} bps == server ${server.map[t]} bps`,
      Number.isInteger(client.map[t]) && client.map[t] === server.map[t]);
  }
  ok('no extra tiers on the server side', JSON.stringify(server.order) === JSON.stringify(client.order),
    `server order ${JSON.stringify(server.order)}`);
  ok('the two object literals are byte-identical', client.body === server.body,
    `client body ${JSON.stringify(client.body)}\n   server body ${JSON.stringify(server.body)}`);
  ok('free tier is 0 bps (top-of-funnel never pays a platform fee)', client.map.free === 0);
}

// ── 2. the client rounding matches the server rounding ──────────────────────
ok('client platformFeeCents rounds half-up over 10000 bps',
  /Math\.round\(\(amountCents \* platformFeeBps\(tier\)\) \/ 10000\)/.test(clientSrc));
ok('edge function computes the fee the same way',
  /Math\.round\(\(body\.amountCents \* feeBps\) \/ 10000\)/.test(serverSrc));

// ── 3. EDGE-F8: the tier is the SERVER's, never the client's ────────────────
ok('edge function resolves the caller through requireTier with every tier allowed',
  /requireTier\(\s*req,\s*\["free",\s*"pro",\s*"business",\s*"enterprise"\]/.test(serverSrc),
  'identity + tier must come from _shared/auth.ts (GoTrue-verified), all four tiers allowed');
ok('fee is computed from auth.tier', /feeBpsForTier\(auth\.tier\)/.test(serverSrc));
ok('fee is NOT computed from body.userTier', !/feeBpsForTier\(body\.userTier\)/.test(serverCode));
ok('no unknown-tier default (PLATFORM_FEE_BPS_DEFAULT is gone)', !/PLATFORM_FEE_BPS_DEFAULT/.test(serverCode),
  'a free user on a stale build used to pay the Business rate');
ok('no hand-rolled JWT claims decode (atob) — that was forgeable under verify_jwt:false', !/atob\(/.test(serverCode));

// ── 4. MONEY-F2 / appendix: link hygiene at mint time ───────────────────────
ok('Payment Links are single-use (restrictions.completed_sessions.limit = 1)',
  /restrictions:\s*\{\s*completed_sessions:\s*\{\s*limit:\s*1\s*\}\s*\}/.test(serverSrc));
ok('promotion codes are not enabled on invoice links', !/allow_promotion_codes:\s*true/.test(serverCode));
ok('the minted amount is persisted as pay_link_amount (dollars)',
  /pay_link_amount:\s*Math\.round\(body\.amountCents\)\s*\/\s*100/.test(serverSrc));
ok('re-mint reads the existing link for BOTH tables (AIA double-charge path)',
  /select=id,user_id,pay_link_id&limit=1/.test(serverSrc) && !/ownSelect/.test(serverCode),
  'the ownership SELECT must include pay_link_id for invoices AND aia_pay_apps so the replaced link is retired');
ok('the replaced link is deactivated on Stripe', /previousLinkId && previousLinkId !== id/.test(serverSrc));

// ── 5. no literal fee in user-facing copy — every screen renders platformFeeLabel ──
// Review 2026-09-05: Settings (app/(tabs)/settings/index.tsx) still said "we
// take a 1% platform fee per transaction" — wrong for every tier — after the
// MONEY-F8 sweep, because the sweep never looked under app/(tabs)/. Scan every
// screen and component (comments stripped) for a percentage stated next to
// "platform fee" / "per transaction"; the only source of that number is
// platformFeeLabel(tier). Stripe's own "2.9% + 30¢" processing copy is not
// matched (it is not the platform fee) and is fine to state.
import { readdirSync, statSync } from 'node:fs';
const SCAN_DIRS = ['app', 'components'];
const FEE_LITERAL_PATTERNS: RegExp[] = [
  /\d+(?:\.\d+)?\s*%\s*(?:platform\s+fee|fee\s+per\s+transaction|per[- ]transaction\s+fee|per\s+transaction)/i,
  /platform\s+fee\s+(?:of|is|at)\s+\d+(?:\.\d+)?\s*%/i,
  /(?:take|charge)s?\s+(?:a\s+)?\d+(?:\.\d+)?\s*%/i,
];
function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}
const scanned: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), scanned);
const feeHits: string[] = [];
for (const abs of scanned) {
  const rel = abs.slice(ROOT.length + 1);
  const lines = stripComments(readFileSync(abs, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (FEE_LITERAL_PATTERNS.some(re => re.test(line))) feeHits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
}
ok(`fee-literal scan covers app/(tabs)/ (${scanned.length} files)`, scanned.some(p => p.includes('/app/(tabs)/')));
ok('no screen states the platform fee as a literal percentage (render platformFeeLabel(tier) instead)',
  feeHits.length === 0, feeHits.join('\n   '));
ok('Settings renders the fee from platformFeeLabel(tier)',
  /platformFeeLabel\(tier\)/.test(read('app/(tabs)/settings/index.tsx')));

console.log(`\nvalidate-platform-fees: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
