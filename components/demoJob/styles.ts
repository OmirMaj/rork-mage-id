// components/demoJob/styles.ts — the look of the owner's Demo Job builder.
// Theme tokens only: no colour is written here. Flat: no gradient, no blur.
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { cardSurface } from '@/components/ui/Card';

export const makeDemoJobStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerMain: { flex: 1 },
  headerName: { ...Type.serifHeadline, color: t.text },
  headerSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  stack: { gap: 12 },
  narrow: { width: '100%' as const, maxWidth: Layout.page.form, gap: 12 },
  panel: { ...cardSurface(t, { pad: 14 }), gap: 10 },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.8, color: t.textMuted, textTransform: 'uppercase' as const },
  para: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.textSecondary },
  note: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textMuted },
  noteStrong: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.text, fontWeight: '600' as const },
  warn: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.warningLabel },
  toolbar: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 8 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.line },
  rowFirst: { borderTopWidth: 0, paddingTop: 0 },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  rowLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  rowSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },
});
