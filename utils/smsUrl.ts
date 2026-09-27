// ============================================================================
// utils/smsUrl.ts — the ONE sms: link builder (UX wave, Lane 0).
//
// Moved verbatim from utils/propertyMirror.ts's buildDispatchSmsUrl (the work
// order dispatch, which keeps importing it under that name through a
// re-export there). It lives in a neutral file now because the field side
// (the tomorrow lineup, Lane B) texts subs too, and a property-manager module
// is the wrong place for a construction screen to reach into.
//
// Behaviour, unchanged: the number is stripped to digits and '+'; iOS wants
// `&body=` after a recipient, Android and web take `?body=`. Do NOT use
// utils/scheduleOps.buildSmsUrl for a message — it drops the body.
//
// An opened Messages sheet proves nothing: iOS gives the app no signal that
// he pressed Send. A caller says "Opened in Messages", never "Sent", and on
// web asks "Did you send it?" before recording anything (work-order.tsx).
//
// Pure. scripts/validate-ux-sms-url.ts runs it under bun.
// ============================================================================

export function smsUrl(phone: string, msg: { body: string }, platform: 'ios' | 'android' | 'web' | string): string {
  const to = phone.replace(/[^\d+]/g, '');
  // iOS wants `&body=` after a recipient; Android and web take `?body=`.
  const sep = platform === 'ios' ? '&' : '?';
  return `sms:${to}${sep}body=${encodeURIComponent(msg.body)}`;
}
