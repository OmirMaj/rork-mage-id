// FeatureHeader — the `variant="feature"` door into ScreenHeader, plus the
// explainer half-sheet it owns.
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
//
// The header ROW itself — serif title, <h1>, eyebrow, spacing — moved to
// components/ui/ScreenHeader.tsx on 2026-09-07 and is now shared with
// PageHeader and ToolHeader. What is left here is the piece that is genuinely
// this component's own: the explainer sheet and its open/closed state.

import React, { memo, useState, useCallback } from 'react';
import type { ViewStyle } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FeatureExplainerSheet, type FeatureExplainerSheetProps } from '@/components/FeatureExplainerSheet';

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
    <>
      <ScreenHeader
        variant="feature"
        title={title}
        eyebrow={eyebrow}
        subtitle={compact ? undefined : subtitle}
        onExplainerPress={explainer ? onChipPress : undefined}
        style={style}
        testID={testID}
      />
      {explainer && (
        <FeatureExplainerSheet
          {...explainer}
          visible={explainerOpen}
          onClose={onExplainerClose}
        />
      )}
    </>
  );
}

export const FeatureHeader = memo(FeatureHeaderImpl);
