// validate-w5-portfolio-screens.ts: the two screens behind the public project
// page (audit wave 5, lane portfolio).
//
//   #75/#47  the Publish switch says the truth ("Turning this off takes the page
//            down; links shared before this update can't be recalled"), and
//            flipping it writes public_profiles through the offline queue.
//            Copy / Share / Preview are blocked with the reason while the
//            page is off, and every one of them turns the flag on and copies the
//            photos to the public bucket BEFORE the link leaves the app.
//   #78      a "Show street address" switch (off by default) with the exact
//            line that prints.
//   #77      the photo section says how many photos haven't uploaded and were
//            left out. Share with un-uploaded photos asks first.
//   #81      a very long link is warned about before it is shared; the logo
//            picker's quality is lowered.
//   #177     Preview opens on iPhone (expo-web-browser, then Linking), and a
//            failure says what to do.
//   #133     Company Profile holds him on the screen with unsaved text
//            (usePreventRemove) and asks on a web/tab exit (focus cleanup). The
//            email baseline is the seeded value, Save moves the baseline, and
//            autoSave merges only logo / signature onto the SAVED branding.
//
// Run: bun run scripts/validate-w5-portfolio-screens.ts
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** The body of `const <name> = useCallback(` up to its deps array. */
function callbackBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('(', at); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

console.log('\napp/public-profile-setup.tsx');
{
  const raw = readFileSync('app/public-profile-setup.tsx', 'utf8');
  const src = strip(raw);
  ok('the false "unpublish anytime" promise is gone', !/unpublish anytime/i.test(raw));
  ok('the switch copy says what turning it off does and what it cannot recall',
    raw.includes(`"Anyone with the link can view it. Turning this off takes the page down; links shared before this update can't be recalled."`)
    && /\{PUBLISH_SWITCH_COPY\}/.test(src));
  const toggle = callbackBody(src, 'togglePublish');
  ok('flipping Publish off writes the public_profiles flag, then removes the public copies, on the serial queue',
    /onValueChange=\{val => \{ void togglePublish\(val\); \}\}/.test(src)
    && /serialRef\.current\(async \(\) => \{\s*const o = await writePublicProfileFlag\(ownerId, project\.id, val\);\s*await removePortfolioCopies\(ownerId, project\.id\);/.test(toggle)
    && /genRef\.current\+\+;/.test(toggle));
  const util = strip(readFileSync('utils/portfolioPublish.ts', 'utf8'));
  ok("the flag write goes through supabaseWriteDetailed('public_profiles', 'upsert', …) with the derived id",
    /supabaseWriteDetailed\('public_profiles', 'upsert', \{\s*id: publicProfileIdFor\(ownerId, projectId\)/.test(util));
  // Integration round 1 (web-comms-ai): a server-side storage copy published
  // the original bytes, EXIF GPS included. The photo now comes down from its
  // storagePath, its metadata is stripped, and only the clean bytes go up.
  const copyFn = util.slice(util.indexOf('async function copyOnePhoto('), util.indexOf('function logoTarget('));
  ok('photos are read from their storagePath (never p.uri), metadata-stripped, then uploaded — no server-side copy',
    /const bytes = await downloadPrivatePhoto\(src\);/.test(copyFn)
    && /const clean = stripImageMetadata\(bytes\);\s*if \(!clean\) \{[\s\S]*?return false;\s*\}/.test(copyFn)
    && /\.upload\(dest, clean\.bytes, \{ contentType: clean\.contentType, upsert: true \}\)/.test(copyFn)
    && !/\.copy\(/.test(util)
    && !/p\.uri|\.uri\b(?!\))/.test(util.replace(/res\.uri/g, '')));
  ok('the logo is metadata-stripped too', /const bytes = stripImageMetadata\(raw\)\?\.bytes \?\? raw;/.test(util));
  ok("readPublicProfileStatus asks the page's own anon RPC", /supabase\.rpc\('public_profile_status', \{ p_id: pid \}\)/.test(util));

  // Owner gate (fix round 1 review): a collaborator's publish copied the
  // owner's client photos into a public folder under HIS uid.
  ok('owner gate: only the job owner publishes; the reason is shown and every control is blocked',
    /const isOwner = ownsForPortfolio\(project, ownerId\);/.test(src)
    && /!isOwner\s*\?\s*OWNER_ONLY_REASON/.test(src)
    && raw.includes(`"Project pages are published by the job's owner — ask them to publish it."`)
    && /disabled=\{!!publishBlocked\}/.test(src)
    && /const outBlocked: string \| null = publishBlocked\s*\?\?/.test(src)
    && /testID="public-profile-publish-blocked">\{publishBlocked\}/.test(src)
    && /\{profile\.enabled && !publishBlocked && \(/.test(src)
    && /if \(publishBlocked \|\| !ownerId\) \{/.test(toggle)
    && /if \(!ownerId \|\| !project \|\| !isOwner\) return;/.test(src));
  ok('shared jobs sort last in the picker and say the owner publishes them',
    /ownsForPortfolio\(p, ownerId\) \? 0 : 1/.test(src) && /'Shared with you · owner publishes'/.test(src));

  // Publishing runs OFF the tap (fix round 1 review: on web the awaits spent
  // the click's user activation, so window.open / clipboard / share refused).
  const prep = callbackBody(src, 'prepare');
  const flagAt = prep.indexOf('writePublicProfileFlag(ownerId, projectId, true)');
  const liveAt = prep.indexOf('readPublicProfileStatus(pid)');
  const assetsAt = prep.indexOf('publishPortfolioAssets(');
  ok('prepare: on the serial queue — flag on, then the live check, then the copies',
    /await serialRef\.current\(async \(\): Promise<PrepareOutcome> => \{/.test(prep)
    && flagAt > 0 && liveAt > flagAt && assetsAt > liveAt, `${flagAt} ${liveAt} ${assetsAt}`);
  ok('prepare: a flag write that did not land, or a page that would read "taken down", stops with the reason',
    /if \(flag !== 'synced'\) \{[\s\S]*?return \{\s*ok: false,/.test(prep)
    && /if \(!live\) return \{ ok: false, reason: NOT_ON_SERVER_REASON \};/.test(prep)
    && /hasn't synced yet — publish once it has/.test(raw));
  ok('prepare waits for the server flag read (a page taken down elsewhere is not turned back on)',
    /if \(serverCheck !== 'done' && !touchedRef\.current\) return;/.test(src)
    && /setServerCheck\(state === 'unknown' \? 'unknown' : 'done'\)/.test(src));
  ok('sample jobs are not published', /isSampleProjectName\(project\.name\)\s*\?\s*SAMPLE_REASON/.test(src));
  ok('the link is built from what landed for the CURRENT key',
    /const ready = prepared && prepared\.key === prepareKey \? prepared\.res : null;/.test(src)
    && /ready \? buildLink\(ready\.photoUrls, ready\.logoUrl\) : ''/.test(src));

  // The tap path: no await before the copy / share / window.open on web.
  const out = callbackBody(src, 'handleOut');
  const webBranch = out.slice(out.indexOf("if (Platform.OS === 'web') {"), out.indexOf('void (async () => {'));
  ok('web tap: runOut is called before any await', /runOut\(kind, url\);\s*return;/.test(webBranch) && !/await/.test(webBranch)
    && out.indexOf("if (Platform.OS === 'web')") < out.indexOf('await'));
  const run = callbackBody(src, 'runOut');
  ok('runOut starts copy / share / preview synchronously (no await in it)',
    !/\bawait\b/.test(run) && /void copyToClipboard\(url\)\.then/.test(run) && /void shareText\(\{/.test(run) && /openPreview\(url\);/.test(run));
  ok('native still asks first: un-uploaded photos ("Share without them"), copies left out, a long link',
    /plan\.notUploaded\.length/.test(out) && out.includes("'Share without them'") && /if \(left > 0\)/.test(out) && /if \(tooLong\)/.test(out));
  ok('web shows the long-link warning inline', /const tooLong = publicUrl\.length > PORTFOLIO_URL_WARN_LENGTH;/.test(src) && /testID="public-profile-link-long"/.test(src));
  ok('Copy / Share / Preview are disabled with a visible reason while blocked or preparing',
    (src.match(/disabled=\{!!outBlocked\}/g) ?? []).length === 3
    && /\? 'Turn on Publish to get a link\.'/.test(src) && /'Preparing the link…'/.test(src)
    && /testID="public-profile-share-blocked">\{outBlocked\}/.test(src) && /testID="public-profile-retry"/.test(src));
  ok('the photo section says how many were left out, and why',
    /haven't uploaded yet and are left out of the link/.test(raw) && /couldn't be copied to the public page/.test(raw));
  ok('a "Show street address" switch, off unless he turns it on, previewing the exact line',
    /testID="public-profile-show-street-address"/.test(src) && /value=\{profile\.showAddress === true\}/.test(src)
    && /testID="public-profile-location-preview"/.test(src) && /publicLocationFor\(project, profile\)/.test(src));
  ok('the snapshot gets pid + only the published photo/logo URLs',
    /pid: ownerId \? publicProfileIdFor\(ownerId, project\.id\) : undefined/.test(src)
    && /publicPhotoUrls: photoUrls/.test(src) && /publicLogoUrl: logoUrl/.test(src));
  ok('the server flag is read on open and wins over the device copy',
    /readPublicProfileFlag\(ownerId, project\.id\)/.test(src) && /server !== null && server !== localOn/.test(src)
    && /if \(!data\) return 'missing';/.test(util) && /if \(error\) return 'unknown';/.test(util));

  // #177
  const prevAt = src.indexOf('function openPreview(');
  const prev = prevAt >= 0 ? src.slice(prevAt, src.indexOf('\n}\n', prevAt)) : '';
  ok('#177: Preview opens on native (in-app browser, then Linking) and a failure says what to do',
    /WebBrowser\.openBrowserAsync\(url\)/.test(prev) && /Linking\.openURL\(url\)/.test(prev)
    && /Copy the link and open it in Safari/.test(prev) && /Haptics\.selectionAsync\(\)/.test(prev)
    && /w\.open\(url, '_blank'\)/.test(prev) && /tab\.opener = null/.test(prev)
    && /if \(!tab\) \{\s*showAlert\('Could not open preview'/.test(prev));
  ok('#177: the web branch of openPreview opens before any await',
    prev.indexOf("if (Platform.OS === 'web')") >= 0 && !/await/.test(prev.slice(0, prev.indexOf('void Haptics.selectionAsync()'))));
  ok('#177: the web-only no-op handler is gone', !/Platform\.OS === 'web' && \(window/.test(src)
    && /onPress=\{handlePreview\}/.test(src));
}

console.log('\napp/company-profile.tsx');
{
  const raw = readFileSync('app/company-profile.tsx', 'utf8');
  const src = strip(raw);
  ok('#133: usePreventRemove holds him on the screen while text is unsaved',
    /import \{ usePreventRemove \} from '@react-navigation\/native';/.test(src)
    && /usePreventRemove\(dirty, \(\{ data \}\) =>/.test(src)
    && /'Keep editing'/.test(src) && /navigation\.dispatch\(data\.action\)/.test(src)
    && /handleSave\(\); navigation\.dispatch\(data\.action\)/.test(src));
  ok('#133: a blur exit (web sidebar / another tab) asks through a focus-effect cleanup',
    /useFocusEffect\(\s*useCallback\(\(\) => \{[\s\S]*?return \(\) => \{[\s\S]*?if \(!guard\.dirty \|\| leavingRef\.current\) return;/.test(src));
  ok('#133: the email baseline is the SEEDED value (branding.email || user.email)',
    /email: branding\.email \|\| user\?\.email \|\| ''/.test(src)
    && /useState\(branding\.email \|\| user\?\.email \|\| ''\)/.test(src));
  ok('#133: Save moves the baseline', /setBaseline\(\{/.test(callbackBody(src, 'handleSave')));
  const auto = callbackBody(src, 'autoSave');
  ok('#133: autoSave merges only logo / signature onto the SAVED branding',
    /mergedBidBranding\(settings\.branding, \{\}\)/.test(auto)
    && !/companyName|brandingPhone|brandingAddress|licenseNumber|tagline\.trim/.test(auto)
    && /'logo' in overrides/.test(auto) && /'sig' in overrides/.test(auto));
  ok('#133: the licence-state row says when it reads an unsaved address', /addressUnsaved\s*\?/.test(src) && /isn\\u2019t saved yet/.test(raw));
  const q = src.match(/quality:\s*([0-9.]+),\s*base64: true/);
  ok('#81: the logo picker keeps the data: URI small (quality <= 0.5)', !!q && Number(q[1]) <= 0.5, q?.[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
