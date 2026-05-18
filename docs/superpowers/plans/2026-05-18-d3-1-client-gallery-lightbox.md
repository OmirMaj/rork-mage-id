# D3-1 — In-App Client Gallery: Uncap + Lightbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** `app/client-view.tsx` Site Photos shows ALL project photos (no 9-cap, no dead `+N`), every thumb tappable, opening a full-screen swipeable lightbox with tag/location/date.

**Architecture:** Single-file change to `app/client-view.tsx` (one tightly-coupled task — a tappable thumb is meaningless without the lightbox). RN `Modal` + horizontal paged `FlatList` (no new dependency). App-only, OTA-able, **no migration / no portal / no data-model change** → independent of H4's Netlify block.

**Tech Stack:** React Native (`Modal`, `FlatList`, `Image`, `Dimensions`, `TouchableOpacity` — all already imported in the file except `FlatList`), TS strict. No unit runner — gate = `npx tsc --noEmit` + manual reasoning (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d3-1-client-gallery-lightbox-design.md` (@ `be94ef6`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- Confine changes to `app/client-view.tsx` (styles in its existing `useThemedStyles` `makeStyles`). No other file. No `marketing/`/portal, no migration, no data-model/`ProjectPhoto` change, no GC-photo-flow change. Behavior of every OTHER `client-view.tsx` section byte-unchanged.
- Build authors code only; ships via OTA at the controller ship step.
- Gate: `npx tsc --noEmit` clean + the spec §6 manual reasoning.

## File Structure
- Modify `app/client-view.tsx` only: import tweak, lightbox state, Site Photos grid body (uncap + tappable), a new lightbox `<Modal>`, a few styles.

---

### Task 1: Uncap grid + tappable thumbs + full-screen lightbox (single file)

**Files:** Modify `app/client-view.tsx`

- [ ] **Step 1: Imports**

In the `react-native` import (lines 2-5, currently `View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions, TextInput, Platform, Modal, Alert`) add `FlatList`. For the lightbox close control, reuse a lucide icon already imported in the file's icon import block (line ~12-17) — grep that block; if `X` or `ChevronLeft` is already imported use it, else add `X` to that existing `lucide-react-native` import line. Add nothing else.

- [ ] **Step 2: Lightbox state**

Near the other `useState` in the component, add:
```tsx
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
const screenW = Dimensions.get('window').width;
```
(`Dimensions` is already imported. `photos` is the existing in-scope array used by the Site Photos section.)

- [ ] **Step 3: Replace the Site Photos grid body (uncap + tappable, kill dead +N)**

Find the Site Photos block (~:889-902):
```tsx
<View style={styles.photoGrid}>
  {photos.slice(0, 9).map(photo => (
    <View key={photo.id} style={styles.photoThumb}>
      <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
      {photo.tag && (<View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>)}
    </View>
  ))}
  {photos.length > 9 && (
    <View style={[styles.photoThumb, styles.photoMoreOverlay]}>
      <Text style={styles.photoMoreText}>+{photos.length - 9}</Text>
    </View>
  )}
</View>
```
Replace with (map ALL photos with index; each thumb a `TouchableOpacity` opening the lightbox; delete the `+N` block entirely):
```tsx
<View style={styles.photoGrid}>
  {photos.map((photo, i) => (
    <TouchableOpacity
      key={photo.id}
      style={styles.photoThumb}
      activeOpacity={0.8}
      onPress={() => setLightboxIndex(i)}
    >
      <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
      {photo.tag && (<View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>)}
    </TouchableOpacity>
  ))}
</View>
```
Do not change the surrounding `{portal.showPhotos && photos.length > 0 && (...)}` gate, the `SectionHeader`, the `expanded.photos` collapse, or the `count`. `styles.photoMoreOverlay`/`photoMoreText` become unused — remove those two style keys (they were only for the deleted `+N`).

- [ ] **Step 4: Lightbox Modal**

Add this near the other modals (mirror the existing `<Modal>` at ~:1056-1057's prop conventions — `transparent`, `animationType`, `onRequestClose`). Place it inside the component's returned tree (e.g. alongside the CO Approval Modal):
```tsx
<Modal
  visible={lightboxIndex !== null}
  transparent
  animationType="fade"
  onRequestClose={() => setLightboxIndex(null)}
>
  <View style={styles.lbBackdrop}>
    <View style={styles.lbHeader}>
      <TouchableOpacity onPress={() => setLightboxIndex(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <X size={26} color="#FFF" />
      </TouchableOpacity>
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <Text style={styles.lbCaption} numberOfLines={1}>
          {[
            photos[lightboxIndex].tag,
            photos[lightboxIndex].location || photos[lightboxIndex].locationLabel,
            new Date(photos[lightboxIndex].timestamp || photos[lightboxIndex].createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          ].filter(Boolean).join('  ·  ')}
        </Text>
      )}
    </View>
    {lightboxIndex !== null && (
      <FlatList
        data={photos}
        keyExtractor={p => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={Math.min(Math.max(lightboxIndex, 0), Math.max(photos.length - 1, 0))}
        getItemLayout={(_, index) => ({ length: screenW, offset: screenW * index, index })}
        onMomentumScrollEnd={e => setLightboxIndex(Math.round(e.nativeEvent.contentOffset.x / screenW))}
        renderItem={({ item }) => (
          <View style={{ width: screenW }}>
            <Image source={{ uri: item.uri }} style={styles.lbImage} resizeMode="contain" />
          </View>
        )}
      />
    )}
  </View>
</Modal>
```
(If the file's existing modal uses a different close icon than `X`, use that icon name instead — match the file. `X` from `lucide-react-native` per Step 1.)

- [ ] **Step 5: Styles**

In the file's `makeStyles` (the `useThemedStyles` style factory, near `photoGrid`/`photoThumb` ~:1280), remove the now-unused `photoMoreOverlay` + `photoMoreText` keys and add:
```tsx
lbBackdrop: { flex: 1, backgroundColor: '#000000F2' },
lbHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },
lbCaption: { flex: 1, color: '#FFF', fontSize: 13, fontWeight: '600' },
lbImage: { width: '100%', height: '100%' },
```
(Match the file's existing style-object conventions; the `makeStyles` signature/`t` theme param is whatever the file already uses — don't change it.)

- [ ] **Step 6: Gate**

`npx tsc --noEmit` from worktree root → clean. Reason through (report): >9 photos → all render, each tappable; tap → lightbox at that index; swipe pages all photos; caption tracks current photo (tag·location·date) via `onMomentumScrollEnd`; close resets to grid; `photos.length===0` → section still hidden by the unchanged gate (lightbox never opens); 1 photo → no pager crash (`initialScrollIndex` clamped, `getItemLayout` fixed). Every other section + the GC photo flows untouched. No new dependency.

- [ ] **Step 7: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/client-view.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D3-1): client gallery — uncap photos + tappable + full-screen lightbox"
```

---

## Ship (controller, after final whole-impl review — NOT build)
Code-only, OTA-able, no migration/portal. FF-merge `claude/p0-launch-on-main` → `main`, push, `eas update --branch production --message "D3-1 client gallery lightbox"`. (Independent of H4's Netlify block.)

## Self-Review
**Spec coverage:** §4.1 uncap+tappable → Step 3; §4.2 lightbox (Modal + paged FlatList + caption-sync + close) → Steps 2,4,5; §3 non-goals (no data/portal/migration, no markup overlay, no new dep, GC flows untouched) → CRITICAL + steps confine to client-view.tsx; §5 error handling (empty/1-photo, clamp, gate unchanged) → Step 6; §6 verification → Step 6. D3-2/D3-3 not in scope (spec §1/§7). No gaps.
**Placeholder scan:** All code given in full (state, grid replacement, Modal, styles). The only conditional instructions ("if `X`/`ChevronLeft` already imported reuse it else add `X`"; "match the file's makeStyles `t` param / existing modal close icon") are precise adapt-to-real-file directives against named anchors, not vague TODOs. Exact line anchors given.
**Type/name consistency:** `lightboxIndex`/`setLightboxIndex` (number|null), `screenW`, `photos` (the existing array), styles `lbBackdrop/lbHeader/lbCaption/lbImage`, removed `photoMoreOverlay/photoMoreText` — all consistent across Steps 2-6. `ProjectPhoto` fields used (`uri,tag,location,locationLabel,timestamp,createdAt,id`) match the verified type. Single task → no cross-task drift.
