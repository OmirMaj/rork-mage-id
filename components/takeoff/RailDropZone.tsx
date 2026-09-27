// components/takeoff/RailDropZone.tsx — list-3 lane TK-c. A web drop target
// that wraps its children (the takeoff's sheet rail, or the first-run
// column): drag a PDF plan set from the desktop onto it and its pages become
// sheets, through the same checks as Plans' "Import PDF"
// (hooks/useTakeoffPdfDrop.ts).
//
// Web only. Native DOM listeners are attached on Platform.OS === 'web' and
// removed on unmount — the TakeoffCanvas pattern. On native nothing attaches
// and the children render exactly as before, plus an invisible wrapper.
//
// The overlay never takes pointer events: the drag events land on the
// children and bubble up to this wrapper's node.

import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { dragHasFiles, pdfDropVerdict } from '@/utils/takeoff/pdfDrop';
import type { TakeoffPdfDrop } from '@/hooks/useTakeoffPdfDrop';
// Re-exported so the workspace wires the drop with a single import line.
export { useTakeoffPdfDrop } from '@/hooks/useTakeoffPdfDrop';

export const DROP_PROMPT = 'Drop a PDF to add its sheets';
const NOTICE_MS = 4000;

export interface RailDropZoneProps {
  drop: TakeoffPdfDrop;
  /** Called with the created sheet ids after a successful drop. */
  onImported?: (ids: string[]) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

type Notice = { text: string; tone: 'refused' };

export default function RailDropZone({ drop, onImported, testID, style, children }: RailDropZoneProps) {
  const styles = useThemedStyles(makeStyles);
  const nodeRef = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The listeners are attached once; they read the latest props from here.
  const live = useRef({ drop, onImported });
  live.current = { drop, onImported };
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const node = nodeRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return undefined;
    let depth = 0;
    let alive = true;

    const flash = (n: Notice) => {
      if (!alive) return;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice(n);
      noticeTimer.current = setTimeout(() => { if (alive) setNotice(null); }, NOTICE_MS);
    };
    const typesOf = (e: DragEvent) => (e.dataTransfer ? Array.from(e.dataTransfer.types ?? []) : null);

    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(typesOf(e))) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(typesOf(e))) return;
      // Without this the browser opens the PDF in the tab instead of dropping.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = live.current.drop.blockReason ? 'none' : 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(typesOf(e))) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(typesOf(e))) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const { drop: d } = live.current;
      if (d.importing) return;
      // A blocked seat: the drop does nothing but say why.
      if (d.blockReason) { flash({ text: d.blockReason, tone: 'refused' }); return; }
      const files = Array.from(e.dataTransfer?.files ?? []);
      const verdict = pdfDropVerdict(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (!verdict.ok) { flash({ text: verdict.reason, tone: 'refused' }); return; }
      // The done line ("<n> sheets added — number the sheets in Plans") is
      // the hook's status, so it shows even where this zone was remounted.
      void d.importFile(files[verdict.index]).then((ids) => {
        if (alive && ids.length > 0) live.current.onImported?.(ids);
      });
    };

    node.addEventListener('dragenter', onEnter);
    node.addEventListener('dragover', onOver);
    node.addEventListener('dragleave', onLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      alive = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      node.removeEventListener('dragenter', onEnter);
      node.removeEventListener('dragover', onOver);
      node.removeEventListener('dragleave', onLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, []);

  // What the overlay says, most urgent first.
  const line = drop.importing
    ? (drop.status || 'Uploading PDF…')
    : dragging
      ? (drop.blockReason ?? DROP_PROMPT)
      : notice?.text ?? (drop.status || null);
  const refused = !drop.importing && (dragging ? !!drop.blockReason : !!notice);

  return (
    <View ref={nodeRef} style={[styles.zone, style]} testID={testID}>
      {children}
      {line ? (
        <View style={styles.overlay} pointerEvents="none" testID="takeoffws-drop-overlay">
          <View style={styles.scrim} />
          <View style={[styles.frame, refused && styles.frameRefused]}>
            <Text style={[styles.line, refused && styles.lineRefused]} accessibilityLiveRegion="polite">{line}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  zone: { position: 'relative', flexDirection: 'row', minHeight: 0 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Layout.rowGap,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg, opacity: 0.92 },
  frame: {
    ...StyleSheet.absoluteFillObject,
    margin: Layout.rowGap,
    borderWidth: 2,
    borderColor: t.accent,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Layout.cardPad,
  },
  frameRefused: { borderColor: t.danger },
  line: { ...Type.bodyCompactEmphasized, color: t.text, textAlign: 'center' },
  lineRefused: { color: t.dangerLabel },
});
