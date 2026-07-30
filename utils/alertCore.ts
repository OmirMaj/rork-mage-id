// utils/alertCore.ts — the RN-free half of the alert shim.
//
// Mirrors the utils/brain/predictionLedgerCore.ts pattern: utils/alert.ts
// imports react-native (so Bun can't parse it), while the pure decision logic
// lives here and is unit-testable under `bun run`.

export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AlertButton {
  text?: string;
  onPress?: (value?: string) => void;
  style?: AlertButtonStyle;
}

/**
 * Normalize whatever the caller passed into a list we can always render.
 * RN's contract: no buttons at all means a single dismiss button.
 */
export function normalizeButtons(buttons?: AlertButton[]): AlertButton[] {
  if (!buttons || buttons.length === 0) return [{ text: 'OK', style: 'default' }];
  return buttons.map((b) => ({
    text: b.text && b.text.length > 0 ? b.text : 'OK',
    onPress: b.onPress,
    style: b.style ?? 'default',
  }));
}

/**
 * Which button a dismissal (backdrop tap / Escape) fires. RN dismisses to the
 * cancel button when one exists; otherwise dismissing does nothing.
 */
export function cancelButtonIndex(buttons: AlertButton[]): number {
  return buttons.findIndex((b) => b.style === 'cancel');
}
