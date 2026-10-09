// components/livingModel/FlatReplay.tsx — Job Replay drawn flat.
//
// The phone's replay in Phase 1, and what the web shows when the browser
// cannot start the 3D view. The same clock, the same two readings and the same
// stage colours as the 3D view, on the floor plan the Room Editor draws.
//
// components/schedule/mobile/LivingFloorPlan.tsx (the Living Plan) was looked
// at for reuse. It draws boxes on a plan SHEET image and needs a sheet, an
// image and Plan Zones, none of which a typed model has, so only its idea is
// shared here: a floor whose areas change colour along a scrubber.
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { modelBounds, roomAtPoint } from '@/utils/livingModel/modelCore';
import { mixHex } from '@/utils/livingModel/palette';
import { fitPlanView, toMetres } from '@/utils/livingModel/planView';
import type { RoomMoment } from '@/utils/livingModel/replayCore';
import type { JobModel } from '@/utils/livingModel/types';
import { ModelPlan } from './ModelPlan';
import { stageLine, usePalette } from './replayShared';
import { makeLivingModelStyles } from './styles';

export function FlatReplay({ model, level, moments, selectedId, onSelect }: {
  model: JobModel;
  level: number;
  moments: Map<string, RoomMoment>;
  selectedId: string | null;
  onSelect: (roomId: string | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const [boxW, setBoxW] = useState(0);
  const boxH = Math.max(240, Math.min(520, Math.round(boxW * 0.72)));
  const view = useMemo(() => fitPlanView(modelBounds(model, level), Math.max(1, boxW), boxH, 1), [model, level, boxW, boxH]);
  const onBox = useCallback((e: LayoutChangeEvent) => setBoxW(Math.round(e.nativeEvent.layout.width)), []);
  // A soft tint of the stage colour, so the room's name stays readable on it.
  const fillFor = useCallback((roomId: string) => mixHex(colors.surface, palette.stage[moments.get(roomId)?.stage ?? 'no_tasks'], 0.5), [colors, palette, moments]);
  const ghostFor = useCallback((roomId: string) => {
    const g = moments.get(roomId)?.ghostStage;
    return g ? palette.stage[g] : null;
  }, [palette, moments]);
  const subFor = useCallback((roomId: string) => stageLine(moments.get(roomId), copy), [moments, copy]);
  const onPress = useCallback((e: GestureResponderEvent) => {
    const hit = roomAtPoint(model, level, toMetres(view, { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }));
    onSelect(hit && hit.id !== selectedId ? hit.id : null);
  }, [model, level, view, onSelect, selectedId]);

  return (
    <View style={styles.planBox} onLayout={onBox} testID="lm-flat-replay">
      {boxW > 0 ? (
        <Pressable onPress={onPress} accessibilityRole="image" accessibilityLabel={copy.planA11yLabel} testID="lm-flat-plan">
          <ModelPlan model={model} level={level} view={view} fillFor={fillFor} ghostFor={ghostFor} subFor={subFor} selectedId={selectedId} />
        </Pressable>
      ) : null}
    </View>
  );
}
