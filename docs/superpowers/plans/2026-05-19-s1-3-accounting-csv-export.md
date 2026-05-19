# S1.3 — Accounting CSV Export (QuickBooks Online / Xero) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** From the project-detail Invoices sub-panel, export that project's billable invoices as a QuickBooks-Online- or Xero-import-compatible CSV via the OS share sheet.

**Architecture:** New pure builder `utils/accountingExport.ts` (`buildAccountingCsv`) + a thin FS/share wrapper in the same util (`exportProjectAccountingCsv`) that mirrors the verified `utils/icsGenerator.ts` `exportProjectIcs` precedent (the util owns `expo-file-system`/`expo-sharing`; the screen just calls it — `app/project-detail.tsx` deliberately does NOT import FS/Sharing). One trigger action wired into the existing Invoices sub-section, mirroring `handleExportCalendar`. Additive, read-only, ungated.

**Tech Stack:** TypeScript strict (NO `any`), `expo-file-system/legacy` + `expo-sharing` (already project deps), React Native. No unit runner — per-task gate = `npx tsc --noEmit` clean from worktree root + spec §6 manual reasoning.

**Spec:** `docs/superpowers/specs/2026-05-19-s1-3-accounting-csv-export-design.md` (@ `57c36f7`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` (== `main` @ `41bb68e`). Use `git -C "<that path>"`.

---

## CRITICAL
- Additive + read-only. Do NOT modify `app/integrations.tsx`/`MOCK_INTEGRATIONS`, `types/index.ts`, `utils/tax1099Export.ts`, `utils/dataExport.ts`, `utils/icsGenerator.ts`, or any shipped behavior. **Ungated** — do NOT add `useTierAccess` (parity with the ungated 1099 CSV export; `quickbooks_sync` was deliberately removed).
- Strict TS, NO `any`.
- Build authors code + commits only. **Ship is a controller OTA step AFTER the final opus whole-impl review** (not in this plan).
- Gate per task: `npx tsc --noEmit` clean + the stated manual reasoning.

## Verified anchors (@ 41bb68e)
- `app/project-detail.tsx`: `projectInvoices` memo @ `:179`; `project` in scope; util-import line group near `:53` (`import { exportProjectIcs } from '@/utils/icsGenerator';`); `nailIt` imported `:51`; `Alert`, `Platform`, `Haptics`, `useCallback`, `Share2` (`:15`) already imported; `handleExportCalendar` useCallback `:693-718` (the exact precedent: prompt/await-util/`result.X===0`→Alert/else success/try-catch→Alert, deps `[project, projectInvoices, ...]`); Invoices render block `{activeTile === 'invoices' && (` @ `:2344`, inner `{expanded.invoices && (<View style={styles.coCard}>` with the `{projectInvoices.length > 0 && (() => { …chips… })()}` IIFE then the invoice `.map`; reusable pill style `styles.photoShareBtn` + `styles.photoShareBtnText` @ `:4105/:4117`. project-detail does NOT import `expo-file-system`/`expo-sharing` (and must not).
- `utils/icsGenerator.ts` `exportProjectIcs` precedent: `import * as FileSystem from 'expo-file-system/legacy'; import * as Sharing from 'expo-sharing';`; `const dir = FileSystem.cacheDirectory;` → `await FileSystem.writeAsStringAsync(fileUri, text, { encoding: 'utf8' });` → `if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri, {...});` → returns a result object.
- `utils/tax1099Export.ts` `csvCell` shape (reuse, extend with formula-injection guard): `if (/[",\n\r]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';`.
- Types: `Invoice { number:number; issueDate:string; dueDate:string; lineItems:InvoiceLineItem[]; taxRate:number; taxAmount:number; totalDue:number; amountPaid:number; status:InvoiceStatus }`; `InvoiceLineItem { name:string; description:string; quantity:number; unit:string; unitPrice:number; total:number }`; `InvoiceStatus='draft'|'sent'|'partially_paid'|'paid'|'overdue'`; `Project { name:string; primaryContact?:{ name?:string } }`.

---

### Task 1: `utils/accountingExport.ts` — pure builder + icsGenerator-pattern share wrapper

**Files:** Create `utils/accountingExport.ts`

- [ ] **Step 1: Create the file (entire content)**

```ts
// Accounting CSV export — give the GC's bookkeeper one file QuickBooks
// Online or Xero can import, instead of manual double-entry. Read-only
// over the project's invoices. The pure builder is separate from the
// FS/share wrapper (mirrors utils/icsGenerator.ts exportProjectIcs);
// project-detail calls the wrapper exactly like it calls exportProjectIcs.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Project, Invoice, InvoiceStatus } from '@/types';

export type AccountingFormat = 'quickbooks' | 'xero';

const BILLABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'sent', 'partially_paid', 'paid', 'overdue',
]);

// RFC-4180 escaping + spreadsheet formula-injection guard (these files
// open in Excel/Sheets). Same shape as utils/tax1099Export.ts csvCell.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > 0 && '=+-@'.indexOf(s[0] as string) !== -1) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDate(iso: string | undefined, format: AccountingFormat): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return format === 'xero' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
}

function money(n: number): string {
  return Number.isFinite(n) ? Number(n).toFixed(2) : '0.00';
}

const QBO_HEADER = [
  'InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item(Product/Service)',
  'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Taxable',
  'TaxRate', 'ServiceDate', 'Memo',
];
const XERO_HEADER = [
  'ContactName', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'Description',
  'Quantity', 'UnitAmount', 'AccountCode', 'TaxType', 'TrackingName1',
  'TrackingOption1',
];

/**
 * Pure: build the CSV string + a sanitized filename. Never touches the FS.
 * Empty / all-draft invoices → rowCount 0 and csv = header only.
 */
export function buildAccountingCsv(
  format: AccountingFormat,
  project: Project,
  invoices: Invoice[],
): { filename: string; csv: string; rowCount: number } {
  const customer = project.primaryContact?.name ?? project.name;
  const billable = (invoices ?? []).filter((i) => BILLABLE.has(i.status));
  const header = format === 'xero' ? XERO_HEADER : QBO_HEADER;
  const rows: string[][] = [];

  for (const inv of billable) {
    const issue = fmtDate(inv.issueDate, format);
    const due = fmtDate(inv.dueDate, format);
    for (const li of inv.lineItems ?? []) {
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due,
          li.description || li.name, String(li.quantity),
          money(li.unitPrice), '', '', 'Project', project.name,
        ]);
      } else {
        rows.push([
          String(inv.number), customer, issue, due, li.name,
          li.description, String(li.quantity), money(li.unitPrice),
          money(li.total), inv.taxAmount > 0 ? 'Yes' : 'No',
          String(inv.taxRate ?? ''), issue, `Invoice #${inv.number}`,
        ]);
      }
    }
    if (inv.taxAmount > 0) {
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due, 'Sales Tax', '1',
          money(inv.taxAmount), '', '', 'Project', project.name,
        ]);
      } else {
        rows.push([
          String(inv.number), customer, issue, due, 'Sales Tax',
          'Sales Tax', '1', money(inv.taxAmount), money(inv.taxAmount),
          'No', '', issue, `Invoice #${inv.number} tax`,
        ]);
      }
    }
  }

  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\n');

  const safe =
    (project.name || 'project').replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') ||
    'project';
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `${safe}-invoices-${format}-${ymd}.csv`;

  return { filename, csv, rowCount: rows.length };
}

/**
 * FS/share wrapper — mirrors utils/icsGenerator.ts exportProjectIcs.
 * rowCount 0 → returns early without writing/sharing a file.
 */
export async function exportProjectAccountingCsv(input: {
  format: AccountingFormat;
  project: Project;
  invoices: Invoice[];
}): Promise<{ rowCount: number; fileUri: string }> {
  const { filename, csv, rowCount } = buildAccountingCsv(
    input.format, input.project, input.invoices,
  );
  if (rowCount === 0) return { rowCount: 0, fileUri: '' };

  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const fileUri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export invoices to accounting',
      UTI: 'public.comma-separated-values-text',
    });
  }
  return { rowCount, fileUri };
}
```

- [ ] **Step 2: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. Reason through (report): `buildAccountingCsv` is pure/total — no invoices / all-`draft` → `rowCount 0`, csv = header line only, no throw; QBO vs Xero headers + per-line rows + a tax row when `taxAmount>0`; `csvCell` escapes `, " \n` and prefixes `'` to a cell starting `= + - @`; `fmtDate` guards invalid/empty → `''` (never "Invalid Date"); money fixed 2dp; filename sanitized. `exportProjectAccountingCsv` returns early (no file) when `rowCount 0`, else writes to `FileSystem.cacheDirectory` + shares — exact `exportProjectIcs` shape. Strict TS, no `any`.

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/accountingExport.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.3): pure QuickBooks/Xero invoice CSV builder + share wrapper"
```

---

### Task 2: Wire the export action into the Invoices sub-panel

**Files:** Modify `app/project-detail.tsx`

- [ ] **Step 1: Add the util import**

Find the line:
```tsx
import { exportProjectIcs } from '@/utils/icsGenerator';
```
Add immediately AFTER it:
```tsx
import { exportProjectAccountingCsv, type AccountingFormat } from '@/utils/accountingExport';
```
(Do NOT add `expo-file-system`/`expo-sharing` imports — the util owns those, exactly as for `exportProjectIcs`.)

- [ ] **Step 2: Add the `handleExportAccounting` handler**

Find the END of the `handleExportCalendar` useCallback (it closes with `}, [project, projectInvoices, projectWarranties]);` around `:718`). Immediately AFTER that line, insert:
```tsx
  const handleExportAccounting = useCallback(async () => {
    if (!project) return;
    const run = async (format: AccountingFormat) => {
      try {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const result = await exportProjectAccountingCsv({ format, project, invoices: projectInvoices });
        if (result.rowCount === 0) {
          Alert.alert('Nothing to export', 'No billable invoices on this project yet (draft invoices are excluded).');
          return;
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        nailIt(`Exported ${result.rowCount} line${result.rowCount === 1 ? '' : 's'} · ${format === 'xero' ? 'Xero' : 'QuickBooks'}`);
      } catch (err) {
        console.error('[ProjectDetail] Accounting export error:', err);
        Alert.alert('Error', 'Could not export the accounting CSV. Please try again.');
      }
    };
    Alert.alert('Export to accounting', 'Choose the format your bookkeeper imports.', [
      { text: 'QuickBooks Online', onPress: () => { void run('quickbooks'); } },
      { text: 'Xero', onPress: () => { void run('xero'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [project, projectInvoices]);
```

- [ ] **Step 3: Add the trigger button in the Invoices coCard**

In the `{activeTile === 'invoices' && (` block (~`:2344`), inside `{expanded.invoices && (<View style={styles.coCard}>`, find:
```tsx
              {projectInvoices.length === 0 && (
                <Text style={styles.coEmptyText}>No invoices yet.</Text>
              )}
```
Immediately AFTER that block, insert (shows only when there is ≥1 billable invoice — `draft`-only projects don't show it):
```tsx
              {projectInvoices.some(i => i.status !== 'draft') && (
                <TouchableOpacity
                  style={styles.photoShareBtn}
                  onPress={() => { void handleExportAccounting(); }}
                  activeOpacity={0.8}
                  testID="invoices-accounting-export"
                >
                  <Share2 size={16} color={themeColors.accent} />
                  <Text style={styles.photoShareBtnText}>Export to accounting (CSV)</Text>
                  <Text style={styles.photoShareBtnHint}>QuickBooks · Xero</Text>
                </TouchableOpacity>
              )}
```

- [ ] **Step 4: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. Reason through (report): tapping "Export to accounting" → 2-format Alert → `exportProjectAccountingCsv` → ≥1 billable invoice exports + shares with a success `nailIt`; 0 billable → "Nothing to export" Alert, no file; error → caught, "Error" Alert, no crash; the button is hidden when every invoice is `draft` / there are none; no `useTierAccess` (ungated); project-detail did not gain `expo-file-system`/`expo-sharing` imports; every other project-detail section, `integrations.tsx`, `tax1099Export.ts`, `icsGenerator.ts` byte-unchanged.

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/project-detail.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.3): project-detail Invoices → accounting CSV export action"
```

---

## Final combined gate (after both tasks)
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit && git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" diff --stat 41bb68e HEAD
```
Expected: tsc clean; `git diff --stat` lists ONLY `utils/accountingExport.ts`, `app/project-detail.tsx`, + the S1.3 spec/plan `.md` docs. No other source file.

## Ship (controller, AFTER final opus whole-impl review — NOT build)
Code-only, OTA-able, no migration/portal/edge-fn → Netlify-independent. FF-merge `claude/p0-launch-on-main` → `main` (FF if possible, else clean safe merge — never force), push, then:
```bash
eas update --branch production --message "S1.3 accounting CSV export (QuickBooks/Xero)"
```

## Self-Review
**Spec coverage:** §4.1 pure builder + filename + billable filter + tax row + csvCell + formula-injection guard → Task 1 Step 1; the icsGenerator-pattern share wrapper (spec's pure-core + share intent, placed in the util to match project-detail's real `exportProjectIcs` delegation) → Task 1 Step 1 `exportProjectAccountingCsv`; §4.2 trigger in Invoices sub-panel + 2-format prompt + nailIt/Alert mirroring `handleExportCalendar` → Task 2; §4.3 ungated (no `useTierAccess`) → CRITICAL + Task 2 (none added); §5 error handling (pure/total, guarded dates, formula-injection, read-only, try/catch) → Task 1+2 gates; §6 verification → per-task "Reason through" + final gate; §3 non-goals (no integrations.tsx/types/migration/dep) → CRITICAL + diff-stat gate. No gaps.
**Placeholder scan:** No TBD/TODO. Task 1 is the entire file verbatim. Task 2 gives exact find-targets + exact inserted code at named line anchors. The only "confirm" was resolved pre-plan (primaryContact shape, ungated decision, exportProjectIcs pattern). No vague directives.
**Type/name consistency:** `AccountingFormat`/`buildAccountingCsv`/`exportProjectAccountingCsv`/`csvCell`/`fmtDate`/`money`/`rowCount`/`BILLABLE` consistent across both tasks; `Invoice`/`InvoiceLineItem`/`InvoiceStatus`/`Project.primaryContact?.name` match `types/index.ts` exactly; `handleExportAccounting` deps `[project, projectInvoices]` match the values it reads; `styles.photoShareBtn`/`photoShareBtnText`/`photoShareBtnHint` + `Share2` + `nailIt` + `Alert`/`Platform`/`Haptics` are all verified-existing imports/styles in `project-detail.tsx`. 2 tasks, Task 2 imports Task 1's exports — names match.
