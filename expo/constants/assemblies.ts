export interface AssemblyMaterial {
  materialId: string;
  name: string;
  quantityPerUnit: number;
  unit: string;
  wasteFactor: number;
}

export interface AssemblyLabor {
  trade: string;
  hoursPerUnit: number;
}

export interface AssemblyItem {
  id: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  materialsPerUnit: AssemblyMaterial[];
  laborPerUnit: AssemblyLabor[];
  notes: string;
}

export const ASSEMBLIES: AssemblyItem[] = [
  {
    id: 'asm-frame-wall-2x4',
    name: 'Frame Interior Wall (2x4)',
    category: 'structural',
    description: 'Complete 2x4 stud wall framing including top/bottom plates, studs at 16" OC, and fasteners',
    unit: 'per LF',
    materialsPerUnit: [
      { materialId: 'l1', name: '2x4x8 Stud', quantityPerUnit: 0.75, unit: 'each', wasteFactor: 0.10 },
      { materialId: 'l1', name: '2x4 Plate Stock', quantityPerUnit: 0.25, unit: 'each', wasteFactor: 0.05 },
      { materialId: 'hw1', name: '16d Framing Nails', quantityPerUnit: 0.02, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.25 },
      { trade: 'General Laborer', hoursPerUnit: 0.10 },
    ],
    notes: 'Based on 8ft ceiling height, studs at 16" on center. Add 15% for door/window headers.',
  },
  {
    id: 'asm-frame-wall-2x6',
    name: 'Frame Exterior Wall (2x6)',
    category: 'structural',
    description: 'Complete 2x6 exterior wall framing with plates, studs at 16" OC, and sheathing',
    unit: 'per LF',
    materialsPerUnit: [
      { materialId: 'l2', name: '2x6x8 Framing Lumber', quantityPerUnit: 0.75, unit: 'each', wasteFactor: 0.10 },
      { materialId: 'l2', name: '2x6 Plate Stock', quantityPerUnit: 0.25, unit: 'each', wasteFactor: 0.05 },
      { materialId: 'l9', name: '3/4" OSB Sheathing', quantityPerUnit: 0.125, unit: 'sheet', wasteFactor: 0.08 },
      { materialId: 'hw1', name: '16d Framing Nails', quantityPerUnit: 0.03, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.35 },
      { trade: 'General Laborer', hoursPerUnit: 0.15 },
    ],
    notes: '8ft wall height, studs at 16" OC with OSB sheathing. Does not include house wrap.',
  },
  {
    id: 'asm-drywall-hang-finish',
    name: 'Hang & Finish Drywall',
    category: 'drywall',
    description: 'Install 1/2" drywall including taping, mudding (3 coats), and sanding to Level 4 finish',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'd1', name: '1/2" Drywall 4x8', quantityPerUnit: 0.03125, unit: 'sheet', wasteFactor: 0.12 },
      { materialId: 'd6', name: 'Joint Compound 5gal', quantityPerUnit: 0.003, unit: 'bucket', wasteFactor: 0 },
      { materialId: 'd8', name: 'Paper Tape', quantityPerUnit: 0.002, unit: 'roll', wasteFactor: 0 },
      { materialId: 'd12', name: 'Drywall Screws', quantityPerUnit: 0.005, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Drywall Installer', hoursPerUnit: 0.08 },
    ],
    notes: 'Level 4 finish suitable for flat paint. Add 20% labor for Level 5 (skim coat).',
  },
  {
    id: 'asm-hardwood-floor',
    name: 'Install Hardwood Flooring',
    category: 'flooring',
    description: 'Install 3/4" solid hardwood flooring with underlayment and trim',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'f1', name: 'Hardwood Oak 3/4" Solid', quantityPerUnit: 1, unit: 'sq ft', wasteFactor: 0.10 },
      { materialId: 'f18', name: 'Underlayment Foam', quantityPerUnit: 0.01, unit: 'roll', wasteFactor: 0.05 },
      { materialId: 'hw1', name: 'Flooring Nails/Staples', quantityPerUnit: 0.002, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Flooring Installer', hoursPerUnit: 0.06 },
    ],
    notes: 'Includes acclimation time. Does not include baseboard or trim.',
  },
  {
    id: 'asm-lvp-floor',
    name: 'Install LVP Flooring',
    category: 'flooring',
    description: 'Install luxury vinyl plank flooring with underlayment',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'f3', name: 'LVP Luxury Vinyl Plank', quantityPerUnit: 1, unit: 'sq ft', wasteFactor: 0.08 },
      { materialId: 'f18', name: 'Underlayment Foam', quantityPerUnit: 0.01, unit: 'roll', wasteFactor: 0.05 },
    ],
    laborPerUnit: [
      { trade: 'Flooring Installer', hoursPerUnit: 0.04 },
    ],
    notes: 'Click-lock installation. Faster than hardwood.',
  },
  {
    id: 'asm-tile-floor',
    name: 'Install Ceramic Tile Floor',
    category: 'flooring',
    description: 'Install 12x12" ceramic tile with mortar, grout, and spacers',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'f5', name: 'Ceramic Tile 12x12"', quantityPerUnit: 1, unit: 'sq ft', wasteFactor: 0.12 },
      { materialId: 'f15', name: 'Tile Mortar Modified', quantityPerUnit: 0.008, unit: 'bag', wasteFactor: 0 },
      { materialId: 'f16', name: 'Grout Sanded', quantityPerUnit: 0.004, unit: 'bag', wasteFactor: 0 },
      { materialId: 'f21', name: 'Tile Spacers', quantityPerUnit: 0.005, unit: 'pack', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Flooring Installer', hoursPerUnit: 0.10 },
    ],
    notes: 'Standard straight-set pattern. Add 30% labor for diagonal or herringbone.',
  },
  {
    id: 'asm-electrical-outlet',
    name: 'Rough-in Electrical Outlet',
    category: 'electrical',
    description: 'Install one duplex outlet including wire run, box, outlet, and plate',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'e1', name: '14/2 NM-B Wire (25ft avg)', quantityPerUnit: 0.1, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'e18', name: 'Outlet Box', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'e9', name: 'Standard Outlet 15A', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'e20', name: 'Wire Connectors', quantityPerUnit: 0.03, unit: 'pack', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Electrician', hoursPerUnit: 0.75 },
    ],
    notes: 'Average 25ft wire run. GFCI outlets in wet locations add ~$15/ea.',
  },
  {
    id: 'asm-electrical-circuit',
    name: 'New 20A Circuit (complete)',
    category: 'electrical',
    description: 'Run new 20A circuit from panel including breaker, wire, and 4 outlets',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'e2', name: '12/2 NM-B Wire (250ft)', quantityPerUnit: 0.4, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'e15', name: '20A Breaker', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'e18', name: 'Outlet Box', quantityPerUnit: 4, unit: 'each', wasteFactor: 0 },
      { materialId: 'e9', name: 'Standard Outlet', quantityPerUnit: 4, unit: 'each', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Electrician', hoursPerUnit: 4 },
    ],
    notes: 'Average 100ft home run. Code requires 20A for kitchen, bath, garage circuits.',
  },
  {
    id: 'asm-recessed-light',
    name: 'Install Recessed Light',
    category: 'electrical',
    description: 'Install one 6" LED canless recessed light with wire and switch leg',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'e11', name: 'LED Recessed Light 6"', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'e1', name: '14/2 NM-B Wire (15ft avg)', quantityPerUnit: 0.06, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'e20', name: 'Wire Connectors', quantityPerUnit: 0.02, unit: 'pack', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Electrician', hoursPerUnit: 0.5 },
    ],
    notes: 'Canless LED. Price per fixture decreases with quantity (daisy chain).',
  },
  {
    id: 'asm-shingle-roof',
    name: 'Install Asphalt Shingles',
    category: 'roofing',
    description: 'Install architectural shingles with felt, starter, ridge cap, and flashing',
    unit: 'per SQ',
    materialsPerUnit: [
      { materialId: 'r1', name: 'Architectural Shingles', quantityPerUnit: 1, unit: 'square', wasteFactor: 0.10 },
      { materialId: 'r6', name: 'Synthetic Felt', quantityPerUnit: 0.25, unit: 'roll', wasteFactor: 0.05 },
      { materialId: 'r9', name: 'Ridge Cap Shingles', quantityPerUnit: 0.1, unit: 'bundle', wasteFactor: 0 },
      { materialId: 'r10', name: 'Drip Edge', quantityPerUnit: 1, unit: 'each', wasteFactor: 0.05 },
      { materialId: 'r19', name: 'Roofing Nails', quantityPerUnit: 2, unit: 'lb', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Roofer', hoursPerUnit: 1.5 },
      { trade: 'General Laborer', hoursPerUnit: 0.5 },
    ],
    notes: '1 square = 100 SF. Includes tear-off of one layer. Add $30/SQ for additional layers.',
  },
  {
    id: 'asm-concrete-slab',
    name: 'Pour Concrete Slab (4")',
    category: 'concrete',
    description: 'Pour 4" concrete slab with gravel base, rebar, wire mesh, and finishing',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'c1', name: 'Ready-Mix Concrete 3000PSI', quantityPerUnit: 0.012, unit: 'cu yd', wasteFactor: 0.05 },
      { materialId: 'c4', name: 'Rebar #3', quantityPerUnit: 0.05, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'c14', name: 'Crushed Gravel', quantityPerUnit: 0.02, unit: 'bag', wasteFactor: 0 },
      { materialId: 'c8', name: 'Vapor Barrier', quantityPerUnit: 0.002, unit: 'roll', wasteFactor: 0.05 },
    ],
    laborPerUnit: [
      { trade: 'Concrete Finisher', hoursPerUnit: 0.04 },
      { trade: 'General Laborer', hoursPerUnit: 0.03 },
    ],
    notes: '4" slab on 4" gravel base. Minimum 200 SF pour for ready-mix delivery.',
  },
  {
    id: 'asm-plumb-bathroom',
    name: 'Plumb Bathroom (rough-in)',
    category: 'plumbing',
    description: 'Complete rough-in plumbing for standard bathroom — toilet, sink, tub/shower',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'p7', name: '1/2" PEX-A Pipe', quantityPerUnit: 0.5, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'p5', name: '3" ABS Drain Pipe', quantityPerUnit: 2, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'p4', name: '1.5" PVC DWV Pipe', quantityPerUnit: 2, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'p13', name: 'Shower Valve', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'p17', name: 'SharkBite Fittings', quantityPerUnit: 6, unit: 'each', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Plumber', hoursPerUnit: 8 },
    ],
    notes: 'Rough-in only. Does not include fixtures (toilet, vanity, tub). Add $2K-$4K for fixtures.',
  },
  {
    id: 'asm-plumb-kitchen',
    name: 'Plumb Kitchen (rough-in)',
    category: 'plumbing',
    description: 'Rough-in plumbing for kitchen — sink, dishwasher, ice maker line',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'p7', name: '1/2" PEX-A Pipe', quantityPerUnit: 0.3, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'p4', name: '1.5" PVC DWV Pipe', quantityPerUnit: 1, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'p19', name: 'P-Trap', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'p17', name: 'SharkBite Fittings', quantityPerUnit: 4, unit: 'each', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Plumber', hoursPerUnit: 5 },
    ],
    notes: 'Rough-in only. Kitchen sink, dishwasher hookup, ice maker line.',
  },
  {
    id: 'asm-paint-interior',
    name: 'Paint Interior (2 coats)',
    category: 'paint',
    description: 'Prime and paint interior walls — 2 coats latex eggshell over primer',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'pa1', name: 'Interior Latex Paint Eggshell', quantityPerUnit: 0.003, unit: 'gallon', wasteFactor: 0.10 },
      { materialId: 'pa5', name: 'Primer Sealer', quantityPerUnit: 0.002, unit: 'gallon', wasteFactor: 0.10 },
      { materialId: 'pa14', name: "Painter's Tape", quantityPerUnit: 0.002, unit: 'roll', wasteFactor: 0 },
      { materialId: 'pa11', name: 'Roller Covers', quantityPerUnit: 0.001, unit: 'pack', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Painter', hoursPerUnit: 0.02 },
    ],
    notes: 'Wall area only. Ceilings add ~20%. Trim/cabinets priced separately.',
  },
  {
    id: 'asm-paint-exterior',
    name: 'Paint Exterior (2 coats)',
    category: 'paint',
    description: 'Power wash, prime, and paint exterior with 2 coats duration-grade paint',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'pa3', name: 'Exterior Paint Duration', quantityPerUnit: 0.003, unit: 'gallon', wasteFactor: 0.12 },
      { materialId: 'pa7', name: 'Primer Stain-Block', quantityPerUnit: 0.002, unit: 'gallon', wasteFactor: 0.10 },
      { materialId: 'sid10', name: 'Exterior Caulk', quantityPerUnit: 0.003, unit: 'tube', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Painter', hoursPerUnit: 0.03 },
    ],
    notes: 'Includes power washing. Ladder/scaffold access adds 15-25%.',
  },
  {
    id: 'asm-vinyl-siding',
    name: 'Install Vinyl Siding',
    category: 'siding',
    description: 'Install vinyl siding with J-channel, corners, house wrap, and trim',
    unit: 'per SQ',
    materialsPerUnit: [
      { materialId: 'sid1', name: 'Vinyl Siding', quantityPerUnit: 1, unit: 'square', wasteFactor: 0.10 },
      { materialId: 'sid11', name: 'J-Channel', quantityPerUnit: 2, unit: 'each', wasteFactor: 0.05 },
      { materialId: 'sid5', name: 'House Wrap Tyvek', quantityPerUnit: 0.1, unit: 'roll', wasteFactor: 0.05 },
      { materialId: 'hw1', name: 'Siding Nails', quantityPerUnit: 0.05, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 1.0 },
      { trade: 'General Laborer', hoursPerUnit: 0.3 },
    ],
    notes: '1 square = 100 SF. Does not include soffit/fascia.',
  },
  {
    id: 'asm-insulation-batt',
    name: 'Install Batt Insulation (R-13)',
    category: 'insulation',
    description: 'Install R-13 kraft-faced batt insulation in 2x4 wall cavities',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'ins1', name: 'R-13 Kraft Batt', quantityPerUnit: 0.025, unit: 'bag', wasteFactor: 0.05 },
    ],
    laborPerUnit: [
      { trade: 'Insulation Worker', hoursPerUnit: 0.015 },
    ],
    notes: 'Standard 2x4 wall cavities. Use R-19/R-21 for 2x6 walls.',
  },
  {
    id: 'asm-insulation-attic',
    name: 'Blow-In Attic Insulation (R-38)',
    category: 'insulation',
    description: 'Blow-in fiberglass insulation to R-38 in open attic',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'ins9', name: 'Blown-In Fiberglass', quantityPerUnit: 0.03, unit: 'bag', wasteFactor: 0.05 },
    ],
    laborPerUnit: [
      { trade: 'Insulation Worker', hoursPerUnit: 0.01 },
    ],
    notes: 'Open attic with machine blower. R-38 = ~10-12" depth.',
  },
  {
    id: 'asm-deck-composite',
    name: 'Build Composite Deck',
    category: 'decking',
    description: 'Complete composite deck build — framing, decking, railing, stairs',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'dk1', name: 'Composite Deck Board Trex', quantityPerUnit: 0.125, unit: 'each', wasteFactor: 0.10 },
      { materialId: 'dk5', name: 'Deck Joist 2x8', quantityPerUnit: 0.08, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'dk6', name: 'Deck Post 4x4', quantityPerUnit: 0.015, unit: 'each', wasteFactor: 0 },
      { materialId: 'dk11', name: 'Deck Screws', quantityPerUnit: 0.003, unit: 'box', wasteFactor: 0 },
      { materialId: 'c17', name: 'Post Hole Concrete', quantityPerUnit: 0.02, unit: 'bag', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.15 },
      { trade: 'General Laborer', hoursPerUnit: 0.05 },
    ],
    notes: 'Assumes ground-level deck. Elevated decks add 30-50%. Railing adds ~$25-40/LF.',
  },
  {
    id: 'asm-deck-wood',
    name: 'Build PT Wood Deck',
    category: 'decking',
    description: 'Complete pressure-treated wood deck — framing, decking, basic railing',
    unit: 'per SF',
    materialsPerUnit: [
      { materialId: 'dk3', name: 'PT Deck Board 5/4x6', quantityPerUnit: 0.125, unit: 'each', wasteFactor: 0.10 },
      { materialId: 'dk5', name: 'Deck Joist 2x8', quantityPerUnit: 0.08, unit: 'each', wasteFactor: 0.08 },
      { materialId: 'dk6', name: 'Deck Post 4x4', quantityPerUnit: 0.015, unit: 'each', wasteFactor: 0 },
      { materialId: 'hw3', name: 'Deck Screws 3"', quantityPerUnit: 0.003, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.12 },
      { trade: 'General Laborer', hoursPerUnit: 0.04 },
    ],
    notes: 'PT wood requires annual sealing. Ground-level deck pricing.',
  },
  {
    id: 'asm-fence-privacy',
    name: 'Install Privacy Fence (6ft Wood)',
    category: 'fencing',
    description: 'Install 6ft wood privacy fence with posts, panels, and gate',
    unit: 'per LF',
    materialsPerUnit: [
      { materialId: 'fn1', name: 'Privacy Fence Panel 6x8ft', quantityPerUnit: 0.125, unit: 'each', wasteFactor: 0.05 },
      { materialId: 'fn6', name: 'Fence Post 4x4x8', quantityPerUnit: 0.125, unit: 'each', wasteFactor: 0 },
      { materialId: 'c17', name: 'Post Hole Concrete', quantityPerUnit: 0.25, unit: 'bag', wasteFactor: 0 },
      { materialId: 'hw3', name: 'Deck Screws', quantityPerUnit: 0.005, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.15 },
      { trade: 'General Laborer', hoursPerUnit: 0.10 },
    ],
    notes: 'Posts set in concrete at 8ft OC. Gate priced separately (~$150-250 installed).',
  },
  {
    id: 'asm-kitchen-cabinet-base',
    name: 'Install Base Cabinets',
    category: 'finishing',
    description: 'Install pre-assembled base kitchen cabinets with hardware and shimming',
    unit: 'per LF',
    materialsPerUnit: [
      { materialId: 'hw12', name: 'Construction Adhesive', quantityPerUnit: 0.1, unit: 'tube', wasteFactor: 0 },
      { materialId: 'hw5', name: 'Structural Screws', quantityPerUnit: 0.1, unit: 'box', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 0.5 },
    ],
    notes: 'Labor only for installation. Cabinet cost varies $100-$500/LF depending on quality.',
  },
  {
    id: 'asm-window-install',
    name: 'Install Vinyl Window',
    category: 'finishing',
    description: 'Remove old window and install new vinyl replacement window with trim and caulk',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'wd1', name: 'Double-Hung Window 36x60"', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'sid10', name: 'Exterior Caulk', quantityPerUnit: 0.5, unit: 'tube', wasteFactor: 0 },
      { materialId: 'ins10', name: 'Spray Foam Can', quantityPerUnit: 0.5, unit: 'each', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 1.5 },
    ],
    notes: 'Replacement window in existing opening. New construction windows take longer.',
  },
  {
    id: 'asm-door-interior',
    name: 'Install Interior Door (prehung)',
    category: 'finishing',
    description: 'Install prehung interior door with casing and hardware',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'wd10', name: 'Prehung Interior Door', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'wd13', name: 'Door Knob Set', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'hw13', name: 'Liquid Nails', quantityPerUnit: 0.2, unit: 'tube', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'Carpenter', hoursPerUnit: 1.0 },
    ],
    notes: 'Prehung door in existing framed opening. Includes casing both sides.',
  },
  {
    id: 'asm-hvac-minisplit',
    name: 'Install Mini-Split AC (12K BTU)',
    category: 'hvac',
    description: 'Install single-zone ductless mini-split 12,000 BTU with line set and electrical',
    unit: 'per EA',
    materialsPerUnit: [
      { materialId: 'hv6', name: 'Mini-Split 12K BTU', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
      { materialId: 'e5', name: '6/3 NM-B Wire', quantityPerUnit: 0.4, unit: 'roll', wasteFactor: 0.10 },
      { materialId: 'e16', name: '30A Breaker', quantityPerUnit: 1, unit: 'each', wasteFactor: 0 },
    ],
    laborPerUnit: [
      { trade: 'HVAC Technician', hoursPerUnit: 6 },
      { trade: 'Electrician', hoursPerUnit: 2 },
    ],
    notes: 'Includes line set up to 25ft. Longer runs add cost. Requires dedicated circuit.',
  },
  {
    id: 'asm-demo-interior',
    name: 'Interior Demolition',
    category: 'general',
    description: 'Demo interior walls, flooring, and fixtures — includes haul-off',
    unit: 'per SF',
    materialsPerUnit: [],
    laborPerUnit: [
      { trade: 'Demolition Worker', hoursPerUnit: 0.05 },
      { trade: 'General Laborer', hoursPerUnit: 0.03 },
    ],
    notes: 'Assumes non-load-bearing walls. Load-bearing requires engineer. Dumpster rental separate ($350-$500).',
  },
];

export const ASSEMBLY_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'structural', label: 'Structural' },
  { id: 'drywall', label: 'Drywall' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'roofing', label: 'Roofing' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'paint', label: 'Paint' },
  { id: 'siding', label: 'Siding' },
  { id: 'insulation', label: 'Insulation' },
  { id: 'decking', label: 'Decking' },
  { id: 'fencing', label: 'Fencing' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'hvac', label: 'HVAC' },
  { id: 'general', label: 'General' },
];
