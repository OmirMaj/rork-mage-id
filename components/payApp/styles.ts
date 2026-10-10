// components/payApp/styles.ts — the look of Easier Pay Applications (Bill This
// Month, the Rejection Check, the spreadsheet import). Theme tokens only: no
// colour is written here. Flat: no gradient, no shadow.
//
// There is no green tick, no score and no "all clear" colour anywhere in this
// file on purpose: a check that found nothing is drawn in the muted ink.
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';

export const makePayAppStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  body: { paddingHorizontal: 16, paddingTop: 12, gap: 12, width: '100%' as const, maxWidth: Layout.page.form, alignSelf: 'center' as const },
  header: { gap: 2, paddingBottom: 4 },
  headerName: { ...Type.title2, color: t.text },
  headerSub: { fontSize: Type.subhead.fontSize, lineHeight: 20, color: t.textSecondary },
  preview: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.neutralSoft, marginTop: 4 },
  previewText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  lead: { fontSize: Type.subhead.fontSize, lineHeight: 21, color: t.textSecondary },
  note: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textMuted },
  heading: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.8, color: t.textMuted, textTransform: 'uppercase' as const, marginTop: 6 },

  // Period fields.
  periodCard: { ...cardSurface(t, { pad: 14 }), gap: 10 },
  fieldRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12 },
  fieldLabel: { fontSize: Type.subhead.fontSize, color: t.textSecondary, flex: 1 },
  fieldInput: { minWidth: 132, minHeight: 44, paddingHorizontal: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg, color: t.text, fontSize: Type.subhead.fontSize, textAlign: 'right' as const },
  fieldError: { fontSize: Type.caption1.fontSize, lineHeight: 17, color: t.dangerLabel },

  // One line of the schedule of values.
  line: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.line, gap: 8 },
  lineTop: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 8 },
  lineNo: { fontSize: Type.subhead.fontSize, color: t.textMuted, minWidth: 18 },
  lineName: { flex: 1, fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: t.text },
  lineValue: { fontSize: Type.subhead.fontSize, color: t.textSecondary, fontVariant: ['tabular-nums' as const] },
  lineMid: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  lineWas: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  pctInput: { width: 76, minHeight: 44, paddingHorizontal: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg, color: t.text, fontSize: Type.callout.fontSize, fontWeight: '600' as const, textAlign: 'center' as const },
  pctSign: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  lineAmount: { flex: 1, textAlign: 'right' as const, fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text, fontVariant: ['tabular-nums' as const] },
  lineAmountZero: { fontWeight: '400' as const, color: t.textMuted },
  lineDone: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textMuted },

  // A suggestion: dashed until the contractor acts on it.
  suggest: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.accent, backgroundColor: t.accentSoft },
  suggestMain: { flex: 1, gap: 2 },
  suggestText: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textSecondary },
  suggestFigure: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.accentLabel, fontVariant: ['tabular-nums' as const] },
  suggestRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line },
  tagText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.6, color: t.textSecondary, textTransform: 'uppercase' as const },

  // Footer of Bill This Month.
  footer: { borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surfaceAlt, paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  footerInner: { width: '100%' as const, maxWidth: Layout.page.form, alignSelf: 'center' as const, gap: 6 },
  totalRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'baseline' as const, gap: 12 },
  totalLabel: { fontSize: Type.subhead.fontSize, color: t.textSecondary, flex: 1 },
  totalValue: { fontSize: Type.subhead.fontSize, color: t.textSecondary, fontVariant: ['tabular-nums' as const] },
  dueLabel: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text, flex: 1 },
  dueValue: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text, fontVariant: ['tabular-nums' as const] },
  footerNote: { fontSize: Type.caption1.fontSize, lineHeight: 17, color: t.textMuted, textAlign: 'center' as const },
  linkBtn: { minHeight: 44, justifyContent: 'center' as const, alignSelf: 'flex-start' as const },
  linkText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.accentLabel },

  // Rejection Check.
  finding: { borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.warningLabel, backgroundColor: t.warningSoft, padding: 12, gap: 4 },
  findingName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  findingDetail: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textSecondary },
  findingLink: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.warningLabel },
  findingLinkBtn: { minHeight: 36, justifyContent: 'center' as const, alignSelf: 'flex-start' as const },
  cleanRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line },
  cleanLabel: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },
  cleanState: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  notChecked: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.textSecondary, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.line },
  notCheckedStrong: { fontWeight: '700' as const, color: t.text },
  actions: { gap: 8, paddingHorizontal: 16, paddingTop: 10 },

  // Spreadsheet in and out.
  toolRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  toolBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line },
  toolBtnOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  toolBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.text },
  pasteInput: { minHeight: 120, padding: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg, color: t.text, fontSize: Type.caption1.fontSize, textAlignVertical: 'top' as const },
  mapRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line, gap: 6 },
  mapLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  mapSample: { fontSize: Type.caption1.fontSize, lineHeight: 17, color: t.textMuted },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  chip: { minHeight: 36, minWidth: 36, paddingHorizontal: 10, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line },
  chipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  chipTextOn: { color: t.accentLabel },
  sumRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 12, paddingVertical: 4 },
  sumLabel: { fontSize: Type.subhead.fontSize, color: t.textSecondary, flex: 1 },
  sumValue: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text, fontVariant: ['tabular-nums' as const] },
  badRow: { fontSize: Type.caption1.fontSize, lineHeight: 18, color: t.dangerLabel },
  modeBtn: { borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, padding: 12, gap: 4, minHeight: 56 },
  modeName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  modeHint: { fontSize: Type.caption1.fontSize, lineHeight: 17, color: t.textSecondary },
});
