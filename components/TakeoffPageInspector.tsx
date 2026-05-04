// TakeoffPageInspector — modal that opens when the user taps a source-page
// badge on a quantity row. Shows the rendered page image at full size with
// a sidebar listing every other takeoff row that references the same page.
//
// Why: the killer "verify the AI" UX is "I see a number that looks wrong, I
// tap it, I see the page it came from, I can match it visually." Without
// this, the user has to flip back to their PDF and find the page manually.
//
// Page-level only for now — the AI doesn't return bounding boxes per
// quantity. Region-level highlight is a Phase 2c follow-up bundled with the
// spec-matcher (which needs box coords anyway).

import React, { memo, useMemo, useState, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Image, Platform, Dimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Ruler, Square, DoorOpen, AppWindow, Paintbrush, Wrench, Boxes, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { TakeoffResult } from '@/types';
import type { RenderedPlanPage } from '@/utils/pdfRenderClient';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface RelatedRow {
  category: 'walls' | 'floorAreas' | 'doors' | 'windows' | 'finishes' | 'fixtures' | 'bulkMaterials';
  title: string;
  quantity: number;
  unit: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TakeoffPageInspectorProps {
  visible: boolean;
  onClose: () => void;
  /** Initial page to focus on (1-indexed). */
  initialPage: number;
  /** All rendered pages — used for the image source. */
  pages: RenderedPlanPage[];
  /** Full takeoff result so we can show "what else came from this page". */
  takeoff: TakeoffResult;
}

const CATEGORY_META: Record<RelatedRow['category'], { Icon: React.ComponentType<{ size?: number; color?: string }>; label: string }> = {
  walls: { Icon: Ruler, label: 'Wall' },
  floorAreas: { Icon: Square, label: 'Floor area' },
  doors: { Icon: DoorOpen, label: 'Door' },
  windows: { Icon: AppWindow, label: 'Window' },
  finishes: { Icon: Paintbrush, label: 'Finish' },
  fixtures: { Icon: Wrench, label: 'Fixture' },
  bulkMaterials: { Icon: Boxes, label: 'Bulk' },
};

function TakeoffPageInspectorImpl({
  visible, onClose, initialPage, pages, takeoff,
}: TakeoffPageInspectorProps) {
  const insets = useSafeAreaInsets();
  const [activePage, setActivePage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);

  React.useEffect(() => {
    if (visible) {
      setActivePage(initialPage);
      setZoom(1);
    }
  }, [visible, initialPage]);

  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.pageNumber - b.pageNumber),
    [pages],
  );

  const currentPage = useMemo(
    () => sortedPages.find(p => p.pageNumber === activePage),
    [sortedPages, activePage],
  );

  // Collect every row that references the active page.
  const relatedRows = useMemo<RelatedRow[]>(() => {
    const out: RelatedRow[] = [];
    for (const w of takeoff.walls) {
      if (w.sourcePages.includes(activePage)) {
        out.push({ category: 'walls', title: w.description, quantity: w.lengthFt, unit: 'LF', confidence: w.confidence });
      }
    }
    for (const f of takeoff.floorAreas) {
      if (f.sourcePages.includes(activePage)) {
        out.push({ category: 'floorAreas', title: f.roomName, quantity: f.areaSqFt, unit: 'SF', confidence: f.confidence });
      }
    }
    for (const d of takeoff.doors) {
      if (d.sourcePages.includes(activePage)) {
        out.push({ category: 'doors', title: d.mark ? `${d.mark} — ${d.description}` : d.description, quantity: d.count, unit: 'EA', confidence: d.confidence });
      }
    }
    for (const w of takeoff.windows) {
      if (w.sourcePages.includes(activePage)) {
        out.push({ category: 'windows', title: w.mark ? `${w.mark} — ${w.description}` : w.description, quantity: w.count, unit: 'EA', confidence: w.confidence });
      }
    }
    for (const f of takeoff.finishes) {
      if (f.sourcePages.includes(activePage)) {
        out.push({ category: 'finishes', title: f.code ? `${f.code} — ${f.description}` : f.description, quantity: f.quantity, unit: f.unit.toUpperCase(), confidence: f.confidence });
      }
    }
    for (const x of takeoff.fixtures) {
      if (x.sourcePages.includes(activePage)) {
        out.push({ category: 'fixtures', title: x.mark ? `${x.mark} — ${x.description}` : x.description, quantity: x.count, unit: 'EA', confidence: x.confidence });
      }
    }
    for (const b of takeoff.bulkMaterials) {
      if (b.sourcePages.includes(activePage)) {
        out.push({ category: 'bulkMaterials', title: b.description, quantity: b.quantity, unit: b.unit.toUpperCase(), confidence: b.confidence });
      }
    }
    return out;
  }, [takeoff, activePage]);

  const drawingMeta = useMemo(
    () => takeoff.drawingsSeen.find(d => d.page === activePage),
    [takeoff.drawingsSeen, activePage],
  );

  const goPage = useCallback((delta: number) => {
    const idx = sortedPages.findIndex(p => p.pageNumber === activePage);
    const next = sortedPages[idx + delta];
    if (next) {
      setActivePage(next.pageNumber);
      setZoom(1);
    }
  }, [sortedPages, activePage]);

  const screenW = Dimensions.get('window').width;
  const screenH = Dimensions.get('window').height;
  const isWide = screenW >= 760;
  const imgMaxH = screenH - insets.top - insets.bottom - 220;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.text} /></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Page {activePage}{drawingMeta ? ` · ${drawingMeta.type}` : ''}
            </Text>
            {drawingMeta?.scope ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{drawingMeta.scope}</Text>
            ) : null}
          </View>
          <View style={styles.zoomGroup}>
            <TouchableOpacity onPress={() => setZoom(z => Math.max(0.5, z - 0.25))} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Zoom out">
              <ZoomOut size={18} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
            <TouchableOpacity onPress={() => setZoom(z => Math.min(3, z + 0.25))} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Zoom in">
              <ZoomIn size={18} color={Colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.body, isWide && styles.bodyWide]}>
          <View style={[styles.imageWrap, isWide && styles.imageWrapWide]}>
            <ScrollView
              maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
              contentContainerStyle={styles.imageScrollContent}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imageScrollContent}
              >
                {currentPage?.publicUrl ? (
                  <Image
                    source={{ uri: currentPage.publicUrl }}
                    style={{
                      width: Math.min(screenW - (isWide ? 360 : 32), currentPage.width) * zoom,
                      height: imgMaxH * zoom,
                    }}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.imageLoading}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={styles.imageLoadingText}>No render available for this page.</Text>
                  </View>
                )}
              </ScrollView>
            </ScrollView>

            {/* Page nav controls overlay */}
            {sortedPages.length > 1 && (
              <>
                <TouchableOpacity
                  style={[styles.pageNav, styles.pageNavLeft]}
                  onPress={() => goPage(-1)}
                  hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                  <ChevronLeft size={20} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pageNav, styles.pageNavRight]}
                  onPress={() => goPage(1)}
                  hitSlop={8} accessibilityRole="button" accessibilityLabel="Open">
                  <ChevronRight size={20} color="#FFF" />
                </TouchableOpacity>
                <View style={styles.pagePill}>
                  <Text style={styles.pagePillText}>
                    {activePage} / {sortedPages.length}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Sidebar — related takeoff rows from this page */}
          <View style={[styles.sidebar, isWide && styles.sidebarWide]}>
            <Text style={styles.sidebarTitle}>
              From this page ({relatedRows.length})
            </Text>
            <Text style={styles.sidebarHelper}>
              Every quantity the AI extracted from page {activePage}.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.sidebarScroll}>
              {relatedRows.length === 0 && (
                <Text style={styles.sidebarEmpty}>
                  Nothing was extracted from this page.
                </Text>
              )}
              {relatedRows.map((r, idx) => {
                const meta = CATEGORY_META[r.category];
                const Icon = meta.Icon;
                const confColor = r.confidence === 'high' ? Colors.success : r.confidence === 'medium' ? Colors.warning : Colors.error;
                return (
                  <View key={idx} style={styles.sidebarRow}>
                    <View style={styles.sidebarRowIcon}>
                      <Icon size={12} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sidebarRowTitle} numberOfLines={2}>{r.title}</Text>
                      <View style={styles.sidebarRowMeta}>
                        <Text style={styles.sidebarRowQty}>{formatNum(r.quantity)} {r.unit}</Text>
                        <View style={[styles.sidebarRowPill, { backgroundColor: confColor + '15' }]}>
                          <Text style={[styles.sidebarRowPillText, { color: confColor }]}>{r.confidence}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US');
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export const TakeoffPageInspector = memo(TakeoffPageInspectorImpl);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  headerTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  headerSubtitle: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2 },
  zoomGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoomText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.textMuted, minWidth: 38, textAlign: 'center' },

  body: { flex: 1, flexDirection: 'column' },
  bodyWide: { flexDirection: 'row' },

  imageWrap: { flex: 1, backgroundColor: '#1a1a1a', position: 'relative' },
  imageWrapWide: { flex: 1 },
  imageScrollContent: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  imageLoading: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  imageLoadingText: { color: '#FFF', fontSize: Type.caption1.fontSize, opacity: 0.7 },

  pageNav: {
    position: 'absolute', top: '50%', marginTop: -22,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  pageNavLeft: { left: 12 },
  pageNavRight: { right: 12 },
  pagePill: {
    position: 'absolute', bottom: 12, alignSelf: 'center',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
    left: 0, right: 0, marginHorizontal: 'auto' as any,
  },
  pagePillText: { color: '#FFF', fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' },

  sidebar: {
    height: 240, padding: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  sidebarWide: { width: 320, height: '100%', borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: Colors.border },
  sidebarTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  sidebarHelper: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2, marginBottom: 8, lineHeight: 15 },
  sidebarScroll: { flex: 1 },
  sidebarEmpty: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontStyle: 'italic', paddingVertical: 12, textAlign: 'center' },
  sidebarRow: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    paddingVertical: 8, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  sidebarRowIcon: {
    width: 22, height: 22, borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  sidebarRowTitle: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: Colors.text, lineHeight: 16 },
  sidebarRowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sidebarRowQty: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  sidebarRowPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.full },
  sidebarRowPillText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});
