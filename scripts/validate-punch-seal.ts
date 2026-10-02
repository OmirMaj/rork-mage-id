// validate-punch-seal.ts — pins the sealed final punch (lane SEAL).
//
// WHY: the seal is the strongest fact a GC holds at closeout. Each rule below is
// one way it could quietly lie: a crew chore or a client-hidden X-ray item put
// in front of the client, an empty list sealed as "clear", a closed item with no
// after photo sealed anyway, a manifest whose hash changes with key order (so it
// can never be re-checked), a sealed item edited afterwards, a retainage card
// that reads as "released", a PDF that prints anything but the stored row, or an
// edge function that overwrites a stored copy.
//
// Planted mutations (each must turn a named check red; the lane report lists the run):
//   M1 isSealableItem keeps crew items          M2 isSealableItem keeps client-hidden X-ray
//   M3 zero formal items reads ready            M4 closed without after photo passes
//   M5 manifest items not sorted                M6 canonicalJson keys not sorted
//   M7 canonicalJson strings not escaped        M8 sealedPunchEditBlock ignores sealedItemIds
//   M9 retainage seal line not a punch fact     M10 punchSealHtml prints the name unescaped
//   M11 punchSealHtml drops "not a warranty"    M12 edge fn upload upsert: true
//   M13 manifest spreads the input item (an extra key, e.g. money, rides into the record)
//
// EXECUTED under bun (react-native stubbed for utils/calendarDate's i18n import chain is not needed:
// every module loaded here is pure). Deep-frozen inputs throughout.
// Run: bun scripts/validate-punch-seal.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PUNCH_SEAL_ACCEPTANCE_TEXT,
  PUNCH_SEAL_CONSENT_VERSION,
  PUNCH_SEAL_ERROR_CODES,
  buildPunchSealManifest,
  canonicalJson,
  checkPunchSealRequest,
  punchSealReadiness,
  sameItemSet,
  sealedItemIdsOf,
  sealedPunchEditBlock,
  type PunchSealManifestInput,
} from '../supabase/functions/_shared/punchSealManifest';
import { retainageReadiness } from '../utils/retainage';
import { buildPunchSealHtml, PUNCH_SEAL_HTML_COPY } from '../utils/punchSealHtml';
import type { PunchSeal } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

console.log('\npunch seal:');

// ── 1. readiness ────────────────────────────────────────────────────────────
const items = deepFreeze([
  { id: 'b', status: 'closed', listType: 'punch', afterPhotoUri: 'u/p/punch-b-after.jpg' },
  { id: 'a', status: 'closed', afterPhotoStoragePath: 'u/p/punch-a-after.jpg' },
  { id: 'crew1', status: 'open', listType: 'crew' },
  { id: 'xray1', status: 'open', listType: 'punch', xray: { clientVisible: false } },
]);
const r1 = punchSealReadiness(items);
ok('readiness leaves crew items out of the client’s acceptance', !r1.itemIds.includes('crew1'), JSON.stringify(r1));
ok('readiness leaves client-hidden X-ray items out', !r1.itemIds.includes('xray1'), JSON.stringify(r1));
ok('readiness: two formal items, both closed with an after photo, is ready', r1.ready && r1.count === 2 && r1.blockers.length === 0, JSON.stringify(r1));
ok('readiness item ids are sorted (the list the client signs)', JSON.stringify(r1.itemIds) === '["a","b"]', JSON.stringify(r1.itemIds));

const r0 = punchSealReadiness(deepFreeze([{ id: 'c', status: 'open', listType: 'crew' }]));
ok('zero formal items is NOT ready (no punch list on file)', !r0.ready && r0.count === 0, JSON.stringify(r0));
ok('an empty list is NOT ready', !punchSealReadiness([]).ready);

const r2 = punchSealReadiness(deepFreeze([
  { id: 'a', status: 'closed', afterPhotoUri: '  ' },
  { id: 'b', status: 'ready_for_review', afterPhotoUri: 'x' },
  { id: 'c', status: 'closed', afterPhotoUri: 'x' },
]));
ok('a closed item with no (or a blank) after photo blocks the seal', !r2.ready
  && r2.blockers.some(b => b.itemId === 'a' && b.reason === 'no_after_photo'), JSON.stringify(r2.blockers));
ok('an item not closed blocks the seal as not_closed', r2.blockers.some(b => b.itemId === 'b' && b.reason === 'not_closed'), JSON.stringify(r2.blockers));
ok('a ready item is not a blocker', !r2.blockers.some(b => b.itemId === 'c'));

ok('sameItemSet: order free, duplicates refused', sameItemSet(['a', 'b'], ['b', 'a']) && !sameItemSet(['a', 'b'], ['a', 'a']) && !sameItemSet(['a'], ['a', 'b']));

// ── 2. manifest ─────────────────────────────────────────────────────────────
const mInput: PunchSealManifestInput = deepFreeze({
  sealId: 'seal-1',
  projectId: 'proj-1',
  projectName: 'Henderson Kitchen',
  sealedAt: '2026-10-02T15:04:05.000Z',
  items: [
    { id: 'z', description: 'Re-hang door', location: 'Hall', closedAt: '2026-10-01T10:00:00Z', beforePhotoPath: null, afterPhotoPath: 'u/s/z.jpg', afterPhotoSha256: 'f'.repeat(64), planSheetId: null },
    { id: 'm', description: 'Touch up paint', location: '', closedAt: null, beforePhotoPath: 'u/p/punch-m.jpg', afterPhotoPath: 'u/s/m.jpg', afterPhotoSha256: 'e'.repeat(64), planSheetId: 'sheet-1', pinX: 0.25, pinY: 0.5 },
  ],
  signer: { name: ' Dana Ruiz ', role: 'Client', method: 'in_person', consentVersion: PUNCH_SEAL_CONSENT_VERSION, signatureSha256: 'd'.repeat(64), strokeCount: 3 },
} as PunchSealManifestInput);
const before = JSON.stringify(mInput);
const man = buildPunchSealManifest(mInput);
ok('manifest does not mutate its (deep-frozen) input', JSON.stringify(mInput) === before);
ok('manifest items are sorted by id', man.items.map(i => i.id).join(',') === 'm,z', man.items.map(i => i.id).join(','));
ok('manifest carries the acceptance text and its version', man.statement.text === PUNCH_SEAL_ACCEPTANCE_TEXT && man.statement.version === PUNCH_SEAL_CONSENT_VERSION);
ok('manifest trims the signer name', man.signer.name === 'Dana Ruiz');
ok('a missing before photo is recorded as null (prints "Before photo not on file")', man.items.find(i => i.id === 'z')?.beforePhoto === null);
// Same content, keys in another order, items in another order: same canonical JSON.
const shuffled = deepFreeze({
  signer: { strokeCount: 3, signatureSha256: 'd'.repeat(64), consentVersion: PUNCH_SEAL_CONSENT_VERSION, method: 'in_person' as const, role: 'Client', name: ' Dana Ruiz ' },
  items: [...mInput.items].reverse().map(i => Object.fromEntries(Object.entries(i).reverse())),
  sealedAt: mInput.sealedAt, projectName: mInput.projectName, projectId: mInput.projectId, sealId: mInput.sealId,
}) as unknown as PunchSealManifestInput;
ok('manifest is deterministic under input key and item order', canonicalJson(buildPunchSealManifest(shuffled)) === canonicalJson(man));
const withMoney = deepFreeze({ ...mInput, items: mInput.items.map(i => ({ ...i, amount: 1250, priceCents: 9 })) }) as unknown as PunchSealManifestInput;
const moneyKeys = canonicalJson(buildPunchSealManifest(withMoney)).match(/"[a-zA-Z]*(amount|price|cost|total|cents|retain|balance|paid)[a-zA-Z]*":/gi);
ok('manifest is money-free (no money key, even when the input carries one)', !moneyKeys, JSON.stringify(moneyKeys));

// ── 3. canonical JSON ───────────────────────────────────────────────────────
ok('canonicalJson sorts keys at every depth', canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } }) === '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
  canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } }));
ok('canonicalJson escapes strings (quotes, backslash, newline, control)', canonicalJson({ s: 'a"b\\c\nd\u0001' }) === '{"s":"a\\"b\\\\c\\nd\\u0001"}', canonicalJson({ s: 'a"b\\c\nd\u0001' }));
ok('canonicalJson drops undefined keys and writes undefined array slots as null', canonicalJson({ a: undefined, b: [undefined, 1] }) === '{"b":[null,1]}');
let threw = false; try { canonicalJson({ n: Number.NaN }); } catch { threw = true; }
ok('canonicalJson refuses a non-finite number', threw);

// ── 4. the edit block ───────────────────────────────────────────────────────
ok('sealedPunchEditBlock blocks an item with a seal id', sealedPunchEditBlock({ id: 'a', sealId: 'seal-1' }) === 'sealed');
ok('sealedPunchEditBlock blocks an item the stored record names (Set and array)', sealedPunchEditBlock({ id: 'm' }, new Set(sealedItemIdsOf({ manifest: man }))) === 'sealed'
  && sealedPunchEditBlock({ id: 'z' }, ['m', 'z']) === 'sealed');
ok('sealedPunchEditBlock leaves an unsealed item (rework is a new item) alone', sealedPunchEditBlock({ id: 'new' }, ['m', 'z']) === null && sealedPunchEditBlock(null) === null);
// Every edit path in the punch list goes through the block.
const pl = read('app/punch-list.tsx');
const guarded = ['const handleStatusChange', 'const moveItem', 'const handleSave', 'const takeAfterPhoto', 'const runBulkUpdate', 'const bulkSetStatus', 'const bulkDelete'];
const unguarded = guarded.filter((anchor) => {
  const at = pl.indexOf(anchor);
  if (at < 0) return true;
  const body = pl.slice(at, at + 1600);
  return !/sealGuard\(|sealedSelectionGuard\(/.test(body);
});
ok('every punch-list edit path refuses a sealed item (status, move, save, after photo, bulk, delete)', unguarded.length === 0, unguarded.join(', '));
ok('the row rail refuses reject and delete on a sealed item', /onReject:[\s\S]{0,400}sealGuard\(item\)/.test(pl) && /onDelete:[\s\S]{0,200}sealGuard\(item\)/.test(pl));
ok('the status pipeline in the edit sheet refuses a sealed item', /onAdvance=\{\(next\) => \{[\s\S]{0,600}sealGuard\(editingItem\)/.test(pl));

// ── 5. retainage ────────────────────────────────────────────────────────────
const nowD = new Date('2026-10-10T12:00:00.000Z');
const baseR = deepFreeze({ pending: 6_000, projectStatus: 'in_progress' as const, punchTotal: 12, punchOpen: 2, now: nowD });
const noSeal = retainageReadiness(baseR);
const withSeal = retainageReadiness({ ...baseR, punchSeal: { sealedAt: '2026-10-02T12:00:00.000Z', signerName: 'Dana Ruiz' } });
ok('retainage: the seal adds exactly one reason', withSeal.reasons.length === noSeal.reasons.length + 1, JSON.stringify(withSeal.reasons));
ok('retainage: the line names the signer and the day', withSeal.reasons.includes('Final punch accepted by Dana Ruiz on Oct 2, 2026 (sealed record).'), JSON.stringify(withSeal.reasons));
ok('retainage: with a seal, open items read as added after the record (no contradiction)', withSeal.reasons.includes('2 punch items added after the sealed record still open.') && !withSeal.reasons.some(r => / of 12 punch items still open/.test(r)), JSON.stringify(withSeal.reasons));
ok('retainage: without a seal the open line is unchanged', noSeal.reasons.includes('2 of 12 punch items still open.'));
ok('retainage: the seal counts as the punch fact (watch without completion)', noSeal.level === 'none' && withSeal.level === 'watch', `${noSeal.level} -> ${withSeal.level}`);
const due = retainageReadiness({ ...baseR, projectStatus: 'completed', punchSeal: { sealedAt: '2026-10-02T12:00:00.000Z', signerName: 'Dana Ruiz' } });
ok('retainage: due only with a completion fact AND the seal', due.level === 'due');
const allText = [withSeal, due].flatMap(s => [s.headline, ...s.reasons]).join(' ').toLowerCase();
ok('retainage: never says released or owed', !/released|owed/.test(allText), allText);
ok('retainage: a seal with no name adds nothing', retainageReadiness({ ...baseR, punchSeal: { sealedAt: '2026-10-02T12:00:00.000Z', signerName: '  ' } }).reasons.length === noSeal.reasons.length);

// ── 6. the PDF HTML ─────────────────────────────────────────────────────────
const seal: PunchSeal = deepFreeze({
  id: '0b8c1d2e-0000-4000-8000-000000000001',
  projectId: 'proj-1',
  sealedAt: '2026-10-02T15:04:05.000Z',
  itemCount: 2,
  manifest: { ...man, project: { id: 'proj-1', name: 'Henderson <Kitchen>' }, items: man.items.map(i => (i.id === 'm' ? { ...i, description: '<script>alert(1)</script>' } : i)) },
  manifestHash: 'c'.repeat(64),
  signerName: 'Dana <b>Ruiz</b>',
  signerRole: 'Client',
  method: 'in_person',
  signaturePaths: ['M 1,1 L 2,2'],
  consentVersion: PUNCH_SEAL_CONSENT_VERSION,
});
const html = buildPunchSealHtml(seal, { companyName: 'Acme & Sons', photos: { 'u/s/m.jpg': 'data:image/jpeg;base64,AAA' }, mode: 'native' });
ok('PDF escapes stored text (description, signer, project, company)', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;')
  && !html.includes('Dana <b>Ruiz</b>') && html.includes('Dana &lt;b&gt;Ruiz&lt;/b&gt;') && html.includes('Acme &amp; Sons') && !html.includes('Henderson <Kitchen>'));
ok('PDF prints the hash, the server time and the record id from the row', html.includes('c'.repeat(64)) && html.includes('2026-10-02T15:04:05.000Z') && html.includes(seal.id));
const otherRow = buildPunchSealHtml({ ...seal, manifestHash: 'a'.repeat(64), signerName: 'Someone Else' }, { companyName: '', photos: {}, mode: 'native' });
ok('PDF hash and name come only from the row (another row prints another hash and name)', otherRow.includes('a'.repeat(64)) && !otherRow.includes('c'.repeat(64)) && otherRow.includes('Someone Else') && !otherRow.includes('Dana'));
ok('PDF says, in its own statement (not only the client\u2019s acceptance text), it is not a warranty', /It is not a warranty/.test(PUNCH_SEAL_HTML_COPY.statement('X')) && /It is not a warranty/.test(html));
ok('PDF never prints "MAGE ID"', !/MAGE ID/i.test(html) && !/MAGE ID/i.test(otherRow));
ok('PDF prints "Before photo not on file" for a before photo that never uploaded', html.includes(PUNCH_SEAL_HTML_COPY.beforeNotOnFile));
ok('PDF prints a sentence, never a blank tile, for a photo it could not load', html.includes(PUNCH_SEAL_HTML_COPY.photoNotLoaded));
ok('PDF from the web says the stored copy is made on the phone; native does not',
  buildPunchSealHtml(seal, { companyName: '', photos: {}, mode: 'web' }).includes(PUNCH_SEAL_HTML_COPY.webPrintedLine) && !html.includes(PUNCH_SEAL_HTML_COPY.webPrintedLine));
ok('PDF carries no warranty, lien-release or payment-release claim', !/lien release(?! )|retainage released|final payment/i.test(html.replace('not a lien release', '')));

// ── 7. the edge function and the request check ──────────────────────────────
const fn = read('supabase/functions/seal-punch/index.ts');
const codes409 = [...fn.matchAll(/fail\(\s*409\s*,\s*'([a-z_]+)'/g)].map(m => m[1]);
const known = new Set<string>(PUNCH_SEAL_ERROR_CODES);
ok('edge fn: every 409 code is a known PUNCH_SEAL_ERROR_CODES entry (the screen maps each one)', codes409.length >= 7 && codes409.every(c => known.has(c)), JSON.stringify(codes409));
const allCodes = [...fn.matchAll(/fail\(\s*\d{3}\s*,\s*'([a-z_]+)'/g)].map(m => m[1]);
ok('edge fn: every code it answers is known', allCodes.every(c => known.has(c)), JSON.stringify(allCodes.filter(c => !known.has(c))));
const screen = read('app/punch-seal.tsx');
const unmapped = PUNCH_SEAL_ERROR_CODES.filter(c => !new RegExp(`\\b${c}:`).test(screen));
ok('screen: every error code maps to a sentence', unmapped.length === 0, unmapped.join(', '));
const uploads = [...fn.matchAll(/\.upload\([\s\S]{0,200}?\}\)/g)].map(m => m[0]);
ok('edge fn: every storage upload is upsert: false', uploads.length > 0 && uploads.every(u => /upsert:\s*false/.test(u)) && !/upsert:\s*true/.test(fn), uploads.join(' | '));
ok('edge fn: the attach is once (update … is pdf_path null)', /\.is\('pdf_path', null\)/.test(fn));
ok('edge fn: logs carry no signature paths or names', ![...fn.matchAll(/log\(([^)]*)\)/g)].some(m => /signature|signer_name|signerName/.test(m[1])));
ok('edge fn: the server clock stamps the seal and the server hashes it', /const sealedAt = new Date\(\)\.toISOString\(\)/.test(fn) && /sha256Hex\(new TextEncoder\(\)\.encode\(canonicalJson\(manifest\)\)\)/.test(fn));
ok('edge fn: a sample project is refused', /isSampleProjectName\(project\.name\)\) return fail\(409, 'sample'/.test(fn));
ok('screen: the legal acceptance text is the shared constant, byte for byte', screen.includes(`'field.punchSeal.legal.acceptance', '${PUNCH_SEAL_ACCEPTANCE_TEXT}'`));
ok('screen: the client’s name is never prefilled (name state starts empty)', /useState\(''\);[\s\S]{0,80}const \[paths/.test(screen) && /setName\(''\)/.test(screen));
ok('screen: a sample project never shows the pad', /else if \(sample\)/.test(screen) && screen.indexOf('else if (sample)') < screen.indexOf('readiness.ready ? ('));

const goodBody = { project_id: 'p', item_ids: ['a'], signer_name: 'Dana Ruiz', signer_role: 'Client', signature_paths: ['M 1,1 L 2,2'], consent_version: PUNCH_SEAL_CONSENT_VERSION };
ok('request: a whole body passes', checkPunchSealRequest(goodBody).ok);
ok('request: a one-letter name is refused', !checkPunchSealRequest({ ...goodBody, signer_name: ' D ' }).ok);
ok('request: another consent version is refused', !checkPunchSealRequest({ ...goodBody, consent_version: 'punch-accept-0' }).ok);
ok('request: no strokes, or a 20 KB+ stroke, is refused', !checkPunchSealRequest({ ...goodBody, signature_paths: [] }).ok && !checkPunchSealRequest({ ...goodBody, signature_paths: ['M' + ' 1,1'.repeat(6000)] }).ok);
const big = checkPunchSealRequest({ ...goodBody, item_ids: Array.from({ length: 301 }, (_, i) => `i${i}`) });
ok('request: more than 300 items is too_many (413)', !big.ok && big.code === 'too_many');

// ── 8. the after photo travels only when set ────────────────────────────────
const pc = read('contexts/ProjectContext.tsx');
ok('ProjectContext: after_photo_uri is written only when set (update and insert)', (pc.match(/\.\.\.\(durablePhotoValue\((?:pi|item)\.afterPhotoStoragePath, (?:pi|item)\.afterPhotoUri\)/g) ?? []).length === 2);
ok('ProjectContext: seal_id is never written from the app', !/seal_id:\s*(?:pi|item)\./.test(pc));
ok('ProjectContext: the after photo is staged under punch-<id>-after', /recordId: `punch-\$\{item\.id\}-after`/.test(pc));

// ── 9. delete-account erases the seals ──────────────────────────────────────
const del = read('supabase/functions/delete-account/index.ts');
ok('delete-account deletes punch_seals rows and the punch-seals bucket', /'punch_seals'/.test(del) && /'punch-seals'/.test(del));

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-punch-seal: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
