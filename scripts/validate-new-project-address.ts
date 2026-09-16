// validate-new-project-address.ts — the first project a contractor ever
// creates must not be stamped with a jobsite address nobody gave us.
//
// WHY THIS EXISTS. On a blank account the only call to action is "Create your
// first project", which opens the New Project modal on
// app/(tabs)/(home)/index.tsx. That modal asked for a name, a description and
// a type — and then handleCreateProject wrote, verbatim:
//
//     location: 'United States',
//     squareFootage: 0,
//
// There was no address field on the screen at all, so the placeholder was not
// a fallback for a field left blank; it was the only value that door could
// ever produce. `Project.location` is the single string 30+ surfaces read, so
// that one literal is what actually shipped to customers:
//
//   • "Location: United States" printed on every proposal, invoice and
//     closeout binder (utils/pdfGenerator.ts) for the life of the job.
//   • The ship-to on purchase orders sent to real suppliers
//     (utils/purchaseOrderPdf.ts).
//   • The jurisdiction the permit roadmap searched (utils/permitRoadmap.ts:
//     `LOCATION: United States`), which can only return permits for nowhere,
//     and a code edition that codeJurisdiction could not resolve.
//   • Worst of all, a SUCCESSFUL geocode. shouldGeocode
//     (utils/geocodeProject.ts) accepts any string over three characters, so
//     "United States" resolved to the country centroid and was stored in
//     locationLatitude/locationLongitude — after which the schedule reported
//     real, confident, unlabelled weather for rural Kansas instead of falling
//     through to the path that is honestly marked "SIMULATED WEATHER — NOT A
//     FORECAST".
//
// The modal's own voice helper made it sharper: it suggests saying "Smith
// kitchen remodel at 123 Main Street San Diego", parseProjectFromTranscript is
// explicitly instructed to return `location: street + city if stated`, and the
// onTranscript handler read only name/notes/type and threw the address away.
//
// THE INVARIANT THIS GUARD HOLDS, and why each half matters:
//
//   1. The home create path never writes a location placeholder. Blank must
//      stay blank: an empty string is under shouldGeocode's three-character
//      floor, so "no address" yields NO coordinates and the downstream
//      simulated-weather marking works as designed. Re-introducing any
//      literal here re-introduces the whole list above at once, silently, and
//      nothing in a diff review looks wrong about `location: 'United States'`.
//   2. The address is actually ASKED FOR — an input bound to the state the
//      handler writes. Deleting the field while keeping the write would leave
//      a permanently blank address, which is honest but useless; this is the
//      "guard is green while its subject is gone" failure the repo keeps
//      finding, so the field and the write are asserted together.
//   3. The voice path applies the location the parser already returns, so the
//      one door that asks out loud does not go back to discarding it.
//
// SCOPE. Deliberately only the home screen's create modal — the door a
// first-run user is funnelled through. Other create paths
// (app/(tabs)/schedule, discover/schedule, UniversalMicButton) still carry the
// placeholder and are tracked separately; widening this guard to them now
// would make it red on code nobody is fixing in this change, and a guard that
// is red by default gets muted.
//
// Run via: bun run test:new-project-address

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREEN = 'app/(tabs)/(home)/index.tsx';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

console.log('\nnew project address (the first job is not stamped with a placeholder):');

const src = readFileSync(join(ROOT, SCREEN), 'utf8');

// ── The create handler, isolated. Asserting on the whole file would let a
// placeholder hide in an unrelated helper, and would also go red on a comment
// that merely NAMES the old literal — which this file, and this guard, do.
const HANDLER_START = 'const handleCreateProject = useCallback(';
const startIdx = src.indexOf(HANDLER_START);
check('handleCreateProject still exists on the home screen', startIdx >= 0,
  `${SCREEN} no longer defines handleCreateProject — this guard is looking at nothing.`);

if (startIdx >= 0) {
  // Ends at the useCallback dependency array, which is the first `}, [` at the
  // handler's own indentation.
  const endRel = src.slice(startIdx).search(/\n {2}\}, \[/);
  const handler = endRel > 0 ? src.slice(startIdx, startIdx + endRel) : src.slice(startIdx);
  // Strip comments: this handler explains the old bug at length, and the
  // explanation quotes the literal it is warning about.
  const code = handler
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  check('the create handler writes no location placeholder',
    !/location:\s*['"`]/.test(code),
    `${SCREEN} handleCreateProject assigns a STRING LITERAL to location. That literal becomes the ` +
    `address on every proposal, invoice and purchase order the job ever prints, the jurisdiction the ` +
    `permit roadmap searches, and — because shouldGeocode accepts anything over three characters — a ` +
    `set of real coordinates, after which the schedule reports confident weather for a place the ` +
    `contractor never named. Write the trimmed field value; leave it '' when it is blank.`);

  check('the create handler writes the address the contractor typed',
    /const\s+location\s*=\s*projectLocation\.trim\(\)/.test(code) && /\n\s*location,/.test(code),
    `${SCREEN} handleCreateProject must derive location from the projectLocation field (trimmed) and ` +
    `pass it into the new Project. Without that the address input is decorative.`);

  check('square footage is not hardcoded to zero',
    !/squareFootage:\s*0\s*,/.test(code),
    `${SCREEN} handleCreateProject pins squareFootage to 0 regardless of what was entered. Zero is ` +
    `what the estimate wizard reads as "unknown", so a real number typed on this screen would be ` +
    `thrown away and re-asked.`);
}

// ── The field itself has to be on screen and bound to that state.
check('the modal asks for the jobsite address',
  /testID="project-location-input"/.test(src) && /value=\{projectLocation\}/.test(src)
    && /onChangeText=\{setProjectLocation\}/.test(src),
  `${SCREEN} no longer renders a TextInput bound to projectLocation (testID project-location-input). ` +
  `The write path can be perfect and still produce an always-empty address if nobody is asked for it.`);

check('the modal asks for square footage',
  /testID="project-sqft-input"/.test(src) && /value=\{projectSqft\}/.test(src),
  `${SCREEN} no longer renders the square-footage input bound to projectSqft.`);

// ── The voice path must use what the parser already extracts.
check('the voice fill applies the location it parsed',
  /if\s*\(partial\.location\)\s*setProjectLocation\(/.test(src),
  `${SCREEN}'s InlineVoiceFill onTranscript handler drops partial.location. The suggestion copy on ` +
  `that very control tells the contractor to say the address ("at 123 Main Street San Diego") and ` +
  `parseProjectFromTranscript is instructed to return it — discarding it is asking for something and ` +
  `then ignoring the answer.`);

console.log('');
if (failures > 0) {
  console.error(`✗ validate-new-project-address: ${failures} failure(s) — the first-run create path can invent a jobsite.\n`);
  process.exit(1);
}
console.log('✓ validate-new-project-address: the home create modal asks for the address and writes only what it was told.\n');
