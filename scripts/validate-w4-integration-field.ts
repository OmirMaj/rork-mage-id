// validate-w4-integration-field.ts — wave 4 integration round 1, lens "field".
//
// Pins two fixes whose logic lives in pure modules the smoke suite also
// exercises end to end (__tests__/smoke/punch-photo-server-truth.test.tsx and
// __tests__/smoke/field-seat-draft-portal-state.test.tsx):
//
//   F1  A device's own copy of a photo is kept on a load ONLY while it belongs
//       to the object the server row names and can still be opened. A web
//       Replace / Remove elsewhere reaches the phone that took the original,
//       and a blob: URL from a previous browser tab gives way to the signed
//       path (utils/deviceLocalCopy, used by the punch, gallery and DFR
//       loaders; blob: copies are noted by queuePhotoUpload).
//   #59 A field or viewer seat's daily report / photo is a DRAFT on his own
//       phone from the first render, as the server trigger stores it
//       (utils/projectContextPure.fieldSeatCreatesDraft, read by
//       ProjectContext.initialPortalState).
//
// Run via: bun run scripts/validate-w4-integration-field.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deviceCopyForServerRow, localCopyOpenable, noteSessionLocalUri, resetSessionLocalUrisForTest,
} from '../utils/deviceLocalCopy';
import { fieldSeatCreatesDraft } from '../utils/projectContextPure';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FILE = 'file:///var/mobile/Documents/pending/u_p_punch-1.jpg';
const OLD = 'u/p/punch-punch-1.jpg';
const NEW = 'u/p/punch-punch-1-rmfabc12.png';
const BLOB = 'blob:https://app.mageid.app/0b1c2d3e';

console.log('\nF1. which device copy a freshly-read row may keep');
{
  resetSessionLocalUrisForTest();
  ok('the phone that took it keeps its copy while the row still names that object',
    deviceCopyForServerRow({ local: FILE, path: OLD }, OLD) === FILE);
  ok('a web Replace (row names a NEW object) → the copy is dropped',
    deviceCopyForServerRow({ local: FILE, path: OLD }, NEW) === undefined);
  ok('a web Remove (row NULL / empty) → the copy is dropped, so the photo clears',
    deviceCopyForServerRow({ local: FILE, path: OLD }, null) === undefined && deviceCopyForServerRow({ local: FILE, path: OLD }, '') === undefined);
  ok('a blob: from a previous tab (not noted this session) is dead → dropped even when the path matches',
    deviceCopyForServerRow({ local: BLOB, path: NEW }, NEW) === undefined && !localCopyOpenable(BLOB));
  noteSessionLocalUri(BLOB);
  ok('a blob: staged in THIS page session is kept', deviceCopyForServerRow({ local: BLOB, path: NEW }, NEW) === BLOB && localCopyOpenable(BLOB));
  ok('…but still not across a Replace', deviceCopyForServerRow({ local: BLOB, path: NEW }, OLD) === undefined);
  resetSessionLocalUrisForTest();
  ok('a never-staged legacy copy is kept only while the row still holds exactly it',
    deviceCopyForServerRow({ local: FILE }, FILE) === FILE && deviceCopyForServerRow({ local: FILE }, OLD) === undefined);
  ok('a remote URL is never a device copy', deviceCopyForServerRow({ local: 'https://x/y.jpg', path: OLD }, OLD) === undefined);
  ok('no prior copy → nothing kept', deviceCopyForServerRow(undefined, OLD) === undefined);
}

console.log('\nF1. every loader and the upload queue use it');
{
  const pc = strip(read('contexts/ProjectContext.tsx'));
  ok('ProjectContext imports the rule', /import \{ deviceCopyForServerRow, type PriorDeviceCopy \} from '@\/utils\/deviceLocalCopy';/.test(pc));
  ok('punch loader: prior copy carries its path; kept only via deviceCopyForServerRow(…, r.photo_uri)',
    /priorLocal\.set\(p\.id, \{ local, path: p\.photoStoragePath \}\);/.test(pc)
      && /deviceCopyForServerRow\(priorLocal\.get\(r\.id as string\), r\.photo_uri as string \| null \| undefined\)/.test(pc));
  ok('gallery loader: same rule on photos.uri',
    /priorLocal\.set\(p\.id, \{ local, path: p\.storagePath \}\);/.test(pc)
      && /deviceCopyForServerRow\(priorLocal\.get\(r\.id as string\), r\.uri as string \| null \| undefined\)/.test(pc));
  ok('DFR photo loader: same rule per nested photo',
    /dfrPriorLocal\.set\(p\.id, \{ local, path: p\.storagePath \}\);/.test(pc)
      && /deviceCopyForServerRow\(dfrPriorLocal\.get\(p\.id\), p\.uri\)/.test(pc));
  ok('no loader still keeps a prior local copy unconditionally',
    !/if \(local\) cachedLocal\.set\(p\.id, local\);/.test(pc) && !/if \(local\) dfrLocalUri\.set\(p\.id, local\);/.test(pc));
  const q = strip(read('utils/photoUploadQueue.ts'));
  const qp = q.slice(q.indexOf('export async function queuePhotoUpload('), q.indexOf('export async function queuePhotoUpload(') + 400);
  ok('queuePhotoUpload notes the copy BEFORE any early return',
    /\{\s*noteSessionLocalUri\(input\.localUri\);\s*if \(!isSupabaseConfigured\) return;/.test(qp));
}

console.log('\n#59 a field / viewer seat\'s report or photo opens as a draft');
{
  ok('field seat: daily report and photo → draft', fieldSeatCreatesDraft('daily_report', 'field') && fieldSeatCreatesDraft('photo', 'field'));
  ok('viewer seat: daily report and photo → draft', fieldSeatCreatesDraft('daily_report', 'viewer') && fieldSeatCreatesDraft('photo', 'viewer'));
  ok('owner / editor keep autoShare', !fieldSeatCreatesDraft('daily_report', undefined) && !fieldSeatCreatesDraft('photo', 'owner') && !fieldSeatCreatesDraft('photo', 'editor'));
  ok('other kinds are untouched (selections / warranties follow autoShare)', !fieldSeatCreatesDraft('selection', 'field') && !fieldSeatCreatesDraft('warranty', 'viewer'));
  const pc = strip(read('contexts/ProjectContext.tsx'));
  const ips = pc.slice(pc.indexOf('const initialPortalState = useCallback('), pc.indexOf('const initialPortalState = useCallback(') + 1600);
  ok('initialPortalState asks it before autoShare', /const proj = projects\.find\(p => p\.id === projectId\);\s*if \(fieldSeatCreatesDraft\(kind, proj\?\.myRole\)\) return \{ status: 'draft' \};\s*const auto = /.test(ips));
  const mig = read('supabase/migrations/20260920140000_dfr_field_drafts_and_submit_notify.sql');
  ok('…matching the server rule it mirrors (an INSERT by a non-owner/non-editor becomes draft)',
    /if public\.can_access_project\(NEW\.project_id, 'editor'\) then/.test(mig) && /NEW\.portal_state := jsonb_build_object\('status', 'draft'\);/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
