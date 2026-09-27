/**
 * ProjectCodeChecksCard — the job page's "Code checks": the checks he ran for
 * this job, each with its date, category, jurisdiction and edition, and a way
 * to run a new one for the job.
 *
 * HONESTY
 * - The caption under the list says where the checks are: on this device
 *   (erased on sign-out by the mageid_* sweep) or, once the account read and
 *   every push succeeded, on his account (CODE_CHECKS_CAPTION).
 * - An unreadable store says "Couldn't read…", never "No saved checks".
 * - A check with no jurisdiction on file says so instead of guessing one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ChevronRight } from 'lucide-react-native';
import CodeLookSheet from '@/components/codeLook/CodeLookSheet';
import { showAlert } from '@/utils/alert';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCodeChecks } from '@/hooks/useCodeChecks';
import { CODE_CHECKS_CAPTION } from '@/utils/codeThread/cloudSync';
import { codeCheckRoute } from '@/utils/codeThread/actions';
import type { CodeCheckRecord } from '@/utils/codeThread/types';
import type { Project } from '@/types';
import { codeCheckDateLabel } from './CodeThreadActions';
import { SavedCodeCheckSheet } from './SavedCodeCheckSheet';

export const CODE_CHECKS_FAILED_TEXT = 'Couldn’t read the saved checks on this device.';
export const CODE_CHECKS_EMPTY_TEXT =
  'No saved checks yet. A check you run for this job is saved here with its date, jurisdiction and edition.';
/** Where the saved checks are, by cloud-sync state. The map lives beside the
 *  state machine (utils/codeThread/cloudSync) so the saved-check sheet reads
 *  the same strings without importing this card. */
export { CODE_CHECKS_CAPTION };
/** The device-only line (kept for old imports). */
export const CODE_CHECKS_LOCAL_CAPTION = CODE_CHECKS_CAPTION.local;
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
  const { status, checks, syncState } = useCodeChecks(project.id);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // UX wave B7: "Check a photo" — the camera, then the shipped Photo Code Look
  // for this job (it asks for Pro itself when it runs).
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const checkAPhoto = useCallback(async () => {
    try {
      let res: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Camera access needed', 'Allow camera access in Settings to check a photo.'); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      }
      if (res.canceled || !res.assets[0]?.uri) return;
      setPhotoUri(res.assets[0].uri);
    } catch (e) {
      showAlert('Couldn\u2019t open the camera', String((e as Error)?.message ?? e));
    }
  }, []);

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
        <Button
          label="Check a photo"
          variant="secondary"
          fullWidth
          iconLeft={<Camera size={16} color={colors.text} strokeWidth={1.75} />}
          testID="codethread-check-photo"
          onPress={() => { void checkAPhoto(); }}
          containerStyle={styles.photoBtn}
        />

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

        {status !== 'loading' ? (
          <Text testID="codethread-sync-caption" style={styles.caption}>{CODE_CHECKS_CAPTION[syncState]}</Text>
        ) : null}
      </Card>

      {photoUri ? (
        <CodeLookSheet visible onClose={() => setPhotoUri(null)} project={project} photoUri={photoUri} />
      ) : null}
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
    photoBtn: { marginTop: 10 },
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
