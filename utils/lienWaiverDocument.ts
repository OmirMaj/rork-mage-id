// lienWaiverDocument — the printable lien waiver, as a pure function.
//
// Split out of lienWaiverEngine.ts for one reason: the engine imports
// react-native, expo-print and the Supabase client, and bun cannot parse those,
// so nothing in it can be driven by a validator. The rendering that MATTERS —
// whether Georgia's notice paragraph survives onto the page, whether a
// statutory form still carries its citation and "text as of" date, whether the
// general-form warning stays off a statutory form — lives here, where
// scripts/validate-lien-waivers.ts can call it and read the actual HTML rather
// than grep the source for a string it hopes is used.
//
// Imports nothing but pure modules (pdfDesign, lienWaiverForms,
// codeJurisdiction) and types.

import {
  pdfShell, pdfHeader, pdfFooter, escHtml, fmtMoney, fmtDate, PDF_PALETTE,
} from './pdfDesign';
import {
  statutoryFormFor, isStatutoryWaiverState, GENERIC_FORM_WARNING,
  STATUTE_TEXT_AS_OF, STATUTE_VERIFY_LINE,
  type StatutoryWaiverForm, type WaiverFill,
} from './lienWaiverForms';
import { formatCalendarDay } from './calendarDate';
import { jobsiteAddressForProject, normalizeState } from './codeJurisdiction';
import type { LienWaiver, LienWaiverType, CompanyBranding } from '@/types';

// ─── Display helpers ────────────────────────────────────────────────
export const WAIVER_LABELS: Record<LienWaiverType, { short: string; long: string; description: string }> = {
  conditional_partial: {
    short: 'Conditional Partial',
    long:  'Conditional Waiver and Release on Progress Payment',
    description: 'Sub releases lien rights up to the paid amount, IF and ONLY IF the payment actually clears.',
  },
  unconditional_partial: {
    short: 'Unconditional Partial',
    long:  'Unconditional Waiver and Release on Progress Payment',
    description: 'Sub confirms payment received and releases lien rights up to the paid amount. Use only after funds have cleared.',
  },
  conditional_final: {
    short: 'Conditional Final',
    long:  'Conditional Waiver and Release on Final Payment',
    description: 'Sub releases all remaining lien rights, IF and ONLY IF the final payment clears.',
  },
  unconditional_final: {
    short: 'Unconditional Final',
    long:  'Unconditional Waiver and Release on Final Payment',
    description: 'Sub confirms full payment received and releases all lien rights. Use only after final funds have cleared.',
  },
};

// ─── PDF ───────────────────────────────────────────────────────────

/**
 * Everything the document needs that does not live on the waiver row.
 *
 * `jobsiteState` decides which form gets printed, so it is resolved from the
 * project once, by the caller, using the same jobsiteAddressForProject the
 * Code Check screen uses — a two-letter code or ''. An unresolvable address
 * yields '' and the general form, never a guess at a state whose statutory
 * form would then be wrong for the property.
 */
export interface LienWaiverDocContext {
  projectName: string;
  /** Free-text jobsite address as it should appear on the document. */
  projectAddress?: string;
  /** Two-letter US state code for the jobsite, or '' when unresolved. */
  jobsiteState?: string;
  /** The property owner, where the app knows one (project.primaryContact). */
  ownerName?: string;
  /** What the sub furnished — the commitment/invoice description. */
  jobDescription?: string;
}

/**
 * Build the document context from a project.
 *
 * The jobsite state comes from jobsiteAddressForProject — the same resolution
 * Code Check uses — so a project whose address only exists as free text
 * ("Austin TX", "124 Park Slope, Brooklyn NY 11215") still lands on the right
 * statutory form, and one with no usable address lands on the general form
 * rather than on some other state's.
 */
export function lienWaiverDocContext(
  project: { name: string; location?: string | null; structuredAddress?: { street?: string; city?: string; state?: string; zip?: string; county?: string } | null; primaryContact?: { name?: string } | null } | null | undefined,
  extras?: { jobDescription?: string },
): LienWaiverDocContext {
  const addr = jobsiteAddressForProject(project ?? null);
  const structured = [addr.street, addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')]
    .map(s => (s ?? '').trim()).filter(Boolean).join(', ');
  const freeText = (project?.location ?? '').trim();
  // The address on a lien waiver IS the property description — Florida's
  // § 713.20 form releases the lien on "the following described property:" and
  // prints nothing but this line. jobsiteAddressForProject only PARSES a
  // free-text location, so a project stored as "124 Main St, Springfield CA
  // 90210" comes back street:'' city:'Springfield' state:'CA', and taking the
  // parsed form there printed "Springfield, CA" — a release with no house
  // number on it, where the previous code printed the GC's own full text. So
  // the parse only wins when it actually carries a street; otherwise the text
  // the GC typed does, because it is the complete one.
  const printable = addr.street ? structured : (freeText || structured);
  return {
    projectName: project?.name ?? 'Project',
    projectAddress: printable || undefined,
    // Normalised, because only the free-text branch of jobsiteAddressForProject
    // runs its answer through normalizeState — a structuredAddress hands back
    // whatever string is stored, and the field is a plain `string`. A project
    // whose structured state reads "California" matched nothing in
    // isStatutoryWaiverState (which only trims and upper-cases) and printed the
    // GENERAL form on a California job: the precise silent failure this whole
    // module exists to prevent, and one the document gives no sign of. An
    // unrecognisable value normalises to '' and lands on the general form,
    // which is the safe direction — never another state's form.
    jobsiteState: normalizeState(addr.state),
    ownerName: project?.primaryContact?.name ?? '',
    jobDescription: extras?.jobDescription ?? '',
  };
}

/** The GC's own company name, as it should read on a statutory form. */
function customerNameOf(branding: CompanyBranding): string {
  return (branding.companyName || '').trim();
}

/**
 * The signature strokes as a list of SVG path strings, whatever shape they
 * arrived in.
 *
 * `ContractSignature.signaturePaths` is typed `string[]`, and that is what the
 * in-app SignaturePad writes. The subcontractor's own signature does NOT come
 * back that way: `lien_waiver_submit_signature` declares `p_signature_paths
 * text` and stores it with `jsonb_build_object`, so a sub-signed waiver holds
 * a JSON *string* in that slot. Calling `.map` on it threw
 * "signaturePaths.map is not a function" and took down the GC's PDF export for
 * exactly the waivers that had actually been signed — the ones that matter.
 * Parsed here rather than at the row mapper because this is the only place the
 * strokes are read, and a malformed value must degrade to a name-only
 * signature block, never to a blank page.
 */
function signaturePathList(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter(d => typeof d === 'string' && d.trim().length > 0);
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((d): d is string => typeof d === 'string' && d.trim().length > 0);
      }
    } catch {
      // A truncated or hand-edited value. Fall through: better a signature
      // block with the signer's name and no strokes than no document.
      return [];
    }
    return [];
  }
  // A single un-wrapped path — accepted so a simpler client can post one.
  return [text];
}

/**
 * The form's IDENTITY, resolved once: what the document is titled, which
 * statute it follows, and whose. `requestLienWaiverSignature` seals this
 * alongside the document bytes, and the signing page renders it in its own
 * chrome above the sealed HTML.
 *
 * The KEYS ARE A CONTRACT with `lien_waiver_get_for_signing`, which reads
 * `sign_form_meta->>'waiver_title'`, `->>'statute_citation'` and
 * `->>'state_name'`. Rename one here and the sub sees a bare "Lien waiver"
 * with no citation, on a document whose entire point is that it follows a
 * named statute — so scripts/validate-lien-waivers.ts pins all three.
 */
export interface LienWaiverFormMeta {
  waiver_title: string;
  statute_citation: string;
  state_name: string;
}

export function lienWaiverFormMeta(
  waiver: LienWaiver, branding: CompanyBranding, ctx: LienWaiverDocContext,
): LienWaiverFormMeta {
  const form = statutoryFormFor(ctx.jobsiteState, waiver.waiverType, waiverFillFor(waiver, branding, ctx));
  if (!form) {
    // A general-form job. Empty citation and state are what the RPC's
    // coalesce already falls back to, and the page hides the eyebrow when the
    // citation is blank — it must not print "statutory form" for a state that
    // prescribes none.
    return { waiver_title: WAIVER_LABELS[waiver.waiverType].long, statute_citation: '', state_name: '' };
  }
  return { waiver_title: form.heading, statute_citation: form.citation, state_name: form.stateName };
}

function waiverFillFor(
  waiver: LienWaiver, branding: CompanyBranding, ctx: LienWaiverDocContext,
): WaiverFill {
  return {
    claimantName: waiver.subName,
    customerName: customerNameOf(branding),
    ownerName: ctx.ownerName ?? '',
    jobLocation: ctx.projectAddress ?? '',
    jobDescription: ctx.jobDescription ?? '',
    projectName: ctx.projectName,
    // A calendar day, not an instant: the waiver runs through the END of this
    // day on the jobsite. formatCalendarDay splits the 'YYYY-MM-DD' on its own
    // digits instead of handing it to `new Date()`, which reads a bare day as
    // UTC midnight and names the day before west of Greenwich.
    //
    // Formatted HERE, at the boundary, because the statutory blanks print
    // whatever string they are given: left raw, § 8132's "Through Date" blank
    // read "2026-08-31" while the facts table three inches below it read
    // "Aug 31, 2026" — one page stating the release date two different ways.
    throughDate: formatCalendarDay(waiver.throughDate),
    // Money OUT of the GC to the sub — a cost on the GC's books, and the
    // consideration this release is given for.
    amount: waiver.paidAmount,
    checkMaker: customerNameOf(branding),
    checkPayee: waiver.subName,
  };
}

/** Renders one statutory form's blocks as the document body. */
function statutoryBodyHtml(form: StatutoryWaiverForm): string {
  const blocks = form.blocks.map(b => {
    switch (b.kind) {
      case 'notice':
        return `<div style="margin:16px 0;padding:14px 16px;border:2px solid ${PDF_PALETTE.ink};border-radius:8px;background:${PDF_PALETTE.surface};font-size:11.5px;font-weight:800;line-height:1.55;color:${PDF_PALETTE.ink};letter-spacing:0.2px">${escHtml(b.text)}</div>`;
      case 'subheading':
        return `<div style="margin:20px 0 8px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${PDF_PALETTE.text2}">${escHtml(b.text)}</div>`;
      case 'fields':
        return `<table style="width:100%;border-collapse:collapse;margin:8px 0 12px">${b.rows.map(r => `
          <tr>
            <td style="padding:8px 12px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.5px;color:${PDF_PALETTE.textMuted};text-transform:uppercase;width:34%">${escHtml(r.label)}</td>
            <td style="padding:8px 12px;border:1px solid ${PDF_PALETTE.bone};font-size:12.5px;color:${PDF_PALETTE.text}">${escHtml(r.value)}</td>
          </tr>`).join('')}</table>`;
      case 'para':
      default:
        return `<p style="margin:0 0 12px;font-size:12.5px;line-height:1.7;color:${PDF_PALETTE.text}">${escHtml(b.text)}</p>`;
    }
  }).join('');

  const substitution = form.substitution
    ? `<div style="margin:14px 0;padding:12px 14px;background:${PDF_PALETTE.warningTint};border:1px solid ${PDF_PALETTE.warning}55;border-radius:10px;font-size:11px;line-height:1.6;color:${PDF_PALETTE.text}">${escHtml(form.substitution)}</div>`
    : '';

  return `
    <div style="text-align:center;margin:24px 0 20px">
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${PDF_PALETTE.amber};text-transform:uppercase;margin-bottom:6px">${escHtml(form.stateName)} statutory form · ${escHtml(form.citation)}</div>
      <div style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:700;letter-spacing:-0.4px;color:${PDF_PALETTE.ink};line-height:1.25">${escHtml(form.heading)}</div>
    </div>
    ${substitution}
    ${blocks}
  `;
}

/**
 * The provenance line every statutory form carries. Two facts, both load
 * bearing: WHICH statute this text came from, and HOW OLD our copy of it is.
 * Without the second, the document quietly claims a currency this app has no
 * way to know it has.
 */
function statuteProvenanceHtml(form: StatutoryWaiverForm): string {
  return `<div style="margin-top:24px;padding:14px 16px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};border-radius:10px;font-size:11px;color:${PDF_PALETTE.text};line-height:1.6">
    <strong>Form source.</strong> ${escHtml(form.stateName)} — ${escHtml(form.citation)}. Statutory text as of ${escHtml(STATUTE_TEXT_AS_OF)}.
    <div style="margin-top:6px;color:${PDF_PALETTE.text2}">${escHtml(STATUTE_VERIFY_LINE)}</div>
  </div>`;
}

export function buildLienWaiverHtml(
  waiver: LienWaiver,
  branding: CompanyBranding,
  ctx: LienWaiverDocContext,
): string {
  const meta = WAIVER_LABELS[waiver.waiverType];
  const projectName = ctx.projectName;
  const projectAddress = ctx.projectAddress;
  const isFinal = waiver.waiverType.includes('final');
  const isConditional = waiver.waiverType.includes('conditional');
  const statutory = statutoryFormFor(ctx.jobsiteState, waiver.waiverType, waiverFillFor(waiver, branding, ctx));

  const conditionalLanguage = isConditional ? `
    This release is CONDITIONAL upon the actual receipt by the undersigned of the payment amount stated above.
    If the payment is dishonored, withdrawn, or otherwise not actually received, this release is void.
  ` : '';

  const unconditionalLanguage = !isConditional ? `
    The undersigned has been paid in full for all labor, services, equipment, or material furnished
    through the Through Date stated above.
  ` : '';

  const finalLanguage = isFinal ? `
    This is a FINAL release. Upon receipt of the final payment stated above (or, in the case of a
    conditional release, upon clearance of that final payment), the undersigned waives and releases
    any and all mechanic's lien, stop notice, or bond claim rights on the property described above
    arising from labor, services, equipment, or materials furnished by the undersigned.
  ` : `
    This is a PROGRESS payment release. The undersigned waives and releases mechanic's lien, stop
    notice, and bond claim rights only with respect to the payment amount stated above and through
    the Through Date stated above, and reserves all other rights as to amounts not yet paid.
  `;

  // The signature block has to say WHO signed. A waiver the subcontractor
  // e-signed and one the GC recorded from a paper original are different legal
  // facts, and printing both as "Signed by Subcontractor" — which is what this
  // did while the GC typed the sub's name under role 'gc' — is the misstatement
  // that makes the document unusable in a dispute.
  const sig = waiver.subSignature;
  const signedByGc = sig?.role === 'gc';
  // The signing page asks the sub for their title and
  // `lien_waiver_submit_signature` stores it on the signature — and nothing
  // printed it, so a release came back signed "Jordan Reyes" with no statement
  // of the authority he signed under. Read off the record structurally rather
  // than through ContractSignature, which does not declare the field: the row
  // is written by SQL, and a type that has not caught up is not a reason to
  // throw away a fact the signer gave us.
  const signerTitle = (() => {
    const raw = (sig as { title?: unknown } | undefined)?.title;
    return typeof raw === 'string' ? raw.trim() : '';
  })();
  const strokePaths = signaturePathList(sig?.signaturePaths);
  const strokes = strokePaths.length > 0
    ? `<svg viewBox="0 0 400 120" preserveAspectRatio="xMinYMid meet" style="width:100%;max-width:340px;height:86px;background:${PDF_PALETTE.surface};margin-bottom:6px">
         ${strokePaths.map(d => `<path d="${escHtml(d)}" stroke="${PDF_PALETTE.ink}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />`).join('')}
       </svg>`
    : '';
  const sigBlock = sig ? `
    <div style="margin-top:36px;padding:20px;background:${PDF_PALETTE.cream2};border:1px solid ${signedByGc ? PDF_PALETTE.warning : PDF_PALETTE.bone};border-radius:12px">
      <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:${signedByGc ? PDF_PALETTE.warning : PDF_PALETTE.textMuted};text-transform:uppercase;margin-bottom:6px">${signedByGc ? 'Recorded by the contractor from a signed paper original' : 'Signed by the subcontractor'}</div>
      ${strokes}
      <div style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:700;font-style:italic;color:${PDF_PALETTE.ink};margin-bottom:4px">${escHtml(sig.name)}</div>
      <div style="font-size:11px;color:${PDF_PALETTE.textMuted}">${signedByGc ? 'Recorded' : 'Signed'} ${fmtDate(sig.signedAt)} · ${escHtml(waiver.subName)}${signerTitle ? ` · ${escHtml(signerTitle)}` : ''}</div>
      ${signedByGc ? `<div style="font-size:10.5px;color:${PDF_PALETTE.text2};margin-top:8px;line-height:1.55">This is the contractor's record that a signed paper waiver exists. It is not the subcontractor's signature; the paper original is the signed document.</div>` : ''}
    </div>
  ` : `
    <div style="margin-top:36px;padding:20px;border:2px dashed ${PDF_PALETTE.bone};border-radius:12px;text-align:center">
      <div style="font-size:11px;color:${PDF_PALETTE.textMuted};font-style:italic">Awaiting subcontractor signature</div>
      <div style="margin-top:24px;height:1.5px;background:${PDF_PALETTE.ink2};max-width:280px;margin-inline:auto"></div>
      <div style="font-size:10px;color:${PDF_PALETTE.textMuted};margin-top:6px">Subcontractor signature</div>
      <div style="margin-top:18px;height:1.5px;background:${PDF_PALETTE.ink2};max-width:280px;margin-inline:auto"></div>
      <div style="font-size:10px;color:${PDF_PALETTE.textMuted};margin-top:6px">Title &middot; Date</div>
    </div>
  `;

  const genericTitleHtml = `
    <div style="text-align:center;margin:24px 0 28px">
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${PDF_PALETTE.amber};text-transform:uppercase;margin-bottom:6px">Lien Waiver &amp; Release</div>
      <div style="font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:700;letter-spacing:-0.5px;color:${PDF_PALETTE.ink};line-height:1.2">${escHtml(meta.long)}</div>
    </div>`;

  // formatCalendarDay, NOT fmtDate. The through date is a calendar day the
  // parties agreed on. fmtDate runs it through `new Date()`, which reads a bare
  // 'YYYY-MM-DD' as UTC midnight and so printed the day BEFORE anywhere west of
  // Greenwich: a California waiver came out of Los Angeles with "August 30" in
  // this cell while the statutory blank three inches above it read the record's
  // own 2026-08-31 — one document naming two different release dates.
  const throughDateLabel = formatCalendarDay(waiver.throughDate);

  // CA §§ 8136/8138 and the final forms in TX, AZ, FL and GA print no through
  // date at all — a final release is not bounded by a day. Printing one anyway
  // in our own facts table, three inches under a statutory body that
  // deliberately omits it, hands the signer the argument that the release
  // stopped on that date. The general form keeps the row: its own paragraphs
  // say "through the Through Date stated above" and would dangle without it.
  const showThroughDate = !statutory || !isFinal;

  // Payment Amount is printed to the CENT, like the statutory blanks above it.
  // fmtMoney defaults to zero decimals and ROUNDS, so a release for $18,400.50
  // printed "$18,400.50" in § 8132's Amount of Check row and "$18,401" in this
  // table three inches below it — the same release stating two different
  // amounts on one page, the rounded one HIGHER than what the claimant was
  // actually paid. It is money OUT of the GC to the sub, and it is the
  // consideration the release is given for; it does not get rounded.
  const factsTableHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase;width:36%">Project</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(projectName)}</td>
      </tr>
      ${projectAddress ? `
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Property Address</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(projectAddress)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Subcontractor</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(waiver.subName)}</td>
      </tr>
      ${showThroughDate ? `
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Through Date</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(throughDateLabel)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Payment Amount</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:18px;color:${PDF_PALETTE.ink};font-weight:800">${fmtMoney(waiver.paidAmount, { decimals: 2 })}</td>
      </tr>
    </table>`;

  const genericBodyHtml = `
    <div style="font-size:13px;line-height:1.7;color:${PDF_PALETTE.text};margin-bottom:16px">
      <p style="margin:0 0 12px"><strong>${escHtml(waiver.subName)}</strong> ("Subcontractor"), having furnished labor, services, equipment, or material to the project identified above, hereby acknowledges and agrees:</p>
      <p style="margin:0 0 12px">${conditionalLanguage}${unconditionalLanguage}</p>
      <p style="margin:0 0 12px">${finalLanguage}</p>
      <p style="margin:0">This waiver shall be governed by the laws of the state in which the property is located. Subcontractor warrants that all suppliers, employees, and lower-tier subcontractors have been paid for the amounts covered by this release, or will be paid from the proceeds of the payment that triggers this release.</p>
    </div>`;

  // The old warning stays exactly where it was useful: on the general form, in
  // the states that do not prescribe one. On a statutory form it would be
  // false — the whole point of that page is that it IS the state's form.
  const genericWarningHtml = `
    <div style="margin-top:28px;padding:14px 16px;background:${PDF_PALETTE.amberTint};border:1px solid ${PDF_PALETTE.amber}40;border-radius:10px;font-size:11px;color:${PDF_PALETTE.text};line-height:1.6">
      <strong>Important.</strong> ${escHtml(GENERIC_FORM_WARNING)}
    </div>`;

  const bodyHtml = statutory
    ? `
      ${pdfHeader(branding)}
      ${statutoryBodyHtml(statutory)}
      ${factsTableHtml}
      ${sigBlock}
      ${statuteProvenanceHtml(statutory)}
      ${pdfFooter(branding, undefined, `Generated by MAGE ID from ${statutory.citation}. Not legal advice.`)}
    `
    : `
      ${pdfHeader(branding)}
      ${genericTitleHtml}
      ${factsTableHtml}
      ${genericBodyHtml}
      ${sigBlock}
      ${genericWarningHtml}
      ${pdfFooter(branding, undefined, 'Generated by MAGE ID. Not legal advice; consult an attorney for state-specific lien waiver requirements.')}
    `;

  return pdfShell({
    bodyHtml, branding,
    title: `${statutory ? statutory.heading : meta.short + ' Lien Waiver'} — ${projectName}`,
    pageMargin: '36px 40px',
  });
}

/**
 * The document a subcontractor is asked to sign, as one standalone HTML page.
 *
 * The signing page renders exactly these bytes in a sandboxed iframe rather
 * than rebuilding the form in JavaScript, so there is only ONE copy of the
 * statutory wording in the product. A second copy on the web page would drift,
 * and a drifted statutory form is the defect this whole change exists to fix.
 */
export function buildLienWaiverSignableHtml(
  waiver: LienWaiver, branding: CompanyBranding, ctx: LienWaiverDocContext,
): string {
  return buildLienWaiverHtml(waiver, branding, ctx);
}

/** Which form a waiver will print on, for UI that wants to say so up front. */
export function lienWaiverFormLabel(waiver: LienWaiver, ctx: LienWaiverDocContext): string {
  if (!isStatutoryWaiverState(ctx.jobsiteState)) return 'General form';
  const form = statutoryFormFor(ctx.jobsiteState, waiver.waiverType, {
    claimantName: '', customerName: '', ownerName: '', jobLocation: '', jobDescription: '',
    projectName: '', throughDate: '', amount: 0, checkMaker: '', checkPayee: '',
  });
  return form ? `${form.stateName} statutory form · ${form.citation}` : 'General form';
}
