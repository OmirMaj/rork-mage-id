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
// Renders nothing while CODE_FLAGS_ENABLED is false, for a line with no flag,
// and for a line whose flag he has hidden.
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Info } from 'lucide-react-native';
import { CODE_FLAGS_ENABLED } from '@/constants/featureFlags';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { useCodeFlagsCopy } from '@/hooks/useCodeFlagsCopy';
import { flagLine, hitFamilyIds } from '@/utils/codeFlags/match';
import { dismissScope, isDismissed } from '@/utils/codeFlags/dismissCore';
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
  const copy = useCodeFlagsCopy();
  const ctx = useCodeFlagContext(projectId);
  const dismissals = useSyncExternalStore(subscribeDismissals, dismissalsSnapshot, dismissalsSnapshot);
  const [open, setOpen] = useState(false);

  const result = useMemo(
    () => flagLine({ name, description, category, csiDivision }, ctx),
    [name, description, category, csiDivision, ctx],
  );
  const scope = dismissScope(projectId);
  const families = useMemo(() => hitFamilyIds(result), [result]);
  const hidden = isDismissed(dismissals, scope, lineKey, families);

  // A line edited out of its flag while the sheet is open closes the sheet.
  useEffect(() => { if (!result.flagged) setOpen(false); }, [result.flagged]);

  const onHide = useCallback(() => {
    setOpen(false);
    void dismissLine(scope, lineKey, families);
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
        accessibilityRole="button"
        accessibilityLabel={copy.chipA11yBody(result.kind)}
        testID={id}
      >
        <Info size={12} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.chipText}>{copy.chipLabel(result.kind)}</Text>
      </TouchableOpacity>
      {open ? (
        <CodeFlagSheet
          visible
          onClose={() => setOpen(false)}
          onHide={onHide}
          lineName={name}
          categoryName={categoryName ?? null}
          projectId={projectId ?? null}
          result={result}
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
  name: { fontSize: 12, color: t.textSecondary, flexShrink: 1, maxWidth: '45%' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  chipText: { fontSize: 11.5, color: t.textSecondary, fontWeight: '600' },
});
