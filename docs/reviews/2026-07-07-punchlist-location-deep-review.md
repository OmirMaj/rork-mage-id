# Punch List "Location Tracking" — Deep Review

**Date:** 2026-07-07
**Scope:** How a punch item's *location* is captured, stored, displayed, filtered, and tied to plans/drawings/GPS across iOS and web.
**Verdict:** The owner's read ("very underdeveloped") is correct. Location is a **single free-text string** with a bolted-on GPS stamp that is *captured but never displayed and silently dropped on sync*. The plan-pin ↔ punch link exists but is one-directional and near-cosmetic. There is no room/floor/zone structure, no spatial view, and no way to create or see a punch item on a drawing. This is the largest gap between MAGE's punch engine and Fieldwire/Procore/PlanGrid.

---

## 1. Current State (evidence)

### 1.1 Data model — location is one `string`
`PunchItem` (`types/index.ts:1983-2006`) models location as:

```ts
/** Free-text location (e.g. "Unit 4B — master bath"). */
location: string;              // line 1988
photoLatitude?: number;        // line 1998  — GPS from the photo
photoLongitude?: number;       // line 1999
photoLocationAccuracyMeters?: number;  // line 2000
photoLocationLabel?: string;   // line 2001  — reverse-geocoded label
```

There is **no** structured field: no `floor`/`level`, no `room`/`area`, no `zone`, no `planSheetId`, no `pinId`, no plan-relative `x`/`y`. Location is whatever text someone typed or dictated. The only spatial primitives are the four optional GPS fields.

### 1.2 The GPS stamp is dead-ended data
GPS is captured on save in two places:
- Walk mode: `app/punch-walk.tsx:273-278` spreads `photoLatitude/Longitude/AccuracyMeters/LocationLabel` onto the item from `stampPhotoLocation()`.
- AI punch: `app/ai-punch.tsx:300-303` does the same.

But a `grep` for these fields across the app shows they are **only ever written, never read**. Nothing displays lat/long or the geo label — not the punch list row (`app/punch-list.tsx:430` renders only `item.location`), not closeout, not export.

Worse, the sync layer drops them entirely. `addPunchItem` / `updatePunchItem` (`contexts/ProjectContext.tsx:2499-2505`, `2517-2521`) write only `location, photo_uri, …` — no GPS columns. The Supabase table has no columns for them either (`supabase/schema.sql:195-211`: `location TEXT`, `photo_uri TEXT`, and nothing spatial). So the app spends a 3-second GPS budget on **every** punch save, stores the result in local AsyncStorage only, and throws it away the moment the row syncs. Pure cost, zero payoff. (Note also a latent sync bug: `assigned_sub_id` is in the insert but omitted from the update patch at `2517-2521`.)

### 1.3 Capture UX
- **Walk mode** (`app/punch-walk.tsx`): location is a free-text bar (`locationInput`, lines 337-353) that *persists between saves* — a genuinely good touch for "hall 2, hall 2, hall 2" corridor walks (lines 294-297). Voice parse tries to extract a location string (`289`→`titleCase(parsed.location)`, line 189). Camera can seed location from the GPS label (line 229). All still just text.
- **AI punch** (`app/ai-punch.tsx`): AI returns a `location` string per item; the reviewer edits it as free text (`editedLocation`, line 525). Critically, because `PunchItem` has no trade field, the trade is **jammed into the location string**: `"${location} — ${trade}"` (`ai-punch.tsx:287-289`). So the one location field is polluted with non-location data, further degrading any location-based grouping.
- **Manual form** (`app/punch-list.tsx:570-572`): a single "Location/Area" text input, placeholder "e.g. Kitchen, Room 3B".
- **Templates** (`app/punch-list.tsx:126-133`): applied items are created with `location: ''`.

### 1.4 Display & filtering
- Row display: `app/punch-list.tsx:430` shows `item.location` as a subtitle line, nothing more.
- Filtering: `filterLocation` is a **substring `contains` match** (`app/punch-list.tsx:175-178`, drawer input `820-827`). It's the only spatial filter. "Master Bath" and "master bathroom" do not group; "Kitchen" and "Kitchen — Electrical" (AI-polluted) match differently. There is no room list, no floor grouping, no plan/zone dimension.

### 1.5 Plan-pin integration — real link, but one-directional and shallow
The plan viewer (`app/plan-viewer.tsx`) is a legitimately capable single-sheet tool: normalized (0–1) pin coords that survive zoom/resize (lines 181-186), freehand markup, two-tap measure + calibrate to real feet (lines 164-178, 295-312). It defines a `punch` pin kind (`PIN_COLORS`, line 53) and `DrawingPin.linkedPunchItemId` (`types/index.ts:2106`).

But the wiring is thin:
- **Link direction is pin → punch only.** From a pin you can *link an already-existing* punch item via `PunchPicker` (`plan-viewer.tsx:823-829`, `864-895`). You **cannot create** a new punch item from a pin, and you cannot pick a plan location while creating a punch item.
- **The punch item has no back-reference.** `PunchItem` carries no `planSheetId` or pin id. So from the punch list there is *no* indication an item is pinned, no "view on plan" affordance, no navigation. The relationship is invisible everywhere except inside that one pin's detail sheet.
- **Punch items never auto-render on a plan.** The viewer draws only `DrawingPin`s (`plan-viewer.tsx:501-518`). A punch item created in walk mode or AI punch (99% of them) has no pin and will never appear on any drawing. There is no "punch layer" over a sheet.
- **Two disconnected location systems.** GPS coords (from the photo) and plan-pin coords (0–1 on a sheet) never meet — an item can have one, the other, or (usually) neither, and nothing reconciles them.

### 1.6 Web vs iOS parity
- Pin drop, markup, link, and the punch link all work cross-platform (tap-based, `handleImgPress` line 188).
- **Pinch-zoom is iOS-only:** `maximumZoomScale`/`pinchGestureEnabled` are gated to `Platform.OS === 'ios'` (`plan-viewer.tsx:362-364`); Android/web get fit-to-view only (acknowledged in the header comment, lines 6-9). On web, a large architectural sheet is unzoomable, so precise pin placement is hard — the exact use case that matters for location.
- Camera capture uses `expo-image-picker` (falls back to a file picker on web) — acceptable.

### 1.7 There is no floor/zone hierarchy for punch
`PlanZone` exists (`types/index.ts:2115-2125`) but is the "Living Floor Plan" feature bound to **schedule tasks** (`linkedTaskIds`), not punch. No level/building/room taxonomy is available to punch anywhere.

---

## 2. Gaps — what a foreman/PM cannot do today

1. **Can't drop a punch pin on a floor plan.** The single most expected punch action in every competitor is missing. You can only retro-link an existing punch to a pin, buried in the pin sheet.
2. **Can't see punch items on a drawing.** No punch layer; walk-mode/AI items never surface spatially. A GC can't hand a sub a plan with their 12 items pinned.
3. **Can't filter/group by structured location.** No room or floor dimension — only fragile substring text match, further polluted by AI stuffing trade into `location`.
4. **GPS is captured but wasted.** Stamped on every save (3s budget), never shown, and dropped on sync (no server column). Cost with no benefit, and no map/site view to justify it.
5. **No back-navigation from a punch item to its location on a plan.** The pin link is invisible from the punch list.
6. **Web can't zoom plans**, undermining precise placement on the secondary surface.

---

## 3. Benchmark — how strong punch tools handle location

- **Fieldwire / PlanGrid / Procore:** every task/punch item is a **pin on a sheet**. Creating a punch *starts* by tapping a location on the drawing; the pin *is* the item. Filtering, exporting, and the sub's PDF all key off pin position.
- **Floor/level + area hierarchy:** items live under Building → Level → Sheet/Room. You filter "Level 2 open items," navigate sheet-to-sheet, and roll up counts per area.
- **Spatial filtering & layers:** toggle punch pins by status/trade/assignee directly on the plan; heat of open items per area is visible at a glance.
- **Map/GPS view** (site/civil): pins on a satellite/site map for scattered exterior work.
- **Closeout:** punch reports print the plan thumbnail with the pin, not just a text location.

MAGE has the *hard* substrate already — normalized pin coords, calibration, offline pins, a `punch` pin kind, a `linkedPunchItemId`. The gap is **product wiring**, not new infrastructure: make the pin the primary create surface, give the punch item a back-reference, render a punch layer, and add a light floor/room taxonomy.

---

## 4. Recommended build-out (phased)

### P0 — Make the plan-pin ↔ punch link real and bidirectional *(highest value / lowest risk; no native module, OTA-safe)*
**Data model** (`types/index.ts`, `PunchItem`):
```ts
planSheetId?: string;   // which sheet this item is pinned to
pinX?: number;          // 0..1 normalized (mirror DrawingPin)
pinY?: number;
```
Keep GPS fields but treat them as secondary.

**Create-from-pin** (`app/plan-viewer.tsx`): in `PinDetailModal`, add "Create punch item here" beside the existing "Link punch item" (near lines 762-766). It calls `addPunchItem` with `planSheetId`/`pinX`/`pinY` set from the pin, then sets `linkedPunchItemId` on the pin — reusing existing handlers.

**Back-reference in the list** (`app/punch-list.tsx`): if `item.planSheetId`, show a "On plan" chip on the row (near line 430) that routes to `/plan-viewer?sheetId=…` and selects the pin.

**Sync + schema:** add `plan_sheet_id`, `pin_x`, `pin_y` (and finally `photo_latitude/longitude/photo_location_label`) columns to `punch_items` (`supabase/schema.sql` + a migration via the documented `apply_migration` path), and add them to the insert/update payloads in `contexts/ProjectContext.tsx:2499-2521`. Fix the `assigned_sub_id` update-omission bug while there. Offline queue needs no change — it's field-additive on the same `supabaseWrite` calls.

*Effort: ~1–1.5 days. Files: `types/index.ts`, `app/plan-viewer.tsx`, `app/punch-list.tsx`, `contexts/ProjectContext.tsx`, `supabase/schema.sql` + migration.*

### P1 — Punch layer on the plan + light location taxonomy *(OTA-safe)*
- **Render a punch layer** in `plan-viewer.tsx` (alongside pins, ~line 501): draw all `PunchItem`s that have `planSheetId`/`pinX`/`pinY`, colored by status, tappable to open the item. A toggle to show/hide it.
- **Floor/room fields**: add optional `floor?: string` and `room?: string` (or reuse a `PlanSheet` as the "floor"). Add pickers to the punch form (`app/punch-list.tsx:568-577`) and walk mode (`app/punch-walk.tsx` location row) sourced from distinct existing values, so entries converge instead of drifting.
- **Structured grouping/filtering**: replace/augment the substring `filterLocation` (`punch-list.tsx:175-178`) with floor/room facets in the filter drawer; add a "group by floor/room" list mode.
- **Stop polluting `location` with trade**: add a real `trade?: SubTrade` field to `PunchItem` and remove the `"${location} — ${trade}"` hack (`ai-punch.tsx:287-289`); render trade as its own chip.

*Effort: ~2–3 days. Files: `types/index.ts`, `app/plan-viewer.tsx`, `app/punch-list.tsx`, `app/punch-walk.tsx`, `app/ai-punch.tsx`, `contexts/ProjectContext.tsx` + migration.*

### P2 — Spatial polish & parity
- **Web/Android plan zoom**: add `react-native-reanimated`/gesture pinch (already a dependency family) so precise pin placement works off-iOS. Verify it stays Fabric/TurboModule-compatible (New Arch is on) — a *pure-JS* reanimated approach is OTA-safe; a new native gesture module would break OTA and need a build.
- **Closeout with pins**: include the sheet thumbnail + pin location in the closeout packet (`utils/closeoutPacketGenerator.ts`, `utils/dataExport.ts:157-163` currently emits only text `location`).
- **Optional GPS/site map view**: only worth building if P0/P1 land and exterior/site work is a real segment; otherwise, either surface the already-captured GPS (cheap win) or stop capturing it. A map view needs `react-native-maps` (native module → breaks OTA, needs a build) — defer unless demanded.

*Effort: ~3–4 days, mostly P2 map/zoom. Native-module caveats noted inline.*

---

## 5. Recommended first build step
Ship **P0**: give `PunchItem` a `planSheetId`/`pinX`/`pinY` back-reference, add a "Create punch item here" action in the plan-viewer pin sheet, and show an "On plan → open" chip on the punch row. This converts the existing, already-built pin infrastructure from a dead-end one-way link into a real bidirectional plan-anchored punch item — the exact capability competitors lead with — in ~1 day, entirely OTA-safe, with the only "infra" work being additive Supabase columns (and fixing the GPS-fields-dropped-on-sync gap in the same pass).
