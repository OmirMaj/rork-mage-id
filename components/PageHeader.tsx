// ============================================================================
// components/PageHeader.tsx — the `variant="page"` door into ScreenHeader.
//
//   [ Title         status-pill ]      [ search   actions ]
//
// The implementation moved to components/ui/ScreenHeader.tsx on 2026-09-07,
// where it is shared with FeatureHeader and ToolScreenChrome's ToolHeader. The
// audit's finding was that three separately-maintained headers dressed ~58
// screens and had drifted on typeface, on whether the title was an <h1>, and on
// eyebrow metrics — fixing them one at a time is what produced the split.
//
// This file stays because it has ~30 importers and its prop shape is the one
// they call. It adds nothing of its own.
// ============================================================================

import React from 'react';
import type { ViewStyle } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';

interface PageHeaderProps {
  title: string;
  /** Optional inline chip rendered immediately right of the title (e.g. sync status). */
  statusPill?: React.ReactNode;
  /** Optional icon-button cluster on the right (bell, +, etc.). */
  actions?: React.ReactNode;
  /** When set, renders a non-interactive search field that calls this on focus / press. */
  onSearchPress?: () => void;
  /** Hides the inline search field — useful on tabs that don't need it. */
  hideSearch?: boolean;
  /** Optional override for the placeholder shown in the search field. */
  searchPlaceholder?: string;
  /** Optional one-line subtitle under the title (e.g. "Updated 4m ago"). */
  subtitle?: string;
  style?: ViewStyle;
}

const PageHeader = React.memo(function PageHeader(props: PageHeaderProps) {
  return <ScreenHeader variant="page" {...props} />;
});

export default PageHeader;
