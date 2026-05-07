# MAGE ID — Pre-Launch Workflow Audit (Living Doc)

**Date started:** 2026-05-07
**Status:** in progress
**Plan:** docs/superpowers/plans/2026-05-07-prelaunch-workflow-audit.md
**Spec:** docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md

**Finding ID counter:** next is AUD-001

---

## 1. Charter

See spec §1 for full text. Summary:
- Pre-launch lock-in audit; output is a ranked punch list.
- Three pillars: golden paths, A1–A10 assertion rubric, 30-item competitor checklist.
- Headless-first execution: Claude reads code, user verifies hardware-only items.
- Severity rubric and per-finding schema defined in spec §3, §4.

## 2. Golden-path runs

### 2.1 Path 1 — Homeowner kitchen remodel (residential)

_Walked in Task 3. Step results listed below; failed assertions point to §5 punch list._

(empty — populated by Task 3)

### 2.2 Path 2 — Commercial tenant fit-out

_Walked in Tasks 4 + 5. Step results listed below._

(empty — populated by Tasks 4 + 5)

### 2.3 Path 3 — Internal GC operations

_Walked in Task 6. Requires Paths 1 + 2 to be at least partially analyzed first so portfolio-level expectations make sense._

(empty — populated by Task 6)

## 3. Domain-object lifecycle index

_Built in Task 2. One row per object: created where → edited where → derived from → flows to._

(empty — populated by Task 2)

## 4. Competitor table-stakes

_Walked in Task 7. 30-item checklist from spec §7 with green/yellow/red status against MAGE ID._

(empty — populated by Task 7)

## 5. Punch list

_All findings, all sources. Use the finding template defined in the plan. Sort by AUD-### ascending._

(empty — populated by Tasks 2–7 + 9)

## 6. Hardware verification runbook

_Compiled in Task 8 for the user to execute on the iOS production OTA build._

(empty — populated by Task 8)

## 7. Triage filter views

_Generated in Task 9 after all findings are tagged with severity, scope, delivery._

(empty — populated by Task 9)
