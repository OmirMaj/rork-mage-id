// FeatureHeader — the canonical "what is this screen" header.
//
// Why this exists: audit found ~10-15 features (Buyout, AIA Pay App,
// OAC Meeting, COI Vault, Lien Waivers, Cash Flow Forecaster, Closeout
// Binder, Handover, RFI, Submittal) where the page title is a bare
// industry term that a brand-new user can't decode. The fix isn't a
// tour or tooltip — it's surfacing a one-line plain-English description
// at the top of every jargon-y screen, with the formal term offered as
// a `(?)` chip the user can tap to dive deeper.
//
// 2025 SOTA pattern (Stripe / Linear / Notion content design): state
// the everyday outcome before naming the feature, then let the formal
// term hang as a parenthetical / chip.
//
// Render at the top of a screen (immediately under the native nav bar)
// before the screen's primary content. Hides automatically once the
// user has any data (pass `compact` to collapse to just the title +
// chip on subsequent visits).

import React, { memo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { HelpCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { FeatureExplainerSheet, type FeatureExplainerSheetProps } from '@/components/FeatureExplainerSheet';
import { Tokens } from '@/constants/designTokens';

export interface FeatureHeaderProps {
  /** Formal industry term, rendered tiny + uppercase above the title.
   *  Optional — leave blank if the title itself is plain-English. */
  eyebrow?: string;
  /** The plain-English headline. Required. */
  title: string;
  /** One-sentence "why you'd use this" body copy. */
  subtitle?: string;
  /** Compact mode hides the subtitle (e.g., on subsequent visits). */
  compact?: boolean;
  /** When set, a (?) chip renders that opens an explainer half-sheet. */
  explainer?: Omit<FeatureExplainerSheetProps, 'visible' | 'onClose'>;
  style?: ViewStyle;
  testID?: string;
}

function FeatureHeaderImpl({
  eyebrow,
  title,
  subtitle,
  compact = false,
  explainer,
  style,
  testID,
}: FeatureHeaderProps) {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const onChipPress = useCallback(() => setExplainerOpen(true), []);
  const onExplainerClose = useCallback(() => setExplainerOpen(false), []);

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {!!eyebrow && (
            <Text style={[Type.eyebrow, { color: Colors.textMuted, marginBottom: 4 }]} numberOfLines={1}>
              {eyebrow}
            </Text>
          )}
          <Text style={[Type.title2, { color: Colors.text }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
        {explainer && (
          <TouchableOpacity
            onPress={onChipPress}
            activeOpacity={0.7}
            style={styles.chip}
            testID={testID ? `${testID}-explainer-chip` : 'feature-header-chip'}
            accessibilityLabel={`Learn more about ${title}`}
          >
            <HelpCircle size={16} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>
      {!compact && !!subtitle && (
        <Text style={[Type.subhead, { color: Colors.textSecondary, marginTop: 6 }]}>
          {subtitle}
        </Text>
      )}

      {explainer && (
        <FeatureExplainerSheet
          {...explainer}
          visible={explainerOpen}
          onClose={onExplainerClose}
        />
      )}
    </View>
  );
}

export const FeatureHeader = memo(FeatureHeaderImpl);

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
    marginTop: 2,
  },
});
