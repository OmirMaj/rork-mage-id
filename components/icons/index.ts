// MAGE ID custom icon system. See docs/icon-audit.md for the strategy.
//
// - MageIcon: wrapper that enforces one stroke + size scale on lucide icons.
// - MageIntelligence: the proprietary "AI" mark — a drafting compass + amber
//   spark (replaces the Sparkles cliché).
// Bespoke construction domain glyphs (RFI / Submittal / Pay App / Takeoff / …)
// land here as Phase 2 ships them.

export { default as MageIcon, MAGE_STROKE, IconSize } from './MageIcon';
export { default as MageIntelligence } from './MageIntelligence';
// MageAIMark: the static "AI" + amber-spark glyph (crane end-frame) — the
// drop-in replacement for the Sparkles/Wand2/Zap/BrainCircuit/Lightbulb/Bot
// clichés. MageCraneBuild (components/) is the animated counterpart.
export { default as MageAIMark } from './MageAIMark';
// Bespoke construction glyph set (tab bar + core domain docs) — icon-audit §4.
export {
  MageProject, MageDiscover, MageSummary,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder,
  MageTakeoff, MageSchedule, MageEstimate, MageMargin,
  MagePlans, MageCostDb, MageMaterials, MageEquipment, MagePunch,
  MageInvoice, MageDailyReport, MageContract, MageCOI,
} from './glyphs';
