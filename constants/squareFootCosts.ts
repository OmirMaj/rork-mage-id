export interface SquareFootModel {
  id: string;
  buildingType: string;
  category: string;
  description: string;
  costPerSF: {
    economy: { low: number; mid: number; high: number };
    standard: { low: number; mid: number; high: number };
    premium: { low: number; mid: number; high: number };
    luxury: { low: number; mid: number; high: number };
  };
  typicalSizeRange: { min: number; max: number };
  notes: string;
}

export const SQUARE_FOOT_MODELS: SquareFootModel[] = [
  {
    id: 'sfm-single-family',
    buildingType: 'Single Family Home',
    category: 'residential',
    description: 'Standard single-family detached residence',
    costPerSF: {
      economy: { low: 100, mid: 130, high: 155 },
      standard: { low: 150, mid: 185, high: 220 },
      premium: { low: 225, mid: 275, high: 340 },
      luxury: { low: 350, mid: 450, high: 600 },
    },
    typicalSizeRange: { min: 1000, max: 5000 },
    notes: 'Includes foundation, framing, MEP, finishes. Excludes land, permits, site work.',
  },
  {
    id: 'sfm-townhouse',
    buildingType: 'Townhouse / Rowhouse',
    category: 'residential',
    description: 'Attached multi-story residential unit',
    costPerSF: {
      economy: { low: 95, mid: 120, high: 145 },
      standard: { low: 140, mid: 175, high: 210 },
      premium: { low: 210, mid: 260, high: 320 },
      luxury: { low: 320, mid: 400, high: 550 },
    },
    typicalSizeRange: { min: 1200, max: 3000 },
    notes: 'Shared wall construction reduces cost. Excludes HOA infrastructure.',
  },
  {
    id: 'sfm-adu',
    buildingType: 'ADU / In-Law Suite',
    category: 'residential',
    description: 'Accessory dwelling unit, detached or attached',
    costPerSF: {
      economy: { low: 150, mid: 185, high: 220 },
      standard: { low: 200, mid: 250, high: 300 },
      premium: { low: 280, mid: 350, high: 425 },
      luxury: { low: 400, mid: 500, high: 650 },
    },
    typicalSizeRange: { min: 400, max: 1200 },
    notes: 'Higher $/SF due to fixed costs (kitchen, bath, HVAC) spread over small area.',
  },
  {
    id: 'sfm-apartment-lowrise',
    buildingType: 'Apartment (Low-Rise)',
    category: 'residential',
    description: '3-4 story wood-framed apartment building',
    costPerSF: {
      economy: { low: 120, mid: 150, high: 180 },
      standard: { low: 175, mid: 215, high: 260 },
      premium: { low: 250, mid: 310, high: 380 },
      luxury: { low: 350, mid: 430, high: 550 },
    },
    typicalSizeRange: { min: 5000, max: 80000 },
    notes: 'Per unit SF. Common Western US construction type.',
  },
  {
    id: 'sfm-garage',
    buildingType: 'Garage (Detached)',
    category: 'residential',
    description: 'Detached residential garage, slab on grade',
    costPerSF: {
      economy: { low: 40, mid: 55, high: 70 },
      standard: { low: 65, mid: 85, high: 110 },
      premium: { low: 100, mid: 130, high: 170 },
      luxury: { low: 150, mid: 200, high: 280 },
    },
    typicalSizeRange: { min: 200, max: 1200 },
    notes: 'Basic shell. Add for electrical, insulation, finishes separately.',
  },
  {
    id: 'sfm-kitchen-remodel',
    buildingType: 'Kitchen Remodel',
    category: 'renovation',
    description: 'Full kitchen renovation including cabinets, counters, appliances',
    costPerSF: {
      economy: { low: 75, mid: 100, high: 130 },
      standard: { low: 150, mid: 200, high: 260 },
      premium: { low: 250, mid: 350, high: 450 },
      luxury: { low: 400, mid: 550, high: 750 },
    },
    typicalSizeRange: { min: 80, max: 300 },
    notes: 'Based on kitchen floor area. Includes demo, cabinets, countertops, plumbing, electrical, flooring, paint.',
  },
  {
    id: 'sfm-bathroom-remodel',
    buildingType: 'Bathroom Remodel',
    category: 'renovation',
    description: 'Full bathroom renovation including fixtures and tile',
    costPerSF: {
      economy: { low: 100, mid: 150, high: 200 },
      standard: { low: 200, mid: 300, high: 400 },
      premium: { low: 350, mid: 500, high: 650 },
      luxury: { low: 550, mid: 750, high: 1000 },
    },
    typicalSizeRange: { min: 35, max: 150 },
    notes: 'Higher $/SF due to dense plumbing, tile, waterproofing.',
  },
  {
    id: 'sfm-basement-finish',
    buildingType: 'Basement Finish',
    category: 'renovation',
    description: 'Finishing an unfinished basement space',
    costPerSF: {
      economy: { low: 25, mid: 35, high: 45 },
      standard: { low: 40, mid: 55, high: 75 },
      premium: { low: 65, mid: 90, high: 120 },
      luxury: { low: 100, mid: 140, high: 200 },
    },
    typicalSizeRange: { min: 400, max: 2000 },
    notes: 'Assumes existing foundation and rough plumbing.',
  },
  {
    id: 'sfm-addition',
    buildingType: 'Room Addition',
    category: 'renovation',
    description: 'New room added to existing structure',
    costPerSF: {
      economy: { low: 120, mid: 160, high: 200 },
      standard: { low: 180, mid: 240, high: 300 },
      premium: { low: 280, mid: 360, high: 450 },
      luxury: { low: 400, mid: 500, high: 650 },
    },
    typicalSizeRange: { min: 100, max: 800 },
    notes: 'Includes foundation, framing, roofing, MEP tie-in.',
  },
  {
    id: 'sfm-whole-house-reno',
    buildingType: 'Whole House Renovation',
    category: 'renovation',
    description: 'Gut renovation of existing residence',
    costPerSF: {
      economy: { low: 80, mid: 110, high: 140 },
      standard: { low: 130, mid: 175, high: 225 },
      premium: { low: 200, mid: 270, high: 350 },
      luxury: { low: 300, mid: 400, high: 550 },
    },
    typicalSizeRange: { min: 800, max: 5000 },
    notes: 'Full interior demo to studs plus rebuild.',
  },
  {
    id: 'sfm-office-buildout',
    buildingType: 'Office Tenant Buildout',
    category: 'commercial',
    description: 'Interior buildout of commercial office space',
    costPerSF: {
      economy: { low: 40, mid: 55, high: 75 },
      standard: { low: 70, mid: 95, high: 125 },
      premium: { low: 120, mid: 160, high: 210 },
      luxury: { low: 200, mid: 275, high: 375 },
    },
    typicalSizeRange: { min: 500, max: 50000 },
    notes: 'Assumes shell and core exist.',
  },
  {
    id: 'sfm-retail-buildout',
    buildingType: 'Retail Store Buildout',
    category: 'commercial',
    description: 'Interior buildout for retail or restaurant space',
    costPerSF: {
      economy: { low: 50, mid: 70, high: 95 },
      standard: { low: 85, mid: 120, high: 160 },
      premium: { low: 150, mid: 200, high: 275 },
      luxury: { low: 250, mid: 350, high: 500 },
    },
    typicalSizeRange: { min: 500, max: 10000 },
    notes: 'Restaurant adds commercial kitchen costs.',
  },
  {
    id: 'sfm-warehouse',
    buildingType: 'Warehouse / Light Industrial',
    category: 'commercial',
    description: 'Pre-engineered metal building or tilt-up warehouse',
    costPerSF: {
      economy: { low: 35, mid: 50, high: 65 },
      standard: { low: 55, mid: 75, high: 100 },
      premium: { low: 85, mid: 115, high: 150 },
      luxury: { low: 130, mid: 175, high: 230 },
    },
    typicalSizeRange: { min: 5000, max: 100000 },
    notes: 'Shell only. Add for office areas, loading docks separately.',
  },
  {
    id: 'sfm-deck',
    buildingType: 'Deck',
    category: 'exterior',
    description: 'Exterior deck with railing',
    costPerSF: {
      economy: { low: 20, mid: 30, high: 40 },
      standard: { low: 35, mid: 50, high: 65 },
      premium: { low: 55, mid: 75, high: 100 },
      luxury: { low: 85, mid: 120, high: 170 },
    },
    typicalSizeRange: { min: 100, max: 800 },
    notes: 'Economy = PT wood. Standard = basic composite. Premium = premium composite. Luxury = Ipe.',
  },
  {
    id: 'sfm-fence',
    buildingType: 'Fence (per LF)',
    category: 'exterior',
    description: 'Privacy fence installation',
    costPerSF: {
      economy: { low: 15, mid: 22, high: 30 },
      standard: { low: 25, mid: 35, high: 48 },
      premium: { low: 40, mid: 55, high: 75 },
      luxury: { low: 65, mid: 90, high: 130 },
    },
    typicalSizeRange: { min: 100, max: 500 },
    notes: 'Per linear foot. Economy = chain link. Standard = wood privacy. Premium = vinyl. Luxury = ornamental iron.',
  },
  {
    id: 'sfm-driveway',
    buildingType: 'Driveway / Parking',
    category: 'exterior',
    description: 'Paved driveway or parking area',
    costPerSF: {
      economy: { low: 3, mid: 5, high: 8 },
      standard: { low: 7, mid: 10, high: 14 },
      premium: { low: 12, mid: 18, high: 25 },
      luxury: { low: 20, mid: 30, high: 45 },
    },
    typicalSizeRange: { min: 200, max: 5000 },
    notes: 'Economy = gravel. Standard = asphalt. Premium = concrete. Luxury = pavers.',
  },
];

export type QualityTier = 'economy' | 'standard' | 'premium' | 'luxury';

export const QUALITY_TIERS: { id: QualityTier; label: string; description: string }[] = [
  { id: 'economy', label: 'Economy', description: 'Budget materials, basic finishes' },
  { id: 'standard', label: 'Standard', description: 'Mid-range materials, typical finishes' },
  { id: 'premium', label: 'Premium', description: 'High-quality materials, upgraded finishes' },
  { id: 'luxury', label: 'Luxury', description: 'Top-tier materials, custom everything' },
];

export const SF_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'residential', label: 'Residential' },
  { id: 'renovation', label: 'Renovation' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'exterior', label: 'Exterior' },
];
