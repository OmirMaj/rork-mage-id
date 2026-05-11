// map-takeoff.tsx — satellite-image takeoff. The user draws a polygon
// over a satellite map of their project (roof outline, driveway,
// paving area, lawn) and we show the area in sq ft + perimeter in ft.
//
// Why this matters: Square Takeoff's only meaningful differentiator
// over MAGE ID is "measure straight from Google satellite imagery."
// This closes that gap in a single screen, $0/month at MAGE's scale.
//
// Cost model:
//   - iOS: Apple Maps via react-native-maps. $0 forever, no quota.
//   - Android: Google Maps. Free $200/mo credit covers ~28K map
//     loads/mo — break-even is ~1000 daily-active users each doing a
//     daily takeoff. Below that: $0/mo.
//   - Web: not supported in this v1. The screen renders a graceful
//     fallback. Users on web should use the dedicated AI takeoff
//     flow that works on any platform.
//
// Setup required:
//   - Android needs a Google Maps API key in app.json:
//     android.config.googleMaps.apiKey. The placeholder is
//     "REPLACE_WITH_GOOGLE_MAPS_ANDROID_API_KEY"; swap before any
//     `eas build --platform android`.
//   - iOS needs nothing — Apple Maps is used by default.
//
// Output:
//   - Area in sq ft (and "squares" — 100 sq ft units — for roofing).
//   - Perimeter in linear feet.
//   - Number of vertices (so the user can see what they drew).
//   The user can tap "Use in estimate" to route to /estimate-wizard
//   with the area pre-filled, OR copy to clipboard for use anywhere.

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronLeft, Trash2, Undo2, Check, Copy, Sparkles, MapPin, Crosshair,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  polygonAreaSquareFeet,
  polygonPerimeterFeet,
  formatArea,
  formatLength,
  type LatLng,
} from '@/utils/mapTakeoff';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// react-native-maps is required at runtime only on native. Web doesn't
// have the native module, so we lazy-load to avoid a hard import error
// at bundle time. The conditional render below shows a fallback on
// web.
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
let MapView: any = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
let Marker: any = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
let Polygon: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    Polygon = Maps.Polygon;
  } catch {
    /* react-native-maps not installed in this environment — the
       screen will render the unsupported-platform fallback. */
  }
}

// Default center used when the project has no geocoded coordinates
// AND we couldn't get a user-location fix. Lower-48 centroid.
const DEFAULT_CENTER: LatLng = { latitude: 39.8283, longitude: -98.5795 };

export default function MapTakeoffScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : null;
  const mapRef = useRef<any>(null);

  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [history, setHistory] = useState<LatLng[][]>([]);
  const [resolving, setResolving] = useState(false);

  // Initial map region. Prefer the project's geocoded coords; fall
  // back to the device's current location; final fallback is the
  // continental US center. Zoom 18-equivalent (~150 ft × 150 ft
  // visible) — close enough to see roof shapes clearly.
  const initialRegion = useMemo(() => {
    const center = project?.locationLatitude != null && project?.locationLongitude != null
      ? { latitude: project.locationLatitude, longitude: project.locationLongitude }
      : DEFAULT_CENTER;
    return {
      ...center,
      latitudeDelta: 0.0008,   // ~90 m N-S
      longitudeDelta: 0.0008,
    };
  }, [project?.locationLatitude, project?.locationLongitude]);

  // If the project doesn't have lat/lng but the device does, drop
  // the initial center on the user. One-shot, doesn't track.
  useEffect(() => {
    if (project?.locationLatitude != null) return;
    if (Platform.OS === 'web') return;
    setResolving(true);
    void (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        mapRef.current?.animateToRegion?.(
          {
            latitude: fix.coords.latitude,
            longitude: fix.coords.longitude,
            latitudeDelta: 0.0008,
            longitudeDelta: 0.0008,
          },
          500,
        );
      } catch (err) {
        console.log('[map-takeoff] geo failed', err);
      } finally {
        setResolving(false);
      }
    })();
  }, [project?.locationLatitude]);

  // ─── Vertex add/remove ───────────────────────────────────
  const handleMapPress = useCallback((e: { nativeEvent: { coordinate: LatLng } }) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    setHistory(prev => [...prev.slice(-9), vertices]);  // cap at 10 undo levels
    setVertices(prev => [...prev, e.nativeEvent.coordinate]);
  }, [vertices]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) {
      // Nothing in history — pop the last vertex anyway as a
      // shortcut for "undo my last tap."
      setVertices(prev => prev.slice(0, -1));
      return;
    }
    const last = history[history.length - 1];
    setVertices(last);
    setHistory(prev => prev.slice(0, -1));
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [history]);

  const handleClear = useCallback(() => {
    if (vertices.length === 0) return;
    Alert.alert(
      'Clear all points?',
      `Remove all ${vertices.length} vertices and start over?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setHistory(prev => [...prev.slice(-9), vertices]);
            setVertices([]);
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          },
        },
      ],
    );
  }, [vertices]);

  // ─── Computed ──────────────────────────────────────────
  const areaSqFt = useMemo(() => polygonAreaSquareFeet(vertices), [vertices]);
  const perimeterFt = useMemo(() => polygonPerimeterFeet(vertices), [vertices]);

  const areaLabel = formatArea(areaSqFt);
  const perimeterLabel = formatLength(perimeterFt);

  const handleCopy = useCallback(async () => {
    if (vertices.length < 3) {
      Alert.alert('Need at least 3 points', 'Tap on the map to drop a few more vertices, then try again.');
      return;
    }
    try {
      await Clipboard.setStringAsync(`${Math.round(areaSqFt)} sq ft (${perimeterLabel} perimeter)`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Copied', `${areaLabel} copied to clipboard.`);
    } catch {
      Alert.alert('Copy failed', 'Could not access the clipboard.');
    }
  }, [vertices, areaSqFt, perimeterLabel, areaLabel]);

  const handleUseInEstimate = useCallback(() => {
    if (vertices.length < 3) {
      Alert.alert('Need at least 3 points', 'Tap on the map to drop a few more vertices, then try again.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Route to the AI takeoff flow with the measured area + perimeter
    // pre-filled. The estimate-wizard reads `area` and `perimeter` query
    // params (when present) to seed its inputs; absent params fall
    // back to the existing form-driven flow.
    router.push({
      pathname: '/estimate-wizard' as never,
      params: {
        projectId: project?.id ?? '',
        seedArea: String(Math.round(areaSqFt)),
        seedPerimeter: String(Math.round(perimeterFt)),
        seedSource: 'map_takeoff',
      } as never,
    });
  }, [vertices, areaSqFt, perimeterFt, project?.id, router]);

  // ─── Render ─────────────────────────────────────────────
  // Web (and any environment without react-native-maps) gets a
  // graceful "use the AI takeoff instead" fallback. The whole
  // satellite-takeoff value-add is native-only.
  if (Platform.OS === 'web' || !MapView) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Map Takeoff' }} />
        <View style={[styles.fallbackWrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <MapPin size={40} color={Colors.primary} />
          <Text style={styles.fallbackTitle}>Map takeoff is mobile-only</Text>
          <Text style={styles.fallbackBody}>
            Open MAGE ID on your phone or iPad to draw on a satellite image of the project. Need a measurement on the web? Use AI Takeoff with a blueprint instead.
          </Text>
          <TouchableOpacity
            style={styles.fallbackBtn}
            onPress={() => router.push('/estimate-wizard' as never)}
            activeOpacity={0.85}
          >
            <Sparkles size={14} color={Colors.textOnPrimary} />
            <Text style={styles.fallbackBtnText}>Open AI Takeoff</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        mapType="satellite"
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        {vertices.length >= 3 && Polygon && (
          <Polygon
            coordinates={vertices}
            strokeColor={Colors.primary}
            fillColor={Colors.primary + '33'}
            strokeWidth={3}
          />
        )}
        {Marker && vertices.map((v, i) => (
          <Marker
            key={`v-${i}`}
            coordinate={v}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            draggable
            onDragEnd={(e: { nativeEvent: { coordinate: LatLng } }) => {
              setHistory(prev => [...prev.slice(-9), vertices]);
              setVertices(prev => prev.map((p, idx) => idx === i ? e.nativeEvent.coordinate : p));
            }}
          >
            <View style={styles.vertex}>
              <Text style={styles.vertexNumber}>{i + 1}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Header — back + project name + clear */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.topTitle}>
          <Text style={styles.topTitleText} numberOfLines={1}>{project?.name ?? 'Map takeoff'}</Text>
          <Text style={styles.topSubtitle}>Tap to drop points · drag to refine</Text>
        </View>
        <TouchableOpacity onPress={handleUndo} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Undo last point" disabled={vertices.length === 0}>
          <Undo2 size={18} color={vertices.length === 0 ? Colors.textMuted : Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleClear} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Clear all points" disabled={vertices.length === 0}>
          <Trash2 size={18} color={vertices.length === 0 ? Colors.textMuted : Colors.error} />
        </TouchableOpacity>
      </View>

      {/* Re-center button when we lost track of the project */}
      {project?.locationLatitude == null && (
        <TouchableOpacity
          style={[styles.recenterBtn, { top: insets.top + 70 }]}
          onPress={() => {
            if (resolving) return;
            mapRef.current?.animateToRegion?.(initialRegion, 400);
          }}
          activeOpacity={0.85}
        >
          {resolving
            ? <ActivityIndicator size="small" color={Colors.text} />
            : <Crosshair size={16} color={Colors.text} />}
        </TouchableOpacity>
      )}

      {/* Bottom panel — running totals + actions */}
      <View style={[styles.bottomCard, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.statRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Area</Text>
            <Text style={styles.statValue}>{vertices.length >= 3 ? areaLabel : '—'}</Text>
          </View>
          <View style={styles.statCellDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Perimeter</Text>
            <Text style={styles.statValue}>{vertices.length >= 2 ? perimeterLabel : '—'}</Text>
          </View>
          <View style={styles.statCellDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Points</Text>
            <Text style={styles.statValue}>{vertices.length}</Text>
          </View>
        </View>

        {vertices.length < 3 ? (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              Tap the map to drop {3 - vertices.length} more {3 - vertices.length === 1 ? 'point' : 'points'} to start measuring.
            </Text>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionSecondary]}
              onPress={handleCopy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Copy area to clipboard"
              testID="map-takeoff-copy"
            >
              <Copy size={14} color={Colors.text} />
              <Text style={[styles.actionBtnText, { color: Colors.text }]}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionPrimary]}
              onPress={handleUseInEstimate}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Use in estimate"
              testID="map-takeoff-use"
            >
              <Check size={14} color={Colors.textOnPrimary} />
              <Text style={[styles.actionBtnText, { color: Colors.textOnPrimary }]}>Use in estimate</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  topBar: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 12, paddingBottom: 10,
  },
  topTitle: { flex: 1, paddingHorizontal: 6 },
  topTitleText: { fontSize: Type.subheadline.fontSize, fontWeight: '900' as const, color: Colors.text, textShadowColor: 'rgba(255,255,255,0.6)', textShadowRadius: 6, letterSpacing: -0.3 },
  topSubtitle: { fontSize: Type.caption2.fontSize, color: Colors.text, opacity: 0.85, textShadowColor: 'rgba(255,255,255,0.5)', textShadowRadius: 6 },

  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },

  recenterBtn: {
    position: 'absolute' as const, right: 12, zIndex: 9,
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },

  // Vertex marker — number bubble. tracksViewChanges=false on the
  // Marker keeps draws cheap during pan/zoom; the marker doesn't
  // need to re-render except on drag.
  vertex: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary,
    borderWidth: 2.5, borderColor: Colors.surface,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2,
  },
  vertexNumber: { color: Colors.surface, fontSize: 11, fontWeight: '900' as const },

  bottomCard: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 18, paddingTop: 18,
    gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 12,
  },

  statRow: { flexDirection: 'row' as const, alignItems: 'stretch' as const, paddingVertical: 4 },
  statCell: { flex: 1, alignItems: 'flex-start' as const, gap: 2 },
  statCellDivider: { width: 1, marginHorizontal: 12, backgroundColor: Colors.borderLight },
  statLabel: { fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  statValue: { fontSize: 22, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.5 },

  hintBox: { padding: 12, borderRadius: 12, backgroundColor: Colors.fillTertiary },
  hintText: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, textAlign: 'center' as const },

  actionRow: { flexDirection: 'row' as const, gap: 10 },
  actionBtn: { flex: 1, minHeight: 50, borderRadius: 999, alignItems: 'center' as const, justifyContent: 'center' as const, flexDirection: 'row' as const, gap: 6 },
  actionSecondary: { backgroundColor: Colors.fillTertiary },
  actionPrimary: { backgroundColor: Colors.primary },
  actionBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, letterSpacing: -0.2 },

  fallbackWrap: { flex: 1, paddingHorizontal: 32, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 12 },
  fallbackTitle: { fontSize: Type.title2.fontSize, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const, letterSpacing: -0.4, marginTop: 8 },
  fallbackBody: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 22 },
  fallbackBtn: { marginTop: 8, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: Colors.primary },
  fallbackBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

void Tokens;
