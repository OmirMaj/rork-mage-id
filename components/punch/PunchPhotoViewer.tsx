// components/punch/PunchPhotoViewer.tsx — an item's photo, full screen, with
// the markup he drew on it. Opened from Pin items' photo so he can read the
// defect before he taps where it is. Same pattern as the punch list's own
// viewer (app/punch-list.tsx): the CONTAINED markup overlay, because the
// annotator normalised its marks against a square cover crop and this viewer
// letterboxes the whole photo.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { ContainedPhotoMarkupOverlay } from '@/components/PhotoMarkupOverlay';
import type { PhotoMarkup } from '@/types';

// A photo reads best on near-black whatever the theme; the ink on it is white.
const BACKDROP = 'rgba(0,0,0,0.95)';
const ON_BACKDROP = '#FFFFFF';

export default function PunchPhotoViewer({ visible, uri, markup, caption, onClose }: {
  visible: boolean;
  uri: string | undefined;
  markup: PhotoMarkup[];
  caption: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            testID="pin-queue-photo-close"
          >
            <X size={22} color={ON_BACKDROP} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
        </View>
        {uri ? (
          <View style={styles.imageWrap}>
            <Image source={{ uri }} style={styles.image} resizeMode="contain" onError={onClose} />
            <ContainedPhotoMarkupOverlay markup={markup} uri={uri} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: BACKDROP },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingBottom: 12 },
  caption: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: ON_BACKDROP },
  imageWrap: { flex: 1, width: '100%', position: 'relative' },
  image: { flex: 1, width: '100%' },
});
