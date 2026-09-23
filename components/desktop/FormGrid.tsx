// components/desktop/FormGrid.tsx — label/field pairs laid out for a desk.
//
// WHY THIS EXISTS. The live probe on the founder's 1512 px MacBook measured
// text inputs 1000–1470 px wide on the invoice, change-order, daily-report,
// RFI, contacts and Copilot screens: a ZIP code in a box as wide as the
// monitor. FormGrid lays a form's fields in TWO columns when the form's own
// container is ≥ 1100 px, otherwise one, and caps each field at its size:
//
//   size   xs 120 (qty, %, days) · sm 200 (money, dates, phone, ZIP)
//          md 360 (name, email, company) · lg 560 (subject, address)
//          default ≈ 480 (Layout.field.search — "inputs capped at about 480")
//   span   'full' spans both columns, uncapped — question, description,
//          notes: text areas take the whole column.
//
// Gaps: 24 between columns, 16 between rows (Layout).
//
// PHONE IDENTICAL. On a phone FormGrid and FormField render their children
// in a fragment — no wrapper, no style — so a screen that wraps its existing
// label + input pairs keeps today's exact tree (proved in
// __tests__/smoke/desktop-primitives). Put the screen's OWN label and input
// inside FormField; it does not draw a label of its own for that reason.

import React, { createContext, useContext } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import {
  FORM_GRID_COL_GAP,
  FORM_GRID_ROW_GAP,
  formGridColumns,
  formGridSlotWidth,
} from '@/utils/splitViewLayout';

export type FormFieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'default' | 'full';

/** The desktop cap for a field of `size`. null = uncapped (fills its slot). */
export function formFieldCap(size: FormFieldSize): number | null {
  switch (size) {
    case 'xs': return Layout.field.xs;
    case 'sm': return Layout.field.sm;
    case 'md': return Layout.field.md;
    case 'lg': return Layout.field.lg;
    case 'full': return null;
    default: return Layout.field.search; // ≈ 480, the spec's general input cap
  }
}

interface GridCtx {
  columns: 1 | 2;
  width: number;
}
const FormGridContext = createContext<GridCtx | null>(null);

export interface FormGridProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FormGrid({ children, style, testID }: FormGridProps) {
  const { isDesktop } = useResponsiveLayout();
  const { width, onLayout, measured } = useContainerWidth();
  if (!isDesktop) return <>{children}</>;
  // Before the first measurement lay out one column: the estimate is the
  // window minus the sidebar, which can be far wider than a form inside a
  // 760 px page frame, and a two-column first paint would jump.
  const columns = measured ? formGridColumns(width, true) : 1;
  return (
    <FormGridContext.Provider value={{ columns, width }}>
      <View
        onLayout={onLayout}
        style={[{ flexDirection: 'row', flexWrap: 'wrap', columnGap: FORM_GRID_COL_GAP, rowGap: FORM_GRID_ROW_GAP }, style]}
        testID={testID}
      >
        {children}
      </View>
    </FormGridContext.Provider>
  );
}

export interface FormFieldProps {
  children: React.ReactNode;
  /** 'full' spans both columns (long text). Default 'half'. */
  span?: 'half' | 'full';
  /** The field's width cap on desktop. Default ≈ 480; `span="full"` defaults to uncapped. */
  size?: FormFieldSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FormField({ children, span = 'half', size, style, testID }: FormFieldProps) {
  const ctx = useContext(FormGridContext);
  const { isDesktop } = useResponsiveLayout();
  // Outside a FormGrid, or on a phone: exactly the children.
  if (!ctx || !isDesktop) return <>{children}</>;
  const slot = ctx.width > 0 ? formGridSlotWidth(ctx.width, ctx.columns, span) : undefined;
  const cap = formFieldCap(size ?? (span === 'full' ? 'full' : 'default'));
  const slotStyle: ViewStyle = span === 'full' || ctx.columns === 1
    ? { width: '100%' }
    : { width: slot };
  return (
    <View style={[slotStyle, style]} testID={testID}>
      {/* The cap sits on an inner column so the SLOT keeps the grid aligned
          while the input inside it stops at its natural size. */}
      <View style={cap !== null ? { maxWidth: cap, width: '100%' } : { width: '100%' }}>{children}</View>
    </View>
  );
}
