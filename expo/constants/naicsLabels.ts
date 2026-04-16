export const NAICS_LABELS: Record<string, string> = {
  '236115': 'New Single-Family Housing',
  '236116': 'New Multifamily Housing',
  '236117': 'New Housing For-Sale Builders',
  '236118': 'Residential Remodeling',
  '236210': 'Industrial Building',
  '236220': 'Commercial & Institutional Building',
  '237110': 'Water & Sewer Line',
  '237120': 'Oil & Gas Pipeline',
  '237130': 'Power & Communication Line',
  '237210': 'Land Subdivision',
  '237310': 'Highway, Street & Bridge',
  '237990': 'Other Heavy Civil Engineering',
  '238110': 'Poured Concrete Foundation',
  '238120': 'Structural Steel & Precast Concrete',
  '238130': 'Framing Contractors',
  '238140': 'Masonry Contractors',
  '238150': 'Glass & Glazing Contractors',
  '238160': 'Roofing Contractors',
  '238170': 'Siding Contractors',
  '238190': 'Other Foundation & Exterior',
  '238210': 'Electrical Contractors',
  '238220': 'Plumbing, Heating & AC',
  '238290': 'Other Building Equipment',
  '238310': 'Drywall & Insulation',
  '238320': 'Painting & Wall Covering',
  '238330': 'Flooring Contractors',
  '238340': 'Tile & Terrazzo',
  '238350': 'Finish Carpentry',
  '238390': 'Other Building Finishing',
  '238910': 'Site Preparation',
  '238990': 'All Other Specialty Trade',
};

export function getNaicsLabel(code: string | undefined | null): string {
  if (!code) return '';
  const clean = code.replace(/\D/g, '').slice(0, 6);
  return NAICS_LABELS[clean] ?? '';
}

export function extractValueFromDescription(description: string | undefined | null): string | null {
  if (!description) return null;
  const patterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:million|mil|M)/i,
    /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:thousand|K)/i,
    /\$\s*([\d,]+(?:\.\d{2})?)/,
    /estimated\s*(?:value|cost|amount)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    /([\d,]+(?:\.\d{2})?)\s*dollars/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, '');
      const num = parseFloat(raw);
      if (isNaN(num) || num <= 0) continue;
      if (/million|mil|M/i.test(match[0])) {
        return `~$${(num).toFixed(1)}M`;
      }
      if (/thousand|K/i.test(match[0])) {
        return `~$${Math.round(num)}K`;
      }
      if (num >= 1000000) return `~$${(num / 1000000).toFixed(1)}M`;
      if (num >= 1000) return `~$${Math.round(num / 1000)}K`;
      return `~$${Math.round(num)}`;
    }
  }
  return null;
}

const STATE_ABBRS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','GU','VI',
]);

export function parseLocationFromDepartment(department: string | undefined | null): string | null {
  if (!department) return null;
  const upper = department.toUpperCase();
  const statePatterns: Record<string, string> = {
    'ALASKA': 'AK', 'ALABAMA': 'AL', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
    'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
    'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
    'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
    'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
    'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
    'WISCONSIN': 'WI', 'WYOMING': 'WY',
  };

  for (const [name, abbr] of Object.entries(statePatterns)) {
    if (upper.includes(name)) return abbr;
  }

  const words = upper.split(/[\s,\-\/]+/);
  for (const word of words) {
    if (STATE_ABBRS.has(word) && word.length === 2) return word;
  }

  return null;
}

export function parseLocationFromDescription(description: string | undefined | null): string | null {
  if (!description) return null;
  return parseLocationFromDepartment(description);
}
