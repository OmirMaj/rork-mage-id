// utils/registers/documentRows.ts — the desktop Documents register (wave 6d,
// lane R3): the row shape, where each row LINKS, the chip counts and the CSV.
//
// Documents is a read-only aggregator of COIs, permits, submittals and AIA pay
// apps; every record lives on its own screen. On the phone a tap routes there
// (app/documents.tsx handleDocPress, untouched). On desktop web each row is a
// real link (Cmd-click opens a new tab), and a COI row now opens THAT sub's
// certificates beside the vault list (/coi-vault?subId=…, lane R2) instead of
// the bare vault, where the sub was lost.
//
// PURE: type-only imports, so scripts/validate-registers-lead-doc.ts executes
// it under bun. It returns { pathname, params } — the register turns that into
// an Href with routeHref.

import type { Route } from 'expo-router';
import type { CertificateOfInsurance, DocumentType, SavedAIAPayApp } from '@/types';
import type { RegisterCsvColumn } from './registerCsv';
import { logDayKey } from '../logs/logRoutes';

export type DocumentBucket = 'at_risk' | 'awaiting' | 'draft' | 'done' | 'expired' | 'void';
export type DocumentTone = 'danger' | 'warning' | 'success' | 'neutral' | 'muted';

/** A structural copy of app/documents.tsx's (unexported) DocRow: the screen's
 *  DocRow[] is passed as DocumentRegisterRow[], so tsc proves they match. */
export interface DocumentRegisterRow {
  id: string;
  projectId: string;
  projectName: string;
  type: DocumentType;
  title: string;
  status: { bucket: DocumentBucket; label: string; tone: DocumentTone };
  createdAt: string;
  expiresAt?: string;
  notes?: string;
}

export interface DocumentRoute {
  pathname: Route;
  params?: Record<string, string>;
}

/**
 * Where a row opens — handleDocPress's table, with the COI row keeping its sub:
 *   coi         → /coi-vault { subId } (bare /coi-vault if the COI is gone)
 *   permit      → /permits
 *   aia_billing → /aia-pay-app { invoiceId }, else /project-detail { id }
 *   submittal-… → /submittal { projectId, submittalId } (6c's split)
 *   anything else → /project-detail { id: projectId }
 */
export function documentRoute(
  doc: Pick<DocumentRegisterRow, 'id' | 'type' | 'projectId'>,
  cois: readonly Pick<CertificateOfInsurance, 'id' | 'subcontractorId'>[],
  aiaPayApps: readonly Pick<SavedAIAPayApp, 'id' | 'invoiceId'>[],
): DocumentRoute {
  if (doc.type === 'coi') {
    const subId = cois.find((c) => 'coi-' + c.id === doc.id)?.subcontractorId;
    return subId ? { pathname: '/coi-vault', params: { subId } } : { pathname: '/coi-vault' };
  }
  if (doc.type === 'permit') return { pathname: '/permits' };
  if (doc.type === 'aia_billing') {
    const payApp = aiaPayApps.find((a) => 'aia-' + a.id === doc.id);
    return payApp?.invoiceId
      ? { pathname: '/aia-pay-app', params: { invoiceId: payApp.invoiceId } }
      : { pathname: '/project-detail', params: { id: doc.projectId } };
  }
  if (doc.id.startsWith('submittal-')) {
    return { pathname: '/submittal', params: { projectId: doc.projectId, submittalId: doc.id.slice('submittal-'.length) } };
  }
  return { pathname: '/project-detail', params: { id: doc.projectId } };
}

/** The phone card's "Expires …" rule (documents.tsx isExpiringSoon): within 30
 *  days, still ahead, and not already expired or void. */
export function documentExpiringSoon(doc: Pick<DocumentRegisterRow, 'expiresAt' | 'status'>, nowMs: number): boolean {
  if (!doc.expiresAt || doc.status.bucket === 'expired' || doc.status.bucket === 'void') return false;
  const diff = new Date(doc.expiresAt).getTime() - nowMs;
  return diff > 0 && diff < 30 * 86400000;
}

export type DocumentChip = 'all' | Exclude<DocumentBucket, 'void'>;

/** The phone's filter chips, in its order and words. */
export const DOCUMENT_CHIPS: readonly { key: DocumentChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'awaiting', label: 'Waiting' },
  { key: 'draft', label: 'Saved' },
  { key: 'done', label: 'Done' },
  { key: 'expired', label: 'Expired' },
];

export function documentChipCounts(rows: readonly Pick<DocumentRegisterRow, 'status'>[]): Record<DocumentChip, number> {
  const out: Record<DocumentChip, number> = { all: rows.length, at_risk: 0, awaiting: 0, draft: 0, done: 0, expired: 0 };
  for (const r of rows) {
    const b = r.status.bucket;
    if (b !== 'void') out[b]++;
  }
  return out;
}

/** The phone's filter: 'all' is everything (void included), a bucket its own. */
export function documentChipMatches(row: Pick<DocumentRegisterRow, 'status'>, chip: DocumentChip): boolean {
  return chip === 'all' || row.status.bucket === chip;
}

/** The phone card's type tag words (mocks/documents documentTypeInfo). */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  lien_waiver: 'Lien Waiver',
  coi: 'COI',
  contract: 'Contract',
  proposal: 'Proposal',
  aia_billing: 'AIA Billing',
  permit: 'Permit',
};

/** The Type column's word: the phone tag's; a submittal (typed 'other' by the
 *  feed, and tagged 'Other' on the phone) says what it is; else 'Other'. */
export function documentTypeLabel(doc: Pick<DocumentRegisterRow, 'id' | 'type'>): string {
  if (doc.id.startsWith('submittal-')) return 'Submittal';
  return TYPE_LABEL[doc.type] ?? 'Other';
}

export const DOCUMENT_CSV_COLUMNS: readonly RegisterCsvColumn<DocumentRegisterRow>[] = [
  { key: 'type', label: 'Type', csvValue: (r) => documentTypeLabel(r) },
  { key: 'title', label: 'Title', csvValue: (r) => r.title },
  { key: 'status', label: 'Status', csvValue: (r) => r.status.label },
  { key: 'date', label: 'Date', csvValue: (r) => logDayKey(r.createdAt) },
  { key: 'expires', label: 'Expires', csvValue: (r) => logDayKey(r.expiresAt) },
  { key: 'project', label: 'Project', csvValue: (r) => r.projectName },
  { key: 'notes', label: 'Notes', csvValue: (r) => (r.notes && r.notes.trim() ? r.notes.trim() : null) },
];
