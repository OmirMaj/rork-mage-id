// CloudFilePicker — drop-in cloud storage picker.
//
// Renders a row of provider buttons (Google Drive, Dropbox, OneDrive,
// Box) limited to whatever's configured via env vars. Calls back with
// a CloudFileRef when the user picks a file, or null on cancel.
//
// Use anywhere a project / RFI / submittal needs an attached file:
//   <CloudFilePicker onPick={(ref) => attachToProject(ref)} />
//
// Cost-aware design: only providers with a configured client ID
// render. Adding a new provider is a single env var (rebuilds to
// pick up). Removing one is the same.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Cloud } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  pickFromCloud, configuredProviders,
  type CloudSource, type CloudFileRef,
} from '@/utils/cloudStorage';

interface Props {
  onPick: (ref: CloudFileRef) => void;
  /** Optional: limit to specific providers. Default: all configured. */
  providers?: CloudSource[];
  /** Label override. */
  label?: string;
}

const PROVIDER_LABEL: Record<CloudSource, string> = {
  gdrive: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  box: 'Box',
};

const PROVIDER_COLOR: Record<CloudSource, string> = {
  gdrive: '#0F9D58',   // Drive green
  dropbox: '#0061FF',  // Dropbox blue
  onedrive: '#0078D4', // Microsoft blue
  box: '#0061D5',      // Box blue
};

export default function CloudFilePicker({ onPick, providers, label }: Props) {
  const [busy, setBusy] = useState<CloudSource | null>(null);

  const available = (providers ?? configuredProviders()).filter(
    (p): p is CloudSource => ['gdrive', 'dropbox', 'onedrive', 'box'].includes(p),
  );

  const handlePick = useCallback(async (src: CloudSource) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(src);
    try {
      const ref = await pickFromCloud(src);
      if (ref) onPick(ref);
    } finally {
      setBusy(null);
    }
  }, [onPick]);

  if (available.length === 0) {
    return (
      <View style={styles.notConfigured}>
        <Cloud size={14} color={Colors.textMuted} />
        <Text style={styles.notConfiguredText}>
          No cloud storage configured. Set provider keys in env to enable Google Drive, Dropbox, OneDrive, or Box.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {available.map(src => (
          <TouchableOpacity
            key={src}
            style={[styles.btn, busy === src && styles.btnBusy]}
            onPress={() => handlePick(src)}
            disabled={busy !== null}
            activeOpacity={0.85}
            testID={`cloud-pick-${src}`}
          >
            {busy === src
              ? <ActivityIndicator size="small" color={PROVIDER_COLOR[src]} />
              : <View style={[styles.dot, { backgroundColor: PROVIDER_COLOR[src] }]} />}
            <Text style={styles.btnText}>{PROVIDER_LABEL[src]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Type.caption1,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  btn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  btnBusy: { opacity: 0.7 },
  btnText: {
    ...Type.bodyCompact,
    color: Colors.text,
    fontWeight: '600' as const,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notConfigured: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: 10,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.md,
  },
  notConfiguredText: {
    flex: 1,
    ...Type.caption1,
    color: Colors.textMuted,
    lineHeight: 16,
  },
});
