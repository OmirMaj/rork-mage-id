// components/codeCard/CodeCardSheet.tsx — one code card, opened.
//
//   verdict + stage (the AI's guess; tap to change it) + Sunlight + close
//   the requirement, in our words
//   Why it applies here: the tape, − / + re-measure (re-runs the verdict, the
//     tape and the text to the sub), the equation, "close to the line"
//   What to build (our words)
//   The code behind it: section + Copy + the evidence words; the VERIFIED
//     edition with its source (an edition the card cites that is not that one
//     goes on its own line with no source: model recall, unless it is another
//     volume MAGE holds as adopted here); permit
//   Read the official text (FREE): 1 copies, 2 opens, 3 paste
//   Add to checklist (once pinned: a tap takes it off again) · Draft a
//     question for the town · Save to job
//   Send to a sub: chips from his Subs, the text preview, "Text it to …"
//   Confirm with your building department. MAGE ID is not affiliated with ICC.
//
// MAGE SENDS NOTHING. "Text it to …" hands the text to the caller, which opens
// the user's own Messages; the town question opens his own Mail.

import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Bookmark, BookOpen, Check, ChevronDown, ChevronRight, ClipboardCheck, Copy, ExternalLink,
  MessageCircleQuestion, Minus, Plus, TriangleAlert, X,
} from 'lucide-react-native';
import { Button, Sheet } from '@/components/ui';
import { DISPLAY_FONT, Type } from '@/constants/typography';
import type { CodeCardItem, CodeJobValue, CodeJurisdictionInfo, CodeStage } from '@/utils/codeCard/types';
import {
  CODE_STAGES,
  canRecheck,
  effectiveVerdict,
  formatNumberPart,
  recheck,
  recheckEquation,
  stageInspectionLabel,
  stageLabel,
  stepJobValue,
  unitLabel,
} from '@/utils/codeCard/verdict';
import { editionViewFor, sourceLine } from '@/utils/codeCard/jurisdiction';
import {
  defaultOfficialTextDeps,
  officialTextPlan,
  officialTextSteps,
  officialTextToast,
  runOfficialText,
  type OfficialTextDeps,
} from '@/utils/codeCard/officialText';
import { shareBlockedReason, shareTextFor, type SubRecipient } from '@/utils/codeCard/shareText';
import { setSunlight } from '@/utils/codeCard/sunlight';
import { useCodeCardPalette, useSunlight, type CodeCardPalette } from './palette';
import { SampleTag, VerdictTag } from './VerdictTag';
import { EvidenceMeter } from './EvidenceMeter';
import { ThresholdTape } from './ThresholdTape';
import { CLOSE_TO_LINE_NOTE, EDITION_NOT_CONFIRMED, NO_SECTION_GIVEN } from './CodeCard';
import { BlockedNote, ConfirmBlock, NOT_AFFILIATED, SunlightToggle, storeGated, type CodeCardAction } from './parts';
import { OFFICE_UNVERIFIED } from './JurisdictionBlock';

export interface CodeCardSheetProps {
  visible: boolean;
  onClose: () => void;
  item: CodeCardItem | null;
  info?: CodeJurisdictionInfo | null;
  sample?: boolean;
  /**
   * Pins Sunlight on or off for this sheet (tests, previews); the sheet's toggle
   * then flips it for this sheet only. Omitted, the sheet follows the STORED
   * preference and its toggle changes that preference, like the list's.
   */
  sunlight?: boolean;
  /**
   * The number the card opens on, when it is not the item's own: a re-measure
   * he saved (`saved.jobValue`) or made earlier this session. Read ONCE when the
   * card opens; − / + step from it. Omitted, the item's `jobValue` is used.
   */
  jobValue?: CodeJobValue;
  /** "Reyes deck, Massapequa", for the text to the sub. */
  jobLabel?: string | null;
  /** The permit office's phone, shown in the code-behind table when known. */
  permitPhone?: string | null;
  /** The contractor moved the inspection off the AI's guess. */
  onStageChange?: (item: CodeCardItem, stage: CodeStage) => void;
  /**
   * The number on the card changed. Called on EVERY − / + tap with exactly the
   * number now shown, the step back to the starting number included, so a
   * caller that keeps it for Save never holds a number that is not on screen.
   */
  onJobValueChange?: (item: CodeCardItem, jobValue: CodeJobValue) => void;
  checklist?: CodeCardAction;
  askTown?: CodeCardAction;
  save?: CodeCardAction;
  /** Subs to text, trade matches first (subRecipientsFor). */
  recipients?: SubRecipient[];
  /** The + chip: pick another sub from Subs. */
  onPickRecipient?: () => void;
  /** Open HIS Messages with this text. Required for the send button to be live. */
  onSendToSub?: (recipient: SubRecipient, text: string) => void;
  officialTextDeps?: OfficialTextDeps;
  testID?: string;
}

export const NO_SUBS_REASON = 'Add a sub with a phone number in Subs, then you can text this from here.';
export const NO_SEND_REASON = 'Texting is not set up on this screen yet.';
export const TRIGGER_RECALL_LINE = 'The trigger number is model recall. Confirm it in the official text.';

export function CodeCardSheet(props: CodeCardSheetProps) {
  const { visible, onClose, item, testID } = props;
  return (
    <Sheet visible={visible && !!item} onClose={onClose} size="form" testID={testID ?? 'code-card-sheet'}>
      {item ? <SheetBody key={item.id} {...props} item={item} /> : null}
    </Sheet>
  );
}

function SheetBody({
  item, info, sample, sunlight: sunlightProp, jobValue: jobValueProp, jobLabel, permitPhone, onClose, onStageChange, onJobValueChange,
  checklist, askTown, save, recipients, onPickRecipient, onSendToSub, officialTextDeps, testID,
}: CodeCardSheetProps & { item: CodeCardItem }) {
  // ONE value drives the palette AND the toggle, so the switch can never read
  // "off" over a sunlit sheet. Pinned by the prop: a local flip for this sheet.
  // Not pinned: the stored preference, and the toggle writes it.
  const storedSun = useSunlight();
  const sunPinned = sunlightProp !== undefined;
  const [localSun, setLocalSun] = useState<boolean | undefined>(undefined);
  const sunlight: boolean = sunPinned ? (localSun ?? !!sunlightProp) : storedSun;
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const tid = `${testID ?? 'code-card-sheet'}-${item.id}`;

  const [taps, setTaps] = useState(0);
  const tapsRef = useRef(0);
  const [stage, setStage] = useState<CodeStage | undefined>(item.stage);
  const [stageEdited, setStageEdited] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<string | null>(recipients?.[0]?.id ?? null);

  // The starting number is fixed when the card opens (this body is keyed by the
  // item), so a caller that echoes onJobValueChange back into `jobValue` cannot
  // make − / + step twice.
  const [baseJv] = useState<CodeJobValue | undefined>(() => jobValueProp ?? item.jobValue);
  const recheckable = !!baseJv && canRecheck({ jobValue: baseJv, trigger: item.trigger });
  const firstLabel = (item.jobValue?.source !== 'measured' ? item.jobValue?.sourceLabel ?? '' : '').trim();
  const jv: CodeJobValue | undefined = baseJv ? stepJobValue(baseJv, taps) : undefined;

  const verdict = effectiveVerdict(item, jv);
  const eq = recheckable && jv ? recheckEquation(item, jv) : null;
  const close = recheckable && jv && item.trigger ? recheck(jv, item.trigger).closeToLine : false;
  const plan = officialTextPlan(item, info);
  const steps = officialTextSteps(plan);
  const hasSection = !!plan.copyText;
  const edition = editionViewFor(item, info);
  const shown: CodeCardItem = { ...item, stage, stageIsGuess: stageEdited ? false : item.stageIsGuess };
  const recipient = recipients?.find((r) => r.id === pick) ?? null;
  const text = shareTextFor(shown, { jobLabel, jobValue: jv, info, sample });
  const deps = officialTextDeps ?? defaultOfficialTextDeps();

  // One tap = one number. The count lives in a ref so two taps in one frame
  // cannot read the same stale count, and the caller is told the SAME number
  // the card is about to show, every time (back at the start: the start).
  const stepBy = (d: number) => {
    if (!baseJv) return;
    if (Platform.OS === 'ios') Haptics.selectionAsync().catch(() => {});
    tapsRef.current += d;
    setTaps(tapsRef.current);
    onJobValueChange?.(item, stepJobValue(baseJv, tapsRef.current));
  };

  const run = (label: string, action: CodeCardAction | undefined) => {
    if (!action) { setNote(`${label}: not available here.`); return; }
    if (action.kind === 'ready') { setNote(null); action.onPress(); }
    else if (action.kind === 'blocked') setNote(`${label}: ${action.reason}`);
    // A done row with an undo (a pinned card's Checklist row): the tap takes it off.
    else if (action.kind === 'done' && action.onPress) { setNote(null); action.onPress(); }
  };

  const onOfficial = async () => {
    if (!plan.available) { setNote(plan.blockedReason); return; }
    const result = await runOfficialText(plan, deps);
    setNote(officialTextToast(plan, result));
  };

  const onCopy = async () => {
    let ok = false;
    try { ok = await deps.copy(item.section.trim()); } catch { ok = false; }
    setCopied(ok);
    setNote(ok ? `Copied ${item.section.trim()}.` : `Copy did not work. The section is ${item.section.trim()}.`);
  };

  const stageWord = stage ? stageLabel(stage) : null;
  const stageSuffix = !stage ? '' : stageEdited ? ' · you set it' : item.stageIsGuess ? ' · AI guess' : '';
  const checklistTitle = stageWord ? `Add to ${stageWord} inspection checklist` : 'Add to an inspection checklist';

  const actionRow = (key: string, title: string, sub: string, Icon: typeof Bookmark, action: CodeCardAction | undefined, ruled: boolean) => {
    const done = action?.kind === 'done';
    const blocked = !action || action.kind === 'blocked';
    const subText = done ? (action as { label: string }).label : action?.kind === 'blocked' ? action.reason : sub;
    return (
      <Pressable
        key={key}
        onPress={() => run(title, action)}
        style={({ pressed }) => [styles.ai, ruled && styles.ruled, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subText}`}
        accessibilityState={{ disabled: blocked, checked: done ? true : undefined }}
        testID={`${tid}-${key}`}
      >
        <View style={[styles.aiIcon, done && styles.aiIconDone]}>
          {done ? <Check size={18} color={P.successLabel} strokeWidth={2.2} /> : <Icon size={18} color={blocked ? P.ink3 : P.ink} strokeWidth={1.9} />}
        </View>
        <View style={styles.aiText}>
          <Text style={[styles.aiTitle, blocked && styles.dim]}>{title}</Text>
          <Text style={[styles.aiSub, done && styles.aiSubDone]}>{subText}</Text>
        </View>
        <ChevronRight size={16} color={P.ink3} strokeWidth={2} />
      </Pressable>
    );
  };

  // A stand-in line is not a requirement: nothing to text, and the preview
  // below never shows the notice dressed up as one.
  const noWords = shareBlockedReason(item);
  const sendBlocked = noWords ?? (!recipients || recipients.length === 0
    ? NO_SUBS_REASON
    : !onSendToSub
      ? NO_SEND_REASON
      : recipient && !recipient.phone
        ? `${recipient.name} has no phone number in Subs.`
        : !recipient
          ? 'Pick a sub first.'
          : null);

  return (
    <View style={[styles.wrap, P.sunlight && styles.wrapSun]} testID={tid}>
      <View style={styles.top}>
        <VerdictTag verdict={verdict} sunlight={sunlight} testID={`${tid}-verdict`} />
        <Pressable
          onPress={() => setStageOpen((o) => !o)}
          style={styles.stageBtn}
          accessibilityRole="button"
          accessibilityLabel={`${stageInspectionLabel(stage)}${stageSuffix}. Change the inspection.`}
          accessibilityState={{ expanded: stageOpen }}
          testID={`${tid}-stage`}
        >
          <Text style={styles.stageText} numberOfLines={1}>{`${stageInspectionLabel(stage)}${stageSuffix}`}</Text>
          <ChevronDown size={14} color={P.ink3} strokeWidth={2} />
        </Pressable>
        <View style={styles.spacer} />
        {sample ? <SampleTag sunlight={sunlight} /> : null}
        <SunlightToggle value={sunlight} onChange={sunPinned ? setLocalSun : setSunlight} testID={`${tid}-sun`} />
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" testID={`${tid}-close`}>
          <View style={styles.closeDisc}><X size={15} color={P.ink2} strokeWidth={2.4} /></View>
        </Pressable>
      </View>

      {stageOpen ? (
        <View style={styles.stagePick} accessibilityRole="radiogroup" accessibilityLabel="Which inspection checks this">
          <Text style={styles.stageHint}>Which inspection checks this is the AI&apos;s guess. Pick the one your town uses.</Text>
          <View style={styles.chips}>
            {CODE_STAGES.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  setStage(s);
                  setStageEdited(true);
                  setStageOpen(false);
                  onStageChange?.(item, s);
                }}
                style={[styles.chip, stage === s && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: stage === s }}
                testID={`${tid}-stage-${s}`}
              >
                <Text style={[styles.chipText, stage === s && styles.chipTextOn]}>{stageLabel(s)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={styles.verdictLine} accessibilityRole="header">{item.summary}</Text>

      {recheckable || item.why || item.calc ? (
        <View style={styles.blk}>
          <View style={styles.blkHead}>
            <Text style={styles.blkLabel}>Why it applies here</Text>
            <View style={styles.spacer} />
            {item.calc ? <Text style={styles.blkTag}>MAGE calculator</Text> : null}
          </View>
          {item.why ? <Text style={styles.why}>{item.why}</Text> : null}
          {item.calc ? (
            <Text style={styles.why}>
              {`${item.calc.expression} = `}
              <Text style={styles.strong}>{item.calc.value}</Text>
              {item.calc.note ? `. ${item.calc.note}` : ''}
            </Text>
          ) : null}
          {recheckable && jv ? (
            <View style={styles.measure}>
              <ThresholdTape jobValue={jv} trigger={item.trigger} verdict={item.verdict} showSource={false} sunlight={sunlight} testID={`${tid}-tape`} />
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => stepBy(-1)}
                  disabled={jv.value <= 0}
                  style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Lower, ${unitLabel(jv.unit) || 'one'} step`}
                  testID={`${tid}-dec`}
                >
                  <Minus size={26} color={P.ink} strokeWidth={2.4} />
                </Pressable>
                <View style={styles.val} accessibilityLiveRegion="polite">
                  <Text style={styles.valNum} testID={`${tid}-value`}>{formatNumberPart(jv.value, jv.unit)}</Text>
                  <Text style={styles.valUnit}>{unitLabel(jv.unit)}</Text>
                </View>
                <Pressable
                  onPress={() => stepBy(1)}
                  style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Higher, ${unitLabel(jv.unit) || 'one'} step`}
                  testID={`${tid}-inc`}
                >
                  <Plus size={26} color={P.ink} strokeWidth={2.4} />
                </Pressable>
              </View>
              <Text style={styles.mSrc}>
                {jv.source === 'measured'
                  ? `Measured on site.${firstLabel ? ` The first number came from ${firstLabel}.` : ''}${taps === 0 ? ' Tap − or + to re-check another number.' : ''}`
                  : `From ${jv.sourceLabel}. Measured something else on site? Tap − or + and the card re-checks.`}
              </Text>
              {eq ? (
                <Text style={styles.eq} testID={`${tid}-equation`}>
                  <Text style={styles.strong}>{eq.left}</Text>
                  <Text style={styles.op}>{`  ${eq.op}  `}</Text>
                  <Text style={styles.strong}>{eq.right}</Text>
                  <Text style={styles.op}>{'  →  '}</Text>
                  {eq.words}
                </Text>
              ) : null}
              {/* On EVERY rung: the number is the model's (see ThresholdTape). */}
              <Text style={styles.recallNote}>{TRIGGER_RECALL_LINE}</Text>
              {close ? (
                <View style={styles.near} accessibilityLiveRegion="polite" testID={`${tid}-near`}>
                  <TriangleAlert size={17} color={P.warnLabel} strokeWidth={2} />
                  <Text style={styles.nearText}>{CLOSE_TO_LINE_NOTE}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {item.whatToBuild && item.whatToBuild.length ? (
        <View style={styles.blk}>
          <View style={styles.blkHead}>
            <Text style={styles.blkLabel}>What to build</Text>
            <View style={styles.spacer} />
            <Text style={styles.blkTag}>In our words</Text>
          </View>
          {item.whatToBuild.map((line, i) => (
            <View key={`${i}-${line}`} style={[styles.spec, i > 0 && styles.ruled]}>
              <Check size={16} color={P.ink3} strokeWidth={2} />
              <Text style={styles.specText}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.blk}>
        <View style={styles.blkHead}><Text style={styles.blkLabel}>The code behind it</Text></View>
        <View style={styles.ref}>
          <View style={styles.rr}>
            <Text style={styles.rrKey}>Section</Text>
            <View style={styles.rrVal}>
              {hasSection ? (
                <View style={styles.secRow}>
                  <Text style={styles.secText}>{item.section}</Text>
                  <Pressable
                    onPress={() => { void onCopy(); }}
                    style={styles.copy}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${item.section}`}
                    testID={`${tid}-copy`}
                  >
                    {copied ? <Check size={14} color={P.successLabel} strokeWidth={2.2} /> : <Copy size={14} color={P.ink} strokeWidth={2} />}
                    <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.rrText}>{NO_SECTION_GIVEN}</Text>
              )}
              <EvidenceMeter evidence={item.evidence} variant="full" sunlight={sunlight} testID={`${tid}-evidence`} />
            </View>
          </View>
          <View style={[styles.rr, styles.ruled]}>
            <Text style={styles.rrKey}>Code</Text>
            <View style={styles.rrVal}>
              {/* A source line sits ONLY under the verified edition. What the card
                  cites, when it is not that edition, is on its own line below. */}
              {info?.editionLabel ? (
                <>
                  <Text style={styles.rrText}>{info.editionLabel}</Text>
                  <Text style={styles.rrSmall}>{sourceLine(info.editionSourceUrl, info.editionCheckedOn) ?? 'Source not on file'}</Text>
                  {edition.citedLine ? <Text style={styles.rrSmall} testID={`${tid}-cited`}>{edition.citedLine}</Text> : null}
                </>
              ) : (
                <>
                  <Text style={styles.rrText}>{edition.citedLine ?? EDITION_NOT_CONFIRMED}</Text>
                  <Text style={styles.rrSmall}>No verified adoption record for this address.</Text>
                </>
              )}
            </View>
          </View>
          <View style={[styles.rr, styles.ruled]}>
            <Text style={styles.rrKey}>Permit</Text>
            <View style={styles.rrVal}>
              <Text style={styles.rrText}>{info?.permitOfficeTitle ?? 'Not found for this address'}</Text>
              {info?.permitOfficeTitle ? (
                <Text style={styles.rrSmall}>
                  {[sourceLine(info.permitOfficeSourceUrl, info.permitOfficeCheckedOn) ?? OFFICE_UNVERIFIED, permitPhone].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => { void onOfficial(); }}
        style={({ pressed }) => [styles.official, !plan.available && styles.officialOff, pressed && styles.officialPressed]}
        accessibilityRole="button"
        accessibilityLabel={plan.available
          ? plan.copyText
            ? `Read the official text, free. Copies ${plan.copyText}, opens ${plan.viewerShort ?? 'the code'} in ICC's free viewer; paste it into its search.`
            : `Read the official text, free. Opens ${plan.viewerShort ?? 'the code'} in ICC's free viewer. This card has no section to copy.`
          : `Read the official text, not available. ${plan.blockedReason}`}
        accessibilityState={{ disabled: !plan.available }}
        testID={`${tid}-official`}
      >
        <View style={styles.ot}>
          <BookOpen size={22} color={P.ink} strokeWidth={1.9} />
          <Text style={styles.otText}>Read the official text</Text>
          <View style={styles.free}><Text style={styles.freeText}>Free</Text></View>
          <View style={styles.spacer} />
          <ExternalLink size={20} color={P.ink3} strokeWidth={1.9} />
        </View>
        {plan.available ? (
          <View style={styles.steps}>
            <View style={styles.step}><Text style={styles.stepKey}>1 · Copies</Text><Text style={styles.stepText}>{steps.copies}</Text></View>
            <View style={styles.step}><Text style={styles.stepKey}>2 · Opens</Text><Text style={styles.stepText}>{steps.opens}</Text></View>
            <View style={styles.step}><Text style={styles.stepKey}>3 · Paste</Text><Text style={styles.stepText}>{steps.paste}</Text></View>
          </View>
        ) : (
          <Text style={styles.stepText}>{plan.blockedReason}</Text>
        )}
      </Pressable>

      <View style={styles.alist}>
        {actionRow('checklist', checklistTitle, 'Shows in Inspection Ready 3 days before that inspection', ClipboardCheck, storeGated(checklist, shown), false)}
        {actionRow('ask', 'Draft a question for the town', 'Opens in your Mail. MAGE sends nothing.', MessageCircleQuestion, askTown, true)}
        {actionRow('save', 'Save to the job', 'Kept with the codes and permits', Bookmark, storeGated(save, shown), true)}
      </View>
      <BlockedNote text={note} sunlight={sunlight} testID={`${tid}-note`} />

      <Text style={styles.msgHead}>Send to a sub</Text>
      <View style={styles.chips}>
        {(recipients ?? []).map((r) => (
          <Pressable
            key={r.id}
            onPress={() => setPick(r.id)}
            style={[styles.chip, pick === r.id && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: pick === r.id }}
            accessibilityLabel={`${r.name}${r.trade ? `, ${r.trade}` : ''}`}
            testID={`${tid}-to-${r.id}`}
          >
            <Text style={[styles.chipText, pick === r.id && styles.chipTextOn]}>{r.name}</Text>
            {r.trade ? <Text style={[styles.chipSmall, pick === r.id && styles.chipTextOn]}>{r.trade}</Text> : null}
          </Pressable>
        ))}
        {onPickRecipient ? (
          <Pressable onPress={onPickRecipient} style={[styles.chip, styles.chipPlus]} accessibilityRole="button" accessibilityLabel="Pick from Subs" testID={`${tid}-to-more`}>
            <Plus size={18} color={P.ink} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {noWords ? null : (
        <View style={styles.msg}>
          <Text style={styles.msgText} testID={`${tid}-share-text`}>{text}</Text>
        </View>
      )}
      <Button
        label={recipient ? `Text it to ${recipient.name}` : 'Text it to a sub'}
        size="lg"
        fullWidth
        disabled={!!sendBlocked}
        onPress={() => { if (!sendBlocked && recipient && onSendToSub) onSendToSub(recipient, text); }}
        style={styles.sendBtn}
        testID={`${tid}-send`}
      />
      <BlockedNote text={sendBlocked} sunlight={sunlight} testID={`${tid}-send-blocked`} />

      <ConfirmBlock sunlight={sunlight} line={`${NOT_AFFILIATED} The code’s own wording is never shown here.`} testID={`${tid}-confirm`} />
    </View>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    wrap: { paddingBottom: 8 },
    wrapSun: { backgroundColor: P.surface, borderRadius: 16, padding: 12 },
    spacer: { flex: 1 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    stageBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 44, flexShrink: 1 },
    stageText: { flexShrink: 1, fontSize: 13 + P.bump / 2, fontWeight: '500', color: P.ink3 },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    closeDisc: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft },
    stagePick: { marginBottom: 10, gap: 8 },
    stageHint: { fontSize: 13 + P.bump / 2, lineHeight: 18 + P.bump / 2, color: P.ink2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, paddingHorizontal: 13, borderRadius: 12, borderWidth: P.rule, borderColor: P.line, flexDirection: 'row', alignItems: 'center', gap: 7 },
    chipOn: { backgroundColor: P.ink, borderColor: P.ink },
    chipPlus: { width: 44, paddingHorizontal: 0, justifyContent: 'center' },
    chipText: { fontSize: 14 + P.bump / 2, fontWeight: '600', color: P.ink },
    chipSmall: { fontSize: 12 + P.bump / 2, fontWeight: '600', color: P.ink2 },
    chipTextOn: { color: P.bg },
    verdictLine: { fontFamily: DISPLAY_FONT.semibold, fontSize: 26 + P.bump, lineHeight: 30 + P.bump, color: P.ink },
    blk: { marginTop: 18 },
    blkHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    blkLabel: { fontSize: 11.5 + P.bump / 2, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', color: P.ink3 },
    blkTag: { fontSize: 12 + P.bump / 2, fontWeight: '600', color: P.ink2 },
    why: { fontSize: 15 + P.bump, lineHeight: 21 + P.bump, color: P.ink2, marginBottom: 8 },
    strong: { fontWeight: '700', color: P.ink },
    measure: { borderRadius: 16, backgroundColor: P.bg, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14, borderWidth: P.sunlight ? 2 : 0, borderColor: P.line },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    stepBtn: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: P.surface, borderWidth: P.rule, borderColor: P.line },
    stepPressed: { backgroundColor: P.soft },
    val: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
    valNum: { ...Type.serifLargeTitle, color: P.ink, fontVariant: ['tabular-nums'] },
    valUnit: { fontFamily: DISPLAY_FONT.semibold, fontSize: 17, color: P.ink2 },
    mSrc: { textAlign: 'center', fontSize: 13 + P.bump / 2, lineHeight: 18 + P.bump / 2, color: P.ink2, marginTop: 8 },
    eq: { marginTop: 10, paddingTop: 10, borderTopWidth: P.rule, borderTopColor: P.line, textAlign: 'center', fontSize: 17 + P.bump / 2, lineHeight: 23 + P.bump / 2, fontWeight: '600', color: P.ink },
    op: { fontWeight: '500', color: P.ink3 },
    recallNote: { textAlign: 'center', fontSize: 12.5 + P.bump / 2, lineHeight: 17 + P.bump / 2, color: P.ink3, marginTop: 6 },
    near: { flexDirection: 'row', gap: 9, marginTop: 10, padding: 11, borderRadius: 12, backgroundColor: P.warnSoft },
    nearText: { flex: 1, fontSize: 13.5 + P.bump / 2, lineHeight: 19 + P.bump / 2, fontWeight: '500', color: P.ink },
    spec: { flexDirection: 'row', gap: 8, paddingVertical: 9 },
    specText: { flex: 1, fontSize: 15 + P.bump, lineHeight: 21 + P.bump, color: P.ink },
    ruled: { borderTopWidth: P.rule, borderTopColor: P.line },
    ref: { borderRadius: 12, borderWidth: P.rule, borderColor: P.line },
    rr: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
    rrKey: { width: 66, fontSize: 12 + P.bump / 2, lineHeight: 19, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase', color: P.ink3 },
    rrVal: { flex: 1, gap: 4 },
    rrText: { fontSize: 14 + P.bump, lineHeight: 19 + P.bump, color: P.ink },
    rrSmall: { fontSize: 12.5 + P.bump / 2, lineHeight: 17 + P.bump / 2, fontWeight: '500', color: P.ink2 },
    secRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    secText: { fontSize: 16 + P.bump, fontWeight: '700', color: P.ink },
    copy: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: P.soft },
    copyText: { fontSize: 13 + P.bump / 2, fontWeight: '600', color: P.ink },
    official: { marginTop: 14, borderRadius: 16, borderWidth: 2, borderColor: P.ink, paddingVertical: 14, paddingHorizontal: 16 },
    officialOff: { borderColor: P.line },
    officialPressed: { backgroundColor: P.soft },
    ot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    otText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 18 + P.bump, color: P.ink },
    free: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 5, backgroundColor: P.accentSoft },
    freeText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: P.accentLabel },
    steps: { flexDirection: 'row', gap: 10, marginTop: 12 },
    step: { flex: 1 },
    stepKey: { fontSize: 10.5 + P.bump / 2, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: P.ink, marginBottom: 5 },
    stepText: { fontSize: 12.5 + P.bump / 2, lineHeight: 16.5 + P.bump / 2, color: P.ink2 },
    alist: { marginTop: 14, borderRadius: 14, borderWidth: P.rule, borderColor: P.line, overflow: 'hidden' },
    ai: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 12 },
    pressed: { backgroundColor: P.soft },
    aiIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft },
    aiIconDone: { backgroundColor: P.successSoft },
    aiText: { flex: 1 },
    aiTitle: { fontSize: 15 + P.bump, lineHeight: 19 + P.bump, fontWeight: '600', color: P.ink },
    dim: { color: P.ink2 },
    aiSub: { fontSize: 12.5 + P.bump / 2, lineHeight: 17 + P.bump / 2, color: P.ink2, marginTop: 1 },
    aiSubDone: { color: P.successLabel, fontWeight: '600' },
    msgHead: { fontSize: 11.5 + P.bump / 2, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase', color: P.ink3, marginTop: 16, marginBottom: 8, marginHorizontal: 2 },
    msg: { marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderBottomLeftRadius: 4, backgroundColor: P.bg, borderWidth: P.sunlight ? 2 : 0, borderColor: P.line },
    msgText: { fontSize: 14 + P.bump, lineHeight: 20 + P.bump, color: P.ink },
    sendBtn: { marginTop: 10 },
  });
