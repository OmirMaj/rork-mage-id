// Photo annotator — homeowner-grade markup tool nobody else in the
// residential space ships well. Lets the GC (or sub) drop arrows,
// circles, freehand strokes, and text labels on a photo so "fix the
// gap here" stops being a 5-message text thread.
//
// Markup is stored as normalized {x: 0..1, y: 0..1} coordinates so the
// same overlay re-renders cleanly at any display size — phone, tablet,
// or the static portal.

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, PanResponder, ScrollView, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ArrowRight, Circle as CircleIcon, Pen, Type as TypeIcon, Undo2, Trash2, Check, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Svg, { Path, Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import Paywall from '@/components/Paywall';
import type { PhotoMarkup, ProjectPhoto } from '@/types';
import { useSafeBack } from '@/hooks/useSafeBack';
import { Button } from '@/components/ui/Button';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

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
// 'photo_documentation' key rather than one being free and one paid.
//
// #149: gated on the PHOTO'S project (useProjectAccess), not the viewer's own
// plan alone. An invited super on a free account marks up the GC's photos —
// the work he was invited to do, and RLS already lets a field seat update
// them — instead of hitting the Pro paywall. The route carries only photoId,
// so the photo is looked up first; every hook runs unconditionally, and the
// wall waits for the photo and the role (see annotatorAccessState).
export default function PhotoAnnotatorScreen() {
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const { projectPhotos, photosLoaded } = useProjects();
  const photoProjectId = useMemo(
    () => projectPhotos.find(p => p.id === photoId)?.projectId,
    [projectPhotos, photoId],
  );
  const { canAccess, requiredTierFor } = useProjectAccess(photoProjectId);
  const roleState = useProjectRoleState(photoProjectId);
  if (!canAccess('photo_documentation')) {
    return (
      <AnnotatorAccessWall
        state={annotatorAccessState({
          canAccess: false,
          photosLoaded,
          photoFound: !!photoProjectId,
          roleLoading: roleState.isLoading,
          roleError: roleState.isError,
          role: roleState.role,
        })}
        requiredTier={requiredTierFor('photo_documentation')}
        onRetry={() => { void roleState.refetch(); }}
      />
    );
  }
  return <PhotoAnnotatorGate />;
}

/** Everything short of the editor when neither his plan nor a project grant
 *  covers markup yet — a wait, a retry, a plain "no access", or the paywall. */
function AnnotatorAccessWall({ state, requiredTier, onRetry }: {
  state: ReturnType<typeof annotatorAccessState>;
  requiredTier: 'free' | 'pro' | 'business' | 'enterprise';
  onRetry: () => void;
}) {
  const goBack = useSafeBack();
  const styles = useThemedStyles(makeStyles);
  // The photo isn't here: the editor's own gate says so (and offers a retry)
  // rather than quoting a price for a photo that isn't on this device.
  if (state === 'open') return <PhotoAnnotatorGate />;
  if (state === 'paywall') {
    // The tier on the wall is read from featureTiers.ts, never typed here.
    return <Paywall visible feature="Photo Markup" requiredTier={requiredTier} onClose={goBack} />;
  }
  return (
    <View style={styles.empty} testID={`photo-access-${state}`}>
      <Stack.Screen options={{ title: 'Markup' }} />
      <Text style={styles.emptyText}>
        {state === 'loading'
          ? 'Checking your access to this photo…'
          : state === 'error'
            ? "Couldn't check your access to this job. Check your connection and try again."
            : "You don't have access to this project's photos. Ask the project owner to invite you."}
      </Text>
      {state === 'error' && (
        <Button label="Try again" variant="primary" onPress={onRetry} testID="photo-access-retry" />
      )}
      <Button label="Go back" variant="secondary" onPress={goBack} testID="photo-access-back" />
    </View>
  );
}

// >>> annotator-access (pure; scripts/validate-submittals-package.ts evaluates this block)
/**
 * What the markup route shows before the editor (#149). The gating contract:
 *   • his own plan (or the project grant) covers it → 'open' — the editor's own
 *     gate then waits for the photo exactly as before;
 *   • the photos have not loaded, or the photo's role is still being read →
 *     'loading', never the paywall (a free collaborator used to see the wall
 *     flash up before his grant arrived);
 *   • the role read failed → 'error', with a retry;
 *   • the photo is not here once loaded → 'open', so the editor's gate says
 *     the photo is missing rather than quoting a price for it;
 *   • a settled null role on a real photo → 'no_access', said plainly;
 *   • otherwise his own plan is the answer → 'paywall'.
 */
export function annotatorAccessState(o: {
  canAccess: boolean;
  photosLoaded: boolean;
  photoFound: boolean;
  roleLoading: boolean;
  roleError: boolean;
  role: string | null;
}): 'open' | 'loading' | 'error' | 'no_access' | 'paywall' {
  if (o.canAccess) return 'open';
  if (!o.photosLoaded) return 'loading';
  if (!o.photoFound) return 'open';
  if (o.roleLoading) return 'loading';
  if (o.roleError) return 'error';
  if (o.role === null) return 'no_access';
  return 'paywall';
}
// <<< annotator-access

// >>> photo-open-gate (pure; scripts/validate-photo-markup-join.ts evaluates this block)
/**
 * What a link naming a photo should show.
 *
 * The editor seeds its markups ONCE, at mount, from the photo. ProjectContext
 * starts `projectPhotos` as [] (and a cold start's signed-out pass fills it
 * from this device's cache) before the account's photos land, so a web
 * refresh or a direct /photo-annotator?photoId= link used to mount an EMPTY
 * canvas — or this device's older copy — and Save wrote that over the photo's
 * real markup on the server, every other device, and the RFI / punch item it
 * feeds. So the editor waits for `photosLoaded` (keyed by account, false while
 * auth resolves); 'missing' only once they have loaded without it.
 */
export function photoOpenState(o: { found: boolean; photosLoaded: boolean }): 'editor' | 'loading' | 'missing' {
  if (!o.photosLoaded) return 'loading';
  return o.found ? 'editor' : 'missing';
}
// <<< photo-open-gate

function PhotoAnnotatorGate() {
  const styles = useThemedStyles(makeStyles);
  // Safe back: a refresh or a cold-start link has nothing to pop, and a bare
  // router.back() there was a dead button.
  const goBack = useSafeBack();
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const { projectPhotos, photosLoaded, retryRemoteReads } = useProjects();
  const photo = useMemo(
    () => projectPhotos.find(p => p.id === photoId),
    [projectPhotos, photoId],
  );
  const state = photoOpenState({ found: !!photo, photosLoaded });
  if (state === 'editor' && photo) {
    // Keyed on the photo so the canvas re-seeds from the loaded record.
    return <PhotoAnnotatorInner key={photo.id} photo={photo} />;
  }
  return (
    <View style={styles.empty} testID={`photo-open-${state}`}>
      <Stack.Screen options={{ title: 'Markup' }} />
      <Text style={styles.emptyText}>
        {state === 'loading'
          ? 'Loading this photo…'
          : 'This photo isn\'t on this device — it was deleted or hasn\'t synced here. Nothing was opened in its place.'}
      </Text>
      {state === 'missing' && (
        <Button label="Try again" variant="primary" onPress={retryRemoteReads} testID="photo-open-retry" />
      )}
      <Button label="Go back" variant="secondary" onPress={goBack} testID="photo-open-back" />
    </View>
  );
}

function PhotoAnnotatorInner({ photo }: { photo: ProjectPhoto }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useSafeBack();
  const { updateProjectPhoto } = useProjects();

  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<AnnotationColor>('red');
  // Seeded once from the LOADED photo — the gate above only mounts this
  // editor after this account's photos have landed, keyed on the photo id.
  const [markups, setMarkups] = useState<PhotoMarkup[]>(photo.markup ?? []);
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
    // The Text tool is placed through the responder too (a press, not a
    // drag): it used to ride on the canvas's onTouchEnd, which react-native-
    // web passes through as a DOM `touchend` that a mouse click never fires,
    // so on desktop web a label could not be placed at all. Responder events
    // arrive for touch AND mouse on every platform. While a label is waiting
    // for its text, the canvas does not claim the press.
    onStartShouldSetPanResponder: () => tool !== 'text' || !pendingText,
    onMoveShouldSetPanResponder: () => tool !== 'text',
    onPanResponderGrant: (evt) => {
      const p = norm(evt);
      if (tool === 'text') {
        if (!pendingText) { setPendingText(p); setTextValue(''); }
        return;
      }
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
  }), [tool, color, norm, pendingText]);

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
    showAlert('Clear all markup?', 'This will remove every annotation on this photo. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setMarkups([]) },
    ]);
  }, []);

  const handleSave = useCallback(() => {
    updateProjectPhoto(photo.id, { markup: markups });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // After save, offer to attach this annotated photo to a new RFI
    // or punch item. This is the connector that turns a "thing I saw"
    // into a "thing I escalated." If the user just wants to save and
    // go, the Done option preserves the old behavior.
    showAlert(
      'Saved',
      'Your markup is saved. Want to use this photo for something?',
      [
        { text: 'Done', style: 'cancel', onPress: goBack },
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
  }, [photo, markups, updateProjectPhoto, router, goBack]);

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

  // `icon` is typed LucideIcon, not `any`, on purpose. This file has TWO
  // things called Type: lucide's text glyph (imported as TypeIcon) and the
  // typography scale from constants/typography (used by the styles below).
  // With `icon: any`, the Text tool pointed at the typography OBJECT; React
  // threw "Element type is invalid … got: object" and the root error boundary
  // replaced the whole app, so "Add markup" -> Create RFI / Add to Punch List
  // was unreachable on iPhone and web. The real type makes tsc reject that mix-up.
  const tools: { tool: Tool; icon: LucideIcon; label: string }[] = [
    { tool: 'arrow',    icon: ArrowRight,  label: 'Arrow' },
    { tool: 'circle',   icon: CircleIcon,  label: 'Circle' },
    { tool: 'freehand', icon: Pen,         label: 'Freehand' },
    { tool: 'text',     icon: TypeIcon,    label: 'Text' },
  ];
  const colors: AnnotationColor[] = ['red', 'yellow', 'green'];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.title}>Markup</Text>
        <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
          <Check size={16} color={themeColors.surface} strokeWidth={1.75} />
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
        {/* Canvas */}
        <View
          ref={canvasRef}
          style={styles.canvas}
          onLayout={onCanvasLayout}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: t.bg },
  emptyText: { fontSize: Type.subhead.fontSize, color: t.textMuted, textAlign: 'center' },

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
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.md,
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
  toolBtnActive: { backgroundColor: t.accentFill, borderColor: t.accent },
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
