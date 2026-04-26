import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Camera, Sparkles, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ProjectPhoto, DailyFieldReport } from '@/types';
import { generateDFRFromPhotos } from '@/utils/voiceDFRParser';

interface Props {
  projectName: string;
  weatherStr: string;
  // Today's project photos (already filtered by date upstream).
  photos: ProjectPhoto[];
  onGenerated: (partial: Partial<DailyFieldReport>, usedPhotoIds: string[]) => void;
  isLocked?: boolean;
  onLockedPress?: () => void;
}

// Lets the GC pick which of today's site photos to feed into the DFR draft.
// Captions + GPS labels go into the AI prompt; the model returns a partial
// DFR (work performed, manpower, materials, issues). Pairs cleanly with the
// existing voice + schedule generators — the user can run any combination.
export default React.memo(function AIDFRFromPhotos({
  projectName, weatherStr, photos, onGenerated, isLocked, onLockedPress,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(photos.slice(0, 12).map(p => p.id)));
  const [loading, setLoading] = useState(false);

  const sortedPhotos = useMemo(() =>
    [...photos].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    }),
    [photos],
  );

  const togglePhoto = useCallback((id: string) => {
    if (loading) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (Platform_isMobile()) void Haptics.selectionAsync();
  }, [loading]);

  const selectedPhotos = useMemo(
    () => sortedPhotos.filter(p => selected.has(p.id)),
    [sortedPhotos, selected],
  );

  const handleGenerate = useCallback(async () => {
    if (loading) return;
    if (isLocked) { onLockedPress?.(); return; }
    if (selectedPhotos.length === 0) return;
    setLoading(true);
    if (Platform_isMobile()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const partial = await generateDFRFromPhotos(selectedPhotos, weatherStr, projectName);
      if (Platform_isMobile()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated(partial, selectedPhotos.map(p => p.id));
    } catch (err) {
      console.warn('[AIDFRFromPhotos] generation failed', err);
    } finally {
      setLoading(false);
    }
  }, [loading, isLocked, onLockedPress, selectedPhotos, weatherStr, projectName, onGenerated]);

  if (sortedPhotos.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerIconWrap}>
          <Camera size={16} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Draft from today&apos;s photos</Text>
          <Text style={styles.subtitle}>
            Pick what you want to include — we&apos;ll write the work narrative for you.
          </Text>
        </View>
        <Text style={styles.count}>{selected.size}/{sortedPhotos.length}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbsRow}
      >
        {sortedPhotos.map(p => {
          const isSel = selected.has(p.id);
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.thumb, isSel && styles.thumbSelected]}
              onPress={() => togglePhoto(p.id)}
              activeOpacity={0.85}
            >
              {p.uri ? (
                <Image source={{ uri: p.uri }} style={styles.thumbImg} resizeMode="cover" />
              ) : (
                <View style={[styles.thumbImg, { backgroundColor: Colors.border }]} />
              )}
              {isSel && (
                <View style={styles.checkBadge}>
                  <Check size={11} color="#FFF" />
                </View>
              )}
              {p.tag ? (
                <Text style={styles.thumbCaption} numberOfLines={1}>{p.tag}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[styles.btn, (loading || selected.size === 0) && styles.btnDisabled]}
        onPress={handleGenerate}
        disabled={loading || selected.size === 0}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Sparkles size={15} color="#FFF" />
        )}
        <Text style={styles.btnText}>
          {loading
            ? 'Drafting from photos…'
            : `Generate from ${selected.size} photo${selected.size === 1 ? '' : 's'}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

function Platform_isMobile() {
  // Tiny shim to avoid pulling Platform from RN here
  // — Haptics is a no-op on web so it's safe to always call,
  // but skipping avoids a console warning on RN Web.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native');
  return Platform.OS !== 'web';
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  headerIconWrap: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  count: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  thumbsRow: { gap: 8, paddingVertical: 4, paddingRight: 4 },
  thumb: {
    width: 86, height: 86, borderRadius: 10,
    overflow: 'hidden', backgroundColor: Colors.background,
    borderWidth: 2, borderColor: 'transparent',
    position: 'relative',
  },
  thumbSelected: { borderColor: Colors.primary },
  thumbImg: { width: '100%', height: '100%' },
  checkBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbCaption: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 4, paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#FFF', fontSize: 9, fontWeight: '600',
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: Colors.primary, borderRadius: 10, marginTop: 12,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});
