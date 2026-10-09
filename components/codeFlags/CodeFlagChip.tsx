// components/codeFlags/CodeFlagChip.tsx — Code Flags: the quiet chip on a
// change order line or an estimate line, and the tap that opens its sheet.
//
// WHAT IT IS. A note to the contractor: "this kind of work is commonly looked
// at on a permit or by an inspector". Computed from the line's own words when
// the line is drawn (utils/codeFlags/match.flagLine); nothing is stored on the
// line, so nothing can travel with it to a client.
//
// WHAT IT NEVER DOES. It never disables, delays or guards anything: this
// component takes no callback from the screen and hands none back, so no
// Save, Send, Sign, Approve or Bill button can depend on it. It is not red and
// carries no warning triangle; the accent colour is never its background.
//
// PERMIT KINDS ONLY. The two building-age rules are one row for the whole
// change order or estimate (CodeFlagAgeRow), never a chip on a line.
//
// COST. The chip reads two labels (useCodeFlagChipLabels, one shared object).
// The sheet and its sentences exist only while the sheet is open.
//
// NO PROJECT, NO MEMORY. On an estimate that is not on a project yet, hiding a
// flag hides it on this line while it stays on screen, and nothing is stored.
//
// Renders nothing while CODE_FLAGS_ENABLED is false, for a line with no flag,
// and for a line whose flag he has hidden.
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Info } from 'lucide-react-native';
import { CODE_FLAGS_ENABLED } from '@/constants/featureFlags';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useCodeFlagChipLabels } from '@/hooks/useCodeFlagsCopy';
import { flagBuildingAge, flagLine, hitFamilyIds } from '@/utils/codeFlags/match';
import { dismissScope, isDismissed, isStorableScope } from '@/utils/codeFlags/dismissCore';
import { dismissLine, dismissalsSnapshot, subscribeDismissals } from '@/utils/codeFlags/dismissStore';
import { useCodeFlagContext } from '@/components/codeFlags/contextStore';
import CodeFlagSheet from '@/components/codeFlags/CodeFlagSheet';

export interface CodeFlagChipProps {
  /** The project the line is on. Absent on an estimate that is not on a project yet. */
  projectId?: string | null;
  /** The line's own id (what a hidden flag is remembered under). */
  lineKey: string;
  name: string;
  description?: string | null;
  /** A CATEGORY_META key or label. */
  category?: string | null;
  /** The category as the screen shows it ('Electrical'), for the sheet. */
  categoryName?: string | null;
  csiDivision?: string | null;
  /** Show the line's name before the chip (the wide-screen list under a grid). */
  showName?: boolean;
  testID?: string;
}

function ChipOn(props: CodeFlagChipProps) {
  const { projectId, lineKey, name, description, category, categoryName, csiDivision, showName, testID } = props;
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const labels = useCodeFlagChipLabels();
  const ctx = useCodeFlagContext(projectId);
  const dismissals = useSyncExternalStore(subscribeDismissals, dismissalsSnapshot, dismissalsSnapshot);
  const [open, setOpen] = useState(false);
  const [hiddenHere, setHiddenHere] = useState(false);

  const result = useMemo(
    () => flagLine({ name, description, category, csiDivision }, ctx),
    [name, description, category, csiDivision, ctx],
  );
  const scope = dismissScope(projectId);
  const families = useMemo(() => hitFamilyIds(result), [result]);
  const hidden = hiddenHere || isDismissed(dismissals, scope, lineKey, families);
  // Read only while the sheet is open: whether the year is missing for this line.
  const ageNotChecked = useMemo(
    () => (open ? flagBuildingAge([{ name, description, category, csiDivision }], ctx).ageNotChecked : false),
    [open, name, description, category, csiDivision, ctx],
  );

  // A line edited out of its flag while the sheet is open closes the sheet.
  useEffect(() => { if (!result.flagged) setOpen(false); }, [result.flagged]);

  const onHide = useCallback(() => {
    setOpen(false);
    if (isStorableScope(scope)) void dismissLine(scope, lineKey, families);
    else setHiddenHere(true);
  }, [scope, lineKey, families]);

  if (!result.flagged || !result.kind || hidden) return null;
  const id = testID ?? `code-flag-${lineKey}`;
  return (
    <View style={styles.row}>
      {showName ? <Text style={styles.name} numberOfLines={1}>{name}</Text> : null}
      <TouchableOpacity
        style={styles.chip}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={labels.permitA11yBody}
        testID={id}
      >
        <Info size={12} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.chipText}>{labels.permitLabel}</Text>
      </TouchableOpacity>
      {open ? (
        <CodeFlagSheet
          visible
          onClose={() => setOpen(false)}
          onHide={onHide}
          lineName={name}
          categoryName={categoryName ?? null}
          projectId={projectId ?? null}
          variant="line"
          hits={result.hits}
          place={result.place}
          ageNotChecked={ageNotChecked}
          testID={`${id}-sheet`}
        />
      ) : null}
    </View>
  );
}

export default function CodeFlagChip(props: CodeFlagChipProps) {
  if (!CODE_FLAGS_ENABLED) return null;
  return <ChipOn {...props} />;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  name: { ...Type.caption1, color: t.textSecondary, flexShrink: 1, maxWidth: '45%' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  chipText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' },
});
