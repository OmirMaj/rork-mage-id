// validate-w5-join-core-mappers.ts — wave 5, lane w5-join-core.
//
// The columns the chain lanes added on the server that nothing on the phone
// read or wrote, and the rows that were written WHOLE when only a part changed:
//
//   #27 / CONTRACT 17  subcontractors.legal_name, tax_id_last4,
//        license_verified_at, coi_verified_at, w9_doc_path ⇄ Subcontractor —
//        read on load, written on add / edit / bulk import, only when this copy
//        holds a value (a stale copy never nulls another device's stamp);
//        coi_last_warned_for (the watcher's marker) never.
//   #65 / CONTRACT 18  photos.latitude, longitude, location_accuracy_meters,
//        location_label ⇄ ProjectPhoto — insert / update / read; never an
//        update that is `{ id }` alone.
//   #70 / CONTRACT 19  crew_members updates carry ONLY the changed columns.
//   #82 / CONTRACT 13  the owner's projects upsert never carries the portal
//        key (the collaborator guard, stripPortalCredentials, stays).
//   #24               a prequal REVIEW writes only the reviewer's columns.
//   #1 / CONTRACT 21   a job only on this phone becomes a Not-saved line with
//        its INSERT row — never resent automatically; Discard takes it off.
//   CONTRACT 27        the lanes' *W5 aliases are folded into types/index.ts.
//
// Behavioural over utils/projectContextPure (round-trips); source pins where
// the provider is the only seam.
//
// Run via: bun run scripts/validate-w5-join-core-mappers.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  subcontractorExtrasFromRow, subcontractorExtraColumns, photoGeoFromRow, photoGeoColumns,
  crewMemberUpdateRow, CREW_MEMBER_COLUMNS, prequalReviewRow, ownerClientPortalForWrite, stripPortalCredentials,
  localOnlyOwnedProjectIds, localOnlyProjectInsertRow, localOnlyProjectLineId, LOCAL_ONLY_PROJECT_REASON, withServerConfirmed,
  coiSaveStampsVerified,
} from '../utils/projectContextPure';
import type { Project, Subcontractor, ProjectPhoto, CrewMember } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const PC = read('contexts/ProjectContext.tsx');

// ── #27 / CONTRACT 17 ────────────────────────────────────────────────────────
console.log('\n#27 subcontractor 1099 / verification / W-9 columns');
{
  const row = { legal_name: 'Acme Framing LLC', tax_id_last4: '1234', license_verified_at: '2026-09-01T12:00:00Z', coi_verified_at: '2026-09-02T12:00:00Z', w9_doc_path: 's1/w9-1.pdf', coi_last_warned_for: '2026-10-01' };
  const sub = subcontractorExtrasFromRow(row);
  ok('row → Subcontractor reads all five', same(sub, { legalName: 'Acme Framing LLC', taxIdLast4: '1234', licenseVerifiedAt: '2026-09-01T12:00:00Z', coiVerifiedAt: '2026-09-02T12:00:00Z', w9DocPath: 's1/w9-1.pdf' }));
  const cols = subcontractorExtraColumns(sub);
  ok('Subcontractor → row round-trips the five', same(cols, { legal_name: 'Acme Framing LLC', tax_id_last4: '1234', license_verified_at: '2026-09-01T12:00:00Z', coi_verified_at: '2026-09-02T12:00:00Z', w9_doc_path: 's1/w9-1.pdf' }));
  ok('coi_last_warned_for is never read into the sub nor written back', !('coiLastWarnedFor' in sub) && !('coi_last_warned_for' in cols));
  ok('a copy that holds none of them sends none (never nulls another device\'s stamp)', same(subcontractorExtraColumns({ companyName: 'X' } as Partial<Subcontractor>), {}));
  ok('a null column reads as absent', same(subcontractorExtrasFromRow({ legal_name: null, tax_id_last4: null }), { legalName: undefined, taxIdLast4: undefined, licenseVerifiedAt: undefined, coiVerifiedAt: undefined, w9DocPath: undefined }));
  ok('a partial TIN ("12") is not sent (the CHECK would refuse the whole edit)', !('tax_id_last4' in subcontractorExtraColumns({ taxIdLast4: '12' })));
  ok('a cleared TIN ("") goes as null — a deliberate clear', subcontractorExtraColumns({ taxIdLast4: '' }).tax_id_last4 === null);
  ok('four digits with spaces are trimmed and sent', subcontractorExtraColumns({ taxIdLast4: ' 9876 ' }).tax_id_last4 === '9876');

  const subsQ = PC.slice(PC.indexOf("queryKey: ['subcontractors', userId],"), PC.indexOf('const punchItemsQuery = useQuery({'));
  ok('the subs load maps them (subcontractorExtrasFromRow)', /\.\.\.subcontractorExtrasFromRow\(r\),/.test(subsQ));
  const add = PC.slice(PC.indexOf('const addSubcontractor = useCallback('), PC.indexOf('const updateSubcontractor = useCallback('));
  const upd = PC.slice(PC.indexOf('const updateSubcontractor = useCallback('), PC.indexOf('const deleteSubcontractor = useCallback('));
  ok('add sends them (defined only)', /\.\.\.subcontractorExtraColumns\(sub\),/.test(add));
  ok('edit sends them (defined only)', /\.\.\.subcontractorExtraColumns\(s\),/.test(upd));
  const imp = PC.slice(PC.indexOf('if (payload.subcontractors?.length) {'), PC.indexOf('result.subcontractors = add.length;'));
  ok('the bulk import sends them', /\.\.\.subcontractorExtraColumns\(s\),/.test(imp));
  ok('no write names coi_last_warned_for', !/coi_last_warned_for/.test(PC));
}

// ── coi-subs · an unconfirmed AI read never stamps "COI verified" ────────────
console.log('\ncoi-subs — coiVerifiedAt only for a certificate with no unconfirmed AI coverage');
{
  ok('a manual certificate stamps', coiSaveStampsVerified({ coverages: [{ type: 'general_liability', source: 'manual', expiresAt: '2027-01-01' }] }));
  ok('a legacy certificate (no source) stamps', coiSaveStampsVerified({ coverages: [{ type: 'auto', expiresAt: '2027-01-01' }] }));
  ok('one AI-read coverage holds the stamp back', !coiSaveStampsVerified({ coverages: [{ type: 'general_liability', source: 'manual' }, { type: 'auto', source: 'ai', aiExpiresAt: '2027-01-01' }] }));
  ok('addCOI / updateCOI pass it (not a literal true)',
    /syncSubCoiExpiry\(coi\.subcontractorId, updated, coiSaveStampsVerified\(coi\)\);/.test(PC)
      && /syncSubCoiExpiry\(merged\.subcontractorId, updated, coiSaveStampsVerified\(merged\)\);/.test(PC)
      && !/syncSubCoiExpiry\([^)]*, true\)/.test(PC));
  const across = read('utils/projectContextPure.ts');
  const earliest = across.slice(across.indexOf('export function earliestCoverageExpiry('), across.indexOf('export function subCoiExpiryAcross('));
  ok('the sub\'s expiry still reads expiresAt only — never aiExpiresAt', /c\.expiresAt/.test(earliest) && !/aiExpiresAt/.test(earliest));
}

// ── #65 / CONTRACT 18 ────────────────────────────────────────────────────────
console.log('\n#65 photo geo stamp');
{
  const row = { latitude: 30.2672, longitude: '-97.7431', location_accuracy_meters: 12.5, location_label: '1100 Congress Ave, Austin' };
  const geo = photoGeoFromRow(row);
  ok('row → ProjectPhoto (numeric text coerced)', same(geo, { latitude: 30.2672, longitude: -97.7431, locationAccuracyMeters: 12.5, locationLabel: '1100 Congress Ave, Austin' }));
  ok('ProjectPhoto → row round-trips', same(photoGeoColumns(geo), { latitude: 30.2672, longitude: -97.7431, location_accuracy_meters: 12.5, location_label: '1100 Congress Ave, Austin' }));
  ok('a photo with no fix sends nothing', same(photoGeoColumns({ id: 'x', tag: 'progress' } as Partial<ProjectPhoto>), {}));
  ok('null columns read as absent', same(photoGeoFromRow({ latitude: null, longitude: null, location_accuracy_meters: null, location_label: null }), { latitude: undefined, longitude: undefined, locationAccuracyMeters: undefined, locationLabel: undefined }));
  const photosQ = PC.slice(PC.indexOf("queryKey: ['projectPhotos', userId],"), PC.indexOf('const priceAlertsQuery = useQuery({'));
  ok('the photos load maps them', /\.\.\.photoGeoFromRow\(r\),/.test(photosQ));
  const addP = PC.slice(PC.indexOf('const addProjectPhoto = useCallback('), PC.indexOf('const deleteProjectPhoto = useCallback('));
  ok('insert sends them', /\.\.\.photoGeoColumns\(finalPhoto\),/.test(addP));
  const updP = PC.slice(PC.indexOf('const updateProjectPhoto = useCallback('), PC.indexOf('const getPhotosForProject = useCallback('));
  ok('update sends the ones passed, and never an `{ id }`-only patch',
    /Object\.assign\(patch, photoGeoColumns\(updates\)\);/.test(updP) && /if \(Object\.keys\(patch\)\.length > 1\) \{/.test(updP));
  // #65 late stamp: project-detail patches the GPS fix 1-4.5 s after capture
  // through the updateProjectPhoto it captured at tap time. Mapping that
  // closure's stale `projectPhotos` dropped the just-added photo from the
  // gallery and the device cache; the patch must compose on the live list.
  const updCode = updP.replace(/\/\/.*$/gm, '');
  ok('a late photo patch composes on the live list (functional setter), never the closure copy',
    /setProjectPhotos\(prev => \{[\s\S]*?prev\.map\(/.test(updCode) && !/\bprojectPhotos\.(map|find)\(/.test(updCode) && !/\[projectPhotos,/.test(updCode));
  const delP = PC.slice(PC.indexOf('const deleteProjectPhoto = useCallback('), PC.indexOf('const updateProjectPhoto = useCallback('));
  ok('deleting a gallery photo keeps bytes a punch item still points at (photo-ai)', /punchItemsRef\.current\.some\(pi => pi\.photoStoragePath === doomed\.storagePath\)/.test(delP));
}

// ── #70 / CONTRACT 19 ────────────────────────────────────────────────────────
console.log('\n#70 crew updates carry only what changed');
{
  const at = '2026-09-23T10:00:00.000Z';
  ok('a status toggle sends { id, status, updated_at } — no phone, email, jobs', same(crewMemberUpdateRow('c1', { status: 'inactive' }, at), { id: 'c1', status: 'inactive', updated_at: at }));
  ok('startClaimInvite sends { id, claim_token }', same(crewMemberUpdateRow('c1', { claimToken: 'tok' }, at), { id: 'c1', claim_token: 'tok', updated_at: at }));
  const scan: Partial<CrewMember> = { fullName: 'Luis Ortega', idVerified: true, idType: 'drivers_license', idMaskedLast4: '4821', idExpiry: '2029-01-01', idIssuer: 'TX', idScannedAt: at, idImagePath: undefined };
  const scanRow = crewMemberUpdateRow('c1', scan, at);
  ok('the ID-scan save sends full_name + the id_* columns only', same(Object.keys(scanRow).sort(), ['full_name', 'id', 'id_expiry', 'id_image_path', 'id_issuer', 'id_masked_last4', 'id_scanned_at', 'id_type', 'id_verified', 'updated_at']));
  ok('a key passed as undefined is a CLEAR (null), not skipped', scanRow.id_image_path === null);
  ok('owner and claim state never ride an update', same(crewMemberUpdateRow('c1', { companyUserId: 'x', claimedByUserId: 'y', claimedAt: at } as Partial<CrewMember>, at), { id: 'c1', updated_at: at }));
  ok('every column the old toRow wrote is mapped', Object.keys(CREW_MEMBER_COLUMNS).length === 20);
  const crew = read('contexts/CrewContext.tsx');
  const upd = crew.slice(crew.indexOf('const updateCrewMember = useCallback('), crew.indexOf('const deleteCrewMember = useCallback('));
  ok('updateCrewMember writes crewMemberUpdateRow, never toRow(next)',
    /supabaseWrite\('crew_members', 'update', crewMemberUpdateRow\(id, changes, next\.updatedAt\)\)/.test(upd) && !/toRow\(next\)/.test(upd));
}

// ── #82 / CONTRACT 13 ────────────────────────────────────────────────────────
console.log('\n#82 the owner upsert never carries the portal key');
{
  const cp = { enabled: true, portalId: 'pt1', accessToken: 'secret', passcode: '1234' } as unknown as Parameters<typeof ownerClientPortalForWrite>[0];
  const out = ownerClientPortalForWrite(cp) as unknown as Record<string, unknown>;
  ok('accessToken is dropped; the passcode still rides (until validate-portal-passcode reads portal_credentials)', !('accessToken' in out) && out.passcode === '1234' && out.portalId === 'pt1');
  ok('stripPortalCredentials (a collaborator\'s copy) still drops both', same(Object.keys(stripPortalCredentials(cp) ?? {}).sort(), ['enabled', 'portalId']));
  ok('the owner upsert sends ownerClientPortalForWrite(project.clientPortal)', /client_portal: ownerClientPortalForWrite\(project\.clientPortal\) as unknown,/.test(PC) && !/client_portal: project\.clientPortal as unknown/.test(PC));
}

// ── #24 ──────────────────────────────────────────────────────────────────────
console.log('\n#24 a prequal review writes only the reviewer\'s columns');
{
  const now = '2026-09-23T10:00:00.000Z';
  const row = prequalReviewRow('pk1', { status: 'approved', reviewerNotes: 'OK', reviewedAt: now, reviewedBy: 'GC', expiresAt: '2027-09-23' }, now);
  ok('approve → the reviewer columns + updated_at, nothing of the sub\'s answers',
    same(Object.keys(row).sort(), ['expires_at', 'id', 'reviewed_at', 'reviewed_by', 'reviewer_notes', 'status', 'updated_at']));
  ok('a pipeline step ({ status, updatedAt }) sends just that', same(prequalReviewRow('pk1', { status: 'under_review', updatedAt: now } as never, now), { id: 'pk1', status: 'under_review', updated_at: now }));
  const rev = PC.slice(PC.indexOf('const reviewPrequalPacket = useCallback('), PC.indexOf('const deletePrequalPacket = useCallback('));
  ok('reviewPrequalPacket queues prequalReviewRow as an UPDATE and merges locally',
    /supabaseWrite\('prequal_packets', 'update', prequalReviewRow\(id, merged, now\)\)/.test(rev) && /savePrequalMutation\.mutate\(updated\)/.test(rev) && !/prequalToRow/.test(rev));
  ok('it is on the context', /reviewPrequalPacket: \(id: string, patch: PrequalReviewPatch\) => void;/.test(PC) && /upsertPrequalPacket, reviewPrequalPacket, deletePrequalPacket/.test(PC));
  const fg = PC.slice(PC.indexOf('const refetchProDocsOnForeground = useCallback('), PC.indexOf('const refetchPortalListsOnForeground = useCallback('));
  ok("['prequalPackets', uid] joins the foreground re-read", /queryKey: \['prequalPackets', userId\]/.test(fg));
  const pq = PC.slice(PC.indexOf("queryKey: ['prequalPackets', userId],"), PC.indexOf('const dailyReportsQuery = useQuery({'));
  ok('…and the loader keeps a packet whose review is queued or under Not saved', /mergeLocalOnly\(mapped, prior,/.test(pq) && /queuedIdsFor\('prequal_packets'\)/.test(pq) && /unsavedWriteIds\('prequal_packets'\)/.test(pq));
}

// ── #1 / CONTRACT 21 · local-only jobs ────────────────────────────────────────
console.log('\n#1 a job only on this phone becomes a Not-saved line');
{
  const U = 'u1';
  const local = [
    { id: 'confirmed', ownerUserId: U },
    { id: 'refused-create', ownerUserId: U },
    { id: 'no-stamp' },
    { id: 'shared', ownerUserId: 'gc', myRole: 'editor' as const },
    { id: 'queued', ownerUserId: U },
    { id: 'unsaved', ownerUserId: U },
    { id: 'was-on-server', ownerUserId: U },
    { id: 'revoked', ownerUserId: U },
  ];
  const ids = localOnlyOwnedProjectIds({
    local, remoteIds: new Set(['confirmed']), userId: U, confirmedBefore: new Set(['was-on-server']),
    pending: new Set(['queued']), unsaved: new Set(['unsaved']), revoked: new Set(['revoked']),
  });
  // Integration round 1 (data-security): an UNSTAMPED copy gets no line. The
  // projects cache is not keyed by account, so it could be a previous
  // account's job that survived a switch, and Retry would INSERT it under
  // this user_id. Only a copy stamped ownerUserId === userId is his.
  ok('his never-confirmed STAMPED jobs with nothing out are listed', same(ids, ['refused-create']), JSON.stringify(ids));
  ok('an unstamped legacy copy (owner unknown) gets no line — Retry would insert it as his',
    !ids.includes('no-stamp')
    && same(localOnlyOwnedProjectIds({
      local: [{ id: 'legacy-owner-role', myRole: 'owner' as const }, { id: 'legacy-bare' }],
      remoteIds: new Set(), userId: U, confirmedBefore: new Set(),
      pending: new Set(), unsaved: new Set(), revoked: new Set(),
    }), []));
  ok('a job the server confirmed before (deleted elsewhere since) is never offered for re-creation', !ids.includes('was-on-server'));
  ok('a shared job, a queued one, one already under Not saved, a revoked one — none', !ids.some(i => ['shared', 'queued', 'unsaved', 'revoked'].includes(i)));
  // Fix round 1 · a job written on this device while the SELECT was out is
  // absent only because the read predates it — never "only on this phone".
  const withWritten = localOnlyOwnedProjectIds({
    local: [{ id: 'made-during-load', ownerUserId: U }, { id: 'old-refused', ownerUserId: U }],
    remoteIds: new Set(), userId: U, confirmedBefore: new Set(),
    pending: new Set(), unsaved: new Set(), revoked: new Set(), written: new Set(['made-during-load']),
  });
  ok('a job written during the load gets no line; an older refused one still does', same(withWritten, ['old-refused']));

  // Fix round 2 · a job deleted ELSEWHERE (the web, a second phone) must
  // never read as "only on this phone" — on the first load after the delete
  // or any later one. The loader keeps his own copy on the phone and
  // REPLACES the replace-on-load set with each answer, so the confirmed set
  // the rule reads must be append-only. Runs the loader's bookkeeping across
  // consecutive loads: confirmedBefore = ever ∪ serverIds, then
  // ever = ever ∪ serverIds ∪ remoteIds, serverIds = remoteIds.
  const runLoads = (answers: string[][], local: { id: string; ownerUserId?: string; financialsLoaded?: boolean }[]) => {
    let ever = new Set<string>();
    let serverIds = new Set<string>();
    const lines: string[][] = [];
    for (const answer of answers) {
      const remoteIds = new Set(answer);
      lines.push(localOnlyOwnedProjectIds({
        local, remoteIds, userId: U, confirmedBefore: withServerConfirmed(ever, serverIds),
        pending: new Set(), unsaved: new Set(), revoked: new Set(),
      }));
      ever = withServerConfirmed(withServerConfirmed(ever, serverIds), remoteIds);
      serverIds = new Set(remoteIds);
    }
    return lines;
  };
  // X was confirmed (load 0), then deleted on the web: loads 1, 2 and 3 do
  // not return it. The device copy here has NO loader stamp (created on this
  // phone, synced, deleted before this phone read it back), so only the
  // append-only set can protect it.
  const afterWebDelete = runLoads([['X'], [], [], []], [{ id: 'X', ownerUserId: U }]);
  ok('a job deleted on the web gets no line on the first load after the delete…', afterWebDelete[1].length === 0, JSON.stringify(afterWebDelete));
  ok('…nor on the second or third (the confirmed set is append-only)', afterWebDelete[2].length === 0 && afterWebDelete[3].length === 0, JSON.stringify(afterWebDelete));
  ok('…while a job the server never returned is still offered from the first load',
    same(runLoads([[], []], [{ id: 'R', ownerUserId: U }])[0], ['R']) && same(runLoads([[], []], [{ id: 'R', ownerUserId: U }])[1], ['R']));
  ok('withServerConfirmed only grows (unions, never drops what the earlier set had)',
    same([...withServerConfirmed(new Set(['a', 'b']), ['c', ''])].sort(), ['a', 'b', 'c']));
  // A job deleted elsewhere BEFORE the append-only set existed (the first
  // loads after the OTA): no set holds it, but the device copy carries the
  // loader's stamp — it was read from the server at some load.
  const preOta = localOnlyOwnedProjectIds({
    local: [{ id: 'deleted-long-ago', ownerUserId: U, financialsLoaded: true }, { id: 'blind-read', ownerUserId: U, financialsLoaded: false }, { id: 'refused', ownerUserId: U }],
    remoteIds: new Set(), userId: U, confirmedBefore: new Set(),
    pending: new Set(), unsaved: new Set(), revoked: new Set(),
  });
  ok('a device copy with the loader\'s stamp (true or false) was on the server — no line; a never-read create still gets one',
    same(preOta, ['refused']), JSON.stringify(preOta));
  ok('…every create path strips that stamp (claimProjectForUser), so a new job made from a loaded one is not mistaken for it',
    /const \{ myRole: _role, financialsLoaded: _loaded, \.\.\.rest \} = project;/.test(read('utils/projectContextPure.ts')));
  ok('the line id is stable (a later load writes the same line)', localOnlyProjectLineId('p1') === localOnlyProjectLineId('p1') && localOnlyProjectLineId('p1') !== localOnlyProjectLineId('p2'));
  ok('the reason says what happened and what Retry / Discard do', /only on this phone/.test(LOCAL_ONLY_PROJECT_REASON) && /Retry/.test(LOCAL_ONLY_PROJECT_REASON) && /Discard/.test(LOCAL_ONLY_PROJECT_REASON));

  const project = {
    id: 'p1', name: 'Henderson', type: 'renovation', location: 'Austin', squareFootage: 1200, quality: 'standard', description: '',
    status: 'active', collaborators: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', estimate: null,
    schedule: { tasks: [] }, clientPortal: { enabled: true, portalId: 'pt', accessToken: 'secret' },
  } as unknown as Project;
  const insertRow = localOnlyProjectInsertRow(project, 'u1');
  const base = PC.slice(PC.indexOf('          const base = {'), PC.indexOf('          };', PC.indexOf('          const base = {')));
  const baseKeys = [...new Set([...base.matchAll(/\b([a-z][a-z_]*):\s/g)].map(m => m[1]))];
  ok('the sync\'s base row was parsed (guard reads the right region)', baseKeys.length >= 20, baseKeys.join());
  const missing = baseKeys.filter(k => !(k in insertRow));
  ok('the INSERT carries every column the sync\'s owner row does (drift guard)', missing.length === 0, `missing: ${missing.join(', ')}`);
  ok('…plus the owner stamp, created_at, schedule and the money', ['user_id', 'created_at', 'schedule', 'estimate', 'linked_estimate', 'estimate_versions', 'target_budget'].every(k => k in insertRow));
  // Fix round 1 · both directions against the sync's OWNER upsert literal
  // (base + the owner-only columns), not a hand list: a column added to the
  // sync must reach the Retry INSERT, and the INSERT must send nothing the
  // sync does not (schedule aside — the sync sends it only on a create).
  const upAt = PC.indexOf("await supabaseWrite('projects', 'upsert', {\n                ...base, user_id: userId,");
  const ownerLit = upAt > 0 ? PC.slice(upAt, PC.indexOf('              });', upAt)) : '';
  const ownerKeys = [...new Set([...ownerLit.replace(/\/\/.*$/gm, '').matchAll(/\b([a-z][a-z_]*):\s/g)].map(m => m[1]))];
  ok('the sync\'s owner upsert literal was parsed', ownerKeys.length >= 6 && ownerKeys.includes('user_id') && ownerKeys.includes('client_portal'), ownerKeys.join());
  const missingOwner = ownerKeys.filter(k => !(k in insertRow));
  ok('the INSERT carries every owner-only column the sync\'s upsert adds', missingOwner.length === 0, `missing: ${missingOwner.join(', ')}`);
  const sent = new Set([...baseKeys, ...ownerKeys, 'schedule']);
  const extra = Object.keys(insertRow).filter(k => !sent.has(k));
  ok('…and nothing the sync\'s owner row never sends', extra.length === 0, `extra: ${extra.join(', ')}`);
  ok('the pure helper\'s doc names the validator that actually guards it',
    /validate-w5-join-core-mappers keeps its keys in step/.test(read('utils/projectContextPure.ts')) && !/validate-w5-join-core-projects/.test(read('utils/projectContextPure.ts')));
  ok('…and never the portal key', !('accessToken' in (insertRow.client_portal as Record<string, unknown>)));

  const loader = PC.slice(PC.indexOf("queryKey: ['projects', userId],"), PC.indexOf('const runOwedSettingsReread = useCallback('));
  const at = loader.indexOf('localOnlyOwnedProjectIds({');
  ok('the projects load records them as ledger lines (operation insert, the row, the reason)',
    at > 0 && /operation: 'insert' as const,/.test(loader) && /row: localOnlyProjectInsertRow\(p, userId\),/.test(loader) && /reason: LOCAL_ONLY_PROJECT_REASON,/.test(loader) && /await recordSyncFailures\(/.test(loader));
  ok('…with the confirmed set read BEFORE the load replaces it — the append-only set ∪ the replace-on-load set',
    at > 0 && loader.indexOf('const confirmedBefore = withServerConfirmed(everConfirmedProjectIdsRef.current, serverProjectIdsRef.current);') > 0
      && loader.indexOf('const confirmedBefore = withServerConfirmed(everConfirmedProjectIdsRef.current, serverProjectIdsRef.current);') < at
      && at < loader.indexOf('serverProjectIdsRef.current = new Set(remoteIds);'));
  ok('…and the confirmed set is never the replace-on-load set alone', !/const confirmedBefore = new Set\(serverProjectIdsRef\.current\);/.test(loader));
  const replaceAt = loader.indexOf('serverProjectIdsRef.current = new Set(remoteIds);');
  const everAt = loader.indexOf('everConfirmedProjectIdsRef.current = withServerConfirmed(\n              withServerConfirmed(everConfirmedProjectIdsRef.current, serverProjectIdsRef.current), remoteIds);');
  ok('the load unions the old confirmed set AND its answer into the append-only set before the replace', everAt > 0 && everAt < replaceAt);
  ok('…and persists it (append-only key, per account, mageid_ prefix)',
    /void persistEverConfirmedProjectIds\(\);/.test(loader.slice(replaceAt, replaceAt + 400))
      && PC.includes("const EVER_CONFIRMED_PROJECT_IDS_KEY = 'mageid_projects_ever_confirmed';"));
  ok('nothing ever assigns the append-only set from an answer alone (no replace)',
    ![...PC.matchAll(/everConfirmedProjectIdsRef\.current = ([^;]+);/g)].some((m) => !/^withServerConfirmed\(|^new Set\(\)$/.test(m[1].trim())));
  ok('a landed owner upsert joins the append-only set', /if \(landed && !shared && liveUserIdRef\.current === userId && !everConfirmedProjectIdsRef\.current\.has\(project\.id\)\) \{\s*everConfirmedProjectIdsRef\.current\.add\(project\.id\);\s*void persistEverConfirmedProjectIds\(\);/.test(PC));
  ok('the stored copy is written only after it was read in (seed-before-persist), and cleared on an account switch',
    /if \(!userId \|\| !everConfirmedSeededRef\.current \|\| liveUserIdRef\.current !== userId\) return;/.test(PC)
      && /everConfirmedProjectIdsRef\.current = new Set\(\);\s*everConfirmedSeededRef\.current = false;/.test(PC));
  // Fix round 1 · the exclusions are rebuilt at RECORD time (after the SELECT
  // answered), not the start-of-load sets — a job created, queued, on the
  // wire or refused while the SELECT was out gets no line.
  const rec = at > 0 ? loader.slice(loader.lastIndexOf('await seedServerProjectIds();', at), at + 400) : '';
  ok('record-time exclusions: pending re-read (debounce + in flight + own queue) after the SELECT',
    /const pendingNow = unconfirmedProjectSyncIds\(syncDebounceMap\.current, inFlightProjectSyncsRef\.current\);/.test(rec)
      && /for \(const id of await ownQueuedProjectIds\(userId\)\) pendingNow\.add\(id\);/.test(rec));
  ok('…Not saved re-read after the queue (whole + moneyOnly + deleted, and every own projects line)',
    rec.indexOf('ownQueuedProjectIds(userId)') < rec.indexOf('readSyncFailuresOrThrow()') && rec.indexOf('readSyncFailuresOrThrow()') > 0
      && /\.\.\.pinsNow\.whole, \.\.\.pinsNow\.moneyOnly, \.\.\.pinsNow\.deleted/.test(rec)
      && /f\.table === 'projects' \|\| f\.table === 'project_financials'\) && f\.recordId\) unsavedNow\.add\(f\.recordId\)/.test(rec));
  ok('…every id written after the load started is excluded',
    /for \(const \[id, seq\] of projectWriteLogRef\.current\.byId\) if \(seq > writeSeqAtStart\) writtenDuringLoad\.add\(id\);/.test(rec)
      && /pending: recordNow\.pending, unsaved: recordNow\.unsaved, revoked,\s*written: writtenDuringLoad,/.test(rec));
  ok('…the start-of-load sets are NOT what the selector is fed', !/localOnlyOwnedProjectIds\(\{[^}]*pending: pendingAtStart/.test(loader));
  ok('…a refused re-read, or an unread append-only set, records nothing this load (the safe side)', /const localOnly = recordNow && everSeeded \? localOnlyOwnedProjectIds\(\{/.test(rec)
    && /const everSeeded = await seedEverConfirmedProjectIds\(\);/.test(loader));
  ok('a stale local-only line whose job the server returned is acknowledged (not discarded), unless a Retry is on it',
    /\[\.\.\.remoteIds\]\.filter\(\(pid\) => !isRecordRetrying\('projects', pid\)\)\.map\(localOnlyProjectLineId\)/.test(rec) && /await acknowledgeSyncFailures\(stale\);/.test(rec));
  ok('…and nothing in the loader SENDS them (never auto-resent)', !/supabaseWrite(Detailed)?\('projects'/.test(loader.slice(at, loader.indexOf('serverProjectIdsRef.current = new Set(remoteIds);'))));
  const discard = PC.slice(PC.indexOf('useEffect(() => onUnsavedDiscarded((discarded) => {'), PC.indexOf('useEffect(() => onUnsavedRetried((sent) => {'));
  ok('Discard of a never-confirmed job\'s create takes the job off the phone (only once the confirmed set is known)',
    /if \(serverIdsSeededRef\.current\) \{/.test(discard) && /f\.operation !== 'insert' && f\.operation !== 'upsert'/.test(discard) && /dropLocalOnlyJobsRef\.current\(gone\)/.test(discard));
}

// ── CONTRACT 27 · the *W5 aliases are folded ─────────────────────────────────
console.log('\nCONTRACT 27 — the lanes\' *W5 aliases are folded into types/index.ts');
{
  const T = read('types/index.ts');
  ok('Subcontractor.w9DocPath', /coiVerifiedAt\?: string;[\s\S]{0,400}w9DocPath\?: string;\s*bidHistory: SubBidRecord\[\];/.test(T));
  ok('COICoverage.source / confirmedAt / aiEffectiveDate / aiExpiresAt',
    /source\?: 'ai' \| 'manual';/.test(T) && /confirmedAt\?: string;/.test(T) && /aiEffectiveDate\?: string;/.test(T) && /aiExpiresAt\?: string;/.test(T));
  ok('PublicProfileSettings.showAddress and hideStats \'address\'', /hideStats\?: \('value' \| 'duration' \| 'sqft' \| 'address'\)\[\];/.test(T) && /showAddress\?: boolean;/.test(T));
  ok("ScanRecordKind gains 'permit' | 'warranty'", /export type ScanRecordKind = 'cost' \| 'contact' \| 'sub_compliance' \| 'file_only' \| 'permit' \| 'warranty';/.test(T));
  ok('LinkedEstimateItem.priceSource', /priceSource\?: 'learned' \| 'seeded' \| 'regional';/.test(T));
  ok('ProjectPhoto carries the four geo fields', /locationAccuracyMeters\?: number;[\s\S]{0,200}locationLabel\?: string;/.test(T));
  ok('CertificateOfInsurance.fileUri describes the CONTRACT 7 formats', /'sub-documents:<subId>\/coi-<coiId>\.<ext>'/.test(T));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const rel = `${dir}/${name}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && /\b(SubcontractorW5|COICoverageW5|PublicProfileSettingsW5|PublicProfileHideKeyW5|ScanRecordKindW5|ScanDestinationW5|ScanRecordW5|LinkedEstimateItemW5)\b/.test(readFileSync(join(ROOT, rel), 'utf8'))) offenders.push(rel);
    }
  };
  for (const d of ['app', 'components', 'contexts', 'hooks', 'utils']) walk(d);
  ok('no *W5 alias is left in app/components/contexts/hooks/utils', offenders.length === 0, offenders.join(', '));
  ok('project.publicProfile is carried through the projects load (portfolio)', /publicProfile: cached\?\.publicProfile,/.test(PC));
}

console.log(`\n${failures === 0 ? '✓' : '✗'} validate-w5-join-core-mappers: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
