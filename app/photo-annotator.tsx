// Photo annotator — homeowner-grade markup tool nobody else in the
// residential space ships well. Lets the GC (or sub) drop arrows,
// circles, freehand strokes, and text labels on a photo so "fix the
// gap here" stops being a 5-message text thread.
//
// Markup is stored as normalized {x: 0..1, y: 0..1} coordinates so the
// same overlay re-renders cleanly at any display size — phone, tablet,
// or the static portal.

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, PanResponder, Alert, ScrollView, TextInput, } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ArrowRight, Circle as CircleIcon, Pen, Type as TypeIcon, Undo2, Trash2, Check, X } from 'lucide-react-native';
import Svg, { Path, Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import type { PhotoMarkup } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type Tool = 'arrow' | 'circle' | 'freehand' | 'text';
type AnnotationColor = 'red' | 'yellow' | 'green';

const COLOR_HEX: Record<AnnotationColor, string> = {
  red:    '#E5484D',
  yellow: '#F5A623',
  green:  '#1E8E4A',
};

const CANVAS_SIZE = 380;       // logical canvas — actual size is responsive

// Photo markup is a paid capability, consistent with plan markup (plans.tsx
// gates on 'plan_markup', Pro). A saved annotation feeds directly into an RFI
// or punch item, so the two markup surfaces are gated the same way behind the
// Pro 'photo_documentation' key rather than one being free and one paid.
export default function PhotoAnnotatorScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('photo_documentation')) {
    return <Paywall visible feature="Photo Markup" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <PhotoAnnotatorInner />;
}

function PhotoAnnotatorInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const { projectPhotos, updateProjectPhoto } = useProjects();
  const photo = useMemo(
    () => projectPhotos.find(p => p.id === photoId),
    [projectPhotos, photoId],
  );

  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<AnnotationColor>('red');
  const [markups, setMarkups] = useState<PhotoMarkup[]>(photo?.markup ?? []);
  const [drawing, setDrawing] = useState<PhotoMarkup | null>(null);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState<string>('');

  // Canvas size — square for now, responsive on web. We use normalized
  // coordinates (0..1) in storage, so the rendered overlay always lines
  // up with the photo regardless of display size.
  const [canvasW, setCanvasW] = useState<number>(CANVAS_SIZE);
  const canvasRef = useRef<View>(null);

  const onCanvasLayout = useCallback((e: any) => {
    const { width } = e.nativeEvent.layout;
    setCanvasW(width);
  }, []);

  // Convert touch event coords → normalized {0..1, 0..1}.
  const norm = useCallback((evt: any) => {
    const touch = evt.nativeEvent;
    const x = (touch.locationX ?? 0) / canvasW;
    const y = (touch.locationY ?? 0) / canvasW;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }, [canvasW]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => tool !== 'text',
    onMoveShouldSetPanResponder: () => tool !== 'text',
    onPanResponderGrant: (evt) => {
      const p = norm(evt);
      const id = generateUUID();
      if (tool === 'arrow' || tool === 'circle') {
        setDrawing({ id, type: tool, color, points: [p, p] });
      } else if (tool === 'freehand') {
        setDrawing({ id, type: 'freehand', color, points: [p] });
      }
    },
    onPanResponderMove: (evt) => {
      const p = norm(evt);
      setDrawing(prev => {
        if (!prev) return prev;
        if (prev.type === 'arrow' || prev.type === 'circle') {
          return { ...prev, points: [prev.points[0], p] };
        }
        if (prev.type === 'freehand') {
          // throttle: only push every other touch
          const last = prev.points[prev.points.length - 1];
          if (Math.abs(last.x - p.x) < 0.005 && Math.abs(last.y - p.y) < 0.005) return prev;
          return { ...prev, points: [...prev.points, p] };
        }
        return prev;
      });
    },
    onPanResponderRelease: () => {
      setDrawing(prev => {
        if (!prev) return null;
        // Discard zero-length strokes.
        if (prev.points.length < 2) return null;
        if ((prev.type === 'arrow' || prev.type === 'circle') &&
            Math.abs(prev.points[0].x - prev.points[1].x) < 0.01 &&
            Math.abs(prev.points[0].y - prev.points[1].y) < 0.01) return null;
        setMarkups(m => [...m, prev]);
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        return null;
      });
    },
  }), [tool, color, norm]);

  // Text tool — single tap drops a label. We capture the coord and
  // open an inline input.
  const handleCanvasPress = useCallback((evt: any) => {
    if (tool !== 'text') return;
    if (pendingText) return;
    const p = norm(evt);
    setPendingText(p);
    setTextValue('');
  }, [tool, pendingText, norm]);

  const commitText = useCallback(() => {
    if (!pendingText || !textValue.trim()) {
      setPendingText(null);
      setTextValue('');
      return;
    }
    setMarkups(m => [...m, {
      id: generateUUID(),
      type: 'text',
      color,
      points: [pendingText],
      text: textValue.trim(),
    }]);
    setPendingText(null);
    setTextValue('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [pendingText, textValue, color]);

  const handleUndo = useCallback(() => {
    setMarkups(m => m.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert('Clear all markup?', 'This will remove every annotation on this photo. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setMarkups([]) },
    ]);
  }, []);

  const handleSave = useCallback(() => {
    if (!photo) return;
    updateProjectPhoto(photo.id, { markup: markups });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // After save, offer to attach this annotated photo to a new RFI
    // or punch item. This is the connector that turns a "thing I saw"
    // into a "thing I escalated." If the user just wants to save and
    // go, the Done option preserves the old behavior.
    Alert.alert(
      'Saved',
      'Your markup is saved. Want to use this photo for something?',
      [
        { text: 'Done', style: 'cancel', onPress: () => router.back() },
        {
          text: 'Create RFI',
          onPress: () => {
            router.replace({
              pathname: '/rfi' as any,
              params: { projectId: photo.projectId, prefillPhotoId: photo.id },
            });
          },
        },
        {
          text: 'Add to Punch List',
          onPress: () => {
            router.replace({
              pathname: '/punch-list' as any,
              params: { projectId: photo.projectId, prefillPhotoUri: photo.uri, prefillPhotoId: photo.id },
            });
          },
        },
      ],
    );
  }, [photo, markups, updateProjectPhoto, router]);

  if (!photo) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: 'Markup' }} />
        <Text style={styles.emptyText}>Photo not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.emptyBack}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Render a single markup as SVG primitives.
  const renderMarkup = (m: PhotoMarkup, key: string) => {
    const stroke = COLOR_HEX[m.color];
    const w = canvasW;
    if (m.type === 'arrow') {
      const [p1, p2] = m.points;
      const x1 = p1.x * w, y1 = p1.y * w, x2 = p2.x * w, y2 = p2.y * w;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = 16;
      const left = `${x2 - ux * head + uy * head / 2},${y2 - uy * head - ux * head / 2}`;
      const right = `${x2 - ux * head - uy * head / 2},${y2 - uy * head + ux * head / 2}`;
      return (
        <React.Fragment key={key}>
          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
          <Polygon points={`${x2},${y2} ${left} ${right}`} fill={stroke} />
        </React.Fragment>
      );
    }
    if (m.type === 'circle') {
      const [p1, p2] = m.points;
      const cx = (p1.x + p2.x) / 2 * w;
      const cy = (p1.y + p2.y) / 2 * w;
      const r  = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) / 2 * w;
      return <Circle key={key} cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={3} fill="none" />;
    }
    if (m.type === 'freehand') {
      const d = m.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * w).toFixed(1)},${(p.y * w).toFixed(1)}`)
        .join(' ');
      return <Path key={key} d={d} stroke={stroke} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (m.type === 'text' && m.text) {
      const [p] = m.points;
      const x = p.x * w, y = p.y * w;
      // Background pill behind the label for legibility.
      const len = m.text.length * 8 + 16;
      return (
        <React.Fragment key={key}>
          <Polygon
            points={`${x},${y - 16} ${x + len},${y - 16} ${x + len},${y + 8} ${x},${y + 8}`}
            fill={stroke}
            opacity={0.92}
          />
          <SvgText x={x + 8} y={y + 2} fill={themeColors.surface} fontSize={13} fontWeight="700">{m.text}</SvgText>
        </React.Fragment>
      );
    }
    return null;
  };

  const tools: { tool: Tool; icon: any; label: string }[] = [
    { tool: 'arrow',    icon: ArrowRight,  label: 'Arrow' },
    { tool: 'circle',   icon: CircleIcon,  label: 'Circle' },
    { tool: 'freehand', icon: Pen,         label: 'Freehand' },
    { tool: 'text',     icon: Type,        label: 'Text' },
  ];
  const colors: AnnotationColor[] = ['red', 'yellow', 'green'];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.title}>Markup</Text>
        <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
          <Check size={16} color={themeColors.surface} strokeWidth={1.75} />
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Canvas */}
        <View
          ref={canvasRef}
          style={styles.canvas}
          onLayout={onCanvasLayout}
          onTouchEnd={handleCanvasPress}
          {...panResponder.panHandlers}
        >
          <Image source={{ uri: photo.uri }} style={[StyleSheet.absoluteFill, { borderRadius: Tokens.radius.card }]} contentFit="cover" />
          <Svg width={canvasW} height={canvasW} style={StyleSheet.absoluteFill}>
            {markups.map((m, i) => renderMarkup(m, `m-${i}`))}
            {drawing ? renderMarkup(drawing, 'd-current') : null}
          </Svg>
        </View>

        {/* Pending text input — appears just below the canvas with the
            tap coordinate as a hint. Keeps focus management simple. */}
        {pendingText ? (
          <View style={styles.textRow}>
            <TextInput
              autoFocus
              value={textValue}
              onChangeText={setTextValue}
              onSubmitEditing={commitText}
              placeholder="Label this point…"
              placeholderTextColor={themeColors.textMuted}
              style={styles.textInput}
              maxLength={28}
              testID="annotator-text-input"
            />
            <TouchableOpacity onPress={commitText} style={styles.textOk} accessibilityRole="button" accessibilityLabel="Confirm"><Check size={16} color={themeColors.surface} strokeWidth={1.75} /></TouchableOpacity>
            <TouchableOpacity onPress={() => { setPendingText(null); setTextValue(''); }} style={styles.textCancel} accessibilityRole="button" accessibilityLabel="Close">
              <X size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Tools */}
        <Text style={styles.sectionLabel}>Tool</Text>
        <View style={styles.toolRow}>
          {tools.map(t => {
            const TIcon = t.icon;
            const active = tool === t.tool;
            return (
              <TouchableOpacity
                key={t.tool}
                onPress={() => setTool(t.tool)}
                style={[styles.toolBtn, active && styles.toolBtnActive]}
                testID={`tool-${t.tool}`}
              >
                <TIcon size={18} color={active ? themeColors.surface : themeColors.text} />
                <Text style={[styles.toolText, active && styles.toolTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Colors */}
        <Text style={styles.sectionLabel}>Color</Text>
        <View style={styles.colorRow}>
          {colors.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.colorSwatch,
                { backgroundColor: COLOR_HEX[c] },
                color === c && styles.colorSwatchActive,
              ]}
              testID={`color-${c}`}
            />
          ))}
        </View>

        {/* Action row */}
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={handleUndo} disabled={!markups.length} style={[styles.actionBtn, !markups.length && styles.actionDisabled]}>
            <Undo2 size={16} color={markups.length ? themeColors.text : themeColors.textMuted} strokeWidth={1.75} />
            <Text style={[styles.actionText, !markups.length && styles.actionTextDisabled]}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClear} disabled={!markups.length} style={[styles.actionBtn, !markups.length && styles.actionDisabled]}>
            <Trash2 size={16} color={markups.length ? themeColors.danger : themeColors.textMuted} strokeWidth={1.75} />
            <Text style={[styles.actionText, { color: markups.length ? themeColors.danger : themeColors.textMuted }]}>Clear all</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.helper}>
          {markups.length ? `${markups.length} annotation${markups.length === 1 ? '' : 's'}` : 'Tap & drag to draw on the photo. Tap "Save" when done.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: t.bg },
  emptyText: { fontSize: Type.subhead.fontSize, color: t.textMuted, marginBottom: 12 },
  emptyBack: { fontSize: Type.bodyCompact.fontSize, color: t.accent, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    borderBottomColor: t.line, backgroundColor: t.surface,
  },
  back: { padding: 4 },
  title: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.md,
  },
  saveText: { color: t.surface, fontWeight: '800', fontSize: Type.footnote.fontSize },

  body: { padding: 16, gap: 14 },
  canvas: {
    aspectRatio: 1, borderRadius: Tokens.radius.card, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 1, borderColor: t.line,
  },

  textRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4 },
  textInput: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  textOk: { padding: 10, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  textCancel: { padding: 10, borderRadius: Tokens.radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },

  sectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.6, color: t.textMuted, textTransform: 'uppercase', marginTop: 6 },

  toolRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surface,
  },
  toolBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
  toolText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  toolTextActive: { color: t.surface },

  colorRow: { flexDirection: 'row', gap: 12 },
  colorSwatch: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorSwatchActive: { borderColor: t.text },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surface,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  actionTextDisabled: { color: t.textMuted },
  helper: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 4 },
});
