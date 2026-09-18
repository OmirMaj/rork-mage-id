// validate-entity-action-menu.ts — the long-press row menu offers only verbs
// that actually run, and its links open in a browser.
//
// WHY THIS EXISTS (audit round 2, #34).
//
// components/EntityActionSheet read the catalog in utils/entityActions and
// forwarded Mark complete / Duplicate / Delete to an OPTIONAL `onAction` prop.
// app/project-detail.tsx and app/activity-feed.tsx mounted it with none, and
// the activity feed turns every CO, invoice, DFR, punch item, RFI, submittal
// and photo into a row — so one screen showed every dead verb: Duplicate that
// copied nothing, Mark complete that completed nothing, and a red Delete on
// photos and punch items that closed the sheet and deleted nothing. The GC
// believes the punch item is gone; the portal still shows it.
//
// "Copy link" and "Share" handed out mageid://invoice?..., which is not
// clickable in an email and opens nothing in the browser the PM or bookkeeper
// works in.
//
// And the post-login replay stashed usePathname(), which has NO query string,
// so an https link whose record lives entirely in `?projectId=&invoiceId=`
// landed a signed-out teammate on an empty editor.
//
// WHAT IS GUARDED
//   A. Behaviour — getRunnableEntityActions never lists a mutating verb nobody
//      performs; the sheet's own wiring (RFI close, punch close + delete) is
//      listed; a caller's claimed verb is listed; a closed record is not
//      offered "Mark complete"; RFI close moves the ball and logs the hand-off.
//   B. Links — https on the web-app origin, never mageid://, never the
//      marketing host.
//   C. Wiring — the sheet filters through getRunnableEntityActions, never calls
//      onAction for an unclaimed verb, confirms before a delete; Home names its
//      verb; the auth gate stashes the query.
//
// Run via: bun run scripts/validate-entity-action-menu.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityKind, EntityRef } from '../types';
import {
  getRunnableEntityActions, getEntityDeepLink, getEntityShareBody,
  rfiClosePatch, punchClosePatch, sheetWiresVerb,
} from '../utils/entityActions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

const ALL_KINDS: EntityKind[] = [
  'project', 'task', 'photo', 'rfi', 'submittal', 'changeOrder', 'invoice', 'payment',
  'dailyReport', 'punchItem', 'warranty', 'contact', 'document', 'permit', 'equipment',
  'subcontractor', 'commitment', 'planSheet', 'commEvent', 'portalMessage', 'drawingPin',
  'planMarkup', 'prequalPacket', 'priceAlert', 'delayEvent', 'lead',
];
const MUTATING = ['markComplete', 'duplicate', 'delete'] as const;
const ref = (kind: EntityKind, id = 'x1'): EntityRef => ({ kind, id, projectId: 'p1' });
const ids = (r: EntityRef, ctx?: Parameters<typeof getRunnableEntityActions>[1]) =>
  getRunnableEntityActions(r, ctx).map(a => a.id);

console.log('\nentity action menu (no dead verbs, links that open):');

// ── A. no mutating verb without a performer ─────────────────────────────────
{
  for (const kind of ALL_KINDS) {
    const shown = ids(ref(kind));
    const dead = shown.filter(id => (MUTATING as readonly string[]).includes(id) && !sheetWiresVerb(kind, id));
    check(`${kind}: no mutating verb is offered that nothing performs`,
      dead.length === 0, `dead verbs offered: ${dead.join(', ')}`);
  }

  // The activity feed's worst rows, spelled out.
  check('invoice Duplicate is not offered without a caller that performs it',
    !ids(ref('invoice')).includes('duplicate'));
  check('photo Delete is not offered (it would blank punch items / pins / filed DFRs)',
    !ids(ref('photo')).includes('delete'));
  check('submittal "Mark complete" is not offered (approval is the reviewer’s call)',
    !ids(ref('submittal')).includes('markComplete'));

  // A lead (the Smart Inbox's "Lead waiting" row) opens the lead itself —
  // app/lead-detail.tsx reads `leadId`.
  {
    const leadLink = getEntityDeepLink({ kind: 'lead', id: 'lead-9' }, 'https://app.mageid.app') ?? '';
    check('a lead ref links to /lead-detail?leadId=…', /\/lead-detail\?leadId=lead-9$/.test(leadLink), leadLink);
    const inbox = read('hooks/useSmartInbox.ts');
    check('the Smart Inbox raises a "Lead waiting" row for an unanswered new lead, routed by a lead ref',
      /if \(l\.stage !== 'new' \|\| l\.firstRespondedAt\) continue;/.test(inbox)
        && /rule: 'lead_waiting'/.test(inbox) && /ref: \{ kind: 'lead', id: l\.id \}/.test(inbox));
  }

  // What the sheet does wire, it offers.
  check('RFI Mark complete IS offered — the sheet closes it itself',
    ids(ref('rfi'), { status: 'open' }).includes('markComplete'));
  const punch = ids(ref('punchItem'), { status: 'open' });
  check('punch item Mark complete and Delete ARE offered — the sheet performs both',
    punch.includes('markComplete') && punch.includes('delete'), punch.join(','));
  check('a closed punch item is not offered "Mark complete" again',
    !ids(ref('punchItem'), { status: 'closed' }).includes('markComplete'));
  check('a void RFI is not offered "Mark complete"',
    !ids(ref('rfi'), { status: 'void' }).includes('markComplete'));

  // A caller that claims a verb gets it — and only that one.
  const home = ids(ref('project'), { callerVerbs: ['duplicate'] });
  check('Home’s project Duplicate appears when the caller claims it',
    home.includes('duplicate'), home.join(','));
  check('project Duplicate does NOT appear when no caller claims it',
    !ids(ref('project')).includes('duplicate'));

  // Open / Copy / Share are never filtered by this.
  const uni = ids(ref('invoice'));
  check('Open, Copy link and Share survive for an invoice',
    uni.includes('open') && uni.includes('copyLink') && uni.includes('share'), uni.join(','));
}

// ── A2. the close patches match the record screens ─────────────────────────
{
  const p = rfiClosePatch({ ballInCourt: 'architect', handoffs: [] }, '2026-09-18T12:00:00.000Z');
  check('closing an RFI from the menu moves the ball to "closed" (drops out of the live filter)',
    p.status === 'closed' && p.ballInCourt === 'closed', JSON.stringify(p));
  check('closing an RFI appends the hand-off delay claims are built from',
    p.handoffs?.length === 1 && p.handoffs[0].fromParty === 'architect' && p.handoffs[0].toParty === 'closed',
    JSON.stringify(p.handoffs));
  const pc = punchClosePatch('2026-09-18T12:00:00.000Z');
  check('closing a punch item stamps closedAt like punch-list.tsx',
    pc.status === 'closed' && pc.closedAt === '2026-09-18T12:00:00.000Z', JSON.stringify(pc));
}

// ── B. links open in a browser ─────────────────────────────────────────────
{
  const inv: EntityRef = { kind: 'invoice', id: 'inv-7', projectId: 'p1' };
  const link = getEntityDeepLink(inv) ?? '';
  check('Copy link is an https URL on the web-app origin',
    link.startsWith('https://app.mageid.app/'), `got "${link}"`);
  check('Copy link is never the mageid:// scheme',
    !link.startsWith('mageid://'), `got "${link}"`);
  check('the link carries the record in its query',
    /invoiceId=inv-7/.test(link) && /projectId=p1/.test(link), `got "${link}"`);
  const fromMarketing = getEntityDeepLink(inv, 'https://mageid.app') ?? '';
  check('a runtime origin on the marketing host is refused (it 404s every Expo route)',
    fromMarketing.startsWith('https://app.mageid.app/'), `got "${fromMarketing}"`);
  const preview = getEntityDeepLink(inv, 'https://deploy-preview-9--mageid-app.netlify.app') ?? '';
  check('a deploy preview links to itself',
    preview.startsWith('https://deploy-preview-9--mageid-app.netlify.app/'), `got "${preview}"`);
  const body = getEntityShareBody(inv, 'Invoice #7');
  check('Share text carries the https link', /\nhttps:\/\/app\.mageid\.app\//.test(body), body);
}

// ── C. wiring ──────────────────────────────────────────────────────────────
{
  const sheet = read('components/EntityActionSheet.tsx');
  check('the sheet lists actions through getRunnableEntityActions',
    /getRunnableEntityActions\(/.test(sheet) && !/\bgetEntityActions\(/.test(sheet),
    'reading the raw catalog is how the dead verbs got on screen.');
  check('the sheet never forwards an unclaimed verb to onAction',
    !/onAction\?\.\(/.test(sheet) && /callerVerbs\?\.includes\(id\)/.test(sheet),
    'an optional-chained onAction call is the silent no-op this guard exists for.');
  check('a menu Delete asks first (destructive confirm)',
    /showAlert\([^)]*Delete[\s\S]{0,400}style:\s*'destructive'[\s\S]{0,120}deletePunchItem\(/.test(sheet),
    'a red Delete must really delete — after a confirm.');
  check('Copy link / Share pass the runtime origin',
    /getEntityDeepLink\(entityRef,\s*runtimeOrigin\(\)\)/.test(sheet) && /getEntityShareBody\(entityRef,\s*title,\s*runtimeOrigin\(\)\)/.test(sheet));

  const actions = read('utils/entityActions.ts');
  check('entityActions no longer builds links on the app scheme',
    !/PRIMARY_SCHEME/.test(actions), 'mageid:// links open nothing on a desk.');

  const home = read('app/(tabs)/(home)/index.tsx');
  check('Home names the verb its onAction performs',
    /callerVerbs=\{actionSheetRef\?\.kind === 'project' \? \['duplicate'\] : \[\]\}/.test(home),
    'without callerVerbs the sheet hides Home’s working Duplicate.');

  const layout = read('app/_layout.tsx');
  check('the auth gate stashes the query string with the bounced path',
    /setPendingDeepLink\(pathname \+ pendingLinkQuery\(/.test(layout),
    'usePathname() has no query; a shared https link would replay onto an empty screen.');
}

console.log('');
if (failures > 0) {
  console.error(`✗ validate-entity-action-menu: ${failures} failure(s) — the row menu offers a verb that does nothing, or a link that opens nothing.\n`);
  process.exit(1);
}
console.log(`✓ validate-entity-action-menu: ${passes} checks — every menu verb runs, and every link opens in a browser.\n`);
