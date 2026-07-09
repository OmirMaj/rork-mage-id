import { resolveDestination, defaultTitleFor } from '@/utils/scanRouting';
import type { ScanDocType } from '@/types';
let failed = 0; const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); failed++; } };

const ALL: ScanDocType[] = ['invoice','delivery_ticket','permit','insurance_coi','contract','business_card','spec_sheet','equipment_nameplate','material_tag','warranty','inspection_notice','plan_sheet','government_id','other'];
const FOLDERS = new Set(['plans','contracts','photos','permits','closeout','daily-reports','financials']);
const KINDS = new Set(['cost','contact','sub_compliance','file_only']);

for (const dt of ALL) {
  const d = resolveDestination(dt);
  assert(FOLDERS.has(d.folder), `${dt} folder ${d.folder} is known`);
  assert(KINDS.has(d.recordKind), `${dt} recordKind valid`);
  assert(defaultTitleFor(dt, {}).length > 0, `${dt} non-empty title`);
}
assert(resolveDestination('invoice').recordKind === 'cost', 'invoice→cost');
assert(resolveDestination('business_card').recordKind === 'contact', 'card→contact');
assert(resolveDestination('insurance_coi').recordKind === 'sub_compliance', 'coi→sub');
assert(resolveDestination('government_id').recordKind === 'file_only', 'gov id never extracts (file_only fallback)');
assert(defaultTitleFor('invoice', { vendor: 'ABC Supply' }) === 'Invoice — ABC Supply', 'invoice title');

if (failed) { console.error(`\n${failed} scan-routing checks failed`); process.exit(1); }
console.log('✓ scan-routing validator passed');
