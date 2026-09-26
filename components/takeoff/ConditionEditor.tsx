// components/takeoff/ConditionEditor.tsx — the desktop takeoff's condition
// dialog (wave 4, lane T2). A condition is WHAT he measures ("LVT flooring",
// area, Flooring trade, 10% waste); measurements hang off it.
//
// MOUNTED ONLY WHILE OPEN. The parent renders `{editor ? <ConditionEditor/> : null}`.
// An open <Sheet> claims the hotkey registry's EXCLUSIVE dialog scope
// (hooks/useHotkeys header), so an always-mounted closed dialog would kill
// every canvas key. Unmounting on close hands the keys back.
//
// Pricing is the core's (utils/takeoff/conditions + utils/takeoffEstimate):
// the book rate for the trade he picks, or the $/unit he types — never an
// engine/catalog rate. The low–high band shows only when the spread was
// observed (spreadMeaningful), never manufactured from typed numbers.

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Square, Minus, Hash } from 'lucide-react-native';
import { Sheet } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys } from '@/hooks/useHotkeys';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { RateProvenanceChip } from '@/components/estimate/RateProvenanceChip';
import { priceTakeoff, tradesForUnit } from '@/utils/takeoffEstimate';
import type { CostDatabase } from '@/utils/costDatabase';
import { parseDecimalInput } from '@/utils/estimateLanding';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import {
  KIND_UNIT, defaultConditionColor,
  type ConditionKind, type TakeoffCondition,
} from '@/utils/takeoff/conditions';

const WASTE_OPTIONS = [0, 5, 10, 15, 20] as const;
type Waste = (typeof WASTE_OPTIONS)[number];

const KIND_OPTIONS: { kind: ConditionKind; label: string; Icon: typeof Square }[] = [
  { kind: 'area', label: 'Area', Icon: Square },
  { kind: 'linear', label: 'Linear', Icon: Minus },
  { kind: 'count', label: 'Count', Icon: Hash },
];

export interface ConditionEditorProps {
  /** The condition being edited; null = a new one. */
  condition: TakeoffCondition | null;
  /** The type a new condition starts as (the tool he pressed). */
  initialKind: ConditionKind;
  /** It has measurements — the type is locked. */
  hasMeasurements: boolean;
  /** A push already wrote an estimate line for it. */
  isPushed: boolean;
  db: CostDatabase;
  /** Colours already taken by other conditions (defaultConditionColor). */
  usedColors: readonly string[];
  onSave: (c: TakeoffCondition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const blankText = (n: number | null | undefined) => (n == null ? '' : String(n));

export default function ConditionEditor({
  condition, initialKind, hasMeasurements, isPushed, db, usedColors, onSave, onDelete, onClose,
}: ConditionEditorProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState(condition?.name ?? '');
  const [kind, setKind] = useState<ConditionKind>(condition?.kind ?? initialKind);
  const [trade, setTrade] = useState<string | null>(condition?.trade ?? null);
  const [rateText, setRateText] = useState(blankText(condition?.rateOverride));
  const [waste, setWaste] = useState<Waste>((condition?.wastePct ?? 10) as Waste);
  const [heightText, setHeightText] = useState(blankText(condition?.heightFt));

  const unit = KIND_UNIT[kind];
  const trades = useMemo(() => tradesForUnit(db, unit), [db, unit]);
  const bookPrice = useMemo(() => (trade ? priceTakeoff(db, trade, unit, 1) : null), [db, trade, unit]);
  const color = condition?.color ?? defaultConditionColor(name, trade, usedColors);

  const rate = rateText.trim() === '' ? null : parseDecimalInput(rateText);
  const height = heightText.trim() === '' ? null : parseDecimalInput(heightText);

  // Every blocked Save says why, in words.
  const reason = !name.trim()
    ? 'Give the condition a name.'
    : rateText.trim() !== '' && !(rate != null && rate > 0)
      ? 'The rate must be a dollar amount above zero, or blank to use your cost book.'
      : kind === 'linear' && heightText.trim() !== '' && !(height != null && height > 0)
        ? 'The height must be feet above zero, or blank.'
        : null;

  const save = useCallback(() => {
    if (reason) return;
    onSave({
      id: condition?.id ?? generateUUID(),
      name: name.trim(),
      kind,
      trade,
      rateOverride: rate != null && rate > 0 ? rate : null,
      wastePct: kind === 'count' ? 0 : waste,
      heightFt: kind === 'linear' && height != null && height > 0 ? height : null,
      color,
      createdAt: condition?.createdAt ?? new Date().toISOString(),
    });
  }, [reason, onSave, condition, name, kind, trade, rate, waste, height, color]);

  const confirmDelete = useCallback(() => {
    if (!condition) return;
    const stays = isPushed ? ' The estimate line stays — remove it in the estimate.' : '';
    showAlert('Delete condition?', `"${condition.name}" and its measurements come off this takeoff.${stays}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(condition.id) },
    ]);
  }, [condition, isPushed, onDelete]);

  // Enter saves; Esc closes. Dialog scope: only while this is mounted (open).
  useHotkeys([
    { combo: 'escape', handler: onClose, label: 'Close', group: 'Condition' },
    { combo: 'enter', handler: save, allowInInput: true, label: 'Save condition', group: 'Condition' },
  ], { scope: 'dialog' });

  const pickTrade = (label: string) => {
    setTrade((cur) => (cur === label ? null : label));
    if (!name.trim()) setName(label);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      size="dialog"
      title={condition ? 'Edit condition' : 'New condition'}
      primaryAction={{ label: 'Save', onPress: save, disabled: !!reason, disabledReason: reason ?? undefined, testID: 'takeoffws-editor-save' }}
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
      destructiveAction={condition ? { label: 'Delete', onPress: confirmDelete, testID: 'takeoffws-editor-delete' } : undefined}
      testID="takeoffws-editor"
    >
      <View style={styles.nameRow}>
        <View style={[styles.swatch, { backgroundColor: color }]} accessibilityLabel="Condition colour" />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. LVT flooring"
          placeholderTextColor={t.textMuted}
          style={styles.input}
          accessibilityLabel="Condition name"
          testID="takeoffws-editor-name"
        />
      </View>
      {!name.trim() && trades.length > 0 ? (
        <View style={styles.chips}>
          {trades.slice(0, 8).map((e) => (
            <Pressable key={`n-${e.key}`} onPress={() => pickTrade(e.trade)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Name it ${e.trade}`}>
              <Text style={styles.chipText} numberOfLines={1}>{e.trade}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>Type</Text>
      <View style={styles.segment}>
        {KIND_OPTIONS.map(({ kind: k, label, Icon }) => {
          const on = k === kind;
          const locked = hasMeasurements && !on;
          return (
            <Pressable
              key={k}
              onPress={() => { if (!hasMeasurements) { setKind(k); setTrade(null); } }}
              disabled={locked}
              style={[styles.segBtn, on && styles.segBtnOn, locked && styles.dim]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: locked }}
              testID={`takeoffws-editor-kind-${k}`}
            >
              <Icon size={14} color={on ? t.text : t.textMuted} strokeWidth={1.75} />
              <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hasMeasurements ? <Text style={styles.hint}>The type is locked — this condition already has measurements.</Text> : null}

      <Text style={styles.label}>Trade</Text>
      {trades.length > 0 ? (
        <View style={styles.chips}>
          {trades.map((e) => {
            const on = e.trade === trade;
            return (
              <Pressable key={e.key} onPress={() => pickTrade(e.trade)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{e.trade}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.hint}>{`Your cost book has no ${unit} trades yet — type a rate below.`}</Text>
      )}
      {bookPrice?.matched && bookPrice.rate != null ? (
        <View style={styles.bookRow}>
          <Text style={styles.bookRate}>{`${formatMoneyFull(bookPrice.rate)} / ${unit}`}</Text>
          <RateProvenanceChip entry={bookPrice.entry} />
          {bookPrice.spreadMeaningful && bookPrice.low != null && bookPrice.high != null ? (
            <Text style={styles.hint}>{`Observed ${formatMoneyFull(bookPrice.low)}–${formatMoneyFull(bookPrice.high)} / ${unit}`}</Text>
          ) : null}
        </View>
      ) : trade ? (
        <Text style={styles.hint}>{`No ${unit} rate for ${trade} in your book yet — type one below.`}</Text>
      ) : null}

      <Text style={styles.label}>{`Rate override ($ / ${unit})`}</Text>
      <TextInput
        value={rateText}
        onChangeText={setRateText}
        placeholder="Blank = use your cost book"
        placeholderTextColor={t.textMuted}
        keyboardType="decimal-pad"
        style={styles.input}
        accessibilityLabel="Rate override"
        testID="takeoffws-editor-rate"
      />

      {kind !== 'count' ? (
        <>
          <Text style={styles.label}>Waste</Text>
          <View style={styles.segment}>
            {WASTE_OPTIONS.map((w) => {
              const on = w === waste;
              return (
                <Pressable key={w} onPress={() => setWaste(w)} style={[styles.segBtn, on && styles.segBtnOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>{`${w}%`}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {kind === 'linear' ? (
        <>
          <Text style={styles.label}>Wall height, ft (optional)</Text>
          <TextInput
            value={heightText}
            onChangeText={setHeightText}
            placeholder="Shows wall SF beside the LF"
            placeholderTextColor={t.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
            accessibilityLabel="Wall height in feet"
          />
        </>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Layout.rowGap },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  input: {
    flex: 1,
    minHeight: Layout.control.input,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.bg,
    color: t.text,
    fontSize: Type.bodyCompact.fontSize,
  },
  label: { ...Type.caption1, color: t.textSecondary, fontWeight: '600', marginTop: Layout.groupGap, marginBottom: 6 },
  hint: { ...Type.caption1, color: t.textMuted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Layout.rowGap },
  chip: {
    height: 28,
    maxWidth: Layout.chip.maxWidth,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.xs,
    borderWidth: 1,
    borderColor: t.line,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: t.surfaceAlt, borderColor: t.textSecondary },
  chipText: { ...Type.caption1, color: t.textSecondary },
  chipTextOn: { color: t.text, fontWeight: '600' },
  segment: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm, overflow: 'hidden' },
  segBtn: { minWidth: 72, paddingHorizontal: 14, height: Layout.segment.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segBtnOn: { backgroundColor: t.surfaceAlt },
  segText: { ...Type.caption1, color: t.textMuted },
  segTextOn: { color: t.text, fontWeight: '600' },
  dim: { opacity: 0.4 },
  bookRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Layout.rowGap, marginTop: Layout.rowGap },
  bookRate: { ...Type.footnoteEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
});
