// components/proofPack/styles.ts — the look of the Proof of Work Package screens.
// Theme tokens only: no colour is written here. Flat: no gradient, no shadow.
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';

export const makeProofPackStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { ...Type.title3, color: t.text, flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 40, gap: 12, width: '100%' as const, maxWidth: Layout.page.form, alignSelf: 'center' as const },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, gap: 8 },
  lead: { fontSize: Type.subhead.fontSize, lineHeight: 21, fontWeight: '600' as const, color: t.text },
  para: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.textSecondary },
  note: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textMuted },
  heading: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.8, color: t.textMuted, textTransform: 'uppercase' as const },
  value: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  big: { ...Type.title2, color: t.text },
  strip: { flexDirection: 'row' as const, gap: 6 },
  stripCell: { flex: 1, alignItems: 'center' as const, gap: 4, paddingVertical: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg },
  stripCount: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  chip: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.neutralSoft },
  chipStrong: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  chipTextStrong: { color: t.accentLabel },
  ruleRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingVertical: 4 },
  ruleText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textSecondary },
  kindHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line, minHeight: 44 },
  rowOff: { opacity: 0.5 },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  rowSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  langRow: { flexDirection: 'row' as const, gap: 8 },
  lang: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.full, borderWidth: 1.5, borderColor: t.line, minHeight: 44, justifyContent: 'center' as const },
  langOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  langText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  langTextOn: { color: t.accentLabel },
  blocked: { backgroundColor: t.warningSoft, borderRadius: Tokens.radius.md, padding: 12 },
  blockedText: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.text },
  result: { backgroundColor: t.neutralSoft, borderRadius: Tokens.radius.md, padding: 12, gap: 4 },
  mono: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontVariant: ['tabular-nums' as const] },
  code: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, letterSpacing: 2, color: t.text },
  btnRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  entry: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, minHeight: 56 },
  entryMain: { flex: 1, gap: 2 },
});
