import type { ScanDocType, ScanDestination } from '@/types';

// Exhaustive: `satisfies` forces a compile error if a docType is missing.
const ROUTING = {
  invoice:            { folder: 'financials',    recordKind: 'cost' },
  delivery_ticket:    { folder: 'daily-reports', recordKind: 'file_only' },
  permit:             { folder: 'permits',       recordKind: 'file_only' },
  insurance_coi:      { folder: 'contracts',     recordKind: 'sub_compliance' },
  contract:           { folder: 'contracts',     recordKind: 'file_only' },
  business_card:      { folder: 'photos',        recordKind: 'contact' },
  spec_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  plan_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  equipment_nameplate:{ folder: 'photos',        recordKind: 'file_only' },
  material_tag:       { folder: 'photos',        recordKind: 'file_only' },
  warranty:           { folder: 'closeout',      recordKind: 'file_only' },
  inspection_notice:  { folder: 'photos',        recordKind: 'file_only' },
  government_id:      { folder: 'photos',        recordKind: 'file_only' }, // never reached (redirect)
  other:              { folder: 'photos',        recordKind: 'file_only' },
} satisfies Record<ScanDocType, ScanDestination>;

export function resolveDestination(docType: ScanDocType): ScanDestination {
  return ROUTING[docType] ?? ROUTING.other;
}

export function defaultTitleFor(docType: ScanDocType, fields: Record<string, unknown>): string {
  const s = (k: string) => (typeof fields[k] === 'string' ? (fields[k] as string) : '');
  switch (docType) {
    case 'invoice': return s('vendor') ? `Invoice — ${s('vendor')}` : 'Invoice';
    case 'permit': return s('permitNumber') ? `Permit ${s('permitNumber')}` : 'Permit';
    case 'insurance_coi': return s('insured') ? `COI — ${s('insured')}` : 'Certificate of Insurance';
    case 'business_card': return s('name') || s('company') || 'Business Card';
    case 'delivery_ticket': return s('supplier') ? `Delivery — ${s('supplier')}` : 'Delivery Ticket';
    case 'warranty': return s('product') ? `Warranty — ${s('product')}` : 'Warranty';
    case 'equipment_nameplate': return [s('make'), s('model')].filter(Boolean).join(' ') || 'Equipment';
    case 'material_tag': return s('product') || s('sku') || 'Material';
    default: return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
