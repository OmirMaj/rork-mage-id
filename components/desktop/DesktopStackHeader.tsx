// components/desktop/DesktopStackHeader.tsx — the root Stack's header on
// desktop web, lined up with the page column (wave 6d restore, lane Z1).
//
// WHY. native-stack 7 on web draws each screen's header OUTSIDE the root
// Stack's `screenLayout` (DesktopPageFrame), as a full-width
// @react-navigation/elements <Header>. The frame centres the page in a
// Layout.page[kind] column, so on a framed route the Back button and title sat
// at the sidebar edge, far left of the content (6b measured at 2560: title at
// x = 256, column 1020–1780).
//
// HOW. app/_layout.tsx passes `header: renderDesktopStackHeader` in the root
// Stack's screenOptions ONLY on desktop web (`Platform.OS === 'web' &&
// layout.isDesktop`); a phone, and a native Android tablet, keep native-stack's
// own header. This component renders the SAME elements <Header> that
// native-stack's web NativeStackView renders
// (node_modules/@react-navigation/native-stack/src/views/NativeStackView.tsx,
// the `header !== undefined ? … : <Header …/>` branch — 7.14.11), with the
// same option split, plus one thing: the left and right containers move in by
// headerInsetFor(this header's OWN measured width, Layout.page[kind]) — so the
// 64 px rail and a shell-exempt route (no sidebar) come out right with no
// sidebar maths. A 'bleed' route and '(tabs)' get inset 0: exactly
// native-stack's header. See utils/desktopHeader for the rules and the
// accepted rfi / submittal 'table' inset (0 up to a 1600 px stack, 360 at
// 2560).
//
// No animation of its own; no surface recipe (the wrapper View has no
// background or radius — the header paints its own card colour as before);
// the title keeps screenOptions' NATIVE_HEADER_TITLE_FACE through
// headerTitleStyle.

import React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Header, HeaderBackButton, getHeaderTitle } from '@react-navigation/elements';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Layout } from '@/constants/designTokens';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { headerColumnKind, headerInsetFor } from '@/utils/desktopHeader';
import { DESKTOP_SHELL_EXEMPT } from '@/utils/desktopPage';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

export function DesktopStackHeader({ back, options, route, navigation }: NativeStackHeaderProps) {
  // First-paint estimate: a shell-exempt route (estimate-wizard, …) has no
  // sidebar, so its header spans the whole window. Without this the default
  // estimate (window minus sidebar) insets the first frame by the wrong column
  // and Back / the title jump once the real width lands.
  const layout = useResponsiveLayout();
  const exempt = DESKTOP_SHELL_EXEMPT.has(route.name.split('/')[0] ?? route.name);
  const { width, onLayout: onMeasured } = useContainerWidth(exempt ? layout.width : undefined);
  // native-stack keeps a covered screen mounted with display:none, where the
  // header measures 0 wide. Keeping that 0 would paint the next Back to this
  // route with no inset for a frame and then jump to the column, so a zero
  // width is ignored and the last real width stays.
  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    if ((e?.nativeEvent?.layout?.width ?? 0) > 0) onMeasured(e);
  }, [onMeasured]);
  const kind = headerColumnKind(route.name);
  const inset = kind ? headerInsetFor(width, Layout.page[kind]) : 0;

  // The option split NativeStackView does before it renders <Header {...rest}>:
  // the keys the Screen / the stack consume never reach the header. contentStyle
  // carries the page fade (app/_layout.tsx stackMotion), and the animation keys
  // are the stack's own.
  const {
    header: _header,
    headerShown: _headerShown,
    headerBackIcon: _headerBackIcon,
    headerBackImageSource: _headerBackImageSource,
    headerLeft,
    headerTransparent,
    headerBackTitle,
    presentation: _presentation,
    contentStyle: _contentStyle,
    animation: _animation,
    animationDuration: _animationDuration,
    animationTypeForReplace: _animationTypeForReplace,
    ...rest
  } = options;

  return (
    <View onLayout={onLayout}>
      <Header
        {...rest}
        back={back}
        title={getHeaderTitle(options, route.name)}
        headerLeft={
          typeof headerLeft === 'function'
            ? ({ label, ...p }) => headerLeft({ ...p, label: headerBackTitle ?? label })
            : headerLeft === undefined && back != null
              ? ({ tintColor, label, ...p }) => (
                  // No backImage branch: no route sets headerBackIcon or
                  // headerBackImageSource (git grep: 0). If one ever does, port
                  // NativeStackView's <Image> backImage here.
                  <HeaderBackButton
                    {...p}
                    label={headerBackTitle ?? label}
                    tintColor={tintColor}
                    onPress={navigation.goBack}
                  />
                )
              : headerLeft
        }
        headerTransparent={headerTransparent}
        // native-stack's options carry no container styles of their own, so
        // nothing a route sets is replaced here.
        headerLeftContainerStyle={inset ? { marginStart: inset } : undefined}
        headerRightContainerStyle={inset ? { marginEnd: inset } : undefined}
      />
    </View>
  );
}

/** Module-level, so the Stack's screenOptions never see a new function. */
export function renderDesktopStackHeader(props: NativeStackHeaderProps) {
  return <DesktopStackHeader {...props} />;
}

export default DesktopStackHeader;
