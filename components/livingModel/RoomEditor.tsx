// components/livingModel/RoomEditor.tsx — make a job model without a scan.
//
// The Living Model, Phase 1. Add a rectangular room by typing its name, width,
// length and ceiling height. Drag it on a floor plan that snaps every six
// inches. Turn it a quarter turn. Tap a wall and type a width to add a door or
// a window. Duplicate, delete, undo and redo. "Add from Scan" lists the scans
// saved for this project on this device and drops one in as a placed room.
//
// EVERY CHANGE IS A TAP OR A DRAG BY THE PERSON. This file never moves, sizes
// or names a room on its own. Each change goes up through `onChange` and the
// screen records it for undo.
//
// REACHABLE WITHOUT A POINTER. Everything a drag or a tap on the plan does can
// also be done from the buttons beside it: the room list selects, the four
// Move buttons nudge one grid step, and each wall has its own Add Door and Add
// Window buttons.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, DoorOpen, Plus, Redo2, RotateCw, ScanLine, Trash2, Undo2, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Sheet } from '@/components/ui';
import {
  MAX_ROOMS, addOpening, addRoom, deleteRoom, duplicateRoom, makeRectRoom, modelBounds, modelLevels, moveRoom, nextFreeSpot, nudgeRoom,
  openingRefusal, rectRoomRefusal, removeOpening, roomAreaM2, roomAtPoint, roomBounds, roomFromScan, rotateRoom, validateModel, wallNearPoint,
  type OpeningRefusal, type RectRoomRefusal,
} from '@/utils/livingModel/modelCore';
import { mixHex } from '@/utils/livingModel/palette';
import { fitPlanView, toMetres, type PlanView } from '@/utils/livingModel/planView';
import { loadProjectScans } from '@/utils/livingModel/store';
import { ROOM_KINDS, type JobModel, type PlacedRoom, type RoomKind } from '@/utils/livingModel/types';
import type { SavedScan } from '@/utils/roomScan/storeCore';
import { formatFeetInches, formatSqFt, parseTapeMeasure, sqMetresToSqFeet } from '@/utils/roomScan/units';
import { ModelPlan } from './ModelPlan';
import { makeLivingModelStyles } from './styles';

let idSeq = 0;
/** A new id for a room or an opening. Unique on this device, which is all the model needs. */
export function newModelId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface RoomEditorProps {
  projectId: string;
  model: JobModel;
  onChange: (next: JobModel) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedId: string | null;
  onSelect: (roomId: string | null) => void;
  level: number;
  onLevel: (level: number) => void;
  wide: boolean;
  /** Drawn under the plan: the lines every view of the model carries. */
  footer?: React.ReactNode;
}

type OpeningDraft = { roomId: string; wallId: string; kind: 'door' | 'window'; centreAlongM?: number };

export function RoomEditor({ projectId, model, onChange, onUndo, onRedo, canUndo, canRedo, selectedId, onSelect, level, onLevel, wide, footer }: RoomEditorProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const [boxW, setBoxW] = useState(0);
  const [drag, setDrag] = useState<JobModel | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [opening, setOpening] = useState<OpeningDraft | null>(null);
  const [wallId, setWallId] = useState<string | null>(null);

  const shown = drag ?? model;
  const levels = useMemo(() => modelLevels(model), [model]);
  const selected = useMemo(() => shown.rooms.find((r) => r.id === selectedId) ?? null, [shown, selectedId]);
  const check = useMemo(() => validateModel(shown), [shown]);
  const boxH = Math.max(260, Math.min(560, Math.round(boxW * (wide ? 0.62 : 0.8))));

  // The view is worked out from the model as it was when a drag began, so the floor does not slide under the finger.
  const liveView = useMemo<PlanView>(() => fitPlanView(modelBounds(model, level), Math.max(1, boxW), boxH, 1.2), [model, level, boxW, boxH]);
  const viewRef = useRef(liveView);
  if (!drag) viewRef.current = liveView;
  const view = viewRef.current;

  const modelRef = useRef(model);
  modelRef.current = model;
  const levelRef = useRef(level);
  levelRef.current = level;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const gesture = useRef<{ roomId: string | null; startX: number; startY: number; px: { x: number; y: number }; moved: boolean }>({ roomId: null, startX: 0, startY: 0, px: { x: 0, y: 0 }, moved: false });

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const px = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      const hit = roomAtPoint(modelRef.current, levelRef.current, toMetres(viewRef.current, px));
      const b = hit ? roomBounds(hit) : null;
      gesture.current = { roomId: hit?.id ?? null, startX: b?.minX ?? 0, startY: b?.minY ?? 0, px, moved: false };
    },
    onPanResponderMove: (_e, g) => {
      const cur = gesture.current;
      if (!cur.roomId || (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4 && !cur.moved)) return;
      cur.moved = true;
      const s = viewRef.current.scale;
      setDrag(moveRoom(modelRef.current, cur.roomId, cur.startX + g.dx / s, cur.startY + g.dy / s));
    },
    onPanResponderRelease: (_e, g) => {
      const cur = gesture.current;
      if (cur.moved && cur.roomId) {
        const s = viewRef.current.scale;
        const next = moveRoom(modelRef.current, cur.roomId, cur.startX + g.dx / s, cur.startY + g.dy / s);
        setDrag(null);
        onSelectRef.current(cur.roomId);
        const before = modelRef.current.rooms.find((r) => r.id === cur.roomId);
        const after = next.rooms.find((r) => r.id === cur.roomId);
        if (before && after && (before.placement.xM !== after.placement.xM || before.placement.yM !== after.placement.yM)) onChangeRef.current(next);
        return;
      }
      setDrag(null);
      // A tap. On the selected room, near a wall: that wall. Otherwise select what was tapped.
      const m = toMetres(viewRef.current, cur.px);
      const sel = modelRef.current.rooms.find((r) => r.id === selectedRef.current && r.level === levelRef.current);
      const near = sel ? wallNearPoint(sel, m, 14 / viewRef.current.scale) : null;
      if (sel && near) {
        setWallId(near.wallId);
        setOpening({ roomId: sel.id, wallId: near.wallId, kind: 'door', centreAlongM: near.alongM });
        return;
      }
      setWallId(null);
      onSelectRef.current(cur.roomId);
    },
    onPanResponderTerminate: () => setDrag(null),
  }), []);
  useEffect(() => { setWallId(null); }, [selectedId]);

  const onBox = useCallback((e: LayoutChangeEvent) => setBoxW(Math.round(e.nativeEvent.layout.width)), []);
  const fillFor = useCallback((roomId: string) => (roomId === selectedId ? mixHex(colors.surface, colors.accent, 0.22) : colors.surface), [selectedId, colors]);
  const subFor = useCallback((roomId: string) => {
    const r = shown.rooms.find((x) => x.id === roomId);
    const b = r ? roomBounds(r) : null;
    return b ? copy.roomSizeSub(formatFeetInches(b.maxX - b.minX), formatFeetInches(b.maxY - b.minY), null) : null;
  }, [shown, copy]);

  const atLimit = model.rooms.length >= MAX_ROOMS;
  const roomName = (id: string) => shown.rooms.find((r) => r.id === id)?.name ?? '';

  return (
    <View style={wide ? styles.bodyWide : styles.stack} testID="living-model-editor">
      <View style={wide ? styles.colMain : styles.stack}>
        <View style={styles.toolbar}>
          <ToolButton label={copy.addRoomLabel} icon={<Plus size={16} color={colors.text} />} onPress={() => setAddOpen(true)} disabled={atLimit} testID="lm-add-room" />
          <ToolButton label={copy.addFromScanLabel} icon={<ScanLine size={16} color={colors.text} />} onPress={() => setScanOpen(true)} disabled={atLimit} testID="lm-add-scan" />
          <ToolButton label={copy.undoLabel} icon={<Undo2 size={16} color={colors.text} />} onPress={onUndo} disabled={!canUndo} testID="lm-undo" />
          <ToolButton label={copy.redoLabel} icon={<Redo2 size={16} color={colors.text} />} onPress={onRedo} disabled={!canRedo} testID="lm-redo" />
        </View>
        {levels.length > 1 ? (
          <View style={styles.chips} accessibilityRole="tablist">
            {levels.map((l) => (
              <Pressable key={l} style={[styles.chip, l === level && styles.chipOn]} onPress={() => onLevel(l)} accessibilityRole="tab" accessibilityState={{ selected: l === level }} accessibilityLabel={copy.levelName(l)} testID={`lm-level-${l}`}>
                <Text style={[styles.chipText, l === level && styles.chipTextOn]}>{copy.levelName(l)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.planBox} onLayout={onBox} testID="lm-plan-box">
          {boxW > 0 ? (
            <View {...pan.panHandlers} accessible accessibilityRole="image" accessibilityLabel={copy.planA11yLabel} testID="lm-plan">
              <ModelPlan model={shown} level={level} view={view} fillFor={fillFor} subFor={subFor} selectedId={selectedId} selectedWallId={wallId} showGrid />
            </View>
          ) : null}
          {model.rooms.length === 0 ? (
            <View style={[styles.empty, { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }]} pointerEvents="none">
              <Text style={styles.emptyName}>{copy.emptyTitleLabel}</Text>
              <Text style={[styles.para, { textAlign: 'center' }]}>{copy.emptyBody}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.note}>{copy.dragHelpSub}</Text>
        {check.warnings.filter((w) => w.code === 'rooms_overlap').map((w) => (
          <Text key={w.roomIds.join('|')} style={styles.warn} testID="lm-overlap">{copy.overlapBody(roomName(w.roomIds[0]), roomName(w.roomIds[1]))}</Text>
        ))}
        {check.warnings.filter((w) => w.code === 'outline_open').map((w) => (
          <Text key={`open-${w.roomIds[0]}`} style={styles.warn}>{copy.outlineOpenBody(roomName(w.roomIds[0]))}</Text>
        ))}
        {atLimit ? <Text style={styles.note}>{copy.roomLimitBody}</Text> : null}
        <Text style={styles.note} testID="lm-saved-local">{copy.savedLocalBody}</Text>
        {footer}
      </View>

      <View style={wide ? styles.colSide : styles.stack}>
        {selected ? (
          <SelectedRoomPanel
            room={selected}
            wallId={wallId}
            onWall={setWallId}
            onRotate={() => onChange(rotateRoom(model, selected.id))}
            onDuplicate={() => {
              const id = newModelId('room');
              const next = duplicateRoom(model, selected.id, id, copy.copyName(selected.name));
              if (next !== model) { onChange(next); onSelect(id); }
            }}
            onDelete={() => { onChange(deleteRoom(model, selected.id)); onSelect(null); }}
            onNudge={(dx, dy) => onChange(nudgeRoom(model, selected.id, dx, dy))}
            onAddOpening={(wId, kind) => setOpening({ roomId: selected.id, wallId: wId, kind })}
            onRemoveOpening={(openingId) => onChange(removeOpening(model, selected.id, openingId))}
            canDuplicate={!atLimit}
          />
        ) : null}
        <View style={styles.panel}>
          <Text style={styles.panelHeading}>{copy.roomsHeadingLabel}</Text>
          {model.rooms.length === 0 ? <Text style={styles.note}>{copy.emptyBody}</Text> : null}
          {model.rooms.map((r, i) => {
            const on = r.id === selectedId;
            const b = roomBounds(r);
            const area = roomAreaM2(r);
            return (
              <Pressable
                key={r.id}
                style={[styles.row, i === 0 && styles.rowFirst, on && styles.rowOn]}
                onPress={() => { onLevel(r.level); onSelect(on ? null : r.id); }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={r.name}
                testID={`lm-room-row-${i}`}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {`${copy.kindName(r.kind)} · ${b ? copy.roomSizeSub(formatFeetInches(b.maxX - b.minX), formatFeetInches(b.maxY - b.minY), area != null ? formatSqFt(sqMetresToSqFeet(area)) : null) : ''}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AddRoomSheet
        visible={addOpen}
        defaultLevel={level}
        onClose={() => setAddOpen(false)}
        onAdd={(input) => {
          const id = newModelId('room');
          const spot = nextFreeSpot(model, input.level);
          const next = addRoom(model, makeRectRoom({ ...input, id, placement: { xM: spot.xM, yM: spot.yM, rotationDeg: 0 } }));
          if (next !== model) { onChange(next); onLevel(input.level); onSelect(id); }
          setAddOpen(false);
        }}
      />
      <AddOpeningSheet
        draft={opening}
        model={model}
        onClose={() => setOpening(null)}
        onKind={(kind) => setOpening((d) => (d ? { ...d, kind } : d))}
        onAdd={(widthM) => {
          if (!opening) return;
          const next = addOpening(model, { ...opening, widthM, id: newModelId('open') });
          if (next !== model) onChange(next);
          setOpening(null);
        }}
      />
      <ScanSheet
        visible={scanOpen}
        projectId={projectId}
        onClose={() => setScanOpen(false)}
        onPick={(saved) => {
          const id = newModelId('room');
          const spot = nextFreeSpot(model, level);
          const placed = roomFromScan(saved.scan, { id, level, placement: spot });
          // A scan he never named is listed as Unnamed Scan; the app does not make up a room name for it.
          const next = addRoom(model, placed.name.trim() ? placed : { ...placed, name: copy.scanUnnamedLabel });
          if (next !== model) { onChange(next); onSelect(id); }
          setScanOpen(false);
        }}
      />
    </View>
  );
}

function ToolButton({ label, icon, onPress, disabled, on, testID }: { label: string; icon?: React.ReactNode; onPress: () => void; disabled?: boolean; on?: boolean; testID?: string }) {
  const styles = useThemedStyles(makeLivingModelStyles);
  return (
    <Pressable
      style={[styles.toolBtn, on && styles.toolBtnOn, disabled && styles.toolBtnOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!on }}
      testID={testID}
    >
      {icon}
      <Text style={[styles.toolBtnText, on && styles.toolBtnTextOn]}>{label}</Text>
    </Pressable>
  );
}
export { ToolButton };

function SelectedRoomPanel(p: {
  room: PlacedRoom;
  wallId: string | null;
  onWall: (id: string | null) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNudge: (dx: number, dy: number) => void;
  onAddOpening: (wallId: string, kind: 'door' | 'window') => void;
  onRemoveOpening: (openingId: string) => void;
  canDuplicate: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const { room } = p;
  const b = roomBounds(room);
  const area = roomAreaM2(room);
  return (
    <View style={styles.panel} testID="lm-selected">
      <Text style={styles.panelHeading}>{room.name}</Text>
      <Text style={styles.rowSub}>
        {`${copy.kindName(room.kind)} · ${copy.levelName(room.level)}${b ? ` · ${copy.roomSizeSub(formatFeetInches(b.maxX - b.minX), formatFeetInches(b.maxY - b.minY), area != null ? formatSqFt(sqMetresToSqFeet(area)) : null)}` : ''}`}
      </Text>
      {room.source === 'scan' ? <Text style={styles.warn} testID="lm-scan-caveat">{copy.scanCaveatBody}</Text> : null}
      <View style={styles.toolbar}>
        <ToolButton label={copy.rotateLabel} icon={<RotateCw size={16} color={colors.text} />} onPress={p.onRotate} testID="lm-rotate" />
        <ToolButton label={copy.duplicateLabel} icon={<Copy size={16} color={colors.text} />} onPress={p.onDuplicate} disabled={!p.canDuplicate} testID="lm-duplicate" />
        <ToolButton label={copy.deleteLabel} icon={<Trash2 size={16} color={colors.text} />} onPress={p.onDelete} testID="lm-delete" />
      </View>
      <View style={styles.toolbar}>
        <IconButton label={copy.moveLeftLabel} onPress={() => p.onNudge(-1, 0)} testID="lm-nudge-left"><ArrowLeft size={16} color={colors.text} /></IconButton>
        <IconButton label={copy.moveRightLabel} onPress={() => p.onNudge(1, 0)} testID="lm-nudge-right"><ArrowRight size={16} color={colors.text} /></IconButton>
        <IconButton label={copy.moveUpLabel} onPress={() => p.onNudge(0, -1)} testID="lm-nudge-up"><ArrowUp size={16} color={colors.text} /></IconButton>
        <IconButton label={copy.moveDownLabel} onPress={() => p.onNudge(0, 1)} testID="lm-nudge-down"><ArrowDown size={16} color={colors.text} /></IconButton>
      </View>
      <Text style={styles.eyebrow}>{copy.wallsHeadingLabel}</Text>
      <Text style={styles.note}>{copy.wallHelpBody}</Text>
      {room.room.walls.map((w, i) => {
        const on = w.id === p.wallId;
        const holes = room.room.openings.filter((o) => o.wallId === w.id);
        return (
          <View key={w.id} style={[styles.row, i === 0 && styles.rowFirst, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
            <View style={styles.hudRow}>
              <Pressable style={styles.rowMain} onPress={() => p.onWall(on ? null : w.id)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={copy.wallName(i + 1)} testID={`lm-wall-${i}`}>
                <Text style={[styles.rowLabel, on && { color: colors.accentLabel }]}>{copy.wallName(i + 1)}</Text>
                <Text style={styles.rowSub}>{formatFeetInches(w.lengthM)}</Text>
              </Pressable>
              <ToolButton label={copy.addDoorLabel} icon={<DoorOpen size={14} color={colors.text} />} onPress={() => { p.onWall(w.id); p.onAddOpening(w.id, 'door'); }} testID={`lm-add-door-${i}`} />
              <ToolButton label={copy.addWindowLabel} onPress={() => { p.onWall(w.id); p.onAddOpening(w.id, 'window'); }} testID={`lm-add-window-${i}`} />
            </View>
            {holes.map((o) => {
              const what = o.kind === 'window' ? copy.windowSub(formatFeetInches(o.widthM)) : copy.doorSub(formatFeetInches(o.widthM));
              return (
                <View key={o.id} style={styles.legendItem}>
                  <Text style={styles.rowSub}>{what}</Text>
                  {room.source === 'typed' ? (
                    <Pressable onPress={() => p.onRemoveOpening(o.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={copy.removeOpeningA11yLabel(what)} testID={`lm-remove-opening-${o.id}`}>
                      <X size={14} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function IconButton({ label, onPress, children, testID }: { label: string; onPress: () => void; children: React.ReactNode; testID?: string }) {
  const styles = useThemedStyles(makeLivingModelStyles);
  return (
    <Pressable style={styles.iconBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      {children}
    </Pressable>
  );
}

function AddRoomSheet({ visible, defaultLevel, onClose, onAdd }: {
  visible: boolean;
  defaultLevel: number;
  onClose: () => void;
  onAdd: (input: { name: string; kind: RoomKind; widthM: number; lengthM: number; heightM: number; level: number }) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RoomKind>('other');
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [height, setHeight] = useState('');
  const [levelText, setLevelText] = useState(defaultLevel);
  const [problem, setProblem] = useState<RectRoomRefusal | 'unreadable' | null>(null);
  useEffect(() => {
    if (visible) { setName(''); setKind('other'); setWidth(''); setLength(''); setHeight(''); setLevelText(defaultLevel); setProblem(null); }
  }, [visible, defaultLevel]);

  const submit = () => {
    const widthM = parseTapeMeasure(width);
    const lengthM = parseTapeMeasure(length);
    const heightM = parseTapeMeasure(height);
    if (!name.trim()) { setProblem('name_missing'); return; }
    if (widthM == null || lengthM == null || heightM == null) { setProblem('unreadable'); return; }
    const input = { name, kind, widthM, lengthM, heightM, level: levelText };
    const refusal = rectRoomRefusal(input);
    if (refusal) { setProblem(refusal); return; }
    onAdd(input);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={copy.addRoomLabel}
      primaryAction={{ label: copy.addRoomLabel, onPress: submit, testID: 'lm-add-room-save' }}
      secondaryAction={{ label: copy.cancelLabel, onPress: onClose }}
      testID="lm-add-room-sheet"
    >
      <View style={styles.sheetBody}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{copy.roomNameLabel}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={copy.roomNamePlaceholder} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.roomNameLabel} testID="lm-room-name" />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{copy.kindLabel}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={copy.kindLabel}>
            {ROOM_KINDS.map((k) => (
              <Pressable key={k} style={[styles.chip, k === kind && styles.chipOn]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ checked: k === kind }} accessibilityLabel={copy.kindName(k)} testID={`lm-kind-${k}`}>
                <Text style={[styles.chipText, k === kind && styles.chipTextOn]}>{copy.kindName(k)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldCell}>
            <Text style={styles.fieldLabel}>{copy.widthLabel}</Text>
            <TextInput style={styles.input} value={width} onChangeText={setWidth} placeholder={copy.sizePlaceholder} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.widthLabel} testID="lm-room-width" />
          </View>
          <View style={styles.fieldCell}>
            <Text style={styles.fieldLabel}>{copy.lengthLabel}</Text>
            <TextInput style={styles.input} value={length} onChangeText={setLength} placeholder={copy.sizePlaceholder} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.lengthLabel} testID="lm-room-length" />
          </View>
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldCell}>
            <Text style={styles.fieldLabel}>{copy.ceilingLabel}</Text>
            <TextInput style={styles.input} value={height} onChangeText={setHeight} placeholder={copy.ceilingPlaceholder} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.ceilingLabel} testID="lm-room-height" />
          </View>
          <View style={styles.fieldCell}>
            <Text style={styles.fieldLabel}>{copy.floorLabel}</Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={copy.floorLabel}>
              {[-1, 0, 1, 2].map((l) => (
                <Pressable key={l} style={[styles.chip, l === levelText && styles.chipOn]} onPress={() => setLevelText(l)} accessibilityRole="radio" accessibilityState={{ checked: l === levelText }} accessibilityLabel={copy.levelName(l)} testID={`lm-room-level-${l}`}>
                  <Text style={[styles.chipText, l === levelText && styles.chipTextOn]}>{copy.levelName(l)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        {problem ? <Text style={styles.warn} testID="lm-room-problem">{copy.roomRefusalBody(problem)}</Text> : null}
      </View>
    </Sheet>
  );
}

function AddOpeningSheet({ draft, model, onClose, onKind, onAdd }: {
  draft: OpeningDraft | null;
  model: JobModel;
  onClose: () => void;
  onKind: (kind: 'door' | 'window') => void;
  onAdd: (widthM: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const [width, setWidth] = useState('');
  const [problem, setProblem] = useState<OpeningRefusal | 'unreadable' | null>(null);
  const open = !!draft;
  useEffect(() => { if (open) { setWidth(''); setProblem(null); } }, [open, draft?.wallId]);
  const room = draft ? model.rooms.find((r) => r.id === draft.roomId) : undefined;
  const wallIndex = room && draft ? room.room.walls.findIndex((w) => w.id === draft.wallId) : -1;
  const wall = room && wallIndex >= 0 ? room.room.walls[wallIndex] : undefined;
  const kind = draft?.kind ?? 'door';

  const submit = () => {
    if (!draft) return;
    const widthM = parseTapeMeasure(width);
    if (widthM == null) { setProblem('unreadable'); return; }
    const refusal = openingRefusal(model, { ...draft, widthM });
    if (refusal) { setProblem(refusal); return; }
    onAdd(widthM);
  };

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title={kind === 'window' ? copy.windowTitleLabel : copy.doorTitleLabel}
      primaryAction={{ label: kind === 'window' ? copy.addWindowLabel : copy.addDoorLabel, onPress: submit, testID: 'lm-opening-save' }}
      secondaryAction={{ label: copy.cancelLabel, onPress: onClose }}
      testID="lm-opening-sheet"
    >
      <View style={styles.sheetBody}>
        {wall ? <Text style={styles.para}>{copy.openingOnWallBody(copy.wallName(wallIndex + 1), formatFeetInches(wall.lengthM))}</Text> : null}
        <View style={styles.chips} accessibilityRole="radiogroup">
          {(['door', 'window'] as const).map((k) => (
            <Pressable key={k} style={[styles.chip, k === kind && styles.chipOn]} onPress={() => onKind(k)} accessibilityRole="radio" accessibilityState={{ checked: k === kind }} accessibilityLabel={k === 'door' ? copy.addDoorLabel : copy.addWindowLabel} testID={`lm-opening-kind-${k}`}>
              <Text style={[styles.chipText, k === kind && styles.chipTextOn]}>{k === 'door' ? copy.addDoorLabel : copy.addWindowLabel}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{copy.openingWidthLabel}</Text>
          <TextInput style={styles.input} value={width} onChangeText={setWidth} placeholder={kind === 'window' ? copy.windowPlaceholder : copy.doorPlaceholder} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.openingWidthLabel} testID="lm-opening-width" />
        </View>
        {problem ? <Text style={styles.warn} testID="lm-opening-problem">{copy.openingRefusalBody(problem)}</Text> : null}
      </View>
    </Sheet>
  );
}

function ScanSheet({ visible, projectId, onClose, onPick }: { visible: boolean; projectId: string; onClose: () => void; onPick: (saved: SavedScan) => void }) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const [scans, setScans] = useState<SavedScan[] | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setScans(null);
    void loadProjectScans(projectId).then((list) => { if (alive) setScans(list); });
    return () => { alive = false; };
  }, [visible, projectId]);
  return (
    <Sheet visible={visible} onClose={onClose} title={copy.scanSheetTitleLabel} secondaryAction={{ label: copy.cancelLabel, onPress: onClose }} testID="lm-scan-sheet">
      <View style={styles.sheetBody}>
        {scans && scans.length === 0 ? <Text style={styles.para} testID="lm-no-scans">{copy.noScansBody}</Text> : null}
        {(scans ?? []).map((s, i) => (
          <Pressable key={s.scan.id} style={[styles.row, i === 0 && styles.rowFirst]} onPress={() => onPick(s)} accessibilityRole="button" accessibilityLabel={s.scan.name || copy.scanUnnamedLabel} testID={`lm-scan-row-${i}`}>
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel}>{s.scan.name || copy.scanUnnamedLabel}</Text>
              <Text style={styles.rowSub}>{copy.scanRowSub(new Date(s.scan.capturedAt).toLocaleDateString(), s.scan.walls.filter((w) => w.onOutline).length)}</Text>
            </View>
          </Pressable>
        ))}
        {scans && scans.length > 0 ? <Text style={styles.warn}>{copy.scanCaveatBody}</Text> : null}
      </View>
    </Sheet>
  );
}
