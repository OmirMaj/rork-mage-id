// ============================================================================
// utils/icsGenerator.ts
//
// Generates a per-project ICS (iCalendar RFC 5545) feed. Powers the Calendar
// tile in project-detail — users export a .ics file and subscribe in Apple
// Calendar / Google Calendar / Outlook so every schedule task, milestone,
// invoice due date, and warranty expiration lives alongside the rest of
// their calendar.
//
// The builder is pure (no React, no file system). `exportProjectIcs()` is the
// side-effectful wrapper that writes the file to the cache dir and hands it
// to the share sheet — matches the `utils/dataExport.ts` pattern.
//
// All events are produced as all-day VEVENTs. Per RFC 5545, the DTEND of an
// all-day event is EXCLUSIVE — a task on 2026-04-24 only has DTEND 2026-04-25.
// ============================================================================
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type {
  Project, ScheduleTask, Invoice, Warranty,
} from '@/types';

// ---------------------------------------------------------------------------
// Event model
// ---------------------------------------------------------------------------

export type IcsEventKind = 'task' | 'milestone' | 'invoiceDue' | 'warrantyEnd';

export interface IcsEvent {
  uid: string;
  kind: IcsEventKind;
  /** Inclusive start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD). Same as start for single-day events. */
  endDate: string;
  summary: string;
  description?: string;
  categories?: string[];
}

// ---------------------------------------------------------------------------
// Project → events
// ---------------------------------------------------------------------------

export interface BuildProjectEventsInput {
  project: Project;
  invoices: Invoice[];
  warranties: Warranty[];
}

export function buildProjectEvents(input: BuildProjectEventsInput): IcsEvent[] {
  const { project, invoices, warranties } = input;
  const events: IcsEvent[] = [];

  // --- schedule tasks / milestones -----------------------------------------
  const schedule = project.schedule;
  if (schedule && schedule.tasks.length > 0) {
    const scheduleStart = schedule.startDate ?? todayIso();
    for (const t of schedule.tasks) {
      const ev = scheduleTaskToEvent(project, scheduleStart, t);
      if (ev) events.push(ev);
    }
  }

  // --- invoice due dates ---------------------------------------------------
  for (const inv of invoices) {
    if (inv.projectId !== project.id) continue;
    if (inv.status === 'paid') continue;
    if (!inv.dueDate) continue;
    const iso = toIsoDate(inv.dueDate);
    if (!iso) continue;
    const amountRemaining = Math.max(0, (inv.totalDue ?? 0) - (inv.amountPaid ?? 0));
    const label = amountRemaining > 0 ? ` — ${formatMoney(amountRemaining)} due` : '';
    events.push({
      uid: `mageid-invoice-${inv.id}@mageid.app`,
      kind: 'invoiceDue',
      startDate: iso,
      endDate: iso,
      summary: `Invoice #${inv.number} due${label}`,
      description: [
        `Project: ${project.name}`,
        `Status: ${inv.status}`,
        amountRemaining > 0 ? `Amount due: ${formatMoney(amountRemaining)}` : null,
        inv.notes ? `Notes: ${inv.notes}` : null,
      ].filter(Boolean).join('\n'),
      categories: ['MAGE ID', 'Invoice'],
    });
  }

  // --- warranty expirations ------------------------------------------------
  for (const w of warranties) {
    if (w.projectId !== project.id) continue;
    if (w.status === 'expired' || w.status === 'void') continue;
    if (!w.endDate) continue;
    const iso = toIsoDate(w.endDate);
    if (!iso) continue;
    events.push({
      uid: `mageid-warranty-${w.id}@mageid.app`,
      kind: 'warrantyEnd',
      startDate: iso,
      endDate: iso,
      summary: `Warranty ends: ${w.title}`,
      description: [
        `Project: ${project.name}`,
        `Provider: ${w.provider}`,
        `Category: ${w.category}`,
        w.coverageDetails ? `Coverage: ${w.coverageDetails}` : null,
      ].filter(Boolean).join('\n'),
      categories: ['MAGE ID', 'Warranty'],
    });
  }

  // Sort by startDate ascending, then kind for stability.
  events.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    return a.kind.localeCompare(b.kind);
  });

  return events;
}

function scheduleTaskToEvent(
  project: Project,
  scheduleStartIso: string,
  t: ScheduleTask,
): IcsEvent | null {
  const startIso = addDays(scheduleStartIso, Math.max(0, t.startDay - 1));
  if (!startIso) return null;
  const duration = Math.max(1, t.durationDays);
  const endIso = addDays(startIso, Math.max(0, duration - 1));
  if (!endIso) return null;

  const isMilestone = !!t.isMilestone;
  const kind: IcsEventKind = isMilestone ? 'milestone' : 'task';
  const summary = isMilestone
    ? `★ ${t.title}`
    : t.title;

  const descLines: string[] = [
    `Project: ${project.name}`,
    `Phase: ${t.phase}`,
  ];
  if (t.crew) descLines.push(`Crew: ${t.crew}`);
  if (t.assignedSubName) descLines.push(`Sub: ${t.assignedSubName}`);
  if (typeof t.progress === 'number') descLines.push(`Progress: ${Math.round(t.progress)}%`);
  if (t.isCriticalPath) descLines.push('On critical path');
  if (t.notes) descLines.push(`Notes: ${t.notes}`);

  const categories = ['MAGE ID', isMilestone ? 'Milestone' : 'Task', t.phase].filter(Boolean);

  return {
    uid: `mageid-task-${project.id}-${t.id}@mageid.app`,
    kind,
    startDate: startIso,
    endDate: endIso,
    summary,
    description: descLines.join('\n'),
    categories,
  };
}

// ---------------------------------------------------------------------------
// Events → ICS text
// ---------------------------------------------------------------------------

export interface BuildIcsTextInput {
  calendarName: string;
  events: IcsEvent[];
  /** ISO timestamp used in DTSTAMP on every VEVENT. Default: now. */
  now?: string;
}

export function buildIcsText(input: BuildIcsTextInput): string {
  const { calendarName, events } = input;
  const nowStamp = icsTimestamp(input.now ?? new Date().toISOString());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MAGE ID//MAGE ID//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${toCompactDate(ev.startDate)}`);
    // All-day DTEND is exclusive — add 1 day to the inclusive endDate.
    const endExclusive = addDays(ev.endDate, 1) ?? ev.endDate;
    lines.push(`DTEND;VALUE=DATE:${toCompactDate(endExclusive)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    }
    if (ev.categories && ev.categories.length > 0) {
      lines.push(`CATEGORIES:${ev.categories.map(escapeText).join(',')}`);
    }
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Apply RFC 5545 line folding (max 75 octets per line).
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Export wrapper — write + share
// ---------------------------------------------------------------------------

export interface IcsExportResult {
  /** The generated ICS text — useful for web fallback or email-body inclusion. */
  icsText: string;
  /** File URI on native; empty on web where we use a Blob download instead. */
  fileUri: string;
  /** Event count for confirmation UI. */
  eventCount: number;
}

export async function exportProjectIcs(input: BuildProjectEventsInput): Promise<IcsExportResult> {
  const events = buildProjectEvents(input);
  const calendarName = `MAGE ID · ${input.project.name}`;
  const icsText = buildIcsText({ calendarName, events });

  const safeName = slugify(input.project.name) || 'project';
  const fileName = `mage-id-${safeName}.ics`;

  if (Platform.OS === 'web') {
    // On web, trigger a browser download via Blob + anchor. No file written.
    downloadOnWeb(fileName, icsText);
    return { icsText, fileUri: '', eventCount: events.length };
  }

  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No cache directory available on this platform.');
  const fileUri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, icsText, { encoding: 'utf8' });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/calendar',
      dialogTitle: `${input.project.name} calendar`,
      UTI: 'com.apple.ical.ics',
    });
  }

  return { icsText, fileUri, eventCount: events.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(input: string): string | null {
  // Accept "YYYY-MM-DD" or ISO datetime; normalize to "YYYY-MM-DD".
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const t = Date.parse(input);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string | null {
  const base = toIsoDate(iso);
  if (!base) return null;
  // Build at noon UTC to sidestep DST edge cases when re-serializing.
  const d = new Date(`${base}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toCompactDate(iso: string): string {
  // "2026-04-24" → "20260424"
  return iso.replace(/-/g, '');
}

function icsTimestamp(isoString: string): string {
  // "2026-04-24T12:34:56.789Z" → "20260424T123456Z"
  const t = Date.parse(isoString);
  const d = Number.isNaN(t) ? new Date() : new Date(t);
  const s = d.toISOString();
  return s.slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

/**
 * RFC 5545 §3.1 — "text" type escape: backslash, comma, semicolon, newline.
 * Quotes are NOT escaped.
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * RFC 5545 §3.1 — long lines MUST be folded at 75 octets with CRLF + single
 * leading whitespace on continuation lines. We fold by character count as a
 * reasonable approximation — our summaries stay well inside 7-bit ASCII.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(' ' + rest);
  return parts.join('\r\n');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function downloadOnWeb(fileName: string, text: string): void {
  try {
    if (typeof document === 'undefined') return;
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on next tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    console.log('[icsGenerator] web download failed:', err);
  }
}
