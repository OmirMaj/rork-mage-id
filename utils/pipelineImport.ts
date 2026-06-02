// pipelineImport — parse a contractor's pasted client/lead list into Lead
// drafts. The day-one-value wedge: a contractor brings their existing book
// of business in seconds (paste from a spreadsheet, Notes, or a text), and
// the app is immediately a useful CRM — no marketplace liquidity required.
//
// Deliberately forgiving: contractors paste messy data. We accept one
// client per line, with fields separated by comma OR tab (so a spreadsheet
// column-copy and a hand-typed line both work). Field order is flexible —
// we detect emails (contain @), phones (mostly digits), and money ($ or
// large numbers), and treat the first remaining token as the name.
//
// Examples that all parse:
//   John Smith, 555-123-4567, kitchen remodel, 80000
//   Jane Garcia <jane@email.com> — bathroom reno
//   Patel Family\t312-555-0199\tADU\t150000
//   Mike Doe

import type { Lead, LeadStage } from '@/types';

export interface ImportedLeadDraft {
  name: string;
  phone?: string;
  email?: string;
  projectType?: string;
  budgetMin?: number;
  budgetMax?: number;
  /** The original line, kept so the UI can show what we parsed it from. */
  raw: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// A phone-ish token: 7+ digits once separators are stripped.
function isPhoneish(token: string): boolean {
  const digits = token.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
// A money-ish token: a $ amount, or a bare number >= 1000 (budgets, not
// street numbers — we keep the threshold high so "555" stays a phone/name).
function parseMoney(token: string): number | null {
  const t = token.trim();
  if (!/[\d]/.test(t)) return null;
  const hasDollar = t.includes('$');
  const cleaned = t.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?[kK]?$/.test(cleaned)) return null;
  let n = cleaned.toLowerCase().endsWith('k')
    ? parseFloat(cleaned.slice(0, -1)) * 1000
    : parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  // Only treat as budget if it's a $ amount or a sizable number.
  if (!hasDollar && n < 1000) return null;
  return Math.round(n);
}

/** Parse one pasted line into a draft, or null if there's no usable name. */
export function parseImportLine(line: string): ImportedLeadDraft | null {
  const raw = line.trim();
  if (!raw) return null;

  // Collapse thousands-separators INSIDE numbers first (e.g. "$80,000" or
  // "80,000") so the comma field-split below doesn't shred a budget into
  // "$80" + "000". Only commas flanked by digits are removed; the field
  // commas between "name, phone, project" are untouched.
  let working = raw.replace(/(\d),(\d)/g, '$1$2');
  let email: string | undefined;
  const emailMatch = working.match(EMAIL_RE);
  if (emailMatch) {
    email = emailMatch[0];
    working = working.replace(emailMatch[0], ' ');
  }

  // Split on comma or tab; collapse the angle-bracket leftovers.
  const parts = working
    .split(/[,\t]/)
    .map(p => p.replace(/[<>]/g, '').trim())
    .filter(Boolean);
  if (parts.length === 0 && !email) return null;

  let phone: string | undefined;
  let budgetMin: number | undefined;
  let budgetMax: number | undefined;
  const leftover: string[] = [];

  for (const part of parts) {
    if (!phone && isPhoneish(part) && !EMAIL_RE.test(part)) {
      phone = part.trim();
      continue;
    }
    const money = parseMoney(part);
    if (money != null) {
      // First money seen = max (the headline budget); a second = treat as a
      // range with the smaller as min.
      if (budgetMax == null) budgetMax = money;
      else { budgetMin = Math.min(budgetMax, money); budgetMax = Math.max(budgetMax, money); }
      continue;
    }
    leftover.push(part);
  }

  // First leftover token is the name; the rest become the project type.
  const name = leftover.shift()?.trim();
  if (!name) {
    // No name but we have an email — derive a placeholder from it.
    if (email) {
      return { name: email.split('@')[0], email, phone, budgetMin, budgetMax, raw };
    }
    return null;
  }
  const projectType = leftover.length > 0 ? leftover.join(', ').trim() : undefined;

  return { name, phone, email, projectType, budgetMin, budgetMax, raw };
}

/** Parse a full paste blob (many lines) into drafts, skipping blanks. */
export function parseImportBlob(blob: string): ImportedLeadDraft[] {
  return blob
    .split(/\r?\n/)
    .map(parseImportLine)
    .filter((d): d is ImportedLeadDraft => d != null);
}

/** Shape a draft into the addLead() input. Imported clients are existing
 *  relationships, so they land as 'qualified' (not raw 'new' inbound) with
 *  source 'repeat' — they're the contractor's own book, not cold leads. */
export function draftToLeadInput(draft: ImportedLeadDraft): Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt'> {
  return {
    name: draft.name,
    phone: draft.phone,
    email: draft.email,
    projectType: draft.projectType,
    budgetMin: draft.budgetMin,
    budgetMax: draft.budgetMax,
    source: 'repeat',
    stage: 'qualified' as LeadStage,
    touches: [{
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'note' as const,
      body: 'Imported from existing client list.',
      occurredAt: new Date().toISOString(),
    }],
  };
}
