// validate-homeowner-digest-gates.ts — the Friday homeowner email says only
// what the GC sent, and stops at handover (audit 2026-09-18 #18 and #23).
//
// #18: the digest read change_orders straight from the table, drafts and voids
// included, and e-mailed "1 change order this week (net +$12,000)" about a CO
// the GC had never sent; the AI prompt got the same count and total, and
// photos / daily reports ignored showPhotos / showDailyReports. The portal
// page shows none of it. The fix gates the DATA (clientVisibleWeek) with the
// same toggle + isShared rule utils/portalSnapshot.ts applies.
//
// #23: closing a job did not stop the digest — "A quiet week on this project"
// every Friday forever (or, with Gemini on, an invented week of work), and from
// day 31 a button that opened the expired-link page. planHomeownerDigest sends
// one "project complete" note that names the date the link closes, then stops.
//
// Both rules live in supabase/functions/homeowner-weekly-digest/clientVisible.ts,
// which is pure, so this file EXECUTES them. Then it pins index.ts to them.
//
// Run: bun run scripts/validate-homeowner-digest-gates.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isShared } from '../utils/portalSnapshot';
import { HANDOVER_GRACE_DAYS as APP_GRACE } from '../utils/portalLinkExpiry';
import type { PortalState } from '../types';
import {
  isPortalShared, clientVisibleWeek, planHomeownerDigest, HANDOVER_GRACE_DAYS,
  type HomeownerDigestPlan,
} from '../supabase/functions/homeowner-weekly-digest/clientVisible';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const NOW = new Date('2026-09-18T21:00:00Z'); // a Friday, cron time
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const SINCE = NOW.getTime() - 7 * DAY;

// ── 1. The digest's share rule IS the portal's ─────────────────────────────
console.log('\nisPortalShared == portalSnapshot.isShared:');
{
  const shapes: Array<PortalState | undefined | null> = [
    undefined, null, { status: 'draft' }, { status: 'sent' }, { status: 'recalled' },
    { status: 'sent', sentAt: ago(1) },
  ];
  for (const s of shapes) eq(`${JSON.stringify(s)}`, isPortalShared(s), isShared(s ?? undefined));
}

// ── 2. Only what the portal shows reaches the email (#18) ──────────────────
console.log('\nclientVisibleWeek:');
{
  const draftCo = { id: 'co-draft', status: 'draft', change_amount: 12000, created_at: ago(3), portal_state: { status: 'draft' } };
  const pricingCo = { id: 'co-pricing', status: 'submitted', change_amount: 12000, created_at: ago(3), portal_state: { status: 'draft' } };
  const sentOld = { id: 'co-sent', status: 'submitted', change_amount: 900, created_at: ago(21), portal_state: { status: 'sent', sentAt: ago(2) } };
  const voidSent = { id: 'co-void', status: 'void', created_at: ago(2), portal_state: { status: 'sent', sentAt: ago(2) } };
  const rejected = { id: 'co-rej', status: 'rejected', created_at: ago(2), portal_state: { status: 'sent', sentAt: ago(2) } };
  const legacyNew = { id: 'co-legacy', status: 'approved', created_at: ago(1), portal_state: null };
  const legacyOld = { id: 'co-legacy-old', status: 'approved', created_at: ago(30), portal_state: null };
  const recalled = { id: 'co-recalled', status: 'submitted', created_at: ago(1), portal_state: { status: 'recalled', sentAt: ago(1) } };
  const cos = [draftCo, pricingCo, sentOld, voidSent, rejected, legacyNew, legacyOld, recalled];
  const photos = [{ id: 'p-shared', portal_state: null }, { id: 'p-draft', portal_state: { status: 'draft' } }];
  const dfrs = [{ id: 'r-sent', portal_state: { status: 'sent' } }, { id: 'r-draft', portal_state: { status: 'draft' } }];
  const tasks = [{ id: 't1' }];
  const all = { showChangeOrders: true, showPhotos: true, showDailyReports: true, showSchedule: true };

  const repro = clientVisibleWeek(all, { cos: [pricingCo], photos: [], dfrs: [], tasks: [] }, SINCE);
  eq('THE REPRO: a $12,000 CO still being priced (never sent) is not in the week', repro.cos.length, 0);

  const v = clientVisibleWeek(all, { cos, photos, dfrs, tasks }, SINCE);
  eq('only sent, live, this-week change orders remain', v.cos.map(c => c.id).sort(), ['co-legacy', 'co-sent']);
  ok('a CO drafted weeks ago and SENT this week counts (windowed on sentAt)', v.cos.some(c => c.id === 'co-sent'));
  eq('a draft photo is dropped', v.photos.map(p => p.id), ['p-shared']);
  eq('an unsent daily report is dropped', v.dfrs.map(d => d.id), ['r-sent']);

  const off = clientVisibleWeek({}, { cos, photos, dfrs, tasks }, SINCE);
  eq('every section the portal hides is empty (toggles absent = off, as in the snapshot)',
    [off.cos.length, off.photos.length, off.dfrs.length, off.tasks.length], [0, 0, 0, 0]);
  const noCos = clientVisibleWeek({ ...all, showChangeOrders: false }, { cos, photos, dfrs, tasks }, SINCE);
  eq('showChangeOrders off → no change orders at all', noCos.cos.length, 0);
}

// ── 3. Handover (#23) ──────────────────────────────────────────────────────
console.log('\nplanHomeownerDigest:');
{
  const base = { status: 'in_progress', closedAt: null, linkExpiresAt: null, finalSentAt: null, isPreview: false, now: NOW };
  eq('an open job gets the weekly email', planHomeownerDigest(base).kind, 'weekly');
  eq('an open job whose fixed-length link ended gets nothing',
    planHomeownerDigest({ ...base, linkExpiresAt: ago(1) }), { kind: 'skip', reason: 'portal_link_ended' } as HomeownerDigestPlan);
  const closed = { ...base, status: 'closed', closedAt: ago(3) };
  const fin = planHomeownerDigest(closed);
  eq('closed 3 days ago → ONE handover note, dated closedAt + 30 days',
    fin, { kind: 'final', linkClosesAt: new Date(Date.parse(ago(3)) + 30 * DAY).toISOString() } as HomeownerDigestPlan);
  eq('…the snapshot\'s own expires_at wins when present',
    planHomeownerDigest({ ...closed, linkExpiresAt: ago(-10) }).kind === 'final' && (planHomeownerDigest({ ...closed, linkExpiresAt: ago(-10) }) as { linkClosesAt: string }).linkClosesAt, ago(-10));
  eq('after the note went: nothing', planHomeownerDigest({ ...closed, finalSentAt: ago(1) }), { kind: 'skip', reason: 'project_closed' } as HomeownerDigestPlan);
  eq('the GC preview on a closed job sends nothing (it e-mails the homeowner for real)',
    planHomeownerDigest({ ...closed, isPreview: true }), { kind: 'skip', reason: 'project_closed' } as HomeownerDigestPlan);
  eq('closed 40 days ago (link already closed): nothing',
    planHomeownerDigest({ ...closed, closedAt: ago(40) }).kind, 'skip');
  eq('closed with no date anywhere: nothing (the note could not say when the link closes)',
    planHomeownerDigest({ ...closed, closedAt: null }).kind, 'skip');

  // THE REPRO: enable digest, close out, run five Fridays.
  let finalSentAt: string | null = null;
  const sends: string[] = [];
  for (let w = 0; w < 5; w++) {
    const now = new Date(Date.parse(ago(-7 * w)));
    const p = planHomeownerDigest({ ...closed, closedAt: ago(1), linkExpiresAt: null, finalSentAt, now });
    if (p.kind !== 'skip') { sends.push(p.kind); if (p.kind === 'final') finalSentAt = now.toISOString(); }
  }
  eq('THE REPRO: five Fridays after closeout → exactly one email, the handover note', sends, ['final']);

  eq('grace days: the digest, utils/portalLinkExpiry and the migration agree', [HANDOVER_GRACE_DAYS, APP_GRACE], [30, 30]);
  ok('…and migration 20260916140000 still closes the link 30 days after closed_at',
    /closed_at \+ interval '30 days'/.test(read('supabase/migrations/20260916140000_portal_link_until_handover.sql')));
}

// ── 4. index.ts runs through both rules ────────────────────────────────────
console.log('\nhomeowner-weekly-digest/index.ts is wired to the rules:');
{
  const src = strip(read('supabase/functions/homeowner-weekly-digest/index.ts'));
  const send = src.slice(src.indexOf('async function sendForProject('), src.indexOf('Deno.serve('));
  const planAt = send.indexOf('planHomeownerDigest(');
  ok('sendForProject plans before it reads or writes anything else',
    planAt > 0 && planAt < send.indexOf('fetchWeekDataForProject(') && planAt < send.indexOf('buildAISummary('));
  ok('a skip plan returns without sending', /if \(plan\.kind === 'skip'\) return \{ sent: 0, errors: \[plan\.reason\] \}/.test(send));
  ok('the week is gated by clientVisibleWeek BEFORE the AI and the template see it',
    send.indexOf('clientVisibleWeek(') > 0
    && send.indexOf('clientVisibleWeek(') < send.indexOf('buildAISummary(')
    && send.indexOf('clientVisibleWeek(') < send.indexOf('buildTemplateSummary('));
  ok('the AI and template get the GATED rows, never week.cos directly',
    !/buildAISummary\([^)]*week\./.test(send) && !/buildTemplateSummary\([^)]*week\./.test(send));
  ok('change_orders are read with portal_state, and only when the portal shows them',
    /if \(portal\?\.showChangeOrders\) \{[\s\S]{0,200}\.from\('change_orders'\)\s*\.select\('[^']*portal_state'\)/.test(src));
  ok('daily_reports and photos are read with portal_state',
    /\.from\('daily_reports'\)\s*\.select\('[^']*portal_state'\)/.test(src) && /\.from\('photos'\)\s*\.select\('[^']*portal_state'\)/.test(src));
  ok('the AI is never told a dollar total', !/net total \$/.test(src) && !/change_amount \?\? 0\), 0\)\.toLocaleString/.test(src));
  ok('the template CO bullet carries no money', !/net \$\{sign\}/.test(src));
  ok('template bullets go through the same sanitizer as the AI bullets', /bullets: bullets\.map\(sanitizeBullet\)/.test(src));
  ok('the AI is told completed tasks are cumulative, not this week\'s', /NOT necessarily this week/.test(src));
  ok('the handover note is deterministic (no AI call in the final branch)',
    (() => { const a = send.indexOf("if (plan.kind === 'final')"); const b = send.indexOf('} else {', a); return a > 0 && b > a && !send.slice(a, b).includes('buildAISummary('); })());
  ok('the note is stamped once at weeklyDigest.finalSentAt', /finalSentAt: plan\.kind === 'final' \? stamp : undefined/.test(src));
  ok('the link expiry comes from portal_snapshots.expires_at', /\.from\('portal_snapshots'\)\s*\.select\('expires_at'\)/.test(src));
  ok('both project reads select closed_at', (src.match(/\.select\('id,user_id,name,status,closed_at,location,client_portal,schedule'\)/g) ?? []).length === 2);
}

{
  // The GC's "Send preview" button must say why nothing went out, not always
  // "No invites yet", now that the function skips closed jobs / ended links.
  const setup = strip(read('app/client-portal-setup.tsx'));
  ok('Send preview names a closed job', /errs\.includes\('project_closed'\)[\s\S]{0,400}showAlert\('Job is closed'/.test(setup));
  ok('…and promises the closing email only when the weekly recap is on', /showAlert\('Job is closed', portal\.weeklyDigest\?\.enabled\s*\?[^:]*one last email[\s\S]{0,120}:\s*'[^']*recap is off[^']*no closing email/.test(setup));
  ok('Send preview names an ended portal link', /errs\.includes\('portal_link_ended'\)[\s\S]{0,40}showAlert\('Portal link has ended'/.test(setup));
}

{
  console.log('\nthe final email\'s link-close day is the owner\'s local day, not UTC\'s');
  const fnSrc = read('supabase/functions/homeowner-weekly-digest/index.ts');
  const m = fnSrc.match(/function localDayLabel\([\s\S]*?\n\}\n/);
  ok('localDayLabel exists', !!m);
  if (m) {
    const js = m[0].replace(/\(iso: string, tz: string \| null \| undefined\): string/, '(iso, tz)').replace(/ as const/, '');
    const localDayLabel = new Function(`${js}; return localDayLabel;`)() as (iso: string, tz?: string | null) => string;
    // Closed Sep 18, 9 pm New York → link dies Oct 18, 9 pm New York = Oct 19 01:00 UTC.
    const dies = '2026-10-19T01:00:00.000Z';
    eq('a US-evening close says October 18 (the day the link dies there)', localDayLabel(dies, 'America/New_York'), 'October 18, 2026');
    eq('no zone set → the digest default (New York), not UTC', localDayLabel(dies, null), 'October 18, 2026');
    eq('an unreadable zone falls back to New York', localDayLabel(dies, 'Not/AZone'), 'October 18, 2026');
    eq('a Pacific owner', localDayLabel(dies, 'America/Los_Angeles'), 'October 18, 2026');
  }
  const code = strip(fnSrc);
  ok('the final email formats the close day with the owner\'s zone', /const closesLabel = localDayLabel\(plan\.linkClosesAt, ownerProfile\?\.digest_timezone\);/.test(code) && !/timeZone: 'UTC'/.test(code));
  ok('both owner-profile reads select digest_timezone', (code.match(/select\('id,email,name,company_name,contact_name,digest_timezone'\)/g) ?? []).length === 2);
}

{
  // Leftovers review: finalSentAt / lastSentAt lived only in the client-owned
  // client_portal JSON, and the app's owner upsert sends that JSON whole — a
  // stale device erased the stamp and "the last weekly update" went again.
  // The stamps are server-owned by a BEFORE UPDATE trigger. Executed in
  // PGlite (scratchpad pgtest/weekly_digest_stamps.mjs: stale upsert without
  // the keys keeps both, a signed-in writer cannot forge or null them, the
  // service role's reopen reset still drops finalSentAt) — pinned here.
  console.log('\nthe weekly-digest send stamps are server-owned');
  const MIG = 'supabase/migrations/20260919190000_weekly_digest_stamps_server_owned.sql';
  let sql = '';
  try { sql = read(MIG); } catch { /* reported below */ }
  const body = sql.replace(/--[^\n]*/g, '');
  ok('the migration exists', sql.length > 0);
  ok('only a signed-in writer is overridden (service role / direct session pass through)', /if auth\.uid\(\) is null then\s*return new;/.test(body));
  ok('both stamps are put back from OLD (carried when old had one, removed when it had none)',
    /foreach k in array array\['lastSentAt', 'finalSentAt'\] loop\s*if old_wd \? k then\s*new_wd := new_wd \|\| jsonb_build_object\(k, old_wd -> k\);\s*else\s*new_wd := new_wd - k;/.test(body));
  ok('…merged back into new.client_portal.weeklyDigest', /new\.client_portal := new\.client_portal \|\| jsonb_build_object\('weeklyDigest', new_wd\);/.test(body));
  ok('a BEFORE UPDATE trigger on projects, recreated idempotently',
    /drop trigger if exists projects_keep_weekly_digest_stamps on public\.projects;\s*create trigger projects_keep_weekly_digest_stamps before update on public\.projects\s*for each row execute function public\.projects_keep_weekly_digest_stamps\(\);/.test(body));
  const fn = strip(read('supabase/functions/homeowner-weekly-digest/index.ts'));
  ok('the function still stamps (and drops finalSentAt on reopen) with its service-role client',
    /finalSentAt: plan\.kind === 'final' \? stamp : undefined,/.test(fn) && /\.from\('projects'\)\s*\.update\(\{ client_portal: updatedPortal \}\)/.test(fn));

  console.log('\na preview that sent nothing says why');
  ok('an unsubscribed invite is reported (a bare code), not silently skipped',
    /isEmailUnsubscribed\([^)]*'weekly_digest'\)\) \{[\s\S]{0,500}errors\.push\(DIGEST_RECIPIENT_UNSUBSCRIBED\);\s*continue;/.test(fn)
      && /const DIGEST_RECIPIENT_UNSUBSCRIBED = 'unsubscribed';/.test(fn));
  const setup = strip(read('app/client-portal-setup.tsx'));
  ok('Send preview: all invites unsubscribed reads "Your client turned these emails off", not "No invites yet"',
    /\} else if \(errs\.every\(e => e === 'unsubscribed'\)\) \{[\s\S]{0,40}showAlert\('Your client turned these emails off'/.test(setup)
      && /const refusal = errs\.find\(e => e !== 'unsubscribed'\) \?\? errs\[0\];/.test(setup));
  ok('a never-published portal gets no portal button in the recap',
    /portalUnpublished = !snapRes\.error && snapRes\.data == null;/.test(fn) && /const portalUrl = portalUnpublished \? undefined : \(portalUrlFor\(portal\) \?\? undefined\);/.test(fn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
