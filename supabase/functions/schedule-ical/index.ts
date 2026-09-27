// schedule-ical — Phase 27.
//
// Generates an RFC 5545 iCalendar feed scoped to schedule tasks only
// (no invoices / warranties — use the existing `ics-feed` function for
// the full project feed). Targeted at the Pro Scheduler export flow.
//
// Auth model: HMAC-signed token in the URL (verify_jwt: false) so the
// URL is self-contained and can be subscribed to in Apple/Google Calendar
// without a login step.
//
// Deploy: supabase functions deploy schedule-ical
// (verify_jwt must be set to false in supabase/config.toml or via the
//  Supabase dashboard for this function.)
//
// URL shape:
//   https://<project>.functions.supabase.co/schedule-ical?sid=<projectId>&uid=<userId>&t=<token>
//   webcal://<project>.functions.supabase.co/schedule-ical?sid=<projectId>&uid=<userId>&t=<token>
//
// Token signing: HMAC-SHA256 over "<sid>:<uid>", truncated to 16 URL-safe
// base64 chars. Rotate SCHEDULE_ICAL_SECRET to revoke all outstanding links.
//
// Note: the broader `ics-feed` edge function (supabase/functions/ics-feed)
// serves the same purpose with a UUID `calendar_token` approach. This
// function is an alternative that works without requiring a DB column and
// is strictly scoped to schedule tasks for the Scheduler export sheet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildScheduleIcalEvents, escapeIcs, type IcalSchedule } from './icsEvents.ts';

// No literal fallback (audit OPS-F11 / AUTH-F13): anyone holding the bundle
// could mint feed tokens from the old constant. Unset → every request 500s
// with a clear message (checked in the handler so the function still boots).
const SECRET = Deno.env.get('SCHEDULE_ICAL_SECRET') ?? '';

async function signToken(scheduleId: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${scheduleId}:${userId}`));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return b64.slice(0, 16);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  // CORS pre-flight.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (!SECRET) {
    return new Response('SCHEDULE_ICAL_SECRET is not configured on the server — calendar feeds are disabled until it is set', { status: 500 });
  }

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get('sid');
  const userId = url.searchParams.get('uid');
  const token = url.searchParams.get('t');

  if (!scheduleId || !userId || !token) {
    return new Response('Missing params (sid, uid, t required)', { status: 400 });
  }

  const expected = await signToken(scheduleId, userId);
  if (!constantTimeEq(expected, token)) {
    return new Response('Bad token', { status: 401 });
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: project, error } = await supa
    .from('projects')
    .select('id, name, schedule, user_id')
    .eq('id', scheduleId)
    .maybeSingle();

  if (error || !project) {
    return new Response('Not found', { status: 404 });
  }

  // Defense in depth (SECURITY). The mint endpoint (schedule-ical-url) now
  // verifies ownership before signing, but a token minted under the OLD code
  // (attacker's uid + victim's project) would still validate the HMAC. Confirm
  // the uid in the token actually owns the project before serving the feed —
  // this retroactively invalidates any such tokens.
  if (project.user_id !== userId) {
    return new Response('Forbidden', { status: 403 });
  }

  // Dates: every task is an all-day event on its WORKING days — see
  // ./icsEvents.ts for why (startDay is a working ordinal; the old
  // `projectStart + startDay * 86400000` was a day late, ignored weekends and
  // emitted the previous evening in US zones). No start date ⇒ no task events.
  const events = buildScheduleIcalEvents(project.id, project.schedule as IcalSchedule | null, new Date());

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MAGE ID//Pro Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(project.name)} schedule`,
    'X-WR-TIMEZONE:UTC',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
