// utils/proofPack/store.ts — where a made Pay Period Record is kept, what is
// READ from the server to class its records, and the one thing that is SENT.
//
// KEPT, IN TWO PLACES:
//   1. THIS DEVICE. The record's data (the exact object the fingerprint was
//      taken over) is kept in AsyncStorage under `mageid_proof_packs_<projectId>`
//      (an owned prefix: utils/localCacheKeys.ts sweeps it on sign-out). It is
//      what "open it again" re-fingerprints. The newest PROOF_PACKS_KEPT per
//      project are kept.
//   2. THE SERVER. ONLY the fingerprint record
//      (supabase/migrations/20261009120000_proof_packs.sql). Exactly what is
//      sent is in fingerprintRecordArgs: the project id, the pay document's
//      kind and id, the fingerprint, how many records are listed and how many
//      were left out, the first letter of the project name and the city. On a
//      phone the PDF file's own SHA-256 follows. No amount, no name, no street
//      address, no photo. The server sets the time and derives the check code.
//
// READ, AT BUILD TIME (readProofServerFacts). A label above Recorded needs a
// fact read from the server when the document is made (utils/proofPack/core
// header), so five things are read fresh, each reduced HERE to the few fields
// the record may carry: the pay application's row, the change order approval
// rows, the punch seal, how each lien waiver was signed, and the field
// tickets. A read that fails gives `undefined`, and the core then never awards
// the label that read would have justified.
//
// Two columns may not exist yet: change_order_approvals.recorded_via and
// lien_waivers.signed_via arrive with 20261010090000_signature_provenance.sql
// (NOT APPLIED). Each read asks for the column, and when the server answers
// that there is no such column it asks again without it and reports "not
// known" (null), which the core classes as Recorded. So this file is correct
// before and after that migration is applied.
//
// Nothing here calls a model, and nothing uploads the record or its PDF.
//
// Both server WRITES go through the online-only door (utils/offlineQueue
// supabaseRpcOnline): a fingerprint record needs a live answer and is never
// queued. Until the migration is applied the call fails, the caller gets
// `null`, and the document prints "No fingerprint is on file for this copy".
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { supabaseRpcOnline } from '@/utils/offlineQueue';
import { canonicalJson } from '@/supabase/functions/_shared/punchSealManifest';
import {
  parseCoConsentRecord,
  type ProofCoApprovalRecord, type ProofFieldTicketServerRecord, type ProofPack, type ProofPayAppServerRecord,
  type ProofPayRef, type ProofPunchSealRecord,
} from '@/utils/proofPack/core';
import type { ProofDocLang } from '@/utils/proofPack/docCopy';
import {
  SHA256_HEX, compareFingerprint, proofPackFingerprint,
  type ProofCheck, type ProofFingerprint, type Sha256Hex,
} from '@/utils/proofPack/fingerprint';

export const PROOF_PACKS_KEY_PREFIX = 'mageid_proof_packs_';
export const PROOF_PACKS_KEPT = 12;

export function proofPacksKey(projectId: string): string {
  return `${PROOF_PACKS_KEY_PREFIX}${projectId}`;
}

/** SHA-256 of a text on the device (expo-crypto), lower-case hex. */
export const sha256HexOnDevice: Sha256Hex = async (text) =>
  (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX })).toLowerCase();

export interface SavedProofPack {
  pack: ProofPack;
  lang: ProofDocLang;
  fingerprint: ProofFingerprint;
  /** proof_packs.id, or null when no record is on file. */
  serverId: string | null;
  /** proof_packs.created_at (the server's clock), or null. */
  serverCreatedAt: string | null;
  /** SHA-256 of the PDF file the phone made, when one was attached. */
  pdfHash: string | null;
}

export async function readSavedProofPacks(projectId: string): Promise<SavedProofPack[]> {
  try {
    const raw = await AsyncStorage.getItem(proofPacksKey(projectId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.pack && x.fingerprint && typeof x.fingerprint.hash === 'string') : [];
  } catch {
    return [];
  }
}

/** Newest first; one entry per fingerprint. Never throws (a full disk loses the copy, not the share). */
export async function saveProofPack(entry: SavedProofPack): Promise<boolean> {
  try {
    const prior = await readSavedProofPacks(entry.pack.project.id);
    const next = [entry, ...prior.filter((p) => p.fingerprint.hash !== entry.fingerprint.hash)].slice(0, PROOF_PACKS_KEPT);
    await AsyncStorage.setItem(proofPacksKey(entry.pack.project.id), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** The city out of a free-text location: the part before the last comma group, capped. '' when unsure. */
export function cityOfLocation(location: string): string {
  const parts = (location ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  // "123 Main St, Baltimore, MD 21201" gives Baltimore; "Baltimore, MD" gives Baltimore.
  const city = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  return /\d/.test(city) ? '' : city.slice(0, 80);
}

/**
 * Exactly what the server is sent: the project id, the pay document's kind and
 * id, the fingerprint, two counts, one letter of the project name and the
 * city. One place, so a test can read every field and the review screen's
 * privacy sentence can be held to it.
 */
export function fingerprintRecordArgs(pack: ProofPack, fp: ProofFingerprint): Record<string, unknown> {
  return {
    p_project_id: pack.project.id,
    p_pay_kind: pack.pay.kind,
    p_pay_id: pack.pay.id,
    p_content_hash: fp.hash,
    p_item_count: pack.items.length,
    p_left_out_count: pack.leftOut.total,
    p_project_initial: (pack.project.name.trim()[0] ?? '').toUpperCase(),
    p_city: cityOfLocation(pack.project.location),
  };
}

export interface FiledFingerprint { id: string; createdAt: string; pdfHash: string | null }

/** Puts the fingerprint on file. null = it is NOT on file (offline, refused, or the table is not there yet). */
export async function fileFingerprint(pack: ProofPack, fp: ProofFingerprint): Promise<FiledFingerprint | null> {
  try {
    const res = await supabaseRpcOnline<{ id?: string; created_at?: string; content_hash?: string; pdf_hash?: string | null }>(
      'proof_pack_create_v1', fingerprintRecordArgs(pack, fp),
    );
    const d = res.status === 'synced' ? res.data : null;
    if (!d || typeof d.id !== 'string' || typeof d.created_at !== 'string' || d.content_hash !== fp.hash) return null;
    return { id: d.id, createdAt: d.created_at, pdfHash: typeof d.pdf_hash === 'string' ? d.pdf_hash : null };
  } catch {
    return null;
  }
}

/** Attaches the PDF file's fingerprint, once. Returns the hash now on file, or null when nothing is. */
export async function attachFileFingerprint(serverId: string, pdfHash: string): Promise<string | null> {
  if (!SHA256_HEX.test(pdfHash)) return null;
  try {
    const res = await supabaseRpcOnline<{ pdf_hash?: string | null }>('proof_pack_attach_pdf_v1', { p_id: serverId, p_pdf_hash: pdfHash });
    const h = res.status === 'synced' ? res.data?.pdf_hash : null;
    return typeof h === 'string' ? h : null;
  } catch {
    return null;
  }
}

export interface FingerprintOnFile { hash: string; createdAt: string; pdfHash: string | null }

/** Reads the record back. null = asked and none on file; undefined = could not ask. */
export async function readFingerprintOnFile(serverId: string | null): Promise<FingerprintOnFile | null | undefined> {
  if (!serverId) return null;
  try {
    const { data, error } = await supabase
      .from('proof_packs')
      .select('content_hash, created_at, pdf_hash')
      .eq('id', serverId)
      .maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    const row = data as { content_hash?: string; created_at?: string; pdf_hash?: string | null };
    if (typeof row.content_hash !== 'string' || typeof row.created_at !== 'string') return undefined;
    return { hash: row.content_hash, createdAt: row.created_at, pdfHash: row.pdf_hash ?? null };
  } catch {
    return undefined;
  }
}

// ── What is read from the server at build time ─────────────────────────────

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** PostgREST's answer for "you named a column this table does not have". */
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message ?? '');
}

export const CO_APPROVAL_COLUMNS = 'change_order_id, decision, signer_name, created_at, document_hash, signature_hash, consent_record';
export const CO_APPROVAL_MARK_COLUMN = 'recorded_via';

/**
 * One approval row, reduced. The row's own record (consent_record) is read
 * only to take three lines out of it (number, scope, amount) and only when its
 * SHA-256 equals the row's document_hash; the text itself, which carries a
 * browser string, goes no further than this function.
 */
export async function reduceCoApprovalRow(raw: Row, sha256Hex: Sha256Hex): Promise<ProofCoApprovalRecord | null> {
  const decision = raw.decision === 'approved' ? 'approved' : raw.decision === 'declined' ? 'declined' : null;
  if (!decision || typeof raw.change_order_id !== 'string' || typeof raw.created_at !== 'string') return null;
  const documentHash = str(raw.document_hash).toLowerCase();
  const record = str(raw.consent_record);
  let signedTerms: ProofCoApprovalRecord['signedTerms'] = null;
  if (record && SHA256_HEX.test(documentHash)) {
    let actual = '';
    try { actual = (await sha256Hex(record)).toLowerCase(); } catch { actual = ''; }
    if (actual === documentHash) signedTerms = parseCoConsentRecord(record);
  }
  const via = str(raw[CO_APPROVAL_MARK_COLUMN]).trim();
  return {
    changeOrderId: raw.change_order_id,
    decision,
    signerName: str(raw.signer_name).trim(),
    serverCreatedAt: raw.created_at,
    documentHash,
    hasSignature: str(raw.signature_hash).length > 0,
    recordedVia: via || null,
    signedTerms,
  };
}

/**
 * The approval rows for a project's change orders, as the SERVER holds them,
 * newest first. undefined = could not read.
 */
export async function readCoApprovalRecords(projectId: string, sha256Hex: Sha256Hex = sha256HexOnDevice): Promise<ProofCoApprovalRecord[] | undefined> {
  try {
    const ask = (columns: string) => supabase
      .from('change_order_approvals')
      .select(columns)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    let res = await ask(`${CO_APPROVAL_COLUMNS}, ${CO_APPROVAL_MARK_COLUMN}`);
    if (res.error && isMissingColumn(res.error)) res = await ask(CO_APPROVAL_COLUMNS);
    if (res.error) return undefined;
    const out: ProofCoApprovalRecord[] = [];
    for (const raw of (res.data ?? []) as unknown as Row[]) {
      const r = await reduceCoApprovalRow(raw, sha256Hex);
      if (r) out.push(r);
    }
    return out;
  } catch {
    return undefined;
  }
}

export const PAY_APP_SERVER_COLUMNS = 'id, certified_at, application_number, period_to, original_contract_sum, net_change_by_co, contract_sum_to_date, less_previous_certificates, lines, snapshot_totals';

/** An aia_pay_apps row reduced to the figures the document prints and the lock stamp. */
export function reducePayAppRow(raw: Row): ProofPayAppServerRecord | null {
  if (typeof raw.id !== 'string') return null;
  const snap = raw.snapshot_totals && typeof raw.snapshot_totals === 'object' ? raw.snapshot_totals as Row : null;
  const hasTotals = !!snap && typeof snap.currentPaymentDue === 'number';
  const extras = snap && snap.__mageCertificate && typeof snap.__mageCertificate === 'object' ? snap.__mageCertificate as Row : null;
  const lines = Array.isArray(raw.lines) ? raw.lines as Row[] : [];
  return {
    id: raw.id,
    lockedAt: str(raw.certified_at) || null,
    applicationNumber: numOrNull(raw.application_number) ?? 0,
    periodTo: str(raw.period_to) || null,
    periodFrom: extras ? (str(extras.periodFrom) || null) : null,
    originalContractSum: numOrNull(raw.original_contract_sum),
    netChangeByCO: numOrNull(raw.net_change_by_co),
    contractSumToDate: numOrNull(raw.contract_sum_to_date),
    lessPreviousCertificates: numOrNull(raw.less_previous_certificates),
    totals: hasTotals ? {
      totalCompletedAndStored: numOrNull(snap!.totalCompletedAndStored),
      totalRetainage: numOrNull(snap!.totalRetainage),
      totalEarnedLessRetainage: numOrNull(snap!.totalEarnedLessRetainage),
      currentPaymentDue: numOrNull(snap!.currentPaymentDue),
      balanceToFinish: numOrNull(snap!.balanceToFinish),
    } : null,
    lines: lines.filter((l) => l && typeof l === 'object' && typeof l.id === 'string').map((l) => ({
      id: l.id as string, itemNo: str(l.itemNo), description: str(l.description),
      scheduledValue: numOrNull(l.scheduledValue) ?? 0, thisPeriod: numOrNull(l.thisPeriod) ?? 0,
      materialsPresentlyStored: numOrNull(l.materialsPresentlyStored) ?? 0,
    })),
  };
}

/** The pay application as the server holds it. null = no such row; undefined = could not read. */
export async function readPayAppServerRecord(payAppId: string): Promise<ProofPayAppServerRecord | null | undefined> {
  try {
    const { data, error } = await supabase.from('aia_pay_apps').select(PAY_APP_SERVER_COLUMNS).eq('id', payAppId).maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    return reducePayAppRow(data as unknown as Row) ?? undefined;
  } catch {
    return undefined;
  }
}

export const PUNCH_SEAL_PROOF_COLUMNS = 'id, project_id, sealed_at, item_count, manifest, manifest_hash, signer_name, signer_role';

/**
 * A punch_seals row reduced to the manifest's own fields. The manifest is
 * re-fingerprinted here: a row whose stored fingerprint does not equal the
 * SHA-256 of its manifest is not used at all (undefined, "not checked").
 */
export async function reducePunchSealRow(raw: Row, sha256Hex: Sha256Hex): Promise<ProofPunchSealRecord | undefined> {
  const manifest = raw.manifest && typeof raw.manifest === 'object' ? raw.manifest as Row : null;
  const hash = str(raw.manifest_hash).toLowerCase();
  if (typeof raw.id !== 'string' || typeof raw.project_id !== 'string' || typeof raw.sealed_at !== 'string' || !manifest || !SHA256_HEX.test(hash)) return undefined;
  let actual = '';
  try { actual = (await sha256Hex(canonicalJson(manifest))).toLowerCase(); } catch { actual = ''; }
  if (actual !== hash || str(manifest.sealId) !== raw.id) return undefined;
  const items = Array.isArray(manifest.items) ? manifest.items as Row[] : [];
  return {
    id: raw.id,
    projectId: raw.project_id,
    sealedAt: raw.sealed_at,
    itemCount: numOrNull(raw.item_count) ?? items.length,
    manifestHash: hash,
    signerName: str(raw.signer_name).trim(),
    signerRole: str(raw.signer_role).trim(),
    items: items.filter((i) => i && typeof i.id === 'string').map((i) => ({
      id: i.id as string, description: str(i.description), location: str(i.location), closedAt: str(i.closedAt) || null,
    })),
  };
}

/** The sealed final punch as the server holds it. null = none on file; undefined = could not read. */
export async function readPunchSealRecord(projectId: string, sha256Hex: Sha256Hex = sha256HexOnDevice): Promise<ProofPunchSealRecord | null | undefined> {
  try {
    const { data, error } = await supabase.from('punch_seals').select(PUNCH_SEAL_PROOF_COLUMNS).eq('project_id', projectId).maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    return await reducePunchSealRow(data as unknown as Row, sha256Hex);
  } catch {
    return undefined;
  }
}

export const WAIVER_MARK_COLUMN = 'signed_via';

/**
 * How each lien waiver's signature was made, by waiver id, as the server
 * marks it. undefined = could not read, OR the column is not there yet: both
 * mean "not known", and no waiver is then called Signed.
 */
export async function readWaiverSignedVia(projectId: string): Promise<Record<string, string | null> | undefined> {
  try {
    const { data, error } = await supabase.from('lien_waivers').select(`id, ${WAIVER_MARK_COLUMN}`).eq('project_id', projectId);
    if (error) return undefined;
    const out: Record<string, string | null> = {};
    for (const raw of (data ?? []) as unknown as Row[]) {
      if (typeof raw.id === 'string') out[raw.id] = str(raw[WAIVER_MARK_COLUMN]).trim() || null;
    }
    return out;
  } catch {
    return undefined;
  }
}

export const FIELD_TICKET_SERVER_COLUMNS = 'id, status, number, date, work_description, labor, authorization';

/** A field_tickets row reduced to counts, hours and the signature block's name, role and time. Never the labor rows. */
export function reduceFieldTicketRow(raw: Row): ProofFieldTicketServerRecord | null {
  if (typeof raw.id !== 'string') return null;
  const auth = raw.authorization && typeof raw.authorization === 'object' ? raw.authorization as Row : null;
  const labor = Array.isArray(raw.labor) ? raw.labor as Row[] : [];
  return {
    id: raw.id,
    status: str(raw.status),
    number: numOrNull(raw.number) ?? 0,
    date: str(raw.date),
    workDescription: str(raw.work_description),
    hasAuthorization: !!auth,
    signerName: auth ? str(auth.name) : '',
    signerRole: auth ? str(auth.role) : '',
    signedAt: auth ? (str(auth.signedAt) || null) : null,
    workerCount: labor.length,
    totalHours: labor.reduce((n, r) => n + (r && typeof r === 'object' ? (numOrNull(r.hours) ?? 0) : 0), 0),
  };
}

/** A project's field tickets as the server holds them, by id. undefined = could not read. */
export async function readFieldTicketServerRecords(projectId: string): Promise<Record<string, ProofFieldTicketServerRecord> | undefined> {
  try {
    const { data, error } = await supabase.from('field_tickets').select(FIELD_TICKET_SERVER_COLUMNS).eq('project_id', projectId);
    if (error) return undefined;
    const out: Record<string, ProofFieldTicketServerRecord> = {};
    for (const raw of (data ?? []) as unknown as Row[]) {
      const r = reduceFieldTicketRow(raw);
      if (r) out[r.id] = r;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Everything the core needs from the server to class records. Each part is undefined when its read failed. */
export interface ProofServerFacts {
  payAppServer: ProofPayAppServerRecord | null | undefined;
  coSignatures: ProofCoApprovalRecord[] | undefined;
  punchSeal: ProofPunchSealRecord | null | undefined;
  waiverSignedVia: Record<string, string | null> | undefined;
  fieldTicketServer: Record<string, ProofFieldTicketServerRecord> | undefined;
}

/** Nothing was read: every label that needs a server fact stays Recorded. */
export const NO_SERVER_FACTS: ProofServerFacts = {
  payAppServer: undefined, coSignatures: undefined, punchSeal: undefined, waiverSignedVia: undefined, fieldTicketServer: undefined,
};

/** Reads the five server facts, fresh. Never throws: a failed read is `undefined` for that part only. */
export async function readProofServerFacts(projectId: string, payRef: ProofPayRef): Promise<ProofServerFacts> {
  const [payAppServer, coSignatures, punchSeal, waiverSignedVia, fieldTicketServer] = await Promise.all([
    payRef.kind === 'pay_app' ? readPayAppServerRecord(payRef.id) : Promise.resolve(null),
    readCoApprovalRecords(projectId),
    readPunchSealRecord(projectId),
    readWaiverSignedVia(projectId),
    readFieldTicketServerRecords(projectId),
  ]);
  return { payAppServer, coSignatures, punchSeal, waiverSignedVia, fieldTicketServer };
}

export interface ProofReopenResult {
  check: ProofCheck;
  /** The fingerprint worked out now from the copy on this device. */
  recomputed: ProofFingerprint;
  onFile: FingerprintOnFile | null | undefined;
}

/** Open a saved package again: work the fingerprint out afresh and compare it with the server's. */
export async function recheckSavedProofPack(
  saved: SavedProofPack,
  deps: { sha256Hex?: Sha256Hex; read?: typeof readFingerprintOnFile } = {},
): Promise<ProofReopenResult> {
  const recomputed = await proofPackFingerprint(saved.pack, deps.sha256Hex ?? sha256HexOnDevice);
  const onFile = await (deps.read ?? readFingerprintOnFile)(saved.serverId);
  return { check: compareFingerprint(recomputed.hash, onFile === undefined ? undefined : onFile?.hash ?? null), recomputed, onFile };
}
