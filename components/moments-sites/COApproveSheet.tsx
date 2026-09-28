// COApproveSheet: approve a change order with one slide (wave-next W2, lane MOMMONEY, B1 + B2).
//
// Replaces the "Approve CO #4?" confirm Alert on the change-order screen and on
// the job page's list row. The money line comes from the caller
// (coApproveConfirmCopy, below), then the slide "Slide to approve ·
// +$4,200.00". The write is ProjectContext.approveChangeOrder: the status is
// written FIRST and the phone shows the approval only once the server has it
// (synced) or it is safely waiting to send (queued). Nothing on this phone
// changes on a refusal, so the un-commit is the truth.
//
// The sheet stays open through the result (plan rule 7): it closes in onDone
// after the hold, and only for a confirmed or queued answer. A refused or
// timed-out slide keeps the sheet up with its reason line. No confetti, no
// success Alert, no success haptic (the capsule plays its own).
//
// A slide never sits inline in a list row: the row's "Approve CO #4" stays a
// tap that opens this sheet.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet, useSheetPrimaryHotkey } from '@/components/ui/Sheet';
import {
  SlideToConfirm,
  fromWriteOutcome,
  type CommitResult,
  type CommitWriteOptions,
  type SlideToConfirmHandle,
} from '@/components/moments/core/contract';
import { useProjectCrossActions } from '@/contexts/ProjectContext';
import { nailIt } from '@/components/animations/NailItToast';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ChangeOrder, Project } from '@/types';
import { resolveContractSum, type SignedContractLike } from '@/utils/projectFinancials';
import { loadActiveContract } from '@/utils/contractEngine';
import {
  coApproved,
  coApprovedNoTotal,
  coApprovedToast,
  coBusy,
  coQueued,
  coRefused,
  coSlideLabel,
  coSrConfirm,
  coSrLabel,
  coTimeout,
} from '@/utils/moments/sites/moneyCopy';

export interface COApproveSheetProps {
  visible: boolean;
  changeOrder: ChangeOrder;
  /** The CO's number as the server confirmed it (the screen's confirmedNumber ?? co.number). */
  coNumber: number;
  /** "Approve CO #4?" (coApproveConfirmCopy). */
  title: string;
  /** The money line: what this commits to the contract (coApproveConfirmCopy). */
  moneyLine: string;
  /**
   * The contract total once this CO is approved, integer cents (the confirmed
   * title). null when the signed contract could not be read: the title then
   * names the CO's own amount, never a guessed contract figure.
   */
  contractAfterCents: number | null;
  onClose: () => void;
  testID?: string;
}

/**
 * The contract total once `coId` is approved, integer cents: the contract sum
 * (the SIGNED contract when there is one, else the estimate — MONEY-CONTRACT-1,
 * utils/projectFinancials resolveContractSum) plus every approved change
 * order, this one included.
 *
 * `contract` is the active contract read: a row, `null` when the project has
 * none on file, `undefined` while it is not read or the read failed. Unread
 * gives null: a signed contract may differ from the estimate, so the
 * confirmed title then names the CO's own amount instead of a guess.
 */
export function contractAfterApprovalCents(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  coId: string,
  contract: SignedContractLike | null | undefined,
): number | null {
  if (contract === undefined) return null;
  const base = resolveContractSum(project, contract).value;
  const approved = (changeOrders ?? [])
    .map((c) => (c.id === coId ? { ...c, status: 'approved' as const } : c))
    .filter((c) => c.status === 'approved')
    .reduce((sum, c) => sum + dollarsToCents(c.changeAmount), 0);
  return Math.round(base * 100) + approved;
}

/** The confirmed title: "CO #4 approved · contract $52,400.00", or "CO #4 approved · +$4,200.00" when the contract is unread. */
export function coApprovedTitle(coNumber: number, amountCents: number, contractAfterCents: number | null): string {
  return contractAfterCents == null ? coApprovedNoTotal(coNumber, amountCents) : coApproved(coNumber, contractAfterCents);
}

/**
 * The project's active contract for the approve title, read only while an
 * approve sheet or preview is open (`enabled`). `undefined` until it answers
 * and when the read fails; `null` when none is on file.
 */
export function useApprovalContract(projectId: string | null | undefined, enabled: boolean): SignedContractLike | null | undefined {
  const [contract, setContract] = useState<SignedContractLike | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let live = true;
    void loadActiveContract(projectId).then((r) => {
      if (live) setContract(r.ok ? r.contract : undefined);
    }).catch(() => { if (live) setContract(undefined); });
    return () => { live = false; };
  }, [projectId, enabled]);
  return contract;
}

// >>> co-approve-copy
/** #79 — the money line before a CO is marked approved (the approve sheet and the reflow preview). */
export function coApproveConfirmCopy(number: number | null, amount: number, money: (n: number) => string): { title: string; message: string } {
  const label = number != null ? `CO #${number}` : 'this change order';
  return {
    title: `Approve ${label}?`,
    message: amount < 0
      ? `This credits ${money(Math.abs(amount))} back to the contract. Mark it approved only if your client agreed to it — there is no client signature on this path.`
      : `This commits ${money(amount)} to the contract. Mark it approved only if your client agreed to it — there is no client signature on this path.`,
  };
}
// <<< co-approve-copy

/** Integer cents of a dollar figure (a CO's changeAmount is dollars). */
export function dollarsToCents(n: number | null | undefined): number {
  return Number.isFinite(n) ? Math.round((n as number) * 100) : 0;
}

export function COApproveSheet(props: COApproveSheetProps): React.JSX.Element {
  const { visible, changeOrder, coNumber, contractAfterCents, onClose } = props;
  const { approveChangeOrder } = useProjectCrossActions();
  const styles = useThemedStyles(makeStyles);
  const slideRef = useRef<SlideToConfirmHandle>(null);
  const amountCents = dollarsToCents(changeOrder.changeAmount);

  // Cmd+Enter plays the hold, never an instant commit (plan rule 6).
  useSheetPrimaryHotkey(visible, () => slideRef.current?.playHoldToCommit(), { saveKey: false });

  const approve = useCallback(async (): Promise<CommitResult> => {
    const outcome = await approveChangeOrder(changeOrder.id);
    return fromWriteOutcome(outcome, { title: coApprovedTitle(coNumber, amountCents, contractAfterCents) }, { refused: coRefused(), queued: coQueued() });
  }, [approveChangeOrder, changeOrder.id, coNumber, amountCents, contractAfterCents]);

  // Non-idempotent (plan rule 3): a timeout says "Check CO #4", never "nothing was saved".
  const writeOptions = useMemo<CommitWriteOptions>(() => ({
    idempotent: false,
    copy: { refused: coRefused(), timeout: coTimeout(coNumber) },
  }), [coNumber]);

  // The sheet closes after the result hold, and only when the approval is stored or waiting to send.
  const onDone = useCallback((r: CommitResult) => {
    if (r.status === 'confirmed' || r.status === 'queued') onClose();
  }, [onClose]);

  // The sheet was closed before the answer came back: a confirmed approval still gets said.
  const onResultAfterUnmount = useCallback((r: CommitResult) => {
    if (r.status === 'confirmed') nailIt(coApprovedToast(coNumber));
  }, [coNumber]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={props.title}
      size="dialog"
      testID={props.testID ?? 'co-approve-sheet'}
      footer={(
        <View style={styles.footer}>
          <SlideToConfirm
            ref={slideRef}
            label={coSlideLabel(amountCents)}
            busyLabel={coBusy()}
            srLabel={coSrLabel(coNumber, amountCents)}
            srConfirm={coSrConfirm(coNumber)}
            onCommit={approve}
            writeOptions={writeOptions}
            size="lg"
            tone="brand"
            resultIcon="check"
            onDone={onDone}
            onLateResult={onResultAfterUnmount}
            onResultAfterUnmount={onResultAfterUnmount}
            testID="co-approve-slide"
          />
        </View>
      )}
    >
      <Text style={styles.moneyLine}>{props.moneyLine}</Text>
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  moneyLine: { ...Type.subhead, color: t.text },
  footer: { paddingTop: Tokens.spacing.sm },
});

export default COApproveSheet;
