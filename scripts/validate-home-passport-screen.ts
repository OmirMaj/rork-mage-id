// validate-home-passport-screen.ts — pins what app/home-passport.tsx feeds the
// consumer passport, and how a finished job is labelled (audit round 2, #21).
//
// Before: the card and the shared handoff said "In progress" for any job
// without a completion date — even one the builder had marked completed
// (status 'closed') — and the screen passed 5 of 11 builder inputs: no
// completion dates, no GC, no selections (model numbers), no maintenance, no
// subcontractors, no photos.
//
// Run: bun run scripts/validate-home-passport-screen.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConsumerPassport, buildPassportHandoff, passportProjectStatusLabel,
} from '../utils/passport/consumerPassport';
import {
  passportContractorFromBranding, passportJobsFromProjects, passportExtrasFor,
} from '../utils/passport/passportInputs';
import type { SelectionCategory } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

const NOW = Date.parse('2026-09-18T12:00:00Z');

console.log('\n── the label ──');
ok('completed + date → "Completed <date>"', passportProjectStatusLabel({ state: 'completed', completedOn: '2026-05-01' }, d => d) === 'Completed 2026-05-01');
ok('completed, no date → "Completed" (not "In progress")', passportProjectStatusLabel({ state: 'completed', completedOn: null }, d => d) === 'Completed');
ok('in progress → "In progress"', passportProjectStatusLabel({ state: 'in_progress', completedOn: null }, d => d) === 'In progress');

// A job closed with no substantial-completion date.
const closedNoDate = buildConsumerPassport({
  projects: [{ id: 'j1', name: 'Kitchen', location: '1 Elm St', status: 'closed', createdAt: '2026-01-01' }],
  nowMs: NOW,
});
const text = buildPassportHandoff(closedNoDate);
ok('builder calls a closed job completed', closedNoDate.projects[0].state === 'completed');
ok('shared text does not call a closed job "in progress"', !/Kitchen.*in progress/i.test(text), text);
ok('shared text says completed', /Kitchen \([^)]*\), completed/.test(text), text);

console.log('\n── the join ──');
const branding = { companyName: 'Oak Builders', contactName: 'Sam', phone: '555-0100', email: 'sam@oak.test', licenseNumber: 'LIC-9' };
const gc = passportContractorFromBranding(branding);
ok('GC comes from branding, contact info only', !!gc && gc.companyName === 'Oak Builders' && gc.licenseNumber === 'LIC-9' && gc.phone === '555-0100');
ok('no company name → no invented contractor', passportContractorFromBranding({ companyName: '  ' }) === undefined);

const jobs = passportJobsFromProjects([
  { id: 'j1', name: 'Kitchen', location: '1 Elm St', type: 'renovation' as never, status: 'closed' as never, createdAt: '2026-01-01', squareFootage: 0, substantialCompletionDate: '2026-04-30' },
  { id: 'j2', name: 'Deck', location: '1 Elm St', type: 'renovation' as never, status: 'in_progress' as never, createdAt: '2026-06-01', squareFootage: 0 },
], gc);
ok('each job carries its completion date', jobs[0].substantialCompletionDate === '2026-04-30');
ok('each job carries the GC', jobs.every(j => j.contractor?.companyName === 'Oak Builders'));

const sel: SelectionCategory = {
  id: 'cat1', projectId: 'j1', userId: 'u', category: 'Appliances',
  options: [{ id: 'o1', categoryId: 'cat1', productName: 'Dishwasher', brand: 'Bosch', sku: 'SHX78', isChosen: true } as never],
} as never;
const more = passportExtrasFor(['j1', 'j2'], {
  j1: { selections: [sel], maintenanceSchedule: [{ id: 'm1', task: 'Replace HVAC filter', frequency: 'Quarterly', nextDate: '2026-10-01' } as never] },
  j2: { selections: [], maintenanceSchedule: null },
}, [], [{ id: 'ph1', projectId: 'j1' } as never, { id: 'ph9', projectId: 'other' } as never]);
ok('maintenance comes from the binder, wrapped by project', more.maintenance.length === 1 && more.maintenance[0].projectId === 'j1');
ok('no binder schedule → no invented maintenance', !more.maintenance.some(m => m.projectId === 'j2'));
ok('photos are limited to this home', more.photos.length === 1 && more.photos[0].id === 'ph1');

const full = buildConsumerPassport({ projects: jobs, ...more, nowMs: NOW });
ok('the finished job shows its date', full.projects.find(p => p.id === 'j1')?.completedOn === '2026-04-30');
ok('the GC appears in Contractors', full.contractors.some(c => c.role === 'general_contractor' && c.companyName === 'Oak Builders'));
ok('the dishwasher model number reaches Equipment', full.equipment.some(e => e.modelNumber === 'SHX78'));
ok('the binder schedule reaches Maintenance', full.maintenance.some(m => m.task === 'Replace HVAC filter'));

console.log('\n── completion dates are local calendar days ──');
{
  // Integration round 1: closeout-binder saves closedAt / the G704 date as
  // instants, and the builder read their UTC date part. Pin a job closed at
  // 9 pm Eastern on May 1 (01:00Z May 2). TZ is set for this block only.
  const prevTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const nightClose = '2026-05-02T01:00:00.000Z';
    const [j] = passportJobsFromProjects([
      { id: 'n1', name: 'Bath', location: '1 Elm St', type: 'renovation' as never, status: 'closed' as never, createdAt: '2026-01-01', squareFootage: 0, closedAt: nightClose, substantialCompletionDate: nightClose },
    ], gc);
    ok('a 9 pm Eastern close is May 1 on the homeowner\'s record, not May 2',
      j.closedAt === '2026-05-01' && j.substantialCompletionDate === '2026-05-01', JSON.stringify(j));
    const pp = buildConsumerPassport({ projects: [j], nowMs: NOW });
    ok('…and the passport prints that day', pp.projects[0].completedOn === '2026-05-01', String(pp.projects[0].completedOn));
    const control = buildConsumerPassport({ projects: [{ ...j, closedAt: nightClose, substantialCompletionDate: nightClose }], nowMs: NOW });
    ok('control — the raw instant printed the UTC day (May 2)', control.projects[0].completedOn === '2026-05-02');
    const [bare] = passportJobsFromProjects([{ id: 'n2', name: 'X', location: '', type: 'renovation' as never, status: 'closed' as never, createdAt: '2026-01-01', squareFootage: 0, substantialCompletionDate: '2026-04-30' }], gc);
    ok('a bare calendar day passes through unchanged', bare.substantialCompletionDate === '2026-04-30');
    const [junk] = passportJobsFromProjects([{ id: 'n3', name: 'X', location: '', type: 'renovation' as never, status: 'closed' as never, createdAt: '2026-01-01', squareFootage: 0, closedAt: 'not a date' }], gc);
    ok('an unparseable date is left out, not guessed', !('closedAt' in junk));
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
}

console.log('\n── wiring ──');
const screen = read('app/home-passport.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('screen builds jobs with dates + GC', /passportJobsFromProjects\(active\.jobs, passportContractorFromBranding\(settings\?\.branding\)\)/.test(screen));
for (const k of ['selections: more.selections', 'maintenance: more.maintenance', 'subcontractors: more.subcontractors', 'photos: more.photos']) {
  ok(`screen passes ${k.split(':')[0]}`, screen.includes(k));
}
ok('screen fetches selections and the binder per job', /fetchSelectionsForProject\(id\)/.test(screen) && /fetchCloseoutBinder\(id\)/.test(screen));
const card = read('components/passport/HomePassportCard.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('card label comes from state, not the date alone', /passportProjectStatusLabel\(p, fmtDate\)/.test(card) && !/completedOn \? `Completed/.test(card));

console.log('\n── honest copy (Phase 0, 2026-09-23) ──');
{
  // The screen and its header said the passport is the OWNER's "permanent
  // record", "yours to keep", that "survives across contractors". It is read
  // from the signed-in GC's own jobs on his device and shared as a copy; no
  // owner account holds it and no other contractor's work is in it. JSX and
  // line comments are stripped: the header may QUOTE the old claim to explain
  // why it went, but no string the GC reads may make it.
  const raw = read('app/home-passport.tsx');
  const visible = raw.replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1').replace(/^\s*\/\/.*$/gm, '');
  ok('no on-screen claim of a permanent / owner-kept / cross-contractor record',
    !/permanent record|yours to keep|belongs to (you|the owner)|survives across contractors|travels with the home/i.test(visible),
    (visible.match(/permanent record|yours to keep|belongs to (you|the owner)|survives across contractors|travels with the home/i) ?? [''])[0]);
  ok('the screen says what it is: compiled from the GC\'s jobs, shared as a copy',
    /Compiled from your jobs at this address\. Share sends your client a copy\./.test(visible));
  ok('the empty state says the record fills from the GC\'s records, ready to share as a copy',
    /from your records, ready to share with your client as a copy/.test(visible.replace(/\s+/g, ' ')));
  const header = raw.split('\n').slice(0, 25).join('\n');
  ok('the header comment says what it is TODAY and that it is not owner-kept',
    /What it is TODAY: a record the GC compiles/.test(header) && /It is NOT an owner-kept record/.test(header));
  const consumer = read('utils/passport/consumerPassport.ts').split('\n').slice(0, 30).join('\n');
  ok('consumerPassport\'s header no longer calls it the record the homeowner keeps FOREVER',
    !/keeps FOREVER|It survives the contractor/.test(consumer) && /not an owner-kept record/.test(consumer));
  // The card's own share button reads "Share with your next contractor" (the
  // owner-kept framing). The GC is the one sharing, to his client, so the
  // screen passes the card no onShare and renders its own honest button.
  ok('the screen passes the card no onShare (the screen owns the share button)',
    /<HomePassportCard[\s\S]*?\/>/.test(visible) && !/onShare=/.test((visible.match(/<HomePassportCard[\s\S]*?\/>/) ?? [''])[0]));
  ok('the screen\'s share button says who gets it: a copy for the client, wired to the handoff',
    /accessibilityLabel="Share a copy with your client"/.test(visible) && />Share a copy with your client</.test(visible)
    && /onPress=\{\(\) => void onShare\(\)\}/.test(visible) && /shareText\(\{ message: buildPassportHandoff\(passport\) \}\)/.test(visible));
  ok('no "next contractor" framing on the screen', !/next contractor/i.test(visible));
  // The card renders under the screen's own note, so its copy is on the same
  // screen. It said "This record belongs to you. It stays with the house no
  // matter who does the next job." and carried a "Share with your next
  // contractor" button. Same rule, same strip (block + line comments), so a
  // comment may explain the old claim but no rendered string may make it.
  const cardRaw = read('components/passport/HomePassportCard.tsx');
  const cardVisible = cardRaw.replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1').replace(/^\s*\/\/.*$/gm, '');
  const OWNER_KEPT = /permanent record|yours to keep|belongs to (you|the owner)|stays with the house|next contractor|travels with the home|survives across contractors/i;
  ok('the card makes no permanent / owner-kept / next-contractor claim',
    !OWNER_KEPT.test(cardVisible), (cardVisible.match(OWNER_KEPT) ?? [''])[0]);
  ok('the card says who compiled it',
    /Compiled by the contractor from their own jobs at this address\./.test(cardVisible));
  ok('the card has no share button of its own (the screen owns sharing)',
    !/onShare/.test(cardVisible) && !/testID="passport-share"/.test(cardVisible));
  ok('the card\'s header comment no longer calls it the permanent record of THEIR house',
    !/permanent record of THEIR house/.test(cardRaw.split('\n').slice(0, 12).join('\n'))
    && /It is NOT an owner-kept\s*(\/\/\s*)?record/.test(cardRaw.split('\n').slice(0, 12).join('\n')));
  const shared = buildPassportHandoff(full);
  ok('the shared copy ends with who compiled it, not a claim of ownership',
    !/belongs to the homeowner|travels with the home/i.test(shared) && /Compiled by your contractor/.test(shared), shared.split('\n').pop());
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
