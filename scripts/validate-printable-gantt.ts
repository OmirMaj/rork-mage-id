// scripts/validate-printable-gantt.ts — asserts the printable Gantt HTML contains the key marks.
import { buildPrintableGanttHtml } from '../utils/printableGanttHtml';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const T = (id: string, o: Partial<ScheduleTask> = {}): ScheduleTask => ({ id, title: id, startDay: 1, durationDays: 5, dependencies: [], ...o } as ScheduleTask);

const html = buildPrintableGanttHtml(
  [T('a', { startDay: 1, durationDays: 5 }), T('b', { startDay: 6, durationDays: 3, dependencies: ['a'], isCriticalPath: true }), T('m', { startDay: 9, durationDays: 0, isMilestone: true })],
  { projectName: 'Test', todayDayNumber: 4, totalDays: 12 },
);
ok('is an html doc', html.includes('<html') && html.includes('</html>'));
ok('has an svg canvas', html.includes('<svg'));
ok('renders a bar rect', html.includes('<rect'));
ok('renders a dependency line (a→b)', html.toLowerCase().includes('<line') || html.toLowerCase().includes('<path'));
ok('renders the today line', html.includes('today') || html.includes('Today'));
ok('renders a milestone diamond (polygon)', html.includes('<polygon'));
ok('shows the project name', html.includes('Test'));

// Escaping — a malicious title must not break out of the SVG text node.
const escaped = buildPrintableGanttHtml([T('x', { title: '<script>alert(1)</script>' })], { projectName: 'P&Q', todayDayNumber: 1, totalDays: 5 });
ok('escapes task titles (no raw <script>)', !escaped.includes('<script>'));
ok('escapes the project name (& → &amp;)', escaped.includes('P&amp;Q'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
