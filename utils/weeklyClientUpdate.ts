import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto, RFI,
} from '@/types';
import { mageAI } from './mageAI';

// ──────────────────────────────────────────────────────────────────────────────
// AI-drafted weekly owner update.
// The GC pushes one button → Gemini drafts a friendly, plain-English email
// summarizing the last 7 days. The GC edits, then sends via native mail.
// This is the recurring touchpoint competitors charge hundreds/month for.
// ──────────────────────────────────────────────────────────────────────────────

export interface WeeklyUpdateContext {
  project: Project;
  dailyReports: DailyFieldReport[];      // last 7 days
  photos: ProjectPhoto[];                // last 7 days
  changeOrders: ChangeOrder[];           // last 7 days' activity
  invoices: Invoice[];                   // any invoice changed in last 7 days
  punchItems: PunchItem[];               // currently open
  rfis: RFI[];                           // open RFIs
  weekEndingISO: string;                 // ISO date the week ends
}

export interface WeeklyUpdateDraft {
  subject: string;
  greeting: string;        // "Hi Sarah,"
  summary: string;         // 2-3 sentence top-line
  accomplishments: string[];  // bullets of what got done
  upcoming: string[];      // bullets of what's next
  issues: string[];        // concerns / delays / weather, can be empty
  financial: string;       // one-paragraph money summary
  closing: string;         // "Let me know if you have questions."
  signatureName: string;
}

// Narrow the raw data down to what fits in a prompt.
function compressContext(ctx: WeeklyUpdateContext, gcName: string, ownerName: string) {
  const dfrSummary = ctx.dailyReports.slice(0, 7).map(d => {
    const manpower = d.manpower ?? [];
    const crewSize = manpower.reduce((s, m) => s + (m.headcount ?? 0), 0);
    const hoursWorked = manpower.reduce((s, m) => s + (m.hoursWorked ?? 0) * (m.headcount ?? 1), 0);
    return {
      date: d.date,
      weather: (d.weather as any)?.conditions ?? '',
      tempHigh: (d.weather as any)?.tempHigh ?? null,
      crewSize,
      hoursWorked,
      work: (d.workPerformed ?? '').slice(0, 280),
      issues: (d.issuesAndDelays ?? '').slice(0, 200),
    };
  });

  const coSummary = ctx.changeOrders.map(c => ({
    number: c.number,
    status: c.status,
    amount: c.changeAmount,
    description: c.description.slice(0, 140),
    scheduleDays: c.scheduleImpactDays ?? 0,
  }));

  const invSummary = ctx.invoices.map(i => ({
    number: i.number,
    status: i.status,
    totalDue: i.totalDue,
    amountPaid: i.amountPaid,
    balance: i.totalDue - i.amountPaid,
  }));

  const openPunch = ctx.punchItems.filter(p => p.status !== 'closed').length;
  const openRfis = ctx.rfis.filter(r => r.status !== 'answered' && r.status !== 'closed').length;

  return {
    projectName: ctx.project.name,
    location: ctx.project.location,
    weekEnding: ctx.weekEndingISO.slice(0, 10),
    gcName,
    ownerName,
    dailyReports: dfrSummary,
    changeOrders: coSummary,
    invoices: invSummary,
    photoCount: ctx.photos.length,
    openPunchItemCount: openPunch,
    openRFICount: openRfis,
  };
}

const DRAFT_SCHEMA_HINT = {
  subject: 'string',
  greeting: 'string',
  summary: 'string',
  accomplishments: ['string'],
  upcoming: ['string'],
  issues: ['string'],
  financial: 'string',
  closing: 'string',
  signatureName: 'string',
};

/**
 * Ask the model to draft a weekly owner update. Returns a structured draft
 * the GC can review and edit before sending.
 */
export async function draftWeeklyUpdate(
  ctx: WeeklyUpdateContext,
  gcName: string,
  ownerName: string,
): Promise<{ success: boolean; draft: WeeklyUpdateDraft | null; error?: string }> {
  const compact = compressContext(ctx, gcName, ownerName);

  const prompt = `You are drafting a warm, plain-English weekly progress update from a general contractor to their client/owner. Tone: professional but friendly, confident, no jargon. Short sentences. Do not invent facts — only reference what's in the data below.

DATA:
${JSON.stringify(compact, null, 2)}

Write a weekly update email with these sections:
- subject: concise, includes project name and week-ending date, e.g. "Weekly update — ${compact.projectName} — week of ${compact.weekEnding}"
- greeting: "Hi [first name]," using the owner name provided
- summary: 2-3 sentences, top-line "here's where we stand"
- accomplishments: 3-6 bullets, each one concrete thing completed this week, pulled from daily reports
- upcoming: 2-4 bullets, what's planned next week (infer from work cadence if not explicit)
- issues: 0-3 bullets of concerns, delays, weather impact — empty array if genuinely nothing to flag
- financial: one short paragraph on change orders approved this week, invoices issued/paid, total CO impact on contract; omit numbers if nothing changed
- closing: one friendly sentence inviting questions
- signatureName: the GC's name

Keep each bullet under 20 words. Do not hallucinate line items that aren't in the data. If a section has no real content, still include it (empty issues array is fine, but accomplishments should be non-empty).`;

  const res = await mageAI({
    prompt,
    schemaHint: DRAFT_SCHEMA_HINT,
    tier: 'smart',
    maxTokens: 2000,
  });

  if (!res.success || !res.data) {
    return { success: false, draft: null, error: res.error ?? 'AI draft failed' };
  }
  const d = res.data as WeeklyUpdateDraft;
  // Defensive shape check
  const draft: WeeklyUpdateDraft = {
    subject: String(d.subject ?? `Weekly update — ${compact.projectName}`),
    greeting: String(d.greeting ?? `Hi ${ownerName.split(' ')[0] || 'there'},`),
    summary: String(d.summary ?? ''),
    accomplishments: Array.isArray(d.accomplishments) ? d.accomplishments.map(String) : [],
    upcoming: Array.isArray(d.upcoming) ? d.upcoming.map(String) : [],
    issues: Array.isArray(d.issues) ? d.issues.map(String) : [],
    financial: String(d.financial ?? ''),
    closing: String(d.closing ?? 'Let me know if you have any questions.'),
    signatureName: String(d.signatureName ?? gcName),
  };
  return { success: true, draft };
}

/**
 * Render the structured draft back into a plain-text email body ready to send.
 */
export function renderDraftToPlainText(draft: WeeklyUpdateDraft): string {
  const lines: string[] = [];
  lines.push(draft.greeting);
  lines.push('');
  lines.push(draft.summary);
  lines.push('');
  if (draft.accomplishments.length) {
    lines.push('This week we:');
    draft.accomplishments.forEach(a => lines.push(`• ${a}`));
    lines.push('');
  }
  if (draft.upcoming.length) {
    lines.push('Coming up:');
    draft.upcoming.forEach(u => lines.push(`• ${u}`));
    lines.push('');
  }
  if (draft.issues.length) {
    lines.push('Heads up:');
    draft.issues.forEach(i => lines.push(`• ${i}`));
    lines.push('');
  }
  if (draft.financial && draft.financial.trim()) {
    lines.push(draft.financial.trim());
    lines.push('');
  }
  lines.push(draft.closing);
  lines.push('');
  lines.push('— ' + draft.signatureName);
  return lines.join('\n');
}

/**
 * Render to HTML for nicer email clients.
 */
export function renderDraftToHtml(draft: WeeklyUpdateDraft): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const section = (title: string, items: string[]) => {
    if (!items.length) return '';
    return `<p style="margin:16px 0 6px 0;font-weight:600;">${esc(title)}</p>
      <ul style="margin:0;padding-left:18px;line-height:1.5;">
        ${items.map(i => `<li>${esc(i)}</li>`).join('')}
      </ul>`;
  };

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;line-height:1.5;color:#111;">
    <p>${esc(draft.greeting)}</p>
    <p>${esc(draft.summary)}</p>
    ${section('This week we:', draft.accomplishments)}
    ${section('Coming up:', draft.upcoming)}
    ${section('Heads up:', draft.issues)}
    ${draft.financial ? `<p style="margin-top:16px;">${esc(draft.financial)}</p>` : ''}
    <p style="margin-top:20px;">${esc(draft.closing)}</p>
    <p style="margin-top:20px;">— ${esc(draft.signatureName)}</p>
  </div>`;
}

/**
 * Filter raw data down to the last N days for a single project.
 */
export function gatherWeeklyContext(
  project: Project,
  allDailyReports: DailyFieldReport[],
  allPhotos: ProjectPhoto[],
  allChangeOrders: ChangeOrder[],
  allInvoices: Invoice[],
  allPunchItems: PunchItem[],
  allRfis: RFI[],
  days: number = 7,
): WeeklyUpdateContext {
  const cutoff = Date.now() - days * 86400 * 1000;
  const since = (iso: string | undefined) => iso ? new Date(iso).getTime() >= cutoff : false;

  return {
    project,
    dailyReports: allDailyReports
      .filter(d => d.projectId === project.id && since(d.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    photos: allPhotos
      .filter(p => p.projectId === project.id && since(p.timestamp)),
    changeOrders: allChangeOrders
      .filter(c => c.projectId === project.id && (since(c.updatedAt) || since(c.createdAt))),
    invoices: allInvoices
      .filter(i => i.projectId === project.id && (since(i.updatedAt) || since(i.issueDate))),
    punchItems: allPunchItems
      .filter(p => p.projectId === project.id),
    rfis: allRfis
      .filter(r => r.projectId === project.id),
    weekEndingISO: new Date().toISOString(),
  };
}
