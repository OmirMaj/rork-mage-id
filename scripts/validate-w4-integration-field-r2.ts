// validate-w4-integration-field-r2.ts — wave 4 integration fix, round 2, the
// FIELD lens. Run via: bun run scripts/validate-w4-integration-field-r2.ts
//
//   A. (blocker) the schedule stamp helper is executable by `authenticated`.
//      The SECURITY INVOKER trigger projects_keep_newer_field_progress calls
//      schedule_field_stamp_ts as the caller; production's default ACL gave it
//      to service_role only, so after the first stamped edit every schedule
//      save of that job was refused 42501. (Executed on the production-ACL
//      PGlite harness in the scratchpad; pinned statically here.)
//   B. Discard of a never-saved time entry takes the shift off the phone. A
//      re-pull cannot: the pull keeps a local row the server lacks until it
//      was seen there, and a refused insert never is.
//   C. The field-ticket loader uses the device-copy rule (a dead blob: URL is
//      not kept) and merges with the keep set instead of replacing the list.
//   D. The punch pane's plan close-up keeps its marker inside the clipping box
//      near an edge, and restarts when the pin moves to another sheet.
//   E. The export's full-sheet marker near the top hangs below the pin, off
//      the "N items on M markers" caption.
//   F. A punch reject is stamped later than the item's previous reject, so a
//      device clock behind that stamp is not neutralised by punch_items_guard.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mergeServerPull, timeEntryGoneFromServer, dropDiscardedTimeEntryCreates } from '../utils/timeClockPayroll';
import { closeUpMarkerPlacement } from '../utils/punchEditLayout';
import { PIN_MARKER_SIZE } from '../utils/punchPlanPin';
import { planPinClass, PLAN_PIN_BELOW_Y, PUNCH_EXPORT_CSS } from '../utils/punchExportHtml';
import { punchStatusPatch, punchRejectStamp, latestRejectedAt } from '../utils/punchGcCore';
import type { TimeEntry } from '../types';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const slice = (src: string, start: string, end: string) => {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
};

console.log('\nA. schedule_field_stamp_ts grant (blocker)');
{
  const mig = read('supabase/migrations/20260920160000_field_update_returns_stamps.sql');
  ok('granted to authenticated + service_role', /grant execute on function public\.schedule_field_stamp_ts\(text\) to authenticated, service_role;/.test(mig));
  ok('never to anon / PUBLIC', /revoke all on function public\.schedule_field_stamp_ts\(text\) from public, anon;/.test(mig)
    && !/grant execute on function public\.schedule_field_stamp_ts\(text\) to [^;]*\banon\b/.test(mig));
}

console.log('\nB. Discard removes a never-saved time entry');
{
  const P = 'b1b2c3d4-0000-4000-8000-000000000002';
  const refused = { id: 'a1b2c3d4-0000-4000-8000-000000000001', projectId: P, workerName: 'Ana', status: 'clocked_out', totalHours: 8.5 } as TimeEntry;
  const landed = { id: 'a1b2c3d4-0000-4000-8000-000000000003', projectId: P, workerName: 'Ben', status: 'clocked_out', totalHours: 8, seenOnServerAt: '2026-09-20T12:00:00Z' } as TimeEntry;
  const edited = { id: 'a1b2c3d4-0000-4000-8000-000000000004', projectId: P, workerName: 'Cal', status: 'clocked_out', totalHours: 7 } as TimeEntry;
  const discarded = [
    { table: 'time_entries', operation: 'insert', recordId: refused.id },
    { table: 'time_entries', operation: 'update', recordId: edited.id },
    { table: 'time_entries', operation: 'insert', recordId: landed.id },
  ];
  const none = new Set<string>();
  const after = dropDiscardedTimeEntryCreates([refused, landed, edited], discarded, none);
  const pulled = mergeServerPull(after, [landed], none, new Set(), {
    seenAt: '2026-09-23T00:00:00Z', pruneMissing: e => timeEntryGoneFromServer(e, none, true),
  });
  ok('the refused, discarded clock-in is gone after the discard + a complete pull', !pulled.some(e => e.id === refused.id));
  ok('a shift the server has (seenOnServerAt) is never removed by a discard', pulled.some(e => e.id === landed.id));
  ok('a discarded EDIT removes nothing (the pull restores MAGE\'s copy)', after.some(e => e.id === edited.id));
  ok('a create still queued / unsaved elsewhere is kept', dropDiscardedTimeEntryCreates([refused], discarded, new Set([refused.id])).length === 1);
  ok('another table\'s discard removes nothing', dropDiscardedTimeEntryCreates([refused], [{ table: 'daily_reports', operation: 'insert', recordId: refused.id }], none).length === 1);
  const TE = read('hooks/useTimeEntries.ts');
  const disc = slice(TE, 'useEffect(() => onUnsavedDiscarded(discarded => {', '\n  }), []);');
  ok('the store drops the discarded creates, reading the queue + ledger first, then re-pulls',
    /const \{ pending \} = await readTimeEntryQueue\(\);/.test(disc)
      && /setEntries\(prev => dropDiscardedTimeEntryCreates\(prev, discarded, pending\)\);/.test(disc)
      && /setAlertReconcileNonce\(n => n \+ 1\);/.test(disc) && /setPullNonce\(n => n \+ 1\);/.test(disc));
  const rq = slice(TE, 'async function readTimeEntryQueue(', '\n}\n');
  ok('both time-entry pulls keep Not-saved shifts (readTimeEntryQueue unions the ledger)', /await unsavedWriteIds\('time_entries'\)/.test(rq)
    && (TE.match(/await readTimeEntryQueue\(\)/g) ?? []).length >= 3);
  const SC = read('contexts/SafetyContext.tsx');
  ok('safety re-reads keep Not-saved rows', /new Set\(\[\.\.\.pendingIdsForTable\(queue, table\), \.\.\.unsaved\]\)/.test(SC));
}

console.log('\nC. field-ticket loader');
{
  const PC = read('contexts/ProjectContext.tsx');
  const q = slice(PC, "queryKey: ['fieldTickets', userId],", "return loadLocal<FieldTicket[]>(FIELD_TICKETS_KEY, []);");
  ok('a device copy is kept only through deviceCopyForServerRow (path + openable)',
    /deviceCopyForServerRow\(ticketPriorLocal\.get\(p\.id\), p\.uri\)/.test(q) && /ticketPriorLocal\.set\(p\.id, \{ local, path: p\.storagePath \}\)/.test(q)
      && !/if \(local\) localUriById\.set\(p\.id, local\)/.test(q));
  ok('the server list is merged with queued + unsaved + touched ids, never swapped in wholesale',
    /mergeLocalOnly\(\s*mapped,\s*priorTickets,\s*new Set\(\[\.\.\.await queuedIdsFor\('field_tickets'\), \.\.\.await unsavedWriteIds\('field_tickets'\), \.\.\.touchedFt\.keep\]\)/.test(q)
      && /deletedIds: new Set\(\[\.\.\.await queuedDeletesFor\('field_tickets'\), \.\.\.touchedFt\.gone\]\)/.test(q)
      && /saveOwnedLocal\(userId, FIELD_TICKETS_KEY, merged\);\s*return merged;/.test(q) && !/saveOwnedLocal\(userId, FIELD_TICKETS_KEY, mapped\)/.test(q)
      && /const readStartedAt = Date\.now\(\);\s*const \{ data, error \} = await supabase\.from\('field_tickets'\)/.test(q));
  ok('ticket writes are touched so a read already on the wire keeps them',
    /touchedWrite\(proDocWriteTouchRef, finalTicket\.id, \(\) => supabaseWrite\('field_tickets', 'insert'/.test(PC)
      && /touchedWrite\(proDocWriteTouchRef, id, \(\) => supabaseWrite\('field_tickets', 'update'/.test(PC));
}

console.log('\nD. punch pane close-up marker');
{
  const S = 250;
  const top = closeUpMarkerPlacement(0.5, 0.055, S, PIN_MARKER_SIZE);
  ok('a pin near the top hangs below (never above the clipping box)', top.below && top.top >= 0, JSON.stringify(top));
  const mid = closeUpMarkerPlacement(0.5, 0.5, S, PIN_MARKER_SIZE);
  ok('a mid pin is unchanged: centred, head above, tip on the pin',
    !mid.below && mid.align === 'center' && mid.left === 0.5 * S - PIN_MARKER_SIZE / 2 && mid.top === 0.5 * S - PIN_MARKER_SIZE);
  const l = closeUpMarkerPlacement(0.01, 0.5, S, PIN_MARKER_SIZE);
  const r = closeUpMarkerPlacement(0.99, 0.5, S, PIN_MARKER_SIZE);
  ok('near the left edge the head runs inward (starts at the pin)', l.align === 'start' && l.left >= -4 && l.left + PIN_MARKER_SIZE <= S);
  ok('near the right edge the head runs inward (ends at the pin)', r.align === 'end' && r.left + PIN_MARKER_SIZE <= S + 4);
  const P = read('components/punch/PunchEditPanes.tsx');
  ok('the pane draws the marker from closeUpMarkerPlacement with the below / start / end styles',
    /closeUpMarkerPlacement\(w\.pinX, w\.pinY, side, PIN_MARKER_SIZE\)/.test(P) && /\{ left: mark\.left, top: mark\.top \}/.test(P) && /mark\.below && styles\.markerBelow/.test(P)
      && /mark\.below \? styles\.markerTailUp : styles\.markerTail/.test(P) && !/top: w\.pinY \* side - PIN_MARKER_SIZE/.test(P));
  ok('PinCloseUp is keyed by the sheet image (its failed/shape state restarts)', /<PinCloseUp key=\{p\.pin\.imageUri\}/.test(P));
}

console.log('\nE. export full-sheet marker near the top');
{
  ok('a pin at y 0.01 hangs below', planPinClass(0.01, false) === 'pe-pin pe-pin-below');
  ok('a pin under the line is unchanged', planPinClass(PLAN_PIN_BELOW_Y + 0.01, false) === 'pe-pin' && planPinClass(0.5, true) === 'pe-pin pe-pin-closed');
  ok('the CSS turns it (tail up, no upward translate)',
    /\.pe-pin-below \{ flex-direction: column-reverse; transform: translate\(-50%,0\)/.test(PUNCH_EXPORT_CSS)
      && /\.pe-pin-below \.pe-pin-tail \{ border-top: 0; border-bottom: 6px solid/.test(PUNCH_EXPORT_CSS));
  ok('markersHtml uses planPinClass', /<div class="\$\{planPinClass\(m\.y, !!m\.allClosed\)\}"/.test(read('utils/punchExportHtml.ts')));
}

console.log('\nF. punch reject stamp survives a slow clock');
{
  const now = '2026-09-23T10:00:00.000Z';
  const ahead = '2026-09-23T10:05:00.000Z';
  ok('previous reject later than this clock → prev + 1 ms', punchRejectStamp(now, ahead) === '2026-09-23T10:05:00.001Z');
  ok('previous reject earlier → now', punchRejectStamp(now, '2026-09-22T10:00:00.000Z') === now);
  ok('no / unparseable previous reject → now', punchRejectStamp(now, undefined) === now && punchRejectStamp(now, 'junk') === now);
  const patch = punchStatusPatch({ status: 'ready_for_review', rejectedAt: ahead }, 'open', now, 'Paint drips');
  ok('punchStatusPatch stamps a reject later than the item\'s previous one', !!patch.rejectedAt && Date.parse(patch.rejectedAt) > Date.parse(ahead));
  ok('a batch stamp is later than every selected item\'s previous reject',
    latestRejectedAt([{ rejectedAt: '2026-09-23T09:00:00.000Z' }, { rejectedAt: ahead }, {}]) === ahead);
  const PL = read('app/punch-list.tsx');
  ok('the Reject modal passes the item\'s rejectedAt', /punchStatusPatch\(\{ status: item\?\.status \?\? 'ready_for_review', rejectedAt: item\?\.rejectedAt \}, 'open'/.test(PL));
  ok('the bulk send-back passes the latest previous reject', /punchStatusPatch\(\{ status: 'ready_for_review', rejectedAt: latestRejectedAt\(rejectItems\) \}, next, nowIso\)/.test(PL));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
