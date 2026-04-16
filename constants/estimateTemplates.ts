export interface EstimateTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  priceRange: string;
  defaultSqft: number;
  assemblies: Array<{
    assemblyId: string;
    defaultQuantity: number;
    unit: string;
  }>;
}

export const ESTIMATE_TEMPLATES: EstimateTemplate[] = [
  {
    id: 'tpl-kitchen-standard',
    name: 'Kitchen Remodel (Standard)',
    category: 'remodel',
    description: 'Standard kitchen renovation — new cabinets, countertops, flooring, lighting, paint',
    priceRange: '$25K–$40K',
    defaultSqft: 150,
    assemblies: [
      { assemblyId: 'asm-demo-interior', defaultQuantity: 150, unit: 'SF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 400, unit: 'SF' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 8, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 6, unit: 'EA' },
      { assemblyId: 'asm-plumb-kitchen', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-tile-floor', defaultQuantity: 150, unit: 'SF' },
      { assemblyId: 'asm-kitchen-cabinet-base', defaultQuantity: 15, unit: 'LF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 400, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-kitchen-upscale',
    name: 'Kitchen Remodel (Upscale)',
    category: 'remodel',
    description: 'High-end kitchen — custom cabinets, quartz counters, tile backsplash, premium appliance prep',
    priceRange: '$50K–$80K',
    defaultSqft: 200,
    assemblies: [
      { assemblyId: 'asm-demo-interior', defaultQuantity: 200, unit: 'SF' },
      { assemblyId: 'asm-frame-wall-2x4', defaultQuantity: 20, unit: 'LF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 600, unit: 'SF' },
      { assemblyId: 'asm-electrical-circuit', defaultQuantity: 3, unit: 'EA' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 12, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 10, unit: 'EA' },
      { assemblyId: 'asm-plumb-kitchen', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-tile-floor', defaultQuantity: 200, unit: 'SF' },
      { assemblyId: 'asm-kitchen-cabinet-base', defaultQuantity: 20, unit: 'LF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 600, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-bathroom-standard',
    name: 'Bathroom Remodel (Standard)',
    category: 'remodel',
    description: 'Standard bathroom — new tile, vanity, toilet, tub/shower surround, paint',
    priceRange: '$10K–$20K',
    defaultSqft: 60,
    assemblies: [
      { assemblyId: 'asm-demo-interior', defaultQuantity: 60, unit: 'SF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 200, unit: 'SF' },
      { assemblyId: 'asm-plumb-bathroom', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 2, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 3, unit: 'EA' },
      { assemblyId: 'asm-tile-floor', defaultQuantity: 60, unit: 'SF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 200, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-bathroom-upscale',
    name: 'Bathroom Remodel (Upscale)',
    category: 'remodel',
    description: 'High-end bathroom — heated floor, frameless shower, double vanity, premium tile',
    priceRange: '$25K–$45K',
    defaultSqft: 90,
    assemblies: [
      { assemblyId: 'asm-demo-interior', defaultQuantity: 90, unit: 'SF' },
      { assemblyId: 'asm-frame-wall-2x4', defaultQuantity: 12, unit: 'LF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 300, unit: 'SF' },
      { assemblyId: 'asm-plumb-bathroom', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-electrical-circuit', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 4, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 6, unit: 'EA' },
      { assemblyId: 'asm-tile-floor', defaultQuantity: 90, unit: 'SF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 300, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-basement-finish',
    name: 'Basement Finish',
    category: 'renovation',
    description: 'Finish basement with framing, insulation, drywall, flooring, electrical, and bathroom',
    priceRange: '$30–$50/SF',
    defaultSqft: 800,
    assemblies: [
      { assemblyId: 'asm-frame-wall-2x4', defaultQuantity: 120, unit: 'LF' },
      { assemblyId: 'asm-insulation-batt', defaultQuantity: 960, unit: 'SF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 2400, unit: 'SF' },
      { assemblyId: 'asm-electrical-circuit', defaultQuantity: 4, unit: 'EA' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 16, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 12, unit: 'EA' },
      { assemblyId: 'asm-plumb-bathroom', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-lvp-floor', defaultQuantity: 800, unit: 'SF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 2400, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-deck-composite',
    name: 'Deck Build (Composite 300SF)',
    category: 'decking',
    description: 'Ground-level composite deck with railing and stairs',
    priceRange: '$15K–$25K',
    defaultSqft: 300,
    assemblies: [
      { assemblyId: 'asm-deck-composite', defaultQuantity: 300, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-deck-wood',
    name: 'Deck Build (PT Wood 300SF)',
    category: 'decking',
    description: 'Ground-level pressure-treated wood deck with railing',
    priceRange: '$8K–$15K',
    defaultSqft: 300,
    assemblies: [
      { assemblyId: 'asm-deck-wood', defaultQuantity: 300, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-roof-replacement',
    name: 'Roof Replacement (Shingles)',
    category: 'roofing',
    description: 'Tear-off and replace asphalt shingle roof — typical 2000SF home (~20 squares)',
    priceRange: '$8K–$15K',
    defaultSqft: 2000,
    assemblies: [
      { assemblyId: 'asm-shingle-roof', defaultQuantity: 20, unit: 'SQ' },
    ],
  },
  {
    id: 'tpl-interior-paint',
    name: 'Interior Paint (Whole House)',
    category: 'painting',
    description: 'Paint entire home interior — walls and ceilings, 2 coats',
    priceRange: '$3K–$6K',
    defaultSqft: 2000,
    assemblies: [
      { assemblyId: 'asm-paint-interior', defaultQuantity: 5000, unit: 'SF' },
    ],
  },
  {
    id: 'tpl-fence-privacy',
    name: 'Privacy Fence (150 LF)',
    category: 'fencing',
    description: '6ft wood privacy fence around typical backyard with one gate',
    priceRange: '$4K–$8K',
    defaultSqft: 0,
    assemblies: [
      { assemblyId: 'asm-fence-privacy', defaultQuantity: 150, unit: 'LF' },
    ],
  },
  {
    id: 'tpl-siding-replacement',
    name: 'Siding Replacement (Vinyl)',
    category: 'siding',
    description: 'Replace siding on typical 1500SF home exterior with vinyl',
    priceRange: '$8K–$15K',
    defaultSqft: 1500,
    assemblies: [
      { assemblyId: 'asm-vinyl-siding', defaultQuantity: 15, unit: 'SQ' },
    ],
  },
  {
    id: 'tpl-room-addition',
    name: 'Room Addition (200SF)',
    category: 'addition',
    description: 'Single room addition — foundation, framing, roofing, insulation, drywall, electrical, HVAC',
    priceRange: '$40K–$80K',
    defaultSqft: 200,
    assemblies: [
      { assemblyId: 'asm-concrete-slab', defaultQuantity: 200, unit: 'SF' },
      { assemblyId: 'asm-frame-wall-2x6', defaultQuantity: 60, unit: 'LF' },
      { assemblyId: 'asm-shingle-roof', defaultQuantity: 3, unit: 'SQ' },
      { assemblyId: 'asm-insulation-batt', defaultQuantity: 500, unit: 'SF' },
      { assemblyId: 'asm-drywall-hang-finish', defaultQuantity: 800, unit: 'SF' },
      { assemblyId: 'asm-electrical-circuit', defaultQuantity: 2, unit: 'EA' },
      { assemblyId: 'asm-electrical-outlet', defaultQuantity: 6, unit: 'EA' },
      { assemblyId: 'asm-recessed-light', defaultQuantity: 4, unit: 'EA' },
      { assemblyId: 'asm-hvac-minisplit', defaultQuantity: 1, unit: 'EA' },
      { assemblyId: 'asm-lvp-floor', defaultQuantity: 200, unit: 'SF' },
      { assemblyId: 'asm-paint-interior', defaultQuantity: 800, unit: 'SF' },
      { assemblyId: 'asm-paint-exterior', defaultQuantity: 300, unit: 'SF' },
    ],
  },
];

export const TEMPLATE_CATEGORIES = [
  { id: 'all', label: 'All Templates' },
  { id: 'remodel', label: 'Remodels' },
  { id: 'renovation', label: 'Renovation' },
  { id: 'addition', label: 'Additions' },
  { id: 'decking', label: 'Decking' },
  { id: 'roofing', label: 'Roofing' },
  { id: 'painting', label: 'Painting' },
  { id: 'fencing', label: 'Fencing' },
  { id: 'siding', label: 'Siding' },
];
