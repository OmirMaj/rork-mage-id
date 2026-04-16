import type { RegionInfo } from '@/types';

export const REGIONS: RegionInfo[] = [
  { id: 'new_england', label: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'], costIndex: 1.18 },
  { id: 'mid_atlantic', label: 'Mid-Atlantic', states: ['NJ', 'NY', 'PA'], costIndex: 1.22 },
  { id: 'southeast', label: 'Southeast', states: ['AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV'], costIndex: 0.88 },
  { id: 'midwest', label: 'Midwest', states: ['IL', 'IN', 'IA', 'MI', 'MN', 'MO', 'OH', 'WI'], costIndex: 1.02 },
  { id: 'great_plains', label: 'Great Plains', states: ['KS', 'NE', 'ND', 'OK', 'SD'], costIndex: 0.90 },
  { id: 'southwest', label: 'Southwest', states: ['AZ', 'NM', 'TX'], costIndex: 0.92 },
  { id: 'mountain', label: 'Mountain', states: ['CO', 'ID', 'MT', 'UT', 'WY', 'NV'], costIndex: 1.05 },
  { id: 'west_coast', label: 'West Coast', states: ['CA'], costIndex: 1.28 },
  { id: 'pacific_nw', label: 'Pacific Northwest', states: ['OR', 'WA', 'AK'], costIndex: 1.12 },
  { id: 'northeast', label: 'Northeast Metro', states: ['DC', 'DE', 'MD', 'HI'], costIndex: 1.15 },
];

export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

export function getRegionForState(stateCode: string): RegionInfo | undefined {
  return REGIONS.find(r => r.states.includes(stateCode));
}

export function getRegionalPrice(basePrice: number, stateCode: string): number {
  const region = getRegionForState(stateCode);
  if (!region) return basePrice;
  return Math.round(basePrice * region.costIndex * 100) / 100;
}

export const CITY_ADJUSTMENTS: Record<string, number> = {
  'New York City': 1.35,
  'San Francisco': 1.32,
  'Los Angeles': 1.22,
  'Chicago': 1.12,
  'Boston': 1.20,
  'Seattle': 1.15,
  'Miami': 1.05,
  'Houston': 0.95,
  'Dallas': 0.93,
  'Atlanta': 0.92,
  'Denver': 1.08,
  'Phoenix': 0.94,
  'Philadelphia': 1.10,
  'Washington DC': 1.18,
  'Detroit': 1.00,
  'Minneapolis': 1.06,
  'Portland': 1.10,
  'Las Vegas': 1.02,
  'Nashville': 0.96,
  'Charlotte': 0.91,
};
