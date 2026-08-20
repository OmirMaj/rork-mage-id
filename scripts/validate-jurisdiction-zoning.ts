// validate-jurisdiction-zoning.ts — pins utils/automation/jurisdiction.ts.
//
// The non-negotiable principle under test: a GUESS is never truth, and
// downstream stays BLOCKED until a human confirm. Invariants:
//   • isZoningConfirmed is false for: no address, guess source, missing
//     timestamp, empty district, malformed timestamp.
//   • resolveZoning never returns source 'confirmed' unless isZoningConfirmed.
//   • resolveZoningAsync NEVER returns 'confirmed' for an unconfirmed project,
//     regardless of what the (injected) guess source reports — including a
//     source that tries to fabricate a district.
//   • confirmZoning is the ONLY path to 'confirmed': it stamps zoningConfirmedAt
//     + zoningSource='confirmed', flips isZoningConfirmed true, unblocks reason.
//   • confirmZoning refuses an empty district (can't confirm nothing).
//   • the guess source is pluggable (a custom source is honoured).
// Run: bun run scripts/validate-jurisdiction-zoning.ts

import type { Project } from '../types';
import {
  resolveZoning,
  resolveZoningAsync,
  isZoningConfirmed,
  confirmZoning,
  zoningBlockedReason,
  stubGuessSource,
  type ZoningGuessSource,
} from '../utils/automation/jurisdiction';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// Minimal Project stub — only the fields jurisdiction reads matter; cast the
// rest so we don't have to build a full domain object.
function makeProject(sa?: Project['structuredAddress'], location?: string): Project {
  return { id: 'p1', name: 'Test', location: location ?? '', structuredAddress: sa } as unknown as Project;
}

async function main() {
  console.log('\njurisdiction / zoning trust-but-verify:');

  // ── isZoningConfirmed: false for every un-confirmed shape ──
  ok('no structuredAddress → not confirmed', !isZoningConfirmed(makeProject(undefined)));
  ok('guess source → not confirmed',
    !isZoningConfirmed(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'guess' })));
  ok('confirmed source but no timestamp → not confirmed',
    !isZoningConfirmed(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'confirmed' })));
  ok('confirmed + timestamp but empty district → not confirmed',
    !isZoningConfirmed(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: '   ', zoningSource: 'confirmed', zoningConfirmedAt: '2026-08-20T00:00:00.000Z' })));
  ok('confirmed + district but malformed timestamp → not confirmed',
    !isZoningConfirmed(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: 'not-a-date' })));
  ok('fully confirmed → IS confirmed',
    isZoningConfirmed(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: '2026-08-20T00:00:00.000Z' })));

  // ── resolveZoning purity: never 'confirmed' unless the gate agrees ──
  const guessed = resolveZoning(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'guess' }));
  ok('stored unconfirmed district resolves as a GUESS', guessed.source === 'guess', `got ${guessed.source}`);
  ok('guessed district is surfaced (not hidden)', guessed.district === 'R-5', `got ${guessed.district}`);

  const empty = resolveZoning(makeProject(undefined));
  ok('nothing stored → district null, source guess', empty.district === null && empty.source === 'guess');

  const conf = resolveZoning(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: '2026-08-20T00:00:00.000Z' }));
  ok('confirmed project resolves as CONFIRMED truth', conf.source === 'confirmed' && conf.district === 'R-5' && conf.confidence === 'high');

  // ── confirmZoning is the ONLY path to 'confirmed' ──
  const before = makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'guess' });
  ok('before confirm: blocked (gate false)', !isZoningConfirmed(before));
  ok('before confirm: a blocked reason exists', zoningBlockedReason(before) !== null);

  const patch = confirmZoning(before, 'R-5', '2026-08-20T12:00:00.000Z');
  const after = makeProject(patch);
  ok('confirmZoning stamps zoningSource=confirmed', patch.zoningSource === 'confirmed');
  ok('confirmZoning stamps zoningConfirmedAt', patch.zoningConfirmedAt === '2026-08-20T12:00:00.000Z');
  ok('after confirm: gate true', isZoningConfirmed(after));
  ok('after confirm: no blocked reason', zoningBlockedReason(after) === null);

  // confirm trims + rejects empty
  ok('confirmZoning trims the district', confirmZoning(before, '  R-3  ').zoningDistrict === 'R-3');
  let threw = false;
  try { confirmZoning(before, '   '); } catch { threw = true; }
  ok('confirmZoning rejects an empty district', threw);

  // ── resolveZoningAsync NEVER auto-confirms, even with a lying source ──
  const lyingSource: ZoningGuessSource = {
    name: 'liar',
    async guess() {
      // A source that tries to claim high confidence / a district. The engine
      // must STILL treat it as a guess — never confirmed.
      return { district: 'C-6', confidence: 'high', rationale: 'totally sure (not)' };
    },
  };
  const asyncGuess = await resolveZoningAsync(makeProject({ street: '1 Main', city: 'NYC', state: 'NY', zip: '10001' }), lyingSource);
  ok('async guess is source=guess even from a confident source', asyncGuess.source === 'guess', `got ${asyncGuess.source}`);
  ok('async guess surfaces the district as a guess', asyncGuess.district === 'C-6');
  ok('async guess carries a rationale (provenance)', typeof asyncGuess.rationale === 'string' && asyncGuess.rationale.length > 0);
  ok('async on an unconfirmed project keeps gate FALSE',
    !isZoningConfirmed(makeProject({ street: '1 Main', city: 'NYC', state: 'NY', zip: '10001', zoningDistrict: asyncGuess.district ?? undefined, zoningSource: 'guess' })));

  // ── pluggable source honoured; stub is honest (no fabricated district) ──
  const stub = await stubGuessSource.guess({ structuredAddress: { street: '', city: '', state: '', zip: '' }, geocode: null });
  ok('stub guess fabricates NO district (honest null)', stub.district === null);
  ok('stub guess carries a rationale', stub.rationale.length > 0);

  // ── async short-circuits a confirmed project (returns confirmed truth) ──
  const confAsync = await resolveZoningAsync(makeProject({ street: '', city: '', state: '', zip: '', zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: '2026-08-20T00:00:00.000Z' }));
  ok('async on a confirmed project returns confirmed (no re-guess)', confAsync.source === 'confirmed' && confAsync.district === 'R-5');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
