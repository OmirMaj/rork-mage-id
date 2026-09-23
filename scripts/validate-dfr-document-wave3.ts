// validate-dfr-document-wave3.ts — the dfr-document lane of the 2026-09-18
// workflow audit: the documents a daily report, a change order, a submittal and
// a quick estimate turn into.
//
//   #25  the filed DFR PDF carries the crew table, materials, the incident and
//        the photos (with markup); the email is a summary that links it; a DFR
//        photo opens the existing annotator by its shared gallery id
//   #26  weather prints what was recorded ("Not recorded" when blank), never a
//        parseInt'd high/low; "Today's" only on today's report; the title day is
//        the calendar day, not UTC midnight
//   #27  web: no project-files copy (disabled with the reason, Print instead),
//        no hidden print tab after an awaited send, never 'sent' on nothing
//   #117 everything he typed is HTML-escaped in the email / filed copy
//   handoffs: #35/#131/#129 CO email + CO PDF, #124 blocked-window throws,
//   #158/#118 quick-estimate cents, #146 attachment naming + https download,
//   #150 submittal Required By day, #57 no "attached" when nothing is.
//
// The real modules are EXECUTED under bun with react-native / expo / Supabase
// stubbed (same technique as validate-closeout-binder.ts); screen wiring is
// pinned by source with comments stripped.
//
// Run via: bun run scripts/validate-dfr-document-wave3.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The day bugs are invisible at UTC. Pin a zone west of Greenwich BEFORE any
// Date is built.
process.env.TZ = 'America/Los_Angeles';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600)}` : ''}`); }
}

// ── stubs ────────────────────────────────────────────────────────────────────
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-dfr-document-wave3 must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
const Platform = { OS: 'ios' as string, select: (o: Record<string, unknown>) => o.ios ?? o.default };
let printedHtml = '';
const fsCalls: string[] = [];
const FS = {
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: async (uri: string) => {
    fsCalls.push(`read:${uri}`);
    // Like the real module: only a file:// path is readable (a ph:// library
    // reference is not a file expo-file-system can open).
    if (!uri.startsWith('file://') || uri.startsWith('file:///broken')) throw new Error('unreadable');
    return 'QUJD';
  },
  downloadAsync: async (url: string, to: string) => { fsCalls.push(`download:${url}`); return { uri: to, status: 200 }; },
  writeAsStringAsync: async () => {},
};
let signedMap = new Map<string, string>();
Bun.plugin({
  name: 'dfr-document-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: {
      printToFileAsync: async ({ html }: { html: string }) => { printedHtml = html; return { uri: 'file:///cache/out.pdf' }; },
      printAsync: async () => {},
    }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: FS, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
    build.module('@/utils/storage', () => ({ exports: { resolvePhotoUrls: async (paths: string[]) => new Map(paths.filter(p => signedMap.has(p)).map(p => [p, signedMap.get(p)!])) }, loader: 'object' }));
  },
});

const em = await import('../utils/emailService');
const pdf = await import('../utils/pdfGenerator');
const docs = await import('../utils/projectDocuments');
const pf = await import('../utils/platformFile');

const DFR = read('app/daily-report.tsx');
const DFR_CODE = strip(DFR);
const EMAIL = read('utils/emailService.ts');
const PDF = read('utils/pdfGenerator.ts');
const PDF_CODE = strip(PDF);
const DOCS_CODE = strip(read('utils/projectDocuments.ts'));
const CO_CODE = strip(read('app/change-order.tsx'));

// ── the dfr-document pure block in the screen ────────────────────────────────
type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const bStart = DFR.indexOf('// >>> dfr-document-pure');
const bEnd = DFR.indexOf('// <<< dfr-document-pure');
ok('app/daily-report.tsx carries the dfr-document-pure block', bStart > -1 && bEnd > bStart);
const block = DFR.slice(bStart, bEnd);
ok('the pure block imports nothing', !/^import /m.test(block));
const names = ['DFR_FILES_NEEDS_APP', 'dfrProjectFilesAvailable', 'dfrSendPlan', 'dfrDelivered', 'dfrPhotoMarkupTarget'];
const P = new Function(`${new Transpiler({ loader: 'ts' }).transformSync(block.replace(/^export /gm, ''))}\nreturn { ${names.join(', ')} };`)() as {
  DFR_FILES_NEEDS_APP: string;
  dfrProjectFilesAvailable(os: string): boolean;
  dfrSendPlan(o: { email: string; saveToggle: boolean; os: string }): { wantsEmail: boolean; fileCopy: boolean; blocker: { title: string; message: string } | null };
  dfrDelivered(o: { wantsEmail: boolean; emailSent: boolean; fileSaved: boolean }): boolean;
  dfrPhotoMarkupTarget(o: { photoId: string; galleryIds: readonly string[]; reportSent?: boolean }): { action: 'annotate'; photoId: string; lockedNote?: string } | { action: 'blocked'; reason: string };
};

const baseEmail = {
  companyName: 'Ortiz Builders',
  recipientName: 'Dana',
  projectName: 'Maple St Remodel',
  totalManpower: 4,
  totalManHours: 32,
  workPerformed: 'Framed the east wall.',
  issuesAndDelays: '',
  today: '2026-09-14',
};

// ── #26 weather + date wording ───────────────────────────────────────────────
console.log('\n#26 weather prints what was recorded; the day is the report\'s day:');
{
  ok('blank weather → "Not recorded"', em.dfrWeatherLine({ conditions: '', temperature: '', wind: '' }) === 'Not recorded');
  ok('recorded strings pass through unchanged, joined',
    em.dfrWeatherLine({ conditions: 'Clear', temperature: '72°F / 22°C', wind: '5 mph NW' }) === 'Clear · 72°F / 22°C · 5 mph NW');
  ok('a single part prints alone (no dangling separators)', em.dfrWeatherLine({ conditions: '', temperature: '54°F', wind: '' }) === '54°F');

  const blank = em.buildDailyReportEmailHtml({ ...baseEmail, date: '2026-09-11', weather: { conditions: '', temperature: '', wind: '' } });
  ok('backfilled day with no weather: the email says "Not recorded"', blank.includes('Not recorded'));
  ok('…and never prints a 0° reading', !/0°/.test(blank), blank.match(/Weather[\s\S]{0,300}/)?.[0]);
  ok('…and the preheader has no "· ·" hole', !blank.includes('· ·'));
  const live = em.buildDailyReportEmailHtml({ ...baseEmail, date: '2026-09-14', weather: { conditions: 'Clear', temperature: '72°F / 22°C', wind: '' } });
  ok('live weather prints the recorded reading', live.includes('Clear · 72°F / 22°C'));
  ok('…and no invented high/low pair', !live.includes('72° / 72°F'));

  ok('a backfilled report is not "Today\'s report"', !blank.includes('Today&#39;s report') && !blank.includes("Today's report"));
  ok('…its subtitle is "Field report for <project>"', blank.includes('Field report for Maple St Remodel.'));
  ok('…its intro names its own day', blank.includes('The field report for Friday, September 11, 2026 is below.'));
  ok('today\'s report still says "Today\'s"', live.includes('Today&#39;s report for Maple St Remodel.') && live.includes('Today&#39;s field report is below.'));
  ok('the title is the calendar day west of Greenwich (not Thursday the 10th)',
    blank.includes('Friday, September 11, 2026') && !blank.includes('September 10'));
  ok('the screen no longer parseInt\'s the temperature into a high/low',
    !/tempHigh|tempLow/.test(DFR_CODE) && !/parseInt\(String\(weather\.temperature\)\)/.test(DFR_CODE));
  ok('the builder has no tempHigh/tempLow left', !/tempHigh|tempLow/.test(strip(EMAIL)));
  ok('the DFR PDF prints "Not recorded" for a blank reading, not a dash',
    /const nr = \(v: string \| undefined\) => \(v && v\.trim\(\)\) \|\| 'Not recorded';/.test(PDF_CODE)
      && /value: nr\(dfr\.weather\?\.temperature\)/.test(PDF_CODE));
}

// ── #117 escaping ────────────────────────────────────────────────────────────
console.log('\n#117 everything he typed is escaped:');
{
  const html = em.buildDailyReportEmailHtml({
    ...baseEmail,
    recipientName: 'Dana <Ops>',
    projectName: 'Lot 7 <b>East</b>',
    date: '2026-09-14',
    weather: { conditions: 'Rain<br check', temperature: '54°F', wind: '' },
    workPerformed: 'Header <ft short, see RFI> & shimmed',
    issuesAndDelays: 'Framing<br check & delay',
  });
  ok('work performed: "<ft short" survives as text', html.includes('Header &lt;ft short, see RFI&gt; &amp; shimmed') && !html.includes('<ft short'));
  ok('issues: "Framing<br check" survives as text', html.includes('Framing&lt;br check &amp; delay') && !html.includes('Framing<br'));
  ok('recipient name is escaped', html.includes('Hi Dana &lt;Ops&gt;,'));
  ok('the weather value inside the stat row is escaped', html.includes('Rain&lt;br check') && !html.includes('Rain<br'));
  ok('the project name never lands as markup', !html.includes('<b>East</b>'));
}

// ── #25 the email is a summary that links the filed record ───────────────────
console.log('\n#25 email summary: crew, materials, incident, a link — no photos:');
{
  const html = em.buildDailyReportEmailHtml({
    ...baseEmail,
    date: '2026-09-14',
    weather: { conditions: 'Clear', temperature: '70°F', wind: '' },
    manpower: [
      { trade: 'Framing', company: 'Ortiz Builders', headcount: 3, hoursWorked: 8 },
      { trade: 'Electrical', company: 'Volt & Co', headcount: 1, hoursWorked: 8 },
    ],
    materialsDelivered: ['20 sheets drywall — ABC Supply'],
    incident: { severity: 'minor', description: 'Cut hand on flashing', classification: 'Not recordable — first aid only, no days away, no restriction.', injuriesReported: true, correctiveAction: 'Gloves required' },
    photoCount: 3,
    filedPdfUrl: 'https://x.supabase.co/storage/v1/object/sign/project-documents/p/daily-reports/r.pdf?token=abc',
    filedPdfLinkDays: 30,
  });
  ok('the crew is broken out per trade and company', html.includes('Framing — Ortiz Builders') && html.includes('3 × 8 h = 24 h') && html.includes('Electrical — Volt &amp; Co'));
  ok('materials delivered are listed', html.includes('20 sheets drywall — ABC Supply'));
  ok('the incident is inline with its classification', html.includes('Cut hand on flashing') && html.includes('Not recordable — first aid only'));
  ok('the filed PDF is the button', /href="https:\/\/x\.supabase\.co\/storage\/v1\/object\/sign\/project-documents[^"]*"[^>]*>Open the full report \(PDF\)/.test(html));
  ok('…and the email says how long the link works', html.includes('the link works for 30 days'));
  ok('no photo is embedded in the email', !/<img[^>]+(data:image|photo)/i.test(html.replace(/<img[^>]*logo[^>]*>/gi, '')));
  const noLink = em.buildDailyReportEmailHtml({ ...baseEmail, date: '2026-09-14', weather: { conditions: '', temperature: '', wind: '' }, photoCount: 2 });
  ok('without a filed copy the email never promises a link', !noLink.includes('Open the full report') && noLink.includes('2 photos are on this report'));
}

// ── #25 the filed PDF ────────────────────────────────────────────────────────
console.log('\n#25 the filed PDF is the full record:');
const project = { id: 'p1', name: 'Maple St Remodel', location: '12 Maple St' } as unknown as Parameters<typeof pdf.buildDFRHtml>[1];
const branding = { companyName: 'Ortiz Builders', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' } as unknown as Parameters<typeof pdf.buildDFRHtml>[2];
const dfrBase = {
  id: 'r1', projectId: 'p1', date: '2026-09-11',
  weather: { temperature: '', conditions: '', wind: '', isManual: false },
  manpower: [{ id: 'm1', trade: 'Framing', company: 'Ortiz Builders', headcount: 3, hoursWorked: 8 }],
  workPerformed: 'Header <ft short', materialsDelivered: ['LVL beams'], issuesAndDelays: '',
  photos: [
    { id: 'ph1', uri: 'file:///var/mobile/a.jpg', timestamp: '2026-09-11T17:00:00Z' },
    { id: 'ph2', uri: 'ph://ABC', timestamp: '2026-09-11T17:05:00Z', storagePath: 'u/p/ph2.jpg' },
    { id: 'ph3', uri: 'ph://DEF', timestamp: '2026-09-11T17:06:00Z' },
  ],
  status: 'draft',
  incident: { hasIncident: true, severity: 'moderate', description: 'Ladder slipped', peopleInvolved: 'J. Ruiz', injuriesReported: true, medicalTreatment: true, oshaRecordable: true, correctiveAction: 'Ladder tie-offs', reportedBy: 'Sam' },
  createdAt: '2026-09-11T17:00:00Z', updatedAt: '2026-09-11T17:00:00Z',
} as unknown as Parameters<typeof pdf.buildDFRHtml>[0];
{
  const markup = [
    { id: 'k1', type: 'arrow', color: 'red', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] },
    { id: 'k2', type: 'circle', color: 'yellow', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] },
    { id: 'k3', type: 'freehand', color: 'green', points: [{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.8 }, { x: 0.3, y: 0.9 }] },
    { id: 'k4', type: 'text', color: 'red', points: [{ x: 0.3, y: 0.3 }], text: 'Crack <here>' },
  ] as unknown as NonNullable<Parameters<typeof pdf.dfrMarkupSvg>[0]>;
  const svg = pdf.dfrMarkupSvg(markup);
  ok('markup renders every tool in normalized coordinates', svg.includes('viewBox="0 0 1 1"') && svg.includes('<line') && svg.includes('<circle') && svg.includes('<path d="M0.1000,0.9000') && svg.includes('<text'));
  ok('markup text is escaped', svg.includes('Crack &lt;here&gt;') && !svg.includes('<here>'));
  ok('no markup → no overlay', pdf.dfrMarkupSvg([]) === '' && pdf.dfrMarkupSvg(undefined) === '');

  const html = pdf.buildDFRHtml(dfrBase, project, branding, {
    photos: [
      { id: 'ph1', src: 'data:image/jpeg;base64,QUJD', timestamp: '2026-09-11T17:00:00Z', markup },
      { id: 'ph2', src: null, notUploaded: false },
      { id: 'ph3', src: null, notUploaded: true },
    ],
    incidentClassification: 'Recordable — medical treatment beyond first aid.',
  });
  ok('the photo prints (embedded) instead of "N photos attached"', html.includes('src="data:image/jpeg;base64,QUJD"') && !/photos? attached — see digital copy/.test(html));
  ok('its markup is drawn over it', html.includes('viewBox="0 0 1 1"') && html.includes('marked up'));
  ok('a photo that could not be loaded says so (never a blank image)', html.includes('could not be loaded into the PDF'));
  ok('a photo still only on the phone says so', html.includes('Not uploaded yet — this photo is still only on the phone that took it.'));
  ok('the incident block is on the record with its classification',
    html.includes('>Incident<') && html.includes('Ladder slipped') && html.includes('Recordable — medical treatment beyond first aid.') && html.includes('<strong>OSHA recordable:</strong> Yes'));
  ok('an injured worker\'s name is not printed on a document the client can open', !html.includes('J. Ruiz') && html.includes('recorded on the incident case'));
  ok('the per-trade / per-company crew table is on the record', html.includes('>Framing<') && html.includes('Ortiz Builders'));
  ok('materials delivered are on the record', html.includes('LVL beams'));
  ok('his text is escaped in the PDF too', html.includes('Header &lt;ft short') && !html.includes('<ft short'));
  ok('blank weather prints "Not recorded" in the PDF', (html.match(/Not recorded/g) ?? []).length >= 3);

  const many = pdf.buildDFRHtml({ ...dfrBase, incident: undefined } as typeof dfrBase, project, branding, {
    photos: Array.from({ length: pdf.DFR_PDF_MAX_PHOTOS + 2 }, (_, i) => ({ id: `x${i}`, src: `https://cdn.test/${i}.jpg` })),
  });
  ok('past the cap the extra photos are named, not dropped silently', many.includes('2 more photos on this report in MAGE ID'));
  ok('no incident → no incident block', !many.includes('>Incident<'));

  const sync = pdf.dfrDocumentPhotosSync(
    [{ id: 'a', uri: 'file:///x.jpg', timestamp: 't' }, { id: 'b', uri: 'https://cdn.test/b.jpg', timestamp: 't', storagePath: 'u/p/b.jpg' }],
    [{ id: 'b', markup: markup }],
  );
  ok('sync photos (web Print): a device file is not printable, a URL is; markup comes from the gallery copy',
    sync[0].src === null && sync[0].notUploaded === true && sync[1].src === 'https://cdn.test/b.jpg' && sync[1].markup === markup && sync[1].notUploaded === false);
}

// ── #25 photos are resolved to embedded data before printToFileAsync ────────
console.log('\n#25 native: photos are embedded, remote-only ones downloaded first:');
{
  Platform.OS = 'ios';
  fsCalls.length = 0;
  signedMap = new Map([['u/p/ph2.jpg', 'https://sb.test/sign/ph2.jpg?token=t']]);
  const gallery = [{ id: 'ph1', markup: [{ id: 'k', type: 'arrow', color: 'red', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }] as unknown as Parameters<typeof docs.resolveDfrPhotosForDocument>[1];
  const out = await docs.resolveDfrPhotosForDocument((dfrBase as { photos: Parameters<typeof docs.resolveDfrPhotosForDocument>[0] }).photos, gallery);
  ok('the device file is embedded as a data: URI', out[0].src === 'data:image/jpeg;base64,QUJD', out[0]);
  ok('…with the markup from its gallery copy', (out[0].markup?.length ?? 0) === 1);
  ok('a photo only in storage is downloaded, then embedded', fsCalls.some(c => c.startsWith('download:https://sb.test/sign/ph2.jpg')) && out[1].src === 'data:image/jpeg;base64,QUJD', { fsCalls, out1: out[1] });
  ok('a photo with no storage copy and no readable file prints as "not uploaded"', out[2].src === null && out[2].notUploaded === true, out[2]);
  Platform.OS = 'web';
  const web = await docs.resolveDfrPhotosForDocument([{ id: 'w', uri: 'https://cdn.test/w.jpg', timestamp: 't', storagePath: 'u/p/w.jpg' }] as Parameters<typeof docs.resolveDfrPhotosForDocument>[0], []);
  ok('web passes a loadable URL through', web[0].src === 'https://cdn.test/w.jpg');
  Platform.OS = 'ios';
}

// ── #25 the screen files THE document and opens the annotator ────────────────
console.log('\n#25 screen wiring:');
{
  ok('the email builder is called ONCE (the email) — the filed copy is not the email body',
    (DFR_CODE.match(/buildDailyReportEmailHtml\(/g) ?? []).length === 1);
  ok('the project-files copy renders buildDFRHtml with resolved photos + the classification',
    /const docPhotos = await resolveDfrPhotosForDocument\(doc\.photos, galleryPhotos\);/.test(DFR_CODE)
      && /const html = buildDFRHtml\(doc, project, branding, \{ photos: docPhotos, incidentClassification, filedByName: filedBy\.document \?\? undefined \}\);/.test(DFR_CODE));
  ok('the file is saved BEFORE the email, so the email links it',
    DFR_CODE.indexOf('await saveDailyReportToProjectFiles(') > -1
      && DFR_CODE.indexOf('await saveDailyReportToProjectFiles(') < DFR_CODE.indexOf('const result = await sendEmail('));
  ok('the email carries the crew, materials, incident and the filed link',
    /manpower,\s*materialsDelivered,\s*incident: doc\.incident\?\.hasIncident/.test(DFR_CODE) && /filedPdfUrl: filedLink \?\? undefined/.test(DFR_CODE));
  ok('a photo tile opens the markup tool through dfrPhotoMarkupTarget',
    /onPress=\{\(\) => handlePhotoTap\(photo\.id\)\}/.test(DFR_CODE)
      && /router\.push\(\{ pathname: '\/photo-annotator', params: \{ photoId: target\.photoId \} \}\)/.test(DFR_CODE));
  ok('a photo not yet in the gallery gets the reason, not a dead annotator',
    P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: ['b'] }).action === 'blocked'
      && /Save the report first/.test((P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: [] }) as { reason: string }).reason));
  ok('a mirrored photo opens by its shared id', JSON.stringify(P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: ['a'] })) === JSON.stringify({ action: 'annotate', photoId: 'a' }));
  ok('the signed link replaces the dead public URL on a private bucket',
    /createSignedUrl\(objectName, DFR_FILED_PDF_LINK_DAYS \* 24 \* 60 \* 60\)/.test(DOCS_CODE));
}

// ── #27 web ──────────────────────────────────────────────────────────────────
console.log('\n#27 web: no project-files copy, Print instead, never "sent" on nothing:');
{
  ok('the switch starts off on web, on on the phone', P.dfrProjectFilesAvailable('web') === false && P.dfrProjectFilesAvailable('ios') === true
    && /useState\(\(\) => dfrProjectFilesAvailable\(Platform\.OS\)\)/.test(DFR_CODE));
  const webBlank = P.dfrSendPlan({ email: '  ', saveToggle: true, os: 'web' });
  ok('web + blank email → asks for an email even with a stale toggle', webBlank.blocker?.title === 'Enter an email' && webBlank.fileCopy === false, webBlank);
  ok('…and says why', /needs the mobile app/.test(webBlank.blocker?.message ?? ''));
  const webEmail = P.dfrSendPlan({ email: 'a@b.co', saveToggle: true, os: 'web' });
  ok('web + email → the email only: no project-files attempt, so no print tab and no failure alert', webEmail.blocker === null && webEmail.fileCopy === false);
  const nativeBlank = P.dfrSendPlan({ email: '', saveToggle: true, os: 'ios' });
  ok('phone + blank email + switch on → files the PDF', nativeBlank.blocker === null && nativeBlank.fileCopy === true);
  ok('phone + nothing chosen → "Pick a destination"', P.dfrSendPlan({ email: '', saveToggle: false, os: 'ios' }).blocker?.title === 'Pick a destination');
  ok('sent only when the asked-for delivery happened',
    P.dfrDelivered({ wantsEmail: true, emailSent: true, fileSaved: false }) === true
      && P.dfrDelivered({ wantsEmail: true, emailSent: false, fileSaved: true }) === false
      && P.dfrDelivered({ wantsEmail: false, emailSent: false, fileSaved: true }) === true
      && P.dfrDelivered({ wantsEmail: false, emailSent: false, fileSaved: false }) === false);
  ok('the send handler goes through dfrSendPlan and dfrDelivered',
    /const plan = dfrSendPlan\(\{ email: sendRecipientEmail, saveToggle: saveToProjectFiles, os: Platform\.OS \}\);/.test(DFR_CODE)
      && /if \(!dfrDelivered\(\{ wantsEmail, emailSent, fileSaved \}\)\)/.test(DFR_CODE)
      && !/let delivered = wantsEmail;/.test(DFR_CODE));
  ok('the web row is disabled with the reason and a Print button',
    /testID="dfr-project-files-web-disabled"/.test(DFR_CODE) && /\{DFR_FILES_NEEDS_APP\}/.test(DFR_CODE) && /onPress=\{handlePrintCopy\}/.test(DFR_CODE));
  ok('the screen and projectDocuments give the same reason', P.DFR_FILES_NEEDS_APP === docs.PROJECT_FILES_NEEDS_APP);
  ok('projectDocuments no longer opens a print tab before throwing on web',
    !/printHtmlDocument/.test(DOCS_CODE) && /if \(Platform\.OS === 'web'\) \{\s*throw new Error\(PROJECT_FILES_NEEDS_APP\);/.test(DOCS_CODE));
  ok('Print opens its window synchronously inside the tap, then signs photo URLs fresh',
    /const handlePrintCopy = useCallback\(\(\) => \{[\s\S]{0,120}openPrintWindowAfterOrThrow\(async \(\) => buildDFRHtml\(doc, project, brandingOrBlank\(\), \{\s*photos: await resolveDfrPhotosForDocument\(doc\.photos, galleryPhotos\)/.test(DFR_CODE)
      && !/const handlePrintCopy = useCallback\(async/.test(DFR_CODE));
}

// ── fix round 1: incident evidence, fresh signing, size budget, print wait, sent markup ──
console.log('\n#25 round 1: incident photos stay off the client-linked record:');
{
  const html = pdf.buildDFRHtml({ ...dfrBase, incident: undefined } as typeof dfrBase, project, branding, {
    photos: [
      { id: 'ok1', src: 'data:image/jpeg;base64,T0sx' },
      { id: 'inj', src: 'data:image/jpeg;base64,SU5K', incident: true },
    ],
  });
  ok('an incident photo is never an <img> on the filed PDF', html.includes('base64,T0sx') && !html.includes('base64,SU5K'));
  ok('…and the report says where it is', html.includes('1 incident photo is kept on the incident case, not printed on this report.'));
  ok('the photo count excludes incident evidence', html.includes('Photos (1)'));
  const viaSync = pdf.buildDFRHtml({ ...dfrBase, incident: undefined, photos: [
    { id: 'a', uri: 'https://cdn.test/a.jpg', timestamp: 't' },
    { id: 'b', uri: 'https://cdn.test/injury.jpg', timestamp: 't', incidentPhoto: true },
  ] } as unknown as typeof dfrBase, project, branding);
  ok('the default (sync) path drops DFRPhoto.incidentPhoto too', viaSync.includes('cdn.test/a.jpg') && !viaSync.includes('injury.jpg'));
  const split = pdf.dfrPrintablePhotoSplit([{ incidentPhoto: true }, {}, {}]);
  ok('the email count comes from the same split', split.printable.length === 2 && split.incidentCount === 1
    && /photoCount: dfrPrintablePhotoSplit\(photos as DfrPhotoWithFlag\[\]\)\.printable\.length,/.test(DFR_CODE));

  Platform.OS = 'ios';
  fsCalls.length = 0;
  signedMap = new Map([['u/p/inj.jpg', 'https://sb.test/sign/inj.jpg?token=t'], ['u/p/s.jpg', 'https://sb.test/sign/s.jpg?token=fresh']]);
  const out = await docs.resolveDfrPhotosForDocument([
    { id: 'inj', uri: 'https://old.test/inj.jpg', timestamp: 't', storagePath: 'u/p/inj.jpg', incidentPhoto: true },
    { id: 's', uri: 'https://old.test/s.jpg?token=expired', timestamp: 't', storagePath: 'u/p/s.jpg' },
  ] as unknown as Parameters<typeof docs.resolveDfrPhotosForDocument>[0], []);
  ok('an incident photo is not fetched, and is marked', out[0].incident === true && out[0].src === null && !fsCalls.some(c => c.includes('inj')), fsCalls);
  ok('a stale http uri is re-signed from storagePath, not downloaded as-is',
    fsCalls.some(c => c === 'download:https://sb.test/sign/s.jpg?token=fresh') && !fsCalls.some(c => c.includes('token=expired')), fsCalls);
  Platform.OS = 'web';
  const web = await docs.resolveDfrPhotosForDocument([{ id: 's', uri: 'https://old.test/s.jpg?token=expired', timestamp: 't', storagePath: 'u/p/s.jpg' }] as Parameters<typeof docs.resolveDfrPhotosForDocument>[0], []);
  ok('web Print gets the fresh signed URL too', web[0].src === 'https://sb.test/sign/s.jpg?token=fresh', web[0]);
  Platform.OS = 'ios';

  // Size budget: each stub read is 'QUJD' → a 27-char data URI, so a budget of
  // 60 characters embeds two and names the third.
  const big = await docs.resolveDfrPhotosForDocument(
    [1, 2, 3].map(i => ({ id: `b${i}`, uri: `file:///p${i}.jpg`, timestamp: 't' })) as Parameters<typeof docs.resolveDfrPhotosForDocument>[0], [], { budgetChars: 60 });
  ok('past the embed budget a photo is named, not embedded', !!big[0].src && !!big[1].src && big[2].src === null && big[2].overBudget === true,
    big.map(b => [b.id, !!b.src, b.overBudget]));
  const budgetHtml = pdf.buildDFRHtml({ ...dfrBase, incident: undefined } as typeof dfrBase, project, branding, {
    photos: [{ id: 'x', src: 'data:image/jpeg;base64,WA' }, { id: 'y', src: null, overBudget: true }],
  });
  ok('…and the PDF counts it with the photos not printed', budgetHtml.includes('1 more photo on this report in MAGE ID') && !budgetHtml.includes('could not be loaded'));
  ok('the budget is ~15 MB of base64', pdf.DFR_PDF_EMBED_BUDGET_CHARS === 15_000_000);

  // Print waits for images (Safari prints before remote images load).
  const imgs = [{ complete: false }, { complete: true }];
  let printedAt = -1;
  let ticks = 0;
  const win = { document: { images: imgs }, focus: () => {}, print: () => { printedAt = ticks; } };
  pf.printWhenImagesSettle(win, { firstDelayMs: 0, pollMs: 5, capMs: 5000 });
  await new Promise(r => setTimeout(r, 30));
  ticks = 1;
  ok('print waits while an image is still loading', printedAt === -1);
  imgs[0].complete = true;
  await new Promise(r => setTimeout(r, 30));
  ok('…and prints once every image has settled', printedAt === 1);
  let capped = false;
  pf.printWhenImagesSettle({ document: { images: [{ complete: false }] }, focus: () => {}, print: () => { capped = true; } }, { firstDelayMs: 0, pollMs: 5, capMs: 20 });
  await new Promise(r => setTimeout(r, 80));
  ok('a stalled image cannot hold print forever (cap)', capped);
  {
    const pfCode = strip(read('utils/platformFile.ts'));
    const fnStart = pfCode.indexOf('export function openPrintWindowOrThrow(');
    const fnBody = pfCode.slice(fnStart, pfCode.indexOf('\n}\n', fnStart));
    ok('openPrintWindowOrThrow prints through printWhenImagesSettle, not a bare timer',
      fnStart > -1 && /printWhenImagesSettle\(w\);/.test(fnBody) && !/w\.print\(\)/.test(fnBody));
  }

  const g = globalThis as unknown as { window?: unknown };
  const savedW = g.window;
  g.window = { open: () => null };
  let blocked = '';
  let built = false;
  try { await pf.openPrintWindowAfterOrThrow(async () => { built = true; return 'x'; }); } catch (e) { blocked = (e as Error).message; }
  ok('the deferred print throws on a blocked window before building anything', /blocked the PDF window/.test(blocked) && !built);
  let final = '';
  g.window = { open: () => ({ document: { images: [], open: () => { final = ''; }, write: (h: string) => { final += h; }, close: () => {} }, focus: () => {}, print: () => {}, close: () => {} }) };
  await pf.openPrintWindowAfterOrThrow(async () => '<p>report</p>');
  ok('…and writes the built document into the window it opened', final === '<p>report</p>');
  g.window = savedW;

  const sent = P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: ['a'], reportSent: true }) as { action: string; lockedNote?: string };
  ok('markup on a sent report says it will not change what went out', sent.action === 'annotate' && /not the report that went out/.test(sent.lockedNote ?? ''));
  ok('the tile asks before opening the annotator on a sent report',
    /reportSent: reportIsSent/.test(DFR_CODE) && /if \(target\.lockedNote\) \{\s*showAlert\('This report was already sent', target\.lockedNote/.test(DFR_CODE));
}

// ── #124 a blocked window throws ─────────────────────────────────────────────
console.log('\n#124 web PDF windows: null throws, an open window counts:');
{
  const g = globalThis as unknown as { window?: unknown };
  const saved = g.window;
  let wrote = '';
  g.window = { open: () => null };
  let threw = '';
  try { pf.openPrintWindowOrThrow('<p>x</p>'); } catch (e) { threw = (e as Error).message; }
  ok('a blocked window throws a message he can act on', /blocked the PDF window\. Allow pop-ups for app\.mageid\.app/.test(threw), threw);
  g.window = { open: () => ({ document: { write: (h: string) => { wrote = h; }, close: () => {} }, focus: () => {}, print: () => {} }) };
  let threw2 = false;
  try { pf.openPrintWindowOrThrow('<p>doc</p>'); } catch { threw2 = true; }
  ok('an open window gets the document and does not throw', !threw2 && wrote === '<p>doc</p>');
  Platform.OS = 'web';
  g.window = { open: () => null };
  let rejected = false;
  try {
    await pdf.shareQuickEstimatePDF(
      { summary: '', lineItems: [], subtotal: 0, contingency: 0, permits: 0, total: 0, notes: [] },
      { projectType: 'Bath', sizeSqft: '', location: '', quality: 'standard', scope: '', timelineWeeks: '', specialRequirements: '', targetBudget: '' },
      branding, { depositPct: 30, progressPct: 40, finalPct: 30 },
    );
  } catch { rejected = true; }
  ok('shareQuickEstimatePDF rejects on a blocked window (the wizard skips ESTIMATE_SHARED)', rejected);
  Platform.OS = 'ios';
  g.window = saved;
  ok('no silent `if (newWindow)` share path is left in pdfGenerator', !/if \(newWindow\)/.test(PDF_CODE) && (PDF_CODE.match(/openPrintWindowOrThrow\(html\)/g) ?? []).length === 3);
}

// ── #158/#118 quick estimate to the cent ─────────────────────────────────────
console.log('\n#158/#118 the quick-estimate PDF prints cents:');
{
  printedHtml = '';
  await pdf.shareQuickEstimatePDF(
    {
      summary: 'Bath', notes: [],
      lineItems: [{ category: 'Tile', description: 'Floor tile', quantity: 125, unit: 'SF', unitCost: 4, total: 499.5 }],
      subtotal: 499.5, contingency: 24.98, permits: 150, total: 674.48,
    },
    { projectType: 'Bath', sizeSqft: '', location: '', quality: 'standard', scope: '', timelineWeeks: '', specialRequirements: '', targetBudget: '' },
    branding, { depositPct: 33, progressPct: 34, finalPct: 33 },
  );
  ok('a line total prints $499.50, not $500', printedHtml.includes('$499.50') && !/>\$500</.test(printedHtml));
  ok('contingency and the total print to the cent', printedHtml.includes('$24.98') && printedHtml.includes('$674.48'));
  ok('payment rows print to the cent', /\$222\.58|\$222\.57/.test(printedHtml), printedHtml.match(/Deposit[\s\S]{0,400}/)?.[0]);
}

// ── #146 attachment naming ───────────────────────────────────────────────────
console.log('\n#146 attachments: signed URLs keep their name/type and are downloaded first:');
{
  const a = em.attachmentNameAndType('https://sb.test/storage/v1/object/sign/project-photos/u/p/photo.jpg?token=abc.def');
  ok('the query string is not part of the filename', a.filename === 'photo.jpg', a);
  ok('…so the image keeps its content type', a.contentType === 'image/jpeg');
  ok('a local PDF is unchanged', JSON.stringify(em.attachmentNameAndType('file:///cache/Invoice%20%2312.pdf')) === JSON.stringify({ filename: 'Invoice #12.pdf', contentType: 'application/pdf' }));
  const fn = strip(EMAIL.slice(EMAIL.indexOf('async function fileUriToAttachment'), EMAIL.indexOf('async function sendViaResend')));
  ok('native downloads an http(s) URI to the cache before the base64 read',
    /if \(\/\^https\?:\/i\.test\(uri\)\)/.test(fn) && fn.indexOf('FileSystem.downloadAsync(') > -1
      && fn.indexOf('FileSystem.downloadAsync(') < fn.lastIndexOf('FileSystem.readAsStringAsync(localUri'));
}

// ── CO email (#35 #131 #129) ─────────────────────────────────────────────────
console.log('\n#35/#131/#129 change-order email:');
{
  const base = {
    companyName: 'Ortiz Builders', recipientName: 'Dana', projectName: 'Maple St', coNumber: 3,
    description: 'Add <header> & post', changeAmount: 1000, newContractTotal: 51500,
  };
  const withPortal = em.buildChangeOrderEmailHtml({
    ...base, portalUrl: 'https://mageid.app/p/abc', portalNeedsPasscode: true,
    taxRatePct: 8.25, taxAmount: 82.5, totalWithTax: 1082.5, originalContractSum: 50000, priorApprovedChangesTotal: 500,
  });
  ok('#35 the portal link is the CTA', /href="https:\/\/mageid\.app\/p\/abc"[^>]*>Review &amp; sign change order/.test(withPortal));
  ok('#35 never "one tap"', !/one tap/i.test(withPortal));
  ok('#35 the passcode is mentioned when the portal asks for one', withPortal.includes('asks for the passcode'));
  const noPortal = em.buildChangeOrderEmailHtml({ ...base });
  ok('#35 no portal → no portal wording at all, just reply', !/portal/i.test(noPortal.replace(/project:[^,]*/g, '')) && noPortal.includes('Reply to this email with your decision.'));
  ok('#131 tax rows and the tax-inclusive total', withPortal.includes('Sales tax (8.25%)') && withPortal.includes('+$82.50') && withPortal.includes('CO total incl. tax') && withPortal.includes('+$1,082.50'));
  ok('#131 the new contract total is labelled pre-tax', withPortal.includes('New contract total (pre-tax)'));
  ok('#131 the headline (title + preheader) is the tax-inclusive figure', withPortal.includes('+$1,082.50 change request') && withPortal.includes('+$1,082.50 incl. tax.'));
  ok('#129 G701 build-up: original, prior approved, contract before this CO',
    withPortal.includes('Original contract sum') && withPortal.includes('$50,000.00')
      && withPortal.includes('Net change by prior approved COs') && withPortal.includes('+$500.00')
      && withPortal.includes('Contract sum prior to this CO') && withPortal.includes('$50,500.00'));
  ok('the description and name are escaped', withPortal.includes('Add &lt;header&gt; &amp; post') && !withPortal.includes('<header>'));
  ok('no tax → no tax rows and no "(pre-tax)" label', !noPortal.includes('Sales tax') && !noPortal.includes('(pre-tax)') && noPortal.includes('+$1,000.00 change request'));
  ok('the CO screen hands the builder a typed options object',
    /const emailOpts: Parameters<typeof buildChangeOrderEmailHtml>\[0\] = \{/.test(CO_CODE) && /const html = buildChangeOrderEmailHtml\(emailOpts\);/.test(CO_CODE));
}

// ── CO PDF (#129 #131) ───────────────────────────────────────────────────────
console.log('\n#129/#131 change-order PDF:');
{
  const co = {
    id: 'c3', projectId: 'p1', number: 3, date: '2026-09-11', description: 'Add header', reason: '',
    lineItems: [{ id: 'l', name: 'Header', description: '', quantity: 1, unit: 'ea', unitPrice: 1000, total: 1000 }],
    originalContractValue: 50500, changeAmount: 1000, newContractTotal: 51500, status: 'submitted',
    taxRatePct: 8.25, taxAmount: 82.5, totalWithTax: 1082.5, priorApprovedChangesTotal: 500,
    createdAt: '', updatedAt: '',
  } as unknown as Parameters<typeof pdf.generateChangeOrderPDFUri>[0];
  printedHtml = '';
  await pdf.generateChangeOrderPDFUri(co, project, branding);
  ok('"Original contract value" is gone', !printedHtml.includes('Original contract value'));
  ok('G701: original sum = contract before this CO − prior approved', printedHtml.includes('Original contract sum') && printedHtml.includes('$50,000.00') && printedHtml.includes('Net change by prior approved COs'));
  ok('the contract sum before this CO is labelled as such', printedHtml.includes('Contract sum prior to this CO') && printedHtml.includes('$50,500.00'));
  ok('tax rows from the frozen fields', printedHtml.includes('Sales tax (8.25%)') && printedHtml.includes('CO total incl. tax') && printedHtml.includes('+$1,082.50'));
  ok('the new contract total is labelled pre-tax', printedHtml.includes('New contract total (pre-tax)'));
  const legacy = { ...co, taxRatePct: undefined, taxAmount: undefined, totalWithTax: undefined, priorApprovedChangesTotal: undefined } as typeof co;
  printedHtml = '';
  await pdf.generateChangeOrderPDFUri(legacy, project, branding);
  ok('an older CO without the prior total gets the one label its number supports', printedHtml.includes('Contract sum prior to this CO') && !printedHtml.includes('Original contract sum') && !printedHtml.includes('Sales tax'));
}

// ── #150 / #57 submittal ─────────────────────────────────────────────────────
console.log('\n#150/#57 submittal PDF + email:');
{
  printedHtml = '';
  await pdf.generateSubmittalPDFUri({
    id: 's', projectId: 'p1', number: 4, title: 'Millwork', specSection: '06 41 00', submittedBy: 'gc',
    submittedDate: '2026-09-01', requiredDate: '2026-10-01', reviewCycles: [], currentStatus: 'pending', attachments: [],
    createdAt: '', updatedAt: '',
  } as unknown as Parameters<typeof pdf.generateSubmittalPDFUri>[0], project, branding);
  ok('#150 Required By prints the calendar day west of Greenwich (Oct 1, not Sep 30)', /Required By<\/span><span class="doc-value">Oct 1, 2026</.test(printedHtml), printedHtml.match(/Required By[\s\S]{0,80}/)?.[0]);
  const e0 = pdf.buildSubmittalEmailHtml({ companyName: 'O', projectName: 'M', submittalNumber: 4, submittalTitle: 'Millwork', status: 'pending' });
  ok('#57 blank message + nothing attached → never says "attached"', !/attached/i.test(e0.replace(/markups/gi, '')), e0.match(/Please review[^<]*/)?.[0]);
  const e1 = pdf.buildSubmittalEmailHtml({ companyName: 'O', projectName: 'M', submittalNumber: 4, submittalTitle: 'Millwork', status: 'pending', attachmentCount: 1 });
  ok('#57 with a file attached it says so', e1.includes('review the attached submittal'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
