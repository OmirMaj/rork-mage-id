// validate-w5-settings-export.ts — audit wave 5, lane settings, #80 + #131.
//
// "Export my data" promised "every project, invoice, RFI, and photo". The
// photo column was a load-time signed URL (dead within a day) or a file://
// path only the capturing phone can open; pay apps, commitments, T&M tickets,
// time and safety records were left out; the README listed a submittals CSV
// that was never written; on web the alert said "Tap a file below" over an
// empty list. This executes the real builders in utils/dataExport.ts (native
// modules stubbed) and pins the screen, Settings and marketing copy.
//
// Run: bun run scripts/validate-w5-settings-export.ts

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (spec: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-w5-settings-export must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// deliverTextFile is stubbed to record every file handed over (web: returns
// null, like the real browser download path).
const delivered: { name: string; body: string }[] = [];
Bun.plugin({
  name: 'w5-settings-export-stubs',
  setup(build) {
    const inert: VirtualModule = {
      exports: {
        Platform: { OS: 'web' }, supabase: {}, isSupabaseConfigured: false, cacheDirectory: '',
        deliverTextFile: async (name: string, body: string) => { delivered.push({ name, body }); return null; },
        generateCloseoutPacketUri: async () => null,
        isAvailableAsync: async () => false, shareAsync: async () => undefined,
      },
      loader: 'object',
    };
    for (const spec of ['react-native', 'expo-file-system/legacy', 'expo-sharing', '@/utils/platformFile',
      '@/utils/closeoutPacketGenerator', '@/lib/supabase']) {
      build.module(spec, () => inert);
    }
  },
});

const ex = await import('../utils/dataExport');
type Payload = Parameters<typeof ex.payloadToCsvs>[0];

// A JWT whose payload is {"exp": 1790000000} — what Supabase Storage puts in
// a signed URL's `token`.
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const EXP = 1790000000;
const EXP_ISO = new Date(EXP * 1000).toISOString();
const signed = (path: string) => `https://ref.supabase.co/storage/v1/object/sign/project-photos/${path}?token=${b64url({ alg: 'HS256' })}.${b64url({ url: path, exp: EXP })}.sig`;

const stamp = { createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
const photos = [
  // Uploaded, taken on THIS phone: uri is the local file, bytes are in the bucket.
  { id: 'up', projectId: 'p1', uri: 'file:///var/mobile/a.jpg', storagePath: 'u/p1/up.jpg', timestamp: 't1', tag: 'framing', ...stamp },
  // Still queued on this phone: storagePath is set at capture but no bytes yet.
  { id: 'queued', projectId: 'p1', uri: 'file:///var/mobile/b.jpg', storagePath: 'u/p1/queued.jpg', timestamp: 't2', ...stamp },
  // Never given a storage path, only a local file.
  { id: 'local', projectId: 'p1', uri: 'file:///var/mobile/c.jpg', timestamp: 't3', ...stamp },
  // Uploaded, but the export ran offline (no fresh link was minted).
  { id: 'offline', projectId: 'p1', uri: 'https://old.example/stale?token=x', storagePath: 'u/p1/offline.jpg', timestamp: 't4', ...stamp },
];
const ctx = {
  links: new Map([['u/p1/up.jpg', signed('u/p1/up.jpg')]]),
  notUploaded: new Set(['queued']),
};
const base: Payload = {
  projects: [], invoices: [], changeOrders: [], dailyReports: [], punchItems: [], contacts: [], rfis: [],
  submittals: [{ id: 's1', projectId: 'p1', number: 3, title: 'Doors, "hardware"', specSection: '08 71 00',
    submittedBy: 'gc', submittedDate: '', requiredDate: '2026-10-01', reviewCycles: [], currentStatus: 'pending',
    attachments: [], ...stamp }],
  equipment: [], warranties: [], subcontractors: [], communications: [],
  photos,
  aiaPayApps: [{ id: 'a1', projectId: 'p1', applicationNumber: 2, applicationDate: '2026-09-01', periodTo: '2026-08-31',
    ownerName: 'o', contractorName: 'c', projectName: 'n', originalContractSum: 100000.1, netChangeByCO: 2500,
    contractSumToDate: 102500.1, retainagePercent: 10, lessPreviousCertificates: 40000, lines: [],
    totals: { totalScheduledValue: 102500.1, totalCompletedAndStored: 60000.005, totalRetainage: 6000,
      totalEarnedLessRetainage: 54000, currentPaymentDue: 14000.3, balanceToFinish: 42500.1, percentComplete: 58.5 },
    savedAt: 'x' }],
  commitments: [{ id: 'c1', projectId: 'p1', number: 'PO-1', type: 'purchase_order', vendorName: 'Yard',
    description: 'Lumber', amount: 1234.5, signedDate: '2026-08-01', status: 'executed', ...stamp }],
  fieldTickets: [{ id: 'f1', number: 7, projectId: 'p1', date: '2026-09-02', workDescription: 'Extra blocking',
    reasonExtra: 'r', labor: [{ id: 'l', workerName: 'A', trade: 'Carp', hours: 3, rate: 65.33 }],
    materials: [{ id: 'm', description: 'studs', quantity: 3, unit: 'ea', unitCost: 4.1 }], equipment: [],
    markupPercent: 15, status: 'signed', ...stamp }],
  timeEntries: [{ id: 't1', projectId: 'p1', projectName: 'Job', workerId: 'w', workerName: 'Sam', trade: 'Lab',
    clockIn: '2026-09-02T12:00:00Z', breakMinutes: 30, totalHours: 7.5, overtimeHours: 0, status: 'completed', date: '2026-09-02' }],
  safetyIncidents: [{ id: 'i1', projectId: 'p1', type: 'injury', severity: 'minor', occurredAt: '2026-09-03',
    description: 'cut', location: 'L2', peopleInvolved: [], photoUrls: [], correctiveActions: [], treatment: 'first_aid',
    daysAway: 0, daysRestricted: 0, restrictedDuty: false, lostConsciousness: false, fatality: false,
    oshaRecordable: false, status: 'closed', reportedBy: 'me', ...stamp }],
} as unknown as Payload;

console.log('\n── photos: records with a link minted for the export (#80) ──');
const csvs = ex.payloadToCsvs(base, ctx, true);
const photoLines = csvs.photos.trim().split('\n');
const header = photoLines[0].split(',');
ok('photos.csv has a storagePath column', header.includes('storagePath'), photoLines[0]);
ok('the link column states its real expiry (from the signed token)', header.includes(`viewUrl (expires ${EXP_ISO})`), photoLines[0]);
ok('photos.csv has no bare `uri` column any more', !header.includes('uri'), photoLines[0]);
const rowOf = (id: string) => photoLines.find((l) => l.startsWith(`${id},`)) ?? '';
// The note has a comma, so the CSV quotes it.
const noteCell = (note: string) => `,"${note}"`;
ok('an uploaded photo taken on this phone gets the fresh link, not file://',
  rowOf('up').includes(signed('u/p1/up.jpg')) && !rowOf('up').includes('file://'), rowOf('up'));
ok('a photo still in the upload queue says so and has no link',
  rowOf('queued').endsWith(noteCell(ex.PHOTO_ON_DEVICE_ONLY)) && !rowOf('queued').includes('file://') && !rowOf('queued').includes('http'), rowOf('queued'));
ok('a photo with no storage path and a local file says so',
  rowOf('local').endsWith(noteCell(ex.PHOTO_ON_DEVICE_ONLY)), rowOf('local'));
ok('an uploaded photo exported offline says why it has no link (never the stale load-time URL)',
  rowOf('offline').endsWith(`,${ex.PHOTO_NO_LINK_OFFLINE}`) || rowOf('offline').endsWith(noteCell(ex.PHOTO_NO_LINK_OFFLINE)) && !rowOf('offline').includes('old.example'), rowOf('offline'));
ok('no row anywhere exports a file:// path', !csvs.photos.includes('file://'));
const noLinks = ex.payloadToCsvs(base, ctx, false);
ok('with links switched off the queued photo is still labelled on-device, the rest "left out"',
  noLinks.photos.includes(ex.PHOTO_ON_DEVICE_ONLY) && noLinks.photos.includes(ex.PHOTO_LINKS_OMITTED) && !noLinks.photos.includes('https://'));
ok('signedUrlExpiresAt reads the token exp', ex.signedUrlExpiresAt(signed('x')) === EXP_ISO);
ok('signedUrlExpiresAt is null for a URL without a token', ex.signedUrlExpiresAt('https://x.test/a.jpg') === null);

console.log('\n── the missing records (#131) ──');
for (const k of ['submittals', 'aiaPayApps', 'commitments', 'fieldTickets', 'timeEntries', 'safetyIncidents']) {
  ok(`a ${k} CSV is written`, typeof csvs[k] === 'string' && csvs[k].trim().split('\n').length === 2, csvs[k]);
}
ok('submittals.csv quotes a title with a comma/quote', csvs.submittals.includes('"Doors, ""hardware"""'));
const pay = csvs.aiaPayApps.trim().split('\n')[1];
ok('pay-app money is exact to the cent (100000.10, 60000.01, 14000.30)',
  pay.includes('100000.10') && pay.includes('60000.01') && pay.includes('14000.30'), pay);
ok('commitment money has two decimals (1234.50, change 0.00)', csvs.commitments.includes('1234.50') && csvs.commitments.includes('0.00'));
const ft = csvs.fieldTickets.trim().split('\n')[1];
// labor 3 x 65.33 = 195.99; materials 3 x 4.10 = 12.30; subtotal 208.29; +15% = 31.24 -> 239.53
ok('T&M ticket totals come from computeFieldTicketTotals, to the cent (billable 239.53)', ft.includes('195.99') && ft.includes('12.30') && ft.includes('239.53'), ft);
ok('csvMoney rounds half-cents and blanks non-numbers', ex.csvMoney(0.005) === '0.01' && ex.csvMoney(undefined) === '' && ex.csvMoney(NaN) === '');

console.log('\n── README says what is in it, and what is not ──');
const readme = ex.buildReadmeText(base, { format: 'both' }, { photoLinksExpireAt: EXP_ISO, photoOnDeviceOnlyCount: 2, includeLinks: true });
ok('README lists exactly the CSV files written (line built from payloadToCsvs keys)',
  readme.includes(`One file per record type: ${ex.csvEntityLine(ex.payloadToCsvs(base))}.`));
ok('…and that line names submittals and pay apps', /submittals/.test(ex.csvEntityLine(csvs)) && /AIA pay apps/.test(ex.csvEntityLine(csvs)));
ok('README says the photo files are NOT included', /photo image files are NOT in this bundle/.test(readme));
ok('README states when the links stop working', readme.includes(EXP_ISO));
ok('README counts the photos still only on the phone', /2 photos are still only on the phone/.test(readme));
ok('README lists what is excluded (contracts, lien waivers)', /NOT IN THIS BUNDLE YET/.test(readme) && /contracts, lien waivers/.test(readme));
ok('README no longer says "every record"', !/every record/i.test(readme));

console.log('\n── exportUserData end to end (web: downloads, no share list) ──');
const all = { ...base } as Record<string, unknown>;
const summary = await ex.exportUserData(all as never, { format: 'both', includeReadme: true, includePhotoUrls: true }, undefined, ctx);
const csvFiles = delivered.filter((d) => d.name.endsWith('.csv'));
ok('every CSV and the JSON and README are handed over and counted',
  summary.deliveredFileCount === delivered.length && delivered.length === csvFiles.length + 2 && csvFiles.length === Object.keys(csvs).length,
  `delivered ${delivered.length}, counted ${summary.deliveredFileCount}`);
ok('web leaves no share-list URIs', summary.fileUris.length === 0);
ok('summary counts the on-device-only photos (2) and the link expiry',
  summary.photoOnDeviceOnlyCount === 2 && summary.photoLinksExpireAt === EXP_ISO, JSON.stringify({ n: summary.photoOnDeviceOnlyCount, e: summary.photoLinksExpireAt }));
const json = JSON.parse(delivered.find((d) => d.name.endsWith('.json'))?.body ?? '{}') as { photos?: { id: string; uri: string; exportNote: string }[]; notExported?: string[]; aiaPayApps?: unknown[] };
ok('the JSON photos never carry a file:// uri', (json.photos ?? []).every((p) => !p.uri.startsWith('file://')), JSON.stringify(json.photos));
ok('the JSON carries the new collections and the not-exported list', Array.isArray(json.aiaPayApps) && (json.notExported ?? []).includes('lien waivers'));
ok('summarizeExport names photo RECORDS', /photo records/.test(ex.summarizeExport(summary)));

console.log('\n── the screens and pages say the same ──');
const screen = read('app/data-export.tsx');
ok('hero: photo records with temporary links (24 h), files not included',
  /photo records with temporary links \(24 h\) — the photo files\s+are not included/.test(screen));
ok('hero: no "Bundle every"', !/Bundle every/.test(screen));
ok('toggle: says links expire in 24 h and files are not included',
  /Photo records with temporary links \(24 h\) — the photo files are not included/.test(screen) && !/Include photo URLs/.test(screen));
ok('screen lists what is not included (NOT_EXPORTED)', /Not included yet: \{NOT_EXPORTED\.join/.test(screen));
ok('the new collections are passed into allData',
  /aiaPayApps,\s*commitments,\s*fieldTickets,\s*timeEntries,\s*safetyIncidents,\s*\}\),/.test(screen));
ok('time entries come from useTimeEntriesMirror, incidents from useSafety',
  /useTimeEntriesMirror\(\)/.test(screen) && /useSafety\(\)/.test(screen));
ok('photo links are minted at export time from storagePath, skipping queued photos',
  /getOwnPhotoUploadQueue\(\)/.test(screen) && /resolvePhotoUrls\(paths\)/.test(screen) && /!pendingIds\.has\(ph\.id\)/.test(screen));
ok('web: "Downloaded N files to your browser\'s Downloads", not "Tap a file below"',
  /if \(Platform\.OS === 'web'\) \{[\s\S]{0,400}Downloaded \$\{result\.deliveredFileCount\} file/.test(screen));
const settings = read('app/(tabs)/settings/index.tsx');
ok('Settings YOUR DATA subtext drops "every" and says photo records (links valid 24h)',
  !/Export every project/.test(settings) && /photo records \(links valid 24h\)/.test(settings));
const who = read('marketing/who-built-this.html');
ok('who-built-this: photo records (links valid 24h), no "every project … photo"',
  /photo records \(links valid 24h/.test(who) && !/containing every project/.test(who) && !/with everything<\/h2>/.test(who));
const procore = read('marketing/compare/procore.html');
ok('compare/procore: photo records (links valid 24h), no "export every"',
  /photo records \(links valid 24h\)/.test(procore) && !/export every project/.test(procore));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
