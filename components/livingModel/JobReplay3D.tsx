// components/livingModel/JobReplay3D.tsx — the phone's side of the 3D view.
//
// Metro picks JobReplay3D.web.tsx for the web bundle and THIS file for iOS and
// Android. The web file is untouched by the phone's 3D view.
//
// THE PHONE DRAWS THE SAME 3D MODEL AS THE WEB when the installed build has the
// 3D engine (expo-gl, in the build after build 22). The scene is the web's own
// (components/livingModel/threeScene.ts), drawn through ./phone3d.
//
// THE JAVASCRIPT ALSO REACHES BUILDS THAT HAVE NO ENGINE, over the air. So this
// file imports no 3D code and no expo-gl at module scope. It asks
// ./phone3d/engine, which makes ONE optional lookup that cannot throw, and
// reads the library only when the engine is there and Job Replay is open.
//
// THREE THINGS CAN BE ON THE SCREEN, and every one of them is a replay:
//   the 3D view             the engine is in the build and it started
//   one line + the flat     the build has no engine: "3D needs the newest
//   replay                  version of the app."
//   one sentence + the      the engine is there and would not start, or a
//   flat replay             frame failed
// The flat replay is drawn HERE, not by the screen, so it is on the glass even
// if the screen never hears about it. The screen is told (onFlat) only so that
// it can leave out the line that says how to turn a 3D model.
// Nothing here may take the screen down: a throw while the 3D view is being
// drawn is caught by the boundary below and the flat replay is drawn instead.
// scripts/validate-phone-3d.ts pins all of this, each with a planted break.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { usePhone3DCopy } from '@/hooks/usePhone3DCopy';
import { FlatReplay } from './FlatReplay';
import type { JobReplay3DProps } from './jobReplay3DProps';
import { useLookPalette } from './replayShared';
import { makeLivingModelStyles } from './styles';
import { loadPhone3DEngine, phone3DEngineInBuild, type Phone3DEngine } from './phone3d/engine';
import { Phone3DView, type Phone3DDebug } from './phone3d/Phone3DView';

/**
 * The phone has a 3D view to try. Whether THIS build can draw it is asked when
 * the view mounts (phone3DEngineInBuild); a build that cannot draws the flat
 * replay from inside this component.
 */
export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;

type Mode = 'loading' | '3d' | 'no_engine' | 'failed';

/** Catches a throw while the 3D view is being drawn, so the screen stays up. */
class Phone3DBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError(): { broken: boolean } { return { broken: true }; }
  componentDidCatch(): void { this.props.onError(); }
  render(): React.ReactNode { return this.state.broken ? null : this.props.children; }
}

export function JobReplay3D(props: JobReplay3DProps & {
  debug?: Phone3DDebug;
  /** For tests, which cannot run a dynamic import: how the engine is read. The app never passes it. */
  loadEngine?: () => Promise<Phone3DEngine | null>;
}) {
  const { model, level, moments, selectedId, onSelect, height, onFlat, quality = 'standard', look, loadEngine = loadPhone3DEngine } = props;
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const phoneCopy = usePhone3DCopy();
  // The palette carries the look as well as the theme (replayShared.useLookPalette), so a new look is a new palette too.
  const palette = useLookPalette(look, 'phone', quality);
  const [mode, setMode] = useState<Mode>(() => (phone3DEngineInBuild() ? 'loading' : 'no_engine'));
  const [engine, setEngine] = useState<Phone3DEngine | null>(null);

  useEffect(() => {
    if (mode !== 'loading') return;
    let alive = true;
    void loadEngine().then((e) => {
      if (!alive) return;
      if (e) { setEngine(e); setMode('3d'); } else setMode('failed');
    });
    return () => { alive = false; };
  }, [mode, loadEngine]);

  // The screen hears which of the two is on the glass before the frame is shown, so its 3D-only line never flashes over a flat picture.
  const flat = mode === 'no_engine' || mode === 'failed';
  const onFlatRef = useRef(onFlat);
  onFlatRef.current = onFlat;
  useLayoutEffect(() => { onFlatRef.current?.(flat); }, [flat]);

  // A new theme, or a new look, is a new palette: the scene is built again on a new drawing surface, and the old one's shapes and materials are let go as its view leaves.
  const paletteKey = useRef({ palette, n: 0 });
  if (paletteKey.current.palette !== palette) paletteKey.current = { palette, n: paletteKey.current.n + 1 };

  if (mode === '3d' && engine) {
    // onUnavailable is the web's. The phone never calls it: the flat replay is drawn from here, with the phone's own line.
    const { onUnavailable, onFlat: _onFlat, quality: _quality, debug, loadEngine: _loader, ...rest } = props;
    void onUnavailable;
    void _onFlat;
    void _quality;
    void _loader;
    // A new quality is a new drawing surface too: its size and its smoothing are fixed when it is made.
    return (
      <Phone3DBoundary onError={() => setMode('failed')}>
        <Phone3DView key={`${paletteKey.current.n}-${quality}`} {...rest} quality={quality} engine={engine} debug={debug} onFailed={() => setMode('failed')} />
      </Phone3DBoundary>
    );
  }
  if (mode === 'loading') {
    return (
      <View style={[styles.stage3d, { height }]} testID="lm-replay-3d-loading">
        <Text style={[styles.note, { position: 'absolute', left: 12, bottom: 12 }]}>{copy.loading3dBody}</Text>
      </View>
    );
  }
  return (
    <View style={styles.stack} testID={mode === 'no_engine' ? 'lm-phone-no-engine' : 'lm-phone-3d-failed'}>
      <View style={styles.panel}>
        <Text style={styles.para} testID="lm-phone-3d-note">{mode === 'no_engine' ? phoneCopy.needsNewVersionBody : phoneCopy.couldNotStartBody}</Text>
      </View>
      <FlatReplay model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} />
    </View>
  );
}
