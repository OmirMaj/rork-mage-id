# D3-2 — Durable Searchable Photo Library — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D3** ("photos demo deep, deliver shallow"). The decomposed follow-on to D3-1 (client-view gallery uncap + lightbox, shipped) — D3-1 spec §7 deferred this "GC-side durable library / search / auto-album" half here; H5 spec §7 also routed the "per-project `projectPhotos` scoping" question here.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `d4d92e6`. **App-only, OTA-able. No migration, no portal, no edge-fn, no data-model change** → independent of H4's Netlify block. Sibling of D3-1: a single-file enhancement of the existing photos surface (D3-1 did `client-view`; D3-2 does the GC-side `project-detail`).

## 1. Scope decision (read first — the "per-project scoping" reality)

H5 spec §7 and D3-1 spec §7 both name "per-project `projectPhotos` scoping" as D3-2 work. Investigation against live code:

- `contexts/ProjectContext.tsx` already loads photos **globally** into one `projectPhotos: ProjectPhoto[]` array (query `['projectPhotos', userId]`, :714/:1213) and exposes `getPhotosForProject(projectId)` (:2226) which **already filters that array to one project + sorts newest-first**. The per-project *view* is therefore already correct at the accessor level.
- H5 §7's actual deferred item was re-architecting the **global array load itself** to be per-project — explicitly because **5 cross-project consumers depend on the global array**: `hooks/useUniversalSearch.ts:261`, `utils/entityResolver.ts:273`, `app/data-export.tsx`, `app/rfi.tsx:94` + `app/photo-annotator.tsx:48`, `app/closeout-binder.tsx:254`. H5 §7 proved that change is behavior-risky and disproportionate.

**Decision: D3-2 does NOT touch the global `projectPhotos` array, its query, or `getPhotosForProject`.** The per-project scoping the audit actually wants (a GC seeing *one project's* photos as a usable library) is **already delivered by `getPhotosForProject`**, which `app/project-detail.tsx` already calls (:181). The H5-deferred global-array re-architecture stays deferred (§7) — it is a cross-project-consumer migration, out of proportion for a photo-findability feature and provably regression-risky per H5 §7. This is honest scoping: D3-2 delivers the "durable, searchable, auto-albumed library" value on the already-correct per-project accessor; the global-array rework is future and only if a real consumer needs it.

## 2. Problem

`app/project-detail.tsx` photos section (~:2941-3001) on the already-per-project `projectPhotos = getPhotosForProject(id)` (:181):
```
const visible = filtered.slice(0, 12);            // hard 12-thumb cap
... {filtered.length > 12 && <Text>+{filtered.length - 12} more in this filter</Text>}   // dead +N, no destination
// "Show 12 thumbs ... user can hit the gallery for the full set (route TBD — for now we show the count)."
```
- **Capped at 12** with a **dead `+N more` text** and a literal `route TBD` comment — the GC cannot see most of a project's photos (the exact D3 grievance; identical shape to the D3-1 client-view dead-end already fixed).
- **No free-text search.** Only a single-select tag *chip* row exists. The audit's concrete ask "find all electrical-rough photos" is a text query across tag/location/task, not one chip.
- **No auto-album.** Flat grid; no date/phase grouping, so a 300-photo project is an undifferentiated wall.
- Photos are already **durable**: every field needed (`tag`, `location`, `linkedTaskName`, `locationLabel`, `timestamp`) already persists on `ProjectPhoto` (types/index.ts:1785) via the existing query. "Durable library" = the data is already durable; the missing half is **findability** (uncap + search + album).

## 3. Goal / Non-goals

**Goal:** The project-detail photos section becomes a real library: **all** photos visible (no 12-cap, no dead `+N`), a **free-text search** matching tag/location/linked-task/geo-label (so "electrical rough" surfaces every matching photo regardless of which field carries it), and an **auto-album by date** grouped view (newest day first, date header per group) toggleable with the existing flat view. Composes with the existing tag-chip filter (search ∩ chip). Existing share-timeline button, lightbox, markup badge, and every other project-detail section are byte-unaffected.

**Non-goals (YAGNI / risk / independence):**
- NOT the H5-deferred global-`projectPhotos`-array re-architecture / per-project query rework (§1; stays deferred §7) — would touch 5 cross-project consumers, regression-risky, disproportionate.
- No change to `ProjectContext` (`projectPhotos`/`getPhotosForProject`/the query), `types/index.ts`, or any migration — all search/album inputs already persist. Zero schema/Netlify surface.
- No new lightbox / no swipe-between / no pinch-zoom / no markup-overlay change — the existing single-photo `lightboxPhoto` stays exactly as-is (swipe was D3-1's client-side scope; D3-1 §7 lists zoom/markup as future).
- No AI re-tagging — "AI tags" in the D3-1 §7 phrasing means *searching the tags photos already carry*, not generating new ones (no AI call; out of scope/future).
- No portal/marketing (Netlify-independent); D3-3 (portal gallery) stays Netlify-blocked, separate.
- No new screen/route — enhance the existing in-place section (the `route TBD` is *resolved by removing the cap*, not by adding a route).

## 4. Architecture

Single-file change to `app/project-detail.tsx` (mirrors D3-1's single-file `client-view.tsx` enhancement), reusing the existing `groupPhotosByDay` pure helper from `utils/photoShareToken.ts` (already battle-tested by `app/shared-photos.tsx`).

### 4.1 Uncap + kill the dead `+N`
In the photos-section IIFE (~:2956-2999): remove `.slice(0, 12)` (render the full `filtered`/searched set), delete the `{filtered.length > 12 && <Text>+{filtered.length - 12} more…</Text>}` block and the stale `route TBD`/`Show 12 thumbs` comments. Identical fix shape to D3-1 Step 3.

### 4.2 Free-text search (all inputs already persisted)
Add `const [photoSearch, setPhotoSearch] = useState('')` near the existing `photoFilter` state (~:402). A `TextInput` (reuse the file's existing search-input style if one exists, else a minimal styled `TextInput` matching the file's conventions) above the grid. Filter predicate, applied **after** the existing chip filter (search ∩ chip), case-insensitive substring of the trimmed query against the join of `tag`, `location`, `linkedTaskName`, `locationLabel` (all optional → `?? ''`). Empty/whitespace query ⇒ predicate is identity (byte-equivalent to today's chip-only result). This makes "electrical rough" match whichever field carries it.

### 4.3 Auto-album by date (reuse existing helper)
Add `const [photoGroupByDate, setPhotoGroupByDate] = useState(true)`. When on: feed the post-search list (mapped to the helper's `{ ts: string }` shape via `photo.timestamp`, carrying the photo) through `groupPhotosByDay` from `@/utils/photoShareToken`, render each returned day as a date section header (the helper's existing label) followed by that day's `photoGrid` of the existing thumb `TouchableOpacity`s (unchanged thumb markup — image, markup badge, date overlay, `onPress={() => setLightboxPhoto(photo)}`). When off: the existing single flat `photoGrid` (post-uncap). A small toggle control (reuse the file's existing toggle/segmented style, e.g. the pattern used elsewhere in project-detail) switches it; default on (albums are the library win). Verify `groupPhotosByDay`'s exact generic signature/return at plan time and adapt the `{ ts }` map precisely (it is `<T extends { ts: string }>` per the helper's declaration).

### 4.4 Composition / precedence
`projectPhotos` (already per-project via `getPhotosForProject`) → existing tag-chip filter → §4.2 search filter → (§4.3 group-by-day **or** flat) → render. Chip row, share button, empty-state, lightbox, section header/collapse, `count` badge: unchanged. When search empty AND group-off, the only behavior delta vs today is the §4.1 uncap — the intended fix, nothing else moves.

## 5. Error handling / correctness

- All inputs optional-safe (`?? ''`); empty search = identity; 0 photos → existing empty-state still shown (unchanged gate). 1 photo / 1 day → `groupPhotosByDay` returns one group, no crash.
- `groupPhotosByDay` is an existing pure, shipped helper (used by `shared-photos.tsx`) — reuse as-is, do not modify it (no new failure modes).
- Zero `ProjectContext`/type/migration change → the 5 H5 cross-project consumers and every other project-detail section are provably byte-unaffected (we only read the same `projectPhotos` and add local view-state).
- Uncapping renders all of one project's photos: these are already-loaded local objects (no new fetch); the grid is the existing lightweight thumb — consistent with D3-1 which uncapped the sibling client-view grid with no perf issue. (If a pathological project had thousands of photos this is the same characteristic as D3-1's accepted client-view uncap; not introducing new risk vs the shipped sibling.)

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual reasoning:
- Project with >12 photos → **all** render (no 12-cap, no `+N` dead text); each thumb still opens the existing lightbox.
- Type "electrical" → only photos whose tag/location/linked-task/geo-label contains it (case-insensitive) show; clearing restores; search composes with a selected tag chip (intersection).
- Group-by-date on (default) → photos under newest-first day headers via `groupPhotosByDay`; toggle off → flat grid; both honor the active search+chip.
- Empty search + group-off → result identical to today except the cap is gone (byte-equivalent filter path).
- 0 photos → unchanged empty-state; 1 photo → one dated group, no crash.
- Share-timeline button, tag chips, lightbox + markup overlay, every other project-detail section, `ProjectContext`, the 5 H5 cross-project photo consumers — byte-unaffected.
- Final whole-impl review (opus) — confirm no `ProjectContext`/global-array/migration touch; confirm zero-regression of the no-search/flat path.

## 7. Out of scope / future (decomposed)

- **H5-deferred global `projectPhotos` array re-architecture** (per-project query/load) — still deferred; 5 cross-project consumers, regression-risky, disproportionate (§1). Own spec only if a real consumer requires it.
- **D3-3:** portal client gallery / live shareable timeline in `marketing/portal/index.html` — inherits H4's Netlify block; remains queued (same gate as H4's cutover tail). Not built now (would produce unshippable code).
- Swipe-between/pinch-zoom in the project-detail lightbox, GC-markup overlay changes, AI re-tagging, photo bulk-download — future, not planned.
