// utils/jobFacts/types.ts — the shapes of a job facts link (lane FACTS).
//
// A job facts link is a read-only page at https://mageid.app/facts/<code> that
// shows plain RECORDED facts about one job: permits, inspections, the
// change-order trail, finished milestones, photos the GC picked, and closeout
// and warranty status. Every fact names the MAGE ID record it came from and
// carries the day it was recorded for. Nothing is inferred: no AI, no "on
// track", no percentages, no planned dates.
//
// PURE: type-only. buildJobFacts.ts builds a JobFactsPayload, the app writes
// it into public.job_fact_links (20261002161000_job_fact_links.sql), and the
// job-facts-view edge function serves it to marketing/facts/index.html.

/** The sections a GC can switch on, in the FIXED order every surface shows them. */
export type JobFactSection = 'permits' | 'inspections' | 'changeOrders' | 'milestones' | 'photos' | 'closeout';

export const JOB_FACT_SECTIONS: readonly JobFactSection[] = [
  'permits', 'inspections', 'changeOrders', 'milestones', 'photos', 'closeout',
] as const;

/** Which MAGE ID record a fact came from. */
export type JobFactSourceRecord =
  | 'permit'
  | 'inspection'
  | 'change_order'
  | 'schedule'
  | 'photo'
  | 'warranty'
  | 'closeout_binder';

export type JobFactKind =
  | 'permit_applied'
  | 'permit_approved'
  | 'permit_expires'
  | 'inspection'
  | 'change_order'
  | 'change_order_event'
  | 'milestone_done'
  | 'photo'
  | 'binder_finalized'
  | 'binder_sent'
  | 'warranty_start'
  | 'warranty_end';

export interface JobFactSource {
  record: JobFactSourceRecord;
  /** A human reference, never a database id or a storage path: "B-1234",
   *  "4" (the change-order number), "Footing", a milestone's title. For a
   *  photo it is the photo's id, which the view function needs to sign it. */
  ref: string;
}

export interface JobFact {
  kind: JobFactKind;
  section: JobFactSection;
  /** What the fact is about: "Building permit B-1234", "Change order #4". */
  label: string;
  /** What was recorded: "Approved", "Passed", the change order's description. */
  value: string;
  /** Extra recorded words ("NYC DOB · status: approved"), or absent. */
  detail?: string;
  source: JobFactSource;
  /** The calendar day the record names, 'YYYY-MM-DD'. Never back-filled. */
  date: string;
  /** True when `date` is a term on the record (an expiry, a warranty start or
   *  end, a booked inspection) rather than the day something happened; the
   *  pages then print the day alone instead of "Recorded <day>". */
  term?: true;
  /** Change orders only, and only when the GC switched amounts on. Integer cents. */
  amountCents?: number;
  /** Photos only. No URL is ever stored: the view function signs by id. */
  photo?: { id: string; ts: string; tag: string | null };
}

export type JobFactLeftOutReason =
  | 'no_date'        // the record has no date for this fact
  | 'draft'          // a draft change order
  | 'recalled'       // drafted or recalled in the client portal
  | 'not_synced'     // a photo with no stored copy yet
  | 'not_found'      // a picked photo that is no longer on this job
  | 'over_cap'       // past the 30-photo cap
  | 'internal';      // an internal change-order record (a note, an auto-draft marker)

export interface JobFactLeftOut {
  kind: 'permit' | 'inspection' | 'change_order' | 'change_order_event' | 'milestone' | 'photo' | 'warranty' | 'closeout_binder';
  count: number;
  reason: JobFactLeftOutReason;
}

export interface JobFactsPayload {
  v: 1;
  /** The job's name as the GC typed it, and his business name. */
  job: { name: string; business: string | null };
  sections: JobFactSection[];
  includeCoAmounts: boolean;
  facts: JobFact[];
  leftOut: JobFactLeftOut[];
}

/** The owner's link row, as the app reads it (never the payload's internals). */
export interface JobFactLink {
  id: string;
  code: string;
  sections: JobFactSection[];
  payload: JobFactsPayload;
  publishedAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
}
