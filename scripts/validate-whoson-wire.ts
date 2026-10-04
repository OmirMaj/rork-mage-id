// validate-whoson-wire — "who is on this project", the wiring (lane WHOWIRE).
//
// WHAT IT PROVES. The kit (components/whoson, hooks/useProjectPeople) decides
// what each person may see and is proven by scripts/validate-whoson.ts. This
// file pins WHERE the kit is mounted, because every way the mounting can be
// wrong is one this repo has already paid for:
//
//   - a second modal on the project page (UIKit drops it on an iPhone), or a
//     new `visible=` the tutorial blocker does not list;
//   - a wrapper that leaves an empty box on screen for everyone the feature
//     has nothing to show (the feature ships dark, so that is everyone);
//   - a stack that says "Invite" on a project whose client portal is on;
//   - a people block that pushes the rows scripts/validate-project-hub-rules
//     pins out of place;
//   - a beacon mounted twice (two timers), or one that follows the stored
//     "last picked" project instead of the route in front;
//   - a roster row that claims something about a PENDING invite, or that
//     looks its person up by position instead of by user id;
//   - "Joined" showing while the feature is off, when the row above it still
//     has no dot to be confused with;
//   - a removed team member who stays in the avatar stack because the roster
//     was refreshed and the people read was not;
//   - the reverse: a sub who accepted is in the avatar stack (the people read
//     is fresh every minute) and still "Invited" in the Team section (the
//     roster read is kept five minutes). The roster is re-read when a NEWER
//     people read disagrees with it, once per disagreement, never in a loop;
//   - a throw in the people read taking the roster, and the page, down with it;
//   - a people slot that squeezes the job's name out of a narrow desktop header;
//   - a 23rd Settings section, or the row outside the Legal group.
//
// What the SCREEN then renders, with the flag off and on, is
// __tests__/smoke/whoson-wire.test.tsx.
//
// The three pure functions of the roster (which person a row stands for, where
// the two reads disagree, whether to read the roster again) live in a .tsx
// file bun cannot import (react-native). They are lifted out between two
// marks, transpiled and RUN here, as scripts/validate-w4-context-records-writes
// does for the punch-batch block.
//
// Run: bun run scripts/validate-whoson-wire.ts
// Pure node:fs + one pure module; no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { workspaceHeight } from '../utils/projectWorkspaceLayout';

// Bun's transpiler, reached through globalThis so tsc (which has no bun types
// in this repo) still type-checks this file.
type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** JSX comments go whole (braces included), then block comments, then whole-line `//` comments.
 *  A JSX comment is `{`, ONE comment, `}`: the body may not run past its own
 *  closing mark (an interface that opens with a doc comment is not one). */
const stripComments = (src: string) => src
  .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const code = (rel: string) => stripComments(read(rel));
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, want ${e}`);
}

const PD = 'app/project-detail.tsx';
const HEADER = 'components/project/ProjectWorkspaceHeader.tsx';
const MANAGER = 'components/collaborators/CollaboratorsManager.tsx';
const ROSTER_HOOK = 'hooks/useProjectCollaborators.ts';
const SETTINGS = 'app/(tabs)/settings/index.tsx';
const LAYOUT = 'app/_layout.tsx';
const BEACON = 'components/whoson/ProjectPresenceBeacon.tsx';
const OWNED = [PD, HEADER, MANAGER, ROSTER_HOOK, SETTINGS, LAYOUT];

/** The distinct `visible={…}` expressions app/project-detail.tsx held before
 *  this feature (main 194acbc4). The feature adds none. If ANOTHER feature
 *  adds a modal to the project page, list it in the hub.modalUp tutorial
 *  blocker (scripts/validate-project-workspace.ts checks that) and raise this
 *  number with it. */
const VISIBLE_EXPRESSIONS = 8;

const STACK_PROPS = String.raw`projectId=\{project\.id\} inviteNudge=\{!project\.clientPortal\?\.enabled\} onOpen=\{\(\) => openSection\('collaborators'\)\}`;

// ── 1. The project page ──────────────────────────────────────────────────────
console.log('\napp/project-detail.tsx:');
{
  const raw = read(PD);
  const pd = stripComments(raw);

  ok('imports the stack and the block from the kit\'s barrel',
    /^import \{ ProjectPeopleBlock, ProjectPeopleStack \} from '@\/components\/whoson';$/m.test(pd));
  eq('two stacks (phone hero, desktop header) and one block', [count(pd, /<ProjectPeopleStack\b/g), count(pd, /<ProjectPeopleBlock\b/g)], [2, 1]);

  // (a) the phone hero
  const hero = new RegExp(
    String.raw`<View style=\{styles\.heroTitleBlock\}>\s*<Text style=\{styles\.heroName\}>\{project\.name\}</Text>[\s\S]{0,700}?`
    + String.raw`<Text style=\{styles\.heroDesc\}>[^\n]*</Text>\s*\) : null\}\s*`
    + String.raw`<ProjectPeopleStack variant="hero" ${STACK_PROPS} />\s*</View>\s*</View>`,
  );
  ok('phone: the stack is the LAST child of heroTitleBlock, after the description', hero.test(pd));
  ok('…heroTitleBlock is not restyled or wrapped', /^\s*heroTitleBlock: \{\},$/m.test(pd) && count(pd, /styles\.heroTitleBlock\b/g) === 1);

  // (b) the desktop header slot
  const headerEl = pd.slice(pd.indexOf('<ProjectWorkspaceHeader'), pd.indexOf('<ProjectKpiStrip'));
  ok('desktop: the stack is handed to ProjectWorkspaceHeader as peopleSlot',
    new RegExp(String.raw`\bpeopleSlot=\{<ProjectPeopleStack variant="header" ${STACK_PROPS} />\}\s*/>`).test(headerEl), headerEl.slice(-260));

  // D10: no "Invite" word while the client portal is on.
  eq('both stacks take inviteNudge from the project\'s client portal', count(pd, /inviteNudge=\{!project\.clientPortal\?\.enabled\}/g), 2);
  eq('…and no stack is given any other inviteNudge', count(pd, /\binviteNudge=/g), 2);
  eq('both stacks open the Team section this page already has', count(pd, /<ProjectPeopleStack\b[^\n]*onOpen=\{\(\) => openSection\('collaborators'\)\}/g), 2);

  // Nothing near the navigator's header.
  const nav = pd.slice(pd.indexOf('const headerRight = useCallback('), pd.indexOf('if (!project) {', pd.indexOf('const stackScreenOptions = useMemo(')));
  ok('nothing of the feature in headerRight / headerLeft / the stack screen options',
    nav.length > 400 && !/ProjectPeople|whoson|peopleSlot/i.test(nav), `${nav.length} chars`);

  // (c) the Team card
  ok('the people block is the FIRST child of the Team card, ahead of the hubRole === \'owner\' rows',
    /<View style=\{styles\.collabCard\}>\s*<ProjectPeopleBlock projectId=\{project\.id\} \/>\s*\{hubRole === 'owner' \? \(\s*<View style=\{styles\.collabMember\} testID="team-owner-row-self">/.test(pd));
  ok('…the roster below it is still the owner\'s only',
    /\{hubPerms\.canLeave \? \([\s\S]{0,400}?testID="team-collaborator-note"[\s\S]{0,200}?\) : \(\s*<CollaboratorsManager projectId=\{project\.id\}/.test(pd));

  // No second modal, no new state.
  const visibles = [...new Set([...pd.matchAll(/\bvisible=\{([^}]+)\}/g)].map(m => m[1].trim()))];
  eq('the number of distinct visible={…} expressions is unchanged', visibles.length, VISIBLE_EXPRESSIONS);
  ok('…and none of them is about this feature', !visibles.some(v => /whos|people|presence/i.test(v)), visibles.join(' | '));
  ok('the page itself calls no hook of the feature (the components read for themselves)',
    !/\buse(ProjectPeople|SharePresence|WhosOnCopy)\(/.test(pd) && !/from '@\/hooks\/use(ProjectPeople|SharePresence|WhosOnCopy)'/.test(pd));
  ok('no state was added for the feature', !/\[\s*\w*(?:whos|people|presence)\w*,\s*set\w+\]\s*=\s*useState/i.test(pd));
  ok('still no project.collaborators in the file', !/project\.collaborators/.test(raw));

  // (d) leaving
  const leave = pd.slice(pd.indexOf('const forgot = forgetSharedProject(id);'), pd.indexOf("showAlert('You left the project'"));
  ok('leaving the project also drops the cached people read',
    /void queryClient\.invalidateQueries\(\{ queryKey: \['project_collaborators', id\] \}\);\s*void queryClient\.invalidateQueries\(\{ queryKey: \['project_people'\] \}\);/.test(leave));
}

// ── 2. The desktop header ────────────────────────────────────────────────────
console.log('\ncomponents/project/ProjectWorkspaceHeader.tsx:');
{
  const h = code(HEADER);
  ok('peopleSlot is an optional React node', /^\s*peopleSlot\?: React\.ReactNode;$/m.test(h));
  ok('it is rendered inside titleBlock, right after nameBlock, with no wrapper of its own',
    /<View style=\{styles\.titleBlock\}>[\s\S]*?<View style=\{styles\.nameBlock\}>[\s\S]*?<\/View>\s*\{roomForPeople \? peopleSlot : null\}\s*<\/View>\s*<ToolbarActions\b/.test(h));
  eq('…once, and nowhere without the room check', [count(h, /\{roomForPeople \? peopleSlot : null\}/g), count(h, /\{peopleSlot\}/g)], [1, 0]);
  // The slot does not shrink and neither does the toolbar: in a narrow window
  // the job's name would be squeezed to nothing. The name comes first.
  ok('the slot is left out when Row A has no room for it: content width (window less the sidebar) under the floor',
    /const \{ width, sidebarWidth \} = useResponsiveLayout\(\);\s*const roomForPeople = width - sidebarWidth >= PEOPLE_SLOT_MIN_CONTENT_WIDTH;/.test(h));
  const floor = Number((h.match(/^export const PEOPLE_SLOT_MIN_CONTENT_WIDTH = (\d+);$/m) ?? [])[1]);
  // gutters 48 + toolbar ~410 + gap 16 + breadcrumb ~90 + two gaps 24 + stack ~76 + a 120 px name = 784.
  ok('the floor leaves the name at least 120 px beside a three-slot stack (784 by the sum in the file), and is under the founder\'s 1512 window with the sidebar open',
    floor >= 784 && floor <= 1512 - 240, String(floor));
  ok('the name block itself is not restyled (the flag-off goldens hold its style)', /nameBlock: \{ flexShrink: 1, minWidth: 0, maxWidth: Layout\.prose \},/.test(h));
  ok('Row A is still 56 and Row B still 40', /rowA: \{ height: 56,/.test(h) && /rowB: \{ height: 40,/.test(h));
  eq('the one-screen budget still computes 896', workspaceHeight(), 896);
  ok('the header reads nothing of the feature itself', !/whoson|useProjectPeople/i.test(h.replace(/peopleSlot/g, '')));
}

// ── 3. The roster ────────────────────────────────────────────────────────────
console.log('\ncomponents/collaborators/CollaboratorsManager.tsx:');
{
  const raw = read(MANAGER);
  const m = stripComments(raw);
  ok('an accepted row reads "Joined" with the feature on and "Active" with it off',
    /\{ROLE_LABELS\[c\.role\] \?\? 'Owner'\} · \{c\.status === 'accepted' \? \(WHOS_ON_ENABLED \? 'Joined' : 'Active'\) : 'Invited'\}/.test(m));
  eq('…and those are the only "Joined" and "Active" in the file', [count(m, /'Joined'/g), count(m, /'Active'/g)], [1, 1]);

  // Where the feature is read: one read, outside the roster's own body.
  eq('one people read in the file', count(m, /\buseProjectPeople\(/g), 1);
  const body = m.slice(m.indexOf('export function CollaboratorsManager('), m.indexOf('const styles = StyleSheet.create('));
  ok('CollaboratorsManager\'s own body reads nothing of the feature (a throw there would take the Team section down)',
    body.length > 5000 && !/useProjectPeople|whosOn|useContext\(|RosterPeopleContext|PersonAvatar|PersonRowExtras|rosterRowPerson|rosterPeopleMismatch/.test(body), `${body.length} chars`);
  const readFn = m.slice(m.indexOf('function RosterPeopleRead('), m.indexOf('let rosterPeopleFailureLogged'));
  ok('the read lives in RosterPeopleRead', /const whosOn = useProjectPeople\(projectId\);/.test(readFn));
  ok('…which hands the rows the model-filtered people, the model\'s open list and the send time, through a context',
    /<RosterPeopleContext\.Provider value=\{\{ people: whosOn\.people, openIds: whosOn\.model\.openIds, fetchedAtMs: whosOn\.fetchedAtMs \}\}>\s*\{children\}\s*<\/RosterPeopleContext\.Provider>/.test(readFn));

  // The scope: a boundary whose way back is the roster itself.
  const scope = m.slice(m.indexOf('class RosterPeopleScope'), m.indexOf('function RosterRowAvatar('));
  ok('RosterPeopleScope is an error boundary', /static getDerivedStateFromError\(\): \{ failed: boolean \} \{\s*return \{ failed: true \};\s*\}/.test(scope) && /componentDidCatch\(/.test(scope));
  ok('…feature off, or after a failure: its children, with no people read around them',
    /const \{ children, \.\.\.read \} = this\.props;\s*if \(!WHOS_ON_ENABLED \|\| this\.state\.failed\) return children;\s*return <RosterPeopleRead \{\.\.\.read\}>\{children\}<\/RosterPeopleRead>;/.test(scope));
  eq('…and it is the only place the read is mounted', count(m, /<RosterPeopleRead\b/g), 1);
  const open = body.indexOf('<RosterPeopleScope projectId={projectId} roster={collaborators} rosterKnown={hasData} rosterFetching={isFetching} rosterReadAtMs={dataUpdatedAt} refetchRoster={refetch}>');
  const close = body.indexOf('</RosterPeopleScope>');
  ok('the scope wraps the roster (every state of it: loading, failed, empty, the rows) and is given the roster read\'s own state',
    open > 0 && close > open && count(body, /<RosterPeopleScope\b/g) === 1
    && /^\s*\{view === 'loading' \? \(/.test(body.slice(open).split('\n').slice(1).join('\n'))
    && body.slice(open, close).includes('collaborators.map((c) => (')
    && /\)\)\s*\)\}\s*$/.test(body.slice(open, close)));
  ok('the invite form stays outside the scope', body.indexOf('testID="collab-invite"') > 0 && body.indexOf('testID="collab-invite"') < open);

  // The rows.
  ok('the avatar sits before the text column',
    /<View key=\{c\.id\} style=\{\[styles\.row, \{ borderColor: t\.line \}\]\}>\s*<RosterRowAvatar c=\{c\} \/>\s*<View style=\{\{ flex: 1 \}\}>\s*<Text style=\{\[styles\.rowEmail,/.test(m));
  const avatar = m.slice(m.indexOf('function RosterRowAvatar('), m.indexOf('function RosterRowLines('));
  ok('…and only when the row stands for a person (no empty box otherwise)',
    /const person = rosterRowPerson\(people, c\);\s*if \(!person\) return null;\s*return \(\s*<View style=\{styles\.rowAvatar\}>/.test(avatar));
  ok('the dot on the avatar comes from the model\'s open list, inside the kit\'s boundary',
    /<WhosOnBoundary>\s*<PersonAvatar person=\{person\} size=\{32\} open=\{openIds\.includes\(person\.userId\)\} \/>\s*<\/WhosOnBoundary>/.test(avatar));
  ok('the row\'s lines come right after the role line, ahead of the role picker',
    /'Invited'\}\s*<\/Text>\s*<RosterRowLines c=\{c\} \/>\s*\{isOwner && clientSeats\.has\(c\.id\) \?/.test(m));
  const lines = m.slice(m.indexOf('function RosterRowLines('), m.indexOf('export function CollaboratorsManager('));
  ok('…from the same lookup, with the read\'s send time', /return <PersonRowExtras person=\{rosterRowPerson\(people, c\)\} fetchedAtMs=\{fetchedAtMs\} \/>;/.test(lines));
  ok('…never by position', !/people\[\w+\]/.test(m));
  ok('the row list keeps the shape the other roster validators read', /collaborators\.map\(\(c\) => \(\s*<View key=\{c\.id\}/.test(m));
  eq('one avatar and one extras element, one of each row part', [count(m, /<PersonAvatar\b/g), count(m, /<PersonRowExtras\b/g), count(m, /<RosterRowAvatar\b/g), count(m, /<RosterRowLines\b/g)], [1, 1, 1, 1]);
  ok('the row\'s title is still the invited email', /<Text style=\{\[styles\.rowEmail, \{ color: t\.text \}\]\} numberOfLines=\{1\}>\{c\.email\}<\/Text>/.test(m));

  // The rule that keeps the roster in step with the people read.
  ok('the roster is compared only once it has answered',
    /const mismatch = rosterKnown \? rosterPeopleMismatch\(roster, whosOn\.people\) : '';/.test(readFn));
  ok('the decision is rosterReadDecision\'s, the last disagreement is kept in a ref, and the roster is read only when it says so',
    /const askedFor = useRef\(''\);\s*useEffect\(\(\) => \{\s*const next = rosterReadDecision\(\{ mismatch, askedFor: askedFor\.current, rosterFetching, peopleSentAtMs, rosterReadAtMs \}\);\s*askedFor\.current = next\.askedFor;\s*if \(next\.refetch\) refetchRoster\(\);\s*\}, \[mismatch, rosterFetching, peopleSentAtMs, rosterReadAtMs, refetchRoster\]\);/.test(readFn));
  eq('…and that is the only roster re-read of the feature', count(m, /refetchRoster\(\)/g), 1);
  ok('the people read\'s time is when it was SENT', /const peopleSentAtMs = whosOn\.fetchedAtMs;/.test(readFn));
  ok('no timer and no interval in the file\'s feature code (the one timer is the beacon\'s)', !/setInterval|refetchInterval/.test(m));

  // The three pure functions, run.
  type Row = { status: string; userId: string | null };
  type Person = { kind: string; userId: string; isSelf: boolean };
  type Pure = {
    rosterRowPerson: (people: Person[], c: Row) => Person | undefined;
    rosterPeopleMismatch: (roster: Row[], people: Person[]) => string;
    rosterReadDecision: (a: { mismatch: string; askedFor: string; rosterFetching: boolean; peopleSentAtMs: number | null; rosterReadAtMs: number }) => { askedFor: string; refetch: boolean };
  };
  let pure: Pure | null = null;
  const B = '// ── roster-people pure (begin)';
  const E = '// ── roster-people pure (end)';
  try {
    const block = raw.slice(raw.indexOf(B) + B.length, raw.indexOf(E)).replace(/^export function /gm, 'function ');
    if (raw.indexOf(B) < 0 || raw.indexOf(E) < raw.indexOf(B)) throw new Error('marks not found');
    const js = new Transpiler({ loader: 'ts' }).transformSync(block);
    pure = new Function(`${js}\nreturn { rosterRowPerson, rosterPeopleMismatch, rosterReadDecision };`)() as Pure;
  } catch (e) { ok('the roster-people pure block evaluates standalone', false, String(e)); }
  if (pure) {
    const P = pure;
    const ME: Person = { kind: 'owner', userId: 'me', isSelf: true };
    const mem = (userId: string, isSelf = false): Person => ({ kind: 'member', userId, isSelf });
    const acc = (userId: string | null): Row => ({ status: 'accepted', userId });
    const pend: Row = { status: 'pending', userId: null };

    console.log('\n  rosterRowPerson:');
    eq('an accepted row finds its member by user id', P.rosterRowPerson([ME, mem('a'), mem('b')], acc('b')), mem('b'));
    eq('a pending row stands for nobody, even with a user id on it', P.rosterRowPerson([ME, mem('a')], { status: 'pending', userId: 'a' }), undefined);
    eq('a revoked row stands for nobody', P.rosterRowPerson([ME, mem('a')], { status: 'revoked', userId: 'a' }), undefined);
    eq('an accepted row with no user id stands for nobody', P.rosterRowPerson([ME, mem('a')], acc(null)), undefined);
    eq('an accepted row for the owner\'s own address never borrows the owner row', P.rosterRowPerson([ME, mem('a')], acc('me')), undefined);
    eq('nobody of that id in the read: nobody', P.rosterRowPerson([ME, mem('a')], acc('z')), undefined);
    eq('an unknown read (no rows): nobody', P.rosterRowPerson([], acc('a')), undefined);

    console.log('\n  rosterPeopleMismatch:');
    eq('they agree: \'\'', P.rosterPeopleMismatch([acc('a'), acc('b'), pend], [ME, mem('b'), mem('a')]), '');
    eq('owner alone, a pending invite: \'\'', P.rosterPeopleMismatch([pend], [ME]), '');
    eq('the sub accepted, the roster still says pending: +id', P.rosterPeopleMismatch([pend], [ME, mem('a')]), '+a');
    eq('…or has no row at all for him', P.rosterPeopleMismatch([], [ME, mem('a')]), '+a');
    eq('…or still holds his row as pending with the id on it', P.rosterPeopleMismatch([{ status: 'pending', userId: 'a' }], [ME, mem('a')]), '+a');
    eq('the roster shows someone the people read does not name: -id', P.rosterPeopleMismatch([acc('a'), acc('b')], [ME, mem('a')]), '-b');
    eq('both ways at once, sorted', P.rosterPeopleMismatch([acc('b'), acc('c')], [ME, mem('d'), mem('b'), mem('a')]), '+a +d -c');
    eq('the same disagreement reads the same whatever the order', P.rosterPeopleMismatch([acc('c'), acc('b')], [ME, mem('a'), mem('b'), mem('d')]), '+a +d -c');
    eq('the owner\'s own accepted address is not a team member: no disagreement', P.rosterPeopleMismatch([acc('me'), acc('a')], [ME, mem('a')]), '');
    eq('an accepted row with no user id is not counted', P.rosterPeopleMismatch([acc(null)], [ME]), '');
    eq('an unknown people read (no rows) says nothing', P.rosterPeopleMismatch([acc('a')], []), '');
    eq('a TEAM MEMBER\'s read (the owner is not the viewer) says nothing about the roster',
      P.rosterPeopleMismatch([acc('x'), acc('y')], [{ kind: 'owner', userId: 'boss', isSelf: false }, mem('x', true)]), '');

    console.log('\n  rosterReadDecision:');
    const base = { mismatch: '+a', askedFor: '', rosterFetching: false, peopleSentAtMs: 2000, rosterReadAtMs: 1000 };
    eq('a newer people read disagrees with the roster: read it, and remember what for', P.rosterReadDecision(base), { askedFor: '+a', refetch: true });
    eq('the same disagreement after that read: not again (a role this build does not know cannot loop)',
      P.rosterReadDecision({ ...base, askedFor: '+a', peopleSentAtMs: 9000, rosterReadAtMs: 3000 }), { askedFor: '+a', refetch: false });
    eq('a DIFFERENT disagreement: read again', P.rosterReadDecision({ ...base, mismatch: '+a +b', askedFor: '+a' }), { askedFor: '+a +b', refetch: true });
    eq('they agree: nothing, and the memory is cleared', P.rosterReadDecision({ ...base, mismatch: '', askedFor: '+a' }), { askedFor: '', refetch: false });
    eq('…so the same person joining again later is a new disagreement',
      P.rosterReadDecision({ ...base, askedFor: P.rosterReadDecision({ ...base, mismatch: '', askedFor: '+a' }).askedFor }), { askedFor: '+a', refetch: true });
    eq('a roster read already in flight: wait for it', P.rosterReadDecision({ ...base, rosterFetching: true }), { askedFor: '', refetch: false });
    eq('…and keep what was asked', P.rosterReadDecision({ ...base, rosterFetching: true, askedFor: '-z' }), { askedFor: '-z', refetch: false });
    eq('a people read OLDER than the roster is the stale picture: the roster is not read', P.rosterReadDecision({ ...base, peopleSentAtMs: 500 }), { askedFor: '', refetch: false });
    eq('…nor one sent in the same millisecond', P.rosterReadDecision({ ...base, peopleSentAtMs: 1000 }), { askedFor: '', refetch: false });
    eq('one millisecond newer: read', P.rosterReadDecision({ ...base, peopleSentAtMs: 1001 }), { askedFor: '+a', refetch: true });
    eq('no people read at all: nothing', P.rosterReadDecision({ ...base, peopleSentAtMs: null }), { askedFor: '', refetch: false });
    eq('a roster that never answered (0) and a people read: read', P.rosterReadDecision({ ...base, rosterReadAtMs: 0 }), { askedFor: '+a', refetch: true });

    // Ten minutes of a disagreement a fresh roster cannot settle: a people
    // read every minute, a roster answer right after each roster read.
    let asked = '';
    let rosterAt = 0;
    let reads = 0;
    for (let minute = 1; minute <= 10; minute++) {
      const d = P.rosterReadDecision({ mismatch: '-ghost', askedFor: asked, rosterFetching: false, peopleSentAtMs: minute * 60_000, rosterReadAtMs: rosterAt });
      asked = d.askedFor;
      if (d.refetch) { reads++; rosterAt = minute * 60_000 + 200; }
    }
    eq('ten minutes of a disagreement that cannot be settled: ONE roster read', reads, 1);
  }
}

// ── 4. The roster hook ───────────────────────────────────────────────────────
console.log('\nhooks/useProjectCollaborators.ts:');
{
  const h = code(ROSTER_HOOK);
  ok('invalidate refreshes the roster AND the people read',
    /const invalidate = \(\) => \{\s*void qc\.invalidateQueries\(\{ queryKey \}\);\s*void qc\.invalidateQueries\(\{ queryKey: \['project_people'\] \}\);\s*\};/.test(h));
  eq('invite, revoke and role change all end in it', count(h, /onSuccess: invalidate,/g), 3);
  ok('the roster key is unchanged', /const queryKey = \['project_collaborators', projectId\] as const;/.test(h));
  ok('the hook does not poll', !/refetchInterval/.test(h));
  ok('it says when a roster read is in flight and when the roster last answered (the roster\'s re-read rule needs both)',
    /^\s*isFetching: query\.isFetching,$/m.test(h) && /^\s*dataUpdatedAt: query\.dataUpdatedAt,$/m.test(h));
  ok('the hook itself reads nothing of the feature (it is mounted on every screen that asks a role)', !/useProjectPeople|whoson/i.test(h));
}

// ── 5. Settings ──────────────────────────────────────────────────────────────
console.log('\napp/(tabs)/settings/index.tsx:');
{
  const st = code(SETTINGS);
  const ids = [...st.matchAll(/<SettingsSection id="([a-z-]+)">/g)].map(m => m[1]);
  ok('still 22 SettingsSection ids, each once', ids.length === 22 && new Set(ids).size === 22, ids.join(','));
  eq('one row', count(st, /<SharePresenceSettingRow \/>/g), 1);
  const at = st.indexOf('<SharePresenceSettingRow />');
  const legalOpen = st.indexOf('<SettingsSection id="legal">');
  const legalClose = st.indexOf('</SettingsSection>', legalOpen);
  ok('…inside the Legal section', legalOpen > 0 && at > legalOpen && at < legalClose);
  ok('…the last row of its group, right after "Do not sell my info"',
    /testID="settings-do-not-sell"[\s\S]{0,700}?<\/TouchableOpacity>\s*<SharePresenceSettingRow \/>\s*<\/View>\s*<\/SettingsSection>/.test(st));
  ok('the screen adds no separator of its own (the row brings one, and only when it draws)',
    !/<View style=\{styles\.rowSeparator\} \/>\s*<SharePresenceSettingRow \/>/.test(st));
  ok('imported from the kit\'s barrel', /^import \{ SharePresenceSettingRow \} from '@\/components\/whoson';$/m.test(st));
}

// ── 6. The root ──────────────────────────────────────────────────────────────
console.log('\napp/_layout.tsx:');
{
  const l = code(LAYOUT);
  eq('the beacon is mounted exactly once', count(l, /<ProjectPresenceBeacon\b/g), 1);
  const at = l.indexOf('<ProjectPresenceBeacon />');
  const order = ['<AuthProvider', '<OfflineSyncManager />', '<LanguageProfileSync />'].map(s => l.indexOf(s));
  ok('…below AuthProvider, beside OfflineSyncManager and LanguageProfileSync', at > 0 && order.every(i => i > 0 && i < at), `${order.join(',')} < ${at}`);
  ok('…and ahead of the navigator', at < l.indexOf('<RootLayoutNav />'));
  ok('…as a sibling of LanguageProfileSync, not inside another element', /<LanguageProfileSync \/>\s*<ProjectPresenceBeacon \/>/.test(l));
  ok('imported from the kit\'s barrel', /^import \{ ProjectPresenceBeacon \} from "@\/components\/whoson";$/m.test(l));

  const b = code(BEACON);
  ok('the beacon takes the project from the focused route', /urlProjectIdFrom\(/.test(b));
  ok('…never from the stored "last picked" project', !/activeProjectId|useActiveProject/.test(b));
}

// ── 7. Across the wired files ────────────────────────────────────────────────
console.log('\nthe six wired files:');
for (const rel of OWNED) {
  const src = code(rel);
  ok(`${rel}: no words of the feature (they live in hooks/useWhosOnCopy.ts)`,
    !/office\.whoson|[Hh]as it open|Last seen online|Show when I have|No team members yet ·|Choose what's shown/.test(src));
  ok(`${rel}: does not call the server for the feature`, !/project_people'\s*,\s*\{|p_mark|set_share_presence|share_presence/.test(src));
}

// ── 8. The screen test that goes with this ───────────────────────────────────
console.log('\n__tests__/smoke/whoson-wire.test.tsx:');
{
  const TEST = '__tests__/smoke/whoson-wire.test.tsx';
  const SNAP = '__tests__/smoke/__snapshots__/whoson-wire.test.tsx.snap';
  ok('the screen test and its snapshots exist', existsSync(join(ROOT, TEST)) && existsSync(join(ROOT, SNAP)));
  if (existsSync(join(ROOT, TEST)) && existsSync(join(ROOT, SNAP))) {
    const t = read(TEST);
    const s = read(SNAP);
    ok('it runs BOTH states of the flag', /let mockFlagOn = false;/.test(t) && /mockFlagOn = true;/.test(t)
      && /Object\.defineProperty\(mod, 'WHOS_ON_ENABLED', \{ enumerable: true, get: \(\) => mockFlagOn \}\);/.test(t));
    eq('the five flag-off goldens recorded before the lane are still in the snapshot file',
      count(s, /^exports\[`GOLDEN, flag off: what the screens rendered before lane WHOWIRE [a-e] {2}/gm), 5);
    ok('no golden is re-recorded by the test itself', !/toMatchSnapshot\(\{/.test(t) && !/--updateSnapshot|\bjest -u\b/.test(t));
    // Fixtures that never change cannot see the two reads disagree. One part
    // of the suite runs the REAL people hook and the REAL roster read against
    // a server whose answers the test changes.
    const e2e = t.slice(t.indexOf("describe('END TO END, flag ON:"));
    ok('it has an end-to-end part with the real hooks (no people fixture, no roster fixture)',
      e2e.length > 2000 && /mockPeopleRows = null;[\s\S]{0,80}mockRoster = null;[\s\S]{0,80}mockChoice = undefined;/.test(e2e));
    ok('…the headline case: the sub accepts, the roster is read again ONCE, the row says "Joined"',
      /THE HEADLINE CASE/.test(e2e) && count(e2e, /expect\(live\.rosterReads\)\.toBe\(rosterReadsAtOpen \+ 1\);/g) === 2 && /expect\(says\(section, 'Invited'\)\)\.toBe\(false\);/.test(e2e));
    ok('…time passes a minute at a time there, so every people read is answered before the next (a loop would show)',
      /async function minuteByMinute\(n: number\): Promise<void> \{\s*for \(let i = 0; i < n; i\+\+\) await seconds\(60\);\s*\}/.test(t) && count(e2e, /await minuteByMinute\(10\);/g) >= 2
      && count(e2e, /expect\(live\.marks\.length - peopleReads\)\.toBeGreaterThanOrEqual\(8\);/g) >= 2);
    ok('…a removal (the roster answering first, and the people read answering first), a disagreement that cannot be settled, and a throw in the people read are each run',
      /expect\(await removeDana\(0\)\)\.toBe\(1\);/.test(e2e) && /expect\(await removeDana\(3000\)\)\.toBe\(1\);/.test(e2e)
      && /costs ONE roster read in ten minutes/.test(e2e) && /mockPeopleThrows = true;/.test(e2e));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
