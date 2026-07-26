// morning-digest
//
// Builds and delivers a per-user morning briefing combining:
//   • Today's schedule tasks (from project.schedule.tasks)
//   • Yesterday's DFRs (work progress chips, manpower totals, issues)
//   • Open RFIs assigned to the user
//   • Hyperlocal weather using project.location_latitude/longitude
//   • Submittal / sub-portal-link / notification-outbox deltas (placeholder)
//
// Replaces the email firehose competitors generate (Procore, Buildertrend
// "phone kept buzzing all day"). One digest at the user's preferred time
// instead of 40 individual notifications.
//
// Trigger modes:
//   • POST { userId } — fire for one user (used for "preview today's
//     digest" button in Settings).
//   • POST { all: true } — fire for all users whose preferred-hour window
//     is now (used by the pg_cron scheduled task that runs every 30 min).
//
// Delivery:
//   • Email via Resend (branded like the magic-link email)
//   • notification_outbox row (in-app inbox)
//
// Secrets:
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   OPENWEATHER_API_KEY  (optional — we render the digest without weather
//                         if absent or per-project coords are missing)
//   GEMINI_API_KEY       (optional — used to humanise the briefing copy
//                         when present; falls back to a deterministic
//                         template otherwise)

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Shared email helpers — same shell every transactional email uses so
// the morning digest matches sub-portal invites, contract sends, payment
// receipts, COI warnings, and the homeowner weekly digest.
import { wrapEmailHtml, resendSend } from '../_shared/email.ts';
import { isValidCron } from '../_shared/cronAuth.ts';
import { verifyUser } from '../_shared/verifyUser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const OPENWEATHER_API_KEY = Deno.env.get('OPENWEATHER_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// ── Brand palette (mirrors auth-magic-link & _shared/email.ts) ───────
const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';
const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

function escapeHtml(text: unknown): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Types (server-side mirror of types/index.ts; trimmed to fields we read) ─
interface SchedTask {
  id: string;
  title: string;
  phase?: string;
  startDay: number;
  durationDays: number;
  progress?: number;
  status?: string;
  isCriticalPath?: boolean;
  isWeatherSensitive?: boolean;
  crew?: string;
  assignedSubName?: string;
}
interface ProjectRow {
  id: string;
  name: string;
  status: string;
  location?: string;
  location_latitude?: number | null;
  location_longitude?: number | null;
  schedule?: { tasks?: SchedTask[]; startDate?: string } | null;
}
interface ProfileRow {
  id: string;
  email: string;
  name?: string;
  digest_enabled?: boolean;
  digest_hour?: number | null;
  digest_channels?: { email?: boolean; in_app?: boolean } | null;
  digest_timezone?: string | null;
  push_token?: string | null;
}
interface DfrRow {
  id: string;
  project_id: string;
  date: string;
  work_performed?: string;
  manpower?: { headcount?: number; trade?: string }[];
  issues_and_delays?: string;
  // workProgress lives client-side until the migration; not read here.
}

// ── Weather fetch (one call per project's coords) ────────────────────
interface WeatherToday {
  tempHighF?: number;
  tempLowF?: number;
  conditions?: string;
  precipPct?: number;
  windMph?: number;
  workable: boolean;
}
async function fetchTodayWeather(lat: number, lng: number): Promise<WeatherToday | null> {
  if (!OPENWEATHER_API_KEY) return null;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { list?: Array<{ main?: { temp?: number; temp_max?: number; temp_min?: number }; weather?: Array<{ main?: string }>; pop?: number; wind?: { speed?: number } }> };
    if (!data.list || data.list.length === 0) return null;
    // OpenWeather returns 3hr buckets — first 8 buckets ≈ next 24 hours.
    const buckets = data.list.slice(0, 8);
    const high = Math.max(...buckets.map(b => b.main?.temp_max ?? b.main?.temp ?? 0));
    const low = Math.min(...buckets.map(b => b.main?.temp_min ?? b.main?.temp ?? 0));
    const conditions = buckets[0]?.weather?.[0]?.main ?? 'Clear';
    const precipPct = Math.round(Math.max(...buckets.map(b => b.pop ?? 0)) * 100);
    const windMph = Math.round(Math.max(...buckets.map(b => b.wind?.speed ?? 0)));
    const workable = !/Rain|Snow|Thunderstorm|Hail/i.test(conditions) && precipPct < 60 && windMph < 25;
    return { tempHighF: Math.round(high), tempLowF: Math.round(low), conditions, precipPct, windMph, workable };
  } catch {
    return null;
  }
}

// ── Per-project briefing (one block per active project) ──────────────
interface ProjectBriefing {
  projectId: string;
  name: string;
  todayTasks: SchedTask[];
  criticalCount: number;
  weather: WeatherToday | null;
  weatherRiskTasks: string[];   // titles of weather-sensitive tasks today
  yesterdayDfr: DfrRow | null;
  totalManpowerYesterday: number;
}

function buildProjectBriefing(
  project: ProjectRow,
  yesterdayDfrs: DfrRow[],
  weather: WeatherToday | null,
): ProjectBriefing {
  const tasks = project.schedule?.tasks ?? [];
  const startDate = project.schedule?.startDate;
  let todayDay = 0;
  if (startDate) {
    const startMs = Date.parse(startDate);
    if (Number.isFinite(startMs)) {
      todayDay = Math.floor((Date.now() - startMs) / 86_400_000) + 1;
    }
  }
  const todayTasks = tasks.filter(t => {
    const start = t.startDay;
    const end = t.startDay + Math.max(0, t.durationDays - 1);
    return todayDay >= start && todayDay <= end && (t.status ?? 'not_started') !== 'completed';
  });
  const criticalCount = todayTasks.filter(t => t.isCriticalPath).length;
  const weatherRiskTasks = weather && !weather.workable
    ? todayTasks.filter(t => t.isWeatherSensitive).map(t => t.title)
    : [];
  const yesterdayDfr = [...yesterdayDfrs]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .find(d => d.project_id === project.id) ?? null;
  const totalManpowerYesterday = (yesterdayDfr?.manpower ?? []).reduce(
    (sum, m) => sum + (m.headcount ?? 0), 0,
  );
  return {
    projectId: project.id,
    name: project.name,
    todayTasks,
    criticalCount,
    weather,
    weatherRiskTasks,
    yesterdayDfr,
    totalManpowerYesterday,
  };
}

// ── HTML email composition ──────────────────────────────────────────
function renderDigestHtml(opts: {
  userName: string;
  todayDateLabel: string;
  briefings: ProjectBriefing[];
  openRfisCount: number;
}): string {
  const { userName, todayDateLabel, briefings, openRfisCount } = opts;

  const projectBlocks = briefings.length === 0
    ? `<p style="margin:0;color:${STONE};">No active projects today. Enjoy the quiet.</p>`
    : briefings.map(b => {
        const weatherLine = b.weather
          ? `<p style="margin:0 0 6px;color:${b.weather.workable ? STONE : '#B45309'};font-size:13px;">
               ${escapeHtml(b.weather.conditions ?? 'Weather')} · H${b.weather.tempHighF}° / L${b.weather.tempLowF}° · ${b.weather.precipPct}% precip · ${b.weather.windMph} mph wind
               ${b.weather.workable ? '' : ' · <strong>Not workable for weather-sensitive tasks</strong>'}
             </p>`
          : `<p style="margin:0 0 6px;color:${FOG};font-size:12px;font-style:italic;">No weather available — set the project address to enable hyperlocal forecasts.</p>`;
        const tasksLine = b.todayTasks.length === 0
          ? `<p style="margin:0;color:${FOG};font-size:13px;">Nothing scheduled today.</p>`
          : `<p style="margin:0 0 6px;color:${STONE};font-size:14px;line-height:1.5;">
               <strong style="color:${INK};">${b.todayTasks.length} task${b.todayTasks.length === 1 ? '' : 's'} today</strong>${b.criticalCount > 0 ? ` (${b.criticalCount} on critical path)` : ''}:
               ${b.todayTasks.slice(0, 4).map(t => `<br/>• ${escapeHtml(t.title)}${t.crew ? ` — <span style="color:${FOG};">${escapeHtml(t.crew)}</span>` : ''}`).join('')}
               ${b.todayTasks.length > 4 ? `<br/><span style="color:${FOG};">…and ${b.todayTasks.length - 4} more</span>` : ''}
             </p>`;
        const riskLine = b.weatherRiskTasks.length > 0
          ? `<p style="margin:6px 0 0;color:#B45309;font-size:13px;"><strong>Weather risk:</strong> ${b.weatherRiskTasks.slice(0, 3).map(escapeHtml).join(', ')}${b.weatherRiskTasks.length > 3 ? ' +more' : ''}</p>`
          : '';
        const dfrLine = b.yesterdayDfr
          ? `<p style="margin:6px 0 0;color:${FOG};font-size:12px;">Yesterday: ${b.totalManpowerYesterday} workers on site${b.yesterdayDfr.issues_and_delays ? ' · issues logged' : ''}</p>`
          : '';
        return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:${CREAM};border:1px solid ${SAND};border-radius:14px;">
            <tr><td style="padding:18px 22px;">
              <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${AMBER};letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(b.name)}</p>
              ${weatherLine}
              ${tasksLine}
              ${riskLine}
              ${dfrLine}
            </td></tr>
          </table>`;
      }).join('');

  const rfiLine = openRfisCount > 0
    ? `<p style="margin:0 0 16px;color:${STONE};font-size:14px;">You have <strong style="color:${INK};">${openRfisCount} open RFI${openRfisCount === 1 ? '' : 's'}</strong> waiting on a reply.</p>`
    : '';

  const greetingFirstName = userName ? userName.split(' ')[0] : '';

  return wrapEmailHtml({
    preheader: `${briefings.length} active project${briefings.length === 1 ? '' : 's'} · ${todayDateLabel}`,
    eyebrow: todayDateLabel,
    title: greetingFirstName ? `Good morning, ${greetingFirstName}.` : 'Good morning.',
    subtitle: "Here's what's on the boards today across your active projects.",
    bodyHtml: `${rfiLine}${projectBlocks}`,
    // No CTA — the digest is read-only context. User opens the app via
    // the in-app inbox row that lands at the same time.
    unsubscribe: { eventKey: 'daily_digest', enabled: true },
  });
}

// ── Push sender (copied from notify/index.ts — same Expo push contract) ──
async function sendPush(token: string, title: string, body: string, data?: Record<string, unknown>): Promise<{ ok: boolean; resp?: unknown }> {
  if (!token) return { ok: false };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (EXPO_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`;
    const r = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: token, title, body, data: data ?? {},
        sound: 'default', priority: 'high',
        badge: 1,
        _displayInForeground: true,
      }),
    });
    const resp = await r.json().catch(() => ({}));
    return { ok: r.ok, resp };
  } catch (e) {
    return { ok: false, resp: { error: String(e) } };
  }
}

async function sendDigestEmail(to: string, html: string, todayDateLabel: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  // Routes through resendSend → retry-with-backoff on 429, plaintext
  // fallback, List-Unsubscribe headers (Gmail bulk-sender compliance).
  const result = await resendSend(RESEND_API_KEY, {
    to,
    subject: `Morning briefing — ${todayDateLabel}`,
    html,
    unsubscribe: { recipientEmail: to, eventKey: 'daily_digest', enabled: true },
  });
  return result.ok;
}

async function buildDigestForUser(supabase: SupabaseClient, profile: ProfileRow): Promise<{ ok: boolean; sent: boolean; pushed?: boolean; reason?: string }> {
  const userId = profile.id;
  const channels = profile.digest_channels ?? { email: true, in_app: true };

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, status, location, location_latitude, location_longitude, schedule')
    .eq('user_id', userId)
    .eq('status', 'in_progress');
  const activeProjects = (projects ?? []) as ProjectRow[];

  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: dfrs } = await supabase
    .from('daily_reports')
    .select('id, project_id, date, work_performed, manpower, issues_and_delays')
    .eq('user_id', userId)
    .gte('date', yesterdayIso);
  const yesterdayDfrs = (dfrs ?? []) as DfrRow[];

  const { count: openRfisCount } = await supabase
    .from('rfis')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'open');

  // Fan out weather lookups in parallel — bounded concurrency by project count.
  const briefings: ProjectBriefing[] = [];
  for (const p of activeProjects) {
    const lat = p.location_latitude;
    const lng = p.location_longitude;
    const weather = (lat != null && lng != null) ? await fetchTodayWeather(lat, lng) : null;
    briefings.push(buildProjectBriefing(p, yesterdayDfrs, weather));
  }

  const todayDateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const html = renderDigestHtml({
    userName: profile.name ?? '',
    todayDateLabel,
    briefings,
    openRfisCount: openRfisCount ?? 0,
  });

  const totalTasksToday = briefings.reduce((sum, b) => sum + b.todayTasks.length, 0);
  const summary = briefings.length === 0
    ? 'No active projects today.'
    : `${briefings.length} project${briefings.length === 1 ? '' : 's'} active. ${totalTasksToday} task${totalTasksToday === 1 ? '' : 's'} today${(openRfisCount ?? 0) > 0 ? ` · ${openRfisCount} open RFI${openRfisCount === 1 ? '' : 's'}` : ''}.`;
  const title = `Morning briefing — ${todayDateLabel}`;

  let emailStatus: string | null = null;
  let sent = false;
  if (channels.email !== false && profile.email) {
    sent = await sendDigestEmail(profile.email, html, todayDateLabel);
    emailStatus = sent ? 'sent' : 'failed';
  }

  // Push: the phone-side doorbell. data.kind === 'morning_brief' lands the
  // tap on /brief via NotificationContext's kind switch. Rides the in_app
  // channel (it's the device surface — email is the durable copy).
  let pushStatus: string | null = null;
  let pushResp: unknown = null;
  if (channels.in_app !== false && profile.push_token) {
    const pushResult = await sendPush(profile.push_token, title, summary, { kind: 'morning_brief' });
    pushStatus = pushResult.ok ? 'sent' : 'failed';
    pushResp = pushResult.resp ?? null;
  }

  // In-app: write a row to notification_outbox so the inbox shows it.
  // FIXED: the previous insert used { user_id, kind, title, body } — none of
  // those columns exist on notification_outbox (schema: event_type,
  // recipient_kind, recipient_user_id, payload, …; cf. notify/index.ts), so
  // every insert silently failed and the digest never landed in-app. Insert
  // the real shape and LOG failures instead of discarding them.
  if (channels.in_app !== false) {
    const { error: outboxErr } = await supabase.from('notification_outbox').insert({
      event_type: 'morning_brief',
      recipient_kind: 'gc',
      recipient_user_id: userId,
      recipient_email: profile.email ?? null,
      push_token: profile.push_token ?? null,
      push_status: pushStatus,
      push_response: pushResp,
      email_status: emailStatus,
      payload: {
        title,
        body: summary,
        briefings: briefings.map(b => ({ projectId: b.projectId, name: b.name, todayCount: b.todayTasks.length, weatherWorkable: b.weather?.workable ?? null })),
      },
      delivered_at: (pushStatus === 'sent' || sent) ? new Date().toISOString() : null,
    });
    if (outboxErr) console.log('[morning-digest] outbox insert failed:', outboxErr.message);
  }

  return { ok: true, sent, pushed: pushStatus === 'sent' };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  // Auth: cron (shared secret) OR a genuine authenticated user JWT. Capture the
  // caller identity — the userId branch below enforces that a signed-in user may
  // only trigger their own digest.
  const isCron = await isValidCron(req);
  const caller = isCron ? null : await verifyUser(req);
  if (!isCron && !caller) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST' }, 405);

  let body: { userId?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON.' }, 400);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured.' }, 500);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (body.userId) {
    // A signed-in caller may only trigger their own digest; cron is exempt.
    if (!isCron && body.userId !== caller?.id) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }
    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, email, name, digest_enabled, digest_hour, digest_channels, digest_timezone, push_token')
      .eq('id', body.userId)
      .single();
    if (error || !profile) return jsonResponse({ error: 'User not found.' }, 404);
    const result = await buildDigestForUser(admin, profile as ProfileRow);
    return jsonResponse(result);
  }

  if (body.all) {
    // Cron-only fan-out. Without this gate a signed-in user could POST
    // { all: true } and trigger digests for every user, not just their own.
    // The per-user ownership check above doesn't run in this branch.
    if (!isCron) return jsonResponse({ error: 'forbidden' }, 403);
    // Cron path — fire for every user whose digest_hour matches the
    // current hour in their timezone. We don't try to be clever about
    // sub-hour scheduling; once-an-hour granularity is fine for a
    // briefing.
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, name, digest_enabled, digest_hour, digest_channels, digest_timezone, push_token')
      .eq('digest_enabled', true);

    const nowUtcHour = new Date().getUTCHours();
    const eligible: ProfileRow[] = (profiles ?? []).filter(p => {
      const targetHour = (p as ProfileRow).digest_hour ?? 6;
      const tz = (p as ProfileRow).digest_timezone ?? 'America/New_York';
      try {
        const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz });
        const localHour = parseInt(formatter.format(new Date()), 10);
        return localHour === targetHour;
      } catch {
        // Fallback: assume Eastern if the tz string is bad.
        return nowUtcHour - 5 === targetHour || nowUtcHour - 4 === targetHour;
      }
    }) as ProfileRow[];

    const results = await Promise.all(eligible.map(p => buildDigestForUser(admin, p).catch(e => ({ ok: false, sent: false, reason: String(e) }))));
    return jsonResponse({ ok: true, fired: results.length, results });
  }

  return jsonResponse({ error: 'Pass { userId } or { all: true }.' }, 400);
});
