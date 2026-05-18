# D3-1 — In-App Client Gallery: Uncap + Working Lightbox — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D3** ("Photo library + client-facing live gallery/timeline"). This spec is **D3-1** only.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `d255856`. **App-only, OTA-able. No migration, no portal-HTML, no data-model change** → fully independent of H4's Netlify block.

## 1. Decomposition (D3 split — important)

D3 spans three separable concerns with very different size/risk/shippability. Per the brainstorming decomposition guidance + the standing "prefer designs that don't depend on the blocked Netlify deploy" constraint:

- **D3-1 (THIS spec): in-app client gallery fix.** The audit's named concrete defect — `app/client-view.tsx` Site Photos hard-caps 9 thumbnails, has a **dead** `+N` overlay (a `<Text>` with no handler), and **no lightbox** (thumbs are non-touchable `<View>`s). Pure app/OTA, no data/portal change, smallest+highest-visible-value slice. Build now.
- **D3-2 (decomposed follow-on, NOT here): durable photo library + persisted-tag search + auto-album.** "all electrical-rough photos", album by date/phase. Needs real data-model decisions (where AI tags persist, search, album grouping) and intersects the H5-deferred per-project `projectPhotos` scoping (H5 spec §7 explicitly handed per-project photo scoping to "D3"). Its own brainstorm→spec. §7.
- **D3-3 (decomposed follow-on, NOT here, Netlify-blocked): portal client gallery / live timeline.** The shareable client-facing gallery/timeline lives in `marketing/portal/index.html` → the SAME Netlify pipeline currently blocking H4 (portal HTML already has a lightbox CSS block; the cap/no-lightbox the audit names is specifically the in-app `client-view.tsx`, not the portal). Building portal-HTML now produces unshippable code. Queued pending the Netlify unblock (which also unblocks H4's tail). §7.

## 2. Problem

`app/client-view.tsx` "Site Photos" section (~:877-907):
```
{photos.slice(0, 9).map(photo => ( <View style={styles.photoThumb}> <Image .../> {tag} </View> ))}
{photos.length > 9 && ( <View style={[photoThumb, photoMoreOverlay]}><Text>+{photos.length - 9}</Text></View> )}
```
- **Cap 9:** the client can never see photos 10+.
- **Dead `+N`:** the overlay is a plain `<View>/<Text>` with no `onPress` — it looks tappable, does nothing.
- **No lightbox:** thumbs are `<View>` (not Touchable); tapping does nothing — the client can't view a photo full-screen, can't read its tag/location/date.

`ProjectPhoto` is already rich enough for a good gallery: `{ id, projectId, uri, timestamp, location?, tag?, locationLabel?, createdAt, markup? }`. No reusable photo-lightbox component exists in the repo (verified) — a small self-contained one is needed.

## 3. Goal / Non-goals

**Goal:** The client sees **all** project photos in the existing grid, every thumbnail is tappable, and tapping opens a **full-screen, swipeable lightbox** showing the photo with its tag / location / date, with a clear close affordance. No 9-cap, no dead `+N`.

**Non-goals (YAGNI / scope / Netlify-independence):**
- No durable library / tag-search / auto-album (that's D3-2).
- No portal-HTML / `marketing/` change (that's D3-3, Netlify-blocked).
- No `ProjectPhoto` data-model change, no migration, no per-project `projectPhotos` scoping change (H5/D1b-deferred — belongs to D3-2).
- No rendering of GC `markup` overlays in the client lightbox (GC annotation; v1 shows the photo + meta only — markup overlay is future).
- No new dependency (RN `Modal` + `FlatList` only); no zoom/pinch lib (v1 = swipe between full-bleed photos; pinch-zoom = future if asked).
- No change to the GC-side photo flows (`photo-triage`, `photo-annotator`) or any other screen.

## 4. Architecture

All changes confined to `app/client-view.tsx` (a self-contained lightbox can be an in-file component or `components/ClientPhotoLightbox.tsx` — prefer a small new component file for focus if it keeps `client-view.tsx` cleaner; either is acceptable, decided in planning).

### 4.1 Grid: uncap + make thumbnails tappable

- Remove `.slice(0, 9)` → map over **all** `photos` (the existing `styles.photoGrid` is already `flexWrap` — it handles N thumbs; client photo counts per project are bounded, tens not thousands; acceptable. If a project has a very large count, the lightbox's `FlatList` virtualizes; the grid itself is lightweight `<Image>` thumbs — keep simple, no virtualization of the grid in v1).
- Delete the dead `photos.length > 9` `+N` overlay block entirely (obsolete once uncapped).
- Wrap each thumb in a `TouchableOpacity` (replacing the static `<View style={styles.photoThumb}>`) with `onPress={() => openLightbox(index)}`. Keep the existing `photoThumb`/`photoImg`/`photoTag` styles unchanged (visual parity for the thumb itself).

### 4.2 Lightbox

State in `client-view.tsx`: `const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);` (null = closed). `openLightbox(i) => setLightboxIndex(i)`.

A `<Modal visible={lightboxIndex !== null} transparent animationType="fade" onRequestClose={() => setLightboxIndex(null)}>` containing:
- Full-screen dark backdrop.
- A horizontal `FlatList data={photos}` `pagingEnabled` `horizontal` `initialScrollIndex={lightboxIndex}` `getItemLayout` (fixed = screen width, so `initialScrollIndex` works reliably), `keyExtractor={p => p.id}`, `renderItem` = a full-screen `<Image source={{uri}} resizeMode="contain">` sized to screen `Dimensions`.
- An overlay header: a close control (`ChevronLeft`/`X` per the repo's modal pattern, `onPress={() => setLightboxIndex(null)}`) + a caption line built from the visible photo's `ProjectPhoto`: `tag` (if any) · `location || locationLabel` (if any) · formatted `timestamp || createdAt` date. Track the current page via `onMomentumScrollEnd` (compute index from contentOffset / screenWidth) to keep the caption in sync.
- Respect `expo-image` vs RN `Image`: use whichever `client-view.tsx`/the repo already uses for photos (the file already imports an Image for thumbs — reuse the same import; `photo-annotator` uses `expo-image` `contentFit`; match the file's existing choice).

### 5. Error handling / correctness

- `photos` may be empty → the whole section is already gated by `photos.length > 0`; lightbox never opens with no data. `initialScrollIndex` clamped to `[0, photos.length-1]`.
- A photo with a missing/blank `uri` → `<Image>` simply renders nothing/placeholder (no crash); acceptable (same as today's thumb behavior).
- No state persisted; lightbox is ephemeral UI. Closing resets index to null. No effect on portal/data/GC flows.
- Behavior parity: the Site Photos section's gating (`portal.showPhotos && photos.length > 0`), header, count, expand/collapse are unchanged — only the grid body (uncapped + tappable) and the new lightbox are added.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual (client-view in a dev client / reasoning):
- A project with >9 photos → the client sees ALL of them in the grid (no cap, no `+N`).
- Tapping any thumbnail opens the full-screen lightbox at that photo; swiping left/right pages through all photos; caption shows that photo's tag/location/date and stays in sync while swiping; close returns to the grid.
- A project with 0 photos → section hidden as before (no regression). 1 photo → grid + lightbox work (no pager edge crash).
- GC-side photo flows (`photo-triage`, `photo-annotator`) and every other `client-view.tsx` section are byte-unaffected.
- Final whole-impl review (opus).

## 7. Out of scope / future (decomposed)

- **D3-2:** durable photo library — persisted AI tags + search ("all electrical-rough photos"), auto-album by date/phase/location, AND the H5/D1b-deferred per-project `projectPhotos` scoping (H5 spec §7 assigned it here). Own brainstorm→spec→plan; data-model decisions required.
- **D3-3:** portal client gallery / shareable live timeline in `marketing/portal/index.html` — inherits H4's Netlify block; queued until the `mageid.app` Netlify deploy is unblocked (same gate as H4's cutover tail).
- Pinch-zoom, GC-markup overlay in the client lightbox, photo download/share — future, not planned.
