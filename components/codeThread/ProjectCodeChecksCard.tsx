/**
 * ProjectCodeChecksCard — the job page's "Code checks": the checks he ran for
 * this job, each with its date, category, jurisdiction and edition, and a way
 * to run a new one for the job.
 *
 * HONESTY
 * - The saved checks live on this device and are erased when he signs out
 *   (the mageid_* sweep); the card says so under the list.
 * - An unreadable store says "Couldn't read…", never "No saved checks".
 * - A check with no jurisdiction on file says so instead of guessing one.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCodeChecks } from '@/hooks/useCodeChecks';
import { codeCheckRoute } from '@/utils/codeThread/actions';
import type { CodeCheckRecord } from '@/utils/codeThread/types';
import type { Project } from '@/types';
import { codeCheckDateLabel } from './CodeThreadActions';
import { SavedCodeCheckSheet } from './SavedCodeCheckSheet';

export const CODE_CHECKS_FAILED_TEXT = 'Couldn’t read the saved checks on this device.';
export const CODE_CHECKS_EMPTY_TEXT =
  'No saved checks yet. A check you run for this job is saved here with its date, jurisdiction and edition.';
export const CODE_CHECKS_LOCAL_CAPTION = 'Saved on this device until you sign out.';
const COLLAPSED_ROWS = 3;

/** One saved check as a single line: date · category · jurisdiction · codes. */
export function codeCheckRowLabel(rec: Pick<CodeCheckRecord, 'createdAt' | 'categoryLabel' | 'grounding'>): string {
  const g = rec.grounding;
  const authority = g?.authority ?? 'jurisdiction not on file';
  const codes = g?.codes ? ` · ${g.codes}` : '';
  return `${codeCheckDateLabel(rec.createdAt)} · ${rec.categoryLabel} · ${authority}${codes}`;
}

/** The first line of the result summary ('' when there is none). */
export function firstLine(s: string | null | undefined): string {
  return (s ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
}

export function ProjectCodeChecksCard({ project }: { project: Project }): React.ReactElement {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, checks } = useCodeChecks(project.id);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => (expanded ? checks : checks.slice(0, COLLAPSED_ROWS)), [checks, expanded]);
  const open = openId ? checks.find((c) => c.id === openId) ?? null : null;

  return (
    <View testID="codethread-project-card" style={styles.wrap}>
      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Code checks</Text>
          <Button
            label="Code check this job"
            size="sm"
            variant="secondary"
            testID="codethread-run-project"
            onPress={() => router.push(codeCheckRoute({ projectId: project.id, source: 'project' }))}
          />
        </View>

        {status === 'loading' ? null : status === 'failed' ? (
          <Text style={styles.note}>{CODE_CHECKS_FAILED_TEXT}</Text>
        ) : checks.length === 0 ? (
          <Text style={styles.note}>{CODE_CHECKS_EMPTY_TEXT}</Text>
        ) : (
          <View style={styles.list}>
            {shown.map((c) => (
              <Pressable
                key={c.id}
                testID={`codethread-check-row-${c.id}`}
                onPress={() => setOpenId(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open the saved check: ${codeCheckRowLabel(c)}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowMeta} numberOfLines={2}>{codeCheckRowLabel(c)}</Text>
                  {firstLine(c.result?.summary) ? (
                    <Text style={styles.rowSummary} numberOfLines={2}>{firstLine(c.result?.summary)}</Text>
                  ) : null}
                </View>
                <ChevronRight size={16} color={colors.textMuted} />
              </Pressable>
            ))}
            {!expanded && checks.length > COLLAPSED_ROWS ? (
              <Button
                label={`See all ${checks.length}`}
                size="sm"
                variant="ghost"
                testID="codethread-see-all"
                onPress={() => setExpanded(true)}
              />
            ) : null}
          </View>
        )}

        {status !== 'loading' ? <Text style={styles.caption}>{CODE_CHECKS_LOCAL_CAPTION}</Text> : null}
      </Card>

      {open ? (
        <SavedCodeCheckSheet
          record={open}
          project={project}
          visible={!!open}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginTop: 12 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
    heading: { ...Type.headline, color: t.text },
    note: { ...Type.subhead, color: t.textSecondary, marginTop: 10 },
    list: { marginTop: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    rowPressed: { opacity: 0.6 },
    rowBody: { flex: 1, gap: 2 },
    rowMeta: { ...Type.footnoteEmphasized, color: t.text },
    rowSummary: { ...Type.footnote, color: t.textSecondary },
    caption: { ...Type.footnote, color: t.textMuted, marginTop: 10 },
  });

export default ProjectCodeChecksCard;
