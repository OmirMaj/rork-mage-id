// components/backcharge/BackchargeSheet.tsx — record one backcharge.
//
// MOUNT ONLY WHILE OPEN ({open ? <BackchargeSheet visible …/> : null}): the
// Sheet registers a dialog hotkey scope, which is exclusive — an always-mounted
// closed sheet would kill /sub-portal-setup's page keys.
//
// The photo is DURABLE ONLY. A bare picker URI is a blob: on web (dead on
// reload) and a cache file on iOS (purgeable), which would make "Photos
// available on request" false. So a taken/picked photo is saved as a job photo
// at once through addProjectPhoto (which stages the storage upload through the
// offline pipeline), and the backcharge keeps that photo's id. A punch item's
// photo is already durable on the punch item.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Check } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLaborRates } from '@/hooks/useLaborRates';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Sheet, Button, SegmentedControl } from '@/components/ui';
import { parseDecimalInput } from '@/utils/estimateLanding';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { amountFromHours, BackchargeHoursError, formatCents, type Backcharge } from '@/utils/backcharges';
import type { Commitment, Project, ProjectPhoto, Subcontractor } from '@/types';

export const NO_LABOR_RATE_TEXT = 'No labor rate on file — type the amount';

export interface BackchargeSheetProps {
  visible: boolean;
  project: Project;
  sub: Subcontractor;
  commitments: Commitment[];
  onClose: () => void;
  onSave: (b: Backcharge) => void;
}

type AmountMode = 'typed' | 'hours';

export function BackchargeSheet({ visible, project, sub, commitments, onClose, onSave }: BackchargeSheetProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { addProjectPhoto, getPunchItemsForProject } = useProjects();
  const { rates } = useLaborRates();

  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<AmountMode>('typed');
  const [amountText, setAmountText] = useState('');
  const [hoursText, setHoursText] = useState('');
  const rateKeys = useMemo(() => Object.keys(rates).sort((a, b) => (a === 'general' ? -1 : b === 'general' ? 1 : a.localeCompare(b))), [rates]);
  const [rateKey, setRateKey] = useState<string | null>(null);
  const activeRateKey = rateKey && rates[rateKey] ? rateKey : rateKeys[0] ?? null;
  const rateCents = activeRateKey ? Math.round(rates[activeRateKey] * 100) : null;
  const [photo, setPhoto] = useState<{ uri: string; photoId: string | null; punchItemId: string | null } | null>(null);
  const [commitmentId, setCommitmentId] = useState<string | null>(commitments.length === 1 ? commitments[0].id : null);

  const punchWithPhotos = useMemo(() => {
    const all = getPunchItemsForProject(project.id).filter(p => !!p.photoUri);
    const byId = all.filter(p => p.assignedSubId === sub.id);
    if (byId.length > 0) return byId;
    const name = sub.companyName.trim().toLowerCase();
    return all.filter(p => !p.assignedSubId && (p.assignedSub ?? '').trim().toLowerCase() === name);
  }, [getPunchItemsForProject, project.id, sub.id, sub.companyName]);

  // ── The amount, in integer cents, or the words for why there is none ────
  const amount = useMemo((): { cents: number | null; why: string | null; hours: number | null } => {
    if (mode === 'typed') {
      const n = parseDecimalInput(amountText);
      if (n == null) return { cents: null, why: 'Type the amount.', hours: null };
      const cents = Math.round(n * 100);
      return cents > 0 ? { cents, why: null, hours: null } : { cents: null, why: 'The amount must be more than $0.', hours: null };
    }
    if (rateCents == null) return { cents: null, why: `${NO_LABOR_RATE_TEXT}.`, hours: null };
    const h = parseDecimalInput(hoursText);
    if (h == null) return { cents: null, why: 'Type the hours.', hours: null };
    try {
      return { cents: amountFromHours(h, rateCents), why: null, hours: h };
    } catch (e) {
      return { cents: null, why: e instanceof BackchargeHoursError ? e.message : 'Check the hours.', hours: null };
    }
  }, [mode, amountText, hoursText, rateCents]);

  const missing = !reason.trim() ? 'Add a reason.' : amount.why;

  const takePhoto = useCallback(async () => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert('Camera access needed', 'Open Settings, then MAGE ID, then Camera to allow it.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false, exif: false });
      }
      const uri = !result.canceled ? result.assets?.[0]?.uri : undefined;
      if (!uri) return;
      // Durable first: the picker URI becomes a job photo before the
      // backcharge ever refers to it.
      const now = new Date().toISOString();
      const saved: ProjectPhoto = {
        id: generateUUID(),
        projectId: project.id,
        uri,
        timestamp: now,
        tag: 'Backcharge',
        location: `Backcharge — ${sub.companyName}${reason.trim() ? `: ${reason.trim()}` : ''}`,
        createdAt: now,
      };
      addProjectPhoto(saved);
      setPhoto({ uri: saved.uri, photoId: saved.id, punchItemId: null });
    } catch {
      showAlert('Could not attach the photo', 'Try again, or pick one from a punch item.');
    }
  }, [addProjectPhoto, project.id, sub.companyName, reason]);

  const save = useCallback(() => {
    if (missing || amount.cents == null) return;
    const b: Backcharge = {
      id: generateUUID(),
      projectId: project.id,
      subId: sub.id,
      subName: sub.companyName,
      commitmentId,
      reason: reason.trim(),
      amountCents: amount.cents,
      basis: mode === 'hours' ? 'hours_x_rate' : 'typed',
      hours: mode === 'hours' ? amount.hours : null,
      rateCents: mode === 'hours' ? rateCents : null,
      photoUri: photo?.uri ?? null,
      photoId: photo?.photoId ?? null,
      punchItemId: photo?.punchItemId ?? null,
      status: 'open',
      appliedInvoiceId: null,
      appliedAt: null,
      createdAt: new Date().toISOString(),
    };
    onSave(b);
  }, [missing, amount, project.id, sub, commitmentId, reason, mode, rateCents, photo, onSave]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Backcharge ${sub.companyName}`}
      subtitle="Saved on this device until you sign out. Nothing is sent to the sub."
      testID="backcharge-sheet"
      primaryAction={{
        label: amount.cents != null ? `Save ${formatCents(amount.cents)}` : 'Save',
        onPress: save,
        disabled: !!missing,
        disabledReason: missing ?? undefined,
        testID: 'backcharge-save',
      }}
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
    >
      <Text style={styles.label}>Reason</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Cleanup after drywall — 2 dumpsters of debris"
        placeholderTextColor={t.textMuted}
        style={styles.input}
        testID="backcharge-reason"
      />

      <Text style={styles.label}>Amount</Text>
      <SegmentedControl
        options={[
          { value: 'typed', label: 'Type $' },
          { value: 'hours', label: 'Hours × your labor rate', disabled: rateCents == null },
        ]}
        value={mode}
        onChange={(v) => setMode(v as AmountMode)}
      />
      {rateCents == null ? <Text style={styles.muted} testID="backcharge-no-rate">{NO_LABOR_RATE_TEXT}.</Text> : null}
      {mode === 'typed' ? (
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="$0.00"
          placeholderTextColor={t.textMuted}
          keyboardType="decimal-pad"
          style={styles.input}
          testID="backcharge-amount"
        />
      ) : (
        <View>
          {rateKeys.length > 1 ? (
            <View style={styles.chips}>
              {rateKeys.map(k => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setRateKey(k)}
                  style={[styles.chip, k === activeRateKey && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: k === activeRateKey }}
                >
                  <Text style={styles.chipText}>{k} · {formatCents(Math.round(rates[k] * 100))}/h</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <TextInput
            value={hoursText}
            onChangeText={setHoursText}
            placeholder="Hours"
            placeholderTextColor={t.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
            testID="backcharge-hours"
          />
          {rateCents != null ? (
            <Text style={styles.muted}>
              At your {activeRateKey} rate, {formatCents(rateCents)}/h
              {amount.cents != null ? ` → ${formatCents(amount.cents)}` : ''}
            </Text>
          ) : null}
        </View>
      )}

      <Text style={styles.label}>Photo</Text>
      {photo ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel="Backcharge photo" />
          <Text style={styles.muted}>
            {photo.photoId ? 'Saved to this job’s photos.' : 'From the punch item’s photo.'}
          </Text>
        </View>
      ) : null}
      <Button
        label={photo ? 'Replace photo' : 'Take / pick a photo'}
        variant="secondary"
        size="sm"
        onPress={() => { void takePhoto(); }}
        iconLeft={<Camera size={14} color={t.text} strokeWidth={1.75} />}
        testID="backcharge-photo"
      />
      {punchWithPhotos.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.muted}>Or use a photo from one of {sub.companyName}’s punch items:</Text>
          {punchWithPhotos.slice(0, 8).map(p => {
            const on = photo?.punchItemId === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => setPhoto({ uri: p.photoUri as string, photoId: null, punchItemId: p.id })}
                style={styles.pickRow}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`backcharge-punch-${p.id}`}
              >
                {on ? <Check size={14} color={t.text} strokeWidth={1.75} /> : null}
                <Text style={styles.pickText} numberOfLines={1}>{p.description}{p.location ? ` · ${p.location}` : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {commitments.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.label}>Against commitment (optional)</Text>
          <View style={styles.chips}>
            {commitments.map(c => (
              <TouchableOpacity
                key={c.id}
                onPress={() => setCommitmentId(commitmentId === c.id ? null : c.id)}
                style={[styles.chip, commitmentId === c.id && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: commitmentId === c.id }}
              >
                <Text style={styles.chipText} numberOfLines={1}>#{c.number} {c.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

export default BackchargeSheet;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  label: { ...Type.footnoteEmphasized, color: t.textSecondary, marginTop: 14, marginBottom: 6 },
  input: {
    ...Type.body, color: t.text,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
  },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line },
  chipOn: { borderColor: t.text },
  chipText: { ...Type.footnote, color: t.text },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: Tokens.radius.sm },
  block: { marginTop: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  pickText: { ...Type.footnote, color: t.text, flex: 1 },
});
