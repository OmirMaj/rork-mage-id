// validate-status-labels.ts — guards the one task-status label source
// (utils/statusLabels.ts, docs/VOICE.md §6 "Status labels").
//
//   bun run scripts/validate-status-labels.ts [path/to/scheduleEngine.ts]
//
// 1. Every TASK_STATUS_LABEL value is Title Case (docs/VOICE.md section 3, 2026-10-05:
//    a status word is a label). The one Title Case function decides.
// 2. humanizeEnum turns stored enum values into sentence-case labels and keeps
//    the acronym set upper-case.
// 3. permitTypeLabel names known permit types and falls back for unknown ones.
// 4. utils/scheduleEngine.ts getStatusLabel delegates to taskStatusLabel, so a
//    re-typed Title Case switch cannot come back. The optional argv path lets
//    the check run against an older copy of the file (mutation proof).
//
// Pure node:fs — no react-native import. fileURLToPath + join because the repo
// path contains a space.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  TASK_STATUS_LABEL,
  taskStatusLabel,
  humanizeEnum,
  permitTypeLabel,
} from '../utils/statusLabels';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

import { isTitleCase } from './copy-title-case';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}
function eq(name: string, got: string, want: string) {
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const ACRONYM_WORD = /^[A-Z&]{2,}s?$/;
function isSentenceCase(label: string): boolean {
  if (!label) return false;
  if (label[0] !== label[0].toUpperCase()) return false;
  const words = label.split(/\s+/).slice(1);
  return words.every((w) => ACRONYM_WORD.test(w) || w[0] === w[0].toLowerCase());
}

// 1. TASK_STATUS_LABEL
for (const [key, label] of Object.entries(TASK_STATUS_LABEL)) {
  check(`TASK_STATUS_LABEL.${key} is Title Case`, isTitleCase(label) && /^[A-Z]/.test(label), label);
}
eq('TASK_STATUS_LABEL.done', TASK_STATUS_LABEL.done, 'Complete');
eq('TASK_STATUS_LABEL.in_progress', TASK_STATUS_LABEL.in_progress, 'In Progress');
eq('TASK_STATUS_LABEL.on_hold', TASK_STATUS_LABEL.on_hold, 'On Hold');
eq('TASK_STATUS_LABEL.not_started', TASK_STATUS_LABEL.not_started, 'Not Started');
eq('taskStatusLabel(in_progress)', taskStatusLabel('in_progress'), 'In Progress');
eq('taskStatusLabel(unknown) humanizes', taskStatusLabel('waiting_on_inspection'), 'Waiting on inspection');
eq('taskStatusLabel(undefined)', taskStatusLabel(undefined), 'Not Started');

// 2. humanizeEnum
eq("humanizeEnum('pending_review')", humanizeEnum('pending_review'), 'Pending review');
eq("humanizeEnum('net_30')", humanizeEnum('net_30'), 'Net 30');
eq("humanizeEnum('ach')", humanizeEnum('ach'), 'ACH');
eq("humanizeEnum('')", humanizeEnum(''), '');
eq('humanizeEnum(null)', humanizeEnum(null), '');
eq("humanizeEnum('revise_and_resubmit')", humanizeEnum('revise_and_resubmit'), 'Revise and resubmit');
eq("humanizeEnum('READY_FOR_REVIEW')", humanizeEnum('READY_FOR_REVIEW'), 'Ready for review');
eq("humanizeEnum('open_rfi')", humanizeEnum('open_rfi'), 'Open RFI');
eq("humanizeEnum('coi_expired')", humanizeEnum('coi_expired'), 'COI expired');
eq("humanizeEnum('osha_recordable')", humanizeEnum('osha_recordable'), 'OSHA recordable');
eq("humanizeEnum('hvac')", humanizeEnum('hvac'), 'HVAC');
for (const v of ['pending_review', 'net_30', 'in_progress', 'change_order_pending', 'mep_rough_in']) {
  check(`humanizeEnum('${v}') is sentence case`, isSentenceCase(humanizeEnum(v)), humanizeEnum(v));
  check(`humanizeEnum('${v}') has no underscore`, !humanizeEnum(v).includes('_'));
}

// 3. permitTypeLabel
eq("permitTypeLabel('building')", permitTypeLabel('building'), 'Building Permit');
eq("permitTypeLabel('fire_alarm')", permitTypeLabel('fire_alarm'), 'Fire Alarm Permit');
eq("permitTypeLabel('hot_work')", permitTypeLabel('hot_work'), 'Hot Work Permit');
eq("permitTypeLabel('curb_cut') (unknown)", permitTypeLabel('curb_cut'), 'Curb cut permit');
eq('permitTypeLabel(undefined)', permitTypeLabel(undefined), 'Permit');

// 4. scheduleEngine.getStatusLabel delegates
const enginePath = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'utils/scheduleEngine.ts');
const engine = readFileSync(enginePath, 'utf8');
const fnMatch = engine.match(/export function getStatusLabel\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
check('scheduleEngine.getStatusLabel exists', !!fnMatch, enginePath);
const body = fnMatch ? fnMatch[1] : '';
check(
  'scheduleEngine.getStatusLabel returns taskStatusLabel(status)',
  /return\s+taskStatusLabel\(\s*status\s*\)/.test(body),
  body.trim().slice(0, 80),
);
check(
  'scheduleEngine.getStatusLabel has no re-typed label strings',
  !/'(In Progress|On Hold|Not Started|Complete|In progress|On hold|Not started)'/.test(body),
);
check(
  'scheduleEngine imports taskStatusLabel from utils/statusLabels',
  /import\s*\{[^}]*\btaskStatusLabel\b[^}]*\}\s*from\s*'@\/utils\/statusLabels'/.test(engine),
);

if (failures > 0) {
  console.error(`\nvalidate-status-labels: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.log(`validate-status-labels: PASS (${passes} checks)`);
