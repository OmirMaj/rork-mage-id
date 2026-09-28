import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Text,
  TouchableOpacity,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Trash2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatPoint, toCoordinate, inNoStartRect, type NoStartRect } from '@/utils/moments/signatureInk';
import { useT } from '@/contexts/LanguageContext';

// SignaturePad — the drawn-signature canvas.
//
// STORED STROKES ARE LEGAL RECORDS. Every stroke string is built by
// utils/moments/signatureInk.ts formatPoint() (byte-identical to the legacy
// `M${x.toFixed(1)},${y.toFixed(1)}` / ` L...` expression): raw points, no
// smoothing, no clamping. See that file for the display = PDF equivalence.
//
// Logic (moments / SIGNLINE):
//  - Coordinates come from nativeEvent.locationX/locationY on every platform.
//    The Svg, placeholder and baseline are pointerEvents="none", so the canvas
//    View is always the touch target and locationX/Y are canvas-relative.
//  - In-progress points and committed paths live in refs; a render tick shows
//    them. No side effect runs inside a setState updater (the old nested
//    setCurrentPath(prev => { setPaths(...) }) committed a stroke twice under
//    React StrictMode).
//  - While drawing, a parent (a ScrollView, a sheet) cannot take the gesture
//    away; if the OS terminates it anyway the stroke is committed like a
//    release.
//  - `locked` refuses new strokes and keeps every committed one. A stroke still
//    in progress when the lock lands is dropped, never committed: nothing may
//    change the paths after a signing write has started.
//  - `noStartRects` (display coords) are places a stroke may not START; a
//    stroke may still continue into them.
//
// With none of the new props, the pad renders and behaves as it always has.

export interface SignaturePadHandle {
  clear: () => void;
}

interface SignaturePadProps {
  initialPaths?: string[];
  onSave?: (paths: string[]) => void;
  onClear?: () => void;
  width?: number;
  height?: number;
  /** Fired on every pen-up with all committed strokes, and with [] on clear. */
  onChange?: (paths: string[]) => void;
  /** The first stroke of an empty pad touched down. */
  onFirstPenDown?: () => void;
  /** Refuse new strokes; keep the committed ones. */
  locked?: boolean;
  /** Display-coordinate rects where a stroke may not start. */
  noStartRects?: NoStartRect[];
  /** Stored coordinate space. When given, the Svg draws in it via viewBox. */
  coordinateWidth?: number;
  coordinateHeight?: number;
  /** Ink width, in coordinate units when a coordinate space is given. Default 2.5. */
  strokeWidth?: number;
  inkColor?: string;
  canvasColor?: string;
  lineColor?: string;
  /** 'none' hides the border, placeholder, baseline and the action row. */
  chrome?: 'default' | 'none';
  /** Default: true exactly when onChange is not provided. */
  showSave?: boolean;
  testID?: string;
}

const DEFAULT_INK = '#1a1a1a';

function SignaturePadInner(
  {
    initialPaths,
    onSave,
    onClear,
    width = 300,
    height = 150,
    onChange,
    onFirstPenDown,
    locked,
    noStartRects,
    coordinateWidth,
    coordinateHeight,
    strokeWidth = 2.5,
    inkColor,
    canvasColor,
    lineColor,
    chrome = 'default',
    showSave,
    testID,
  }: SignaturePadProps,
  ref: React.ForwardedRef<SignaturePadHandle>,
) {
  // Spanish Phase 1b (W3 ESSHELL, field.chrome.signature.*): the pad's own
  // chrome only. The strokes are the signature; nothing about them changes.
  const { t } = useT();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const pathsRef = useRef<string[]>(initialPaths ?? []);
  const currentRef = useRef<string>('');
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  // The responder is created once; it reads the live props through this ref.
  const live = useRef({ locked, noStartRects, onChange, onFirstPenDown, sx: 1, sy: 1 });
  live.current = {
    locked,
    noStartRects,
    onChange,
    onFirstPenDown,
    sx: coordinateWidth ? coordinateWidth / width : 1,
    sy: coordinateHeight ? coordinateHeight / height : 1,
  };

  const panResponder = useRef(
    (() => {
      const drawing = { on: false };
      const commit = () => {
        const d = currentRef.current;
        drawing.on = false;
        currentRef.current = '';
        if (live.current.locked) {
          // The lock landed mid-stroke: drop it, keep every committed stroke.
          bump();
          return;
        }
        if (d.length > 0) {
          pathsRef.current = [...pathsRef.current, d];
          bump();
          live.current.onChange?.(pathsRef.current);
        } else {
          bump();
        }
      };
      const point = (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        return toCoordinate(locationX, locationY, live.current.sx, live.current.sy);
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: (evt) => {
          if (live.current.locked) return false;
          const { locationX, locationY } = evt.nativeEvent;
          if (inNoStartRect(locationX, locationY, live.current.noStartRects)) return false;
          return true;
        },
        // With a no-start zone, a stroke may only begin at touch-down (a touch
        // refused in the zone must not be granted later by a move).
        onMoveShouldSetPanResponder: () => {
          if (live.current.locked) return false;
          const rects = live.current.noStartRects;
          return !(rects && rects.length > 0);
        },
        onPanResponderGrant: (evt) => {
          if (live.current.locked) return;
          const p = point(evt);
          if (pathsRef.current.length === 0) live.current.onFirstPenDown?.();
          drawing.on = true;
          currentRef.current = formatPoint(p.x, p.y, true);
          bump();
        },
        onPanResponderMove: (evt) => {
          if (!drawing.on || live.current.locked) return;
          const p = point(evt);
          currentRef.current += formatPoint(p.x, p.y, false);
          bump();
        },
        onPanResponderTerminationRequest: () => !drawing.on,
        onPanResponderRelease: commit,
        onPanResponderTerminate: commit,
      });
    })(),
  ).current;

  const handleClear = useCallback(() => {
    pathsRef.current = [];
    currentRef.current = '';
    bump();
    onClear?.();
    onChange?.([]);
  }, [onClear, onChange, bump]);

  useImperativeHandle(ref, () => ({ clear: handleClear }), [handleClear]);

  const handleSave = useCallback(() => {
    onSave?.(pathsRef.current);
  }, [onSave]);

  const paths = pathsRef.current;
  const currentPath = currentRef.current;
  const hasPaths = paths.length > 0 || currentPath.length > 0;
  const bare = chrome === 'none';
  const saveShown = showSave ?? !onChange;
  const stroke = inkColor ?? DEFAULT_INK;
  const viewBox = coordinateWidth && coordinateHeight ? `0 0 ${coordinateWidth} ${coordinateHeight}` : undefined;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.canvas,
          { width, height },
          bare && styles.canvasBare,
          canvasColor !== undefined && { backgroundColor: canvasColor },
        ]}
        testID={testID}
        {...panResponder.panHandlers}
      >
        <Svg
          width={width}
          height={height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          {...(viewBox ? { viewBox, preserveAspectRatio: 'none' } : null)}
        >
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke={stroke}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath.length > 0 && (
            <Path
              d={currentPath}
              stroke={stroke}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
        {!bare && !hasPaths && (
          <View style={styles.placeholder} pointerEvents="none">
            <Text style={styles.placeholderText}>{t('field.chrome.signature.signHere', 'Sign here')}</Text>
          </View>
        )}
        {!bare && (
          <View
            style={[styles.signLine, lineColor !== undefined && { backgroundColor: lineColor }]}
            pointerEvents="none"
          />
        )}
      </View>
      {!bare && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClear}
            activeOpacity={0.7}
          >
            <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.clearBtnText}>{t('field.chrome.signature.clear', 'Clear')}</Text>
          </TouchableOpacity>
          {saveShown && (
            <TouchableOpacity
              style={[styles.saveBtn, !hasPaths && styles.saveBtnDisabled]}
              onPress={handleSave}
              activeOpacity={hasPaths ? 0.7 : 1}
              disabled={!hasPaths}
            >
              <Check size={14} color={hasPaths ? '#FFFFFF' : themeColors.textMuted} strokeWidth={1.75} />
              <Text style={[styles.saveBtnText, !hasPaths && styles.saveBtnTextDisabled]}>
                {t('field.chrome.signature.save', 'Save Signature')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(SignaturePadInner);
SignaturePad.displayName = 'SignaturePad';
export default SignaturePad;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    gap: 10,
  },
  canvas: {
    backgroundColor: '#FAFAFA',
    borderRadius: Tokens.radius.card,
    borderWidth: 1.5,
    borderColor: t.line,
    borderStyle: 'dashed' as const,
    overflow: 'hidden' as const,
  },
  canvasBare: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: Type.callout.fontSize,
    color: t.textMuted,
    fontStyle: 'italic' as const,
  },
  signLine: {
    position: 'absolute' as const,
    bottom: 30,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  clearBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.errorLight,
  },
  clearBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.danger,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  saveBtnDisabled: {
    backgroundColor: t.surfaceAlt,
  },
  saveBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  saveBtnTextDisabled: {
    color: t.textMuted,
  },
});
