#!/usr/bin/env python3
"""
generate_bundles.py — Packs the MAGE ID codebase into ~15 topical bundles
so the whole project fits into Claude Projects as uploadable context files.

Each bundle is a single .md file with:
  - A header that explains what subsystem this bundle covers and how it
    plugs into the rest of the app.
  - A table of contents.
  - One section per source file: the relative path as a heading, then the
    file contents in a fenced code block (tsx/ts).

Run:
    python3 scripts/generate_bundles.py

Output:
    bundles/00-OVERVIEW.md
    bundles/01-FOUNDATIONS.md
    ...
    bundles/INDEX.md   (master index)

The generator is idempotent — rerun it any time the code changes.
"""

from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "bundles"
OUT_DIR.mkdir(exist_ok=True)


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"<!-- could not read {p}: {e} -->"


def ext_for_fence(p: Path) -> str:
    s = p.suffix.lower()
    return {
        ".tsx": "tsx", ".ts": "ts", ".js": "js", ".jsx": "jsx",
        ".json": "json", ".md": "markdown", ".mjs": "js", ".cjs": "js",
    }.get(s, "")


def section(title: str, body: str) -> str:
    return f"\n## {title}\n\n{body}\n"


def file_section(rel_path: str, src: str) -> str:
    fence = ext_for_fence(Path(rel_path))
    return f"\n---\n\n### `{rel_path}`\n\n```{fence}\n{src}\n```\n"


def expand(patterns: list[str]) -> list[Path]:
    """Resolve a list of relative paths, dirs, or globs into ordered file paths."""
    out: list[Path] = []
    seen: set[Path] = set()
    for pat in patterns:
        p = ROOT / pat
        if p.is_file():
            if p not in seen:
                out.append(p); seen.add(p)
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and f.suffix in {".ts", ".tsx", ".js", ".json", ".md"}:
                    if f not in seen:
                        out.append(f); seen.add(f)
        else:
            # treat as glob
            for f in sorted(ROOT.glob(pat)):
                if f.is_file() and f not in seen:
                    out.append(f); seen.add(f)
    return out


def write_bundle(
    filename: str,
    title: str,
    overview: str,
    files: list[Path],
    extra_sections: list[tuple[str, str]] | None = None,
):
    parts: list[str] = []
    parts.append(f"# {title}\n")
    parts.append("\n> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.\n")
    parts.append(f"\n## Overview\n\n{overview}\n")

    # TOC
    parts.append("\n## Files in this bundle\n")
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        parts.append(f"- `{rel}`")
    parts.append("")

    if extra_sections:
        for t, b in extra_sections:
            parts.append(section(t, b))

    # File contents
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        parts.append(file_section(rel, read_text(f)))

    (OUT_DIR / filename).write_text("\n".join(parts), encoding="utf-8")


# ============================================================================
# BUNDLE DEFINITIONS
# ============================================================================

BUNDLES = []


def bundle(filename, title, overview, patterns, extras=None):
    BUNDLES.append((filename, title, overview, patterns, extras or []))


# ---------- 00: OVERVIEW ----------
bundle(
    "00-OVERVIEW.md",
    "MAGE ID — Project Overview & Build Config",
    """MAGE ID is a React Native / Expo construction-management app. iOS is the
primary target; Android and web are supported. This bundle contains the
project-level config and guidance files — read it **first** before any
subsystem bundle.

Stack at a glance:
- **Expo SDK 54** (new architecture on), Expo Router 6 (typed routes).
- **Bun** as the package manager; scripts shell out to `expo start`.
- **EAS** for native builds, submissions, and OTA updates (runtime `appVersion`).
- **State**: Zustand for UI, TanStack Query + tRPC for server, context providers
  for cross-screen domain state.
- **Persistence**: AsyncStorage with `buildwise_*` (legacy) and `tertiary_*`
  (newer) key prefixes. Writes go through an offline queue that replays when
  connectivity returns.
- **Subscription gating** via RevenueCat (`react-native-purchases`); a single
  `useTierAccess` hook is the authoritative gate.
- **Bundle IDs**: `com.mageid.app` (iOS), `app.mageid.android` (Android).
- **Deep-link scheme**: `rork-app://` (legacy, still baked into TestFlight
  builds; do not rename without a native rebuild).""",
    [
        "CLAUDE.md",
        "README.md",
        "package.json",
        "app.json",
        "eas.json",
        "tsconfig.json",
        "metro.config.js",
        "babel.config.js",
        "eslint.config.js",
        ".eslintrc.json",
        "expo-env.d.ts",
    ],
)

# ---------- 01: FOUNDATIONS (routing + layout + desktop shell) ----------
bundle(
    "01-FOUNDATIONS.md",
    "Foundations — Routing, Layouts & Desktop Shell",
    """The provider stack, tab routing, and desktop sidebar live here. Read
this bundle second.

- `app/_layout.tsx` is the single root. It mounts the provider stack
  (QueryClient → GestureHandler → Theme → Auth → Subscription → Project →
  Bids → Companies → Hire → Notification → OfflineSyncManager → RootLayoutNav)
  and declares every `Stack.Screen` (30+ routes). Context order matters:
  anything below Auth gets the current user.
- `app/(tabs)/_layout.tsx` defines the mobile bottom-tab bar; hidden routes
  use `href: null`.
- `components/DesktopSidebar.tsx` is the primary nav on wide screens.
  Keep the sidebar in sync with the tab bar when adding/removing destinations.
- `app/+native-intent.tsx` and `app/+not-found.tsx` handle deep-link intents
  and unmatched routes.""",
    [
        "app/_layout.tsx",
        "app/(tabs)/_layout.tsx",
        "app/(tabs)/(home)/_layout.tsx",
        "app/(tabs)/bids/_layout.tsx",
        "app/(tabs)/companies/_layout.tsx",
        "app/(tabs)/construction-ai/_layout.tsx",
        "app/(tabs)/equipment/_layout.tsx",
        "app/(tabs)/estimate/_layout.tsx",
        "app/(tabs)/hire/_layout.tsx",
        "app/(tabs)/marketplace/_layout.tsx",
        "app/(tabs)/materials/_layout.tsx",
        "app/(tabs)/schedule/_layout.tsx",
        "app/(tabs)/settings/_layout.tsx",
        "app/(tabs)/subs/_layout.tsx",
        "app/(tabs)/summary/_layout.tsx",
        "components/DesktopSidebar.tsx",
        "app/+native-intent.tsx",
        "app/+not-found.tsx",
        "app/index.tsx",
        "utils/useResponsiveLayout.ts",
        "utils/useWebEnhancements.ts",
    ],
)

# ---------- 02: TYPES & CONSTANTS ----------
bundle(
    "02-TYPES-CONSTANTS.md",
    "Types & Constants",
    """`types/index.ts` is the **single source of truth for domain types**
(Project, Estimate, ChangeOrder, Invoice, DailyReport, PunchItem, Photo, RFI,
Submittal, Warranty, PortalMessage, etc). Contexts, backend, and UI all import
from here — extending any domain object means editing this file first.

Constants are split by theme/domain:
- `constants/colors.ts` — design tokens + custom theme override hook.
- `constants/assemblies.ts`, `materials.ts`, `laborRates.ts`,
  `productivityRates.ts`, `squareFootCosts.ts`, `regions.ts`, `states.ts`,
  `trades.ts`, `certifications.ts` — estimating and construction reference
  data.
- `constants/estimateTemplates.ts`, `scheduleTemplates.ts` — seed templates
  used by the wizard and auto-schedule features.""",
    [
        "types/index.ts",
        "constants/colors.ts",
        "constants/assemblies.ts",
        "constants/materials.ts",
        "constants/laborRates.ts",
        "constants/productivityRates.ts",
        "constants/squareFootCosts.ts",
        "constants/regions.ts",
        "constants/states.ts",
        "constants/trades.ts",
        "constants/certifications.ts",
        "constants/estimateTemplates.ts",
        "constants/scheduleTemplates.ts",
    ],
)

# ---------- 03: CONTEXTS / DOMAIN STATE ----------
bundle(
    "03-CONTEXTS.md",
    "Contexts — Cross-Screen Domain State",
    """All domain state providers, built with `@nkzw/create-context-hook`
(`createContextHook`) which generates a `Provider` + typed hook pair. Provider
order is defined in `app/_layout.tsx`:

```
Auth → Subscription → Project → Bids → Companies → Hire → Notification
```

Highlights:
- **`ProjectContext`**: central project store. Owns `projects`, the `linkedEstimate`
  draw-down logic, and all `tertiary_*` sub-collections (change orders, invoices,
  daily reports, punch items, photos, RFIs, submittals, warranties, portal
  messages). All writes go through `utils/offlineQueue.ts` so they survive
  dropped connections.
- **`SubscriptionContext`**: RevenueCat tiers (free / Pro / Business). Features
  gate through `hooks/useTierAccess.ts`, never through raw entitlements.
- **`AuthContext`**: Supabase auth session + user object.""",
    [
        "contexts/AuthContext.tsx",
        "contexts/SubscriptionContext.tsx",
        "contexts/ProjectContext.tsx",
        "contexts/BidsContext.tsx",
        "contexts/CompaniesContext.tsx",
        "contexts/HireContext.tsx",
        "contexts/NotificationContext.tsx",
        "hooks/useTierAccess.ts",
    ],
)

# ---------- 04: AUTH / ONBOARDING / PAYWALL ----------
bundle(
    "04-AUTH-PAYWALL.md",
    "Auth, Onboarding, Subscription Paywall",
    """Everything on the pre-authenticated path plus the RevenueCat paywall.

- `app/login.tsx`, `app/signup.tsx`, `app/reset-password.tsx` — Supabase
  email/password and SSO flows.
- `app/onboarding.tsx`, `app/onboarding-paywall.tsx` — first-run experience
  with the RevenueCat paywall immediately after.
- `app/paywall.tsx` + `components/Paywall.tsx` — in-app upgrade sheet.
- `hooks/useTierAccess.ts` — the single gate. Never branch on raw RevenueCat
  entitlements from feature code.""",
    [
        "app/login.tsx",
        "app/signup.tsx",
        "app/reset-password.tsx",
        "app/onboarding.tsx",
        "app/onboarding-paywall.tsx",
        "app/paywall.tsx",
        "components/Paywall.tsx",
    ],
)

# ---------- 05: PROJECTS / HOME / PROJECT DETAIL ----------
bundle(
    "05-PROJECTS-HOME.md",
    "Projects — Home Tab & Project Detail",
    """The project list (home tab) and the Project Detail screen — the most
complex screen in the app. Project Detail uses a tile-grid + pageSheet-modal
pattern: the main screen shows section tiles; tapping one opens a pageSheet
modal with that section's content (Estimate, Schedule, Materials, Invoices,
Change Orders, Daily Reports, RFIs, Submittals, Warranties, Budget, Client
Portal, Team, etc).

**Important navigation rule**: navigating from inside the tile pageSheet must
first dismiss the sheet (`setActiveTile(null)` then a ~350 ms timeout on iOS)
before calling `router.push`/`replace`, otherwise the new screen mounts
BEHIND the sheet. `project-detail.tsx` implements this via `navigateFromTile`.""",
    [
        "app/(tabs)/(home)/index.tsx",
        "app/project-detail.tsx",
        "components/ProjectCard.tsx",
        "components/EmptyState.tsx",
        "components/ConstructionLoader.tsx",
    ],
)

# ---------- 06: ESTIMATES & MATERIALS ----------
bundle(
    "06-ESTIMATES-MATERIALS.md",
    "Estimates, Estimate Wizard & Materials",
    """Estimating — the core value prop of the app.

- `app/(tabs)/estimate/index.tsx` — the estimate builder. Includes a material
  picker modal (recently fixed: a ScrollView was added so tall popups reach
  their Add-to-Estimate CTA on short phones).
- `app/estimate-wizard.tsx` — a modal-presented wizard for new projects.
- `utils/estimator.ts` — estimating math; plugs into assemblies, labor rates,
  productivity rates.
- `components/AIQuickEstimate.tsx`, `AIEstimateValidator.tsx`,
  `SquareFootEstimator.tsx`, `EstimateComparison.tsx`,
  `CostBreakdownReport.tsx`, `ProductivityCalculator.tsx` — estimating UI
  helpers and AI assists.
- `app/(tabs)/materials/` — material catalogue by category.""",
    [
        "app/(tabs)/estimate/index.tsx",
        "app/estimate-wizard.tsx",
        "app/(tabs)/materials/index.tsx",
        "app/(tabs)/materials/[category].tsx",
        "utils/estimator.ts",
        "utils/materialDatabase.ts",
        "utils/materialFinder.ts",
        "components/AIQuickEstimate.tsx",
        "components/AIEstimateValidator.tsx",
        "components/SquareFootEstimator.tsx",
        "components/EstimateComparison.tsx",
        "components/CostBreakdownReport.tsx",
        "components/ProductivityCalculator.tsx",
    ],
)

# ---------- 07: SCHEDULE ----------
bundle(
    "07-SCHEDULE.md",
    "Schedule — Tasks, Gantt, CPM & AI Builder",
    """Scheduling subsystem.

- `app/(tabs)/schedule/index.tsx` — main schedule view (Gantt / Grid /
  Lookahead / Today toggles). Recently fixed: mobile date-picker modal was
  missing; `extraModals` is now shared between desktop and mobile render
  branches.
- `app/schedule-pro.tsx` — full-screen power view.
- `components/schedule/` — Gantt, grid, lookahead, today, scenarios, share,
  quick-build, AI assistant panel, swipeable task card.
- `utils/scheduleEngine.ts`, `scheduleOps.ts`, `cpm.ts`, `scheduleAI.ts`,
  `autoScheduleFromEstimate.ts`, `demoSchedule.ts` — scheduling logic.
- `components/AIAutoScheduleButton.tsx` — generates a full schedule from an
  estimate's line items.
- `app/shared-schedule.tsx` — read-only public view (shareable link).""",
    [
        "app/(tabs)/schedule/index.tsx",
        "app/schedule-pro.tsx",
        "app/shared-schedule.tsx",
        "components/AIAutoScheduleButton.tsx",
        "components/AIScheduleRisk.tsx",
        "components/schedule/GanttChart.tsx",
        "components/schedule/InteractiveGantt.tsx",
        "components/schedule/VerticalGantt.tsx",
        "components/schedule/GridPane.tsx",
        "components/schedule/LookaheadView.tsx",
        "components/schedule/TodayView.tsx",
        "components/schedule/SwipeableTaskCard.tsx",
        "components/schedule/QuickBuildModal.tsx",
        "components/schedule/ScenariosModal.tsx",
        "components/schedule/AIAssistantPanel.tsx",
        "components/schedule/ScheduleShareSheet.tsx",
        "utils/scheduleEngine.ts",
        "utils/scheduleOps.ts",
        "utils/cpm.ts",
        "utils/scheduleAI.ts",
        "utils/autoScheduleFromEstimate.ts",
        "utils/demoSchedule.ts",
    ],
)

# ---------- 08: INVOICING & FINANCE ----------
bundle(
    "08-INVOICING-FINANCE.md",
    "Invoicing, Change Orders, Cash Flow & Finance",
    """Billing and financial subsystem. All invoice entry points now route
through the **Bill-from-Estimate** screen rather than starting blank.

- `app/bill-from-estimate.tsx` — NEW. Estimate-driven invoice creation.
  Reads each line item from `project.linkedEstimate`, computes "already
  billed" by summing prior invoice line items matched by
  `sourceEstimateItemId` (with a legacy name-match fallback), and lets the
  user enter a percent-of-remaining per line. Creates a draft invoice and
  `router.replace`s to `/invoice` for final review.
- `app/invoice.tsx` — invoice editor. Receives `sourceEstimateItemId` +
  `billedPercent` from Bill-from-Estimate so lines can be round-tripped.
- `app/change-order.tsx` — change-order editor.
- `app/aia-pay-app.tsx` — AIA G702/G703 pay-application generator.
- `app/cash-flow.tsx`, `app/payment-predictions.tsx`,
  `app/budget-dashboard.tsx`, `app/retention.tsx`, `app/payments.tsx` —
  finance dashboards.
- `utils/` — `cashFlowEngine.ts`, `cashFlowStorage.ts`, `paymentPrediction.ts`,
  `projectFinancials.ts`, `aiaBilling.ts`, `earnedValueEngine.ts`, `stripe.ts`.""",
    [
        "app/bill-from-estimate.tsx",
        "app/invoice.tsx",
        "app/change-order.tsx",
        "app/aia-pay-app.tsx",
        "app/cash-flow.tsx",
        "app/payment-predictions.tsx",
        "app/budget-dashboard.tsx",
        "app/retention.tsx",
        "app/payments.tsx",
        "components/AIInvoicePredictor.tsx",
        "components/AIChangeOrderImpact.tsx",
        "components/CashFlowSetup.tsx",
        "components/CashFlowChart.tsx",
        "components/CashFlowAlerts.tsx",
        "utils/cashFlowEngine.ts",
        "utils/cashFlowStorage.ts",
        "utils/paymentPrediction.ts",
        "utils/projectFinancials.ts",
        "utils/aiaBilling.ts",
        "utils/earnedValueEngine.ts",
        "utils/stripe.ts",
    ],
)

# ---------- 09: FIELD OPS ----------
bundle(
    "09-FIELD-OPS.md",
    "Field Operations — Daily Reports, Punch, RFIs, Submittals, Warranties",
    """Field-operations screens — daily reports, punch lists, RFIs, submittals,
warranties, permits, and time tracking. All persist under the `tertiary_*`
AsyncStorage key family and sync through the offline queue.

- Voice-parsed daily field updates via `utils/voiceDFRParser.ts` and
  `components/QuickFieldUpdate.tsx` / `VoiceFieldButton.tsx`.""",
    [
        "app/daily-report.tsx",
        "app/punch-list.tsx",
        "app/rfi.tsx",
        "app/submittal.tsx",
        "app/warranties.tsx",
        "app/permits.tsx",
        "app/time-tracking.tsx",
        "components/AIDailyReportGen.tsx",
        "components/QuickFieldUpdate.tsx",
        "components/QuickUpdateClarifier.tsx",
        "components/VoiceFieldButton.tsx",
        "utils/voiceDFRParser.ts",
        "utils/closeoutPacketGenerator.ts",
    ],
)

# ---------- 10: CLIENT PORTAL ----------
bundle(
    "10-CLIENT-PORTAL.md",
    "Client Portal, Messaging & Sharing",
    """Client-facing surfaces. A project owner can publish a read-only portal
snapshot, share a schedule link, send weekly updates, and exchange messages.

- `portalSnapshot.ts` builds the JSON payload that drives the public client
  view.
- `weeklyClientUpdate.ts` generates the rolling weekly summary.""",
    [
        "app/client-portal-setup.tsx",
        "app/client-messages.tsx",
        "app/client-update.tsx",
        "app/client-view.tsx",
        "app/messages.tsx",
        "utils/portalSnapshot.ts",
        "utils/weeklyClientUpdate.ts",
        "utils/emailService.ts",
    ],
)

# ---------- 11: BIDS, COMPANIES, HIRE ----------
bundle(
    "11-BIDS-COMPANIES-HIRE.md",
    "Bids, Companies, Hiring & Marketplace Listings",
    """Marketplace side of the app — bid listings, sub/company profiles, and
hiring workers for a job.""",
    [
        "app/(tabs)/bids/index.tsx",
        "app/(tabs)/companies/index.tsx",
        "app/(tabs)/hire/index.tsx",
        "app/(tabs)/subs/index.tsx",
        "app/bid-detail.tsx",
        "app/company-detail.tsx",
        "app/worker-detail.tsx",
        "app/job-detail.tsx",
        "app/post-bid.tsx",
        "app/post-job.tsx",
        "components/AIBidScorer.tsx",
        "components/AIBidScorecard.tsx",
        "components/AISubEvaluator.tsx",
        "components/ContactPickerModal.tsx",
    ],
)

# ---------- 12: DISCOVER / MARKETPLACE / EQUIPMENT ----------
bundle(
    "12-DISCOVER-MARKETPLACE-EQUIPMENT.md",
    "Discover, Marketplace, Equipment & Integrations",
    """Discover tab (unified search across bids/companies/hire/estimate/
schedule/materials), Marketplace tab, Equipment tracking, and third-party
integrations screen.""",
    [
        "app/(tabs)/discover/index.tsx",
        "app/(tabs)/discover/bids.tsx",
        "app/(tabs)/discover/companies.tsx",
        "app/(tabs)/discover/hire.tsx",
        "app/(tabs)/discover/estimate.tsx",
        "app/(tabs)/discover/schedule.tsx",
        "app/(tabs)/discover/materials.tsx",
        "app/(tabs)/discover/_layout.tsx",
        "app/(tabs)/marketplace/index.tsx",
        "app/(tabs)/equipment/index.tsx",
        "app/(tabs)/construction-ai/index.tsx",
        "app/(tabs)/summary/index.tsx",
        "app/equipment-detail.tsx",
        "app/integrations.tsx",
        "components/AIEquipmentAdvice.tsx",
        "components/AIHomeBriefing.tsx",
        "components/AIProjectReport.tsx",
        "components/AIWeeklySummary.tsx",
    ],
)

# ---------- 13: SETTINGS, CONTACTS, EXPORT ----------
bundle(
    "13-SETTINGS-CONTACTS-EXPORT.md",
    "Settings, Contacts, Data Export & Documents",
    """Settings tab (branding, PDF naming, Supplier Profile modal, theme
presets, subscription status, FAQ). The **Supplier Profile** modal was
recently rewritten for iPhone + web: native `pageSheet` on iOS, centered
dim-backdrop card on web, 2-column rows, sticky save footer with
safe-area-insets bottom padding, pill-shaped category chips.""",
    [
        "app/(tabs)/settings/index.tsx",
        "app/contacts.tsx",
        "app/data-export.tsx",
        "app/documents.tsx",
        "utils/dataExport.ts",
        "components/SignaturePad.tsx",
        "components/Tutorial.tsx",
        "components/PDFPreSendSheet.tsx",
    ],
)

# ---------- 14: AI FEATURES ----------
bundle(
    "14-AI-FEATURES.md",
    "AI Features — Copilot, Voice & Service Layer",
    """MAGE AI threading runs through `utils/mageAI.ts` + `utils/aiService.ts`
with rate limiting in `aiRateLimiter.ts`. The copilot is a floating overlay
(`components/AICopilot.tsx`). Voice capture + command parsing feed into
scheduling, daily reports, and quick-updates.""",
    [
        "components/AICopilot.tsx",
        "components/VoiceRecorder.tsx",
        "components/VoiceCommandModal.tsx",
        "utils/mageAI.ts",
        "utils/aiService.ts",
        "utils/aiRateLimiter.ts",
        "utils/voiceCommandParser.ts",
        "utils/voiceCommandExecutor.ts",
    ],
)

# ---------- 15: UTILITIES & BACKEND ----------
bundle(
    "15-UTILITIES-BACKEND.md",
    "Utilities, Offline Sync & Backend (tRPC + Supabase)",
    """Everything under `backend/`, `lib/`, and the remaining `utils/`.

- **Offline-first sync**: every Supabase write goes through
  `utils/offlineQueue.ts::supabaseWrite`. `components/ErrorBoundary.tsx` +
  `OfflineSyncManager` (mounted in `_layout.tsx`) flush when connectivity
  returns. UI code must NEVER call `supabase.from(...)` directly —
  always go through the queue.
- **Backend**: Hono app at `backend/hono.ts` mounting tRPC at `/trpc` via
  `@hono/trpc-server`. Routers under `backend/routes/`. Client in
  `lib/supabase.ts` (anon key, RLS-protected).
- **Notifications**, **PDF generation**, **location**, **analytics**,
  **weather**, **email**, **storage wrapper**.""",
    [
        "backend/hono.ts",
        "backend/routes",
        "lib/supabase.ts",
        "utils/offlineQueue.ts",
        "utils/storage.ts",
        "utils/pdfGenerator.ts",
        "utils/generateId.ts",
        "utils/formatters.ts",
        "utils/analytics.ts",
        "utils/notifications.ts",
        "utils/location.ts",
        "utils/weatherService.ts",
        "components/ErrorBoundary.tsx",
    ],
)


# ============================================================================
# RUN
# ============================================================================

def main():
    used: set[str] = set()
    size_report: list[tuple[str, int, int]] = []
    for filename, title, overview, patterns, extras in BUNDLES:
        files = expand(patterns)
        for f in files:
            used.add(f.relative_to(ROOT).as_posix())
        write_bundle(filename, title, overview, files, extras)
        out_path = OUT_DIR / filename
        size_kb = out_path.stat().st_size // 1024
        size_report.append((filename, len(files), size_kb))

    # INDEX
    idx = ["# MAGE ID — Claude Projects Bundles\n"]
    idx.append("\n> Upload these 16 files to a Claude Project. Together they\n> contain the entire MAGE ID codebase (app/, components/, contexts/,\n> utils/, backend/, lib/, hooks/, types/, constants/, config). Bundles are\n> grouped by subsystem and ordered for reading — **start with 00-OVERVIEW**.\n")
    idx.append("\n## Bundle list\n")
    idx.append("| # | File | Files | Size (KB) | What's in it |")
    idx.append("|---|------|------:|----------:|--------------|")
    for (filename, title, _ov, _pats, _ex), (_fn, nfiles, size_kb) in zip(BUNDLES, size_report):
        idx.append(f"| {filename.split('-')[0]} | `{filename}` | {nfiles} | {size_kb} | {title.replace('—','—')} |")
    idx.append("")

    # Coverage check
    all_source = set()
    for root_dir in ["app", "components", "contexts", "utils", "backend",
                     "lib", "hooks", "types", "constants"]:
        p = ROOT / root_dir
        if p.exists():
            for f in p.rglob("*"):
                if f.is_file() and f.suffix in {".ts", ".tsx"}:
                    all_source.add(f.relative_to(ROOT).as_posix())
    missing = sorted(all_source - used)
    idx.append(f"\n## Coverage\n\n{len(used)} source files included in bundles. {len(missing)} not bundled (UI utilities, tests, or helpers reachable through the bundled files).\n")
    if missing:
        idx.append("<details><summary>Files not explicitly bundled ({})</summary>\n\n".format(len(missing)))
        for m in missing:
            idx.append(f"- `{m}`")
        idx.append("\n</details>\n")

    idx.append("\n## How to use\n\n1. Create a new Claude Project.\n2. Upload all `.md` files in this directory.\n3. In the project instructions, paste the contents of `00-OVERVIEW.md`'s\n   Overview section (or direct Claude to read 00 first).\n4. Ask questions — Claude will have every file's path + source available.\n\n## Regenerating\n\n```bash\npython3 scripts/generate_bundles.py\n```\nIdempotent; safe to rerun after code changes.\n")

    (OUT_DIR / "INDEX.md").write_text("\n".join(idx), encoding="utf-8")

    # Print report
    print(f"Wrote {len(BUNDLES)} bundles + INDEX to {OUT_DIR}/")
    print(f"{'File':<42} {'Files':>6} {'Size KB':>8}")
    total_size = 0
    for f, n, s in size_report:
        print(f"{f:<42} {n:>6} {s:>8}")
        total_size += s
    print(f"{'TOTAL':<42} {'':>6} {total_size:>8}")
    if missing:
        print(f"\n{len(missing)} source files not bundled:")
        for m in missing[:40]:
            print(f"  {m}")
        if len(missing) > 40:
            print(f"  ... +{len(missing)-40} more")


if __name__ == "__main__":
    main()
