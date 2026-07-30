// constants/glossary.ts
//
// Plain-English definitions for the construction + MAGE terms that trip people
// up — especially owners, but also new contractors. Powers <InfoBubble>, the
// reusable "what is this / why it matters" explainer.
//
// Pure data (no RN imports) so scripts/validate-glossary.ts can check it under
// Bun. Keys are snake_case and stable (they're referenced from screens).

export interface GlossaryEntry {
  /** Stable snake_case key referenced by <InfoBubble term="..." />. */
  key: string;
  /** Human title shown as the bubble heading. */
  term: string;
  /** "What it is" — one or two plain sentences, no jargon-to-explain-jargon. */
  what: string;
  /** "Why it matters" — the money/time/risk reason the user should care. */
  why: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  change_order: {
    key: 'change_order',
    term: 'Change Order',
    what: 'A written, priced agreement to add, remove, or modify work after the contract is signed.',
    why: 'Unbilled changes are the #1 way contractors lose money. A signed change order gets you paid for extra work instead of eating the cost.',
  },
  retainage: {
    key: 'retainage',
    term: 'Retainage',
    what: 'A percentage of each payment (often 5–10%) the owner holds back until the job is finished.',
    why: 'It protects the owner but ties up your cash. Tracking it means you collect every held-back dollar at closeout.',
  },
  pay_app: {
    key: 'pay_app',
    term: 'Pay Application (AIA G702/G703)',
    what: 'The standard progress-billing form showing how much of each line item is complete and what you are owed this period.',
    why: 'It is what most owners and lenders require before releasing payment. Getting it right means getting paid on time.',
  },
  lien_waiver: {
    key: 'lien_waiver',
    term: 'Lien Waiver',
    what: 'A signed document where you (or a sub) give up the right to file a lien in exchange for getting paid.',
    why: 'Owners will not release funds without it. Tracking waivers keeps payments flowing and closeout clean.',
  },
  rfi: {
    key: 'rfi',
    term: 'RFI (Request for Information)',
    what: 'A formal question to the architect or owner when the plans are unclear or conflict.',
    why: 'An unanswered RFI stalls work. Fast turnaround protects the schedule — and protects you if the delay is someone else’s fault.',
  },
  submittal: {
    key: 'submittal',
    term: 'Submittal',
    what: 'Product data, samples, or shop drawings you send for approval before ordering or installing.',
    why: 'Installing before approval risks a costly redo. Tracking submittals keeps material orders on schedule.',
  },
  punch_list: {
    key: 'punch_list',
    term: 'Punch List',
    what: 'The list of small fixes and touch-ups to finish before the job is considered complete.',
    why: 'A tight punch list is the difference between a fast final payment and a project that drags on for weeks.',
  },
  critical_path: {
    key: 'critical_path',
    term: 'Critical Path',
    what: 'The chain of tasks that sets your finish date — a delay to any one of them delays the whole job.',
    why: 'It tells you exactly which slips actually matter, so you protect the finish date instead of chasing everything.',
  },
  float: {
    key: 'float',
    term: 'Float (Slack)',
    what: 'How many days a task can slip before it starts pushing the project’s finish date.',
    why: 'Tasks with float can absorb delays; tasks with zero float cannot. It is where to spend your attention.',
  },
  ppc: {
    key: 'ppc',
    term: 'PPC (Percent Plan Complete)',
    what: 'The share of the week’s committed tasks your crews actually finished — the core Last Planner metric.',
    why: 'PPC above ~80% means your schedule is reliable. A low number is an early warning the plan is slipping.',
  },
  evm: {
    key: 'evm',
    term: 'Earned Value',
    what: 'Compares what you planned to have spent and completed by now against what you actually have.',
    why: 'It catches a job drifting over budget or behind schedule while there is still time to fix it.',
  },
  margin_risk: {
    key: 'margin_risk',
    term: 'Margin Risk',
    what: 'MAGE’s live score of how likely a job is to finish below its target profit.',
    why: 'It flags jobs bleeding margin before the money is gone — so you act now instead of finding out at closeout.',
  },
  cost_xray: {
    key: 'cost_xray',
    term: 'Cost X-Ray',
    what: 'Surfaces the hidden conditions and gaps in a scope so you can price them before you bid.',
    why: 'The costs you miss at bid time come straight out of your margin. This finds them first.',
  },
  estimate_confidence: {
    key: 'estimate_confidence',
    term: 'Estimate Confidence',
    what: 'How well each line of your estimate is backed by your own real cost history.',
    why: 'Low-confidence lines are where bids go wrong. It tells you exactly what to double-check before sending.',
  },
  living_estimate: {
    key: 'living_estimate',
    term: 'Living Estimate',
    what: 'Your estimate kept up to date against actual costs as the job runs, projecting the margin you’ll land at.',
    why: 'It turns the estimate from a one-time guess into an early-warning system for profit.',
  },
  buyout: {
    key: 'buyout',
    term: 'Buyout',
    what: 'Turning the scope in your winning estimate into actual commitments — sub contracts and purchase orders.',
    why: 'A clean buyout locks in the prices you bid, so margin does not leak between winning and building.',
  },
};

/** Look up a term; returns null for unknown keys (callers render nothing). */
export function getGlossaryEntry(key: string): GlossaryEntry | null {
  return GLOSSARY[key] ?? null;
}
