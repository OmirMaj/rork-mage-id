// components/messages/AttachmentViewer.tsx — one message photo, full screen
// (track MSG, lane MSGAPP). The components/punch/PunchPhotoViewer pattern:
// a Modal on near-black, Close top-left, the name and size as the caption,
// and "Save or share". Desktop web: the open viewer is a dialog to the
// shortcut registry, so Esc closes it and nothing behind it.
//
// A load failure says so and offers Retry (which re-signs the URL); it never
// leaves a broken image on screen.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2 } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { useMessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';
import type { ThreadAttachment } from '@/hooks/useMessageAttachmentUrls';

// A photo reads best on near-black whatever the theme; the ink on it is white.
const BACKDROP = 'rgba(0,0,0,0.95)';
const ON_BACKDROP = '#FFFFFF';
const ON_BACKDROP_SOFT = 'rgba(255,255,255,0.16)';
const FRAME_MAX = 1200;

export default function AttachmentViewer({ attachment, uri, onClose, onShare, onRetry }: {
  attachment: ThreadAttachment | null;
  /** The signed URL or the outbox's local copy; null while it is being signed. */
  uri: string | null;
  onClose: () => void;
  onShare: (att: ThreadAttachment) => void;
  onRetry: (att: ThreadAttachment) => void;
}) {
  const copy = useMessageAttachmentCopy();
  const insets = useSafeAreaInsets();
  const open = !!attachment;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [attachment?.id, uri]);
  useSheetDialogScope(open);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="message-attachment-viewer">
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={copy.close}
            testID="message-attachment-viewer-close"
          >
            <X size={22} color={ON_BACKDROP} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.caption} numberOfLines={2}>
            {attachment ? `${attachment.name} · ${copy.size(attachment.size)}` : ''}
          </Text>
        </View>
        <View style={styles.imageWrap}>
          {attachment && failed ? (
            <View style={styles.failed}>
              <Text style={styles.failedText}>{copy.photoLoadFailed}</Text>
              <TouchableOpacity
                onPress={() => { setFailed(false); onRetry(attachment); }}
                style={styles.pill}
                accessibilityRole="button"
                testID="message-attachment-viewer-retry"
              >
                <Text style={styles.pillText}>{copy.retry}</Text>
              </TouchableOpacity>
            </View>
          ) : attachment && uri ? (
            <Image
              source={{ uri, cacheKey: attachment.id }}
              style={styles.image}
              contentFit="contain"
              onError={() => setFailed(true)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <ActivityIndicator color={ON_BACKDROP} />
          )}
        </View>
        {attachment ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              onPress={() => onShare(attachment)}
              style={styles.pill}
              accessibilityRole="button"
              testID="message-attachment-viewer-share"
            >
              <Share2 size={16} color={ON_BACKDROP} strokeWidth={1.75} />
              <Text style={styles.pillText}>{copy.share}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: BACKDROP },
  // Desktop: the caption and the photo sit in a frame, not edge to edge of a 27-inch window.
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingBottom: 12,
    width: '100%', maxWidth: FRAME_MAX, alignSelf: 'center',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -11, marginLeft: -11 },
  caption: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: ON_BACKDROP },
  imageWrap: { flex: 1, width: '100%', maxWidth: FRAME_MAX, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1, width: '100%' },
  failed: { alignItems: 'center', gap: 14, paddingHorizontal: 24 },
  failedText: { fontSize: Type.bodyCompact.fontSize, color: ON_BACKDROP, textAlign: 'center' },
  footer: { alignItems: 'center', paddingTop: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    paddingHorizontal: 18, borderRadius: Tokens.radius.full, backgroundColor: ON_BACKDROP_SOFT,
  },
  pillText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: ON_BACKDROP },
});
