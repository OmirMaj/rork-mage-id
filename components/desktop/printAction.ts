// components/desktop/printAction.ts — the header's Print action (contract D18,
// d6r lane B2).
//
// WHY. The bank-facing reports (the WIP schedule, Bank-Ready Reports) printed
// from a button low in a card, two screens down at 1512. On desktop web the
// header carries Print beside Export CSV, one click from anywhere on the page.
// One builder, so every header that prints (WIP, reports, and later the AIA
// pay application and Z1's pages) reads the same: the Printer icon, the word
// 'Print', and — when there is nothing to print — a blocked action that stays
// visible and SAYS WHY when pressed (ToolbarActions' runAction shows
// disabledReason), never a silent no-op.
//
// THE PRESS STAYS SYNCHRONOUS. ToolbarActions runs onPress in the click's own
// call stack, and the caller passes `() => { void handleExportPdf(); }`, so the
// PDF helper's window.open (utils/platformFile openPrintWindowOrThrow) runs
// inside the user activation and the browser's pop-up blocker lets it through.
// Never wrap onPrint in a timeout or an awaited step before the open.

import { Printer } from 'lucide-react-native';
import type { ToolbarAction } from '@/components/desktop/ToolbarActions';

export interface PrintToolbarActionOptions {
  /** Runs the page's own print / PDF path (synchronously — see the header). */
  onPrint: () => void;
  /** Non-empty → the action is blocked and pressing it explains this. */
  blockedReason?: string | null;
  /** Default 'Print'. */
  label?: string;
  testID?: string;
}

export function printToolbarAction(o: PrintToolbarActionOptions): ToolbarAction {
  return {
    key: 'print',
    label: o.label ?? 'Print',
    icon: Printer,
    onPress: o.onPrint,
    disabled: !!o.blockedReason,
    disabledReason: o.blockedReason ?? null,
    testID: o.testID,
  };
}
