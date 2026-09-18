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

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
