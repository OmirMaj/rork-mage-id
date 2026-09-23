// lienWaiverEngine — Supabase + PDF helpers for lien waivers.
//
// WHAT CHANGED AND WHY. This module used to print ONE generic waiver for every
// job and then print, inside that same PDF, a warning that in California,
// Texas, Florida, Georgia and Arizona the form it had just produced "may render
// the waiver void or unenforceable". A document that tells you not to rely on
// it is not a document. Those five states write the wording of a lien waiver
// into their codes; the prescribed text now lives in utils/lienWaiverForms.ts
// and a job in one of them gets that state's form, with the record's values in
// the statutory blanks. Everywhere else the general form stands, and so does
// the warning — because everywhere else it is true and useful.
//
// The second half of the fix is who signs. app/lien-waivers.tsx captured the
// sub's email, sent nothing to it, and let the GC type the sub's name under
// `role: 'gc'` — a contractor signing his subcontractor's release. The waiver
// now goes to the sub by email as a token-gated signing link, following the
// same shape the homeowner portal uses for change-order e-signature
// (portal_submit_co_approval_signed) and the sub portal uses for invoices
// (sub_portal_submit_invoice): a SECURITY DEFINER RPC gated on a per-record
// token plus a static page. The GC can still record a waiver that was signed
// on paper, but that is stored and printed AS a GC attestation, never as the
// subcontractor's signature.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { escHtml, fmtMoney } from './pdfDesign';
import {
  WAIVER_LABELS, buildLienWaiverSignableHtml, buildLienWaiverHtml,
  lienWaiverFormLabel, lienWaiverFormMeta, type LienWaiverDocContext,
} from './lienWaiverDocument';
import { formatCalendarDay } from './calendarDate';
import { generateUUID } from './generateId';
import { sendEmail } from './emailService';
import { wrapEmailHtml, emailDivider } from './emailLayout';
import { openPrintWindowOrThrow } from './platformFile';
import type {
  LienWaiver, LienWaiverType, LienWaiverStatus,
  CompanyBranding, ContractSignature,
} from '@/types';

// Row mapping
interface LienWaiverRow {
  id: string;
  project_id: string;
  user_id: string;
  commitment_id: string | null;
  invoice_id: string | null;
  waiver_type: LienWaiverType;
  sub_company_id: string | null;
  sub_name: string;
  sub_email: string | null;
  through_date: string;
  paid_amount: number;
  status: LienWaiverStatus;
  sub_signature: ContractSignature | null;
  signed_at: string | null;
  signed_pdf_url: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  /** Set the moment a signing link is emailed to the sub. Absent on a row
   *  written before the signature-request migration, and absent on every row
   *  until that migration is applied — `select('*')` simply does not return a
   *  column that does not exist, so this stays undefined rather than throwing. */
  sign_requested_at?: string | null;
}

function rowToWaiver(r: LienWaiverRow): LienWaiver {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    commitmentId: r.commitment_id ?? undefined,
    invoiceId:    r.invoice_id    ?? undefined,
    waiverType: r.waiver_type,
    subCompanyId: r.sub_company_id ?? undefined,
    subName:      r.sub_name,
    subEmail:     r.sub_email      ?? undefined,
    throughDate: r.through_date,
    paidAmount: Number(r.paid_amount) || 0,
    status: r.status,
    subSignature: r.sub_signature ?? undefined,
    signedAt:     r.signed_at     ?? undefined,
    signedPdfUrl: r.signed_pdf_url ?? undefined,
    signRequestedAt: r.sign_requested_at ?? undefined,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function fetchLienWaiversForProject(projectId: string): Promise<LienWaiver[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('lien_waivers')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[lienWaiverEngine] fetch error:', error.message);
    return [];
  }
  return (data ?? []).map(r => rowToWaiver(r as LienWaiverRow));
}

export async function saveLienWaiver(w: Partial<LienWaiver> & { id?: string; projectId: string; subName: string; waiverType: LienWaiverType; throughDate: string; paidAmount: number }): Promise<LienWaiver | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) return null;

  const row = {
    id: w.id,
    project_id: w.projectId,
    user_id: userId,
    commitment_id: w.commitmentId ?? null,
    invoice_id:    w.invoiceId    ?? null,
    waiver_type: w.waiverType,
    sub_company_id: w.subCompanyId ?? null,
    sub_name:       w.subName,
    sub_email:      w.subEmail      ?? null,
    through_date: w.throughDate,
    paid_amount: w.paidAmount,
    status: w.status ?? 'requested',
    notes: w.notes ?? '',
    // The signature columns are written ONLY when the caller actually has one.
    //
    // Every caller builds its payload as `{ ...waiver, status }` from the copy
    // the screen loaded, and since the sub can now sign remotely that copy goes
    // stale on its own. Coercing an absent signature to `null` meant a GC who
    // tapped Void or Mark received on a card that still read "requested" — while
    // the sub had signed thirty seconds earlier — upserted `sub_signature: null,
    // signed_at: null` over the real signature, destroying the only record that
    // the release was ever given. Omitting the key leaves the stored value
    // alone; on an insert the column simply defaults to null.
    ...(w.subSignature !== undefined ? { sub_signature: w.subSignature } : {}),
    ...(w.signedAt     !== undefined ? { signed_at: w.signedAt } : {}),
    ...(w.signedPdfUrl !== undefined ? { signed_pdf_url: w.signedPdfUrl } : {}),
  };
  const { data, error } = await supabase
    .from('lien_waivers')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[lienWaiverEngine] save error:', error?.message);
    return null;
  }
  return rowToWaiver(data as LienWaiverRow);
}

/**
 * True only when a row was actually deleted.
 *
 * `.select('id')` is what makes this checked (#30): a PostgREST delete that
 * RLS filters down to nothing answers 204 with `error: null`, byte-identical to
 * a real delete — so the screen dropped the card, the row stayed on the server,
 * and it came back on the next load with nothing said in between.
 */
export async function deleteLienWaiver(id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.from('lien_waivers').delete().eq('id', id).select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

// ─── Checked reads + narrow writes (#30, #31) ───────────────────────
//
// fetchLienWaiversForProject answers `[]` for "no waivers" AND for "the read
// failed", and the screen rendered both as "No waivers yet" — at a jobsite with
// no bars, on a job whose subs had signed their releases. Its signature stays
// (closeout binder, handover, project detail and the sub portal import it);
// the checked variant below is what a screen that must tell the two apart uses.

/** Per-project cache of the last list this phone read successfully. Under the
 *  `mageid_` prefix, so the tenant-switch sweep in AuthContext removes it. */
export const LIEN_WAIVER_CACHE_PREFIX = 'mageid_lien_waivers_';

export interface LienWaiverCache {
  waivers: LienWaiver[];
  /** ISO instant of the read this list came from. */
  savedAt: string;
}

export async function readLienWaiverCache(projectId: string): Promise<LienWaiverCache | null> {
  try {
    const raw = await AsyncStorage.getItem(LIEN_WAIVER_CACHE_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LienWaiverCache>;
    if (!Array.isArray(parsed.waivers) || typeof parsed.savedAt !== 'string') return null;
    return { waivers: parsed.waivers, savedAt: parsed.savedAt };
  } catch {
    // A cache is a convenience. Unreadable storage means "nothing cached",
    // never a crash on the screen that asked.
    return null;
  }
}

async function writeLienWaiverCache(projectId: string, waivers: LienWaiver[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LIEN_WAIVER_CACHE_PREFIX + projectId, JSON.stringify({ waivers, savedAt: new Date().toISOString() }));
  } catch { /* the list on screen is still right; only the offline copy is stale */ }
}

/**
 * The waivers on a job, with a failed read reported as a failure (CONTRACT 6).
 * A successful read also becomes this phone's offline copy of the list.
 */
export async function loadLienWaiversChecked(
  projectId: string,
): Promise<{ ok: true; waivers: LienWaiver[] } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'No backend configured.' };
  try {
    const { data, error } = await supabase
      .from('lien_waivers')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) return { ok: false, error: error.message || 'The waiver list could not be read.' };
    const waivers = (data ?? []).map(r => rowToWaiver(r as LienWaiverRow));
    await writeLienWaiverCache(projectId, waivers);
    return { ok: true, waivers };
  } catch (e) {
    // supabase-js rejects (rather than answering { error }) on a dropped
    // connection in some runtimes; that is the offline case, not a crash.
    return { ok: false, error: e instanceof Error ? e.message : 'The waiver list could not be read.' };
  }
}

/** One waiver, re-read from the server — `waiver: null` when it is gone. */
export async function fetchLienWaiverChecked(
  id: string,
): Promise<{ ok: true; waiver: LienWaiver | null } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'No backend configured.' };
  try {
    const { data, error } = await supabase.from('lien_waivers').select('*').eq('id', id).maybeSingle();
    if (error) return { ok: false, error: error.message || 'The waiver could not be read.' };
    return { ok: true, waiver: data ? rowToWaiver(data as LienWaiverRow) : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The waiver could not be read.' };
  }
}

/**
 * Create a waiver and say WHY when it fails — saveLienWaiver answers a bare
 * null, and "Save failed" read the same for no signal, a signed-out session and
 * a job the account cannot write to.
 */
export async function createLienWaiverChecked(
  w: Parameters<typeof saveLienWaiver>[0],
): Promise<{ ok: true; waiver: LienWaiver } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'No backend configured.' };
  try {
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user?.id;
    if (!userId) return { ok: false, error: 'You are signed out. Sign in again and retry.' };
    const { data, error } = await supabase
      .from('lien_waivers')
      .insert({
        ...(w.id ? { id: w.id } : {}),
        project_id: w.projectId,
        user_id: userId,
        commitment_id: w.commitmentId ?? null,
        invoice_id: w.invoiceId ?? null,
        waiver_type: w.waiverType,
        sub_company_id: w.subCompanyId ?? null,
        sub_name: w.subName,
        sub_email: w.subEmail ?? null,
        through_date: w.throughDate,
        paid_amount: w.paidAmount,
        status: w.status ?? 'requested',
        notes: w.notes ?? '',
      })
      .select('*')
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message || 'The waiver was not saved.' };
    return { ok: true, waiver: rowToWaiver(data as LienWaiverRow) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The waiver was not saved.' };
  }
}

/**
 * Change ONLY the status (#31). handleStatusChange used to upsert the whole
 * card it was pressed on, so a stale copy rewrote the sub's email, the notes
 * and the amount with whatever this phone last saw. The server's BEFORE UPDATE
 * guard (20260923130000) clears the signing token when this voids a waiver.
 *
 * `waiver: null` = the update matched no row (deleted on another device, or not
 * this account's to change).
 */
export async function updateLienWaiverStatus(
  id: string,
  status: LienWaiverStatus,
): Promise<{ ok: true; waiver: LienWaiver | null } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'No backend configured.' };
  try {
    const { data, error } = await supabase
      .from('lien_waivers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, error: error.message || 'The waiver was not changed.' };
    return { ok: true, waiver: data ? rowToWaiver(data as LienWaiverRow) : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The waiver was not changed.' };
  }
}

export type RecordPaperResult =
  | { ok: true; waiver: LienWaiver }
  /** The row was signed before this write landed — the sub e-signed, or
   *  another device recorded paper. `waiver` is the row as it now stands. */
  | { ok: false; reason: 'already_signed'; waiver: LienWaiver | null }
  | { ok: false; reason: 'failed'; error: string };

/**
 * Record a paper original the GC holds — ONLY while the row is unsigned.
 *
 * It used to be an unconditional upsert of the card the GC was looking at,
 * which on a card still reading REQUESTED replaced the sub's electronic
 * signature, consent record and user agent with `{ role: 'gc' }` (#31). The
 * `.is('signed_at', null)` filter asks the row itself, inside the statement.
 *
 * The signing token is deliberately LEFT on the row. lien_waiver_submit_signature
 * never overwrites a signed row (it answers already_signed), so a live token on
 * a signed waiver can only show the sub "This waiver is already signed" — which
 * is true. Nulling it would instead tell him "This link no longer works… open
 * the most recent email", sending him to look for an email that was never sent.
 */
export async function recordPaperLienWaiver(id: string, name: string): Promise<RecordPaperResult> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'failed', error: 'No backend configured.' };
  const now = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('lien_waivers')
      .update({
        status: 'signed',
        signed_at: now,
        // role 'gc': the contractor attesting to a paper original. Never
        // 'sub' — only the token-gated signing page writes that.
        sub_signature: { name, role: 'gc', signedAt: now },
        updated_at: now,
      })
      .eq('id', id)
      .is('signed_at', null)
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, reason: 'failed', error: error.message || 'The waiver was not changed.' };
    if (data) return { ok: true, waiver: rowToWaiver(data as LienWaiverRow) };
    // No row matched: signed underneath us, or gone. Ask the row which.
    const live = await fetchLienWaiverChecked(id);
    if (live.ok && live.waiver?.signedAt) return { ok: false, reason: 'already_signed', waiver: live.waiver };
    return { ok: false, reason: 'failed', error: live.ok ? 'This waiver is no longer on the job.' : live.error };
  } catch (e) {
    return { ok: false, reason: 'failed', error: e instanceof Error ? e.message : 'The waiver was not changed.' };
  }
}

// ─── Who may work this screen (#29 interim, productDecision #29) ────
//
// Lien waivers are owner-only until the founder decides otherwise. An invited
// PM or viewer used to open the screen, read "No waivers yet" (RLS shows each
// account only its own rows), create waivers under HIS account that the GC
// never saw, and email subs signing links naming HIS company. The server now
// refuses that insert (lw_gc_insert checks project ownership, 20260923130000);
// this is the sentence the screen says instead of offering it.

export const LIEN_WAIVER_OWNER_ONLY_MESSAGE =
  'Lien waivers are issued by the job\'s owner. Ask them to request this release.';

export type LienWaiverAccessGate =
  | { kind: 'allow' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'blocked'; message: string };

/**
 * The gate, pure so a validator can run it. `ownerCompany` is named only when
 * the caller actually knows it — a guessed company on a legal-document screen
 * is worse than none.
 */
export function lienWaiverAccessGate(
  s: { role: 'owner' | 'editor' | 'viewer' | 'field' | null; isLoading: boolean; isError: boolean; isPaused?: boolean; reason?: string },
  ownerCompany?: string | null,
): LienWaiverAccessGate {
  if (s.role === 'owner') return { kind: 'allow' };
  if (s.role === null) {
    // Still resolving is a wait, never the paywall and never a refusal.
    if (s.isLoading) return { kind: 'loading' };
    if (s.isError) return { kind: 'error' };
    if (s.isPaused && s.reason) return { kind: 'blocked', message: s.reason };
    return { kind: 'blocked', message: 'You are not on this job, so its lien waivers are not shown here. Ask the project owner to invite you.' };
  }
  const company = (ownerCompany ?? '').trim();
  return {
    kind: 'blocked',
    message: company
      ? `Lien waivers are issued by the job's owner (${company}). Ask them to request this release.`
      : LIEN_WAIVER_OWNER_ONLY_MESSAGE,
  };
}

// ─── Display helpers + the printable document ───────────────────────
//
// Both live in utils/lienWaiverDocument.ts — a pure module, so the validator
// can render a real waiver and read the statutory notices off the page. They
// are re-exported here because this is the module the app has always imported
// them from (closeout binder, project detail, the waivers screen).

export {
  WAIVER_LABELS, buildLienWaiverHtml, buildLienWaiverSignableHtml,
  lienWaiverFormLabel, lienWaiverFormMeta, lienWaiverDocContext,
} from './lienWaiverDocument';
export type { LienWaiverDocContext, LienWaiverFormMeta } from './lienWaiverDocument';


export async function shareLienWaiverPDF(
  waiver: LienWaiver,
  branding: CompanyBranding,
  ctx: LienWaiverDocContext,
): Promise<void> {
  const html = buildLienWaiverHtml(waiver, branding, ctx);
  const projectName = ctx.projectName;
  const title = `${WAIVER_LABELS[waiver.waiverType].short} Lien Waiver — ${projectName}`;
  if (Platform.OS === 'web') {
    // CONTRACT 25 (#147): a blocked pop-up THROWS, so the screen says so
    // through pdfFailureMessage instead of a success haptic over nothing.
    // Reached before any await, so the window still opens inside the tap.
    openPrintWindowOrThrow(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

// ─── Request → sign loop ────────────────────────────────────────────
//
// The sub signs their own waiver. That is the whole point of this section.
//
// Shape copied from the two token-gated flows already in the product — the
// homeowner portal's change-order e-signature (portal_submit_co_approval_signed)
// and the sub portal's invoice submit (sub_portal_submit_invoice):
//
//   1. The GC's app mints a 256-bit token on the waiver row and stores the
//      exact document bytes the sub will be shown.
//   2. The sub gets an email with /lien-waiver/?w=<id>&t=<token>.
//   3. The static page reads the document through a SECURITY DEFINER RPC gated
//      on that token, and posts the signature back through a second one.
//
// The token — never the row id — is what authorises. A waiver id alone must
// open nothing, which is why both RPCs take `p_access_token` and compare it
// against the stored column before doing anything.

/** The RPC the signing page reads the document through. */
export const LIEN_WAIVER_FETCH_RPC = 'lien_waiver_get_for_signing';
/** The RPC the signing page posts the signature to. */
export const LIEN_WAIVER_SIGN_RPC = 'lien_waiver_submit_signature';
/**
 * The static signing page, addressed as a DIRECTORY.
 *
 * Both the waiver id and the token ride in the query string, the way
 * `/architect/?token=…` and `/bid-invite/?t=…` do, and NOT as `/lien-waiver/<id>`
 * the way `/portal/<id>` does. The reason is deployment, not taste:
 * marketing/netlify.toml ends with a `/*` → /404.html catch-all and Netlify
 * processes netlify.toml before marketing/_redirects, so a path-segment page
 * that is listed in only one of the two files is a 404 waiting on whichever
 * file wins. /lien-waiver/* is now in both — but a request for the DIRECTORY
 * resolves to its own index.html before any unforced rule is considered at all,
 * so this URL keeps working even if one of those rules is lost in a merge. The
 * link we mail a subcontractor is the last thing that should depend on a
 * redirect rule staying put.
 */
export const LIEN_WAIVER_SIGN_BASE_URL = 'https://mageid.app/lien-waiver/';
/** Bumped whenever the E-SIGN consent wording on the signing page changes. */
export const LIEN_WAIVER_CONSENT_VERSION = '2026-09-esign-v1';

/**
 * The link the sub opens. Null — never a token-less URL — when there is no
 * token, for the same reason portalShareUrl returns null: the RPCs refuse a
 * request without `?t=`, so a token-less link is a page that cannot sign, with
 * nothing on screen saying why.
 */
export function buildLienWaiverSignUrl(waiverId: string, token: string | undefined | null): string | null {
  const id = (waiverId ?? '').trim();
  const t = (token ?? '').trim();
  if (!id || !t) return null;
  return `${LIEN_WAIVER_SIGN_BASE_URL}?w=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;
}

/**
 * The token, from the same generator ProjectContext's sub-portal links use:
 * two v4 UUIDs with the dashes stripped. 64 hex characters carrying ~244 bits
 * of randomness — comfortably past the 32-character floor both RPCs enforce.
 */
function mintSignToken(): string {
  return (generateUUID() + generateUUID()).replace(/-/g, '');
}

export type LienWaiverRequestOutcome =
  /** Token stored, document sealed, email accepted by Resend. */
  | 'sent'
  /** Everything stored, but the mail server only opened a draft or refused —
   *  the GC must be told the sub has NOT been asked yet. */
  | 'email_failed'
  /** No email address on the waiver. */
  | 'no_email'
  /** Already signed. Re-issuing a token would reopen a completed release and
   *  reset its status to 'requested'; the signature stands. */
  | 'already_signed'
  /** Voided by the GC. The update below sets `status: 'requested'`, so sending
   *  on a voided waiver would quietly un-void it and hand the sub a live link to
   *  sign a release the contractor had already cancelled. */
  | 'voided'
  /** The signing columns are not in the database yet (migration pending). */
  | 'not_provisioned'
  | 'failed';

export interface LienWaiverRequestResult {
  outcome: LienWaiverRequestOutcome;
  /** Present on 'sent' and 'email_failed' so the GC can send the link by hand. */
  signUrl?: string;
  error?: string;
}

/**
 * Email the subcontractor a link to sign their own waiver.
 *
 * Stores three things on the row before sending: the token that gates the
 * link, the timestamp of the request, and the DOCUMENT ITSELF. Sealing the
 * document at request time is what makes the signature mean something — the
 * sub signs specific bytes, and those bytes cannot later be regenerated
 * differently by a change to the GC's branding, the project address, or this
 * code.
 *
 * `not_provisioned` is a real outcome rather than a crash: the columns arrive
 * with a migration this app cannot apply, and until it lands the honest thing
 * is to tell the GC the loop is not switched on rather than claim a send.
 */
export async function requestLienWaiverSignature(
  waiver: LienWaiver,
  branding: CompanyBranding,
  ctx: LienWaiverDocContext,
  opts?: { senderEmail?: string; senderName?: string },
): Promise<LienWaiverRequestResult> {
  if (!isSupabaseConfigured) return { outcome: 'failed', error: 'No backend configured.' };
  const recipient = (waiver.subEmail ?? '').trim();
  if (!recipient || !recipient.includes('@')) return { outcome: 'no_email' };
  // A signed release is finished. Re-requesting would mint a fresh token, seal
  // a fresh document over the one that was actually signed, and knock `status`
  // back to 'requested' — losing the fact that the sub already gave up their
  // lien rights. The screen only offers the button on a 'requested' waiver, so
  // this is the belt for callers that are not that screen.
  if (waiver.signedAt || waiver.subSignature || waiver.status === 'signed' || waiver.status === 'received') {
    return { outcome: 'already_signed' };
  }
  // A voided waiver is one the GC cancelled. The update below writes
  // `status: 'requested'`, which would un-void it — and the signing page only
  // refuses a waiver whose STATUS says voided, so the sub would then be shown a
  // cancelled release with a live Sign button on it.
  if (waiver.status === 'voided') return { outcome: 'voided' };

  const token = mintSignToken();
  const signUrl = buildLienWaiverSignUrl(waiver.id, token);
  if (!signUrl) return { outcome: 'failed', error: 'Could not build a signing link.' };

  const documentHtml = buildLienWaiverSignableHtml(waiver, branding, ctx);
  // Sealed WITH the document, from the same statutory resolution that built it.
  // The signing page prints the title, the citation and the state in its own
  // chrome, and `lien_waiver_get_for_signing` serves all three out of this
  // column — so the keys here are the keys the RPC reads
  // (`waiver_title`, `statute_citation`, `state_name`), pinned by
  // scripts/validate-lien-waivers.ts. Sealed rather than derived at read time
  // because the statutory table is TypeScript; a copy of it in SQL would be a
  // second source of truth that drifts.
  const formMeta = lienWaiverFormMeta(waiver, branding, ctx);
  const requestedAt = new Date().toISOString();

  // These columns arrive with the signature-request migration. They are
  // written on their OWN update rather than through saveLienWaiver so an
  // ordinary save keeps working against a database that has not been migrated.
  //
  // Deliberately NOT routed through utils/offlineQueue's supabaseWrite, unlike
  // the app's ordinary writes: the queue is optimistic, and an optimistic token
  // is a token the server has never seen. Emailing a sub a link that 404s until
  // the GC's phone reconnects is worse than telling the GC it did not send.
  const { data: stored, error } = await supabase
    .from('lien_waivers')
    .update({
      sign_token: token,
      sign_requested_at: requestedAt,
      sign_document_html: documentHtml,
      sign_form_meta: formMeta,
      status: 'requested',
    })
    .eq('id', waiver.id)
    // The two guards above read the COPY THE SCREEN LOADED, and that copy goes
    // stale the moment the sub signs or another device voids the waiver. These
    // two filters re-ask the same questions of the row itself, inside the
    // statement, so a stale card cannot seal a fresh document over a signed
    // release or hand a live link to a release the contractor cancelled.
    .is('signed_at', null)
    .neq('status', 'voided')
    // `.select()` is what makes this a CHECKED write. A PostgREST update that
    // matches no row answers 204 with `error: null` — identical to a successful
    // one — so without this the function emailed the sub a link whose token the
    // server had never stored, and told the GC it had been sent. The sub then
    // opens it and reads "this link no longer works", which is the one sentence
    // that is not true.
    .select('id')
    .maybeSingle();

  if (error) {
    // PostgREST answers an unknown column with 42703 / PGRST204. That is the
    // migration not being applied, not a bug in the caller's input, and the
    // two need different messages on screen.
    const missingColumn = error.code === '42703' || error.code === 'PGRST204'
      || /sign_token|sign_document_html|sign_requested_at|sign_form_meta/.test(error.message ?? '');
    return {
      outcome: missingColumn ? 'not_provisioned' : 'failed',
      error: error.message,
    };
  }

  if (!stored) {
    // No row matched. Ask the row why, rather than guessing: "already signed",
    // "you voided this" and "this waiver is gone" are three different things to
    // tell a contractor, and only one of them is worth retrying.
    const { data: live } = await supabase
      .from('lien_waivers')
      .select('status, signed_at')
      .eq('id', waiver.id)
      .maybeSingle();
    if (!live) return { outcome: 'failed', error: 'This waiver is no longer in the database.' };
    if (live.signed_at) return { outcome: 'already_signed' };
    if (live.status === 'voided') return { outcome: 'voided' };
    return { outcome: 'failed', error: 'The waiver could not be updated, so no link was sent.' };
  }

  const companyName = branding.companyName || 'MAGE ID';
  const meta = WAIVER_LABELS[waiver.waiverType];
  const formLine = lienWaiverFormLabel(waiver, ctx);
  const html = wrapEmailHtml({
    preheader: `${companyName} is asking you to sign a ${meta.short.toLowerCase()} lien waiver for ${ctx.projectName}.`,
    eyebrow: 'Lien waiver',
    title: ctx.projectName,
    subtitle: `${companyName} has prepared a ${meta.long.toLowerCase()} for your signature.`,
    bodyHtml: [
      `<p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#4A5159;">
         Open the link below to read the waiver and sign it yourself. Nothing to install, no account to create.
         You are signing the exact document shown on the page — read it before you sign.
       </p>`,
      emailDivider(),
      // `Through` is a CALENDAR DAY, formatted as one. The raw 'YYYY-MM-DD'
      // read as a filename to a sub, and `new Date()` on it would name the day
      // before west of Greenwich — on the one line of this email that says how
      // far the release runs.
      //
      // `Amount` is to the cent for the same reason the document is: fmtMoney
      // rounds by default, and an email telling a sub they are releasing
      // $18,401 against a waiver that reads $18,400.50 is the kind of
      // discrepancy that stops a signature dead. Money OUT of the GC to the sub.
      `<p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#4A5159;">
         <strong style="color:#0B0D10;">Waiver:</strong> ${escHtml(meta.long)}<br/>
         <strong style="color:#0B0D10;">Form:</strong> ${escHtml(formLine)}<br/>
         <strong style="color:#0B0D10;">Amount:</strong> ${fmtMoney(waiver.paidAmount, { decimals: 2 })}<br/>
         <strong style="color:#0B0D10;">Through:</strong> ${escHtml(formatCalendarDay(waiver.throughDate))}
       </p>`,
      `<p style="margin:14px 0 0 0;font-size:12px;line-height:19px;color:#8B9099;">
         A lien waiver gives up rights. If you have not been paid the amount above, do not sign an unconditional
         waiver — reply to this email instead.
       </p>`,
    ].join(''),
    cta: { label: 'Read and sign', href: signUrl },
    companyName,
    project: { name: ctx.projectName, location: ctx.projectAddress },
    sender: { name: opts?.senderName ?? branding.contactName, email: opts?.senderEmail ?? branding.email, phone: branding.phone },
  });

  const result = await sendEmail({
    to: recipient,
    subject: `${ctx.projectName} — please sign a lien waiver for ${companyName}`,
    html,
    replyTo: opts?.senderEmail ?? branding.email,
    fromCompanyName: companyName,
    // Same List-Unsubscribe treatment every other document this app mails
    // carries (invoice, change-order approval, submittal, portal invite).
    // send-email adds the header whenever `unsubscribe` is not explicitly
    // disabled, so omitting it did not drop the header — it sent one with a
    // blank event key. Nothing on the server suppresses on this value, so a
    // waiver request is never silently swallowed by an opt-out.
    unsubscribe: { recipientEmail: recipient, eventKey: 'lien_waiver', enabled: true },
  });

  // sendEmail's `success` is TRUE only for outcome 'sent' — Resend accepted it,
  // or the GC's own mail app reported it sent from the composer fallback. A
  // draft we merely opened, a cancelled composer and a hard failure are all
  // false. Telling the GC "requested" for a draft sitting in Mail is how a
  // waiver goes un-chased for a month.
  if (!result.success) return { outcome: 'email_failed', signUrl, error: result.error };
  return { outcome: 'sent', signUrl };
}
