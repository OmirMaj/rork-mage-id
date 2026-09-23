// validate-w5-portfolio-snapshot.ts: what a public project-page link may carry
// (audit wave 5, lane portfolio: #47 / #75 / #77 / #78 / #81).
//
//   #78/#47  the client's street address is OFF by default. Only city/state from
//            the structured fields go out (never parsed from free text). The
//            full location goes out only with showAddress, and hideStats
//            'address' removes the line entirely. Photo captions never fall back
//            to a location label. The page prints `address` only when the
//            snapshot says showAddress.
//   #77      no file:, blob:, data:, ph: or signed /object/sign/ photo URL ever
//            reaches the snapshot. Only public copies in the `portfolio` bucket.
//   #81      a data: logo is dropped (the page shows the initial), so a
//            200 KB logo leaves the link under the 8 KB warning line.
//   #75      the snapshot carries pid = publicProfileIdFor(owner, project), the
//            SAME id the migration's trigger derives (vector computed by
//            PGlite from the SQL). The page asks public_profile_status(pid)
//            before render() and shows "taken down" when it answers false.
//
// Run: bun run scripts/validate-w5-portfolio-snapshot.ts
import { readFileSync } from 'node:fs';
import {
  buildPublicProfileSnapshot, buildPublicProfileUrl, publicLocationFor, publicProfileIdFor,
  sha256Hex, isPortfolioPublicUrl, isDurablePublicUrl, choosePortfolioPhotos,
  PORTFOLIO_URL_WARN_LENGTH, PUBLIC_PROFILE_SNAPSHOT_VERSION,
  ownsForPortfolio, makeSerialQueue,
} from '../utils/publicProfileSnapshot';
import type { Project, ProjectPhoto, AppSettings, PublicProfileSettings } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(p, 'utf8');

const OWNER = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
// Computed by PGlite from supabase/migrations/20260923200000 public_profile_id_for
// (scratchpad w5pf_pg/w5_portfolio.mjs asserts the SQL side equals this).
const SQL_VECTOR = '5bb4e35a-caf6-a350-9cca-98d07d677dcb';
const SB = 'https://nteoqhcswappxxjlpvap.supabase.co';
const pub = (id: string) => `${SB}/storage/v1/object/public/portfolio/${OWNER}/${PROJECT}/${id}.jpg`;

function project(extra: Partial<Project> = {}, profile: PublicProfileSettings = { enabled: true }): Project {
  return {
    id: PROJECT, name: 'Maple kitchen', type: 'renovation',
    location: '1234 Maple St, Springfield, IL 62701',
    structuredAddress: { street: '1234 Maple St', city: 'Springfield', state: 'IL', zip: '62701' },
    squareFootage: 400, quality: 'standard', description: '',
    publicProfile: profile as Project['publicProfile'],
    ...extra,
  } as unknown as Project;
}
const photo = (id: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
  id, projectId: PROJECT, uri: `file:///var/mobile/Containers/Data/${id}.jpg`, storagePath: `${OWNER}/${PROJECT}/${id}.jpg`,
  timestamp: `2026-09-0${id.length % 9 + 1}T12:00:00Z`, createdAt: '2026-09-01T00:00:00Z', ...extra,
} as ProjectPhoto);
const bigLogo = 'data:image/jpeg;base64,' + 'A'.repeat(200_000);
const settings = (logoUri?: string) => ({
  branding: {
    companyName: 'Acme Builders', contactName: 'Sam', email: 'sam@acme.test', phone: '555', address: '',
    licenseNumber: 'CSLB 1', tagline: 'We build', logoUri,
  },
} as unknown as AppSettings);

console.log('\n#78 / #47: the street address stays off by default');
{
  const snap = buildPublicProfileSnapshot({ project: project(), settings: settings() });
  ok('default: no street address in the snapshot', snap.project.address === undefined && !JSON.stringify(snap).includes('Maple St'),
    JSON.stringify(snap.project));
  ok('default: city/state from the structured fields', snap.project.locality === 'Springfield, IL', String(snap.project.locality));
  ok('default: showAddress not set', snap.project.showAddress === undefined);

  const noStruct = buildPublicProfileSnapshot({ project: project({ structuredAddress: undefined }), settings: settings() });
  ok('no structured address → nothing (free text is never parsed into a guess)',
    noStruct.project.address === undefined && noStruct.project.locality === undefined && !JSON.stringify(noStruct).includes('Springfield'),
    JSON.stringify(noStruct.project));

  const opted = buildPublicProfileSnapshot({ project: project({}, { enabled: true, showAddress: true }), settings: settings() });
  ok('showAddress → the full location, flagged for the page',
    opted.project.address === '1234 Maple St, Springfield, IL 62701' && opted.project.showAddress === true);

  const hidden = buildPublicProfileSnapshot({ project: project({}, { enabled: true, showAddress: true, hideStats: ['address'] }), settings: settings() });
  ok("hideStats 'address' → no location at all, even with showAddress",
    hidden.project.address === undefined && hidden.project.locality === undefined, JSON.stringify(hidden.project));

  ok('publicLocationFor previews exactly what prints',
    publicLocationFor(project(), { showAddress: false }).shown === 'Springfield, IL'
    && publicLocationFor(project(), { showAddress: true }).shown === '1234 Maple St, Springfield, IL 62701'
    && publicLocationFor(project(), { hideStats: ['address'] }).shown === '');

  const cap = buildPublicProfileSnapshot({
    project: project(), settings: settings(),
    photos: [photo('p1', { location: '1234 Maple St — kitchen', locationLabel: '1234 Maple St, Springfield', tag: undefined }), photo('p2', { tag: 'After' })],
    publicPhotoUrls: { p1: pub('p1'), p2: pub('p2') },
  });
  const capOf = (u: string) => cap.photos.find(p => p.url === u)?.caption;
  ok('photo caption never falls back to a location label',
    capOf(pub('p1')) === undefined && capOf(pub('p2')) === 'After', JSON.stringify(cap.photos));
}

console.log('\n#77: only public portfolio copies, never a URL that dies');
{
  const photos = [
    photo('local'),                                                           // file:// on the phone that took it
    photo('signed', { uri: `${SB}/storage/v1/object/sign/project-photos/${OWNER}/${PROJECT}/signed.jpg?token=abc` }),
    photo('blob', { uri: 'blob:https://app.mageid.app/123' }),
    photo('data', { uri: 'data:image/jpeg;base64,AAAA' }),
    photo('ph', { uri: 'ph://ABC-123' }),
    photo('pending', { storagePath: undefined }),
    photo('copied'),
  ];
  const none = buildPublicProfileSnapshot({ project: project(), settings: settings(), photos });
  ok('with no published copies the link carries NO photos (p.uri is never a fallback)', none.photos.length === 0, JSON.stringify(none.photos));

  const mixed = buildPublicProfileSnapshot({
    project: project(), settings: settings(), photos,
    publicPhotoUrls: {
      local: 'file:///var/mobile/local.jpg',
      signed: `${SB}/storage/v1/object/sign/project-photos/x.jpg?token=abc`,
      blob: 'blob:https://app.mageid.app/1', data: 'data:image/jpeg;base64,AAAA', ph: 'ph://X',
      copied: pub('copied'),
    },
  });
  ok('only the portfolio-bucket URL survives', mixed.photos.length === 1 && mixed.photos[0].url === pub('copied'), JSON.stringify(mixed.photos));
  const json = JSON.stringify(mixed);
  ok('the snapshot holds no file: / blob: / data: / ph: / signed URL anywhere',
    !/file:|blob:|data:|ph:\/\/|\/object\/sign\//i.test(json), json.slice(0, 300));
  ok('isPortfolioPublicUrl: public portfolio yes; other buckets / signed / http no',
    isPortfolioPublicUrl(pub('x'))
    && !isPortfolioPublicUrl(`${SB}/storage/v1/object/public/project-photos/x.jpg`)
    && !isPortfolioPublicUrl(`${SB}/storage/v1/object/sign/portfolio/x.jpg?token=1`)
    && !isPortfolioPublicUrl(pub('x').replace('https:', 'http:')));
  ok('choosePortfolioPhotos keeps his explicit order and the 18 cap',
    choosePortfolioPhotos({ selectedPhotoIds: ['b', 'a'] }, [photo('a'), photo('b'), photo('c')]).map(p => p.id).join() === 'b,a'
    && choosePortfolioPhotos(undefined, Array.from({ length: 30 }, (_, i) => photo(`n${i}`))).length === 18);
}

console.log('\n#81: a data: logo never rides in the link');
{
  const snap = buildPublicProfileSnapshot({ project: project(), settings: settings(bigLogo), ownerId: OWNER, pid: publicProfileIdFor(OWNER, PROJECT) });
  ok('data: logo dropped (page falls back to the company initial)', snap.company.logoUri === undefined);
  const url = buildPublicProfileUrl('https://mageid.app/builders', 'acme-builders', 'maple-kitchen', snap);
  ok(`with a 200 KB data: logo the link stays under ${PORTFOLIO_URL_WARN_LENGTH} chars`, url.length < PORTFOLIO_URL_WARN_LENGTH, `${url.length} chars`);
  const fileLogo = buildPublicProfileSnapshot({ project: project(), settings: settings('file:///var/mobile/logo.png') });
  ok('file: logo dropped', fileLogo.company.logoUri === undefined);
  const signedLogo = buildPublicProfileSnapshot({ project: project(), settings: settings(`${SB}/storage/v1/object/sign/branding/l.png?token=x`) });
  ok('signed logo dropped', signedLogo.company.logoUri === undefined);
  const published = buildPublicProfileSnapshot({ project: project(), settings: settings(bigLogo), publicLogoUrl: `${SB}/storage/v1/object/public/portfolio/${OWNER}/branding/logo-ab.jpg` });
  ok("the logo's public copy is used when one was made", published.company.logoUri?.endsWith('/logo-ab.jpg') === true);
  ok('isDurablePublicUrl rejects data:/file:/signed, accepts plain https',
    !isDurablePublicUrl(bigLogo) && !isDurablePublicUrl('file:///x') && !isDurablePublicUrl('https://x.test/a.png?token=1')
    && isDurablePublicUrl('https://x.test/a.png'));
}

console.log('\n#75: the page id the server checks');
{
  ok('sha256Hex matches the FIPS vector for "abc"',
    sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  ok('publicProfileIdFor == the SQL public_profile_id_for vector', publicProfileIdFor(OWNER, PROJECT) === SQL_VECTOR, publicProfileIdFor(OWNER, PROJECT));
  const snap = buildPublicProfileSnapshot({ project: project(), settings: settings(), ownerId: OWNER, pid: publicProfileIdFor(OWNER, PROJECT) });
  ok('the snapshot carries pid and is v2', snap.pid === SQL_VECTOR && snap.v === PUBLIC_PROFILE_SNAPSHOT_VERSION && snap.v >= 2);
  const mig = read('supabase/migrations/20260923200000_public_profiles_portfolio.sql');
  const ts = read('utils/publicProfileSnapshot.ts');
  ok('SQL and TS derive from the same seed string',
    mig.includes("'mageid-portfolio:v1:' || p_owner::text || ':' || p_project_id") && ts.includes('`mageid-portfolio:v1:${ownerId}:${projectId}`'));
  ok('migration: owner-only RLS, anon status RPC returning only enabled, derived id, silent pins',
    /create table if not exists public\.public_profiles/.test(mig)
    && /public_profiles_owner_(select|insert|update|delete)/.test(mig)
    && /create or replace function public\.public_profile_status\(p_id uuid\)[\s\S]*security definer/.test(mig)
    && /grant execute on function public\.public_profile_status\(uuid\) to anon/.test(mig)
    && /jsonb_build_object\('enabled'/.test(mig)
    && /new\.id := public\.public_profile_id_for\(new\.owner_id, new\.project_id\)/.test(mig)
    && /new\.owner_id := old\.owner_id;/.test(mig) && !/raise exception/i.test(mig));
  ok("migration: public 'portfolio' bucket, writes only under the writer's uid folder",
    /values \('portfolio', 'portfolio', true/.test(mig)
    && (mig.match(/bucket_id = 'portfolio'\s+and \(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) ?? []).length >= 5);
  // A collaborator can read the owner's private photos; without this he could
  // copy them into a PUBLIC folder under his own uid (fix round 1 review).
  const ownedJob = /\(storage\.foldername\(name\)\)\[2\] = 'branding'\s+or exists \(\s+select 1 from public\.projects p\s+where p\.id::text = \(storage\.foldername\(objects\.name\)\)\[2\]\s+and p\.user_id = auth\.uid\(\)/g;
  const ins = mig.slice(mig.indexOf('create policy portfolio_owner_insert'), mig.indexOf('drop policy if exists portfolio_owner_update'));
  const upd = mig.slice(mig.indexOf('create policy portfolio_owner_update'), mig.indexOf('drop policy if exists portfolio_owner_delete'));
  ok("migration: bucket INSERT / UPDATE only into 'branding' or a job the writer owns (objects.name qualified)",
    (ins.match(ownedJob) ?? []).length === 1 && (upd.match(ownedJob) ?? []).length === 1);
}

console.log('\nowner gate + serial queue (pure)');
{
  ok('ownsForPortfolio: his job, a not-yet-synced job (no ownerUserId) → true',
    ownsForPortfolio({ ownerUserId: 'u1' }, 'u1') && ownsForPortfolio({}, 'u1'));
  ok("ownsForPortfolio: a job shared with him, or no signed-in user → false",
    !ownsForPortfolio({ ownerUserId: 'owner' }, 'collab') && !ownsForPortfolio({ ownerUserId: 'u1' }, undefined) && !ownsForPortfolio(undefined, 'u1'));
}
await (async () => {
  const run = makeSerialQueue();
  const log: string[] = [];
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  // A slow publish handed in first, a fast take-down second: the take-down
  // must not start until the publish has finished (else it deletes fresh copies).
  const a = run(async () => { log.push('publish:start'); await wait(30); log.push('publish:end'); return 1; });
  const b = run(async () => { log.push('remove:start'); await wait(1); log.push('remove:end'); return 2; });
  const c = run(async () => { throw new Error('boom'); });
  const d = run(async () => { log.push('after-failure'); return 4; });
  const [ra, rb, rc, rd] = await Promise.allSettled([a, b, c, d]);
  ok('makeSerialQueue: jobs run one after another in hand-in order',
    log.join(',') === 'publish:start,publish:end,remove:start,remove:end,after-failure', log.join(','));
  ok('makeSerialQueue: results come back to each caller; a failure rejects only its own job',
    ra.status === 'fulfilled' && ra.value === 1 && rb.status === 'fulfilled' && rb.value === 2
    && rc.status === 'rejected' && rd.status === 'fulfilled' && rd.value === 4);
})();

console.log('\nmarketing/builders/index.html');
{
  const html = read('marketing/builders/index.html');
  const script = html.slice(html.lastIndexOf('<script>'));
  ok('the address prints only when the snapshot says showAddress; else locality',
    /project\.showAddress === true && project\.address/.test(script) && /project\.locality/.test(script)
    && !/if \(project\.address\) metaParts\.push/.test(script));
  ok("hideStats 'address' is honoured by the page", /hide\.indexOf\('address'\) === -1/.test(script));
  const tail = script.slice(script.indexOf('var data = decodeHash();'));
  ok('a link with pid is checked by public_profile_status BEFORE render(), and false shows taken down',
    /rpc\/public_profile_status/.test(script)
    && /checkPublished\(data\.pid\)\.then\(function \(enabled\) \{\s*if \(enabled === false\) \{ document\.getElementById\('taken-down'\)\.style\.display = 'flex'; return; \}\s*render\(data\);/.test(tail)
    && html.includes('This page was taken down by the builder'));
  ok('photos: only loadable https URLs; broken tiles hide; the hero waits for its image',
    /photos = \(data\.photos \|\| \[\]\)\.filter\(function \(p\) \{ return p && isLoadableUrl\(p\.url\); \}\)/.test(script)
    && /tile\.style\.display = 'none'/.test(script) && /probe\.onload = function/.test(script)
    && !/backgroundImage = 'url\(' \+ photos\[0\]\.url/.test(script));
  ok('logo: https only, falls back to the initial on error',
    /if \(isLoadableUrl\(company\.logoUri\)\)/.test(script) && /logoImg\.addEventListener\('error'/.test(script));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
