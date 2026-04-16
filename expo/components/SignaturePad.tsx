import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Text,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Trash2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface SignaturePadProps {
  initialPaths?: string[];
  onSave: (paths: string[]) => void;
  onClear: () => void;
  width?: number;
  height?: number;
}

export default function SignaturePad({
  initialPaths,
  onSave,
  onClear,
  width = 300,
  height = 150,
}: SignaturePadProps) {
  const [paths, setPaths] = useState<string[]>(initialPaths ?? []);
  const [currentPath, setCurrentPath] = useState<string>('');
  const containerRef = useRef<View>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const measureContainer = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.measure((_x, _y, _w, _h, pageX, pageY) => {
        offsetRef.current = { x: pageX, y: pageY };
      });
    }
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touch = evt.nativeEvent;
        let x: number;
        let y: number;
        if (Platform.OS === 'web') {
          x = touch.locationX;
          y = touch.locationY;
        } else {
          x = touch.pageX - offsetRef.current.x;
          y = touch.pageY - offsetRef.current.y;
        }
        setCurrentPath(`M${x.toFixed(1)},${y.toFixed(1)}`);
      },
      onPanResponderMove: (evt) => {
        const touch = evt.nativeEvent;
        let x: number;
        let y: number;
        if (Platform.OS === 'web') {
          x = touch.locationX;
          y = touch.locationY;
        } else {
          x = touch.pageX - offsetRef.current.x;
          y = touch.pageY - offsetRef.current.y;
        }
        setCurrentPath(prev => `${prev} L${x.toFixed(1)},${y.toFixed(1)}`);
      },
      onPanResponderRelease: () => {
        setCurrentPath(prev => {
          if (prev.length > 0) {
            setPaths(old => [...old, prev]);
          }
          return '';
        });
      },
    })
  ).current;

  const handleClear = useCallback(() => {
    setPaths([]);
    setCurrentPath('');
    onClear();
  }, [onClear]);

  const handleSave = useCallback(() => {
    onSave(paths);
  }, [paths, onSave]);

  const hasPaths = paths.length > 0 || currentPath.length > 0;

  return (
    <View style={styles.container}>
      <View
        ref={containerRef}
        style={[styles.canvas, { width, height }]}
        onLayout={measureContainer}
        {...panResponder.panHandlers}
      >
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#1a1a1a"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath.length > 0 && (
            <Path
              d={currentPath}
              stroke="#1a1a1a"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
        {!hasPaths && (
          <View style={styles.placeholder} pointerEvents="none">
            <Text style={styles.placeholderText}>Sign here</Text>
          </View>
        )}
        <View style={styles.signLine} pointerEvents="none" />
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Trash2 size={14} color={Colors.error} />
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, !hasPaths && styles.saveBtnDisabled]}
          onPress={handleSave}
          activeOpacity={hasPaths ? 0.7 : 1}
          disabled={!hasPaths}
        >
          <Check size={14} color={hasPaths ? Colors.textOnPrimary : Colors.textMuted} />
          <Text style={[styles.saveBtnText, !hasPaths && styles.saveBtnTextDisabled]}>
            Save Signature
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  canvas: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed' as const,
    overflow: 'hidden' as const,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: Colors.textMuted,
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
    borderRadius: 10,
    backgroundColor: Colors.errorLight,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textOnPrimary,
  },
  saveBtnTextDisabled: {
    color: Colors.textMuted,
  },
});
