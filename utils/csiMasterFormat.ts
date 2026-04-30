// CSI MasterFormat 2020 — division catalog + auto-mapping helper.
//
// MasterFormat is the construction industry's standard for organizing
// specifications, estimates, schedules of values, and submittal logs.
// 50 divisions, numbered 00 through 49 (with gaps reserved for future
// additions). Used by every commercial GC and most professional
// residential GCs once jobs cross ~$1M.
//
// Divisions are public information (the CSI organization publishes the
// titles). What's NOT public is CSI's full numbered SectionFormat (each
// division has 100+ sections like 03 30 00 "Cast-in-Place Concrete").
// We implement just the division layer — that's enough to organize
// estimates, group bid packages, and label submittals.
//
// classifyToCSIDivision() does keyword-based mapping from a free-text
// description to the most likely division. Used to auto-tag legacy
// estimate items that don't have a division set, and to suggest a
// division when the GC types a new line item.

export interface CSIDivision {
  /** Two-digit zero-padded division number (e.g. "03"). */
  number: string;
  /** Title (CSI MasterFormat 2020). */
  title: string;
  /** Common aliases / scope examples. */
  examples: string[];
}

export const CSI_DIVISIONS: CSIDivision[] = [
  { number: '00', title: 'Procurement and Contracting Requirements',
    examples: ['bid forms', 'contract', 'general conditions', 'addenda'] },
  { number: '01', title: 'General Requirements',
    examples: ['mobilization', 'supervision', 'temporary facilities', 'cleanup', 'general conditions', 'project management'] },
  { number: '02', title: 'Existing Conditions',
    examples: ['demolition', 'demo', 'site clearing', 'asbestos abatement', 'survey'] },
  { number: '03', title: 'Concrete',
    examples: ['concrete', 'rebar', 'reinforcement', 'foundation', 'footings', 'slab', 'cast-in-place', 'precast'] },
  { number: '04', title: 'Masonry',
    examples: ['masonry', 'brick', 'cmu', 'block', 'stone', 'mortar', 'grout'] },
  { number: '05', title: 'Metals',
    examples: ['structural steel', 'steel', 'metal framing', 'metal deck', 'rebar', 'misc metals', 'handrails', 'stairs'] },
  { number: '06', title: 'Wood, Plastics, and Composites',
    examples: ['framing', 'lumber', 'wood', 'rough carpentry', 'finish carpentry', 'cabinets', 'casework', 'millwork', 'trim'] },
  { number: '07', title: 'Thermal and Moisture Protection',
    examples: ['insulation', 'roofing', 'siding', 'waterproofing', 'flashing', 'fireproofing', 'firestop', 'sealants'] },
  { number: '08', title: 'Openings',
    examples: ['doors', 'windows', 'frames', 'hardware', 'glazing', 'glass', 'storefront', 'overhead doors'] },
  { number: '09', title: 'Finishes',
    examples: ['drywall', 'gypsum', 'plaster', 'tile', 'flooring', 'carpet', 'wood floor', 'paint', 'painting', 'wallcovering', 'acoustic'] },
  { number: '10', title: 'Specialties',
    examples: ['toilet partitions', 'lockers', 'signage', 'fire extinguishers', 'mailboxes', 'corner guards'] },
  { number: '11', title: 'Equipment',
    examples: ['appliances', 'kitchen equipment', 'food service', 'laundry'] },
  { number: '12', title: 'Furnishings',
    examples: ['furniture', 'window treatments', 'blinds', 'rugs', 'art'] },
  { number: '13', title: 'Special Construction',
    examples: ['saunas', 'pools', 'pre-engineered structures', 'solar', 'kennel'] },
  { number: '14', title: 'Conveying Equipment',
    examples: ['elevators', 'lifts', 'escalators', 'dumbwaiters'] },
  { number: '21', title: 'Fire Suppression',
    examples: ['sprinklers', 'fire suppression', 'standpipe'] },
  { number: '22', title: 'Plumbing',
    examples: ['plumbing', 'pipe', 'fixtures', 'water heater', 'toilet', 'sink', 'faucet', 'drain'] },
  { number: '23', title: 'Heating, Ventilating, and Air Conditioning (HVAC)',
    examples: ['hvac', 'mechanical', 'ductwork', 'furnace', 'air conditioner', 'mini split', 'rooftop unit', 'thermostat'] },
  { number: '25', title: 'Integrated Automation',
    examples: ['building automation', 'bms', 'integration'] },
  { number: '26', title: 'Electrical',
    examples: ['electrical', 'wiring', 'panel', 'outlets', 'lighting', 'switches', 'breaker', 'transformer', 'low voltage'] },
  { number: '27', title: 'Communications',
    examples: ['data', 'voice', 'cabling', 'cat6', 'av', 'audio video', 'phone', 'wifi'] },
  { number: '28', title: 'Electronic Safety and Security',
    examples: ['security', 'cctv', 'access control', 'alarm', 'cameras'] },
  { number: '31', title: 'Earthwork',
    examples: ['earthwork', 'excavation', 'grading', 'soil', 'fill', 'compaction', 'shoring', 'piles'] },
  { number: '32', title: 'Exterior Improvements',
    examples: ['paving', 'asphalt', 'concrete walk', 'driveway', 'landscaping', 'fence', 'gate', 'irrigation'] },
  { number: '33', title: 'Utilities',
    examples: ['utilities', 'water service', 'sewer', 'storm drain', 'gas line', 'electrical service entrance'] },
  { number: '34', title: 'Transportation',
    examples: ['railroad', 'transit', 'guideway'] },
  { number: '35', title: 'Waterway and Marine Construction',
    examples: ['marine', 'dock', 'pier', 'seawall'] },
];

/** Map of division number → division for quick lookup. */
export const CSI_DIVISION_BY_NUMBER: Record<string, CSIDivision> = Object.fromEntries(
  CSI_DIVISIONS.map(d => [d.number, d]),
);

/** Quick lookup of label by division number. Returns just the title. */
export function csiDivisionLabel(num: string | null | undefined): string {
  if (!num) return 'Unassigned';
  const d = CSI_DIVISION_BY_NUMBER[num];
  return d ? `Div ${num} — ${d.title}` : `Div ${num}`;
}

/**
 * Best-effort classification: given a description / category, return
 * the most likely CSI division number. Returns null when nothing
 * matches with reasonable confidence — caller should leave the field
 * unset rather than guess.
 *
 * Implementation is keyword scoring with priority ordering. Concrete
 * (Div 03) beats earthwork (Div 31) when both keywords appear because
 * "concrete footing" should land in 03, not 31. This matches how
 * spec-writers typically classify line items.
 */
export function classifyToCSIDivision(text: string): string | null {
  if (!text || text.trim().length < 2) return null;
  const haystack = text.toLowerCase();

  // Score each division by sum of keyword matches.
  // We weight longer / more specific keywords more.
  const scores: Record<string, number> = {};
  for (const div of CSI_DIVISIONS) {
    for (const ex of div.examples) {
      if (haystack.includes(ex)) {
        // Longer keywords are more specific — score by length.
        scores[div.number] = (scores[div.number] ?? 0) + ex.length;
      }
    }
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 4) return null;        // too thin to trust
  return best[0];
}

/** Group items by CSI division for a SOV-style display. */
export function groupByCSIDivision<T extends { csiDivision?: string | null }>(items: T[]): Array<{
  division: CSIDivision | null;
  items: T[];
}> {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const key = it.csiDivision || '__unassigned__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(it);
  }
  // Sort divisions by number, with __unassigned__ last
  const ordered = Array.from(buckets.entries()).sort(([a], [b]) => {
    if (a === '__unassigned__') return 1;
    if (b === '__unassigned__') return -1;
    return a.localeCompare(b);
  });
  return ordered.map(([key, items]) => ({
    division: key === '__unassigned__' ? null : (CSI_DIVISION_BY_NUMBER[key] ?? null),
    items,
  }));
}
