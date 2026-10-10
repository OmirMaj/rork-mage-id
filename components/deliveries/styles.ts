// components/deliveries/styles.ts — the one style sheet of Deliveries That
// Follow The Schedule (lane DELIVERIES-1). Theme tokens only: no hex colour
// but the scrim, no gradient, no blur.
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export const makeDeliveriesFollowStyles = (t: ThemeColors) => StyleSheet.create({
  block: { gap: 10 },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4 },
  eyebrow: { ...Type.monoCaption, letterSpacing: 1, textTransform: 'uppercase' as const, color: t.textMuted, flex: 1 },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt },
  chipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  chipWarn: { borderColor: t.warningLabel + '55', backgroundColor: t.warningSoft },
  chipWarnText: { color: t.warningLabel },
  chipDanger: { borderColor: t.dangerLabel + '55', backgroundColor: t.dangerSoft },
  chipDangerText: { color: t.dangerLabel },

  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, gap: 4 },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconTile: { width: 34, height: 34, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.accent + '55', alignItems: 'center' as const, justifyContent: 'center' as const },
  cardTitles: { flex: 1 },
  cardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  cardMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  // The screen's own Confirm and Received, on the one row a linked delivery has.
  cardActions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 8, paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: t.line },
  flagGroup: { gap: 6 },

  // One date, always with the line that says where it came from.
  dateRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingTop: 9, marginTop: 6, borderTopWidth: 1, borderTopColor: t.line },
  dateLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, paddingTop: 1 },
  dateValues: { flex: 1, alignItems: 'flex-end' as const },
  dateValueLine: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 6, flexWrap: 'wrap' as const, justifyContent: 'flex-end' as const },
  dateValue: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'right' as const },
  dateWas: { fontSize: Type.caption1.fontSize, color: t.textMuted, textDecorationLine: 'line-through' as const },
  dateBasis: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'right' as const, lineHeight: 15, marginTop: 1 },

  // A flag: a bar in form as well as colour, so it does not rest on colour alone.
  flag: { flexDirection: 'row' as const, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const },
  flagBar: { width: 4 },
  flagBody: { flex: 1, padding: 13, gap: 3 },
  flagEyebrow: { ...Type.monoCaption, letterSpacing: 0.9, textTransform: 'uppercase' as const },
  flagHead: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text, lineHeight: 20 },
  flagFoot: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  sectionLabel: { ...Type.monoCaption, letterSpacing: 1, textTransform: 'uppercase' as const, color: t.textMuted, marginTop: 6 },
  orderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.line },
  orderText: { flex: 1 },
  orderTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  orderSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  orderSubPast: { color: t.dangerLabel, fontWeight: '700' as const },

  note: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, textAlign: 'center' as const },
  body: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  btn: { minHeight: 46, borderRadius: Tokens.radius.lg, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 16, flexDirection: 'row' as const, gap: 8 },
  btnPrimary: { backgroundColor: t.accentFill },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
  btnOutline: { borderWidth: 1, borderColor: t.accent, backgroundColor: t.surface },
  btnOutlineText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  btnQuiet: { borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
  btnQuietText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  btnSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: Tokens.radius.md },
  btnOff: { opacity: 0.45 },

  // Sheets (the app's modal pattern: a bottom sheet on the phone, a centred card on a desk).
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  sheet: { backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, maxHeight: '92%' },
  sheetHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingBottom: 8 },
  sheetBack: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
  sheetTitle: { flex: 1, ...Type.serifHeadline, color: t.text },
  sheetSide: { fontSize: Type.caption1.fontSize, color: t.textSecondary, maxWidth: 140 },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { gap: 10, paddingBottom: 8 },

  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 10, marginBottom: 6 },
  fieldHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4, lineHeight: 15 },
  input: { borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text, backgroundColor: t.surface },
  inputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  inputNarrow: { width: 90, textAlign: 'center' as const },
  pick: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  pickText: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },
  option: { minHeight: 40, justifyContent: 'center' as const, paddingHorizontal: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
  optionOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  optionText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  optionSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },
  optionRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  taskList: { maxHeight: 220, gap: 6 },
  stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepVal: { minWidth: 44, textAlign: 'center' as const, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  // The preview's bars: dashed = where the task was, solid = where it would be.
  barRow: { marginTop: 8 },
  barHead: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 8 },
  barTitle: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  barDelta: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  barTrack: { height: 12, borderRadius: Tokens.radius.xs, backgroundColor: t.surfaceAlt, marginTop: 4 },
  barWas: { position: 'absolute' as const, top: 1, height: 10, borderRadius: Tokens.radius.xs, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.textMuted },
  barNow: { position: 'absolute' as const, top: 1, height: 10, borderRadius: Tokens.radius.xs },

  historyRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.line },
  historyText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  banner: { margin: 12, padding: 12, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.accent + '55', backgroundColor: t.surface, gap: 6 },
  bannerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, flexWrap: 'wrap' as const },
});

export type DeliveriesFollowStyles = ReturnType<typeof makeDeliveriesFollowStyles>;
