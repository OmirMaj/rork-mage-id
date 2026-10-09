// components/roomScan/styles.ts — the shared look of the Scan The Room screens.
// Theme tokens only: no colour is written here.
import { StyleSheet } from 'react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export const makeRoomScanStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { ...Type.title3, color: t.text, flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  title: { ...Type.title2, color: t.text },
  sub: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  para: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.textSecondary },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, gap: 10 },
  cardHeading: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const, gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line },
  rowFirst: { borderTopWidth: 0, paddingTop: 0 },
  rowMain: { flex: 1, gap: 2 },
  rowLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  rowSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  rowValue: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  rowUnit: { fontSize: Type.caption1.fontSize, fontWeight: '400' as const, color: t.textMuted },
  strip: { flexDirection: 'row' as const, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 12 },
  stripCell: { flex: 1, gap: 2 },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.8, color: t.textMuted, textTransform: 'uppercase' as const },
  stripValue: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  note: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textMuted },
  factRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  factText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textSecondary },
  factCheck: { color: t.warningLabel },
  // plan
  planBox: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const },
  dim: { position: 'absolute' as const, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line },
  dimTyped: { borderColor: t.accent },
  dimLow: { borderColor: t.warningLabel, borderStyle: 'dashed' as const },
  dimText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  legendRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  legendSwatch: { width: 18, height: 0, borderTopWidth: 2, borderColor: t.accent },
  legendSwatchLow: { borderColor: t.warningLabel, borderStyle: 'dashed' as const },
  // inputs
  input: { borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.body.fontSize, color: t.text, backgroundColor: t.bg },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.full, borderWidth: 1.5, borderColor: t.line },
  chipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  chipTextOn: { color: t.accentLabel },
  linkBtn: { paddingVertical: 6 },
  linkText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  // price source pill
  pill: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm, backgroundColor: t.neutralSoft },
  pillOwn: { backgroundColor: t.successSoft },
  pillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  pillTextOwn: { color: t.successLabel },
  lineOut: { opacity: 0.5 },
  total: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, justifyContent: 'space-between' as const, gap: 12 },
  totalValue: { ...Type.title1, color: t.text },
  blocked: { backgroundColor: t.warningSoft, borderRadius: Tokens.radius.md, padding: 12 },
  blockedText: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.warningLabel },
  errorText: { fontSize: Type.caption1.fontSize, color: t.dangerLabel },
  okText: { fontSize: Type.caption1.fontSize, color: t.successLabel },
  // order list
  choice: { gap: 6 },
  qtyCol: { alignItems: 'flex-end' as const, gap: 2, maxWidth: 130 },
  legendBox: { width: 14, height: 14, borderWidth: 1, borderColor: t.text, backgroundColor: t.surfaceAlt },
  legendBoxOffcut: { flexDirection: 'row' as const, justifyContent: 'space-evenly' as const },
  legendStripe: { width: 1, alignSelf: 'stretch' as const, backgroundColor: t.textMuted },
  legendBoxCut: { backgroundColor: t.bg, borderColor: t.textMuted, borderStyle: 'dashed' as const },
  legendBoxShape: { backgroundColor: t.bg, borderColor: t.accent, borderWidth: 2 },
  // sheet
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: Colors.overlay },
  sheet: { backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 20, gap: 12 },
  sheetTitle: { ...Type.title3, color: t.text },
  sheetActions: { flexDirection: 'row' as const, gap: 10, justifyContent: 'flex-end' as const },
});

export type RoomScanStyles = ReturnType<typeof makeRoomScanStyles>;
