// homeowner-weekly-digest
//
// Plain-English Friday recap that goes to each homeowner whose project
// has the client portal enabled with weekly_digest.enabled = true.
//
// Why it exists: Procore / Buildertrend portals dump raw construction
// jargon at the homeowner ("framing inspection passed, shear walls
// nailed off"). The homeowner has no idea what's happening. This digest
// translates: "We finished the rough framing this week. The city
// inspector signed off Tuesday. Next week we move into electrical
// rough-in — expect more workers in the house, fewer hammers."
//
// Trigger modes:
//   POST { projectId, preview: true }
//     One-off — used by the GC's "Send preview" button in client-portal-setup.
//   POST { all: true }
//     Cron mode — pg_cron fires every Friday at 16:00 UTC. The function
//     fans out across all projects whose clientPortal.weeklyDigest.enabled
//     is true, sending to each portal invite email.
//
// Secrets:
//   SUPABASE_SERVICE_ROLE_KEY  required
//   RESEND_API_KEY             required for email delivery
//   GEMINI_API_KEY             optional — when present, AI rewrites the
//                              digest in homeowner voice; otherwise we
//                              fall back to a deterministic template.

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Shared email helpers — same shell used by every transactional email
// the app sends so this digest matches sub-portal invites, contract
// sends, payment receipts, COI warnings, and the morning brief.
import { wrapEmailHtml, resendSend, isEmailUnsubscribed } from '../_shared/email.ts';
import { isValidCron } from '../_shared/cronAuth.ts';
import { verifyUser } from '../_shared/verifyUser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

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

// ── Brand palette (match auth-magic-link / morning-digest) ──────────
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

// ── Types (server-side mirror of types/index.ts; trimmed) ───────────
interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  location?: string;
  client_portal?: {
    enabled?: boolean;
    invites?: Array<{ email?: string; name?: string }>;
    weeklyDigest?: { enabled?: boolean; lastSentAt?: string };
  } | null;
  schedule?: {
    tasks?: Array<{ id: string; title: string; phase?: string; progress?: number; status?: string; isMilestone?: boolean }>;
  } | null;
}

interface ProfileRow {
  id: string;
  email: string;
  name?: string;
  company_name?: string;
  contact_name?: string;
}

interface DfrRow {
  id: string;
  project_id: string;
  date: string;
  work_performed?: string;
  manpower?: { headcount?: number; trade?: string }[];
}

interface PhotoRow {
  id: string;
  project_id: string;
  uri?: string;
  created_at?: string;
}

interface ChangeOrderRow {
  /** The DB column is change_amount; `amount` never existed. */
  change_amount?: number;
  id: string;
  project_id: string;
  description?: string;
  status?: string;
  created_at?: string;
}

// ── Build a deterministic fallback summary if Gemini isn't available ──
// The template digests the raw counts into homeowner-friendly sentences
// without any AI. Less polished than the LLM path but works offline /
// without GEMINI_API_KEY set.
function buildTemplateSummary(
  project: ProjectRow,
  dfrs: DfrRow[],
  photos: PhotoRow[],
  cos: ChangeOrderRow[],
): { headline: string; bullets: string[] } {
  const totalCrew = dfrs.reduce(
    (sum, r) => sum + (r.manpower ?? []).reduce((s, m) => s + (m.headcount ?? 0), 0),
    0,
  );
  const tradeSet = new Set<string>();
  for (const r of dfrs) for (const m of r.manpower ?? []) if (m.trade) tradeSet.add(m.trade);
  const trades = Array.from(tradeSet);
  const completedTasks = (project.schedule?.tasks ?? []).filter(t => t.status === 'done' || t.progress === 100);
  const milestones = completedTasks.filter(t => t.isMilestone);

  const bullets: string[] = [];
  if (dfrs.length > 0) {
    bullets.push(`Workers were on site ${dfrs.length} day${dfrs.length === 1 ? '' : 's'} this week${totalCrew > 0 ? `, with ${totalCrew} total crew-day${totalCrew === 1 ? '' : 's'}` : ''}.`);
  }
  if (trades.length > 0) {
    bullets.push(`Trades on site: ${trades.slice(0, 5).join(', ')}.`);
  }
  if (milestones.length > 0) {
    bullets.push(`Milestone${milestones.length === 1 ? '' : 's'} reached: ${milestones.slice(0, 3).map(m => m.title).join(', ')}.`);
  }
  if (photos.length > 0) {
    bullets.push(`${photos.length} photo${photos.length === 1 ? '' : 's'} added — see them in your portal.`);
  }
  if (cos.length > 0) {
    const total = cos.reduce((s, c) => s + (c.change_amount ?? 0), 0);
    const sign = total >= 0 ? '+' : '−';
    bullets.push(`${cos.length} change order${cos.length === 1 ? '' : 's'} this week (net ${sign}$${Math.abs(total).toLocaleString()}). Check the portal for details.`);
  }
  if (bullets.length === 0) {
    bullets.push('A quiet week on this project — no major activity to report. Let us know if you have questions.');
  }
  const headline = `Week in review — ${project.name}`;
  return { headline, bullets };
}

// ── Gemini path: rewrite the same data in homeowner voice ──────────
async function buildAISummary(
  project: ProjectRow,
  dfrs: DfrRow[],
  photos: PhotoRow[],
  cos: ChangeOrderRow[],
): Promise<{ headline: string; paragraph: string; bullets: string[] } | null> {
  if (!GEMINI_API_KEY) return null;

  const dfrLines = dfrs
    .filter(r => (r.work_performed ?? '').trim())
    .slice(0, 7)
    .map(r => `- ${r.date}: ${r.work_performed ?? ''}`)
    .join('\n');
  const completedTasks = (project.schedule?.tasks ?? [])
    .filter(t => t.status === 'done' || t.progress === 100)
    .map(t => `- ${t.title}${t.phase ? ` (${t.phase})` : ''}`)
    .join('\n');
  const cosLine = cos.length > 0
    ? `${cos.length} change orders this week, net total $${cos.reduce((s, c) => s + (c.change_amount ?? 0), 0).toLocaleString()}`
    : 'no change orders';

  const prompt = `You are a residential general contractor writing a Friday afternoon update to a homeowner about their project. The homeowner is NOT a contractor — write in plain everyday English. No CSI section numbers, no trade jargon, no abbreviations.

Project: ${project.name}
Location: ${project.location ?? 'not specified'}

This week's daily field reports:
${dfrLines || '(no detailed reports this week)'}

Completed tasks (cumulative):
${completedTasks || '(none yet)'}

Photos added: ${photos.length}
Change orders: ${cosLine}

Write a JSON response with:
  - headline: short reassuring title (≤70 chars), e.g. "Drywall is up — kitchen takes shape"
  - paragraph: 2-3 sentences in conversational English — what got done this week, what it means in plain terms, and what's coming next week. NO contractor jargon.
  - bullets: 3-5 short items (≤80 chars each) the homeowner will scan. Concrete, observable things.

Tone: confident, calm, friendly. Not salesy, not patronizing. Match the way a contractor texts an interested homeowner.

Return JSON only, no preamble.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 800,
          },
        }),
      },
    );
    if (!res.ok) return null;
    const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { headline?: string; paragraph?: string; bullets?: unknown };
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.map(String).slice(0, 6) : [];
    return {
      headline: String(parsed.headline ?? `Week in review — ${project.name}`).slice(0, 100),
      paragraph: String(parsed.paragraph ?? '').slice(0, 800),
      bullets,
    };
  } catch (err) {
    console.warn('[homeowner-weekly-digest] gemini failed', err);
    return null;
  }
}

// ── HTML email composer ────────────────────────────────────────────
// Uses the canonical wrapEmailHtml shell so this digest matches every
// other transactional email — header, footer, unsubscribe, plaintext
// fallback all live in one place.
function buildEmailHtml(opts: {
  companyName: string;
  homeownerName?: string;
  projectName: string;
  projectLocation?: string;
  headline: string;
  paragraph?: string;
  bullets: string[];
  portalUrl?: string;
  weekRange: string;
  recipientEmail?: string;
  senderEmail?: string;
}): string {
  const greetingFirst = opts.homeownerName?.split(' ')[0] || 'there';
  const bulletItems = opts.bullets.length > 0
    ? `<ul style="margin:0 0 18px 0;padding:0 0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#4A5159;">
         ${opts.bullets.map(b => `<li style="margin-bottom:6px;">${escapeHtml(b)}</li>`).join('')}
       </ul>`
    : '';
  const paragraph = opts.paragraph
    ? `<p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#4A5159;">${escapeHtml(opts.paragraph)}</p>`
    : '';

  return wrapEmailHtml({
    preheader: `${opts.companyName} — week-in-review for ${opts.projectName} (${opts.weekRange})`,
    eyebrow: `Weekly update · ${opts.weekRange}`,
    title: opts.headline,
    subtitle: `Hi ${greetingFirst}, here's how the week went.`,
    bodyHtml: `${paragraph}${bulletItems}`,
    cta: opts.portalUrl ? { label: 'View your portal', href: opts.portalUrl } : undefined,
    companyName: opts.companyName,
    project: { name: opts.projectName, location: opts.projectLocation },
    sender: opts.senderEmail ? { email: opts.senderEmail } : undefined,
    unsubscribe: {
      recipientEmail: opts.recipientEmail,
      eventKey: 'weekly_digest',
      enabled: true,
    },
  });
}

// ── Resend send (plain — no attachments) ───────────────────────────
// Routes through the shared resendSend → retry-with-backoff on 429,
// auto-plaintext fallback, List-Unsubscribe headers (Gmail bulk-sender
// compliance). Keeps this function aligned with every other email path.
async function sendEmail(opts: { to: string; subject: string; html: string; fromCompanyName?: string; replyTo?: string; eventKey?: string }) {
  if (!RESEND_API_KEY) {
    console.warn('[homeowner-weekly-digest] RESEND_API_KEY not set');
    return { ok: false, error: 'no_resend_key' };
  }
  const result = await resendSend(RESEND_API_KEY, {
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    fromCompanyName: opts.fromCompanyName,
    replyTo: opts.replyTo,
    unsubscribe: {
      recipientEmail: opts.to,
      eventKey: opts.eventKey ?? 'weekly_digest',
      enabled: true,
    },
  });
  if (!result.ok) {
    return { ok: false, error: JSON.stringify(result.resp).slice(0, 200) };
  }
  return { ok: true };
}

// ── Pull a project's last-7-days data ──────────────────────────────
async function fetchWeekDataForProject(client: SupabaseClient, projectId: string): Promise<{
  dfrs: DfrRow[];
  photos: PhotoRow[];
  cos: ChangeOrderRow[];
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayDate = new Date().toISOString().slice(0, 10);
  const sevenDaysAgoDate = sevenDaysAgo.slice(0, 10);

  // DFRs use a date column (yyyy-mm-dd) not timestamps.
  const dfrsRes = await client
    .from('daily_reports')
    .select('id,project_id,date,work_performed,manpower')
    .eq('project_id', projectId)
    .gte('date', sevenDaysAgoDate)
    .lte('date', todayDate)
    .order('date', { ascending: false });
  const dfrs = (dfrsRes.data ?? []) as DfrRow[];

  // 'project_photos' DOES NOT EXIST — the table is 'photos', and it has no
  // storage_url column either (verified against production). PostgREST 404s the
  // table and 400s the column, so photosRes.data was always null and the
  // `?? []` below turned that into "no photos this week" — every single week.
  // The homeowner's weekly digest reported an empty site for a job that was
  // being photographed daily.
  const photosRes = await client
    .from('photos')
    .select('id,project_id,uri,created_at')
    .eq('project_id', projectId)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });
  const photos = (photosRes.data ?? []) as PhotoRow[];

  // change_orders has change_amount, NOT amount (verified against production).
  // Same silent shape: a 400 on the unknown column became "no change orders".
  const cosRes = await client
    .from('change_orders')
    .select('id,project_id,description,change_amount,status,created_at')
    .eq('project_id', projectId)
    .gte('created_at', sevenDaysAgo);
  const cos = (cosRes.data ?? []) as ChangeOrderRow[];

  return { dfrs, photos, cos };
}

// ── Compose + send for one (project, recipient) pair ───────────────
async function sendForProject(
  client: SupabaseClient,
  project: ProjectRow,
  ownerProfile: ProfileRow | null,
  isPreview: boolean,
): Promise<{ sent: number; errors: string[] }> {
  const portal = project.client_portal;
  const invites = (portal?.invites ?? []).filter(i => (i.email ?? '').includes('@'));
  if (invites.length === 0) return { sent: 0, errors: ['no_invites'] };

  const { dfrs, photos, cos } = await fetchWeekDataForProject(client, project.id);

  // Try the AI path first; deterministic template as fallback.
  const ai = await buildAISummary(project, dfrs, photos, cos);
  const template = buildTemplateSummary(project, dfrs, photos, cos);
  const headline = ai?.headline ?? template.headline;
  const bullets = (ai?.bullets && ai.bullets.length > 0) ? ai.bullets : template.bullets;
  const paragraph = ai?.paragraph;

  const companyName = ownerProfile?.company_name || ownerProfile?.contact_name || 'MAGE ID';
  const portalUrl = portal?.enabled
    ? `https://mageid.app/portal/${project.id}`
    : undefined;

  const today = new Date();
  const weekStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  let sent = 0;
  const errors: string[] = [];
  for (const invite of invites) {
    // Pre-send suppression: skip an invite that unsubscribed from the
    // weekly digest (or globally). 'continue' does not increment `sent`,
    // so weeklyDigest.lastSentAt (stamped only when sent > 0) is not
    // advanced if ALL invites are suppressed — nothing is lost.
    if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, invite.email, 'weekly_digest')) {
      console.log('[homeowner-weekly-digest] recipient unsubscribed — skipping', project.id, invite.email);
      continue;
    }
    const html = buildEmailHtml({
      companyName,
      homeownerName: invite.name,
      projectName: project.name,
      projectLocation: project.location,
      headline,
      paragraph,
      bullets,
      portalUrl,
      weekRange,
      recipientEmail: invite.email,
      senderEmail: ownerProfile?.email,
    });
    const result = await sendEmail({
      to: invite.email!,
      subject: `${project.name} — week in review`,
      html,
      fromCompanyName: companyName,
      replyTo: ownerProfile?.email,
    });
    if (result.ok) {
      sent += 1;
    } else {
      errors.push(`${invite.email}: ${result.error}`);
    }
  }

  // Stamp the project's clientPortal.weeklyDigest.lastSentAt so we
  // don't double-send if cron retries. Preview sends (the GC's "Send
  // preview" button) must NOT stamp — otherwise a preview would advance
  // lastSentAt and silently suppress that project's next scheduled
  // Friday cron send. Only real cron sends stamp.
  if (!isPreview && sent > 0 && portal) {
    const updatedPortal = {
      ...portal,
      weeklyDigest: { ...(portal.weeklyDigest ?? {}), enabled: true, lastSentAt: new Date().toISOString() },
    };
    await client
      .from('projects')
      .update({ client_portal: updatedPortal })
      .eq('id', project.id);
  }

  return { sent, errors };
}

// ── Entry point ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  // Auth: cron (shared secret) OR a genuine authenticated user JWT. Capture the
  // caller identity — the projectId branch below enforces per-project ownership
  // so a signed-in GC can only trigger a digest for a project they own.
  const isCron = await isValidCron(req);
  const caller = isCron ? null : await verifyUser(req);
  if (!isCron && !caller) return jsonResponse({ success: false, error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);

  let body: { projectId?: string; preview?: boolean; all?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Single-project preview ───────────────────────────────────────
  if (body.projectId) {
    const projRes = await client
      .from('projects')
      .select('id,user_id,name,status,location,client_portal,schedule')
      .eq('id', body.projectId)
      .maybeSingle();
    if (projRes.error || !projRes.data) {
      return jsonResponse({ success: false, error: 'project not found' }, 404);
    }
    const project = projRes.data as ProjectRow;
    // Broken-access-control guard: projectIds are exposed in portal links, so a
    // signed-in caller must own the project to trigger its homeowner digest.
    // Cron (isCron) fans out across all projects and is exempt.
    if (!isCron && project.user_id !== caller?.id) {
      return jsonResponse({ success: false, error: 'forbidden' }, 403);
    }
    let ownerProfile: ProfileRow | null = null;
    if (project.user_id) {
      const profRes = await client
        .from('profiles')
        .select('id,email,name,company_name,contact_name')
        .eq('id', project.user_id)
        .maybeSingle();
      ownerProfile = (profRes.data as ProfileRow | null) ?? null;
    }
    const result = await sendForProject(client, project, ownerProfile, true);
    return jsonResponse({
      success: true,
      mode: 'preview',
      sent: result.sent,
      errors: result.errors,
    });
  }

  // ── Cron mode: all projects with weekly_digest.enabled = true ────
  if (body.all) {
    // Cron-only fan-out. Without this gate a signed-in GC could POST
    // { all: true } and blast a digest to every project's homeowner, not
    // just their own. The per-project ownership check above doesn't run in
    // this branch, so gate the whole branch on cron.
    if (!isCron) return jsonResponse({ success: false, error: 'forbidden' }, 403);
    // Fetch every project whose JSONB client_portal claims weekly digest
    // is on. We use the JSONB containment operator via filter.
    const projectsRes = await client
      .from('projects')
      .select('id,user_id,name,status,location,client_portal,schedule')
      .filter('client_portal->weeklyDigest->>enabled', 'eq', 'true');
    if (projectsRes.error) {
      console.warn('[homeowner-weekly-digest] projects query failed', projectsRes.error);
      return jsonResponse({ success: false, error: projectsRes.error.message }, 500);
    }
    const projects = (projectsRes.data ?? []) as ProjectRow[];

    // Bulk-fetch profiles for all the user_ids we'll touch.
    const ownerIds = Array.from(new Set(projects.map(p => p.user_id).filter(Boolean)));
    let profilesById = new Map<string, ProfileRow>();
    if (ownerIds.length > 0) {
      const profRes = await client
        .from('profiles')
        .select('id,email,name,company_name,contact_name')
        .in('id', ownerIds);
      for (const p of (profRes.data ?? []) as ProfileRow[]) profilesById.set(p.id, p);
    }

    let totalSent = 0;
    const projectErrors: Array<{ projectId: string; errors: string[] }> = [];
    for (const project of projects) {
      // Skip if we already sent this week (lastSentAt within 6 days).
      const last = project.client_portal?.weeklyDigest?.lastSentAt;
      if (last) {
        const ageMs = Date.now() - new Date(last).getTime();
        if (Number.isFinite(ageMs) && ageMs < 6 * 24 * 60 * 60 * 1000) {
          continue;
        }
      }
      const owner = profilesById.get(project.user_id ?? '') ?? null;
      const result = await sendForProject(client, project, owner, false);
      totalSent += result.sent;
      if (result.errors.length > 0) projectErrors.push({ projectId: project.id, errors: result.errors });
    }

    return jsonResponse({
      success: true,
      mode: 'cron',
      projectsConsidered: projects.length,
      totalSent,
      projectErrors,
    });
  }

  return jsonResponse({ success: false, error: 'must include projectId or all:true' }, 400);
});
