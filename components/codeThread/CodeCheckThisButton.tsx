/**
 * CodeCheckThisButton — "Code check this" from a punch item or a plan sheet.
 * It opens the Code Check screen for the job with the source attached; the
 * Code Check screen (L3) reads projectId / source / sourceId and seeds the
 * question from them. Nothing runs until he asks.
 *
 * iOS MODAL RULE: a host that renders this inside an RN Modal (the punch
 * edit sheet) passes its close as onBeforeNavigate; the push then waits
 * 350 ms on iOS so it does not land under a Modal that is still dismissing.
 */
import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { codeCheckRoute } from '@/utils/codeThread/actions';
import { IOS_MODAL_NAV_DELAY_MS } from './CodeThreadActions';

export interface CodeCheckThisButtonProps {
  projectId: string;
  source: 'project' | 'punch' | 'plan_sheet';
  sourceId?: string;
  variant: 'icon' | 'row';
  onBeforeNavigate?: () => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
}

export function CodeCheckThisButton({
  projectId,
  source,
  sourceId,
  variant,
  onBeforeNavigate,
  style,
  testID,
}: CodeCheckThisButtonProps): React.ReactElement {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const onPress = () => {
    onBeforeNavigate?.();
    const href = codeCheckRoute({ projectId, source, sourceId });
    setTimeout(() => router.push(href), Platform.OS === 'ios' ? IOS_MODAL_NAV_DELAY_MS : 0);
  };

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        testID={testID}
        style={style}
        onPress={onPress}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Code check this sheet"
      >
        <ShieldCheck size={20} color={colors.accent} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.row, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Code check this item"
    >
      <ShieldCheck size={20} color={colors.accent} />
      <Text style={styles.rowText}>Code check this item</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      alignSelf: 'stretch',
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 14,
      borderRadius: Tokens.radius.card,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surfaceAlt,
    },
    rowText: { ...Type.subheadEmphasized, color: t.text, flexShrink: 1 },
  });

export default CodeCheckThisButton;
