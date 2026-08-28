// validate-project-cascade.ts — a new collection must be cascaded, or excused.
//
// WHY THIS EXISTS. AsyncStorage has no foreign keys, so deleteProject() in
// ProjectContext hand-cascades every project-scoped collection. Adding a
// collection is two lines in one place and forgetting the cascade is silent:
// nothing fails, nothing warns, and the orphaned records simply sit on disk
// forever. On web AsyncStorage IS window.localStorage, shared per origin, so
// those orphans are a privacy leak and not merely clutter.
//
// It has now happened three times in one session — deliveries,
// building_access_rules and access_reservations were all added, all shipped
// their own save*Mutation, and none of the three were cascaded. Every one
// passed tsc and the full guard suite.
//
// THE RULE: every save<X>Mutation in ProjectContext must either appear inside
// deleteProject(), or be listed below with a reason. There is no third option —
// an unlisted, uncascaded collection fails the build.
//
// Run via: bun run test:project-cascade

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'contexts', 'ProjectContext.tsx');

/**
 * Collections that are COMPANY-GLOBAL, not project-scoped. Deleting a project
 * must NOT touch them. Each needs a reason — the reason is the point, so that
 * the next person adding a collection has to think about which list it belongs
 * in rather than pattern-matching.
 */
const INTENTIONALLY_GLOBAL: Record<string, string> = {
  saveContactsMutation: 'Contacts are the company address book — no projectId at all.',
  saveEquipmentMutation: 'Equipment.currentProjectId is a soft assignment; the asset outlives the job.',
  saveLeadsMutation: 'A lead pre-dates any project and survives one being deleted.',
  savePriceAlertsMutation: 'Price alerts are per-material, company-wide.',
  saveSubsMutation: 'The subcontractor list is the company rolodex.',
  saveSettingsMutation: 'App settings are per-user, not per-project.',
  savePrequalMutation:
    "A packet is the SUB's prequalification (\"stored per-sub, not per-project\"); " +
    'projectId is optional and only records which criteria it was gated to. ' +
    'Deleting it would destroy the sub\'s criteria and documents to clean up a ' +
    'dangling id that merely fails to join.',
};

const src = readFileSync(SRC, 'utf8');

// Every collection that persists through a mutation.
const declared = [...src.matchAll(/const (save[A-Za-z]+Mutation)\s*=\s*useMutation/g)]
  .map(m => m[1]);

// The body of deleteProject: from its declaration to the closing `}, [` of the
// useCallback. Brace-counting would be more precise, but the dep array marker is
// unambiguous here and cannot drift silently — if it did, `covered` would come
// back empty and every collection would report, which fails loudly rather than
// passing vacuously.
const start = src.indexOf('const deleteProject = useCallback(');
if (start === -1) {
  console.error('✗ validate-project-cascade: could not find deleteProject — the guard needs updating, not disabling.');
  process.exit(1);
}
const end = src.indexOf('\n  }, [', start);
const body = src.slice(start, end === -1 ? src.length : end);

const covered = new Set([...body.matchAll(/save[A-Za-z]+Mutation/g)].map(m => m[0]));

// A vacuous pass is worse than a failure: if the slice above ever stops finding
// the cascade calls, the guard would report "all clear" for a file that
// cascades nothing.
if (covered.size === 0) {
  console.error('✗ validate-project-cascade: parsed deleteProject but found ZERO cascade calls.');
  console.error('  The guard is no longer reading the right region. Fix the guard.');
  process.exit(1);
}

const missing = declared.filter(m => !covered.has(m) && !(m in INTENTIONALLY_GLOBAL));

// A stale excuse is its own bug — it means someone cascaded a collection that
// the list still claims is global, and the next reader trusts the wrong note.
const staleExcuses = Object.keys(INTENTIONALLY_GLOBAL)
  .filter(m => covered.has(m) || !declared.includes(m));

if (missing.length > 0 || staleExcuses.length > 0) {
  console.error('\n✗ validate-project-cascade\n');
  for (const m of missing) {
    const collection = m.replace(/^save|Mutation$/g, '');
    console.error(`  ${m} is never cascaded in deleteProject().`);
    console.error(`    Deleting a project orphans every ${collection} record on disk.`);
    console.error('    Either add:  cascadeMutation(x, setX, ' + m + ');');
    console.error('    or add it to INTENTIONALLY_GLOBAL in this file with a reason.\n');
  }
  for (const m of staleExcuses) {
    console.error(`  ${m} is listed as company-global but ${covered.has(m) ? 'IS cascaded' : 'no longer exists'}.`);
    console.error('    Remove the stale entry so the list keeps meaning something.\n');
  }
  process.exit(1);
}

console.log(
  `✓ validate-project-cascade: ${covered.size} collections cascaded, ` +
  `${Object.keys(INTENTIONALLY_GLOBAL).length} excused with reasons`,
);
