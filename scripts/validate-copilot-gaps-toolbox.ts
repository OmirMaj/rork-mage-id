// scripts/validate-copilot-gaps-toolbox.ts — pure-fn validator for the Toolbox
// Talk gap rule: the interview needs only a topic, and it must surface this
// job's own grounded topics (recent incidents / open hazards) ahead of the
// evergreen fallbacks.
import { toolboxGaps, type SuggestedTopic } from '../utils/copilot/toolbox/toolboxGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const empty: Grounding = { facts: [], data: {} };

// --- no topic → ask, with evergreen fallbacks when nothing grounded ---
{
  const gaps = toolboxGaps({}, empty);
  ok('asks the topic when unstated', gaps.length === 1 && gaps[0].field === 'topic');
  ok('topic is a choice', gaps[0].kind === 'choice');
  ok('offers evergreen fallbacks when nothing grounded', (gaps[0].choices?.length ?? 0) >= 4);
  ok('falls back to fall protection', gaps[0].groundedDefault.value === 'Fall protection');
}

// --- a stated topic asks nothing ---
ok('a stated topic asks nothing', toolboxGaps({ topic: 'Heat illness' }, empty).length === 0);

// --- grounded suggestions lead + are recommended ---
{
  const grounded: SuggestedTopic[] = [
    { label: 'Lessons from our recent near miss', value: 'Reviewing our recent near miss', basis: 'you logged it Tuesday', source: 'incident' },
  ];
  const g: Grounding = { facts: [], data: { suggestedTopics: grounded } };
  const gap = toolboxGaps({}, g)[0];
  ok('grounded topic leads the list', gap.choices?.[0].value === 'Reviewing our recent near miss');
  ok('grounded topic is recommended', !!gap.choices?.[0].recommended);
  ok('grounded topic is the grounded default', gap.groundedDefault.value === 'Reviewing our recent near miss');
  ok('grounded default cites the incident basis', gap.groundedDefault.basis.includes('Tuesday'));
}

// --- de-dupes against evergreen + caps the list ---
{
  const many: SuggestedTopic[] = Array.from({ length: 8 }, (_, i) => ({
    label: `Topic ${i}`, value: `Topic ${i}`, basis: 'x', source: 'hazard',
  }));
  const g: Grounding = { facts: [], data: { suggestedTopics: many } };
  const gap = toolboxGaps({}, g)[0];
  ok('caps the choice list at 5', (gap.choices?.length ?? 0) === 5);
}
{
  const dup: SuggestedTopic[] = [{ label: 'Fall protection', value: 'Fall protection', basis: 'flagged', source: 'hazard' }];
  const g: Grounding = { facts: [], data: { suggestedTopics: dup } };
  const gap = toolboxGaps({}, g)[0];
  const fpCount = (gap.choices ?? []).filter((c) => c.value === 'Fall protection').length;
  ok('de-dupes a grounded topic that matches an evergreen', fpCount === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
