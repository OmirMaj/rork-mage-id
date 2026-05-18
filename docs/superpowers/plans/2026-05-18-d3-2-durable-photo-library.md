# D3-2 — Durable Searchable Photo Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** `app/project-detail.tsx`'s photos section becomes a real library — all photos shown (no 12-cap, no dead `+N`), a free-text search across tag/location/linked-task/geo-label, and an auto-album-by-date grouped view toggleable with the flat grid.

**Architecture:** Single-file change to `app/project-detail.tsx` (one tightly-coupled render block — uncap + search + album are meaningless apart; sibling of D3-1's single-file `client-view.tsx` enhancement). Reuses the existing `groupPhotosByDay` pure helper from `utils/photoShareToken.ts` AS-IS. App-only, OTA-able, **no migration / no ProjectContext change / no data-model change / no portal** → independent of H4's Netlify block.

**Tech Stack:** React Native (`TextInput`, `TouchableOpacity`, `Image` — all already imported), `lucide-react-native` (`CalendarDays`, `Layers`, `Camera`, `Pencil` — all already imported), TS strict. No unit runner — gate = `npx tsc --noEmit` + manual reasoning (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d3-2-durable-photo-library-design.md` (@ `486ec80`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- Confine ALL changes to `app/project-detail.tsx` (state + the photos-section IIFE + its `makeStyles` at `:3862`). Do NOT modify `contexts/ProjectContext.tsx`, `utils/photoShareToken.ts` (reuse `groupPhotosByDay` AS-IS — do not edit it), `types/index.ts`, or any other file. The 5 H5 cross-project photo consumers and every other `project-detail.tsx` section must be byte-unaffected.
- Build authors code only; ships via OTA at the controller ship step (NOT in this plan).
- Gate: `npx tsc --noEmit` clean + spec §6 manual reasoning.

## Anchors (verified @ 486ec80)
- `app/project-detail.tsx:20` — `ProjectPhoto` already imported from `@/types`.
- `:37-41` — existing import block: `import { buildPhotoSharePayload, encodePhotoShareToken, PHOTO_SHARE_MAX } from '@/utils/photoShareToken';` (add `groupPhotosByDay` here — no new import line).
- `:13` `CalendarDays`, `:14` `Layers`, `:16` `Camera`/`Pencil`, `:4` `TextInput`, `:51` `FilterChipRow, { type FilterChip }` — all already imported.
- `:181` — `const projectPhotos = useMemo(() => getPhotosForProject(id ?? ''), [id, getPhotosForProject]);` (already per-project; do NOT touch).
- `:402` `const [photoFilter, setPhotoFilter] = useState<string>('all');`; `:404` `const [lightboxPhoto, setLightboxPhoto] = useState<ProjectPhoto | null>(null);` (add new state right after `:404`).
- Photos IIFE `:2941-3001` (full current text reproduced in Step 3).
- `:3862` — `const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({` — the style factory holding `photoGrid` (`:4069`), `photoThumb` (`:4070`), `photoThumbImage` (`:4071`), `photoThumbDate` (`:4072`), `photoThumbDateOverlay` (`:4073`), `photoThumbMarkupBadge` (`:4074`), `punchMoreText` (`:4040`), `inviteInput` (`:4002`, the input style to mirror). `Tokens` (`:63`) and `Type` (`:62`) imported.
- `groupPhotosByDay` (verified `utils/photoShareToken.ts:113`): `export function groupPhotosByDay<T extends { ts: string }>(photos: T[]): { dayISO: string; items: T[] }[]` — already sorted newest-day-first (`b[0].localeCompare(a[0])`); `dayISO = (p.ts ?? '').slice(0,10) || 'unknown'`.

---

### Task 1: Uncap + free-text search + auto-album-by-date (single file)

**Files:** Modify `app/project-detail.tsx`

- [ ] **Step 1: Add `groupPhotosByDay` to the existing photoShareToken import**

Replace the existing block at `app/project-detail.tsx:37-41`:
```tsx
import {
  buildPhotoSharePayload,
  encodePhotoShareToken,
  PHOTO_SHARE_MAX,
} from '@/utils/photoShareToken';
```
with (alphabetical, single added name — no other change):
```tsx
import {
  buildPhotoSharePayload,
  encodePhotoShareToken,
  groupPhotosByDay,
  PHOTO_SHARE_MAX,
} from '@/utils/photoShareToken';
```

- [ ] **Step 2: Add search + group-by-date state (right after `:404` `lightboxPhoto`)**

After the line `const [lightboxPhoto, setLightboxPhoto] = useState<ProjectPhoto | null>(null);`, insert:
```tsx
  // D3-2: free-text photo search (matches tag / location / linked-task /
  // geo-label — all already persisted on ProjectPhoto) + auto-album-by-date
  // toggle. Default grouped: albums are the library win for a long project.
  const [photoSearch, setPhotoSearch] = useState<string>('');
  const [photoGroupByDate, setPhotoGroupByDate] = useState<boolean>(true);
```

- [ ] **Step 3: Replace the photos-section IIFE (uncap + search + album)**

Find this exact current block (`app/project-detail.tsx:2941-3001`):
```tsx
              {projectPhotos.length > 0 && (() => {
                // Build tag filter chips from the actual data — every distinct
                // tag becomes a chip, plus an "All" at the front. New tags
                // appear automatically without code changes.
                const tagCounts = projectPhotos.reduce<Record<string, number>>((acc, p) => {
                  const t = (p.tag ?? 'Untagged').trim() || 'Untagged';
                  acc[t] = (acc[t] ?? 0) + 1;
                  return acc;
                }, {});
                const chips: FilterChip<string>[] = [
                  { value: 'all', label: 'All', count: projectPhotos.length },
                  ...Object.entries(tagCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, count]) => ({ value: tag, label: tag, count })),
                ];
                const filtered = photoFilter === 'all'
                  ? projectPhotos
                  : projectPhotos.filter(p => (p.tag ?? 'Untagged').trim() === photoFilter || ((p.tag ?? '').trim() === '' && photoFilter === 'Untagged'));
                // Show 12 thumbs at this density; user can hit the gallery
                // for the full set (route TBD — for now we show the count).
                const visible = filtered.slice(0, 12);
                return (
                  <>
                    <FilterChipRow
                      chips={chips}
                      value={photoFilter}
                      onChange={setPhotoFilter}
                      noPadding
                      testID="photos-tag-filter"
                    />
                    <View style={styles.photoGrid}>
                      {visible.map(photo => (
                        <TouchableOpacity
                          key={photo.id}
                          style={styles.photoThumb}
                          activeOpacity={0.85}
                          onPress={() => setLightboxPhoto(photo)}
                          testID={`photo-thumb-${photo.id}`}
                        >
                          {photo.uri ? (
                            <Image source={{ uri: photo.uri }} style={styles.photoThumbImage} resizeMode="cover" />
                          ) : (
                            <Camera size={20} color={themeColors.textMuted} />
                          )}
                          {(photo.markup?.length ?? 0) > 0 && (
                            <View style={styles.photoThumbMarkupBadge}>
                              <Pencil size={10} color={themeColors.surface} />
                            </View>
                          )}
                          <View style={styles.photoThumbDateOverlay}>
                            <Text style={styles.photoThumbDate}>{new Date(photo.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {filtered.length > 12 && (
                      <Text style={styles.punchMoreText}>+{filtered.length - 12} more in this filter</Text>
                    )}
                  </>
                );
              })()}
```
Replace it **entirely** with (chip logic byte-identical; `.slice(0,12)` + `+N` removed; search + grouped/flat added; thumb markup factored into one local `renderThumb` so grouped and flat share a single source):
```tsx
              {projectPhotos.length > 0 && (() => {
                // Build tag filter chips from the actual data — every distinct
                // tag becomes a chip, plus an "All" at the front. New tags
                // appear automatically without code changes.
                const tagCounts = projectPhotos.reduce<Record<string, number>>((acc, p) => {
                  const t = (p.tag ?? 'Untagged').trim() || 'Untagged';
                  acc[t] = (acc[t] ?? 0) + 1;
                  return acc;
                }, {});
                const chips: FilterChip<string>[] = [
                  { value: 'all', label: 'All', count: projectPhotos.length },
                  ...Object.entries(tagCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, count]) => ({ value: tag, label: tag, count })),
                ];
                const filtered = photoFilter === 'all'
                  ? projectPhotos
                  : projectPhotos.filter(p => (p.tag ?? 'Untagged').trim() === photoFilter || ((p.tag ?? '').trim() === '' && photoFilter === 'Untagged'));
                // D3-2 search: applied AFTER the chip filter. Case-insensitive
                // substring over the fields ProjectPhoto already persists, so
                // "electrical rough" matches whichever field carries it. Empty
                // query is identity → byte-equivalent to the pre-D3-2 result.
                const q = photoSearch.trim().toLowerCase();
                const searched = q === ''
                  ? filtered
                  : filtered.filter(p =>
                      [p.tag, p.location, p.linkedTaskName, p.locationLabel]
                        .map(x => x ?? '')
                        .join(' ')
                        .toLowerCase()
                        .includes(q),
                    );
                const dayLabel = (dayISO: string) =>
                  dayISO === 'unknown'
                    ? 'Undated'
                    : new Date(dayISO + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const renderThumb = (photo: ProjectPhoto) => (
                  <TouchableOpacity
                    key={photo.id}
                    style={styles.photoThumb}
                    activeOpacity={0.85}
                    onPress={() => setLightboxPhoto(photo)}
                    testID={`photo-thumb-${photo.id}`}
                  >
                    {photo.uri ? (
                      <Image source={{ uri: photo.uri }} style={styles.photoThumbImage} resizeMode="cover" />
                    ) : (
                      <Camera size={20} color={themeColors.textMuted} />
                    )}
                    {(photo.markup?.length ?? 0) > 0 && (
                      <View style={styles.photoThumbMarkupBadge}>
                        <Pencil size={10} color={themeColors.surface} />
                      </View>
                    )}
                    <View style={styles.photoThumbDateOverlay}>
                      <Text style={styles.photoThumbDate}>{new Date(photo.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                  </TouchableOpacity>
                );
                return (
                  <>
                    <FilterChipRow
                      chips={chips}
                      value={photoFilter}
                      onChange={setPhotoFilter}
                      noPadding
                      testID="photos-tag-filter"
                    />
                    <View style={styles.photoSearchRow}>
                      <TextInput
                        style={styles.photoSearchInput}
                        value={photoSearch}
                        onChangeText={setPhotoSearch}
                        placeholder="Search photos (tag, location, task)"
                        placeholderTextColor={themeColors.textMuted}
                        testID="photos-search-input"
                      />
                      <TouchableOpacity
                        style={styles.photoGroupToggle}
                        onPress={() => setPhotoGroupByDate(v => !v)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={photoGroupByDate ? 'Switch to grid view' : 'Group photos by date'}
                        testID="photos-group-toggle"
                      >
                        {photoGroupByDate ? (
                          <CalendarDays size={14} color={themeColors.accent} />
                        ) : (
                          <Layers size={14} color={themeColors.textMuted} />
                        )}
                        <Text style={styles.photoGroupToggleText}>{photoGroupByDate ? 'By date' : 'Grid'}</Text>
                      </TouchableOpacity>
                    </View>
                    {searched.length === 0 ? (
                      <Text style={styles.punchMoreText}>No photos match this filter.</Text>
                    ) : photoGroupByDate ? (
                      groupPhotosByDay(searched.map(p => ({ ts: p.timestamp, photo: p }))).map(group => (
                        <View key={group.dayISO} testID={`photo-day-${group.dayISO}`}>
                          <Text style={styles.photoDayHeader}>{dayLabel(group.dayISO)}</Text>
                          <View style={styles.photoGrid}>
                            {group.items.map(({ photo }) => renderThumb(photo))}
                          </View>
                        </View>
                      ))
                    ) : (
                      <View style={styles.photoGrid}>
                        {searched.map(photo => renderThumb(photo))}
                      </View>
                    )}
                  </>
                );
              })()}
```

- [ ] **Step 4: Add the new styles to `makeStyles` (`:3862` factory)**

In the `const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({ ... })` object (the one containing `photoGrid:` at `:4069`), add these five keys immediately **after** the `photoGrid: { ... },` line (they mirror in-file conventions: `inviteInput` `:4002` for the input; `Tokens.radius`/`themeColors.surfaceAlt`/`Type.*.fontSize`/`'as const'` as used by neighboring keys):
```tsx
  photoSearchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 8 },
  photoSearchInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  photoGroupToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 9, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt },
  photoGroupToggleText: { fontSize: Type.caption1.fontSize, color: themeColors.text, fontWeight: '600' as const },
  photoDayHeader: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
```

- [ ] **Step 5: Gate**

Run from the worktree root:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean (no errors). `groupPhotosByDay(searched.map(p => ({ ts: p.timestamp, photo: p })))` instantiates the generic as `T = { ts: string; photo: ProjectPhoto }` (satisfies `T extends { ts: string }`); the returned `{ dayISO; items: { ts; photo }[] }[]` destructures as `group.dayISO` / `group.items.map(({ photo }) => ...)` — type-clean.

Then reason through (report in the completion notes), per spec §6:
- Project >12 photos → **all** render (no `.slice(0,12)`, no `+N` text); each thumb still opens the existing `lightboxPhoto` (unchanged).
- Type "electrical" → only photos whose `tag`/`location`/`linkedTaskName`/`locationLabel` contains it (case-insensitive); clearing restores; composes with a selected tag chip (chip filter runs first, then search → intersection).
- `photoGroupByDate` default true → photos under newest-first day headers via `groupPhotosByDay` (`dayISO='unknown'` → "Undated"); tap toggle → flat grid; both honor active search+chip.
- Empty search **and** group-off → identical to pre-D3-2 except the 12-cap is gone (the only intended delta; chip path byte-equivalent).
- `searched.length === 0` (e.g. search matches nothing) → "No photos match this filter." (inside the existing `projectPhotos.length > 0` IIFE); `projectPhotos.length === 0` → the unchanged outer empty-state at `:2924` still shows; 1 photo → one dated group, no crash.
- Share-timeline button, tag chips, lightbox + markup overlay, section header/collapse/`count`, every other `project-detail.tsx` section, `ProjectContext`, `utils/photoShareToken.ts`, the 5 H5 cross-project photo consumers — byte-unaffected (only local view-state added; `projectPhotos`/`getPhotosForProject` untouched).

- [ ] **Step 6: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/project-detail.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D3-2): durable photo library — uncap + free-text search + auto-album-by-date"
```

---

## Ship (controller, after final whole-impl review — NOT build)
Code-only, OTA-able, no migration/portal. FF-merge `claude/p0-launch-on-main` → `main`, push, `eas update --branch production --message "D3-2 durable photo library"`. (Independent of H4's Netlify block.)

## Self-Review
**Spec coverage:** §1 scope (no ProjectContext/global-array touch; per-project via existing `getPhotosForProject`) → CRITICAL + Step 3 reads only `projectPhotos`; §4.1 uncap+kill `+N` → Step 3 (`.slice(0,12)` and the `+N` block removed); §4.2 free-text search over tag/location/linkedTaskName/locationLabel, empty=identity, after chip → Step 2 (state) + Step 3 (`q`/`searched`); §4.3 auto-album-by-date via `groupPhotosByDay`, default on, toggle, flat fallback → Step 2 + Step 3 (`photoGroupByDate`, grouped/flat branches) + Step 4 (`photoDayHeader`); §4.4 precedence/composition + unchanged surfaces → Step 3 (chip→search→group, FilterChipRow/lightbox/share unchanged); §5 error handling (optional-safe `?? ''`, search-zero state, 0/1-photo) → Step 3 + Step 5; §6 verification → Step 5. §7 (H5 global-array rework, D3-3) explicitly out of scope → CRITICAL. No gaps.
**Placeholder scan:** All code given in full (import, two state lines, the entire replacement IIFE, five style keys). No TBD/TODO; the only "match the file" directive (Step 4 styles) is given as concrete values mirroring named verified anchors (`inviteInput:4002`, neighbors), not a vague instruction. Exact line anchors throughout.
**Type/name consistency:** `photoSearch`/`setPhotoSearch` (string), `photoGroupByDate`/`setPhotoGroupByDate` (boolean), `q`, `searched`, `renderThumb(photo: ProjectPhoto)`, `dayLabel(dayISO: string)`, `group.dayISO`/`group.items`, styles `photoSearchRow`/`photoSearchInput`/`photoGroupToggle`/`photoGroupToggleText`/`photoDayHeader` — all consistent across Steps 2-4. `groupPhotosByDay<T extends {ts:string}>` instantiated with `{ ts: string; photo: ProjectPhoto }` matches the verified signature. `FilterChip`/`FilterChipRow`/`ProjectPhoto`/`CalendarDays`/`Layers`/`Camera`/`Pencil`/`TextInput`/`Tokens`/`Type` all already imported (verified anchors). Single task → no cross-task drift.
