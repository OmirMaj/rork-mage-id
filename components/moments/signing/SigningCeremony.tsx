// SigningCeremony — the signing letter: a card with two equal panels. The top
// panel says what is being signed; the bottom panel is the signature line.
// You sign above the line, slide along it, the line winds into the busy
// circle, and ONLY when the write comes back confirmed does the circle lift
// into the seal, stamp the page, and the line redraw as a printed line with the
// record under it. For the GC's sign-and-send the signature panel then folds up
// over the contract like a letter and the seal holds the fold.
//
// A PRIMITIVE. No screen adopts it in this run (adoption is a later task).
//
// LEGAL (binding; SIGNLINE spec, both judges):
//  - Stored strokes are the pad's raw `M x,y L x,y` strings (utils/moments/
//    signatureInk.ts); the pad draws them at the PDF's constant 1.6 width.
//  - A touch that starts on the head or in the line zone never starts a
//    stroke (noStartRects), and the pad is locked from commit to un-commit;
//    strokes are kept on failure.
//  - Nothing reads as signed before the write returns 'confirmed': the seal,
//    its arcs, the check, the stamp and the record render only from inside
//    playConfirmed, which the capsule calls for a confirmed result only.
//  - Legal writes are never queued: writeOptions.legal is forced true, and
//    offline is a disabled reason (offlineLegalReason()).
//  - The ring text and the record line come only from the stored record
//    (recordFrom). No "MAGE ID" on the seal. A proposal reads ACCEPTED.
//  - 'paper' is not a method here: a paper signature gets no ceremony.
//  - A consent box renders only with a stored version (ConsentRow).
//  - A homeowner's name is never prefilled.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { cardSurface } from '@/components/ui/Card';
import { Tokens } from '@/constants/designTokens';
import { nativeDriver } from '@/components/ui/motion';
import SignaturePad, { type SignaturePadHandle } from '@/components/SignaturePad';
import { useCommitCapsule, type ConfirmedContext, type CapsuleValues } from '@/components/moments/core/contract';
import { offlineReasonLine, type CommitResult, type CommitWriteOptions } from '@/utils/moments/commitResult';
import { MOMENT_EASE, MOMENT_SPRING, type SpringCfg } from '@/utils/moments/motionSpec';
import { momentColors } from '@/utils/moments/colors';
import { momentHaptic, announce } from '@/utils/moments/haptics';
import { PDF_SIGNATURE_STROKE_WIDTH, lineReadiness } from '@/utils/moments/signatureInk';
import { sealPlan } from '@/utils/moments/sealPlan';
import {
  SEAL_SEPARATOR,
  buildRecordLine,
  buildSealRingText,
  formatRecordDay,
  formatRecordTime,
  installMomentLanguage,
  waitingChipText,
  type RecordVerb,
} from '@/utils/moments/sealText';
import {
  CEREMONY_TIMING as CT,
  FOLD_TIMING as FT,
  LINE_GEOMETRY as G,
  SEAL_TIMING as ST,
  noStartRectFor,
  padHeightFor,
} from '@/utils/moments/signTimeline';
import { SignatureLine } from '@/components/moments/signing/SignatureLine';
import { SealStamp, useSealValues } from '@/components/moments/signing/SealStamp';
import { LetterFold, useLetterFold } from '@/components/moments/signing/LetterFold';
import { ConsentRow } from '@/components/moments/signing/ConsentRow';
import { CeremonyDocTop } from '@/components/moments/signing/CeremonyDocTop';
import { useT } from '@/contexts/LanguageContext';

// The moments' own words follow the app language (wave-next W2): binds the
// providers utils/moments/copy.ts and commitResult.ts read at call time.
installMomentLanguage();

type Confirmed = Extract<CommitResult, { status: 'confirmed' }>;

export interface SigningCeremonyProps {
  /** 'homeowner' never takes a prefilled name. */
  signer: 'gc' | 'homeowner' | 'authorizer';
  /** typed = the portal today (the name is set on the line, no pad). */
  mode: 'drawn' | 'typed';
  /** 'paper' is NOT in the union: a paper signature gets no ceremony (runtime 'paper' renders null). */
  method: 'drawn' | 'typed' | 'in_person' | 'portal';
  parties: 1 | 2;
  signedBefore: 0 | 1;
  sealVerb: 'SIGNED' | 'SIGNED ON SITE' | 'ACCEPTED';
  top: {
    title: string;
    subtitle?: string;
    rows: { label: string; value: string; mono?: boolean }[];
    link?: { label: string; onPress: () => void };
  };
  name: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; minLength: number };
  /** "Contractor" | "Homeowner" | "Owner's rep" */
  role: string;
  /** Omitted = no box (never an unstored box). */
  consent?: {
    version: string;
    text: string;
    linkLabel?: string;
    onOpenDisclosure?: () => void;
    checked: boolean;
    onChange: (v: boolean) => void;
  };
  paths: string[];
  onPathsChange: (paths: string[]) => void;
  offline?: boolean;
  copy: { label: string; srLabel: string; srConfirm: string; sealedAnnounce: string; sentAnnounce?: string };
  /** Must resolve confirmed only on the real stored record. */
  write: () => Promise<CommitResult>;
  /** legal is forced true. Outcome lines as whole sentences in writeOptions.copy (Step 0). */
  writeOptions: Omit<CommitWriteOptions, 'legal'>;
  recordFrom: (r: Confirmed) => { signedAtIso: string; timeSource: 'device' | 'server'; name: string };
  /**
   * GC sign-and-send only: the letter folds and its back face is the sent card.
   * `sent: false` = the signature stored but the email did not leave: the chip
   * and the default card copy say so (never "Sent"). Default true.
   */
  fold?: { to: string; email: string; sent?: boolean; title?: string; body?: string; rows?: { label: string; value: string }[] };
  /** Caller-supplied after a REAL hash exists; never a placeholder. */
  evidence?: string;
  onBinding?: () => void;
  onDone?: (r: CommitResult) => void;
  onResultAfterUnmount?: (r: CommitResult) => void;
  /** Step 0: a late answer after the timeout already resolved the ceremony. */
  onLateResult?: (r: CommitResult) => void;
  /** Step 0: the commit started (the pad, name and `above` just locked). */
  onCommitStart?: () => void;
  /** Step 0: refused or timed out (the pad, name and `above` unlock; strokes kept). */
  onUncommit?: (r: CommitResult) => void;
  /**
   * Step 0: a slot above the card (field ticket: the role chips and title
   * field). Locked and dimmed with the name and pad from commit start until an
   * un-commit, and for good once the record is stored.
   */
  above?: React.ReactNode;
  /**
   * Step 0: true for a confirmed answer that is NOT this signature (ceremony
   * graft 4, "Already signed on the portal. Nothing was changed."). It
   * renders the neutral resolve: no seal, no arcs, no check, no success
   * haptic, a plain record line with the result's title.
   */
  isNeutral?: (r: Confirmed) => boolean;
  testID?: string;
}

const EASE_OUT = Easing.bezier(MOMENT_EASE.out[0], MOMENT_EASE.out[1], MOMENT_EASE.out[2], MOMENT_EASE.out[3]);

function tw(v: Animated.Value, toValue: number, duration: number): void {
  Animated.timing(v, { toValue, duration, easing: EASE_OUT, useNativeDriver: nativeDriver }).start();
}

function sp(v: Animated.Value, toValue: number, cfg: SpringCfg): void {
  Animated.spring(v, {
    toValue,
    stiffness: cfg.stiffness,
    damping: cfg.damping,
    mass: cfg.mass,
    useNativeDriver: nativeDriver,
  }).start();
}

/** Run timed beats in order on ctx.wait (which rejects if the moment is aborted). */
async function beats(wait: (ms: number) => Promise<void>, events: [number, () => void][]): Promise<void> {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  let t = 0;
  for (const [at, fn] of sorted) {
    if (at > t) {
      await wait(at - t);
      t = at;
    }
    fn();
  }
}

export function recordVerbFor(sealVerb: SigningCeremonyProps['sealVerb'], method: SigningCeremonyProps['method']): RecordVerb {
  if (sealVerb === 'ACCEPTED') return 'Accepted';
  if (sealVerb === 'SIGNED ON SITE') return 'Signed on site';
  if (method === 'in_person') return 'Signed in person';
  return 'Signed';
}

interface SealState {
  ringText: string;
  /** The STORED name (recordFrom), printed once sealed; '' = record unreadable. */
  name: string;
  countText?: string;
  record: { lead: string; verb: string; rest: string };
  day: string;
  sentAt: string;
}

export function SigningCeremony(props: SigningCeremonyProps) {
  if ((props.method as string) === 'paper') {
    if (__DEV__) console.warn('[moments] SigningCeremony refuses a paper signature: paper gets no ceremony.');
    return null;
  }
  return <CeremonyBody {...props} />;
}

function CeremonyBody(props: SigningCeremonyProps) {
  const { t } = useT();
  const { signer, mode, parties, signedBefore, name, role, consent, copy, fold, testID } = props;
  const { colors, resolved } = useTheme();
  const mc = useMemo(() => momentColors(colors, resolved), [colors, resolved]);
  const st = useThemedStyles(makeStyles);
  const plan = useMemo(() => sealPlan({ parties, signedBefore }), [parties, signedBefore]);

  // ── the homeowner's name is never prefilled ─────────────────────────────
  const [nameTouched, setNameTouched] = useState(signer === 'gc');
  const [nameFocused, setNameFocused] = useState(false);
  const shownName = nameTouched ? name.value : '';
  const clearedPrefill = useRef(false);
  useEffect(() => {
    if (clearedPrefill.current) return;
    clearedPrefill.current = true;
    if (signer !== 'gc' && name.value) name.onChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onNameChange = useCallback(
    (v: string) => {
      setNameTouched(true);
      name.onChange(v);
    },
    [name],
  );

  // ── layout ─────────────────────────────────────────────────────────────
  const [W, setW] = useState(0);
  const WRef = useRef(0);
  WRef.current = W;
  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setW((old) => (old === w ? old : w));
  }, []);
  const padH = W > 0 ? padHeightFor(W) : 0;
  const coordH = W > 0 ? (padH * G.coordW) / W : G.coordH;
  const noStart = useMemo(() => (W > 0 ? [noStartRectFor(W, padH)] : []), [W, padH]);

  // ── state ──────────────────────────────────────────────────────────────
  const [locked, setLocked] = useState(false);
  const [seal, setSeal] = useState<SealState | null>(null);
  // Step 0: a confirmed answer the caller marked neutral (isNeutral): a plain line, never a seal.
  const [neutral, setNeutral] = useState<string | null>(null);
  const [chip, setChip] = useState(() => t('common.moment.chipAwaiting', 'Awaiting your signature'));
  const padRef = useRef<SignaturePadHandle>(null);
  const hasInk = props.paths.length > 0;

  const warm = useRef(new Animated.Value(0)).current;
  const phO = useRef(new Animated.Value(hasInk ? 0 : 1)).current;
  const fieldsO = useRef(new Animated.Value(1)).current;
  const chipO = useRef(new Animated.Value(1)).current;
  const lr = useRef(new Animated.Value(0)).current;
  const rec = useRef(new Animated.Value(0)).current;
  const evO = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(0)).current;
  const sv = useSealValues();
  const letter = useLetterFold();

  const inkFirst = useRef(true);
  useEffect(() => {
    if (inkFirst.current) {
      inkFirst.current = false;
      return;
    }
    tw(phO, hasInk ? 0 : 1, CT.placeholderFade);
  }, [hasInk, phO]);

  const readiness = lineReadiness({
    offline: !!props.offline,
    offlineReason: offlineReasonLine(props.writeOptions),
    mode,
    paths: props.paths,
    name: shownName,
    minName: name.minLength,
    consent: consent ? { version: consent.version, checked: consent.checked } : null,
  });

  const swapChip = useCallback(
    (text: string) => {
      chipO.setValue(0);
      setChip(text);
      tw(chipO, 1, ST.chipFade);
    },
    [chipO],
  );

  // The same frame the seal mounts, the capsule hides: one object continues.
  const handoff = useRef<{ resolve: () => void; values: CapsuleValues } | null>(null);
  useLayoutEffect(() => {
    if (!seal || !handoff.current) return;
    handoff.current.values.capsuleOpacity.setValue(0);
    handoff.current.resolve();
    handoff.current = null;
  }, [seal]);

  const propsRef = useRef(props);
  propsRef.current = props;

  // ── the seal: runs ONLY for a confirmed write (the capsule's success plan) ──
  const playConfirmed = async (ctx: ConfirmedContext): Promise<void | 'neutral'> => {
    const p = propsRef.current;
    const r = ctx.result;
    // Step 0 neutral resolve: the record exists but this signature is not it
    // ("Already signed on the portal"). No seal, no arcs, no check, no
    // success haptic: the circle fades and one plain line says what happened.
    let isNeutral = false;
    try { isNeutral = !!p.isNeutral?.(r); } catch { isNeutral = false; }
    if (isNeutral) {
      tw(ctx.values.busy, 0, ST.busyOut);
      tw(ctx.values.capsuleOpacity, 0, ST.busyOut);
      tw(chipO, 0, ST.chipFade);
      setNeutral(r.title);
      tw(rec, 1, ctx.reduced ? ST.rmRecord : ST.recordIn);
      announce(r.announce ?? r.title);
      await ctx.wait(ctx.reduced ? ST.rmRecord : ST.recordIn);
      // The capsule's own display takes the cap role, never 'success'.
      return 'neutral';
    }
    const Wc = WRef.current || ctx.geometry.W;
    let ringText: string;
    let record: SealState['record'];
    let day = '';
    let sentAt = '';
    // '' when the record is unreadable: the name row then keeps what was typed.
    let storedName = '';
    try {
      // Inside the try: a caller's recordFrom that throws on a malformed record
      // must still land the moment on the confirmed state (verb-only seal),
      // never leave the capsule spinning over a stored signature.
      const stored = p.recordFrom(r);
      if (typeof stored.name === 'string' && stored.name.trim()) storedName = stored.name.trim();
      ringText = buildSealRingText({ verb: p.sealVerb, method: p.method, signedAtIso: stored.signedAtIso });
      const line = buildRecordLine({
        verb: recordVerbFor(p.sealVerb, p.method),
        signedAtIso: stored.signedAtIso,
        timeSource: stored.timeSource,
        binding: plan.binding && p.method === 'portal',
      });
      record = { lead: line.lead, verb: line.verb, rest: line.rest };
      day = formatRecordDay(stored.signedAtIso);
      sentAt = formatRecordTime(stored.signedAtIso);
    } catch {
      // A record without a readable timestamp: the seal carries the verb only.
      ringText = p.sealVerb + SEAL_SEPARATOR;
      record = { lead: '', verb: recordVerbFor(p.sealVerb, p.method), rest: '' };
    }

    // Hand-off: the seal appears exactly where the docked circle is.
    const g = ctx.geometry;
    const hx = g.inset + g.D / 2 + g.T;
    const hy = G.panel + G.zoneTop + g.H / 2;
    sv.x.setValue(hx);
    sv.y.setValue(hy);
    sv.s.setValue(1);
    sv.d.setValue(1);
    sv.tS.setValue(0);
    sv.busy.setValue(1);
    sv.ringO.setValue(0);
    sv.ringS.setValue(ST.ringFrom);
    sv.checkShort.setValue(0);
    sv.checkLong.setValue(0);
    sv.cnt.setValue(0);
    sv.sh.setValue(0);
    sv.arcTop.setValue(plan.arcsBefore.top ? 1 : 0);
    sv.arcBottom.setValue(plan.arcsBefore.bottom ? 1 : 0);
    sv.o.setValue(1);
    const mounted = new Promise<void>((resolve) => {
      handoff.current = { resolve, values: ctx.values };
    });
    setSeal({ ringText, name: storedName, countText: plan.countText, record, day, sentAt });
    await Promise.race([mounted, ctx.wait(50)]);
    ctx.values.capsuleOpacity.setValue(0);
    tw(ctx.values.busy, 0, ST.busyOut);

    const sealX = Wc - 20 - 44;
    const sealY = G.panel + G.lineY - 30;
    const chipAfter = plan.binding ? null : parties === 1 ? t('common.moment.locked', 'Locked') : waitingChipText(p.fold);
    const bind = () => {
      if (!plan.binding) return;
      p.onBinding?.();
      const binding = t('common.moment.binding', 'Binding');
      swapChip(binding);
      announce(binding);
    };
    const drawArcs = (dur: number) => {
      const arc = (val: Animated.Value) => {
        if (dur) tw(val, 1, dur);
        else val.setValue(1);
      };
      if (plan.arcsDraw.top) arc(sv.arcTop);
      if (plan.arcsDraw.bottom) arc(sv.arcBottom);
    };

    if (ctx.reduced) {
      tw(sv.busy, 0, ST.ringOut);
      tw(sv.tS, 1, ST.rmTone);
      if (plan.centre === 'check') {
        sv.checkShort.setValue(1);
        sv.checkLong.setValue(1);
      } else {
        sv.cnt.setValue(1);
      }
      await ctx.wait(ST.rmWait);
      tw(sv.o, 0, ST.rmOut);
      await ctx.wait(ST.rmOut);
      sv.x.setValue(sealX);
      sv.y.setValue(sealY);
      sv.d.setValue(ST.liftDisc);
      sv.ringO.setValue(1);
      sv.ringS.setValue(1);
      drawArcs(0);
      tw(sv.o, 1, ST.rmIn);
      await ctx.wait(ST.rmIn);
      momentHaptic('success');
      announce(p.copy.sealedAnnounce);
      if (chipAfter) swapChip(chipAfter);
      tw(lr, 1, ST.rmLine);
      tw(rec, 1, ST.rmRecord);
      bind();
      await ctx.wait(ST.rmRecord);
      if (p.evidence) tw(evO, 1, ST.rmRecord);
    } else {
      const events: [number, () => void][] = [
        [0, () => { tw(sv.busy, 0, ST.ringOut); tw(sv.tS, 1, ST.toneIn); }],
        [ST.liftAt, () => {
          sp(sv.x, sealX, MOMENT_SPRING.sealX);
          sp(sv.y, sealY, MOMENT_SPRING.sealY);
          sp(sv.s, ST.liftScale, MOMENT_SPRING.headScale);
          sp(sv.d, ST.liftDisc, MOMENT_SPRING.headScale);
          tw(sv.sh, ST.shadowLift, ST.shadowLiftMs);
        }],
        [ST.ringAt, () => { tw(sv.ringO, 1, ST.ringIn); sp(sv.ringS, 1, MOMENT_SPRING.headScale); drawArcs(ST.arcDraw); }],
        [ST.pressAt, () => { tw(sv.s, ST.pressScale, ST.press); tw(sv.sh, ST.shadowPress, ST.press); }],
        [ST.contactAt, () => {
          momentHaptic('success');
          announce(p.copy.sealedAnnounce);
          sp(sv.s, 1, MOMENT_SPRING.press);
          cardY.setValue(ST.cardDip);
          sp(cardY, 0, MOMENT_SPRING.press);
          if (chipAfter) swapChip(chipAfter);
        }],
        [ST.lineAt, () => tw(lr, 1, ST.lineDraw)],
        [ST.recordAt, () => tw(rec, 1, ST.recordIn)],
        [ST.recordAt + ST.recordIn, () => { if (p.evidence) tw(evO, 1, 300); }],
      ];
      if (plan.centre === 'count') {
        events.push([ST.countAt, () => tw(sv.cnt, 1, ST.countIn)]);
      } else if (plan.checkAt === ST.closeCheckShortAt) {
        events.push([ST.closeCheckShortAt, () => tw(sv.checkShort, 1, ST.checkShort)]);
        events.push([ST.closeCheckLongAt, () => tw(sv.checkLong, 1, ST.checkLong)]);
        events.push([ST.bindingAt, bind]);
      } else {
        events.push([ST.checkShortAt, () => tw(sv.checkShort, 1, ST.checkShort)]);
        events.push([ST.checkLongAt, () => tw(sv.checkLong, 1, ST.checkLong)]);
      }
      await beats(ctx.wait, events);
    }

    // GC sign-and-send: the letter folds at contact + 1500.
    if (p.fold) {
      const since = ctx.reduced ? ST.rmRecord : ST.recordAt + ST.recordIn - ST.contactAt;
      await ctx.wait(Math.max(0, FT.afterContact - since));
      await letter.play({
        wait: ctx.wait,
        onFieldsHide: () => tw(fieldsO, 0, ST.chipFade),
        sealToHinge: (animated) => {
          const hingeX = (WRef.current || Wc) - 64;
          if (animated) {
            sp(sv.x, hingeX, MOMENT_SPRING.sealX);
            sp(sv.y, G.panel, MOMENT_SPRING.sealY);
            sp(sv.s, FT.sealScale, MOMENT_SPRING.headScale);
            tw(sv.sh, FT.sealShadow, FT.sealShadowMs);
          } else {
            sv.x.setValue(hingeX);
            sv.y.setValue(G.panel);
            sv.s.setValue(FT.sealScale);
          }
        },
        sealFade: (to, ms) => tw(sv.o, to, ms),
        say: p.copy.sentAnnounce,
      });
    }
  };

  const capsule = useCommitCapsule({
    skin: 'line',
    tone: 'brand',
    threshold: 0.85,
    hideWhenDisabled: true,
    copy: { label: copy.label, busyLabel: t('common.moment.signing', 'Signing…'), srLabel: copy.srLabel, srConfirm: copy.srConfirm },
    disabledReason: readiness,
    write: props.write,
    writeOptions: { ...props.writeOptions, legal: true },
    onCommitStart: () => {
      setLocked(true);
      tw(fieldsO, CT.fieldsDim, 200);
      try { propsRef.current.onCommitStart?.(); } catch { /* the commit goes on */ }
    },
    onUncommit: (r) => {
      // Refused or timed out: the strokes are KEPT; the pad unlocks.
      setLocked(false);
      tw(fieldsO, 1, 200);
      try { propsRef.current.onUncommit?.(r); } catch { /* the pad must still unlock */ }
    },
    playConfirmed,
    onDone: props.onDone,
    onResultAfterUnmount: props.onResultAfterUnmount,
    onLateResult: props.onLateResult,
    testID,
  });

  const onFirstPenDown = useCallback(() => {
    tw(warm, 1, CT.grooveWarm);
    momentHaptic('selection');
  }, [warm]);
  const onClear = useCallback(() => {
    padRef.current?.clear();
    tw(warm, 0, CT.grooveWarm);
  }, [warm]);

  const sealed = seal != null;
  // Stored, one way or the other: the seal played, or the neutral line did.
  const done = sealed || neutral != null;
  const showClear = mode === 'drawn' && hasInk && !locked && !done;
  // Once sealed, the printed name is the STORED one, never the live field.
  const rowName = (seal && seal.name) || shownName.trim();
  const nameRowLeft = rowName ? `${rowName} · ${role}` : role;
  const today = useMemo(() => formatRecordDay(new Date().toISOString()), []);
  const shade = resolved === 'light' ? colors.text : colors.bg;

  const bottomFace = (
    <View style={StyleSheet.absoluteFill}>
      <View style={[st.dash, { borderColor: colors.line }]} pointerEvents="none" />
      <SignatureLine
        capsule={capsule}
        layer="under"
        colors={mc}
        resolved={resolved}
        label={copy.label}
        srConfirm={copy.srConfirm}
        readiness={readiness}
        warm={warm}
        testID={testID}
      />
      {mode === 'drawn' ? (
        <Animated.Text style={[st.placeholder, { opacity: phO }]}>
          {t('common.moment.signHere', 'Sign here')}
        </Animated.Text>
      ) : null}
      {mode === 'drawn' && W > 0 ? (
        <View style={[st.pad, { width: W, height: padH }]}>
          <SignaturePad
            ref={padRef}
            initialPaths={props.paths}
            onChange={props.onPathsChange}
            onFirstPenDown={onFirstPenDown}
            locked={locked || done}
            noStartRects={noStart}
            width={W}
            height={padH}
            coordinateWidth={G.coordW}
            coordinateHeight={coordH}
            strokeWidth={PDF_SIGNATURE_STROKE_WIDTH}
            inkColor={mc.ink}
            chrome="none"
            showSave={false}
            testID={testID ? `${testID}-pad` : undefined}
          />
        </View>
      ) : null}
      {mode === 'typed' ? (
        <Text style={st.typed} numberOfLines={1}>
          {(seal && seal.name) || shownName}
        </Text>
      ) : null}
      <Animated.View
        style={[st.signedLine, { backgroundColor: mc.signedLine, transform: [{ scaleX: lr }] }]}
        pointerEvents="none"
      />
      <View style={st.nameRow} pointerEvents="none">
        <Text style={st.nameText} numberOfLines={1}>
          {nameRowLeft}
        </Text>
        <Text style={st.nameText} numberOfLines={1}>
          {seal?.day || today}
        </Text>
      </View>
      {neutral != null && !seal ? (
        <Animated.Text style={[st.record, { opacity: rec }]} numberOfLines={1} testID={testID ? `${testID}-neutral` : undefined}>
          {neutral}
        </Animated.Text>
      ) : null}
      {seal ? (
        <Animated.Text style={[st.record, { opacity: rec }]} numberOfLines={1} testID={testID ? `${testID}-record` : undefined}>
          {seal.record.lead}
          <Text style={st.recordVerb}>{seal.record.verb}</Text>
          {seal.record.rest ? ` ${seal.record.rest}` : ''}
        </Animated.Text>
      ) : null}
      <SignatureLine
        capsule={capsule}
        layer="over"
        colors={mc}
        resolved={resolved}
        label={copy.label}
        srConfirm={copy.srConfirm}
        readiness={readiness}
        testID={testID}
      />
      {showClear ? (
        <Pressable onPress={onClear} style={st.clear} accessibilityRole="button" hitSlop={8} testID={testID ? `${testID}-clear` : undefined}>
          <Text style={st.clearText}>{t('common.moment.clear', 'Clear')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // The sent card exists only once the signature is stored (it carries the stored time).
  const backFace = fold && seal ? (
    <View style={st.backInner}>
      <Text style={st.sentTitle} numberOfLines={2}>
        {fold.title ?? (fold.sent === false ? t('common.moment.signedEmailNotSent', 'Signed. Email not sent.') : t('common.moment.sentTo', 'Sent to {to}', { to: fold.to }))}
      </Text>
      <Text style={st.sentBody}>
        {fold.body ??
          (fold.sent === false
            ? t('common.moment.shareLinkInstead', 'Share the link instead.')
            : t('common.moment.counterSignNote', 'They counter-sign from their portal link. The contract is binding when they sign.'))}
      </Text>
      {(fold.rows ?? [
        { label: t('common.moment.rowTo', 'To'), value: fold.email },
        { label: fold.sent === false ? t('common.moment.rowSigned', 'Signed') : t('common.moment.rowSent', 'Sent'), value: seal.sentAt },
        { label: t('common.moment.rowTerms', 'Terms'), value: t('common.moment.locked', 'Locked') },
      ]).map((row) => (
        <View key={row.label} style={st.sentRow}>
          <Text style={st.sentLabel}>{row.label}</Text>
          <Text style={st.sentValue} numberOfLines={1}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  ) : undefined;

  const folded = letter.folded;

  return (
    <View testID={testID}>
      {props.above != null && !folded ? (
        <Animated.View
          style={[st.above, { opacity: fieldsO }]}
          pointerEvents={locked || done ? 'none' : 'auto'}
          testID={testID ? `${testID}-above` : undefined}
        >
          {props.above}
        </Animated.View>
      ) : null}
      <Animated.View
        style={[st.card, { height: folded ? G.panel : G.card, transform: [{ translateY: cardY }] }]}
        onLayout={onCardLayout}
        testID={testID ? `${testID}-card` : undefined}
      >
        <View style={st.topPanel}>
          <CeremonyDocTop
            docTitle={props.top.title}
            subtitle={props.top.subtitle}
            rows={props.top.rows}
            link={props.top.link}
            aside={
              <Animated.View style={[st.chip, { backgroundColor: colors.neutralSoft, opacity: chipO }]}>
                <Text style={st.chipText} numberOfLines={1} testID={testID ? `${testID}-chip` : undefined}>
                  {chip}
                </Text>
              </Animated.View>
            }
          />
        </View>
        <LetterFold
          control={letter}
          panel={G.panel}
          front={bottomFace}
          back={backFace}
          frontStyle={st.frontFace}
          backStyle={st.backFace}
          shadeColor={shade}
          testID={testID ? `${testID}-fold` : undefined}
        />
        {seal ? (
          <SealStamp
            values={sv}
            spin={capsule.values.spin}
            ringText={seal.ringText}
            countText={seal.countText}
            colors={mc}
            testID={testID ? `${testID}-seal` : undefined}
          />
        ) : null}
      </Animated.View>
      {!folded ? (
        <Animated.View style={[st.fields, { opacity: fieldsO }]} pointerEvents={locked || done ? 'none' : 'auto'}>
          <Text style={st.fieldLabel}>{name.label}</Text>
          {/* The card surface (a ViewStyle) and the text style stay in separate
              entries: merging cardSurface with a Type.* spread widens every
              StyleSheet key to the union under the react-native-web typings. */}
          <View style={st.inputBox} testID={testID ? `${testID}-name-box` : undefined}>
          <TextInput
            value={shownName}
            onChangeText={onNameChange}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            placeholder={name.placeholder}
            placeholderTextColor={colors.textMuted}
            editable={!locked && !done}
            autoCorrect={false}
            autoComplete="off"
            accessibilityLabel={name.label}
            style={st.input}
            testID={testID ? `${testID}-name` : undefined}
          />
          {nameFocused ? (
            // Focus changes colour only, never the box: an accent 1.5 ring laid
            // OVER the 1 pt card border (morph.html .field input:focus is an
            // inset box-shadow), so the text and the consent row never move.
            <View pointerEvents="none" style={[st.inputRing, { borderColor: colors.accent }]} testID={testID ? `${testID}-name-ring` : undefined} />
          ) : null}
          </View>
          {consent ? (
            <ConsentRow
              version={consent.version}
              text={consent.text}
              linkLabel={consent.linkLabel}
              onOpenDisclosure={consent.onOpenDisclosure}
              checked={consent.checked}
              onChange={consent.onChange}
              disabled={locked || done}
              testID={testID ? `${testID}-consent` : undefined}
            />
          ) : null}
        </Animated.View>
      ) : null}
      {props.evidence && sealed ? (
        <Animated.Text style={[st.evidence, { opacity: evO }]}>{props.evidence}</Animated.Text>
      ) : null}
    </View>
  );
}

const WEB_INPUT_NO_OUTLINE = { outlineStyle: 'none' } as unknown as TextStyle;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: { position: 'relative' },
    above: { marginBottom: 14 },
    topPanel: {
      ...cardSurface(t, { radius: 'xl', pad: 18 }),
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: G.panel,
      paddingBottom: 14,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    frontFace: {
      ...cardSurface(t, { radius: 'xl', pad: 'none' }),
      borderTopWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      overflow: 'hidden',
    },
    backFace: {
      ...cardSurface(t, { radius: 'xl', pad: 'none' }),
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      overflow: 'hidden',
    },
    backInner: { padding: 18 },
    dash: { position: 'absolute', left: 0, right: 0, top: 0, height: 1, borderWidth: 1, borderStyle: 'dashed' },
    pad: { position: 'absolute', left: 0, top: 0 },
    placeholder: {
      ...Type.bodyCompact,
      color: t.textMuted,
      position: 'absolute',
      left: 0,
      right: 0,
      top: G.placeholderTop,
      textAlign: 'center',
    },
    typed: {
      ...Type.title2,
      fontWeight: '500',
      color: t.text,
      position: 'absolute',
      left: G.typedLeft,
      right: G.typedRight,
      top: G.typedTop,
    },
    signedLine: {
      position: 'absolute',
      left: G.inset,
      right: G.inset,
      top: G.lineY,
      height: G.signedLineH,
      transformOrigin: 'right',
    },
    nameRow: {
      position: 'absolute',
      left: G.inset,
      right: G.inset,
      top: G.nameTop,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
    },
    nameText: { ...Type.caption1, color: t.textSecondary, flexShrink: 1 },
    record: {
      ...Type.caption1,
      color: t.textSecondary,
      position: 'absolute',
      left: G.inset,
      right: G.recordRight,
      top: G.recordTop,
    },
    recordVerb: { ...Type.caption1, color: t.text, fontWeight: '600' },
    clear: { position: 'absolute', top: G.clearTop, right: G.clearRight, zIndex: 7 },
    clearText: { ...Type.footnoteEmphasized, color: t.textSecondary },
    chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '55%' },
    chipText: { ...Type.caption1, fontWeight: '600', color: t.textSecondary },
    sentTitle: { ...Type.title3, fontWeight: '700', color: t.text, marginBottom: 4 },
    sentBody: { ...Type.footnote, color: t.textSecondary, marginBottom: 12 },
    sentRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      paddingVertical: 7,
      borderTopWidth: 1,
      borderTopColor: t.line,
    },
    sentLabel: { ...Type.caption1, color: t.textSecondary },
    sentValue: { ...Type.caption1, fontWeight: '600', color: t.text, flexShrink: 1 },
    fields: { marginTop: 14 },
    fieldLabel: { ...Type.caption1, fontWeight: '600', color: t.textSecondary, marginBottom: 6 },
    // The padding lives on the input (not the box) so the whole card is the tap target.
    inputBox: cardSurface(t, { radius: 'card', pad: 'none' }),
    // Focused (morph.html .field input:focus): an accent 1.5 ring over the
    // 1 pt border, absolutely placed so focusing never shifts the layout.
    inputRing: {
      position: 'absolute',
      top: -1,
      left: -1,
      right: -1,
      bottom: -1,
      borderWidth: 1.5,
      borderRadius: Tokens.radius.card,
      ...Tokens.continuousCorners,
    },
    // The ring above is the one focus mark: no browser outline on the <input>.
    input: { ...Type.subhead, color: t.text, padding: 12, ...(Platform.OS === 'web' ? WEB_INPUT_NO_OUTLINE : null) },
    evidence: { ...Type.monoCaption, color: t.textMuted, marginTop: 14 },
  });

export default SigningCeremony;
