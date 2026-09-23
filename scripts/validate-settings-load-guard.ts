// validate-settings-load-guard.ts — a GC's real company profile is never
// replaced by DEFAULT / blank settings: not on a failed first read, not by an
// edit made while it loads, not by a launch read landing after an edit. And a
// GC on site with no signal and no cached profile is told so, with a Retry,
// instead of "One second" forever.
//
// WHY THIS EXISTS (post-ship review of 357d0a34, findings 13 / 14 / 15 / 105 /
// 106). Each of these ended in a full-row profiles UPDATE of blanks:
//   13  a failed first read resolved with DEFAULT_SETTINGS, and the data
//       effect marked it "loaded" — the ask sheet re-asked his company name
//       and the save sent '' contact details over his row;
//   14  an edit made while loading was held as a whole DEFAULT-based
//       `branding` and replaced his on arrival; Company Profile / Get
//       Verified seeded their forms from DEFAULT and saved the blanks;
//   15  the launch read landed after an edit, snapped it back on screen and
//       on the device, and the next settings write erased it on the server;
//  105  a stalled first read showed "One second" with no Retry, forever on
//       Android (OkHttp has no timeout);
//  106  Settings, Company Profile and the estimate review said "Not set"
//       about terms that had not loaded yet.
//
// The rules are pure (utils/settingsLoadGuard.ts) and EXECUTED here, then the
// call sites in ProjectContext, the gate hook and the screens are pinned to
// them, so a refactor cannot quietly route around one.
//
// Run via: bun run scripts/validate-settings-load-guard.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppSettings } from '../types';
import {
  FIRST_PROFILE_READ_TIMEOUT_MS,
  MAX_PROFILE_READ_TIMEOUT_MS,
  PROFILE_FAILED_REASON,
  PROFILE_FAILED_TITLE,
  PROFILE_LOADING_REASON,
  SAVED_TERMS_PENDING_LABEL,
  applyHeldSettings,
  firstProfileReadTimeoutMs,
  heldSettingsPatch,
  mergeHeldPatches,
  owedSettingsRereadReady,
  profileGateNotice,
  savedTermsView,
  sameSettings,
  settingsAfterRead,
  settingsHoldsBoot,
  settingsReadFallback,
  settingsRowWritePending,
} from '../utils/settingsLoadGuard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}
const j = (v: unknown) => JSON.stringify(v);

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e; continue; }
    if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}
function balanced(src: string, from: number, open = '{', close = '}'): string {
  const start = src.indexOf(open, from);
  if (start < 0 || from < 0) return '';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

// Fixtures. DEFAULT mirrors ProjectContext's DEFAULT_SETTINGS (pinned below).
const DEFAULT_BRANDING = {
  companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '',
  licenseState: '', licenseExpiry: '', tagline: '', logoUri: undefined, signatureData: undefined,
} as unknown as AppSettings['branding'];
const DEFAULTS: AppSettings = { location: 'United States', units: 'imperial', taxRate: 0, contingencyRate: 10, branding: DEFAULT_BRANDING };
const REAL: AppSettings = {
  location: 'Sacramento, CA', units: 'imperial', taxRate: 7.25, contingencyRate: 8,
  branding: {
    companyName: 'Acme Builders', contactName: 'Omar', email: 'omar@acme.test', phone: '916-555-0100',
    address: '1 Main St, Sacramento, CA 95814', licenseNumber: 'CSLB 123456', licenseState: 'CA',
    licenseExpiry: '2027-06-30', tagline: 'Built right', logoUri: 'https://x/logo.png', signatureData: ['M0 0'],
  } as AppSettings['branding'],
  digest: { enabled: true, hour: 7, timezone: 'America/Los_Angeles', channels: { email: true, in_app: true } },
  paymentSplit: { depositPct: 10, progressPct: 80, finalPct: 10 },
  warrantyMonths: 12,
};
const U = 'user-1';

// ═══ 13 — a failed read is not his profile ════════════════════════════════
console.log('\nsettings load — (13) a failed read never fakes a load');
{
  const failed = settingsReadFallback({ canSync: true, loaded: null, cached: null, defaults: DEFAULTS });
  check('failed read + no device copy → FAIL (not DEFAULT)', 'fail' in failed, j(failed));
  // Review round 2: PGRST116 ("no row") on his own profile is the read going
  // out with the ANON key after a failed token refresh (the RLS policy
  // `auth.uid() = id` then matches nothing) — every auth user has a row from
  // handle_new_user. It is a failure like any other: the fallback no longer
  // takes a "no row" input at all, so no error code can resolve DEFAULT.
  check('the fallback has no "no row → new account" door: no error code can resolve DEFAULT for a synced account',
    !/noRow|new_account|PGRST116/.test(settingsReadFallback.toString()));
  const local = settingsReadFallback({ canSync: false, loaded: null, cached: null, defaults: DEFAULTS });
  check('local-only session (no account / no backend) → DEFAULT, so it still loads', 'resolve' in local && local.source === 'local_only');
  const copy = settingsReadFallback({ canSync: true, loaded: null, cached: { branding: REAL.branding }, defaults: DEFAULTS });
  check('failed read + device copy → the copy (DEFAULT under absent keys)',
    'resolve' in copy && copy.source === 'device' && copy.resolve.branding.companyName === 'Acme Builders' && copy.resolve.location === 'United States');
  const refetch = settingsReadFallback({ canSync: true, loaded: REAL, cached: null, defaults: DEFAULTS });
  check('a failed REFETCH with his profile loaded keeps it — the SAME object (no new `settings` identity)',
    'resolve' in refetch && refetch.source === 'loaded' && refetch.resolve === REAL);

  // The sequence the finding described, on the model the context follows: no
  // copy, the read fails → nothing resolves → settingsLoaded stays false →
  // the identity step's updateSettings is HELD (no profiles write) and holds
  // only the company name he typed.
  const heldFromAsk = heldSettingsPatch(DEFAULTS, { branding: { ...DEFAULT_BRANDING, companyName: 'Acme Builders' } });
  check('a pre-load identity answer holds only the company name — no blank contact / licence rides along',
    j(heldFromAsk) === j({ branding: { companyName: 'Acme Builders' } }), j(heldFromAsk));
}

// ═══ 14 — edits made while loading ════════════════════════════════════════
console.log('\nsettings load — (14) a pre-load edit changes only what he changed');
{
  // Company Profile's state picker: mergedBidBranding(DEFAULT branding, { licenseState }).
  const picker = heldSettingsPatch(DEFAULTS, { branding: { ...DEFAULT_BRANDING, licenseState: 'AZ' } });
  check('state picker over DEFAULT holds { branding: { licenseState } } only', j(picker) === j({ branding: { licenseState: 'AZ' } }), j(picker));
  const landed = applyHeldSettings(REAL, picker);
  check('…and on arrival changes his licensing state and nothing else',
    landed.branding.licenseState === 'AZ' && landed.branding.companyName === 'Acme Builders'
    && landed.branding.phone === '916-555-0100' && landed.branding.licenseNumber === 'CSLB 123456'
    && landed.branding.logoUri === 'https://x/logo.png' && landed.location === REAL.location && landed.taxRate === REAL.taxRate);
  const logo = heldSettingsPatch(DEFAULTS, { branding: { ...DEFAULT_BRANDING, logoUri: 'data:image/png;base64,AA' } });
  const both = mergeHeldPatches(picker, logo);
  check('two held edits (state, then logo) both survive, one level deep',
    j(both) === j({ branding: { licenseState: 'AZ', logoUri: 'data:image/png;base64,AA' } }), j(both));
  const nothing = heldSettingsPatch(DEFAULTS, { branding: { ...DEFAULT_BRANDING }, biometricsEnabled: false, location: 'United States' });
  check('re-sending what the screen showed (blanks, false, the DEFAULT market) holds nothing', nothing === null, j(nothing));
  const scalar = heldSettingsPatch(DEFAULTS, { taxRate: 8.5 });
  check('a real scalar change is held', j(scalar) === j({ taxRate: 8.5 }));
  const cleared = applyHeldSettings(REAL, heldSettingsPatch(DEFAULTS, { digest: { enabled: false, hour: 7, timezone: 'America/Los_Angeles', channels: { email: true, in_app: true } } }));
  check('an object DEFAULT lacks (digest) is held whole, as before', cleared.digest?.enabled === false);
  check('applyHeldSettings(null) is the loaded row untouched', applyHeldSettings(REAL, null) === REAL);
  // The old rule, for the record: `{ ...loaded, ...pending }` with the picker's
  // whole-branding snapshot blanked him. Proves the fixture is the finding's.
  const oldRule = { ...REAL, ...{ branding: { ...DEFAULT_BRANDING, licenseState: 'AZ' } } };
  check('(control) the old whole-object merge would have blanked his company name', oldRule.branding.companyName === '');
}

// ═══ 15 — a read that raced an edit ═══════════════════════════════════════
console.log('\nsettings load — (15) a read that started before an edit does not undo it');
{
  const staleRow: AppSettings = { ...REAL, branding: { ...REAL.branding, phone: '916-555-0100' } };
  const edited: AppSettings = { ...REAL, branding: { ...REAL.branding, phone: '916-555-0199' } };
  const base = { fromRow: staleRow, current: edited, currentLoaded: true, writeSeqAtStart: 3, writeSeqNow: 3, rowWritesInFlightAtStart: 0, rowWritesInFlightNow: 0, rowWriteQueued: false };
  const quiet = settingsAfterRead(base);
  check('nothing written during the read → the row wins and is saved to the device', quiet.kept === 'row' && quiet.persist && !quiet.rereadOwed);
  const moved = settingsAfterRead({ ...base, writeSeqNow: 4 });
  check('an edit made while the read was out → the device keeps his edit, the row is NOT saved, one re-read owed',
    moved.kept === 'device' && moved.settings.branding.phone === '916-555-0199' && !moved.persist && moved.rereadOwed);
  check('…as a copy (the provider’s ref object is not handed to React Query)', moved.settings !== edited);
  check('a whole-row write on the wire as the read began → device kept', settingsAfterRead({ ...base, rowWritesInFlightAtStart: 1 }).kept === 'device');
  check('a whole-row write on the wire as the read returned → device kept', settingsAfterRead({ ...base, rowWritesInFlightNow: 1 }).kept === 'device');
  check('a whole-row write queued offline → device kept', settingsAfterRead({ ...base, rowWriteQueued: true }).kept === 'device');
  const preload = settingsAfterRead({ ...base, currentLoaded: false, current: DEFAULTS, writeSeqNow: 9 });
  check('before the load the row always wins (held edits land on it separately)', preload.kept === 'row' && preload.persist);

  // Sequence: cache load → updateSettings(phone) → the launch read resolves
  // with the pre-edit row. settingsRef and the device copy keep the edit.
  let settingsRef: AppSettings = REAL;
  let device: AppSettings = REAL;
  let seq = 0;
  const seqAtRead = seq;                     // the launch read starts
  settingsRef = edited; seq += 1; device = settingsRef; // updateSettings → saveSettingsMutation saves settingsRef
  const out = settingsAfterRead({ fromRow: staleRow, current: settingsRef, currentLoaded: true, writeSeqAtStart: seqAtRead, writeSeqNow: seq, rowWritesInFlightAtStart: 0, rowWritesInFlightNow: 1, rowWriteQueued: false });
  if (out.persist) device = out.settings;
  settingsRef = out.settings;
  check('sequence: cache → edit → stale read — state and device copy both keep 916-555-0199',
    settingsRef.branding.phone === '916-555-0199' && device.branding.phone === '916-555-0199');

  // Review round 2 — the owed re-read must actually run. A whole-row write
  // that settled while the read was still out (its `finally` saw no owed
  // flag yet), or a terms-only race (its `finally` never looked), left the
  // flag set with no later event to act on it: the device kept a stale field
  // another device had changed, and the next whole-row write sent it back.
  const settledMidRead = settingsAfterRead({ ...base, writeSeqNow: 4, rowWritesInFlightAtStart: 1, rowWritesInFlightNow: 0 });
  check('a write that settled mid-read still owes a re-read', settledMidRead.rereadOwed);
  const ready = (o: Partial<Parameters<typeof owedSettingsRereadReady>[0]>) =>
    owedSettingsRereadReady({ owed: true, rowWritesInFlight: 0, termsWritesInFlight: 0, profilesWriteQueued: false, ...o });
  check('…and with nothing still out it can run at once (the loader runs it as it returns)', ready({}));
  check('not owed → no re-read', !ready({ owed: false }));
  check('a whole-row write still on the wire → wait (its finally runs it)', !ready({ rowWritesInFlight: 1 }));
  check('a terms write still on the wire → wait (its finally runs it)', !ready({ termsWritesInFlight: 1 }));
  check('a profiles write queued offline → wait (the queue flush runs it)', !ready({ profilesWriteQueued: true }));

  const q = (data: Record<string, unknown>, table = 'profiles', operation = 'update') => ({ table, operation, data });
  check('a queued whole-row save counts as pending', settingsRowWritePending([q({ id: U, company_name: 'A', phone: '1' })], U));
  check('a terms-only write does not (paymentTerms.ts owns that)', !settingsRowWritePending([q({ id: U, deposit_pct: 10, progress_pct: 80, final_pct: 10 })], U));
  check('onboarding_complete / user_role writes do not', !settingsRowWritePending([q({ id: U, onboarding_complete: true }), q({ id: U, user_role: 'gc' })], U));
  check('another user’s write does not', !settingsRowWritePending([q({ id: 'someone-else', company_name: 'B' })], U));
  check('another table does not', !settingsRowWritePending([q({ id: U, company_name: 'B' }, 'projects')], U));
  check('no user → nothing pending', !settingsRowWritePending([q({ id: U, company_name: 'B' })], null));
}

// ═══ 105 / 106 — what a blocked control and a label say ══════════════════
console.log('\nsettings load — (105/106) the refusal has a way out; labels never say "Not set" early');
{
  const loading = profileGateNotice({ failed: false });
  const failed = profileGateNotice({ failed: true });
  check('still loading → "One second" + the loading reason', loading.title === 'One second' && loading.message === PROFILE_LOADING_REASON);
  check('failed / unreachable → says his profile could not be loaded, blames the signal, and says what still works',
    failed.title === PROFILE_FAILED_TITLE && /could’?n.t load your company profile/i.test(failed.title)
    && /signal/.test(failed.message) && /still open/.test(failed.message) && failed.message === PROFILE_FAILED_REASON);
  check('the failure copy never says "try again in a second"', !/in a second/.test(failed.message));
  check('a first read is bounded (10–20 s)', FIRST_PROFILE_READ_TIMEOUT_MS >= 10_000 && FIRST_PROFILE_READ_TIMEOUT_MS <= 20_000);
  // Review round 2: the deadline covers the body, and his row is ~235 KB. At
  // 100 kbps that is ~19 s — a fixed 15 s per attempt could never land.
  const bodySecondsAt100k = (235_000 * 8) / 100_000;
  check('the first attempt is the plain bound', firstProfileReadTimeoutMs(0) === FIRST_PROFILE_READ_TIMEOUT_MS);
  check('each failed first read doubles the next deadline, up to a ceiling',
    firstProfileReadTimeoutMs(1) === 2 * FIRST_PROFILE_READ_TIMEOUT_MS && firstProfileReadTimeoutMs(2) === 4 * FIRST_PROFILE_READ_TIMEOUT_MS
    && firstProfileReadTimeoutMs(50) === MAX_PROFILE_READ_TIMEOUT_MS && MAX_PROFILE_READ_TIMEOUT_MS <= 180_000);
  check('a ~235 KB row at 100 kbps fits the second attempt\'s window', firstProfileReadTimeoutMs(1) / 1000 > bodySecondsAt100k);
  check('junk failure counts are clamped', firstProfileReadTimeoutMs(-3) === FIRST_PROFILE_READ_TIMEOUT_MS
    && firstProfileReadTimeoutMs(Number.NaN) === FIRST_PROFILE_READ_TIMEOUT_MS);

  // Review round 2: a Retry must never put the splash back over the app.
  check('boot: the first attempt, still loading → holds the splash', settingsHoldsBoot({ isLoading: true, settledForOwner: false }));
  check('boot: a refetch after the first attempt settled (Retry / focus / reconnect on an errored, data-less query) → never holds it',
    !settingsHoldsBoot({ isLoading: true, settledForOwner: true }));
  check('boot: not loading → never holds it', !settingsHoldsBoot({ isLoading: false, settledForOwner: false }));

  // Review round 2: a refetch that changed nothing keeps `settings`' identity.
  check('sameSettings: a deep copy of his settings is the same', sameSettings(REAL, JSON.parse(JSON.stringify(REAL))));
  check('sameSettings: an explicit undefined and an absent key are the same', sameSettings({ a: 1, b: undefined }, { a: 1 }));
  check('sameSettings: any changed field differs',
    !sameSettings(REAL, { ...REAL, branding: { ...REAL.branding, phone: '916-555-0199' } })
    && !sameSettings(REAL, { ...REAL, digest: { ...REAL.digest!, hour: 8 } })
    && !sameSettings({ l: ['a', 'b'] }, { l: ['a'] }) && !sameSettings({ x: null }, { x: {} }));

  const set = { paymentSplit: { depositPct: 10, progressPct: 80, finalPct: 10 }, warrantyMonths: 12 };
  const l = savedTermsView({ settings: set, settingsLoaded: false, failed: false });
  check('not loaded → status loading, split and months withheld', l.status === 'loading' && l.split === null && l.warrantyMonths === null);
  const f = savedTermsView({ settings: {}, settingsLoaded: false, failed: true });
  check('not loaded + failed → status failed', f.status === 'failed');
  const r = savedTermsView({ settings: set, settingsLoaded: true, failed: false });
  check('loaded → his terms', r.status === 'ready' && r.split?.depositPct === 10 && r.warrantyMonths === 12);
  const u = savedTermsView({ settings: {}, settingsLoaded: true, failed: true });
  check('loaded with nothing set → ready / null (the only case that may say "Not set")', u.status === 'ready' && u.split === null && u.warrantyMonths === null);
  check('the pending labels never read as "not set"', !Object.values(SAVED_TERMS_PENDING_LABEL).some((t) => /not set/i.test(t)));
}

// ═══ Call sites ═══════════════════════════════════════════════════════════
console.log('\nsettings load — call sites in ProjectContext');
const ctx = read('contexts/ProjectContext.tsx');
{
  const defaults = balanced(ctx, ctx.indexOf('const DEFAULT_SETTINGS'));
  check('the DEFAULT fixture here matches ProjectContext DEFAULT_SETTINGS',
    /location: 'United States'/.test(defaults) && /taxRate: 0/.test(defaults) && /contingencyRate: 10/.test(defaults));
  const loader = balanced(ctx, ctx.indexOf('const settingsQuery = useQuery('), '(', ')');
  check('loader: never resolves a failed read with DEFAULT_SETTINGS', loader.length > 0 && !/loadLocal<AppSettings>\(SETTINGS_KEY,\s*DEFAULT_SETTINGS\)/.test(loader));
  check('loader: an error (PGRST116 included) is never read as "new account"; the fallback goes through settingsReadFallback and throws on fail',
    !/noRow|isNoProfileRow|PGRST116|new_account/.test(loader)
    && /const fallback = settingsReadFallback\(\{\s*canSync,\s*loaded: loadedNow\(\),/.test(loader)
    && /if \('fail' in fallback\) \{[\s\S]*?throw new Error\(fallback\.fail\);\s*\}\s*return handOver\(fallback\.resolve\);/.test(loader));
  check('loader: a failed first read lengthens the next deadline; a React Query cancel does not; a row resets it',
    /if \(!signal\?\.aborted\) \{\s*settingsFirstReadFailuresRef\.current = \{ owner: ownerKey, n: priorFirstReadFailures \+ 1 \};\s*\}/.test(loader)
    && /settingsFirstReadFailuresRef\.current = \{ owner: ownerKey, n: 0 \};\s*return handOver\(outcome\.settings\);/.test(loader)
    && /const priorFirstReadFailures = settingsFirstReadFailuresRef\.current\.owner === ownerKey\s*\?\s*settingsFirstReadFailuresRef\.current\.n : 0;/.test(loader));
  check('loader: the profiles select carries an abort signal', /\.from\('profiles'\)\.select\('\*'\)\.eq\('id', userId\)\.abortSignal\(abort\.signal\)\.single\(\)/.test(loader));
  check('loader: the timeout applies only to a first read with no copy, and React Query’s signal is forwarded',
    /const timer = hadCopy \? null : setTimeout\(\(\) => abort\.abort\(\), firstProfileReadTimeoutMs\(priorFirstReadFailures\)\);/.test(loader)
    && /queryFn: async \(\{ signal \}\) =>/.test(loader) && /signal\?\.addEventListener\?\.\('abort', onCancel\)/.test(loader)
    && /if \(timer\) clearTimeout\(timer\);/.test(loader));
  check('loader: the write sequence and in-flight count are captured BEFORE the select',
    loader.indexOf('const writeSeqAtRead = settingsWriteSeqRef.current;') >= 0
    && loader.indexOf('const rowInFlightAtRead = settingsRowWritesInFlightRef.current;') >= 0
    && loader.indexOf('const writeSeqAtRead') < loader.indexOf(".from('profiles')")
    && loader.indexOf('const rowInFlightAtRead') < loader.indexOf(".from('profiles')"));
  check('loader: a row goes through settingsAfterRead; the row is saved to the device only when it wins',
    /settingsAfterRead\(\{\s*fromRow: s,\s*current: settingsRef\.current,\s*currentLoaded: settingsLoadedForRef\.current === ownerKey,\s*writeSeqAtStart: writeSeqAtRead,\s*writeSeqNow: settingsWriteSeqRef\.current,\s*rowWritesInFlightAtStart: rowInFlightAtRead,\s*rowWritesInFlightNow: settingsRowWritesInFlightRef\.current,\s*rowWriteQueued: rowQueued,\s*rowWriteUnsaved: rowUnsaved,\s*\}\)/.test(loader)
    && /if \(outcome\.persist\) \{\s*await saveLocal\(SETTINGS_KEY, s\);/.test(loader)
    && (loader.match(/saveLocal\(SETTINGS_KEY, s\)/g) ?? []).length === 1
    && /return handOver\(outcome\.settings\);/.test(loader)
    // Integration round 3 (wave 4): queued OR under Not saved, queue first.
    // Wave-4 final fix: the two kept APART — a queued save owes a re-read, a
    // Not-saved one does not (owing one re-read the profile forever).
    && /const rowQueue = await getOfflineQueue\(\);\s*const rowQueued = settingsRowWritePending\(rowQueue, userId\);\s*const rowUnsaved = settingsRowWritePending\(await unsavedAsQueueEntries\('profiles'\), userId\);/.test(loader));
  check('loader: every result is tagged with the write sequence it was built at',
    /const handOver = \(s: AppSettings\): AppSettings => \{\s*settingsDataSeqRef\.current\.set\(s, settingsWriteSeqRef\.current\);\s*return s;\s*\};/.test(loader)
    && (loader.replace(/const handOver = [\s\S]*?return s;\s*\};/, '').match(/\breturn\b[^;]*;/g) ?? []).every((r) => r.startsWith('return handOver(')));
  check('loader: structural sharing off (the tag is keyed by object identity)', /structuralSharing: false,/.test(loader));

  const effAt = ctx.indexOf('const builtAt = settingsDataSeqRef.current.get(data);');
  const eff = effAt >= 0 ? ctx.slice(ctx.lastIndexOf('useEffect(', effAt), ctx.indexOf('}, [settingsQuery.data', effAt)) : '';
  check('data effect: an untagged result is neither committed nor marked loaded',
    /if \(builtAt === undefined\) return;/.test(eff) && eff.indexOf('builtAt === undefined') < eff.indexOf('markSettingsLoaded('));
  check('data effect: once loaded, commits only a result built at the current write sequence — and only when it changed something',
    /if \(\(settingsLoadedForRef\.current !== settingsOwnerKey \|\| builtAt === settingsWriteSeqRef\.current\)\s*&& !sameSettings\(data, settingsRef\.current\)\) \{\s*commitSettingsState\(data\);\s*\}/.test(eff)
    && eff.indexOf('sameSettings(') < eff.indexOf('markSettingsLoaded('));

  // Review round 2: the splash (CraneLoader replaces the whole Stack) is held
  // by the settings read only until its first attempt settles, per account.
  const coreValue = balanced(ctx, ctx.indexOf('const coreData = useMemo<CoreDataValue>('), '(', ')');
  check('CoreData isLoading: settings contributes settingsBootLoading, never raw settingsQuery.isLoading',
    /isLoading: projectsQuery\.isLoading \|\| settingsBootLoading \|\|/.test(coreValue) && !/settingsQuery\.isLoading/.test(coreValue));
  check('settingsBootLoading goes through settingsHoldsBoot with a sticky per-account settle mark',
    /const settingsBootLoading = settingsHoldsBoot\(\{\s*isLoading: settingsQuery\.isLoading,\s*settledForOwner: settingsBootSettledFor === settingsOwnerKey,\s*\}\);/.test(ctx)
    && /if \(settingsQuery\.data !== undefined \|\| settingsQuery\.failureCount > 0 \|\| settingsQuery\.isError\) \{\s*setSettingsBootSettledFor\(settingsOwnerKey\);\s*\}/.test(ctx));
  const retry = balanced(ctx, ctx.indexOf('const retryRemoteReads = useCallback('), '(', ')');
  check('retryRemoteReads: while settings are unloaded, cancels the settings read BEFORE invalidating (invalidate alone joins a data-less retry cycle)',
    /if \(settingsLoadedForRef\.current !== userId\) \{\s*try \{ await queryClient\.cancelQueries\(\{ queryKey: \['settings', userId\] \}\); \}/.test(retry)
    && retry.indexOf('cancelQueries(') < retry.indexOf('invalidateQueries('));

  const us = balanced(ctx, ctx.indexOf('const updateSettings = useCallback('), '(', ')');
  check('updateSettings: pre-load → heldSettingsPatch + mergeHeldPatches, shown via applyHeldSettings, never mutate',
    /if \(settingsLoadedForRef\.current !== settingsOwnerKey\) \{\s*const held = heldSettingsPatch\(settingsRef\.current, updates\);\s*pendingSettingsUpdatesRef\.current = mergeHeldPatches\(pendingSettingsUpdatesRef\.current, held\);\s*commitSettingsState\(applyHeldSettings\(settingsRef\.current, held\)\);\s*return;\s*\}/.test(us));
  check('updateSettings: a loaded write bumps the sequence before it saves',
    /commitSettingsState\(updated\);\s*settingsWriteSeqRef\.current \+= 1;\s*(?:\/\/[^\n]*\s*)*settingsRowWritesInFlightRef\.current \+= 1;\s*saveSettingsMutation\.mutate\(updated\);/.test(us));
  const flushAt = ctx.indexOf('const pending = pendingSettingsUpdatesRef.current;');
  const flush = ctx.slice(flushAt, ctx.indexOf('}, [settingsLoaded', flushAt));
  check('held-edit flush: applyHeldSettings onto the loaded row, sequence bumped, then saved',
    /const merged = applyHeldSettings\(settingsRef\.current, pending\);\s*commitSettingsState\(merged\);\s*settingsWriteSeqRef\.current \+= 1;\s*settingsRowWritesInFlightRef\.current \+= 1;\s*saveSettingsMutation\.mutate\(merged\);/.test(flush));
  const pt = balanced(ctx, ctx.indexOf('const savePaymentTerms = useCallback('), '(', ')');
  check('savePaymentTerms: bumps the sequence and tags what it caches',
    /commitSettingsState\(next\);\s*settingsWriteSeqRef\.current \+= 1;/.test(pt) && /settingsDataSeqRef\.current\.set\(next, settingsWriteSeqRef\.current\);\s*queryClient\.setQueryData\(\['settings', userId\], next\);/.test(pt));

  const mut = balanced(ctx, ctx.indexOf('const saveSettingsMutation = useMutation('), '(', ')');
  check('saveSettingsMutation: refuses (no device save, no profiles write) unless this account is loaded',
    /if \(settingsLoadedForRef\.current !== settingsOwnerKey\) return updatedSettings;/.test(mut)
    && mut.indexOf('settingsLoadedForRef.current !== settingsOwnerKey') < mut.indexOf('saveLocal(SETTINGS_KEY')
    && mut.indexOf('settingsLoadedForRef.current !== settingsOwnerKey') < mut.indexOf("supabaseWrite('profiles'"));
  // Integration round 1 (finding 15, round 3): counted from BEFORE mutate —
  // counted only after the device write, a read starting in that gap saw
  // nothing in flight and could commit the pre-edit row.
  check('saveSettingsMutation: the whole-row write counts as in flight from mutate (callers count it first) and is released exactly once — when it settles, or when none goes out',
    !/settingsRowWritesInFlightRef\.current \+= 1;/.test(mut)
    && /handedOff = true;\s*void write\.finally\(\(\) => \{\s*settingsRowWritesInFlightRef\.current -= 1;/.test(mut)
    && /\} finally \{\s*if \(!handedOff\) \{\s*settingsRowWritesInFlightRef\.current -= 1;\s*if \(releaseOwner\) void runOwedSettingsReread\(releaseOwner\);/.test(mut)
    && mut.indexOf('let handedOff = false;') < mut.indexOf('await saveLocal(SETTINGS_KEY')
    && (ctx.match(/settingsRowWritesInFlightRef\.current \+= 1;\s*saveSettingsMutation\.mutate\(/g) ?? []).length === 2
    && (ctx.match(/saveSettingsMutation\.mutate\(/g) ?? []).length === 2);
  check('saveSettingsMutation: onSuccess tags the object it caches', /settingsDataSeqRef\.current\.set\(latest, settingsWriteSeqRef\.current\);/.test(mut));

  const resetAt = ctx.indexOf('const settingsOwnerSeenRef = useRef(settingsOwnerKey);');
  const reset = resetAt >= 0 ? ctx.slice(resetAt, ctx.indexOf('}, [settingsOwnerKey, commitSettingsState]);', resetAt)) : '';
  check('account change: the held edit is dropped and DEFAULT goes back in state',
    /pendingSettingsUpdatesRef\.current = null;/.test(reset) && /if \(settingsLoadedForRef\.current !== settingsOwnerKey\) commitSettingsState\(DEFAULT_SETTINGS\);/.test(reset));
  check('account change reset is declared before the data effect (a cached result for the new account still wins)',
    resetAt >= 0 && resetAt < effAt);
  const runAt = ctx.indexOf('const runOwedSettingsReread = useCallback(async (uid: string) => {');
  const run = runAt >= 0 ? balanced(ctx, ctx.indexOf('=> {', runAt), '{', '}') : '';
  check('runOwedSettingsReread: asks owedSettingsRereadReady with both in-flight counts and BOTH queued-write kinds',
    /owedSettingsRereadReady\(\{/.test(run)
    && /rowWritesInFlight: settingsRowWritesInFlightRef\.current,/.test(run)
    && /termsWritesInFlight: termsWritesInFlightRef\.current,/.test(run)
    && /const termsQueued = termsWritesPending\(queue, uid\);/.test(run)
    && /profilesWriteQueued: settingsRowWritePending\(queue, uid\) \|\| termsQueued\.split \|\| termsQueued\.warranty,/.test(run)
    && /settingsRereadOwedRef\.current = false;\s*void queryClient\.invalidateQueries\(\{ queryKey: \['settings', uid\] \}\);/.test(run)
    && /liveUserIdRef\.current !== uid/.test(run));
  check('the loader runs the owed re-read as it returns (a write that settled mid-read has no later event)',
    /settingsRereadOwedRef\.current = outcome\.rereadOwed;\s*(?:\/\/[^\n]*\s*)*if \(outcome\.rereadOwed\) \{[^}]*setTimeout\(\(\) => \{ void runOwedSettingsReread\(owedFor\); \}, 0\);/.test(ctx));
  check('a whole-row write runs the owed-re-read check when it settles',
    /void write\.finally\(\(\) => \{\s*settingsRowWritesInFlightRef\.current -= 1;\s*if \(releaseOwner\) void runOwedSettingsReread\(releaseOwner\);/.test(mut));
  const spt = balanced(ctx, ctx.indexOf('=> {', ctx.indexOf('const savePaymentTerms = useCallback(')), '{', '}');
  check('a terms write runs the owed-re-read check when it settles',
    /termsWritesInFlightRef\.current -= 1;\s*void runOwedSettingsReread\(writeUserId\);/.test(spt));
  check('the owed re-read runs when a profiles write flushes',
    /onQueueFlushed\(\(tables\) => \{\s*if \(!tables\.has\('profiles'\) \|\| !settingsRereadOwedRef\.current \|\| !userId\) return;/.test(ctx));
  check('CoreData exposes settingsLoadFailed only while unloaded, from the query’s error / first failure',
    /const settingsLoadFailed = settingsQuery\.isError \|\| settingsQuery\.failureCount > 0;/.test(ctx)
    && /settingsLoadFailed: !settingsLoaded && settingsLoadFailed,/.test(ctx));
}

console.log('\nsettings load — screens');
{
  const cp = read('app/company-profile.tsx');
  const cpMain = balanced(cp, cp.indexOf('export default function CompanyProfileScreen('));
  check('Company Profile renders its form only once the profile is loaded (the form seeds from it at mount)',
    /if \(settingsLoaded\) return <CompanyProfileForm \/>;/.test(cpMain) && /<ProfileLoadNotice/.test(cpMain)
    && !/updateSettings/.test(cpMain) && /function CompanyProfileForm\(\)/.test(cp));
  const gv = read('app/get-verified.tsx');
  const gvMain = balanced(gv, gv.indexOf('export default function GetVerifiedScreen('));
  check('Get Verified renders its form only once the profile is loaded',
    /if \(settingsLoaded\) return <GetVerifiedForm \/>;/.test(gvMain) && /<ProfileLoadNotice/.test(gvMain)
    && !/updateSettings/.test(gvMain) && /function GetVerifiedForm\(\)/.test(gv));
  const notice = read('components/ProfileLoadNotice.tsx');
  check('ProfileLoadNotice: failed → the failure copy + Retry → retryRemoteReads; else a loading line',
    /PROFILE_FAILED_TITLE/.test(notice) && /PROFILE_FAILED_REASON/.test(notice) && /onPress=\{retryRemoteReads\}/.test(notice)
    && /const failed = settingsLoadFailed \|\| sourceFailed;/.test(notice));

  const st = read('app/(tabs)/settings/index.tsx');
  const labelAt = st.indexOf('const howYouGetPaidLabel = useMemo(');
  const label = balanced(st, labelAt, '(', ')');
  check('Settings "How you get paid" reads useSavedPaymentTerms and says loading / could not load before "Not set"',
    /const savedTerms = useSavedPaymentTerms\(\);/.test(st)
    && label.indexOf("savedTerms.status === 'loading'") >= 0 && label.indexOf("savedTerms.status === 'failed'") >= 0
    && label.indexOf("savedTerms.status === 'loading'") < label.indexOf('Not set')
    && !/resolvePaymentSplit\(\{ settings \}\)/.test(label));
  check('Settings re-seeds its PDF-naming draft once the profile lands',
    /if \(!settingsLoaded\) \{ pdfNamingSeededRef\.current = false; return; \}/.test(st) && /if \(settings\.pdfNaming\) setPdfNaming\(settings\.pdfNaming\);/.test(st));
  // Review round 2: after a failed read an edit here is only held in memory
  // (lost if the app closes before a read lands) — refuse it, with Retry.
  const refuseAt = st.indexOf('const refuseWhileProfileFailed = useCallback(');
  const refuse = refuseAt >= 0 ? balanced(st, st.indexOf('=> {', refuseAt)) : '';
  check('Settings: a failed profile read refuses its writes, says why, and offers Retry → retryRemoteReads',
    /if \(!settingsLoadFailed\) return false;/.test(refuse) && /profileGateNotice\(\{ failed: true \}\)/.test(refuse)
    && /\{ text: 'Retry', onPress: retryRemoteReads \}/.test(refuse) && /return true;/.test(refuse));
  const commitAt = st.indexOf('const commitScreen = useCallback(');
  const commit = commitAt >= 0 ? balanced(st, st.indexOf('=> {', commitAt)) : '';
  check('Settings: commitScreen refuses before it calls updateSettings, and says whether it saved',
    /^\{\s*if \(refuseWhileProfileFailed\(\)\) return false;/.test(commit)
    && commit.indexOf('refuseWhileProfileFailed()') < commit.indexOf('updateSettings(') && /return true;\s*\}$/.test(commit));
  check('Settings: tax/contingency Save gives no success haptic when refused; location/theme/biometrics keep the saved value',
    /if \(!commitScreen\(\{ taxRate: tax, contingencyRate: cont \}\)\) return false;/.test(st)
    && /if \(!commitScreen\(\{ location: next \}\)\) \{ setLocation\(settings\.location\); return; \}/.test(st)
    && /if \(!commitScreen\(\{ biometricsEnabled: val \}\)\) return;\s*setBiometricsEnabled\(val\);/.test(st)
    && /: undefined \}\)\) return;\s*setSelectedTheme\(themeId\);/.test(st));
  // Integration round 1: the PDF-naming auto-save used commitScreen as an
  // effect dependency; its identity changes on every provider render, so with
  // the profile unreadable the refusal alert re-popped after every refetch.
  const pdfAt = st.indexOf('const pdfNamingSaved = JSON.stringify(settings.pdfNaming ?? null);');
  const pdf = pdfAt >= 0 ? st.slice(pdfAt, st.indexOf('}, [pdfNaming, pdfNamingSaved]);', pdfAt) + 40) : '';
  check('Settings: the PDF-naming auto-save reads commitScreen through a ref (not a dependency) and a refused save switches back to what is saved',
    /commitScreenRef\.current = commitScreen;/.test(pdf) && /\}, \[pdfNaming, pdfNamingSaved\]\);/.test(pdf)
    && /if \(commitScreenRef\.current\(\{ pdfNaming: next \}\)\) return;\s*(?:\/\/[^\n]*\n\s*)*setPdfNaming\(savedPdfNamingRef\.current \?\? \{ \.\.\.pdfNaming, enabled: false \}\);/.test(pdf));
  check('Settings: Units and the supplier profile refuse too',
    /if \(refuseWhileProfileFailed\(\)\) return;\s*const newUnits/.test(st)
    && /if \(refuseWhileProfileFailed\(\)\) return;\s*updateSettings\(\{ supplierProfile: profile \}\);/.test(st));
  // The fourth call, autoSaveBranding, is reachable only from four logo /
  // signature handlers no control renders any more (branding moved to
  // Company Profile, which gates itself). Pinned unreachable: wiring one back
  // up must add the refusal too — it writes a whole branding object.
  const unrendered = ['handlePickLogo', 'handleRemoveLogo', 'handleSaveSignature', 'handleClearSignature'];
  check('Settings: every reachable updateSettings call is behind the refusal (autoSaveBranding has no rendered caller)',
    (st.match(/updateSettings\(\{/g) ?? []).length === 4
    && (st.match(/autoSaveBranding\(\{/g) ?? []).length === 4
    && unrendered.every((h) => (st.match(new RegExp(`\\b${h}\\b`, 'g')) ?? []).length === 1));

  const rv = read('app/(tabs)/estimate/review.tsx');
  check('Estimate review: its terms note checks status before "not set yet", and a failed read offers Retry',
    /const savedTerms = useSavedPaymentTerms\(\);\s*const savedSplit = savedTerms\.split;/.test(rv)
    && rv.indexOf("savedTerms.status !== 'ready'") >= 0 && rv.indexOf("savedTerms.status !== 'ready'") < rv.indexOf('review-terms-not-set')
    && /onPress=\{savedTerms\.retry\}/.test(rv) && !/resolvePaymentSplit\(/.test(rv));

  const hook = read('hooks/useClientDocumentGate.ts');
  const hookFn = balanced(hook, hook.indexOf('export function useSavedPaymentTerms('));
  check('useSavedPaymentTerms: savedTermsView over settingsLoaded + (settingsLoadFailed || sourceFailed), with retry',
    /const failed = settingsLoadFailed \|\| sourceFailed;/.test(hookFn) && /savedTermsView\(\{ settings, settingsLoaded, failed \}\)/.test(hookFn)
    && /retry: retryRemoteReads/.test(hookFn));
}

// ═══ React Query's real behaviour (why the rules above exist) ═════════════
// Executed against the installed @tanstack/query-core, so an upgrade that
// changes either behaviour shows up here, not on a job site.
console.log('\nsettings load — React Query behaviour the rules depend on');
{
  const { QueryClient, QueryObserver } = await import('@tanstack/query-core');
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // (a) An errored query with no data goes back to isLoading on ANY refetch —
  // which is why CoreData may not feed raw isLoading to the splash gate.
  {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let calls = 0;
    const obs = new QueryObserver(qc, {
      queryKey: ['settings', U],
      queryFn: async () => { calls++; if (calls === 1) throw new Error('offline'); await tick(30); return REAL; },
    });
    const unsub = obs.subscribe(() => {});
    await tick(20);
    check('RQ: the failed first read leaves status error with no data', obs.getCurrentResult().isError && obs.getCurrentResult().data === undefined);
    void qc.invalidateQueries({ queryKey: ['settings', U] });
    await tick(5);
    const mid = obs.getCurrentResult();
    check('RQ: a Retry on that errored, data-less query IS isLoading again (raw isLoading would re-raise the splash)', mid.isLoading === true);
    check('RQ: …and settingsHoldsBoot with the sticky settle mark does not',
      !settingsHoldsBoot({ isLoading: mid.isLoading, settledForOwner: true }));
    unsub(); qc.clear();
  }

  // (b) invalidate alone does NOT abort a data-less query's in-flight read;
  // cancel first does — which is why retryRemoteReads cancels while unloaded.
  for (const cancelFirst of [false, true]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let aborted = 0; let calls = 0;
    const obs = new QueryObserver(qc, {
      queryKey: ['settings', U],
      queryFn: ({ signal }) => new Promise<AppSettings>((resolve) => {
        calls++;
        signal.addEventListener('abort', () => { aborted++; });
        setTimeout(() => resolve(REAL), 60);
      }),
    });
    const unsub = obs.subscribe(() => {});
    await tick(5);
    if (cancelFirst) await qc.cancelQueries({ queryKey: ['settings', U] });
    await qc.invalidateQueries({ queryKey: ['settings', U] });
    await tick(80);
    check(cancelFirst
      ? 'RQ: cancel-then-invalidate aborts the stalled read and starts a new one'
      : 'RQ: invalidate alone joins the stalled read (no abort, no new request)',
    cancelFirst ? aborted === 1 && calls === 2 : aborted === 0 && calls === 1, `aborted=${aborted} calls=${calls}`);
    unsub(); qc.clear();
  }
}

{
  // #104: the LITE portal sync must not publish from an unloaded (DEFAULT)
  // profile, and must not blank a name/contact the portal already shows.
  // Wave 3 (#23): the writer moved to utils/portalLiteSync.ts
  // (syncPortalSnapshotLite, shared by project-detail and the ProjectContext
  // provider), which owns the skip; project-detail must still hand it
  // settingsLoaded and re-run when it flips.
  const lite = read('utils/portalLiteSync.ts');
  const pd = read('app/project-detail.tsx');
  check('the lite portal sync waits for settingsLoaded',
    /if \(!input\.settingsLoaded\) return 'settings_not_loaded';/.test(lite)
    && /syncPortalSnapshotLite\(project\.id, \{[\s\S]{0,200}settingsLoaded/.test(pd)
    // data-session critic round 2: the server-read gate sits beside `project`.
    && /\}, \[project, (?:portalListsServerRead, )?(?:portalAiaListServerRead, )?authUser\?\.id, settings, settingsLoaded,/.test(pd));
  check('…and carries the published company / contact forward over a blank one',
    /company: snap\.company\?\.name && opts\.hasCompanyName \? snap\.company : \(prev\.company \?\? snap\.company\)/.test(lite)
    && /contactEmail: snap\.portalApi\.contactEmail \|\| prev\.portalApi\.contactEmail/.test(lite)
    && /contactEmail: snap\.submitBudget\.contactEmail \|\| prev\.submitBudget\.contactEmail/.test(lite));
}
{
  // Digest controls refuse (with the reason + Retry) until the profile loads,
  // never the bare 'One second', and the card does not claim "Off".
  const ns = read('app/notifications-settings.tsx');
  check('notifications-settings refuses digest writes until settingsLoaded',
    /const updateDigest = useCallback\([^)]*\) => \{\s*if \(refuseUntilLoaded\(\)\) return;/.test(ns)
    && /const setDigestEmail = useCallback\(async \(v: boolean\) => \{\s*if \(refuseUntilLoaded\(\)\) return;/.test(ns)
    && /if \(settingsLoaded\) return false;/.test(ns) && !/'One second'/.test(ns));
  check('…and the digest card says loading / could-not-load instead of "Off"',
    /\{!settingsLoaded\s*\? \(profileFailed/.test(ns));
}
{
  // payments-setup: the financing drafts re-seed once the profile lands, the
  // card is a ProfileLoadNotice until then, and Save refuses before it.
  const ps = read('app/payments-setup.tsx');
  check('payments-setup re-seeds the financing drafts on settingsLoaded',
    /if \(!settingsLoaded \|\| finSeededRef\.current\) return;/.test(ps));
  check('…refuses a financing save before the profile loads',
    /const saveFinancing = useCallback\(\(enabled: boolean\) => \{\s*if \(!settingsLoaded \|\| !finSeededRef\.current\) return;/.test(ps));
  check('…and shows ProfileLoadNotice in place of the form until then',
    /\{!settingsLoaded \? \(\s*<ProfileLoadNotice testID="financing-profile-load" \/>/.test(ps));
}

console.log(`\nvalidate-settings-load-guard: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
