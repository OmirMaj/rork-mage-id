import { buildDemoJob } from '@/utils/demoJob/build';
import { demoProjectId } from '@/utils/demoJob/ids';
import { validateModel } from '@/utils/livingModel/modelCore';
const j = buildDemoJob({ userId: 'u1', projectId: demoProjectId('u1', 1), today: '2026-10-09', contractorName: 'MAGE Builders' });
const counts: Record<string, number> = {};
for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) counts[k] = v.length;
console.log(counts, j.project.schedule!.tasks.length, j.finishDay, j.model.rooms.length, JSON.stringify(j.model).length, JSON.stringify(j.project).length);
const chk = validateModel(j.model); console.log(chk.ok, chk.errors, chk.warnings);
console.log(j.project.id, j.clock.startDate, j.clock.dayOf(j.finishDay));
