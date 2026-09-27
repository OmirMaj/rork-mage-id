// Loading — the one way to put a loader in front of content.
//
//   <Loading ready={!!data} scope="section" caption="Pricing your scope">
//     {() => (data ? <Estimate data={data} /> : null)}
//   </Loading>
//
// - ready at MOUNT → the children render directly: no wrapper, no loader
//   (golden-stable for cached reads). Decided once.
// - otherwise the gate (hooks/useLoadingGate): nothing for the first delayMs
//   (work that finishes inside it shows NOTHING and the content appears with
//   no Arrive), then the level; once visible it holds for minMs; then it
//   settles (or fades) while the content arrives under it.
// - children may be a render function: JSX children are evaluated eagerly, so
//   pass a function when they dereference data that is undefined until ready.
// - The content mounts when the exit starts (not during the hold, so it never
//   shows through a holding loader); once mounted it stays mounted (a later
//   restart puts the loader back over it, never remounts it).
// - THE RESTART CONTRACT for render-function children: after a restart (ready
//   goes false again once the content has mounted — a refetch, a query-key
//   change) the content stays mounted UNDER the loader, so the function is
//   still called while ready === false. It must tolerate stale or undefined
//   data: guard it (`data ? <X data={data} /> : null`), never `data!`, or a
//   cleared query throws mid-restart. (Adopters and the codemod wave: this
//   is the one sharp edge of "once wrapped, stay wrapped".)

import React, { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { useReducedMotion } from '@/components/ui/motion';
import { useLoadingGate } from '@/hooks/useLoadingGate';
import { GATE, type GateScope } from '@/utils/loadingGate';
import LevelMark, { useLevelReveal } from './LevelMark';
import ScreenLoader from './ScreenLoader';
import Arrive from './Arrive';
import { splashFallbackColors } from './themeFallback';

export interface LoadingProps {
  ready: boolean;
  scope?: GateScope;
  /** Screen-reader label (defaults to the caption, then 'Loading'). */
  label?: string;
  /** Visible words under the level (screen / section / knownSlow). */
  caption?: string;
  /** Override the level's width. */
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode | (() => React.ReactNode);
}

const renderChildren = (c: LoadingProps['children']) => (typeof c === 'function' ? (c as () => React.ReactNode)() : c);

export default function Loading(props: LoadingProps) {
  const [readyAtMount] = useState(props.ready);
  if (readyAtMount) return <>{renderChildren(props.children)}</>;
  return <LoadingGated {...props} />;
}

const MARK_W: Record<GateScope, number> = { button: 20, inline: 20, skeleton: 36, section: 36, knownSlow: 64, screen: 64 };

function LoadingGated({ ready, scope = 'section', label, caption, size, style, testID = 'loading', children }: LoadingProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const reduce = useReducedMotion();
  const gate = useLoadingGate(!ready, scope);
  const cfg = GATE[scope];

  // Sticky: once the content has mounted it never unmounts.
  const contentMounted = useRef(false);
  if (ready && (!gate.show || gate.exiting)) contentMounted.current = true;

  const wordsScope = scope === 'screen' || scope === 'section' || scope === 'knownSlow';
  // Under Reduce Motion the caption is MANDATORY for screen / section scopes.
  const shownCaption = caption ?? (reduce && (scope === 'screen' || scope === 'section') ? (label ?? 'Loading') : undefined);

  const overlay = contentMounted.current;
  let loader: React.ReactNode = null;
  if (gate.show) {
    loader = scope === 'screen' ? (
      <ScreenLoader
        caption={shownCaption}
        done={gate.exiting}
        onSettled={gate.onExited}
        revealDelayMs={cfg.delayMs}
        style={overlay ? StyleSheet.absoluteFill : undefined}
        testID={`${testID}-screen`}
      />
    ) : (
      <InlineLoader
        size={size ?? MARK_W[scope]}
        scope={scope}
        caption={wordsScope ? shownCaption : undefined}
        done={gate.exiting}
        onSettled={gate.onExited}
        captionColor={colors.textSecondary}
        overlay={overlay}
      />
    );
  }

  return (
    <View
      testID={testID}
      style={[scope === 'screen' ? styles.fill : null, style]}
      accessibilityRole={ready ? undefined : 'progressbar'}
      accessibilityLabel={ready ? undefined : label ?? caption ?? 'Loading'}
      accessibilityState={{ busy: !ready }}
    >
      {overlay && (
        <Arrive armed={gate.wasShown} after={cfg.exit} style={scope === 'screen' ? styles.fill : undefined} testID={`${testID}-content`}>
          {renderChildren(children)}
        </Arrive>
      )}
      {loader}
    </View>
  );
}

/** The level + optional caption for the non-screen scopes. It owns its caption
 *  reveal, so a loader that comes back (a restart after the content mounted)
 *  runs the reveal again from its own mount. */
function InlineLoader({ size, scope, caption, done, onSettled, captionColor, overlay }: {
  size: number; scope: GateScope; caption?: string; done: boolean; onSettled: () => void; captionColor: string; overlay: boolean;
}) {
  const cfg = GATE[scope];
  const words = useLevelReveal(cfg.delayMs, done, cfg.exit);
  return (
    <View style={overlay ? [StyleSheet.absoluteFill, styles.center] : styles.center} pointerEvents="none">
      <LevelMark size={size} revealDelayMs={cfg.delayMs} done={done} exit={cfg.exit} onSettled={onSettled} />
      {!!caption && (
        <Animated.View style={{ opacity: words }}>
          <Text style={[Type.footnoteEmphasized, styles.caption, { color: captionColor }]} numberOfLines={2}>
            {caption}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  caption: { marginTop: 12, letterSpacing: 0.26, textAlign: 'center', maxWidth: 320 },
});
