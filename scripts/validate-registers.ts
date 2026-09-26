// validate-registers.ts — the desktop-web REGISTERS (wave 6d, lane R1:
// RegisterShell, Contacts and Crew).
//
// WHY. On the founder's 1512 px MacBook the Contacts search box measured
// 1,736 px wide and every register was a column of phone cards. Desktop web
// now shows a sortable table with the record opened beside it; the iPhone must
// not change by one node (the goldens in __tests__/smoke/w6d-r1-phone.test.tsx
// prove the tree; this proves the rules and pins the wiring).
//
// This EXECUTES the pure rules and pins the wiring:
//
//   1. registerCsvFileName names the LOCAL calendar day (never the UTC slice),
//      adds the job slug only when given one.
//   2. REGISTER_CSV (contacts, crew): an unknown value is an EMPTY cell —
//      never '—' and never 0.
//   3. contactRows: the display name is the phone's renderContact rule; the
//      role chips count only roles that exist, in the screen's order; search
//      covers the phone number.
//   4. crewRows: the ID column is verifiedBadge (an expired ID is not
//      "verified"); cert counts are crewCertRowStatus(certExpiryStatus()) over
//      THIS member's certificates only; the chips partition the roster.
//   5. Source pins: each screen mounts its register only in `isDesktopWeb ?`;
//      the phone literals survive in the phone arm; the split params; the
//      crew bulk-Delete reason; bulk writes run one per render; no new casts;
//      components/registers/* has no hand-rolled surface card; RegisterShell
//      has no `title:` style key and reads no `?new=1`.
//
// Run via: bun run test:registers

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rowsToCsv } from '../utils/dataTable';
import { REGISTER_CSV, registerCsvFileName } from '../utils/registers/registerCsv';
import { contactDisplayName, contactRoleCounts, contactSearchText } from '../utils/registers/contactRows';
import { crewChipCounts, crewChipMatches, crewRegisterRow } from '../utils/registers/crewRows';
import type { Contact, CrewMember } from '../types';

const ROOT = join(__dirname, '..');
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Comments blanked (strings kept), so a pin never passes on a comment. */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (src[i] === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

// ── 1. registerCsvFileName ─────────────────────────────────────────────────
console.log('\n1. registerCsvFileName — the LOCAL day');
{
  const local = new Date(2026, 8, 25, 12, 0, 0);
  check('contacts-YYYY-MM-DD.csv on the local day', registerCsvFileName('contacts', local) === 'contacts-2026-09-25.csv', registerCsvFileName('contacts', local));
  check('a job name adds its slug', registerCsvFileName('crew', local, 'Henderson Remodel') === 'crew-henderson-remodel-2026-09-25.csv', registerCsvFileName('crew', local, 'Henderson Remodel'));
  check('a blank job name adds nothing', registerCsvFileName('crew', local, '  ') === 'crew-2026-09-25.csv');
  // An instant whose local day differs from its UTC day (whichever side of
  // UTC this machine is on): the name must follow the local day.
  const off = new Date(2026, 8, 25, 12).getTimezoneOffset();
  if (off !== 0) {
    const inst = off > 0 ? new Date(Date.UTC(2026, 8, 26, 1, 30)) : new Date(Date.UTC(2026, 8, 25, 23, 30));
    const want = `x-${inst.getFullYear()}-${String(inst.getMonth() + 1).padStart(2, '0')}-${String(inst.getDate()).padStart(2, '0')}.csv`;
    const utc = `x-${inst.toISOString().slice(0, 10)}.csv`;
    check('near midnight it names the local day, not the UTC slice', registerCsvFileName('x', inst) === want && want !== utc, `${registerCsvFileName('x', inst)} (local ${want}, utc ${utc})`);
  } else {
    check('near midnight (UTC machine: local = UTC, nothing to tell apart)', true);
  }
  check('an invalid date never throws', /^x-\d{4}-\d{2}-\d{2}\.csv$/.test(registerCsvFileName('x', new Date(NaN))));
}

// ── 2. REGISTER_CSV — unknown is an empty cell ─────────────────────────────
console.log('\n2. REGISTER_CSV — unknown is an EMPTY cell, never — or 0');
const blankContact: Contact = {
  id: 'c0', firstName: '', lastName: '', companyName: '', role: 'Other', email: '', phone: '', address: '', notes: '',
  linkedProjectIds: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};
const bareMember: CrewMember = {
  id: 'm0', companyUserId: 'u', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  fullName: 'Bare Member', trades: [], status: 'active', idVerified: false, isPublic: false, projectIds: [],
};
{
  const cVals = REGISTER_CSV.contacts.map((c) => ({ key: c.key, v: c.csvValue(blankContact) }));
  const unknownKeys = ['name', 'first', 'last', 'company', 'email', 'phone', 'address', 'notes'];
  check('contacts: blank fields are null (an empty cell)', unknownKeys.every((k) => cVals.find((x) => x.key === k)?.v === null), JSON.stringify(cVals));
  check('contacts: nothing is written as —', !rowsToCsv(REGISTER_CSV.contacts, [blankContact]).includes('—'));
  check('contacts: linked projects is a real count (0 = linked to none)', cVals.find((x) => x.key === 'projects')?.v === 0);
  const row = crewRegisterRow(bareMember, [], '2026-09-25');
  const mVals = REGISTER_CSV.crew.map((c) => ({ key: c.key, v: c.csvValue(row) }));
  check('crew: no phone / email / trades → null, never 0 or —', ['phone', 'email', 'trades'].every((k) => mVals.find((x) => x.key === k)?.v === null), JSON.stringify(mVals));
  check('crew: nothing is written as —', !rowsToCsv(REGISTER_CSV.crew, [row]).includes('—'));
  const line = rowsToCsv(REGISTER_CSV.crew, [row]).split('\r\n')[1] ?? '';
  check('crew: the unknown cells are empty in the file', line.endsWith(',,') , line);
}

// ── 3. contactRows ─────────────────────────────────────────────────────────
console.log('\n3. contactRows');
{
  check('display name: first + last', contactDisplayName({ firstName: 'Ava', lastName: 'Linden', companyName: 'Linden Co' }) === 'Ava Linden');
  check('display name: a company-only contact shows the company', contactDisplayName({ firstName: '', lastName: '', companyName: 'County Building Dept' }) === 'County Building Dept');
  check('display name: last name only is trimmed', contactDisplayName({ firstName: '', lastName: 'Haddad', companyName: 'K' }) === 'Haddad');
  const counts = contactRoleCounts(
    [{ role: 'Inspector' }, { role: 'Client' }, { role: 'Inspector' }, { role: 'Landlord' }],
    ['Client', 'Architect', 'Inspector'],
  );
  check('role counts: only roles that exist, in the screen order, strays after', JSON.stringify(counts) === JSON.stringify([
    { role: 'Client', count: 1 }, { role: 'Inspector', count: 2 }, { role: 'Landlord', count: 1 },
  ]), JSON.stringify(counts));
  check('role counts: an empty list has no chips', contactRoleCounts([], ['Client']).length === 0);
  const text = contactSearchText({ firstName: 'Ava', lastName: 'Linden', companyName: 'Linden Co', email: 'ava@x.test', phone: '(555) 201-0001', role: 'Client' });
  check('search covers name, company, email, phone and role', ['Ava', 'Linden', 'Linden Co', 'ava@x.test', '(555) 201-0001', 'Client'].every((s) => text.includes(s)), text);
  // The register's name is the phone's own rule, textually.
  const contacts = stripComments(read('app/contacts.tsx'));
  check('the phone renderContact keeps the same name rule', contacts.includes('const displayName = `${item.firstName} ${item.lastName}`.trim() || item.companyName;'));
}

// ── 4. crewRows ────────────────────────────────────────────────────────────
console.log('\n4. crewRows');
{
  const today = '2026-09-25';
  const m: CrewMember = {
    ...bareMember, id: 'm1', fullName: 'Maria Gonzalez', trades: ['Electrical', 'Low voltage'],
    idVerified: true, idMaskedLast4: '4821', idExpiry: '2026-09-01', claimedByUserId: 'w1', projectIds: ['p1', 'p2'], phone: ' 555 ',
  };
  const certs = [
    { workerId: 'm1', expiresDate: '2026-10-10' },  // expiring (15 days)
    { workerId: 'm1', expiresDate: '2026-09-01' },  // expired
    { workerId: 'm1', expiresDate: '2027-06-01' },  // valid
    { workerId: 'm1' },                             // no expiry
    { workerId: 'other', expiresDate: '2026-09-01' }, // someone else's
  ];
  const r = crewRegisterRow(m, certs, today);
  check('cert counts: only his certificates', r.certCount === 4, String(r.certCount));
  check('cert counts: 1 expiring, 1 expired', r.certExpiring === 1 && r.certExpired === 1, `${r.certExpiring}/${r.certExpired}`);
  check('an expired ID is id_expired, not verified', r.idBadge === 'id_expired', r.idBadge);
  check('a current ID is id_verified', crewRegisterRow({ ...m, idExpiry: '2030-01-01' }, [], today).idBadge === 'id_verified');
  check('no masked number is unverified', crewRegisterRow({ ...m, idMaskedLast4: undefined }, [], today).idBadge === 'unverified');
  check("trades join with ' · '", r.trades === 'Electrical · Low voltage', r.trades);
  check('claimed, active, project count, trimmed phone, no email → null', r.claimed && r.active && r.projectCount === 2 && r.phone === '555' && r.email === null);
  const inactive = crewRegisterRow({ ...bareMember, id: 'm2', status: 'inactive' }, [], today);
  check('inactive is not active', !inactive.active);
  const all = [r, inactive, crewRegisterRow({ ...m, id: 'm3', idExpiry: '2030-01-01' }, [], today)];
  const cc = crewChipCounts(all);
  check('chips: All 3 · Active 2 · Inactive 1 · ID verified 1 · Not verified 2', cc.all === 3 && cc.active === 2 && cc.inactive === 1 && cc.verified === 1 && cc.unverified === 2, JSON.stringify(cc));
  check('chips: Active and Inactive partition the roster', all.every((x) => crewChipMatches(x, 'active') !== crewChipMatches(x, 'inactive')));
}

// ── 5. Source pins ─────────────────────────────────────────────────────────
console.log('\n5. Source pins');
const SCREENS = [
  { file: 'app/contacts.tsx', register: 'ContactsRegister', param: 'contactId', phone: ['renderItem={renderContact}', 'testID="contacts-search"'], never: 0, any: 0 },
  { file: 'app/crew.tsx', register: 'CrewRegister', param: 'crewId', phone: ['sortedMembers.map(m =>', 'testID="add-crew-member"', 'const today = todayCalendarDay();'], never: 1, any: 0 },
];
for (const s of SCREENS) {
  const src = stripComments(read(s.file));
  check(`${s.file}: imports ${s.register}`, new RegExp(`import \\{ ${s.register} \\} from '@/components/registers/${s.register}'`).test(src));
  check(`${s.file}: mounts <${s.register}> only as \`isDesktopWeb ? (<${s.register}\``, count(src, new RegExp(`<${s.register}\\b`, 'g')) === 1 && new RegExp(`isDesktopWeb\\s*\\?\\s*\\(?\\s*<${s.register}\\b`).test(src));
  check(`${s.file}: the gate is useIsDesktopWeb()`, /const isDesktopWeb = useIsDesktopWeb\(\);/.test(src));
  // The phone arm: `) : (<>` … `</>)}` right after the register.
  const reg = src.indexOf(`<${s.register}`);
  const armOpen = src.indexOf(') : (<>', reg);
  const armClose = src.indexOf('</>)}', armOpen);
  check(`${s.file}: the phone arm follows the register`, reg > 0 && armOpen > reg && armClose > armOpen);
  for (const lit of s.phone) {
    const at = src.indexOf(lit);
    const inArm = at > armOpen && at < armClose;
    // `const today` sits above the ternary (it feeds both arms); the rest live in the phone arm.
    const ok = lit.startsWith('const today') ? count(src, new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) >= 1 : inArm;
    check(`${s.file}: phone literal survives${lit.startsWith('const') ? '' : ' in the phone arm'} — ${lit}`, ok);
  }
  check(`${s.file}: useSplitRecord({ param: '${s.param}' })`, src.includes(`useSplitRecord({ param: '${s.param}' })`));
  check(`${s.file}: as never ≤ ${s.never}, as any ≤ ${s.any}`, count(src, /\bas never\b/g) <= s.never && count(src, /\bas any\b/g) <= s.any, `${count(src, /\bas never\b/g)}/${count(src, /\bas any\b/g)}`);
  check(`${s.file}: no negated desktop gate`, !/!\s*isDesktop\w*\s*&&/.test(src));
}
{
  const crew = stripComments(read('app/crew.tsx'));
  check('crew: the member memo reads activeId (the split on desktop web, detailId on a phone)',
    crew.includes('const activeId = isDesktopWeb ? split.openId : detailId;')
    && crew.includes('(activeId ? getCrewMember(activeId) : null), [activeId, getCrewMember]')
    && crew.includes('setFocusEmail(false); }, [activeId]);'));
  check('crew: the phone detail sheet still opens on detailId', crew.includes('visible={detailId !== null}'));
  check("crew: the record's inline editor reports unsaved edits", /<CrewDirtyProbe open=\{editOpen\} \/>/.test(crew) && /useRegisterRecordDirty\(\(\) => open\)/.test(crew));
  check('crew: 3 sheets, 3 frames', count(crew, /<Modal\b/g) === 3 && count(crew, /useSheetFrame\(/g) === 3);
  check('crew: the register empty state waits for the roster read (isLoading)', /isLoading: crewLoading/.test(crew) && /loading=\{crewLoading\}/.test(crew));
  const contacts = stripComments(read('app/contacts.tsx'));
  check('contacts: 2 sheets, 2 frames', count(contacts, /<Modal\b/g) === 2 && count(contacts, /useSheetFrame\(/g) === 2);
  check('contacts: Cmd+Enter saves the add sheet', contacts.includes('useSheetPrimaryHotkey(showAddModal, handleSave)'));
  check('contacts: a deleted contact closes its record on desktop web', /deleteContact\(contact\.id\);\s*setShowDetailModal\(false\);\s*if \(isDesktopWeb\) split\.close\(\);/.test(contacts));
}
{
  const crewReg = stripComments(read('components/registers/CrewRegister.tsx'));
  check('crew register: bulk Delete is disabled with its reason',
    crewReg.includes("'Delete crew one at a time — it offers Mark inactive first and purges a kept ID photo.'")
    && /disabledReason: CREW_BULK_DELETE_REASON/.test(crewReg));
  check('crew register: bulk status writes run one per render', /useOneAtATime\(/.test(crewReg) && !/\.forEach\([^)]*updateCrewMember/.test(crewReg));
  check('crew register: the empty table says Loading… until the read lands', /loading \? \(\s*<EmptyState[\s\S]{0,120}title="Loading…"/.test(crewReg));
  const conReg = stripComments(read('components/registers/ContactsRegister.tsx'));
  check('contacts register: bulk Delete confirms with a count', /`Delete \$\{n\} contact\$\{n === 1 \? '' : 's'\}\?`/.test(conReg));
  check('contacts register: bulk deletes run one per render', /useOneAtATime\(deleteContact\)/.test(conReg) && !/\.forEach\(\s*deleteContact/.test(conReg));
  for (const [file, src] of [['ContactsRegister', conReg], ['CrewRegister', crewReg]] as const) {
    check(`${file}: 36 px rows (density="compact"), a reg-* table id`, /density="compact"/.test(src) && /tableId="reg-/.test(src));
    check(`${file}: every row is a link (getRowHref)`, /getRowHref=\{\(r?c?\) => getRowHref\(/.test(src) || /getRowHref=\{\(\w+\) => getRowHref\(\w+\.id\)\}/.test(src));
  }
}
{
  const shell = stripComments(read('components/registers/RegisterShell.tsx'));
  const styles = shell.slice(shell.indexOf('StyleSheet.create('));
  check('RegisterShell: no title / headerTitle / pageTitle / screenTitle style key', !/^\s*(title|headerTitle|pageTitle|screenTitle)\s*:/m.test(styles));
  check('RegisterShell: reads no `new` search param (contract D6)', !/useLocalSearchParams|useGlobalSearchParams/.test(shell) && !/\bnew\s*:\s*'1'/.test(shell) && !/params\.new\b/.test(shell));
  check("RegisterShell: 'n' is a page-scope hotkey that never fires in a field", /combo: 'n',[^\n]{0,80}group: 'This screen', blockInInput: true/.test(shell) && /enabled: !!onNew/.test(shell));
  check('RegisterShell: the title row is kept off the printed page', /style=\{styles\.titleRow\} \{\.\.\.PRINT_HIDE\}/.test(shell));
  check('RegisterShell: headerShown false, and the header comes back on exit by default', /headerShown: false, title/.test(shell) && /restoreHeaderOnExit = true/.test(shell) && /navigation\.setOptions\(\{ headerShown: true \}\)/.test(shell));
  check("RegisterShell: row href = routeHref(record.pathname, { [record.param]: id })", /routeHref\(recordPathname, \{ \[recordParam\]: id \}\)/.test(shell));
  check('RegisterShell: open / close go through the dirty guard', /onClose=\{guardedClose\}/.test(shell) && /onRowOpen: guardedOpen/.test(shell) && /'Discard changes\?'/.test(shell));
  check('RegisterShell: self-capped at Layout.page.table', /maxWidth: Layout\.page\.table/.test(shell));
  check('RegisterShell: the aside is Layout.register.aside, beside the table at >= 1100', /width: Layout\.register\.aside/.test(shell) && /ASIDE_FITS_AT = 1100/.test(shell));
}
{
  const dir = join(ROOT, 'components/registers');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
  check('components/registers/* exists', files.length >= 4, files.join(', '));
  for (const f of files) {
    const src = stripComments(readFileSync(join(dir, f), 'utf8'));
    check(`components/registers/${f}: zero casts (as never / as any / as unknown)`, !/\bas (never|any|unknown)\b/.test(src));
    check(`components/registers/${f}: no hand-rolled surface (backgroundColor: t.surface)`, !/backgroundColor:\s*t\.surface\b/.test(src));
    check(`components/registers/${f}: no ChevronLeft / ArrowLeft back chrome`, !/\b(ChevronLeft|ArrowLeft)\b/.test(src));
  }
}

console.log(`\nvalidate-registers: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
