export interface ProductivityRate {
  id: string;
  task: string;
  category: string;
  unit: string;
  crew: string;
  dailyOutput: number;
  laborCostPerUnit: number;
  materialCostPerUnit: number;
  equipmentCostPerUnit: number;
  notes: string;
}

export const PRODUCTIVITY_RATES: ProductivityRate[] = [
  { id: 'pr-frame-wall-2x4', task: 'Frame Interior Wall (2x4, 16" OC)', category: 'structural', unit: 'LF', crew: '1 Carpenter + 1 Laborer', dailyOutput: 65, laborCostPerUnit: 8.50, materialCostPerUnit: 6.80, equipmentCostPerUnit: 0.35, notes: '8ft ceiling height. Add 15% for headers.' },
  { id: 'pr-frame-wall-2x6', task: 'Frame Exterior Wall (2x6, 16" OC)', category: 'structural', unit: 'LF', crew: '1 Carpenter + 1 Laborer', dailyOutput: 55, laborCostPerUnit: 10.20, materialCostPerUnit: 9.50, equipmentCostPerUnit: 0.45, notes: '8-9ft walls. Includes plates and blocking.' },
  { id: 'pr-hang-drywall', task: 'Hang Drywall (1/2", walls)', category: 'drywall', unit: 'SF', crew: '2 Drywall Installers', dailyOutput: 1200, laborCostPerUnit: 0.65, materialCostPerUnit: 0.55, equipmentCostPerUnit: 0.05, notes: 'Walls only. Ceiling reduces output by 30%.' },
  { id: 'pr-tape-drywall', task: 'Tape & Finish Drywall (Level 4)', category: 'drywall', unit: 'SF', crew: '1 Drywall Finisher', dailyOutput: 400, laborCostPerUnit: 0.95, materialCostPerUnit: 0.15, equipmentCostPerUnit: 0.02, notes: '3-coat finish. Level 5 adds skim coat (+$0.35/SF).' },
  { id: 'pr-install-hardwood', task: 'Install Hardwood Flooring (nail-down)', category: 'flooring', unit: 'SF', crew: '1 Flooring Installer + 1 Helper', dailyOutput: 200, laborCostPerUnit: 1.85, materialCostPerUnit: 5.50, equipmentCostPerUnit: 0.15, notes: '3/4" solid hardwood. Includes acclimation time.' },
  { id: 'pr-install-lvp', task: 'Install LVP (click-lock)', category: 'flooring', unit: 'SF', crew: '1 Flooring Installer', dailyOutput: 350, laborCostPerUnit: 0.95, materialCostPerUnit: 3.00, equipmentCostPerUnit: 0.05, notes: 'Floating installation. Includes underlayment.' },
  { id: 'pr-install-tile', task: 'Install Ceramic Tile (floor)', category: 'flooring', unit: 'SF', crew: '1 Tile Setter + 1 Helper', dailyOutput: 100, laborCostPerUnit: 3.50, materialCostPerUnit: 3.50, equipmentCostPerUnit: 0.20, notes: '12x12 or 12x24 tile. Mosaic reduces output by 50%.' },
  { id: 'pr-rough-electric-outlet', task: 'Rough-In Electrical Outlet', category: 'electrical', unit: 'EA', crew: '1 Electrician + 1 Apprentice', dailyOutput: 10, laborCostPerUnit: 45.00, materialCostPerUnit: 18.00, equipmentCostPerUnit: 2.00, notes: 'Includes wire run from panel, box, and device.' },
  { id: 'pr-rough-electric-switch', task: 'Rough-In Light Switch', category: 'electrical', unit: 'EA', crew: '1 Electrician + 1 Apprentice', dailyOutput: 12, laborCostPerUnit: 38.00, materialCostPerUnit: 12.00, equipmentCostPerUnit: 1.50, notes: 'Single pole. 3-way adds $15 labor + $4 material.' },
  { id: 'pr-rough-plumb-bath', task: 'Rough-In Plumbing (Full Bath)', category: 'plumbing', unit: 'EA', crew: '1 Plumber + 1 Apprentice', dailyOutput: 0.5, laborCostPerUnit: 1200.00, materialCostPerUnit: 650.00, equipmentCostPerUnit: 50.00, notes: 'Includes toilet, sink, shower/tub supply and drain. Takes 2 days.' },
  { id: 'pr-rough-plumb-kitchen', task: 'Rough-In Plumbing (Kitchen)', category: 'plumbing', unit: 'EA', crew: '1 Plumber + 1 Apprentice', dailyOutput: 1, laborCostPerUnit: 650.00, materialCostPerUnit: 350.00, equipmentCostPerUnit: 35.00, notes: 'Includes sink supply/drain and dishwasher connection.' },
  { id: 'pr-install-shingles', task: 'Install Asphalt Shingles', category: 'roofing', unit: 'SQ', crew: '1 Roofer + 1 Helper', dailyOutput: 5, laborCostPerUnit: 85.00, materialCostPerUnit: 135.00, equipmentCostPerUnit: 12.00, notes: 'Includes felt, nails, starter strip. Steep pitch -25%.' },
  { id: 'pr-paint-interior', task: 'Paint Interior Walls (2 coats)', category: 'paint', unit: 'SF', crew: '1 Painter', dailyOutput: 400, laborCostPerUnit: 0.55, materialCostPerUnit: 0.25, equipmentCostPerUnit: 0.05, notes: 'Walls only. Cutting in adds 20% time.' },
  { id: 'pr-paint-exterior', task: 'Paint Exterior (2 coats)', category: 'paint', unit: 'SF', crew: '1 Painter + 1 Helper', dailyOutput: 500, laborCostPerUnit: 0.70, materialCostPerUnit: 0.35, equipmentCostPerUnit: 0.10, notes: 'Includes power washing and scaffold time.' },
  { id: 'pr-pour-slab', task: 'Pour Concrete Slab (4")', category: 'concrete', unit: 'SF', crew: '1 Concrete Finisher + 2 Laborers', dailyOutput: 500, laborCostPerUnit: 2.10, materialCostPerUnit: 4.50, equipmentCostPerUnit: 0.80, notes: 'Includes forming, gravel base, wire mesh, pour, finish.' },
  { id: 'pr-install-siding-vinyl', task: 'Install Vinyl Siding', category: 'siding', unit: 'SQ', crew: '1 Siding Installer + 1 Helper', dailyOutput: 3, laborCostPerUnit: 120.00, materialCostPerUnit: 95.00, equipmentCostPerUnit: 8.00, notes: 'Includes J-channel, corners, starter strip.' },
  { id: 'pr-install-insulation-batt', task: 'Install Batt Insulation (R-13)', category: 'insulation', unit: 'SF', crew: '1 Insulation Installer', dailyOutput: 1500, laborCostPerUnit: 0.25, materialCostPerUnit: 0.60, equipmentCostPerUnit: 0.02, notes: 'R-13 fiberglass in 2x4 walls. R-19+ reduces output 20%.' },
  { id: 'pr-install-cabinets-base', task: 'Install Base Cabinets', category: 'finish', unit: 'LF', crew: '1 Carpenter + 1 Helper', dailyOutput: 12, laborCostPerUnit: 35.00, materialCostPerUnit: 180.00, equipmentCostPerUnit: 3.00, notes: 'Stock cabinets. Custom adds 30% labor.' },
  { id: 'pr-install-cabinets-wall', task: 'Install Wall Cabinets', category: 'finish', unit: 'LF', crew: '1 Carpenter + 1 Helper', dailyOutput: 14, laborCostPerUnit: 30.00, materialCostPerUnit: 150.00, equipmentCostPerUnit: 2.00, notes: 'Stock wall cabinets. Custom adds 25% labor.' },
  { id: 'pr-demo-interior', task: 'Demo Interior (gut to studs)', category: 'demo', unit: 'SF', crew: '2 Laborers', dailyOutput: 400, laborCostPerUnit: 1.50, materialCostPerUnit: 0.00, equipmentCostPerUnit: 0.25, notes: 'Includes dumpster loading. No hazmat/asbestos.' },
  { id: 'pr-install-fence-wood', task: 'Install Wood Privacy Fence', category: 'exterior', unit: 'LF', crew: '1 Carpenter + 1 Laborer', dailyOutput: 40, laborCostPerUnit: 12.00, materialCostPerUnit: 18.00, equipmentCostPerUnit: 1.50, notes: '6ft tall, PT posts, cedar/PT pickets. Includes post holes.' },
  { id: 'pr-install-window', task: 'Install Replacement Window', category: 'finish', unit: 'EA', crew: '1 Carpenter + 1 Helper', dailyOutput: 4, laborCostPerUnit: 125.00, materialCostPerUnit: 280.00, equipmentCostPerUnit: 8.00, notes: 'Vinyl replacement in existing opening.' },
  { id: 'pr-install-door-interior', task: 'Install Interior Door (prehung)', category: 'finish', unit: 'EA', crew: '1 Carpenter', dailyOutput: 5, laborCostPerUnit: 55.00, materialCostPerUnit: 260.00, equipmentCostPerUnit: 3.00, notes: 'Prehung door with casing and hardware.' },
  { id: 'pr-install-minisplit', task: 'Install Mini-Split AC (12K BTU)', category: 'hvac', unit: 'EA', crew: '1 HVAC Tech + 1 Electrician', dailyOutput: 1, laborCostPerUnit: 450.00, materialCostPerUnit: 950.00, equipmentCostPerUnit: 25.00, notes: 'Single zone, line set up to 25ft.' },
];

export const PRODUCTIVITY_CATEGORIES = [
  { id: 'all', label: 'All Tasks' },
  { id: 'structural', label: 'Structural' },
  { id: 'drywall', label: 'Drywall' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'roofing', label: 'Roofing' },
  { id: 'paint', label: 'Paint' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'siding', label: 'Siding' },
  { id: 'insulation', label: 'Insulation' },
  { id: 'finish', label: 'Finish' },
  { id: 'hvac', label: 'HVAC' },
  { id: 'demo', label: 'Demo' },
  { id: 'exterior', label: 'Exterior' },
];
