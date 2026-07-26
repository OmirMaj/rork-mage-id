// utils/brief/nudgeTime.ts — pure fire-time math for the morning-brief nudge.
// Split from nudge.ts so the Bun validator can exercise it without dragging
// in expo-notifications (which crashes outside the RN runtime).

/**
 * The next morning-brief fire time at hour:minute LOCAL: TODAY when that
 * moment is still ahead, otherwise TOMORROW.
 *
 * Always-tomorrow was wrong (tribunal): the nudge is re-armed on every app
 * foreground, so an open BEFORE the fire time (5:50am coffee check, 6:30
 * digest hour) cancelled today's pending nudge and replaced it with
 * tomorrow's — habitual early-morning openers never got one. If the user is
 * in the app AT the fire moment, the OS notification arriving is harmless;
 * silently losing the day's doorbell is not.
 *
 * setDate handles month/year rollover; setHours pins local wall-clock time,
 * which keeps the alarm honest across DST transitions.
 */
export function nextMorningFireDate(hour: number, minute: number, now: Date = new Date()): Date {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const m = Math.min(59, Math.max(0, Math.floor(minute)));
  const fire = new Date(now);
  fire.setHours(h, m, 0, 0);
  if (fire.getTime() <= now.getTime()) fire.setDate(fire.getDate() + 1);
  return fire;
}
