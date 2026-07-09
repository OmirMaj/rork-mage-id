# App-Wide AI-Slop Audit — MAGE ID

**Date:** 2026-07-06
**Scope:** The whole product — RN/Expo app (`constants/` tokens, `app/` screens, `components/`) + the marketing site (`marketing/`, excluding the just-redesigned homeowner portal).
**Method:** Four parallel read-only audits, each scoring surfaces against (a) the AI-slop tell kill-list and (b) MAGE's own warm-editorial brand identity (ink `#0B0D10` + amber `#FF6A1A` + cream + Fraunces / body / JetBrains Mono, flat surfaces, one accent).

---

## Executive summary

**The product is NOT AI-slop-forward.** The RN app's design-token foundation and UI primitives are premium-grade (comparable to Linear/Mercury/Things) — Fraunces + JetBrains Mono correctly loaded and used, an amber/ink/cream light+dark palette, a systematic 4pt spacing scale, a 3-tier shadow system, restrained radii, and `lucide-react-native` icons throughout. There is **no systemic redesign needed.**

The slop that exists is **surgical**: a handful of concrete tells that bypass the good system, plus one real brand-integrity gap on the marketing site. Total estimated effort to clear the high/medium items: **~3–5 developer-days.**

---

## Status (updated 2026-07-07)

All three HIGH findings are **shipped** on branch `claude/deslop-emoji-icons`. Each turned out broader than the four-agent sample originally caught — noted per item below.

| # | Finding | Status | Commit(s) | Actual scope vs. audit sample |
|---|---|---|---|---|
| **H1** | Purple/pink role colors | ✅ **DONE** | `78a552b`, `9beefea`, `89ae8b6` | Not 1 file — a **6-file cluster** (ContactPickerModal + contacts, rfi, punch-walk, plan-viewer, daily-report) plus the estimate "AI Found" tag. All purple/pink/violet now gone from `app/` + `components/`. |
| **H2** | Emoji-as-icons | ✅ **DONE** | `82e0828` | Not ~8 screens — **29 files** across `app/`, `components/`, `constants/`. UI layer now emoji-free; also removed the dead `emoji` field from `constants/materials.ts`. |
| **H3** | Marketing Fraunces unwired | ✅ **DONE** | `9200309` | `--ff-serif` → Fraunces in both stylesheets (+ imported it, + JetBrains Mono on landing); dropped the Inter fallback. Confirmed the headings already carried `opsz 144` variation-settings — Fraunces was the intended face all along. |

MEDIUM/LOW items (M1–M4, L1–L3) remain open. See the fix sequence below.

> **Branch note:** the de-slop fixes above + this updated audit live on `claude/deslop-emoji-icons`; the portal redesign + the *original* copy of this audit live on `claude/beautiful-hypatia-X5u4P`. When consolidating, the `deslop` branch holds the newer audit.

**Surface grades:**
| Surface | Grade | Headline |
|---|---|---|
| RN token/primitive layer | **A** | Exemplary; no slop |
| RN screens | **A−** → **A** | Emoji-as-icons (H2) cleared |
| RN components | **B+** → **A−** | Purple palette (H1) cleared; 2 hero gradients (M1) remain |
| Marketing site | **B−** → **B** | Fraunces now wired (H3); glassmorphism (M3) remains |
| Homeowner portal | **A** | Just redesigned (Renovation Journal) — reference standard |

**The single worst tell** (per the research, colored purple accents are "the most specific" AI-default signal) was `components/ContactPickerModal.tsx` assigning `#8B5CF6` (purple) and `#EC4899` (pink) to contact roles. ✅ **Fixed** — and the same purple turned out to be a 6-file cluster, all cleared (see Status above).

---

## Prioritized findings

### 🔴 HIGH — ✅ ALL FIXED (2026-07-07)

**H1 · Purple/pink rainbow role colors** — ✅ **DONE** (`78a552b`, `9beefea`, `89ae8b6`)
`getRoleColor()` in `ContactPickerModal.tsx` returned `#8B5CF6` (purple, Supplier), `#EC4899` (pink, Lender), `#1565C0` (blue, Architect) — the exact purple the kill-list names as the #1 AI-default tell. **A whole-repo grep found the same tell in 5 more files:** `app/contacts.tsx` (identical Supplier purple), `app/rfi.tsx` (architect/engineer `#7C3AED`), `app/punch-walk.tsx` (Roofing/Drywall `#8B5CF6`/`#A78BFA`, Painting `#EC4899`), `app/plan-viewer.tsx` (RFI pin `#8B5CF6`), `app/daily-report.tsx` (Operators tile `#A855F7`), plus the estimate "AI Found" tag (`#9333EA` — the "purple = AI" cliché).
→ **Fixed:** replaced with a shared muted warm-editorial palette (amber for client-side roles + AI; slate/olive/taupe/teal/ochre/stone for the rest), reused across all role/category maps so accents are now consistent app-wide. The "AI Found" tag went **amber** (aligns AI with the brand). `app/` + `components/` are now verified free of purple/pink/violet.

**H2 · Emoji used as icons** — ✅ **DONE** (`82e0828`) — landed as **29 files**, not ~8 (see Status)
Original sample: ~8 screens + 1 component
Text glyphs `✓` / `⚠️` / `!` / `💧` used where a lucide icon belongs:
- `app/buyout-package.tsx:~85,95` (template strings `✓ …`, `⚠️ Prequal…`)
- `app/buyout.tsx:~410,480` (`✓`, `⚠️`)
- `app/ai-punch.tsx:~550` (gallery + saved-flag `✓`)
- `app/daily-report.tsx:~520` (`✓ Showing…`)
- `app/oac-meeting.tsx:~620` (`'✓'`)
- `app/login.tsx:~334` (`✓ Check your inbox`)
- `app/prequal-form.tsx:~150` (`✓ Ready to submit`)
- `components/schedule/TodayView.tsx` (`💧` weather)
→ **Fixed:** swapped for `CheckCircle2` / `AlertTriangle` / `AlertCircle` / `Droplet` etc. from lucide (standalone glyphs → bare icons; inline-prefixed glyphs → icon+text rows; status ternaries → per-status icons). Emoji in comments stripped; emoji in export/email/print strings converted to clean text; dead `emoji` field removed from `constants/materials.ts`. Out of scope (flagged): `weatherService` condition-icon string map, email/PDF/ICS export templates, i18n language-picker flags. (Same tell the portal lint forbids — an app-side grep-guard is still worth adding; see Guardrail idea.)

**H3 · Marketing: Fraunces loaded but never used** — ✅ **DONE** (`9200309`)
Both stylesheets declared `--ff-serif: "Space Grotesk", "Inter", …` — a *sans-serif mislabeled as the serif*, falling back to **Inter** (a named kill-list font) — and never imported Fraunces in CSS, while `pricing.html`/`demo.html`/etc. never loaded it at all.
→ **Fixed:** imported Fraunces (`ital,opsz,wght 9..144`) in `styles.css` + `landing.css` so every page gets it via CSS regardless of its HTML `<link>` (also imported JetBrains Mono on `landing.css`, which declared `--ff-mono` but never loaded it); set `--ff-serif: "Fraunces", Georgia, serif`; dropped `Inter` from both `--ff-serif` and `--ff-sans`. Body stays Space Grotesk by design. Notably, the heading rules already carried `font-variation-settings: "opsz" 144` (a Fraunces-only axis) — confirming Fraunces was the intended display face and the tight negative tracking was tuned for it, so no letter-spacing retune was needed. **Recommend a local eyeball** of the headings once previewed.

### 🟡 MEDIUM — worth doing

**M1 · Decorative hero-CTA gradients** — `components/ClientHome.tsx:290–311` & `components/PropertyManagerHome.tsx:137–156`
Identical 3-stop orange gradient (`#FF6A1A → #E04E0E → #C73E00`) on the primary "Post a project" / "Add a property" CTAs, each with a decorative 12%-opacity `Building2` silhouette. These are the two most-seen home screens; a multi-stop gradient fill on the hero button is the app's softest slop tell.
→ **Fix:** solid `colors.accent` via the existing `Button` primitive; extract a shared `HeroCTA`. (The portal's thesis — one flat amber — applies here.)

**M2 · Glassmorphic rgba orbs** — `app/cash-flow.tsx:~1285+`
`heroGlowA/B` glow circles + 6 chips on `rgba(...,0.12–0.2)` fills stacked on the themed surface — reads as "premium SaaS filler." Not blurred, but the pattern.
→ **Fix:** flat surfaces + a single amber accent bar; use existing `accentSoft`/`successSoft` tokens instead of ad-hoc rgba.

**M3 · Marketing glassmorphism** — `marketing/playbook.html:42–43`, `marketing/features/index.html:64–66`
`backdrop-filter: blur(10px)` on sticky nav bars — the exact glassmorphism the portal redesign removed.
→ **Fix:** solid paper background + a bottom hairline (same move as the portal nav).

**M4 · Inline hex bypassing theme tokens** — 40+ instances across `components/` (`QuickUpdateClarifier`, `AIBidScorecard`, `AIWeeklySummary`, `AIEstimateValidator`, …)
Hardcoded `#2E7D44` / `#1565C0` / `#9AA3AD` / `#C84038` instead of `colors.success/info/textMuted/danger`. Not visible slop, but it breaks dark-mode theme inheritance and erodes the token system.
→ **Fix:** codemod inline hex → `colors.*` refs. Medium effort; do opportunistically.

### 🟢 LOW — cleanup / debt (not urgent)

**L1 · Shadow & radius drift** — 43 inline `shadowOpacity` values (0.05/0.06/0.18/0.2/0.22/0.25/0.28) and radii `20/28/32` outside the token scale (`components/AIBidScorer.tsx`, `VoiceCommandModal.tsx`, `Tutorial.tsx`, `ClientHome.tsx`, …). System is defined but not fully adopted. → Enforce `Tokens.shadow.*` / `Tokens.radius.*` in new code; migrate gradually.

**L2 · Stray `Colors.purple` badge** — `app/(tabs)/settings/index.tsx:~150` Takeoff quota badge uses the purple token. Semantic, low-visibility; align to amber if Takeoff is a hero feature.

**L3 · Apple system purple `#5856D6`** in `constants/colors.ts` for Books/status — intentional platform color, not a brand violation; leave unless it surfaces prominently.

---

## Cross-surface coherence note (a decision, not a bug)

The **display serif (Fraunces)** and **mono (JetBrains Mono)** are consistent across all three surfaces — good. But the **body font differs on every surface**:
- **Marketing:** Space Grotesk (currently mislabeled as the serif)
- **Portal:** Bricolage Grotesque (chosen in the redesign)
- **RN app:** system default (SF Pro / Roboto)

None of these is "slop" alone, but three different body voices is brand incoherence. **Recommend picking one body direction** (Bricolage reads most distinctive and pairs with Fraunces; system is the safest for a native app) and aligning the marketing CSS + portal to match, leaving the RN app on system if native-feel is preferred. Worth a deliberate call.

---

## Recommended fix sequence

1. ~~**H1** ContactPickerModal purple/pink → brand tonal~~ ✅ done (grew to a 6-file cluster)
2. ~~**H2** Emoji → lucide~~ ✅ done (29 files)
3. ~~**H3** Marketing Fraunces wiring~~ ✅ done
4. **M1** Hero-CTA gradients → flat amber `Button` + shared `HeroCTA` — ~half day ← **next**
5. **M3** Marketing glassmorphism removal — ~30 min
6. **M2** cash-flow orbs → flat — ~half day
7. **M4 / L1** Token-adoption codemods (inline hex, shadow/radius) — opportunistic, ~1–2 days

**Still open:** M1, M2, M3, M4, L1–L3. **Guardrail (H2/H1 follow-up):** an app-side grep-guard for emoji-in-JSX + purple/indigo hex + `Inter` in fonts — cheap regression insurance now that the surfaces are clean.

**Guardrail idea:** the portal shipped with `scripts/validate-portal-craft.ts` in `ship-check`. A trimmed RN-side check (grep for emoji-in-JSX, purple/indigo hex, `Inter` in fonts) would prevent regressions in the app the same way — cheap insurance now that the surfaces are clean.

---

## What's already excellent (do not touch)

- `constants/typography.ts` — Fraunces + JetBrains Mono, disciplined 8-size / 4-weight scale, no Inter/Roboto in app code.
- `constants/colors.ts` + `contexts/ThemeContext.tsx` — amber/ink/cream light+dark, theme-aware getters, 254+ components on `useThemedStyles()`.
- `constants/designTokens.ts` — 4pt spacing, 3-tier shadow (0.04/0.08/0.16), restrained radius, Apple continuous corners.
- `components/ui/{Button,Card,Input,Badge,IconWrapper}.tsx` — clean, token-driven, no hardcoded colors, Fraunces titles + mono metadata.
- `lucide-react-native` used consistently; gradients (onboarding, pipeline chart) are functional/brand-aligned, not decorative; BlurView limited to one functional modal backdrop.
