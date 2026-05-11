// commandPalette.ts — quick-action commands for the Cmd+K palette.
//
// Why this exists: UniversalSearch already does entity search ("find the
// Henderson RFI"). What's missing — and what every premium SaaS in 2026
// ships (Linear, Notion, Things, Cursor, Raycast) — is the "do something"
// shortcut: "Create a new invoice", "Open Permit Q&A", "Switch to dark
// mode". This module powers a Commands section that appears above the
// entity results in the same search modal.
//
// Two-sided support note (per the all-in-one architecture):
//   GC-side commands and homeowner-side commands both live here. The
//   user role isn't yet known to the palette — we surface everything
//   and let context-aware routing handle whether the target screen
//   makes sense. Future improvement: filter by user role.

import type { Router } from 'expo-router';

export interface CommandItem {
  /** Stable ID for telemetry + recents. */
  id: string;
  /** User-facing label. Short verb-noun. */
  title: string;
  /** Optional secondary text shown under the title. */
  subtitle?: string;
  /** Keywords that match this command in addition to the title. */
  keywords?: string[];
  /** Category — drives the section grouping in the modal. */
  category: 'create' | 'open' | 'ai' | 'settings' | 'marketplace';
  /** What happens when the user activates this command. */
  action: (router: Router) => void;
}

// ─── Command registry ───────────────────────────────────────────
// Adding a new command: append here. The palette picks it up on
// next render. No registration ceremony.

export const COMMANDS: CommandItem[] = [
  // ── CREATE ── (the most common path: "make a new X")
  {
    id: 'create.project',
    title: 'Create a project',
    keywords: ['new project', 'add project', 'start project'],
    category: 'create',
    action: (r) => r.push('/(tabs)/(home)' as never),
  },
  {
    id: 'create.invoice',
    title: 'Create an invoice',
    subtitle: 'Bill a client',
    keywords: ['new invoice', 'bill', 'aia', 'pay app'],
    category: 'create',
    action: (r) => r.push('/invoice' as never),
  },
  {
    id: 'create.change_order',
    title: 'Create a change order',
    keywords: ['co', 'change'],
    category: 'create',
    action: (r) => r.push('/change-order' as never),
  },
  {
    id: 'create.daily_report',
    title: 'Create a daily field report',
    subtitle: 'Voice capture available',
    keywords: ['dfr', 'daily log', 'field report'],
    category: 'create',
    action: (r) => r.push('/daily-report' as never),
  },
  {
    id: 'create.rfi',
    title: 'Create an RFI',
    keywords: ['request for info'],
    category: 'create',
    action: (r) => r.push('/rfi' as never),
  },
  {
    id: 'create.submittal',
    title: 'Create a submittal',
    keywords: ['shop drawing'],
    category: 'create',
    action: (r) => r.push('/submittal' as never),
  },
  {
    id: 'create.punch_item',
    title: 'Add a punch item',
    keywords: ['punch list', 'punchlist'],
    category: 'create',
    action: (r) => r.push('/punch-list' as never),
  },
  {
    id: 'create.estimate',
    title: 'Create an estimate',
    keywords: ['quote', 'bid', 'proposal'],
    category: 'create',
    action: (r) => r.push('/estimate-wizard' as never),
  },
  {
    id: 'create.lead',
    title: 'Add a lead',
    subtitle: 'Pipeline',
    keywords: ['prospect', 'new client'],
    category: 'create',
    action: (r) => r.push('/leads' as never),
  },

  // ── OPEN ── (jump to a tool)
  {
    id: 'open.summary',
    title: 'Open Summary',
    keywords: ['portfolio', 'kpi', 'dashboard'],
    category: 'open',
    action: (r) => r.push('/(tabs)/summary' as never),
  },
  {
    id: 'open.tools',
    title: 'Open Tools',
    keywords: ['approvals', 'cash flow', 'compliance'],
    category: 'open',
    action: (r) => r.push('/(tabs)/tools' as never),
  },
  {
    id: 'open.cash_flow',
    title: 'Open Cash Flow forecast',
    keywords: ['money', 'forecast'],
    category: 'open',
    action: (r) => r.push('/cash-flow' as never),
  },
  {
    id: 'open.compliance_hub',
    title: 'Open Compliance hub',
    keywords: ['coi', 'insurance', 'license', 'permit expiry'],
    category: 'open',
    action: (r) => r.push('/compliance-hub' as never),
  },
  {
    id: 'open.approvals',
    title: 'Open Approvals',
    keywords: ['waiting', 'pending'],
    category: 'open',
    action: (r) => r.push('/approvals' as never),
  },
  {
    id: 'open.bid_analytics',
    title: 'Open Bid analytics',
    keywords: ['win rate'],
    category: 'open',
    action: (r) => r.push('/bid-analytics' as never),
  },
  {
    id: 'open.permit_calendar',
    title: 'Open Permit calendar',
    keywords: ['deadlines', 'inspections'],
    category: 'open',
    action: (r) => r.push('/permit-calendar' as never),
  },

  // ── AI ── (the differentiated surfaces)
  {
    id: 'ai.permit_qa',
    title: 'Ask Permit Q&A',
    subtitle: '172 sections · 8 metros',
    keywords: ['code', 'permit', 'dob', 'll97'],
    category: 'ai',
    action: (r) => r.push('/permit-qa' as never),
  },
  {
    id: 'ai.code_check',
    title: 'Run a Code Check',
    subtitle: 'Construction AI',
    keywords: ['ai', 'compliance', 'code check'],
    category: 'ai',
    action: (r) => r.push('/(tabs)/construction-ai' as never),
  },
  {
    id: 'ai.takeoff',
    title: 'Run AI Takeoff',
    subtitle: 'Read a plan PDF',
    keywords: ['quantity', 'takeoff', 'measure'],
    category: 'ai',
    action: (r) => r.push('/takeoff' as never),
  },
  {
    id: 'ai.estimate_review',
    title: 'AI Estimate Review',
    keywords: ['review estimate'],
    category: 'ai',
    action: (r) => r.push('/estimate-review' as never),
  },
  {
    id: 'ai.weekly_snapshot',
    title: 'Open Weekly Snapshot',
    keywords: ['report', 'weekly', 'ai summary'],
    category: 'ai',
    action: (r) => r.push('/weekly-snapshot' as never),
  },

  // ── MARKETPLACE ── (the two-sided surface — owners + GCs)
  {
    id: 'marketplace.find_work',
    title: 'Find work — Public bids',
    subtitle: 'GC side: SAM.gov + state + city feeds',
    keywords: ['rfp', 'bid', 'opportunities', 'sam.gov'],
    category: 'marketplace',
    action: (r) => r.push('/(tabs)/discover/bids' as never),
  },
  {
    id: 'marketplace.post_job',
    title: 'Post a project',
    subtitle: 'Homeowner side: get bids from GCs',
    keywords: ['homeowner', 'post', 'find a contractor'],
    category: 'marketplace',
    action: (r) => r.push('/post-job' as never),
  },
  {
    id: 'marketplace.my_rfps',
    title: 'My posted projects',
    subtitle: 'Homeowner side',
    keywords: ['my jobs', 'my rfps', 'my projects posted'],
    category: 'marketplace',
    action: (r) => r.push('/my-rfps' as never),
  },
  {
    id: 'marketplace.nearby_rfps',
    title: 'Nearby projects to bid on',
    subtitle: 'GC side',
    keywords: ['near me', 'homeowner projects', 'find homeowner'],
    category: 'marketplace',
    action: (r) => r.push('/nearby-rfps' as never),
  },
  {
    id: 'marketplace.mage_id_bids',
    title: 'MAGE ID Bids',
    subtitle: 'GC marketplace',
    keywords: ['marketplace', 'mage bids'],
    category: 'marketplace',
    action: (r) => r.push('/(tabs)/mage-id-bids' as never),
  },
  {
    id: 'marketplace.materials',
    title: 'Material pricing',
    subtitle: '9 metros, live prices',
    keywords: ['suppliers', 'lumber', 'rebar'],
    category: 'marketplace',
    action: (r) => r.push('/(tabs)/materials' as never),
  },
  {
    id: 'marketplace.subs_directory',
    title: 'Find subs',
    keywords: ['hire', 'subcontractor', 'directory'],
    category: 'marketplace',
    action: (r) => r.push('/(tabs)/subs' as never),
  },

  // ── SETTINGS ── (configuration shortcuts)
  {
    id: 'settings.open',
    title: 'Open Settings',
    keywords: ['preferences', 'account'],
    category: 'settings',
    action: (r) => r.push('/(tabs)/settings' as never),
  },
  {
    id: 'open.safety',
    title: 'Open Safety',
    subtitle: 'Toolbox talks + incident log + OSHA 300A',
    keywords: ['osha', 'toolbox', 'incident', 'safety meeting'],
    category: 'open',
    action: (r) => r.push('/safety' as never),
  },
  {
    id: 'open.qc',
    title: 'Open QC Checklists',
    subtitle: 'Templated trade inspections',
    keywords: ['qc', 'quality', 'checklist', 'inspection', 'pre-pour', 'pre-rock'],
    category: 'open',
    action: (r) => r.push('/qc-checklists' as never),
  },
  {
    id: 'open.whats_new',
    title: "What's new",
    keywords: ['changelog', 'release notes', 'updates'],
    category: 'open',
    action: (r) => r.push('/whats-new' as never),
  },
  {
    id: 'settings.upgrade',
    title: 'Upgrade subscription',
    keywords: ['pro', 'business', 'paywall', 'upgrade'],
    category: 'settings',
    action: (r) => r.push('/paywall' as never),
  },
  {
    id: 'settings.notifications',
    title: 'Notification settings',
    keywords: ['alerts', 'push', 'email'],
    category: 'settings',
    action: (r) => r.push('/notifications-settings' as never),
  },
  {
    id: 'settings.integrations',
    title: 'Integrations',
    keywords: ['quickbooks', 'qbo', 'stripe', 'connect'],
    category: 'settings',
    action: (r) => r.push('/integrations' as never),
  },
];

const CATEGORY_LABELS: Record<CommandItem['category'], string> = {
  create: 'Create',
  open: 'Open',
  ai: 'AI',
  marketplace: 'Marketplace',
  settings: 'Settings',
};

/** Get the section label for a category. */
export function categoryLabel(cat: CommandItem['category']): string {
  return CATEGORY_LABELS[cat];
}

/**
 * Filter commands by a substring query. Matches title + subtitle +
 * keywords, all lowercased. Empty query returns nothing — palette
 * shows commands only when the user starts typing OR they're below
 * an entity-search result list as fallback suggestions.
 */
export function filterCommands(query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return COMMANDS.filter(c => {
    const haystack = [c.title, c.subtitle ?? '', ...(c.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  }).slice(0, 8); // cap at 8 to leave room for entity results below
}

/** Grouped variant for rendering by category section. */
export function filterCommandsGrouped(query: string): Map<CommandItem['category'], CommandItem[]> {
  const matches = filterCommands(query);
  const grouped = new Map<CommandItem['category'], CommandItem[]>();
  for (const c of matches) {
    const list = grouped.get(c.category) ?? [];
    list.push(c);
    grouped.set(c.category, list);
  }
  return grouped;
}
