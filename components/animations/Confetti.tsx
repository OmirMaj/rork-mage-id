// Confetti burst — fires on milestone events (contract signed, CO
// approved, project marked complete, etc.). Pure RN — no third-party
// dependency, no canvas — just N animated views falling from the top
// of the screen with random rotation + drift. Auto-dismisses when
// every particle hits the bottom.
//
// Usage:
//   import { fireConfetti } from '@/components/animations/Confetti';
//   fireConfetti();                       // default burst
//   fireConfetti({ count: 60 });          // bigger burst
//
// The fire function mounts a one-shot React component into a portal
// view at the root of the app. If a global host hasn't been set up,
// fireConfetti() is a no-op (so calling it from anywhere is safe).

import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions, Platform } from 'react-native';

interface ConfettiParticleProps {
  startX: number;
  delay: number;
  color: string;
  rotation: number;
  drift: number;
}

const COLORS = ['#FF6A1A', '#FFC83D', '#1E8E4A', '#1E5BC6', '#E5484D', '#9B59B6', '#F4F1E9'];

function ConfettiParticle({ startX, delay, color, rotation, drift }: ConfettiParticleProps) {
  const fall = useRef(new Animated.Value(0)).current;
  const screen = Dimensions.get('window');
  const endY = screen.height + 40;

  useEffect(() => {
    Animated.timing(fall, {
      toValue: 1,
      duration: 2200 + Math.random() * 800,
      delay,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fall, delay]);

  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-30, endY] });
  const translateX = fall.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, drift, drift * 0.6] });
  const rotateZ = fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${rotation}deg`] });
  const opacity = fall.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

  // Half the confetti are little squares, half are thin rectangles —
  // gives the burst more visual texture than uniform shapes.
  const isStrip = startX % 3 === 0;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: startX,
          backgroundColor: color,
          width: isStrip ? 4 : 8,
          height: isStrip ? 12 : 8,
          transform: [{ translateY }, { translateX }, { rotateZ }],
          opacity,
        },
      ]}
    />
  );
}

interface BurstProps {
  count: number;
  onDone: () => void;
}

function ConfettiBurst({ count, onDone }: BurstProps) {
  const screen = Dimensions.get('window');
  const particles = useRef(
    Array.from({ length: count }, (_, i) => ({
      startX: Math.random() * screen.width,
      delay: Math.random() * 200,
      color: COLORS[i % COLORS.length],
      rotation: (Math.random() * 720 - 360),
      drift: (Math.random() * 80 - 40),
    })),
  ).current;

  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <View pointerEvents="none" style={styles.host}>
      {particles.map((p, i) => (
        <ConfettiParticle key={i} {...p} />
      ))}
    </View>
  );
}

// ─── Global "fire" mechanism ──────────────────────────────────────
// A single host that sits at the app root subscribes to a tiny event
// emitter. fireConfetti() pushes a new burst id. Multiple bursts can
// stack if called rapidly; each cleans up after ~3.5s.

let fireFn: ((count: number) => void) | null = null;

export function fireConfetti(opts?: { count?: number }): void {
  if (Platform.OS === 'web') return; // web has its own party tools
  if (typeof fireFn === 'function') {
    fireFn(opts?.count ?? 40);
  }
}

export function ConfettiHost() {
  const [bursts, setBursts] = useState<Array<{ id: number; count: number }>>([]);
  const counter = useRef(0);

  useEffect(() => {
    fireFn = (count: number) => {
      counter.current += 1;
      const id = counter.current;
      setBursts(prev => [...prev, { id, count }]);
    };
    return () => { fireFn = null; };
  }, []);

  return (
    <>
      {bursts.map(b => (
        <ConfettiBurst
          key={b.id}
          count={b.count}
          onDone={() => setBursts(prev => prev.filter(x => x.id !== b.id))}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
  },
  particle: {
    position: 'absolute',
    top: 0,
    borderRadius: 1,
  },
});
