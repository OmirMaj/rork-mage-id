import type { ProjectDocument } from '@/types';
import { getColorTheme, type ThemeColors } from '@/constants/colors';

export const MOCK_DOCUMENTS: ProjectDocument[] = [
  {
    id: 'doc-1',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'contract',
    title: 'General Construction Agreement',
    status: 'signed',
    createdAt: '2025-11-15T00:00:00Z',
    signedBy: 'John Smith',
    signedAt: '2025-11-16T14:30:00Z',
  },
  {
    id: 'doc-2',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'lien_waiver',
    title: 'Conditional Lien Waiver - Progress #2',
    status: 'pending_signature',
    createdAt: '2026-01-10T00:00:00Z',
  },
  {
    id: 'doc-3',
    projectId: 'p-2',
    projectName: 'Bathroom Remodel - Johnson',
    type: 'coi',
    title: 'Certificate of Insurance',
    status: 'signed',
    createdAt: '2025-10-01T00:00:00Z',
    expiresAt: '2026-10-01T00:00:00Z',
    signedBy: 'Liberty Mutual',
    signedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: 'doc-4',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'proposal',
    title: 'Design Proposal v2',
    status: 'signed',
    createdAt: '2025-11-01T00:00:00Z',
    signedBy: 'John Smith',
    signedAt: '2025-11-03T10:00:00Z',
  },
  {
    id: 'doc-5',
    projectId: 'p-2',
    projectName: 'Bathroom Remodel - Johnson',
    type: 'aia_billing',
    title: 'AIA G702 Application #1',
    status: 'draft',
    createdAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'doc-6',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'lien_waiver',
    title: 'Unconditional Lien Waiver - Final',
    status: 'draft',
    createdAt: '2026-03-15T00:00:00Z',
  },
  {
    id: 'doc-7',
    projectId: 'p-2',
    projectName: 'Bathroom Remodel - Johnson',
    type: 'contract',
    title: 'Subcontractor Agreement - Plumbing',
    status: 'pending_signature',
    createdAt: '2026-01-20T00:00:00Z',
  },
  {
    id: 'doc-8',
    projectId: 'p-1',
    projectName: 'Kitchen Renovation - Smith',
    type: 'coi',
    title: "Sub COI - Mike's Electric",
    status: 'expired',
    createdAt: '2025-01-15T00:00:00Z',
    expiresAt: '2026-01-15T00:00:00Z',
    signedBy: 'State Farm',
    signedAt: '2025-01-15T00:00:00Z',
  },
];

// Themed document-type chip styling — a FUNCTION of the palette (not a module
// static) so the chip fills flip with the theme instead of staying bright
// light-theme pastels on dark cards. Semantic hues map to palette tokens;
// hues WITHOUT tokens (purple / pink / teal) branch on the resolved scheme
// via getColorTheme() (light label + alpha tint in dark, dark label + pale
// tint in light).
export const documentTypeInfo = (t: ThemeColors): Record<string, { label: string; color: string; bgColor: string }> => {
  const dark = getColorTheme() === 'dark';
  return {
    lien_waiver: { label: 'Lien Waiver', color: t.warningLabel, bgColor: t.warningSoft },
    coi: { label: 'COI', color: t.info, bgColor: t.info + '1F' },
    contract: { label: 'Contract', color: t.success, bgColor: t.successSoft },
    proposal: { label: 'Proposal', color: dark ? '#CE93D8' : '#6A1B9A', bgColor: dark ? 'rgba(206,147,216,0.16)' : 'rgba(106,27,154,0.10)' },
    aia_billing: { label: 'AIA Billing', color: dark ? '#F48FB1' : '#AD1457', bgColor: dark ? 'rgba(244,143,177,0.16)' : 'rgba(173,20,87,0.10)' },
    permit: { label: 'Permit', color: dark ? '#4DB6AC' : '#00695C', bgColor: dark ? 'rgba(77,182,172,0.16)' : 'rgba(0,105,92,0.10)' },
    other: { label: 'Other', color: t.textSecondary, bgColor: t.surfaceAlt },
  };
};
