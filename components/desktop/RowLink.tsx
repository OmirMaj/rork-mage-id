// ============================================================================
// components/desktop/RowLink.tsx — a row that is a real link on the web.
//
// The web app had 0 expo-router <Link>s against ~425 router.push calls, so no
// row in it was a link: hovering showed no URL, Cmd-click and middle-click did
// nothing, and "Copy link address" was not on the menu. A GC comparing two jobs
// could not open the second in a new tab.
//
// On WEB this wraps the row in `<Link href push asChild>`. expo-router hands the
// child an `href` (group segments stripped, e.g. /(tabs)/summary → /summary)
// and react-native-web renders a Pressable with an href as an <a>. A plain
// left click is still an in-app push — Link's handler preventDefaults it — and
// a click with Cmd / Ctrl / Shift, or a middle click, is left to the browser,
// which opens a new tab. The browser's native context menu IS the right-click
// menu: on an <a> it already offers "Open link in new tab / window" and "Copy
// link address". Never preventDefault the context-menu event on a RowLink or a
// linked DataTable row — a custom menu would only take those away (wave 6d).
//
// On NATIVE it is a plain Pressable that pushes the same href, so a phone
// row keeps its exact behaviour.
//
// Side effects (recents, analytics) do not belong in onPress: a Cmd-click
// never runs the in-app handler's navigation, and a pasted URL never taps the
// row at all. Put them on the destination's mount (see
// contexts/ActiveProjectContext, which follows the URL for exactly this
// reason). `onPress` is still offered for UI-only side effects such as closing
// a popover; on web it runs before Link's navigation.
// ============================================================================

import React from 'react';
import {
  Platform, Pressable, View,
  type PressableStateCallbackType, type StyleProp, type ViewStyle,
} from 'react-native';
import { Link, useRouter, type Href, type Route } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

/** Pressable's state, plus the `hovered` flag react-native-web adds. */
export type RowLinkState = PressableStateCallbackType & { hovered?: boolean };

export interface RowLinkProps {
  href: Href;
  onPress?: () => void;
  children: React.ReactNode | ((state: RowLinkState) => React.ReactNode);
  /** A static style gets the default hover background (the surfaceAlt token);
   *  a function style owns its hover look (the dark sidebar does). */
  style?: StyleProp<ViewStyle> | ((state: RowLinkState) => StyleProp<ViewStyle>);
  accessibilityLabel?: string;
  testID?: string;
  /** For a row that is the current page (screen readers + aria-current). */
  selected?: boolean;
}

/**
 * The one place a route-checked pathname becomes an Href object.
 *
 * `pathname` is typed `Route`, so under typed routes every call site's literal
 * is checked against the real app/ tree — a typo is a compile error there. The
 * conversion below exists only because TypeScript cannot assign an object
 * whose `pathname` is a ~190-member union to Href's ~190-member union of
 * per-route objects (it gives up past 25 combinations); it does not widen what
 * a caller may pass.
 */
export function routeHref(pathname: Route, params?: Record<string, string>): Href {
  return (params ? { pathname, params } : { pathname }) as Href;
}

export function RowLink({
  href, onPress, children, style, accessibilityLabel, testID, selected,
}: RowLinkProps) {
  const { colors: t } = useTheme();
  const router = useRouter();

  const resolvedStyle = (state: RowLinkState): StyleProp<ViewStyle> => {
    if (typeof style === 'function') return style(state);
    return [style, state.hovered ? { backgroundColor: t.surfaceAlt } : null];
  };

  if (Platform.OS !== 'web') {
    return (
      <Pressable
        onPress={() => { onPress?.(); router.push(href); }}
        style={resolvedStyle}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={selected ? { selected: true } : undefined}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }

  return (
    // `push`, not Link's default `navigate`: the sidebar pushed before this
    // file existed, and navigate() to the route you are already on can update
    // its params IN PLACE. Every project tool ranks a local pick over the URL
    // (`pickedProjectId ?? paramProjectId`), so an in-place param swap from the
    // job switcher would leave the old job on screen. A push mounts a fresh
    // screen for the new job.
    <Link href={href} push asChild>
      <LinkSurface
        // Radix's Slot composes this with Link's own press handler: ours runs
        // first, then Link decides between an in-app push and the browser's
        // new-tab default.
        onPress={onPress}
        rowStyle={resolvedStyle}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        selected={selected}
      >
        {children}
      </LinkSurface>
    </Link>
  );
}

type LinkSurfaceProps = React.ComponentProps<typeof Pressable> & {
  rowStyle: (state: RowLinkState) => StyleProp<ViewStyle>;
  selected?: boolean;
};

/**
 * The child Link's Slot clones. It exists for one reason: Radix's Slot merges
 * `style` by object spread, which turns a style FUNCTION (or an RN style
 * array) into `{}`. The row's style therefore travels as `rowStyle`, a prop
 * the Slot does not touch, and the Slot-provided `style` is dropped. Every
 * other prop Link supplies (href, role="link", its press handler) passes
 * straight through to the Pressable, which react-native-web renders as <a>.
 */
const LinkSurface = React.forwardRef<View, LinkSurfaceProps>(function LinkSurface(
  { rowStyle, selected, style: _slotStyle, ...rest },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      {...rest}
      style={rowStyle}
      {...({ 'aria-current': selected ? 'page' : undefined } as object)}
    />
  );
});
