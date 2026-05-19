# S1.1 — CSI Division Picker on CO Line Items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let a GC tag each change-order line item with a CSI MasterFormat division via a reusable picker backed by the existing `utils/csiMasterFormat.ts` catalog.

**Architecture:** Three additive changes — (1) one optional field on `ChangeOrderLineItem`, (2) a new self-contained `CSIDivisionPicker` component (its own trigger + internal modal, using `CSI_DIVISIONS` + `classifyToCSIDivision` auto-suggest), (3) a single wire-in inside the existing editable line-item card in `app/change-order.tsx`. No schema, no engine refactor, no migration, no new dependency.

**Tech Stack:** TypeScript strict (NO `any`), React Native (`Modal`, `TextInput`, `ScrollView`, `TouchableOpacity`), lucide-react-native, `useTheme`/`useThemedStyles`/`Tokens`/`Type` (all already used in the codebase). No unit runner — per-task gate = `npx tsc --noEmit` clean from worktree root + spec §6 manual reasoning.

**Spec:** `docs/superpowers/specs/2026-05-19-s1-1-csi-picker-co-lineitem-design.md` (@ `eeccbd5`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` (== `main` @ `5e60b32`). Use `git -C "<that path>"`.

---

## CRITICAL
- Additive only; ungated; NO migration/edge-fn/portal/new-dep. Do NOT modify `utils/csiMasterFormat.ts` (reuse as-is), `utils/jobCostEngine.ts` (deferred follow-up), `utils/earnedValueEngine.ts`, `app/integrations.tsx`, or any line-item type beyond `ChangeOrderLineItem`. Do NOT add `useTierAccess`.
- Strict TS, NO `any`.
- Only 3 files change: `types/index.ts` (1 added field), `components/CSIDivisionPicker.tsx` (new), `app/change-order.tsx` (one wire-in).
- Build authors code + commits only. **Ship is a controller OTA step AFTER the final opus whole-impl review** (not in this plan).
- Gate per task: `npx tsc --noEmit` clean + the stated manual reasoning.

## Verified anchors (@ `5e60b32`)
- `types/index.ts:978-987` — `ChangeOrderLineItem` interface (8 fields; the only line-item type currently missing `csiDivision?`).
- `utils/csiMasterFormat.ts` (already shipped, 150 lines): exports `CSI_DIVISIONS`, `CSI_DIVISION_BY_NUMBER`, `csiDivisionLabel(num)`, `classifyToCSIDivision(text)` (returns 2-digit code or `null`), `groupByCSIDivision<T>()`.
- `app/change-order.tsx`:
  - Imports already include `View, Text, ... Modal, TextInput, TouchableOpacity, ScrollView, Platform` from `react-native`; `useTheme`, `useThemedStyles`, `ThemeColors`; lucide icons (no need to add new ones for Task 3 — the picker brings its own icons).
  - Line-item card render at `:720-773`: `lineItems.map((item) => (<View key={item.id} style={styles.lineItemCard}> … !isLocked ? (<View style={styles.lineItemFields}>…</View>) : (<View style={styles.lineItemFields}>…</View>) </View>))`. The picker insertion point is **inside the editable branch**, as a sibling row below the existing `<View style={styles.lineItemFields}>` (locked rows stay read-only and do not show the picker — matches the existing locked/editable split).
  - `setLineItems(prev => prev.map(item => item.id === ... ? { ...item, X: Y } : item))` setter shape at `:285,292` — mirror it for `csiDivision` updates.

---

### Task 1: Optional `csiDivision` on `ChangeOrderLineItem`

**Files:** Modify `types/index.ts`

- [ ] **Step 1: Add the optional field**

Find this exact block (`types/index.ts:978-987`):
```ts
export interface ChangeOrderLineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  isNew: boolean;
}
```
Replace it ENTIRELY with (keep every existing field byte-identical; add one optional field with a doc comment):
```ts
export interface ChangeOrderLineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  isNew: boolean;
  /** Optional CSI MasterFormat division code (2-digit, e.g. "03" for Concrete).
   *  When set, downstream tooling (job-cost, export, audit) can attribute this
   *  line item to a CSI division instead of falling back to free-text matching
   *  on the CO description. */
  csiDivision?: string;
}
```

- [ ] **Step 2: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. The field is optional, so every existing usage of `ChangeOrderLineItem` (constructor literals at `app/change-order.tsx:219,248,263,266,589`, the seedFromOverage etc.) keeps compiling without change. Manual reasoning: every existing CO + CO line item retains today's shape; the field is just available for downstream tooling when set.

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add types/index.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.1): optional csiDivision on ChangeOrderLineItem"
```

---

### Task 2: `components/CSIDivisionPicker.tsx` — reusable controlled picker

**Files:** Create `components/CSIDivisionPicker.tsx`

- [ ] **Step 1: Create the file (entire content)**

```tsx
// CSIDivisionPicker — a reusable controlled trigger+modal for selecting a
// CSI MasterFormat 2020 division. Backed by the existing CSI_DIVISIONS
// catalog in utils/csiMasterFormat.ts (no duplication). The trigger is a
// small pill the caller embeds anywhere; tapping opens an internal modal
// with optional auto-suggest (driven by suggestFromText →
// classifyToCSIDivision), a search box, and the full 50-division list.
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, X, Sparkles, Search } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  CSI_DIVISIONS,
  csiDivisionLabel,
  classifyToCSIDivision,
} from '@/utils/csiMasterFormat';

export interface CSIDivisionPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Free-text used by classifyToCSIDivision for the in-modal "Suggested" affordance. */
  suggestFromText?: string;
  testID?: string;
}

export function CSIDivisionPicker(props: CSIDivisionPickerProps): JSX.Element {
  const { value, onChange, suggestFromText, testID } = props;
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  const suggested: string | null = useMemo(() => {
    if (!suggestFromText || !suggestFromText.trim()) return null;
    const guess = classifyToCSIDivision(suggestFromText);
    if (!guess || guess === value) return null;
    return guess;
  }, [suggestFromText, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CSI_DIVISIONS;
    return CSI_DIVISIONS.filter((d) => {
      if (d.number.toLowerCase().includes(q)) return true;
      if (d.title.toLowerCase().includes(q)) return true;
      for (const ex of d.examples) {
        if (ex.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [query]);

  const triggerLabel = value ? csiDivisionLabel(value) : 'Pick CSI division';

  const select = (code: string | undefined) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={value ? `CSI division ${triggerLabel}` : 'Pick CSI division'}
        testID={testID}
      >
        <Text
          style={[styles.triggerText, !value && styles.triggerTextMuted]}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        <ChevronDown size={14} color={themeColors.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop} onTouchEnd={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>CSI MasterFormat division</Text>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>

          {suggested && (
            <TouchableOpacity
              style={styles.suggestRow}
              onPress={() => select(suggested)}
              activeOpacity={0.85}
              testID="csi-suggest"
            >
              <Sparkles size={14} color={themeColors.accent} />
              <Text style={styles.suggestText} numberOfLines={1}>
                Suggested · {csiDivisionLabel(suggested)}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.searchRow}>
            <Search size={14} color={themeColors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search division, title, or scope"
              placeholderTextColor={themeColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {filtered.map((d) => {
              const selected = d.number === value;
              const exampleHint = d.examples.slice(0, 3).join(' · ');
              return (
                <TouchableOpacity
                  key={d.number}
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => select(d.number)}
                  activeOpacity={0.8}
                  testID={`csi-div-${d.number}`}
                >
                  <View style={styles.rowNumberPill}>
                    <Text style={styles.rowNumber}>{d.number}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
                    {exampleHint.length > 0 && (
                      <Text style={styles.rowHint} numberOfLines={1}>{exampleHint}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 && (
              <Text style={styles.emptyText}>No divisions match "{query}".</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {value !== undefined && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => select(undefined)}
                activeOpacity={0.8}
                testID="csi-clear"
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  trigger: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    alignSelf: 'flex-start' as const,
  },
  triggerText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  triggerTextMuted: {
    color: themeColors.textMuted,
    fontWeight: '500' as const,
  },
  backdrop: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    maxHeight: '85%' as const,
    backgroundColor: themeColors.bg,
    borderTopLeftRadius: Tokens.radius.lg,
    borderTopRightRadius: Tokens.radius.lg,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
  },
  suggestRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '14',
    borderWidth: 1,
    borderColor: themeColors.accent + '40',
    marginBottom: 10,
  },
  suggestText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
  },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    paddingVertical: Platform.OS === 'web' ? 8 : 0,
  },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 6 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.md,
  },
  rowSelected: { backgroundColor: themeColors.accent + '12' },
  rowNumberPill: {
    minWidth: 36,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surfaceAlt,
    alignItems: 'center' as const,
  },
  rowNumber: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: 0.5,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  rowHint: {
    marginTop: 2,
    fontSize: 11,
    color: themeColors.textMuted,
  },
  emptyText: {
    paddingVertical: 18,
    textAlign: 'center' as const,
    color: themeColors.textMuted,
    fontSize: Type.caption1.fontSize,
  },
  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingTop: 10,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    alignItems: 'center' as const,
  },
  clearBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.text + '08',
    alignItems: 'center' as const,
  },
  cancelBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
});
```

- [ ] **Step 2: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean (strict, no `any`). Manual reasoning: controlled component (no internal `value` state); the `suggested` memo guards on empty `suggestFromText`, `classifyToCSIDivision` null, and `guess === value`; the `filtered` memo handles empty query (returns full catalog); `select(undefined)` clears; `select(code)` writes a 2-digit code from the catalog; Cancel/backdrop close without `onChange`. Reuses `CSI_DIVISIONS` + `csiDivisionLabel` + `classifyToCSIDivision` from the existing util (no duplication).

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add components/CSIDivisionPicker.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.1): CSIDivisionPicker component (catalog-backed, auto-suggest)"
```

---

### Task 3: Wire the picker into the CO line-item card

**Files:** Modify `app/change-order.tsx`

- [ ] **Step 1: Add the component import**

Find this exact line (in the imports block around `:20`):
```tsx
import EmptyState from '@/components/EmptyState';
```
Insert IMMEDIATELY AFTER it:
```tsx
import { CSIDivisionPicker } from '@/components/CSIDivisionPicker';
```

- [ ] **Step 2: Add the picker row inside the editable line-item card**

Find this exact block (the editable branch of the line-item conditional, around `:734-762`):
```tsx
                {!isLocked ? (
                  <View style={styles.lineItemFields}>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Qty</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.quantity.toString()}
                        onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Unit</Text>
                      <Text style={styles.lineItemUnitText}>{item.unit}</Text>
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Price</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.unitPrice.toString()}
                        onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Total</Text>
                      <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                    </View>
                  </View>
                ) : (
```
Replace it ENTIRELY with (wrap the existing `<View style={styles.lineItemFields}>` byte-identical PLUS a new sibling picker row in a fragment; locked branch unchanged — locked rows do NOT get the picker, matching today's read-only semantics):
```tsx
                {!isLocked ? (
                  <>
                    <View style={styles.lineItemFields}>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Qty</Text>
                        <TextInput
                          style={styles.lineItemInput}
                          value={item.quantity.toString()}
                          onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Unit</Text>
                        <Text style={styles.lineItemUnitText}>{item.unit}</Text>
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Price</Text>
                        <TextInput
                          style={styles.lineItemInput}
                          value={item.unitPrice.toString()}
                          onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Total</Text>
                        <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                      </View>
                    </View>
                    <View style={{ marginTop: 8 }}>
                      <CSIDivisionPicker
                        value={item.csiDivision}
                        suggestFromText={item.description}
                        onChange={(next) =>
                          setLineItems((prev) =>
                            prev.map((li) =>
                              li.id === item.id ? { ...li, csiDivision: next } : li,
                            ),
                          )
                        }
                        testID={`co-line-csi-${item.id}`}
                      />
                    </View>
                  </>
                ) : (
```

- [ ] **Step 3: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. Reason through (report): each editable CO line-item card now renders a small "Pick CSI division" pill below the qty/unit/price/total row; tapping opens the picker; selecting → `setLineItems(prev => prev.map(li => li.id === item.id ? { ...li, csiDivision: next } : li))` (mirrors the existing per-field update setter at `:285,292`); clearing sets `csiDivision: undefined` (the field type is `csiDivision?: string`, so `undefined` is valid). Locked rows do NOT show the picker (matches today's read-only semantics; the locked branch is byte-unchanged). Save path / totals math / validation / send / CCD branches all byte-unchanged. No `useTierAccess` added.

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/change-order.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.1): CO line-item CSI division picker wire-in"
```

---

## Final combined gate (after all 3 tasks)
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit && git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" diff --stat 5e60b32 HEAD
```
Expected: tsc clean; `git diff --stat` lists EXACTLY `types/index.ts`, `components/CSIDivisionPicker.tsx`, `app/change-order.tsx`, + the S1.1 spec/plan `.md` docs. No other source file.

## Ship (controller, AFTER final opus whole-impl review — NOT build)
Code-only, OTA-able, no migration/edge-fn/portal → Netlify-independent. FF-merge `claude/p0-launch-on-main` → `main` (FF if possible; else clean safe merge — never force), push, then:
```bash
eas update --branch production --message "S1.1 CSI division picker on CO line items (honest re-scope)"
```

## Self-Review
**Spec coverage:** §4.1 additive optional `csiDivision?: string` on `ChangeOrderLineItem` → Task 1; §4.2 reusable controlled `CSIDivisionPicker` with `value`/`onChange`/`suggestFromText`/`testID`, trigger + internal modal, search + auto-suggest + Clear/Cancel, catalog reuse → Task 2; §4.3 wire-in into the editable CO line-item card with `setLineItems(prev => prev.map(...))` setter and locked rows unchanged → Task 3; §3 non-goals (no schema/migration/engine/integrations/types-beyond-CO; ungated; v1 limited to CO line items) → CRITICAL + scope confined to the 3 named files; §5 error handling (optional field, controlled component, null-guards in suggested/filtered memos) → Task 1 Step 2 + Task 2 Step 2 reasoning; §6 verification → per-task gates + final combined gate. No gaps.
**Placeholder scan:** No TBD/TODO. Task 1 = exact before/after of the type block. Task 2 = entire new file given verbatim (only `ThemeColors` is imported from `@/constants/colors` — the static `Colors` is not needed and not imported, avoiding a dead import). Task 3 = exact find/replace of the editable branch + the verbatim import.
**Type/name consistency:** `ChangeOrderLineItem.csiDivision?: string` (Task 1) ↔ `item.csiDivision` (Task 3) ↔ `value: string | undefined` (Task 2 `CSIDivisionPicker`) all consistent. `CSIDivisionPicker` / `CSIDivisionPickerProps` named identically across Tasks 2-3. `CSI_DIVISIONS`, `csiDivisionLabel`, `classifyToCSIDivision` match `utils/csiMasterFormat.ts` exactly. `setLineItems(prev => prev.map(li => li.id === item.id ? { ...li, X: Y } : li))` setter shape matches existing usage at `app/change-order.tsx:285,292`. 3 tasks, dependencies are simple imports — Task 3 imports Task 1's `csiDivision` field and Task 2's `CSIDivisionPicker` export; both names match.
