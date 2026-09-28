// SlideToConfirm.tsx: the Commit Capsule's track skin (moments wave, lane CAPSULE).
//
// The founder asked for slide-to-complete to be "very nice and animation heavy
// like those videos we plan on doing". This is the approved "morph" design:
// ONE shape carries the commit and is never cut. It stretches under the thumb,
// docks into a circle at the far end, turns into the busy ring, draws the
// check on a CONFIRMED write and re-expands into the result pill. A refused
// write visibly un-commits and the reason line says what did not happen.
//
// The words always state the action and the amount ("Slide to approve ·
// +$4,200.00"); the motion only backs them up. Variants (morph.md 4.11):
//   money / sign / certify  lg, brand, check
//   clock out               md (64% wide, min 220), threshold 0.70, hold 600, no settle
//   lock                    lg, tone 'ink', resultIcon 'lock' ("Period locked · Sep 2026")
//   risk override           lg, tone 'warning', resultIcon 'flag' ("Awarded · override recorded")
// There is NO destructive variant: a void or a delete never gets a slide.
//
// Screen reader on: the track is ONE button; activate splits it in place into
// [ Confirm … ] [ Cancel ]. Web/desktop: the head is focusable, press and hold
// Space/Enter fills it over 700 ms, Esc cancels; the ref's playHoldToCommit()
// is the same fill for a sheet's Cmd+Enter (never an instant commit).

import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { momentColors, type CapsuleTone } from '@/utils/moments/colors';
import { offlineReasonLine, type CommitResult, type CommitWriteOptions } from '@/utils/moments/commitResult';
import { CAPSULE_GEOMETRY } from '@/utils/moments/motionSpec';
import { labelDriftTable, labelOpacityTable } from '@/utils/moments/capsuleMath';
import { MOMENT_COPY } from '@/utils/moments/copy';
import { useCommitCapsule, type CapsuleResultIcon } from '@/components/moments/core/useCommitCapsule';
import { CapsuleShape } from '@/components/moments/core/CapsuleShape';
import { Shimmer } from '@/components/moments/core/Shimmer';

export interface SlideToConfirmProps {
  label: string; busyLabel: string; srLabel: string; srConfirm: string; srHint?: string;
  /** the write; the component wraps it in runCommit */
  onCommit: () => Promise<CommitResult>;
  /**
   * idempotent (required: forces the author to decide), legal, and the
   * outcome sentences in writeOptions.copy (refused / timeout / legalQueued /
   * transport / offline). subject and verb are the English fallback only.
   */
  writeOptions: CommitWriteOptions;
  /** md = compact clock-out: 64% width (min 220), threshold .70 default, holdMs 600, settle false */
  size?: 'lg' | 'md';
  tone?: CapsuleTone; resultIcon?: CapsuleResultIcon; threshold?: number;
  disabledReason?: string | null;
  /** with writeOptions.legal -> disabledReason = writeOptions.copy.offline ?? offlineLegalReason() */
  offline?: boolean;
  /** default "Saved on this phone · sends when online" */
  queuedLabel?: string;
  onDone?: (r: CommitResult) => void; onResolved?: (r: CommitResult) => void;
  onResultAfterUnmount?: (r: CommitResult) => void;
  /** Step 0: a late answer after the timeout already resolved the slide (a late confirmed write refreshes the record). */
  onLateResult?: (r: CommitResult) => void;
  style?: StyleProp<ViewStyle>; testID?: string;
}

export interface SlideToConfirmHandle {
  /** The 700 ms fill, then the commit (a sheet's Cmd+Enter). */
  playHoldToCommit(): void;
  reset(): void;
}

const LABEL_OPACITY = labelOpacityTable();
const LABEL_DRIFT = labelDriftTable();

export const SlideToConfirm = forwardRef<SlideToConfirmHandle, SlideToConfirmProps>(function SlideToConfirm(props, ref) {
  const { colors: theme, resolved } = useTheme();
  const mc = useMemo(() => momentColors(theme, resolved), [theme, resolved]);
  const size = props.size ?? 'lg';
  const tone: CapsuleTone = props.tone ?? 'brand';
  const resultIcon: CapsuleResultIcon = props.resultIcon ?? 'check';
  const geo = CAPSULE_GEOMETRY[size];
  const H = geo.H;
  const D = geo.D;
  const legal = !!props.writeOptions.legal;
  // A legal record can never be queued, so offline disables it with the reason.
  const disabledReason = legal && props.offline ? offlineReasonLine(props.writeOptions) : (props.disabledReason ?? null);

  const onCommitRef = useRef(props.onCommit);
  onCommitRef.current = props.onCommit;
  const queuedRef = useRef(props.queuedLabel);
  queuedRef.current = props.queuedLabel;
  const write = useCallback(async (): Promise<CommitResult> => {
    const r = await onCommitRef.current();
    if (r && r.status === 'queued' && !r.title) return { ...r, title: queuedRef.current ?? MOMENT_COPY.queued };
    return r;
  }, []);

  const capsule = useCommitCapsule({
    skin: 'track',
    size,
    tone,
    threshold: props.threshold,
    copy: { label: props.label, busyLabel: props.busyLabel, srLabel: props.srLabel, srConfirm: props.srConfirm, srHint: props.srHint },
    disabledReason,
    write,
    writeOptions: props.writeOptions,
    resultIcon,
    onDone: props.onDone,
    onResolved: props.onResolved,
    onResultAfterUnmount: props.onResultAfterUnmount,
    onLateResult: props.onLateResult,
    testID: props.testID,
  });

  useImperativeHandle(ref, () => ({ playHoldToCommit: capsule.playHoldToCommit, reset: capsule.reset }),
    [capsule.playHoldToCommit, capsule.reset]);

  const v = capsule.values;
  const anim = useMemo(() => ({
    labelOpacity: Animated.multiply(v.label, v.progress.interpolate({ ...LABEL_OPACITY, extrapolate: 'clamp' })),
    labelDrift: v.progress.interpolate({ ...LABEL_DRIFT, extrapolate: 'clamp' }),
    lockRim: v.lockRim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45], extrapolate: 'clamp' }),
  }), [v]);

  const labelText = capsule.disabled ? (disabledReason ?? props.label) : props.label;
  const labelStyle = size === 'md' ? styles.labelMd : styles.labelLg;
  const labelBox = { paddingLeft: D + 14, paddingRight: 18 };
  const display = capsule.display;
  const resultInk = !display ? mc.capOn[tone]
    : display.role === 'success' ? mc.onSuccess
      : display.role === 'neutral' ? mc.onNeutral
        : mc.capOn[tone];
  const sr = capsule.screenReader;
  const railA11y: Record<string, unknown> = sr && !capsule.srOpen ? (capsule.headA11yProps as Record<string, unknown>) : { accessible: false };
  const showSrBar = capsule.srOpen || (sr && capsule.phase === 'sr');
  const reason = capsule.reason;
  const tid = props.testID;
  const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

  return (
    <View
      style={[styles.root, size === 'md' ? styles.compact : null, props.style]}
      testID={tid}
    >
      <View style={styles.railWrap} onLayout={capsule.onRailLayout} testID={tid ? `${tid}-track` : undefined}>
        <Pressable
          ref={sr ? capsule.headRef : undefined}
          onPress={sr && !capsule.srOpen ? capsule.openConfirm : undefined}
          disabled={!sr}
          accessibilityRole={sr ? 'button' : undefined}
          {...railA11y}
          style={[styles.rail, { height: H, borderRadius: H / 2, backgroundColor: mc.rail }]}
          testID={tid ? `${tid}-rail` : undefined}
        >
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: H / 2, borderColor: mc.rim }]} />
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.lockRim, { borderRadius: H / 2, borderColor: mc.lockRim, opacity: anim.lockRim }]}
          />
          <Animated.View
            pointerEvents="none"
            {...hidden}
            style={[StyleSheet.absoluteFill, styles.center, labelBox, { opacity: anim.labelOpacity, transform: [{ translateX: anim.labelDrift }] }]}
          >
            <Text numberOfLines={1} style={[labelStyle, { color: mc.label }]} testID={tid ? `${tid}-label` : undefined}>{labelText}</Text>
          </Animated.View>
          <Shimmer
            text={labelText}
            active={capsule.shimmer && !!capsule.geometry}
            width={capsule.geometry?.W ?? 0}
            color={mc.labelShimmer}
            textStyle={labelStyle}
            boxStyle={[styles.center, labelBox]}
          />
          <Animated.View pointerEvents="none" {...hidden} style={[styles.busyBox, { opacity: v.busy }]} testID={tid ? `${tid}-busy` : undefined}>
            <Text numberOfLines={1} style={[styles.busyText, { color: mc.busy }]}>{props.busyLabel}</Text>
          </Animated.View>
          <CapsuleShape capsule={capsule} colors={mc} tone={tone} size={size} part="body" resultIcon={resultIcon} />
          <Animated.View
            pointerEvents="none"
            {...hidden}
            style={[StyleSheet.absoluteFill, styles.resultBox, { paddingRight: D + 12, opacity: v.result, transform: [{ translateX: v.resultX }] }]}
          >
            {display ? (
              <>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.resultLine, { color: resultInk }]} testID={tid ? `${tid}-result` : undefined}>
                  {display.title}
                </Text>
                {display.detail ? (
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.resultDetail, { color: resultInk }]}>{display.detail}</Text>
                ) : null}
              </>
            ) : null}
          </Animated.View>
          <CapsuleShape capsule={capsule} colors={mc} tone={tone} size={size} part="head" resultIcon={resultIcon} testID={tid} />
          {showSrBar ? (
            <Animated.View style={[styles.srBar, { opacity: v.sr }]} pointerEvents={capsule.srOpen ? 'auto' : 'none'}>
              <Pressable
                ref={capsule.confirmRef}
                accessibilityRole="button"
                accessibilityLabel={props.srConfirm}
                onPress={capsule.confirm}
                style={[styles.srOk, { borderRadius: D / 2, backgroundColor: mc.capFill[tone] }]}
                testID={tid ? `${tid}-confirm` : undefined}
              >
                <Text numberOfLines={1} style={[styles.srText, { color: mc.capOn[tone] }]}>{props.srConfirm}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={capsule.cancel}
                style={[styles.srNo, { borderRadius: D / 2, borderColor: mc.rim }]}
                testID={tid ? `${tid}-cancel` : undefined}
              >
                <Text numberOfLines={1} style={[styles.srText, { color: mc.ink }]}>Cancel</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </Pressable>
      </View>
      <View style={styles.under}>
        {reason ? (
          <Animated.Text
            accessibilityLiveRegion="polite"
            style={[styles.underText, {
              color: reason.tone === 'warning' ? mc.reasonWarning : mc.reasonDanger,
              opacity: v.reason,
              transform: [{ translateY: v.reasonY }],
            }]}
            testID={tid ? `${tid}-reason` : undefined}
          >
            {reason.text}
          </Animated.Text>
        ) : null}
        {capsule.nextLine ? (
          <Animated.Text style={[styles.underText, { color: mc.label, opacity: v.next }]} testID={tid ? `${tid}-next` : undefined}>
            {capsule.nextLine}
          </Animated.Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  compact: { width: `${Math.round(CAPSULE_GEOMETRY.md.widthPct * 100)}%` as `${number}%`, minWidth: CAPSULE_GEOMETRY.md.minWidth },
  railWrap: { position: 'relative' },
  rail: { overflow: 'hidden', justifyContent: 'center' },
  rim: { borderWidth: 1 },
  lockRim: { borderWidth: 1.5 },
  center: { justifyContent: 'center', alignItems: 'center' },
  labelLg: { ...Type.callout, fontWeight: '600', letterSpacing: 0.15 },
  labelMd: { ...Type.subheadEmphasized, fontWeight: '600', letterSpacing: 0.15 },
  busyBox: { position: 'absolute', left: 20, top: 0, bottom: 0, justifyContent: 'center' },
  busyText: { ...Type.subheadEmphasized, fontWeight: '600' },
  resultBox: { paddingLeft: 22, justifyContent: 'center' },
  resultLine: { ...Type.callout, fontWeight: '600' },
  resultDetail: { ...Type.caption1, fontWeight: '400', opacity: 0.82 },
  srBar: { position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, flexDirection: 'row', gap: 6 },
  srOk: { flexBasis: '66%', flexGrow: 0, flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  srNo: { flex: 1, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  srText: { ...Type.subheadEmphasized, fontWeight: '600' },
  under: { marginTop: 8, minHeight: 18 },
  underText: { ...Type.footnote, fontWeight: '400' },
});

export default SlideToConfirm;
