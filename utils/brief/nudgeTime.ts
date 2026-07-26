// utils/brief/nudgeTime.ts — pure fire-time math for the morning-brief nudge.
// Split from nudge.ts so the Bun validator can exercise it without dragging
// in expo-notifications (which crashes outside the RN runtime).

/**
 * The next morning-brief fire time: TOMORROW at hour:minute LOCAL time
 * (plan: the nudge is re-armed on every foreground, so "tomorrow" is always
 * correct — if the user is in the app right now, today's nudge is redundant).
 * setDate handles month/year rollover; setHours pins local wall-clock time,
 * which keeps the alarm honest across DST transitions.
 */
export function nextMorningFireDate(hour: number, minute: number, now: Date = new Date()): Date {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const m = Math.min(59, Math.max(0, Math.floor(minute)));
  const fire = new Date(now);
  fire.setDate(fire.getDate() + 1);
  fire.setHours(h, m, 0, 0);
  return fire;
}
