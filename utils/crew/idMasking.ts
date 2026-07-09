// Derive the masked last-4 of a government-ID number. Strips every
// non-digit, then keeps the final 4 digits (fewer if the number is short).
// This is the ONLY ID-number-derived value we ever persist — the raw
// idNumberFull is discarded immediately after this call.
export function maskIdLast4(idNumberFull: string): string {
  const digits = (idNumberFull ?? '').replace(/\D/g, '');
  return digits.slice(-4);
}
