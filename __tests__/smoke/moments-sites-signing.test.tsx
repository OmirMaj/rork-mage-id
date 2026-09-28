/**
 * Moments, lane MOMSIGN (wave-next W2): the signing sites, rendered as the
 * sheets the screens mount (app/contract.tsx SignatureModal and
 * RecordHomeownerSignatureModal, app/field-ticket.tsx SignatureModal,
 * app/client-view.tsx ClientCOApproveCeremony) with a mocked write that
 * resolves each status.
 *
 * THE PROMISES THIS PROVES (per site)
 *   - confirmed: the seal mounts (and, for the contract's closing signer,
 *     the "Binding" chip); the sheet's onDone gets the confirmed result.
 *   - refused: the site's own reason line, no seal, no "Binding", no "Locked";
 *     the name, the strokes (and the consent tick) are still there.
 *   - timeout (a write that never answers): "No answer yet…", no seal.
 *   - queued: a legal site can never be queued, so a "queued" answer is
 *     refused with the site's sentence and shows no seal.
 *   - offline: the line is disabled with "You're offline. Signing needs a
 *     connection." (field ticket, contract, client-view CO approval).
 *   Site specifics: the GC letter says "Signed and sent to Jane Smith" only
 *   when the write says the email went out, and "Signed. Not sent yet." with
 *   the reason otherwise; the in-person hand-off turns to the client, whose
 *   name field is EMPTY, and a neutral "already signed" plays no seal; the
 *   paper slide is disabled with the draft's reason; the CO approval needs
 *   the consent tick.
 *
 * Driven through the screen-reader path (the capsule's one button + Confirm),
 * the same state machine the drag feeds (moments-signline.test.tsx proves the
 * drag). ONE test on purpose (see moments-signline.test.tsx): a second `it`
 * after the first one's cleanup never commits its first render here. Every
 * tree is unmounted explicitly.
 */

import React, { useState } from 'react';
import { Modal, Text } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { momentHaptic } from '@/utils/moments/haptics';
import SignaturePad from '@/components/SignaturePad';
import { SealStamp } from '@/components/moments/signing/SealStamp';
import type { CommitResult } from '@/utils/moments/commitResult';
import type { ChangeOrder, ProjectContract } from '@/types';
import * as S from '@/utils/moments/sites/signingCopy';
import { SignatureModal as ContractSignSheet, RecordHomeownerSignatureModal } from '@/app/contract';
import { SignatureModal as TicketSignSheet } from '@/app/field-ticket';
import { ClientCOApproveCeremony } from '@/app/client-view';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});
jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

const INK = ['M10.0,20.0 L40.0,30.0 L80.0,25.0'];
const OFFLINE = "You're offline. Signing needs a connection.";
const NEVER = () => new Promise<CommitResult>(() => {});

const CONTRACT = {
  id: 'contract-1',
  projectId: 'project-1',
  userId: 'user-1',
  version: 1,
  title: 'Construction contract',
  contractValue: 84500,
  startDate: '2026-10-01',
  durationDays: 60,
  scopeText: 'Kitchen remodel',
  termsText: 'Terms',
  warrantyText: 'Workmanship is warranted for 12 months.',
  paymentSchedule: [{ id: 'm1', label: 'Deposit', percent: 30, trigger: 'on_signing', status: 'pending' }],
  allowances: [],
  status: 'sent',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
} as unknown as ProjectContract;

const CO = {
  id: 'co-4',
  projectId: 'project-1',
  number: 4,
  description: 'Add a pantry cabinet run',
  changeAmount: 4200,
  newContractTotal: 88700,
  status: 'submitted',
} as unknown as ChangeOrder;

const layout = (w: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: w, height: 56 } } });
async function flush(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      jest.advanceTimersByTime(step);
    });
  }
}
type R = ReturnType<typeof render>;
function layOut(r: R, id: string) {
  act(() => {
    fireEvent(r.getByTestId(`${id}-card`), 'layout', layout(352));
    fireEvent(r.getByTestId(`${id}-under`), 'layout', layout(352));
  });
}
function ink(r: R) {
  act(() => {
    r.UNSAFE_getByType(SignaturePad).props.onChange(INK);
  });
}
async function slideToSign(r: R, id: string) {
  fireEvent.press(r.getByTestId(`${id}-sr`));
  await flush(300);
  fireEvent.press(r.getByTestId(`${id}-sr-confirm`));
}
const labelText = (r: R, id: string) => ([] as unknown[]).concat(r.getByTestId(`${id}-label`).props.children).join('');
const seals = (r: R) => r.UNSAFE_queryAllByType(SealStamp).length;
const chipText = (r: R, id: string) => ([] as unknown[]).concat(r.getByTestId(`${id}-chip`).props.children).join('');

// ── harnesses ────────────────────────────────────────────────────────────────

const TICKET = 'ticket-sign';
function Ticket(p: { write: () => Promise<CommitResult>; offline?: boolean; amount?: number | null; onDone?: (r: CommitResult) => void }) {
  return (
    <TicketSignSheet
      visible
      amount={p.amount === undefined ? 1240 : p.amount}
      summary="Extra excavation at the north footing"
      ticketLabel="FT-12"
      workDate="2026-09-28"
      offline={!!p.offline}
      onClose={() => {}}
      onSign={p.write}
      onDone={p.onDone ?? (() => {})}
      onLateResult={() => {}}
      recordFrom={() => ({ signedAtIso: '2026-09-28T18:41:00.000Z', timeSource: 'device', name: 'Dana Ruiz' })}
    />
  );
}

const GC = 'contract-sign';
type Moment = { fold: { to: string; email: string; sent?: boolean; title?: string; body?: string }; sentAnnounce: string };
function Gc(p: { write: () => Promise<CommitResult>; moment: Moment; contract?: ProjectContract; offline?: boolean; onDone?: (r: CommitResult) => void; above?: React.ReactNode }) {
  return (
    <ContractSignSheet
      visible
      onClose={() => {}}
      onSign={p.write}
      defaultName="Omir Majeed"
      contract={p.contract ?? CONTRACT}
      projectName="Kitchen remodel"
      offline={!!p.offline}
      moment={p.moment}
      recordFrom={() => ({ signedAtIso: '2026-09-28T18:41:00.000Z', timeSource: 'device', name: 'Omir Majeed' })}
      onDone={p.onDone ?? (() => {})}
      onLateResult={() => {}}
      above={p.above}
    />
  );
}

const REC = 'contract-record-ceremony';
function InPerson(p: {
  write: () => Promise<CommitResult>; neutral?: boolean; onBinding?: () => void; offline?: boolean;
  paper?: () => Promise<CommitResult>; onClose?: () => void;
}) {
  return (
    <RecordHomeownerSignatureModal
      visible
      onClose={p.onClose ?? (() => {})}
      contract={CONTRACT}
      projectName="Kitchen remodel"
      clientName="Jane Smith"
      gcName="Omir Majeed"
      together={false}
      offline={!!p.offline}
      recordInPerson={p.write}
      recordPaper={p.paper ?? (async () => ({ status: 'refused', reason: S.recordRefused() }))}
      isNeutral={() => !!p.neutral}
      recordFrom={() => ({ signedAtIso: '2026-09-28T18:41:00.000Z', timeSource: 'device', name: 'Jane Smith' })}
      onBinding={p.onBinding ?? (() => {})}
      autoSeal={{ state: 'idle' }}
      onLateResult={() => {}}
      onResultAfterUnmount={() => {}}
    />
  );
}

const COID = 'co-approve';
function CoApprove(p: { write: () => Promise<CommitResult>; offline?: boolean; initialName?: string; onDone?: (r: CommitResult) => void }) {
  const [name, setName] = useState(p.initialName ?? '');
  const [consent, setConsent] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  return (
    <ClientCOApproveCeremony
      co={CO}
      name={name}
      onNameChange={setName}
      consentChecked={consent}
      onConsentChange={setConsent}
      paths={paths}
      onPathsChange={setPaths}
      offline={!!p.offline}
      write={p.write}
      recordFrom={() => ({ signedAtIso: '2026-09-28T18:41:00.000Z', timeSource: 'device', name })}
      onBusy={() => {}}
      onDone={p.onDone ?? (() => {})}
      onLateResult={() => {}}
    />
  );
}

describe('moments signing sites (MOMSIGN)', () => {
  it('field ticket, GC sign & send, in person, paper, client-view CO: confirmed / refused / timeout / queued / offline', async () => {
    jest.useFakeTimers();

    // ═══ A5 field ticket ═══════════════════════════════════════════════════
    {
      // offline: the line says why, nothing can commit
      const off = render(<Ticket offline write={jest.fn()} />);
      layOut(off, TICKET);
      expect(labelText(off, TICKET)).toBe(OFFLINE);
      off.unmount();

      // the label carries the amount (cents); a blinded role sees none
      const blind = render(<Ticket amount={null} write={jest.fn()} />);
      layOut(blind, TICKET);
      ink(blind);
      fireEvent.changeText(blind.getByTestId(`${TICKET}-name`), 'Dana Ruiz');
      expect(labelText(blind, TICKET)).toBe(S.ticketSignLabelNoAmount());
      blind.unmount();

      // refused: the reason, no seal, no "Locked", the name and the strokes kept
      const refused = jest.fn(async (): Promise<CommitResult> => ({ status: 'refused', reason: S.ticketRefused('FT-12') }));
      const r = render(<Ticket write={refused} />);
      layOut(r, TICKET);
      ink(r);
      fireEvent.changeText(r.getByTestId(`${TICKET}-name`), 'Dana Ruiz');
      fireEvent.press(r.getByTestId('ticket-sign-role-architect'));
      expect(labelText(r, TICKET)).toBe(S.ticketSignLabel('$1,240.00'));
      await slideToSign(r, TICKET);
      await flush(2000);
      expect(refused).toHaveBeenCalledWith('Dana Ruiz', '', 'architect', INK);
      expect(r.getByText('Not signed. FT-12 could not be saved. Nothing was signed.')).toBeTruthy();
      expect(seals(r)).toBe(0);
      expect(chipText(r, TICKET)).not.toMatch(/Locked|Binding/);
      expect(r.getByTestId(`${TICKET}-name`).props.value).toBe('Dana Ruiz');
      expect(r.UNSAFE_getByType(SignaturePad).props.initialPaths).toEqual(INK);
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(false);
      r.unmount();
      await flush(200);

      // queued (a legal record is never queued): refused with the site sentence, no seal
      const q = render(<Ticket write={async () => ({ status: 'queued' })} />);
      layOut(q, TICKET);
      ink(q);
      fireEvent.changeText(q.getByTestId(`${TICKET}-name`), 'Dana Ruiz');
      await slideToSign(q, TICKET);
      await flush(2000);
      expect(q.getByText(S.ticketLegalQueued())).toBeTruthy();
      expect(seals(q)).toBe(0);
      q.unmount();
      await flush(200);

      // timeout: a write that never answers
      const t = render(<Ticket write={NEVER} />);
      layOut(t, TICKET);
      ink(t);
      fireEvent.changeText(t.getByTestId(`${TICKET}-name`), 'Dana Ruiz');
      await slideToSign(t, TICKET);
      await flush(21500, 250);
      expect(t.getByText('No answer yet. Check FT-12 before trying again.')).toBeTruthy();
      expect(seals(t)).toBe(0);
      t.unmount();
      await flush(200);

      // confirmed: the seal, "Locked", onDone(confirmed)
      const onDone = jest.fn();
      const c = render(<Ticket onDone={onDone} write={async () => ({ status: 'confirmed', title: S.ticketSignedTitle('FT-12', '$1,240.00'), detail: S.ticketLockedDetail(), next: S.ticketLockedNext() })} />);
      layOut(c, TICKET);
      ink(c);
      fireEvent.changeText(c.getByTestId(`${TICKET}-name`), 'Dana Ruiz');
      await slideToSign(c, TICKET);
      await flush(4000);
      expect(seals(c)).toBe(1);
      expect(chipText(c, TICKET)).toBe('Locked');
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', title: 'FT-12 signed · $1,240.00' }));
      c.unmount();
      await flush(200);
    }

    // ═══ A1 contract, GC sign & send ═══════════════════════════════════════
    {
      // missing terms: the sheet says why and shows no line at all
      const noTerms = render(<Gc write={jest.fn()} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} contract={{ ...CONTRACT, paymentSchedule: [] } as ProjectContract} />);
      expect(noTerms.getByText(S.contractTermsReason())).toBeTruthy();
      expect(noTerms.queryByTestId(`${GC}-card`)).toBeNull();
      noTerms.unmount();

      // TRUST-2 (ideas-1, landed in the W2 integration): the stale-price check
      // sits in the signing sheet, in the ceremony's `above` slot, over the card.
      const drift = render(<Gc write={jest.fn()} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} above={<Text testID="drift-card-stub">Prices moved</Text>} />);
      expect(drift.getByTestId(`${GC}-above`)).toBeTruthy();
      expect(drift.getByTestId('drift-card-stub')).toBeTruthy();
      drift.unmount();
      const plain = render(<Gc write={jest.fn()} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} />);
      expect(plain.queryByTestId(`${GC}-above`)).toBeNull();
      plain.unmount();

      // offline
      const off = render(<Gc offline write={jest.fn()} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} />);
      layOut(off, GC);
      expect(labelText(off, GC)).toBe(OFFLINE);
      off.unmount();

      // refused (duplicate): the reason, no seal, the name and the strokes kept
      const dup = render(<Gc write={async () => ({ status: 'refused', reason: S.contractDuplicate() })} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} />);
      layOut(dup, GC);
      ink(dup);
      expect(dup.getByTestId(`${GC}-name`).props.value).toBe('Omir Majeed');
      await slideToSign(dup, GC);
      await flush(2000);
      expect(dup.getByText('Not signed. This project already has a contract. Close this to see it.')).toBeTruthy();
      expect(seals(dup)).toBe(0);
      expect(dup.getByTestId(`${GC}-name`).props.value).toBe('Omir Majeed');
      expect(dup.UNSAFE_getByType(SignaturePad).props.initialPaths).toEqual(INK);
      dup.unmount();
      await flush(200);

      // timeout
      const t = render(<Gc write={NEVER} moment={{ fold: { to: '', email: '' }, sentAnnounce: '' }} />);
      layOut(t, GC);
      ink(t);
      await slideToSign(t, GC);
      await flush(21500, 250);
      expect(t.getByText('No answer yet. Check the contract before trying again.')).toBeTruthy();
      expect(seals(t)).toBe(0);
      t.unmount();
      await flush(200);

      // confirmed, the email went out: the write fills the fold before it resolves
      const sentMoment: Moment = { fold: { to: '', email: '', sent: false }, sentAnnounce: '' };
      const sent = render(<Gc moment={sentMoment} write={async () => {
        sentMoment.fold.to = 'Jane Smith';
        sentMoment.fold.email = 'jane.smith@example.com';
        sentMoment.fold.sent = true;
        sentMoment.fold.title = S.contractSentTitle('Jane Smith');
        sentMoment.fold.body = S.contractSentBody();
        return { status: 'confirmed', title: S.contractSentTitle('Jane Smith'), next: S.contractSentBody() };
      }} />);
      layOut(sent, GC);
      ink(sent);
      await slideToSign(sent, GC);
      await flush(4500);
      expect(seals(sent)).toBe(1);
      expect(sent.getByText('Signed and sent to Jane Smith')).toBeTruthy();
      expect(sent.queryByText('Binding')).toBeNull();
      sent.unmount();
      await flush(200);

      // confirmed, NOT emailed: never "sent"; the back face says why
      const notMoment: Moment = { fold: { to: '', email: '', sent: false }, sentAnnounce: '' };
      const not = render(<Gc moment={notMoment} write={async () => {
        notMoment.fold.to = 'Jane Smith';
        notMoment.fold.email = S.contractNoEmailOnFile();
        notMoment.fold.sent = false;
        notMoment.fold.title = S.contractNotSentTitle();
        notMoment.fold.body = S.contractNotSentPortalOff();
        return { status: 'confirmed', title: S.contractNotSentTitle(), next: S.contractNotSentPortalOff() };
      }} />);
      layOut(not, GC);
      ink(not);
      await slideToSign(not, GC);
      await flush(4500);
      expect(seals(not)).toBe(1);
      expect(not.getByText('Signed. Not sent yet.')).toBeTruthy();
      expect(not.getByText(S.contractNotSentPortalOff())).toBeTruthy();
      expect(not.queryByText(/^Sent to|Signed and sent/)).toBeNull();
      expect(chipText(not, GC)).toBe('Signed · Email not sent');
      not.unmount();
      await flush(200);
    }

    // ═══ A2 contract, the client in person (the hand-off turn) ═════════════
    {
      const handOver = async (r: R) => {
        expect(r.getByText(S.handoffBody('Jane Smith'))).toBeTruthy();
        fireEvent.press(r.getByTestId('contract-record-hand-over'));
        await flush(700);
        layOut(r, REC);
      };

      // offline
      const off = render(<InPerson offline write={jest.fn()} />);
      await handOver(off);
      expect(labelText(off, REC)).toBe(OFFLINE);
      off.unmount();
      await flush(200);

      // refused: the reason, no seal, no "Binding", the client's name kept; it was EMPTY on arrival
      const refused = render(<InPerson write={async () => ({ status: 'refused', reason: S.recordRefused() })} />);
      await handOver(refused);
      expect(refused.getByTestId(`${REC}-name`).props.value).toBe('');
      ink(refused);
      fireEvent.changeText(refused.getByTestId(`${REC}-name`), 'Jane Smith');
      await slideToSign(refused, REC);
      await flush(2000);
      expect(refused.getByText(S.recordRefused())).toBeTruthy();
      expect(seals(refused)).toBe(0);
      expect(refused.queryByText('Binding')).toBeNull();
      expect(refused.getByTestId(`${REC}-name`).props.value).toBe('Jane Smith');
      expect(refused.queryByTestId('contract-record-hand-back')).toBeNull();
      refused.unmount();
      await flush(200);

      // timeout
      const t = render(<InPerson write={NEVER} />);
      await handOver(t);
      ink(t);
      fireEvent.changeText(t.getByTestId(`${REC}-name`), 'Jane Smith');
      await slideToSign(t, REC);
      await flush(21500, 250);
      expect(t.getByText(S.contractTimeout())).toBeTruthy();
      expect(seals(t)).toBe(0);
      t.unmount();
      await flush(200);

      // neutral: already signed elsewhere — no seal, no "Binding", no onBinding
      const nb = jest.fn();
      const n = render(<InPerson neutral onBinding={nb} write={async () => ({ status: 'confirmed', title: S.alreadySignedTitle() })} />);
      await handOver(n);
      ink(n);
      fireEvent.changeText(n.getByTestId(`${REC}-name`), 'Jane Smith');
      await slideToSign(n, REC);
      await flush(3000);
      expect(seals(n)).toBe(0);
      expect(n.getByTestId(`${REC}-neutral`)).toBeTruthy();
      expect(n.queryByText('Binding')).toBeNull();
      expect(nb).not.toHaveBeenCalled();
      n.unmount();
      await flush(200);

      // confirmed: the seal closes the contract ("Binding", onBinding once),
      // then the hand-back turns the card to the contractor's record
      const onBinding = jest.fn();
      const c = render(<InPerson onBinding={onBinding} write={async () => ({ status: 'confirmed', title: S.inPersonSignedTitle(), detail: S.contractSummaryLine('Kitchen remodel', '$84,500.00') })} />);
      await handOver(c);
      ink(c);
      fireEvent.changeText(c.getByTestId(`${REC}-name`), 'Jane Smith');
      await slideToSign(c, REC);
      await flush(4000);
      expect(seals(c)).toBe(1);
      expect(c.getByText('Binding')).toBeTruthy();
      expect(onBinding).toHaveBeenCalledTimes(1);
      fireEvent.press(c.getByTestId('contract-record-hand-back'));
      await flush(700);
      expect(c.getByText(S.recordCardTitle())).toBeTruthy();
      expect(c.getByText(S.recordCardSignedBy('Jane Smith'))).toBeTruthy();
      c.unmount();
      await flush(200);
    }

    // ═══ A3 contract, paper: no ceremony; the slide says what is missing ════
    {
      const r = render(<InPerson write={jest.fn()} />);
      fireEvent.press(r.getByTestId('contract-record-paper'));
      expect(r.queryByTestId(`${REC}-card`)).toBeNull();
      expect(r.UNSAFE_queryAllByType(SignaturePad)).toHaveLength(0);
      // The track shows its disabled reason (decorative text, hidden from the a11y tree).
      expect(r.getByText("Type the client's full legal name.", { includeHiddenElements: true })).toBeTruthy();
      fireEvent.changeText(r.getByTestId('contract-record-name'), 'Jane Smith');
      expect(r.getByText('Add a photo of the signed page. It is the proof this signature was given.', { includeHiddenElements: true })).toBeTruthy();
      r.unmount();
      await flush(200);

      // The client already signed on the portal or another phone while the
      // paper was being recorded: nothing of this record was stored, so the
      // slide refuses with its reason. No lock result, no success haptic, and
      // the sheet stays open (onClose runs only on a confirmed record).
      // W2 integration: WHILE the write runs the sheet holds (Cancel, Android
      // back and the name field are off), so the refusal is read on the open
      // sheet; after it the slide stays disabled with that sentence, and a
      // second slide changes nothing.
      const PAPER = 'contract-record-paper-slide';
      const outerModal = (r: R) => r.UNSAFE_getAllByType(Modal).find((m) => m.props.visible && m.props.onRequestClose);
      const readyPaper = async (r: R) => {
        (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///signed-page.jpg' }] });
        fireEvent.press(r.getByTestId('contract-record-paper'));
        fireEvent.changeText(r.getByTestId('contract-record-name'), 'Jane Smith');
        await act(async () => {
          fireEvent.press(r.getByTestId('contract-record-photo-camera'));
        });
        await flush(200);
        act(() => {
          fireEvent(r.getByTestId(`${PAPER}-track`), 'layout', layout(352));
        });
        await flush(100);
      };
      const slidePaper = async (r: R) => {
        fireEvent.press(r.getByTestId(`${PAPER}-rail`));
        await flush(300);
        fireEvent.press(r.getByTestId(`${PAPER}-confirm`));
      };
      /** Every way out of the sheet while it should be held: Cancel and Android back. */
      const tryToClose = (r: R) => {
        fireEvent.press(r.getByTestId('contract-record-cancel'));
        act(() => { outerModal(r)?.props.onRequestClose(); });
      };
      (momentHaptic as jest.Mock).mockClear();
      let answer: (r: CommitResult) => void = () => {};
      const paperWrite = jest.fn(() => new Promise<CommitResult>((res) => { answer = res; }));
      const onClose = jest.fn();
      const p = render(<InPerson write={jest.fn()} paper={paperWrite} onClose={onClose} />);
      await readyPaper(p);
      // The track label and the result pill are decorative (hidden from the a11y tree).
      expect(([] as unknown[]).concat(p.getByTestId(`${PAPER}-label`, { includeHiddenElements: true }).props.children).join('')).toBe(S.paperLabel());
      await slidePaper(p);
      await flush(600);
      expect(paperWrite).toHaveBeenCalledTimes(1);
      // The write is running: the sheet holds.
      tryToClose(p);
      expect(onClose).not.toHaveBeenCalled();
      expect(p.getByTestId('contract-record-name').props.editable).toBe(false);
      expect(p.getByTestId('contract-record-cancel').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
      await act(async () => { answer({ status: 'refused', reason: S.paperAlreadySigned() }); });
      await flush(3000);
      expect(p.getByTestId(`${PAPER}-reason`).props.children).toBe('Not recorded. The client already signed on the portal or another phone, so nothing was changed.');
      expect(p.queryByTestId(`${PAPER}-result`, { includeHiddenElements: true })).toBeNull();
      expect(momentHaptic).not.toHaveBeenCalledWith('success');
      expect(onClose).not.toHaveBeenCalled();
      expect(p.getByTestId('contract-record-name').props.value).toBe('Jane Smith');
      // A second slide: disabled with the same sentence, nothing is written again.
      // (Disabled: the one button's label and hint are the reason, not "Record…".)
      const rail = p.getByTestId(`${PAPER}-rail`);
      expect(rail.props.accessibilityLabel).toBe(S.paperAlreadySigned());
      expect(rail.props.accessibilityHint).toBe(S.paperAlreadySigned());
      fireEvent.press(rail);
      await flush(300);
      expect(p.queryByTestId(`${PAPER}-confirm`)).toBeNull();
      expect(paperWrite).toHaveBeenCalledTimes(1);
      // The answer is in: the sheet lets go again.
      expect(p.getByTestId('contract-record-name').props.editable).toBe(true);
      fireEvent.press(p.getByTestId('contract-record-cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
      p.unmount();
      await flush(200);

      // "No answer yet" is read on the open sheet too: no way out while the write runs.
      const tClose = jest.fn();
      const t = render(<InPerson write={jest.fn()} paper={NEVER} onClose={tClose} />);
      await readyPaper(t);
      await slidePaper(t);
      await flush(1000);
      tryToClose(t);
      await flush(21500, 250);
      expect(t.getByTestId(`${PAPER}-reason`).props.children).toBe(S.contractTimeout());
      expect(tClose).not.toHaveBeenCalled();
      t.unmount();
      await flush(200);
    }

    // ═══ A6 client view, CO approval ════════════════════════════════════════
    {
      // offline
      const off = render(<CoApprove offline write={jest.fn()} />);
      layOut(off, COID);
      expect(labelText(off, COID)).toBe(OFFLINE);
      off.unmount();

      // the name is never prefilled, and the consent tick is required
      const pre = render(<CoApprove initialName="Jane Smith" write={jest.fn()} />);
      layOut(pre, COID);
      expect(pre.getByTestId(`${COID}-name`).props.value).toBe('');
      ink(pre);
      fireEvent.changeText(pre.getByTestId(`${COID}-name`), 'Jane Smith');
      expect(labelText(pre, COID)).toBe('Check the consent box');
      fireEvent.press(pre.getByTestId(`${COID}-consent`));
      expect(labelText(pre, COID)).toBe(S.clientCoSignLabel('+$4,200.00'));
      pre.unmount();

      const ready = (r: R) => {
        layOut(r, COID);
        ink(r);
        fireEvent.changeText(r.getByTestId(`${COID}-name`), 'Jane Smith');
        fireEvent.press(r.getByTestId(`${COID}-consent`));
      };

      // refused: the reason, no seal; the name, the strokes and the tick kept
      const refused = render(<CoApprove write={async () => ({ status: 'refused', reason: S.clientCoRefused() })} />);
      ready(refused);
      await slideToSign(refused, COID);
      await flush(2000);
      expect(refused.getByText('Not approved. Something went wrong on our side. Your signature is kept.')).toBeTruthy();
      expect(seals(refused)).toBe(0);
      expect(refused.getByTestId(`${COID}-name`).props.value).toBe('Jane Smith');
      expect(refused.getByTestId(`${COID}-consent`).props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
      expect(refused.UNSAFE_getByType(SignaturePad).props.initialPaths).toEqual(INK);
      refused.unmount();
      await flush(200);

      // queued: never for a legal record
      const q = render(<CoApprove write={async () => ({ status: 'queued' })} />);
      ready(q);
      await slideToSign(q, COID);
      await flush(2000);
      expect(q.getByText(S.clientCoLegalQueued())).toBeTruthy();
      expect(seals(q)).toBe(0);
      q.unmount();
      await flush(200);

      // timeout
      const t = render(<CoApprove write={NEVER} />);
      ready(t);
      await slideToSign(t, COID);
      await flush(21500, 250);
      expect(t.getByText('No answer yet. Check CO #4 with your contractor before trying again.')).toBeTruthy();
      expect(seals(t)).toBe(0);
      t.unmount();
      await flush(200);

      // confirmed: the seal, "Locked" (one party), onDone(confirmed)
      const onDone = jest.fn();
      const c = render(<CoApprove onDone={onDone} write={async () => ({ status: 'confirmed', title: S.clientCoApprovedTitle(4, '+$4,200.00'), next: S.clientCoApprovedNext() })} />);
      ready(c);
      await slideToSign(c, COID);
      await flush(4000);
      expect(seals(c)).toBe(1);
      expect(chipText(c, COID)).toBe('Locked');
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', title: 'Approved · CO #4 · +$4,200.00' }));
      c.unmount();
      await flush(200);
    }

    jest.useRealTimers();
  }, 120000);
});
