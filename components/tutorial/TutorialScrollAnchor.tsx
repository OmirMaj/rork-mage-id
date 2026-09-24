// components/tutorial/TutorialScrollAnchor.tsx — lets the coach scroll a
// target into view on step entry.
//
// Wrap a ScrollView's CONTENT (not the ScrollView) and pass its ref:
//
//   <ScrollView ref={scrollRef}>
//     <TutorialScrollAnchor scrollRef={scrollRef}>{…content…}</TutorialScrollAnchor>
//   </ScrollView>
//
// Every <TutorialTarget> inside picks the anchor up from context. On step
// entry the host measures the target against the anchor's content View
// (native: measureLayout) and scrolls it to 35 % down the viewport; on web it
// calls the DOM's scrollIntoView instead. With no anchor the step falls back
// to a card that says 'Scroll down' / 'Scroll up'.
//
// Idle cost: one extra View (collapsable={false} so measureLayout has a real
// native node to measure against) and a context value.

import React, { createContext, useContext, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { MeasurableNode, ScrollAnchorEntry } from '@/utils/tutorial/store';

/** The one method the anchor needs from a ScrollView / FlatList ref. */
export interface ScrollableRef {
  scrollTo?: (opts: { x?: number; y?: number; animated?: boolean }) => void;
  scrollToOffset?: (opts: { offset: number; animated?: boolean }) => void;
}

const AnchorContext = createContext<ScrollAnchorEntry | null>(null);

export function useTutorialScrollAnchor(): ScrollAnchorEntry | null {
  return useContext(AnchorContext);
}

export function TutorialScrollAnchor({
  scrollRef,
  children,
  style,
}: {
  scrollRef: React.RefObject<ScrollableRef | null>;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const entry = useMemo<ScrollAnchorEntry>(() => {
    const e: ScrollAnchorEntry = {
      scrollTo: (y: number) => {
        const s = scrollRef.current;
        if (!s) return;
        if (typeof s.scrollTo === 'function') s.scrollTo({ y, animated: true });
        else if (typeof s.scrollToOffset === 'function') s.scrollToOffset({ offset: y, animated: true });
      },
      content: null,
    };
    return e;
  }, [scrollRef]);

  return (
    <AnchorContext.Provider value={entry}>
      <View
        ref={node => {
          // A View host instance carries measureInWindow / measureLayout on
          // native and on react-native-web alike.
          entry.content = node as MeasurableNode | null;
        }}
        collapsable={false}
        style={style}
      >
        {children}
      </View>
    </AnchorContext.Provider>
  );
}

export default TutorialScrollAnchor;
