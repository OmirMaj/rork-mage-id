// statusPill — single source of truth for the colors + labels we use on
// status pills across the new screens (closeout binder, lien waivers,
// contract, handover, etc).
//
// Before this, each screen picked its own colors: closeout used amber
// for "in progress", lien-waivers used Colors.primary (blue) for
// "signed", contract used green for "signed". The result felt jarring
// — same conceptual state, different visual weight.
//
// Convention here:
//   neutral  — gray. Default / not started / draft.
//   info     — blue. Informational, no action required.
//   pending  — amber. In progress, awaiting something.
//   success  — green. Done / signed / delivered.
//   danger   — red.   Error / void / rejected.
//
// Each status pill consumes a `tone` from this set; the helper maps it
// to a foreground + background. UI components import { statusPillTone }
// and apply { color, backgroundColor } to a <View>+<Text> pair.

export type StatusTone = 'neutral' | 'info' | 'pending' | 'success' | 'danger';

export interface StatusPillStyle {
  /** Foreground (text + icon). */
  color: string;
  /** Background (12% tint of color). */
  backgroundColor: string;
}

export const STATUS_TONES: Record<StatusTone, StatusPillStyle> = {
  neutral: { color: '#6B7177', backgroundColor: 'rgba(107,113,119,0.12)' },
  info:    { color: '#0B6BCB', backgroundColor: 'rgba(11,107,203,0.12)' },
  pending: { color: '#C26A00', backgroundColor: 'rgba(245,166,35,0.16)' },
  success: { color: '#1E8E4A', backgroundColor: 'rgba(30,142,74,0.12)' },
  danger:  { color: '#E5484D', backgroundColor: 'rgba(229,72,77,0.12)' },
};

/**
 * Map the literal status string of any of our domain objects to a
 * pill tone. Each screen passes whatever its native status enum is;
 * we map them all to one of five tones.
 */
export function toneForStatus(status: string | undefined | null): StatusTone {
  if (!status) return 'neutral';
  const s = status.toLowerCase().replace(/[\s_-]/g, '');
  switch (s) {
    // Done states
    case 'signed':
    case 'paid':
    case 'completed':
    case 'closed':
    case 'received':
    case 'delivered':
    case 'sent':           // for closeout binder; "sent" = delivered to homeowner
    case 'approved':
    case 'done':
      return 'success';
    // In-progress / awaiting
    case 'finalized':      // closeout binder finalized but not delivered
    case 'requested':
    case 'inprogress':
    case 'pending':
    case 'submitted':
    case 'readyforreview':
    case 'awaiting':
      return 'pending';
    // Errors
    case 'void':
    case 'voided':
    case 'rejected':
    case 'declined':
    case 'failed':
      return 'danger';
    // Informational
    case 'open':
      return 'info';
    // Default — drafts and unknowns
    default:
      return 'neutral';
  }
}

export function statusPillStyle(status: string | undefined | null): StatusPillStyle {
  return STATUS_TONES[toneForStatus(status)];
}
