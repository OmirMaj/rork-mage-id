// MAGE ID custom icon system. See docs/icon-audit.md for the strategy.
//
// - MageIcon: wrapper that enforces one stroke + size scale on lucide icons.
// - MageAIMark: the ONE proprietary "AI"/Brain mark — A-frame + I-beam + amber
//   spark (the drop-in replacement for the Sparkles/Wand2/Zap/Bot clichés).
//   MageCraneBuild (components/) is the animated counterpart.
// Bespoke construction domain glyphs (RFI / Submittal / Pay App / Takeoff / …)
// land here as Phase 2 ships them.

export { default as MageIcon, MAGE_STROKE, IconSize } from './MageIcon';
export { default as MageAIMark } from './MageAIMark';
// Bespoke construction glyph set (tab bar + core domain docs) — icon-audit §4.
export {
  MageProject, MageDiscover, MageSummary,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder,
  MageTakeoff, MageSchedule, MageEstimate, MageMargin,
  MagePlans, MageCostDb, MageMaterials, MageEquipment, MagePunch,
  MageInvoice, MageDailyReport, MageContract, MageCOI,
} from './glyphs';
