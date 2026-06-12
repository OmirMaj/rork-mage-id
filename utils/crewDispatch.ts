// crewDispatch.ts — turn this week's committed tasks into per-crew "here's
// your work this week" messages. The field-facing half of the Last Planner
// loop: once the GC commits the weekly work plan, each sub/crew gets exactly
// their slice (email when on file, native share otherwise).
//
// Pure: grouping + message/HTML formatting only. The screen resolves sub
// contacts and does the I/O (sendEmail / Share). No competitor at this tier
// pushes the *committed* week to crews — Buildertrend emails the whole
// schedule to everyone; this is the opposite, opt-in and scoped.

export interface CommittedTaskInput {
  taskId: string;
  title: string;
  assignedSubId?: string;
  assignedSubName?: string;
  crew?: string;
  /** Optional human start label, e.g. "Tue, Jun 16". */
  startLabel?: string;
}

export interface CrewContact {
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface CrewDispatchGroup {
  /** Stable key (sub id / crew name / 'unassigned'). */
  key: string;
  name: string;
  email?: string;
  phone?: string;
  hasContact: boolean;
  tasks: { title: string; startLabel?: string }[];
}

/**
 * Group committed tasks by the crew responsible (assigned sub → free-text sub
 * name → crew lane → unassigned). `resolveSub` maps an assignedSubId to its
 * contact card. Contactable crews sort first; "Unassigned" sinks last.
 */
export function groupCommitmentsByCrew(
  committed: CommittedTaskInput[],
  resolveSub: (id: string) => CrewContact | null,
): CrewDispatchGroup[] {
  const groups = new Map<string, CrewDispatchGroup>();

  for (const c of committed) {
    let key: string;
    let name: string;
    let email: string | undefined;
    let phone: string | undefined;

    if (c.assignedSubId) {
      const sub = resolveSub(c.assignedSubId);
      key = `sub:${c.assignedSubId}`;
      name = sub?.companyName || sub?.contactName || c.assignedSubName || 'Subcontractor';
      email = sub?.email?.trim() || undefined;
      phone = sub?.phone?.trim() || undefined;
    } else if (c.assignedSubName?.trim()) {
      key = `subname:${c.assignedSubName.trim().toLowerCase()}`;
      name = c.assignedSubName.trim();
    } else if (c.crew?.trim()) {
      key = `crew:${c.crew.trim().toLowerCase()}`;
      name = c.crew.trim();
    } else {
      key = 'unassigned';
      name = 'Unassigned';
    }

    const g = groups.get(key) ?? { key, name, email, phone, hasContact: false, tasks: [] };
    if (!g.email && email) g.email = email;
    if (!g.phone && phone) g.phone = phone;
    g.hasContact = !!(g.email || g.phone);
    g.tasks.push({ title: c.title, startLabel: c.startLabel });
    groups.set(key, g);
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === 'unassigned') return 1;
    if (b.key === 'unassigned') return -1;
    return a.name.localeCompare(b.name);
  });
}

export interface DispatchContext {
  projectName: string;
  weekRange: string;
  gcName?: string;
}

/** Plain-text message for SMS / native share. */
export function buildCrewMessage(g: CrewDispatchGroup, ctx: DispatchContext): string {
  const greeting = g.name && g.key !== 'unassigned' ? `Hi ${g.name},` : 'Hi,';
  return [
    greeting,
    '',
    `Here's your work on ${ctx.projectName} this week (${ctx.weekRange}):`,
    ...g.tasks.map(tk => `• ${tk.title}${tk.startLabel ? ` — ${tk.startLabel}` : ''}`),
    '',
    ctx.gcName ? `— ${ctx.gcName}` : 'Sent via MAGE ID',
  ].join('\n');
}

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => ESCAPE[ch]);
}

/** Lightweight branded HTML for the email path. */
export function buildCrewEmailHtml(g: CrewDispatchGroup, ctx: DispatchContext): string {
  const items = g.tasks
    .map(tk => `<li style="margin:0 0 6px;font-size:15px;color:#1f2937;">${esc(tk.title)}${tk.startLabel ? ` <span style="color:#6b7280;">— ${esc(tk.startLabel)}</span>` : ''}</li>`)
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px;">
  <p style="font-size:16px;color:#111827;margin:0 0 4px;">${g.key !== 'unassigned' ? `Hi ${esc(g.name)},` : 'Hi,'}</p>
  <p style="font-size:15px;color:#374151;margin:0 0 14px;">Here's your work on <strong>${esc(ctx.projectName)}</strong> this week (${esc(ctx.weekRange)}):</p>
  <ul style="padding-left:20px;margin:0 0 16px;">${items}</ul>
  <p style="font-size:13px;color:#6b7280;margin:0;">${ctx.gcName ? `Sent by ${esc(ctx.gcName)} via MAGE ID` : 'Sent via MAGE ID'}</p>
</div>`;
}

export function dispatchSubject(ctx: DispatchContext): string {
  return `Your work this week — ${ctx.projectName}`;
}
