// changelog.ts — in-app release notes. Bumping the latest version
// here triggers the unread badge on Settings → What's new. Once the
// user opens the changelog screen, the version is persisted and the
// badge clears.
//
// Why this exists: every premium SaaS in 2026 has this. It's how you
// announce features without requiring an App Store push. It also
// becomes part of the support workflow ("you're on 1.2 — the bug
// was fixed in 1.3, please reload").
//
// Edit ENTRIES below to publish a new release. Top of the list is
// latest. Each release lists 3-7 bullets (title + optional details).

export interface ChangelogEntry {
  /** Semver-ish version label (e.g. "1.3" or "1.3.2"). Used as the
   *  persisted "last read" key. Bump this in lockstep with what the
   *  user actually experiences as a new version. */
  version: string;
  /** ISO date the release shipped. Used for the date label. */
  date: string;
  /** Short one-line summary shown in the list view. */
  summary: string;
  /** 3-7 bullets describing what changed. */
  items: { title: string; body?: string }[];
  /** Optional tags shown as chips ("new feature", "fix", "polish"). */
  tags?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.5',
    date: '2026-05-11',
    summary: 'Dark mode, command palette, CSV exports, Slack, Safety, QC',
    tags: ['new', 'polish'],
    items: [
      {
        title: 'Dark mode',
        body: 'Settings → Appearance. Light / Dark / System. Per-screen surface theming rolls out across the app over the next few releases.',
      },
      {
        title: 'Cmd+K command palette (web)',
        body: 'Type ⌘K (Mac) or Ctrl+K (Win). Search for projects, RFIs, invoices — or run quick actions like "Create invoice", "Ask Permit Q&A", "Post a project".',
      },
      {
        title: 'CSV export everywhere',
        body: 'One-tap export of invoices, contacts, subs, and more. No more being locked in.',
      },
      {
        title: 'Slack integration',
        body: 'Pipe MAGE ID events to your team Slack channel: new invoice paid, RFI answered, project created.',
      },
      {
        title: 'Safety module v1',
        body: 'Toolbox-talk tracker + incident log with photos and witness statements. Auto-compiles toward an OSHA 300A.',
      },
      {
        title: 'QC checklists',
        body: 'Templated trade checklists separate from your end-of-project punch list. Pre-rock, pre-pour, drywall mockup — covered.',
      },
      {
        title: 'Saved filters',
        body: '"My open RFIs", "Overdue invoices last 30d" — saved per list per user.',
      },
    ],
  },
  {
    version: '1.4',
    date: '2026-05-10',
    summary: 'DailyHeroPhoto on Home, Fraunces + brand amber sitewide, Permit Q&A polish',
    tags: ['new', 'design'],
    items: [
      {
        title: 'DailyHeroPhoto on Home',
        body: 'The most recent jobsite photo shows edge-to-edge at the top of Home with a Fraunces serif overlay. Tap to jump into the project.',
      },
      {
        title: 'Fraunces serif on key titles',
        body: 'Summary, Home, AI Hub, Tools, Project Detail, Settings — brand voice now greets you everywhere.',
      },
      {
        title: 'Permit Q&A reworked',
        body: 'Cream paper background, mono permit-stamp metro tiles, "PERMIT § AGENT" identity.',
      },
      {
        title: 'Brand amber as primary CTA color',
        body: 'No more iOS-system green/orange — true MAGE amber across every primary action.',
      },
    ],
  },
  {
    version: '1.3',
    date: '2026-05-10',
    summary: 'Permit Q&A AI agent — 172 sections across 8 metros',
    tags: ['new'],
    items: [
      {
        title: 'Permit Q&A agent',
        body: 'Ask permits, code, inspections, fees in plain English. Get verbatim quotes with section citations. 172 hand-curated code sections across NYC, LA, Chicago, Houston, Miami, Phoenix, Seattle, and SF.',
      },
      {
        title: 'Lives inside Discover → AI Hub',
        body: 'Permit Q&A is the marquee feature of the AI Hub tab — alongside Construction AI code check.',
      },
      {
        title: 'Free on Pro tier',
        body: '$29/mo. Procore + UpCodes would cost $1,000/mo+ for less integrated coverage.',
      },
    ],
  },
];

/** Convenience: most recent release. */
export const LATEST_VERSION = CHANGELOG[0]?.version ?? '1.0';
