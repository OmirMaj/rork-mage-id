// components/livingModel/LivingModelEntryRow.tsx — the one door into the Living
// Model: a row on the project page.
//
// LIVING_MODEL_ENABLED is false for everyone. This row renders NOTHING unless
// utils/livingModel/allowed.livingModelAllowed says yes for the signed-in
// email, which today means the founder's master account (utils/owner.ts). It
// reads no model and loads no 3D library: tapping it only navigates to
// /living-model, and that route does its own check.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Boxes, ChevronRight } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { livingModelAllowed, livingModelIsOwnerPreview } from '@/utils/livingModel/allowed';
import { makeLivingModelStyles } from './styles';

export function LivingModelEntryRow({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  if (!livingModelAllowed(user?.email)) return null;
  return <EntryRow projectId={projectId} />;
}

function EntryRow({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const label = livingModelIsOwnerPreview() ? copy.entryPreviewLabel : copy.entryLabel;
  return (
    <Pressable
      style={[styles.panel, styles.ownerRow]}
      accessibilityRole="button"
      accessibilityLabel={label}
      // `as any`: the typed-route file (.expo/types/router.d.ts) is generated on each machine and may predate this route.
      onPress={() => router.push({ pathname: '/living-model' as any, params: { projectId } })}
      testID="living-model-entry-row"
    >
      <Boxes size={20} color={colors.text} strokeWidth={1.75} />
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{copy.entrySub}</Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}
