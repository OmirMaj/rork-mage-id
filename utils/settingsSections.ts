// utils/settingsSections.ts — the map of Settings for the desktop two-pane
// layout (wave 6d, lane P2; components/settings/SettingsPanes).
//
// WHY. Settings measured 6.1 screens tall on the founder's MacBook — the
// longest page the web audit found: 22 sections on one scroll. On desktop web
// the page becomes an index on the left and ONE group on the right (founder
// default: one group at a time), selected by `?section=<group | section id>`.
// The phone keeps its one long list: this file is only read by the index and
// the pane filter, never by the phone tree.
//
// The ids are stable URL vocabulary: a later palette may deep-link
// /(tabs)/settings?section=… with them. Import these, do not re-list them.
//
// Pure (no react-native import): scripts/validate-w6d-forms.ts runs it under bun.

export type SettingsSectionId =
  | 'account-type' | 'ai-usage' | 'location-units' | 'estimate-defaults' | 'pdf-naming' | 'theme'
  | 'security' | 'notifications' | 'payments' | 'integrations' | 'project-pages' | 'your-costs'
  | 'contacts-email' | 'your-data' | 'developer' | 'supplier-marketplace' | 'subscription'
  | 'help' | 'faq' | 'about' | 'legal' | 'danger';

export type SettingsGroupKey = 'account' | 'workspace' | 'money' | 'sharing' | 'help' | 'danger' | 'developer';

export interface SettingsGroup {
  key: SettingsGroupKey;
  label: string;
  sections: readonly SettingsSectionId[];
  /** Only the owner (utils/owner isOwner) sees this group. */
  ownerOnly?: boolean;
}

/** The index, in order. Each section id belongs to exactly one group. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { key: 'account', label: 'Account & plan', sections: ['account-type', 'subscription', 'ai-usage', 'security'] },
  { key: 'workspace', label: 'Workspace', sections: ['location-units', 'estimate-defaults', 'pdf-naming', 'theme', 'notifications'] },
  { key: 'money', label: 'Money', sections: ['payments', 'integrations', 'your-costs', 'supplier-marketplace'] },
  { key: 'sharing', label: 'Sharing & data', sections: ['project-pages', 'contacts-email', 'your-data'] },
  { key: 'help', label: 'Help', sections: ['help', 'faq', 'about', 'legal'] },
  { key: 'danger', label: 'Danger zone', sections: ['danger'] },
  { key: 'developer', label: 'Developer', sections: ['developer'], ownerOnly: true },
];

/** The index row text for each section (Title Case of the pane's header). */
export const SECTION_LABEL: Record<SettingsSectionId, string> = {
  'account-type': 'Account Type',
  'ai-usage': 'AI Usage',
  'location-units': 'Location & Units',
  'estimate-defaults': 'Estimate Defaults',
  'pdf-naming': 'PDF Naming',
  theme: 'App Theme',
  security: 'Security',
  notifications: 'Notifications',
  payments: 'Payments',
  integrations: 'Integrations',
  'project-pages': 'Project Pages & Verification',
  'your-costs': 'Your Costs',
  'contacts-email': 'Contacts & Email',
  'your-data': 'Your Data',
  developer: 'Developer (Owner Only)',
  'supplier-marketplace': 'Supplier Marketplace',
  subscription: 'Subscription Plan',
  help: 'Help & Support',
  faq: 'FAQ',
  about: 'About',
  legal: 'Legal',
  danger: 'Danger Zone',
};

/** Contractor-only settings a property manager never sees. The INDEX reads
 *  this; the pane itself stays filtered by the four pinned 6c wrappers in
 *  app/(tabs)/settings/index.tsx. */
export const PM_HIDDEN: readonly SettingsSectionId[] = ['estimate-defaults', 'pdf-naming', 'your-costs', 'supplier-marketplace'];

/** Sections the web app never renders (biometric lock is native-only). */
export const WEB_HIDDEN: readonly SettingsSectionId[] = ['security'];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_GROUPS.flatMap((g) => g.sections);

const GROUP_OF = new Map<SettingsSectionId, SettingsGroupKey>(
  SETTINGS_GROUPS.flatMap((g) => g.sections.map((s) => [s, g.key] as const)),
);

export function groupOf(id: SettingsSectionId): SettingsGroupKey {
  return GROUP_OF.get(id) ?? 'account';
}

function isGroupKey(v: string): v is SettingsGroupKey {
  return SETTINGS_GROUPS.some((g) => g.key === v);
}
function isSectionId(v: string): v is SettingsSectionId {
  return GROUP_OF.has(v as SettingsSectionId);
}

/** `?section=` → the group to show and, when a section id was named, the
 *  section to scroll to. A group key or a section id is accepted; anything
 *  else (missing, junk, an array) is the Account & plan group. A non-owner
 *  asking for the developer group or section gets Account & plan. */
export function resolveSettingsParam(
  raw: string | string[] | null | undefined,
  { isOwner }: { isOwner: boolean },
): { group: SettingsGroupKey; sectionId: SettingsSectionId | null } {
  const v = typeof raw === 'string' ? raw.trim() : '';
  let group: SettingsGroupKey = 'account';
  let sectionId: SettingsSectionId | null = null;
  if (isGroupKey(v)) group = v;
  else if (isSectionId(v)) { group = groupOf(v); sectionId = v; }
  if (group === 'developer' && !isOwner) return { group: 'account', sectionId: null };
  return { group, sectionId };
}

export interface VisibleGroup {
  key: SettingsGroupKey;
  label: string;
  sections: SettingsSectionId[];
}

/** The index as this person sees it: owner-only groups for the owner only,
 *  PM_HIDDEN dropped for a property manager, WEB_HIDDEN dropped on the web,
 *  and any group left empty dropped. */
export function visibleIndex({ role, isOwner, web }: { role: string | null | undefined; isOwner: boolean; web: boolean }): VisibleGroup[] {
  const pm = role === 'property_manager';
  const out: VisibleGroup[] = [];
  for (const g of SETTINGS_GROUPS) {
    if (g.ownerOnly && !isOwner) continue;
    const sections = g.sections.filter((s) => !(pm && PM_HIDDEN.includes(s)) && !(web && WEB_HIDDEN.includes(s)));
    if (sections.length > 0) out.push({ key: g.key, label: g.label, sections });
  }
  return out;
}
