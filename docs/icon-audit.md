# Icon Audit — making MAGE ID look built-for-construction, not vibe-coded

**Verdict:** the app currently renders **151 distinct stock `lucide-react-native` icons across 266 files, with zero custom iconography** (`react-native-svg` is used only for charts). That's the exact "modern SaaS starter-kit" look — clean, competent, and indistinguishable from every other 2024-26 app. Below is the data, the four specific tells, and a phased plan to make the icon language feel hand-built for the trade.

> **Process note (important):** icons are visual craft and this audit was done in a headless environment (no rendering). The plan below is real and buildable, but the *bespoke glyphs must be reviewed on-device and iterated from screenshots* — shipping 150 blind custom drawings would risk looking worse than clean lucide. The right order is: system → flagship icon → review → roll out the set. Phase 1 (the foundation + the AI mark) is built; the rest is speced for review.

---

## 1. The data

- **266** files import lucide; **151** distinct icons in use.
- Most-used: `X` (41), `ChevronRight` (33), `CheckCircle2` (29), **`Sparkles` (28)**, `AlertTriangle` (28), `ChevronLeft` (25), `TrendingUp` (16), `DollarSign` (13).
- **Construction-native icons are rare:** `HardHat` (7), `Hammer` (4), `Wrench` (3), `CloudRain` (4) — a tiny fraction of 151.
- **Stroke weight is set in only 95/266 files** — the other 171 use lucide's default 2.0. So the app mixes 1.6 / 1.8 / 2.0 / 2.4 with no system.

## 2. The four tells (ranked by how loudly they say "vibe-coded")

### Tell #1 — the AI-magic cliché (53 instances) 🔴 loudest
`Sparkles` (28) + `Wand2` (7) + `Zap` (6) + `BrainCircuit` (5) + `Lightbulb` (5) + `Bot` (2) = **53 generic "AI" glyphs** across ~20 screens (estimate-wizard, plan-intelligence, ai-punch, scope-sheet, bid-leveling, extract-submittals, daily-report, …). **Sparkles-for-AI is *the* signature of an AI-wrapper app.** Every competitor uses it. It says "we bolted on an LLM," not "we understand construction."
**Fix:** one distinctive, proprietary **MAGE intelligence mark** used everywhere AI appears — so your AI reads as *yours*, construction-grade, not a stock sparkle.

### Tell #2 — the generic tab bar 🔴
The bottom nav — your single most-seen surface — is `LayoutDashboard` (Summary), `Home` (Projects), `Compass` (Discover), `Settings`. These are the four most generic icons in software. A contractor's thumb lives on this bar all day and it looks like a fintech demo.
**Fix:** a bespoke construction tab set (e.g., Projects → a job-site/structure mark; Discover → a transit/level mark; Summary → a stacked-WIP mark) with the existing focus-stroke animation kept.

### Tell #3 — construction concepts wearing paper clothes 🟠
`RFI`, `Submittal`, and `AIA Pay App` **all render the identical `FileText`** (size 36, accent, stroke 1.6). Daily Report = `ClipboardList`. There's no trade metaphor *and* it's a usability bug — three core, distinct documents look identical. The whole domain vocabulary (takeoff, buyout, punch, lien waiver, change order, COI, draw) is drawn in generic office icons.
**Fix:** a distinct, trade-true glyph per core concept (table in §4).

### Tell #4 — no unified treatment 🟠
Stroke weights are scattered (171 files at default 2.0; others 1.6–2.4), sizes are ad-hoc, and there's no "featured/AI" accent system. Even good icons look unsystematic.
**Fix:** a single `<MageIcon>` wrapper that enforces one stroke (1.75), a fixed size scale, and an optional amber "featured" treatment — so every icon, custom or lucide, shares a hand.

## 3. The strategy — draw the ~30 that carry meaning, systematize the rest

Do **not** hand-draw all 151. The winning move is a hybrid:
1. **A custom icon *system*** (`components/icons/`) on `react-native-svg` (already a dependency) — enforces consistent stroke/size and a featured-accent treatment. Routes lucide through it too, fixing Tell #4 app-wide cheaply.
2. **A bespoke construction *glyph set*** for the ~30 brand-defining icons: the AI mark, the tab bar, and the core domain concepts (§4). These are what make it feel hand-built.
3. **Keep clean lucide for pure-utility UI** — `X`, chevrons, `Check`, `Trash2`, `Search`. Nobody reads a close button as "generic"; spending custom craft there is wasted. Just route them through the wrapper for a consistent stroke.

This concentrates effort where it changes perception (AI, tab bar, domain) and leaves the boring 120 icons clean and consistent.

## 4. Domain remap — construction glyphs to draw

Each gets a custom SVG (described); interim lucide fallback noted so nothing looks unfinished mid-rollout.

| Concept | Today | Bespoke construction glyph (to draw) | Interim |
|---|---|---|---|
| **MAGE AI** | Sparkles ×28 | A surveyor's reticle / level-bubble crosshair with a single amber spark — "precision intelligence" | ✅ built |
| RFI | FileText | A document with a **?** punched out + a fold | `FileQuestion` |
| Submittal | FileText | A stamped sheet (approval stamp corner) | `FileCheck2` |
| AIA Pay App | FileText | A draw/$ on a lined G703 grid | `ReceiptText` |
| Change Order | FileText | A document with a **±/Δ** delta mark | `FileDiff` |
| Daily Report | ClipboardList | A clipboard with weather + sun corner | `ClipboardList` (ok) |
| Takeoff | — | A measured area with dimension ticks | `Ruler` |
| Buyout | — | A handshake over a line-item bracket | `Handshake` |
| Punch list | — | A checklist with a dropped pin | `ListChecks` |
| Lien waiver | — | A signed seal / ribbon | `BadgeCheck` |
| Schedule | Activity/Zap | Gantt bars with a milestone diamond | `GanttChart` |
| Estimate | — | A grid with a running total + amber line | `Calculator` |
| Margin/Risk | TrendingUp | A gauge needle in the amber band | `Gauge` |
| Plans/Markup | — | A rolled blueprint with a pin | `Map`/`Scroll` |
| Cost Database | — | Stacked price tags / a ledger spine | `Library` |
| Project | Home | A framed structure (stud wall + roof line) | `Building2` |
| Subcontractor | Users | A hard-hat figure | `HardHat` |
| Inspection/COI | Shield | A shield with a checkmark seal | `ShieldCheck` |
| Weather | CloudRain | (keep — already trade-apt) | `CloudRain` ✅ |
| Materials | — | A pallet / stacked brick | `Boxes`/`BrickWall` |
| Equipment | — | An excavator/forklift silhouette | `Forklift` |

## 5. Treatment standards (the system)

- **Stroke:** 1.75 default (between lucide 2.0 and the 1.6 used on header icons — reads refined, not thin). Tab bar keeps the focus animation (1.8 → 2.4).
- **Size scale:** 14 (inline), 18 (row), 24 (action), 36 (screen header). No ad-hoc sizes.
- **Color:** inherit `currentColor`; `featured` variant = amber `#FF6A1A` glyph in a soft amber container (the AI + primary-action treatment).
- **Corner/joint language:** rounded joins, but a *slightly squarer* terminal than lucide's fully-round caps — subtly more "engineered/blueprint," less "soft startup."

## 6. Phased rollout

- **Phase 1 — DONE:** icon-system foundation (`components/icons/`) + the flagship **MAGE AI mark** (now the animated `MageCraneBuild` bubble + static `MageAIMark`), wired in.
- **Phase 1.5 — DONE:** the AI-cliché sweep — Sparkles/Wand2/Zap/BrainCircuit/Lightbulb/Bot → `MageAIMark` across ~90 files (Tell #1); the house loader → `MageBuildScene` (a crane erecting a building) on the full-screen loader.
- **Phase 2 — DONE:** the bespoke construction glyph set (`components/icons/glyphs.tsx`): tab bar (Projects/Discover/Summary via `MageProject`/`MageDiscover`/`MageSummary`) + domain glyphs (RFI, Submittal, Pay App, Change Order, Takeoff, Schedule, Estimate, Margin, Plans, Cost DB, Materials, Equipment, Punch). Wired into the tab bar, the desktop sidebar nav, and the RFI/Submittal/Pay-App screen headers (fixing the triple-`FileText`).
- **Phase 3 — DONE (stroke):** stroke normalized to **1.75** across ~239 files / ~2,345 usages via AST codemod, preserving intentional strokes (tab focus cue). Long-tail per-screen domain headers can keep adopting glyphs incrementally.
- **Phase 4 (optional, not done):** a matching custom app icon + splash refresh so the home-screen mark shares the language.

## 7. What this is NOT
Not a reskin for its own sake. The goal is that a contractor's first 10 seconds in the app *feel* like a tool built by people who've been on a site — distinct AI, trade-true documents, a tactile tab bar — instead of a clean LLM wrapper. That perception is worth more than any single feature for a launch.
