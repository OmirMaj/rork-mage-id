// components/codeFlags/CodeFlagAgeRow.tsx — Code Flags: the ONE building-age
// row of a change order or an estimate.
//
// WHY ONE ROW. The lead rule reads words like "paint", "door" and "window",
// so in an older home it used to put a chip on a third of the lines. It is one
// fact about the building, not thirty facts about thirty lines. So it shows
// once, as a quiet row above the lines, and its sheet says how many lines
// carry the words.
//
// It shows only when the project has a year built on file and a rule applies
// (lead: a home built before 1978; asbestos: New York City, 1987 or earlier).
// An estimate with no project has no year, so it never shows there.
//
// Like the chip it never disables, delays or guards anything, takes no
// callback from the screen, and stores nothing on the lines.
//
// Renders nothing while CODE_FLAGS_ENABLED is false.
import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Info } from 'lucide-react-native';
import { CODE_FLAGS_ENABLED } from '@/constants/featureFlags';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useCodeFlagChipLabels } from '@/hooks/useCodeFlagsCopy';
import { flagBuildingAge, hitFamilyIds, type CodeFlagLine } from '@/utils/codeFlags/match';
import { CODE_FLAG_AGE_ROW_ID, dismissScope, isDismissed } from '@/utils/codeFlags/dismissCore';
import { dismissLine, dismissalsSnapshot, subscribeDismissals } from '@/utils/codeFlags/dismissStore';
import { useCodeFlagContext } from '@/components/codeFlags/contextStore';
import CodeFlagSheet from '@/components/codeFlags/CodeFlagSheet';

export interface CodeFlagAgeRowProps {
  projectId?: string | null;
  /** The page's lines: change order lines, or estimate cart rows (`{ material }`). */
  lines: readonly unknown[];
  testID?: string;
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** A change order line or an estimate cart row, as the matcher reads it. */
export function toCodeFlagLine(row: unknown): CodeFlagLine | null {
  if (!row || typeof row !== 'object') return null;
  const outer = row as Record<string, unknown>;
  const src = (outer.material && typeof outer.material === 'object' ? outer.material : outer) as Record<string, unknown>;
  const name = text(src.name);
  if (!name) return null;
  return { name, description: text(src.description), category: text(src.category), csiDivision: text(src.csiDivision) };
}

function RowOn({ projectId, lines, testID }: CodeFlagAgeRowProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const labels = useCodeFlagChipLabels();
  const ctx = useCodeFlagContext(projectId);
  const dismissals = useSyncExternalStore(subscribeDismissals, dismissalsSnapshot, dismissalsSnapshot);
  const [open, setOpen] = useState(false);

  const result = useMemo(() => flagBuildingAge(lines.map(toCodeFlagLine), ctx), [lines, ctx]);
  const scope = dismissScope(projectId);
  const families = useMemo(() => hitFamilyIds(result), [result]);
  const hidden = isDismissed(dismissals, scope, CODE_FLAG_AGE_ROW_ID, families);

  const onHide = useCallback(() => {
    setOpen(false);
    void dismissLine(scope, CODE_FLAG_AGE_ROW_ID, families);
  }, [scope, families]);

  if (!result.flagged || hidden) return null;
  const id = testID ?? 'code-flag-age-row';
  return (
    <>
      <TouchableOpacity
        style={styles.row}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={labels.ageA11yBody}
        testID={id}
      >
        <Info size={14} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.rowText}>{labels.ageLabel}</Text>
      </TouchableOpacity>
      {open ? (
        <CodeFlagSheet
          visible
          onClose={() => setOpen(false)}
          onHide={onHide}
          variant="age"
          categoryName={null}
          projectId={projectId ?? null}
          hits={result.hits}
          place={result.place}
          testID={`${id}-sheet`}
        />
      ) : null}
    </>
  );
}

export default function CodeFlagAgeRow(props: CodeFlagAgeRowProps) {
  if (!CODE_FLAGS_ENABLED) return null;
  return <RowOn {...props} />;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch',
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  rowText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600', flexShrink: 1 },
});
