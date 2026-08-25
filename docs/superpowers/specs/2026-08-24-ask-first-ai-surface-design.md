# Ask-first AI surface — design

**Date:** 2026-08-24
**Status:** Approved (design/mockup approved by founder; option A)
**Mockup:** https://claude.ai/code/artifact/a0adab4e-50fd-49ac-b243-d1a54d3d008c

## Problem

Tapping the floating AI button opens a **search-first command palette**
(`components/UniversalSearch.tsx`, ~710 lines: search bar, 30+ entity result
types, recents, tier-locking). "Ask MAGE" is buried inside it as one small
quick-action. The founder's read: it feels like operating a tool, not talking to
an assistant. Desired: tapping the button should feel like opening Claude/ChatGPT
— a calm screen with a greeting, a few suggested prompts, and one place to type.

## Decision (option A — "ask-first, search tucked in")

The AI button opens the **ask screen** directly. Search is preserved but demoted
to a quiet 🔍 in the ask screen's header — one tap away, not the default surface.

The conversational screen the founder wants **already exists** (`app/ask.tsx`,
already wired to the live AI backend `askOneMind → mageAI →`
`supabase/functions/ai`). This work is re-pointing the entry + polishing that
screen's empty state to match the mockup. No new AI plumbing.

## Scope

1. **Entry re-point — `components/brain/BrainFab.tsx`**
   - `handlePress` calls `router.push('/ask')` (add `useRouter`) instead of
     `openSearch()`. Keep the light haptic. The FAB no longer opens search.
   - Add `'ask'` to `HIDDEN_ROOTS` so the FAB does not float over the ask modal
     (`useSegments()[0] === 'ask'` while the modal route is active).

2. **Ask screen header — `app/ask.tsx`**
   - Replace the back-chevron header with the mockup's: brand left
     (`MageAIMark` + "MAGE"), actions right = **search 🔍** + **close ×**.
   - `×` → `router.back()` (dismisses the modal). `🔍` → open the existing search.
     Because `/ask` is itself a `presentation: 'modal'` route and search is a
     `pageSheet` modal, opening search on top of ask can conflict on iOS. Mirror
     the existing voice/help signal pattern in `SearchContext`: dismiss ask
     first (`router.back()`), then `openSearch()` after a short delay so the
     sheet presents cleanly. (Verify on device; fall back to stacked modals if
     the timed-dismiss feels worse.)

3. **Ask screen empty state — `app/ask.tsx`** (polish to match mockup)
   - Breathing `MageAIMark` "halo", serif headline **"What can I help with?"**
     (`Type.serifLargeTitle` / Fraunces), one muted subtitle line.
   - Suggestion chips as full-width rounded rows: leading accent icon + prompt +
     trailing chevron, `surface` fill, hairline border. Source unchanged:
     `ASK_MAGE_SUGGESTIONS` (`utils/mageAgent.ts`) + `ONE_MIND_SUGGESTIONS`
     (`app/ask.tsx`). Show ~4.
   - Input bar: pill field + circular accent-gradient send button (up-arrow),
     matching the mockup. Keep the existing `KeyboardAvoidingView` behaviour.

## Explicitly out of scope

- The AI backend / OneMind pipeline / rate-limiting / caching — reused as-is.
- `UniversalSearch` internals — unchanged; still the search surface, just reached
  via the 🔍 now.
- Voice capture / help flows and their signal plumbing — unchanged.
- Message-bubble + citation-chip rendering (already matches the mockup's intent).

## Acceptance criteria

- Tapping the AI FAB opens the ask screen (modal) showing greeting + suggestions
  + input — not the search palette.
- The 🔍 in the ask header still reaches the full search surface.
- Tapping a suggestion, or typing + send, returns an answer with tap-through
  citations (existing behaviour preserved).
- The FAB does not render on top of the ask screen.
- `npx tsc --noEmit` clean; `test:brand-orange` and `test:app-slop` guards pass
  (no hex literals / inline `fontSize` — use theme + `Type` tokens).

## Risks / watch-items

- **Modal-over-modal** (ask → search): the timed-dismiss above; verify on device.
- **Token discipline**: the polish adds visual detail — must use `colors.*` and
  `Type.*` tokens, no raw hex / inline `fontSize`, or the guards fail the build.
- Ships as an **OTA** (JS-only, no native deps) on the reanimated-free bundle —
  applies to build #12. See [[ota-reanimated-runtime-trap]].
