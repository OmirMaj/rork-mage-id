import type { Permit } from '@/types';

export const MOCK_PERMITS: Permit[] = [
  {
    id: 'pmt-1',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'building',
    permitNumber: 'BP-2026-04521',
    jurisdiction: 'City of Brooklyn, NY',
    status: 'approved',
    appliedDate: '2025-11-20T00:00:00Z',
    approvedDate: '2025-12-15T00:00:00Z',
    expiresDate: '2026-12-15T00:00:00Z',
    fee: 1250,
  },
  {
    id: 'pmt-2',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'electrical',
    permitNumber: 'EP-2026-01893',
    jurisdiction: 'City of Brooklyn, NY',
    status: 'inspection_scheduled',
    appliedDate: '2025-12-01T00:00:00Z',
    approvedDate: '2025-12-20T00:00:00Z',
    inspectionDate: '2026-04-18T09:00:00Z',
    fee: 450,
    notes: 'Rough-in inspection',
  },
  {
    id: 'pmt-3',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'plumbing',
    permitNumber: 'PP-2026-00782',
    jurisdiction: 'City of Brooklyn, NY',
    status: 'inspection_passed',
    appliedDate: '2025-12-05T00:00:00Z',
    approvedDate: '2025-12-22T00:00:00Z',
    inspectionDate: '2026-03-10T10:00:00Z',
    inspectionNotes: 'All connections passed. No issues.',
    fee: 375,
  },
  {
    id: 'pmt-4',
    projectId: 'p-2',
    projectName: 'Bathroom Remodel - Johnson',
    type: 'building',
    jurisdiction: 'Town of Hempstead, NY',
    status: 'under_review',
    appliedDate: '2026-03-01T00:00:00Z',
    fee: 800,
    notes: 'Structural modification requires engineer sign-off',
  },
  {
    id: 'pmt-5',
    projectId: 'p-2',
    projectName: 'Bathroom Remodel - Johnson',
    type: 'plumbing',
    jurisdiction: 'Town of Hempstead, NY',
    status: 'applied',
    appliedDate: '2026-03-05T00:00:00Z',
    fee: 300,
  },
  {
    id: 'pmt-6',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'fire',
    permitNumber: 'FP-2026-00145',
    jurisdiction: 'City of Brooklyn, NY',
    status: 'inspection_failed',
    appliedDate: '2026-01-10T00:00:00Z',
    approvedDate: '2026-01-25T00:00:00Z',
    inspectionDate: '2026-03-20T14:00:00Z',
    inspectionNotes: 'Smoke detector placement non-compliant. Reschedule after correction.',
    fee: 200,
  },
];

export const PERMIT_TYPE_INFO: Record<string, { label: string; color: string }> = {
  building: { label: 'Building', color: '#1565C0' },
  electrical: { label: 'Electrical', color: '#F9A825' },
  plumbing: { label: 'Plumbing', color: '#00838F' },
  mechanical: { label: 'Mechanical', color: '#6A1B9A' },
  demolition: { label: 'Demolition', color: '#D84315' },
  grading: { label: 'Grading', color: '#4E342E' },
  fire: { label: 'Fire', color: '#C62828' },
  occupancy: { label: 'Occupancy', color: '#2E7D32' },
  // IBC Chapter 17 special inspection — distinct color so it stands out
  // in the permit list. Subcategory (concrete / masonry / etc.) is shown
  // as a chip on the card when present.
  special_inspection: { label: 'Special Inspection', color: '#3949AB' },
  other: { label: 'Other', color: '#546E7A' },
};

// IBC Chapter 17 special inspection labels — used in the permit form
// when type === 'special_inspection'. Order roughly mirrors the order
// they typically appear on a project (soils first, then concrete/masonry/steel,
// then fire-resistive). Matches the SpecialInspectionCategory union.
export const SPECIAL_INSPECTION_LABELS: Record<string, string> = {
  soils:             'Soils & foundation',
  concrete:          'Concrete (placement & strength)',
  masonry:           'Masonry',
  structural_steel:  'Structural steel (welding & bolting)',
  cold_formed_steel: 'Cold-formed steel framing',
  wood:              'Wood (glulam, trusses, mass timber)',
  fire_resistive:    'Fire-resistive construction',
  sprayed_fireproof: 'Sprayed fireproofing (SFRM thickness)',
  smoke_control:     'Smoke control system',
  special_cases:     'Special cases / approved alternative',
};

export const PERMIT_STATUS_INFO: Record<string, { label: string; color: string; bgColor: string }> = {
  applied: { label: 'Applied', color: '#1565C0', bgColor: '#E3F2FD' },
  under_review: { label: 'Under Review', color: '#E65100', bgColor: '#FFF3E0' },
  approved: { label: 'Approved', color: '#2E7D32', bgColor: '#E8F5E9' },
  denied: { label: 'Denied', color: '#C62828', bgColor: '#FFEBEE' },
  expired: { label: 'Expired', color: '#546E7A', bgColor: '#ECEFF1' },
  inspection_scheduled: { label: 'Inspection Scheduled', color: '#6A1B9A', bgColor: '#F3E5F5' },
  inspection_passed: { label: 'Passed', color: '#2E7D32', bgColor: '#E8F5E9' },
  inspection_failed: { label: 'Failed', color: '#C62828', bgColor: '#FFEBEE' },
};
