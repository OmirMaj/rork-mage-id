// validate-w4-integration-docs-team-server-r2 — integration round 2, lens
// docs-team-server.
//
//   A. signed-media-urls rfi_sheets signs only the plan sheets the RFI row
//      itself references. It used to sign ANY key inside the RFI's project
//      folder that the caller named, so one RFI's reply link could mint
//      1-hour links for every other sheet in the job whose key its holder
//      knew — harmless while plan-sheets is public, a leak the moment the held
//      privatise migration lands. The set is the RFI's attachments plus the
//      sheets under drawing pins linked to it (get_rfi_by_token's pin_marks).
//   B. (blocker, fixed by the field fixer this round — re-pinned here because
//      it is this lens's blocker) the unapplied 20260920160000 grants EXECUTE
//      on schedule_field_stamp_ts to authenticated, so the SECURITY INVOKER
//      trigger projects_keep_newer_field_progress can call it for an owner's
//      schedule save once any task carries a field stamp.
//
// Run: bun run scripts/validate-w4-integration-docs-team-server-r2.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rfiReferencedSheetKeys, rfiSheetKeysToSign } from '../supabase/functions/signed-media-urls/core';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const P = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const HOST = 'https://ref.supabase.co';

// ── A. rfi_sheets: only what the RFI references ─────────────────────────────
console.log('\nA. rfi_sheets signs only the sheets the RFI references');
{
  const attachments = [
    `${P}/sheets/A-101.png`,                                               // the app's durable key (#93)
    `${HOST}/storage/v1/object/public/plan-sheets/${P}/sheets/A-102.png`,  // a legacy public link
    `${OTHER}/sheets/X-1.png`,                                             // another tenant's key written into the row
    { uri: `${P}/sheets/obj.png` },                                        // not a string: ignored, like the page does
    `${HOST}/storage/v1/object/public/project-photos/${P}/p.jpg`,          // a photo link, not a sheet
  ];
  const pinSheets = [`${P}/sheets/S-201.png`, null, 7];
  const ref = rfiReferencedSheetKeys(attachments, pinSheets, P);
  check('attachment key is referenced', ref.has(`${P}/sheets/A-101.png`));
  check('legacy public attachment link reduces to its key', ref.has(`${P}/sheets/A-102.png`));
  check('a linked pin\'s sheet is referenced', ref.has(`${P}/sheets/S-201.png`));
  check('another project\'s key in attachments is never referenced', !ref.has(`${OTHER}/sheets/X-1.png`));
  check('non-string entries and photo links add nothing', ref.size === 3, JSON.stringify([...ref]));

  // The critic's probe: a reply-link holder names an unreferenced sheet in the
  // same project folder. It must not be signed.
  const asked = [
    `${P}/sheets/A-101.png`,
    `/${P}/sheets/A-101.png`,           // same key, the caller's own spelling
    `${P}/sheets/SECRET-900.png`,       // in the folder, NOT referenced by this RFI
    `${P}/sheets/S-201.png`,
    `${OTHER}/sheets/X-1.png`,
    `${P}/../${OTHER}/sheets/X-1.png`,
  ];
  const plan = rfiSheetKeysToSign(asked, P, ref);
  check('an unreferenced key in the RFI\'s project folder is refused (the probe)', !plan.has(`${P}/sheets/SECRET-900.png`), JSON.stringify([...plan.keys()]));
  check('referenced keys are signed, grouped by key with every asked spelling',
    JSON.stringify(plan.get(`${P}/sheets/A-101.png`)) === JSON.stringify([`${P}/sheets/A-101.png`, `/${P}/sheets/A-101.png`]) && plan.has(`${P}/sheets/S-201.png`));
  check('other-project and traversal keys stay refused', !plan.has(`${OTHER}/sheets/X-1.png`) && plan.size === 2, JSON.stringify([...plan.keys()]));
  check('an RFI with no attachments and no pins signs nothing', rfiSheetKeysToSign(asked, P, rfiReferencedSheetKeys([], [], P)).size === 0);
  check('a non-array attachments value is treated as none', rfiReferencedSheetKeys(null, [], P).size === 0 && rfiReferencedSheetKeys('x', [], P).size === 0);

  const INDEX = read('supabase/functions/signed-media-urls/index.ts');
  check('index.ts reads the RFI\'s attachments with the share token lookup', /\.from\("rfis"\)\.select\("id, project_id, attachments"\)\.eq\("share_token", req\.shareToken\)/.test(INDEX));
  check('index.ts reads the drawing pins linked to THIS RFI', /\.from\("drawing_pins"\)\.select\("plan_sheet_id, x, y"\)\.eq\("linked_rfi_id", rfiId\)/.test(INDEX));
  check('pins are filtered like get_rfi_by_token (x and y within the sheet)', /isUuid\(p\.plan_sheet_id\) && inUnit\(p\.x\) && inUnit\(p\.y\)/.test(INDEX));
  check('pin sheets come from plan_sheets.image_uri', /\.from\("plan_sheets"\)\.select\("id, image_uri"\)\.in\("id", sheetIds\)/.test(INDEX));
  check('index.ts signs only the intersection', /const referenced = rfiReferencedSheetKeys\(row\?\.attachments, pinSheetPaths, projectId\);/.test(INDEX) && /const byKey = rfiSheetKeysToSign\(req\.paths, projectId, referenced\);/.test(INDEX));
  check('index.ts no longer builds the signing set from the caller\'s paths alone', !/rfiSheetKey\(p, projectId\)/.test(INDEX));
  check('a pin or sheet read failure is 503, never a partial sign', /pin read failed[\s\S]{0,80}return json\(\{ error: "unavailable" \}, 503\)/.test(INDEX) && /sheet read failed[\s\S]{0,80}return json\(\{ error: "unavailable" \}, 503\)/.test(INDEX));

  // get_rfi_by_token must still return the same rows the function reads.
  const SQL = read('supabase/migrations/20260920190000_rfi_submittal_answers_kept.sql');
  check('get_rfi_by_token still returns attachments + pin sheets (the page\'s source)', /'attachments', r\.attachments/.test(SQL) && /'sheet_path', ps\.image_uri/.test(SQL) && /where dp\.linked_rfi_id = r\.id/.test(SQL));
  // The architect page sends the keys of its attachments — the same set.
  const HTML = read('marketing/architect/index.html');
  check('the architect page asks only for its attachments\' sheet keys', /signSheets\(sheetKeysOf\(data\.attachments\)\)/.test(HTML));
}

// ── B. schedule_field_stamp_ts is executable by the invoker trigger ─────────
console.log('\nB. the owner\'s schedule save can call schedule_field_stamp_ts');
{
  const MIG = read('supabase/migrations/20260920160000_field_update_returns_stamps.sql');
  check('authenticated gets EXECUTE on schedule_field_stamp_ts(text)',
    /grant execute on function public\.schedule_field_stamp_ts\(text\) to authenticated/.test(MIG));
  check('anon / PUBLIC stay out', /revoke all on function public\.schedule_field_stamp_ts\(text\) from public, anon;/.test(MIG));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
