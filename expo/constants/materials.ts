export interface MaterialItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  baseRetailPrice: number;
  baseBulkPrice: number;
  bulkMinQty: number;
  supplier: string;
  sku?: string;
  pricingModel?: 'market' | 'regional_adjusted';
  sourceLabel?: string;
  region?: string;
  specTier?: 'base' | 'regional' | 'assembly';
  assemblyCode?: string;
  crew?: string;
  wasteFactor?: number;
  laborCostPerUnit?: number;
  equipmentCostPerUnit?: number;
  installHoursPerUnit?: number;
  installTrade?: string;
}

export const BASE_MATERIALS: MaterialItem[] = [
  // ─── LUMBER & FRAMING ───────────────────────────────────────────────
  { id: 'l1', name: '2x4x8 Stud (Douglas Fir)', category: 'lumber', unit: 'each', baseRetailPrice: 5.98, baseBulkPrice: 4.75, bulkMinQty: 100, supplier: 'Home Depot', sku: '161640' },
  { id: 'l2', name: '2x6x8 Framing Lumber', category: 'lumber', unit: 'each', baseRetailPrice: 9.47, baseBulkPrice: 7.80, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'l3', name: '2x8x16 Framing Lumber', category: 'lumber', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.80, bulkMinQty: 25, supplier: 'Home Depot' },
  { id: 'l4', name: '2x10x16 Floor Joist', category: 'lumber', unit: 'each', baseRetailPrice: 24.98, baseBulkPrice: 20.50, bulkMinQty: 25, supplier: 'BMC Supply' },
  { id: 'l5', name: '2x12x16 Lumber', category: 'lumber', unit: 'each', baseRetailPrice: 32.47, baseBulkPrice: 27.00, bulkMinQty: 20, supplier: "Lowe's" },
  { id: 'l6', name: '4x4x8 Post (Pressure Treated)', category: 'lumber', unit: 'each', baseRetailPrice: 12.48, baseBulkPrice: 10.20, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'l7', name: '4x6x8 Post (Pressure Treated)', category: 'lumber', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.80, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'l8', name: '6x6x10 Post (Pressure Treated)', category: 'lumber', unit: 'each', baseRetailPrice: 32.97, baseBulkPrice: 27.50, bulkMinQty: 15, supplier: "Lowe's" },
  { id: 'l9', name: '3/4" OSB Sheathing 4x8', category: 'lumber', unit: 'sheet', baseRetailPrice: 38.97, baseBulkPrice: 32.00, bulkMinQty: 40, supplier: 'Home Depot' },
  { id: 'l10', name: '1/2" Plywood 4x8 CDX', category: 'lumber', unit: 'sheet', baseRetailPrice: 42.98, baseBulkPrice: 36.50, bulkMinQty: 40, supplier: 'Home Depot' },
  { id: 'l11', name: '3/4" Plywood 4x8 (Sanded)', category: 'lumber', unit: 'sheet', baseRetailPrice: 55.97, baseBulkPrice: 48.00, bulkMinQty: 30, supplier: "Lowe's" },
  { id: 'l12', name: "LVL Beam 1.75\"x9.5\"x20'", category: 'lumber', unit: 'each', baseRetailPrice: 189.00, baseBulkPrice: 162.00, bulkMinQty: 5, supplier: 'BMC Supply' },
  { id: 'l13', name: "Glulam Beam 3.5\"x9\"x20'", category: 'lumber', unit: 'each', baseRetailPrice: 245.00, baseBulkPrice: 210.00, bulkMinQty: 3, supplier: 'Pacific Woodtech' },
  { id: 'l14', name: "5/4x6x16 Treated Deck Board", category: 'lumber', unit: 'each', baseRetailPrice: 17.97, baseBulkPrice: 14.80, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'l15', name: '3/4" MDF Sheet 4x8', category: 'lumber', unit: 'sheet', baseRetailPrice: 38.97, baseBulkPrice: 32.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'l16', name: '1x6x8 Pine Board', category: 'lumber', unit: 'each', baseRetailPrice: 6.97, baseBulkPrice: 5.50, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'l17', name: '1x4x8 Furring Strip', category: 'lumber', unit: 'each', baseRetailPrice: 3.48, baseBulkPrice: 2.70, bulkMinQty: 100, supplier: 'Home Depot' },
  { id: 'l18', name: 'Particle Board 3/4" 4x8', category: 'lumber', unit: 'sheet', baseRetailPrice: 22.97, baseBulkPrice: 18.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'l19', name: '2x4x10 Stud (SYP)', category: 'lumber', unit: 'each', baseRetailPrice: 7.47, baseBulkPrice: 5.90, bulkMinQty: 75, supplier: "Lowe's" },
  { id: 'l20', name: 'Cedar Rough Sawn 2x6x8', category: 'lumber', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 12.20, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'l21', name: 'I-Joist 9.5" x 20ft TJI', category: 'lumber', unit: 'each', baseRetailPrice: 54.97, baseBulkPrice: 46.00, bulkMinQty: 20, supplier: 'Weyerhaeuser/BMC' },
  { id: 'l22', name: 'Rim Board 1-1/8" x 11-7/8" x 20ft', category: 'lumber', unit: 'each', baseRetailPrice: 42.97, baseBulkPrice: 36.00, bulkMinQty: 15, supplier: 'BMC Supply' },

  // ─── CONCRETE & MASONRY ─────────────────────────────────────────────
  { id: 'c1', name: 'Ready-Mix Concrete (3000 PSI)', category: 'concrete', unit: 'cu yd', baseRetailPrice: 155.00, baseBulkPrice: 132.00, bulkMinQty: 10, supplier: 'Local Ready-Mix' },
  { id: 'c2', name: 'Ready-Mix Concrete (4000 PSI)', category: 'concrete', unit: 'cu yd', baseRetailPrice: 175.00, baseBulkPrice: 148.00, bulkMinQty: 10, supplier: 'Local Ready-Mix' },
  { id: 'c3', name: 'Quikrete 80lb Bag', category: 'concrete', unit: 'bag', baseRetailPrice: 7.98, baseBulkPrice: 6.50, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'c4', name: 'Rebar #3 (3/8") x 20ft', category: 'concrete', unit: 'each', baseRetailPrice: 8.97, baseBulkPrice: 7.30, bulkMinQty: 50, supplier: 'Metal Depot' },
  { id: 'c5', name: 'Rebar #4 (1/2") x 20ft', category: 'concrete', unit: 'each', baseRetailPrice: 13.48, baseBulkPrice: 11.20, bulkMinQty: 50, supplier: 'Metal Depot' },
  { id: 'c6', name: 'Rebar #5 (5/8") x 20ft', category: 'concrete', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.80, bulkMinQty: 30, supplier: 'Metal Depot' },
  { id: 'c7', name: 'Wire Mesh 6x6 W2.9 (150 sq ft)', category: 'concrete', unit: 'roll', baseRetailPrice: 64.98, baseBulkPrice: 55.00, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'c8', name: 'Vapor Barrier 6-mil (500 sq ft)', category: 'concrete', unit: 'roll', baseRetailPrice: 42.00, baseBulkPrice: 36.00, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'c9', name: 'Concrete Form Tube 12"x4\'', category: 'concrete', unit: 'each', baseRetailPrice: 14.98, baseBulkPrice: 12.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'c10', name: 'Cinder Block 8x8x16"', category: 'concrete', unit: 'each', baseRetailPrice: 2.98, baseBulkPrice: 2.20, bulkMinQty: 100, supplier: 'Home Depot' },
  { id: 'c11', name: 'Standard Red Brick', category: 'concrete', unit: 'each', baseRetailPrice: 0.89, baseBulkPrice: 0.65, bulkMinQty: 500, supplier: 'Belden Brick' },
  { id: 'c12', name: 'Mortar Type S 60lb Bag', category: 'concrete', unit: 'bag', baseRetailPrice: 11.97, baseBulkPrice: 9.50, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'c13', name: 'Sand Screened (50lb bag)', category: 'concrete', unit: 'bag', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'c14', name: 'Crushed Gravel #57 (50lb bag)', category: 'concrete', unit: 'bag', baseRetailPrice: 5.47, baseBulkPrice: 4.20, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'c15', name: 'Hydraulic Cement 10lb', category: 'concrete', unit: 'bag', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'c16', name: 'Surface Bonding Cement 50lb', category: 'concrete', unit: 'bag', baseRetailPrice: 34.97, baseBulkPrice: 28.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'c17', name: 'Post Hole Concrete 50lb Fast-Set', category: 'concrete', unit: 'bag', baseRetailPrice: 6.97, baseBulkPrice: 5.60, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'c18', name: 'Stone Aggregate Pea Gravel (cu yd)', category: 'concrete', unit: 'cu yd', baseRetailPrice: 65.00, baseBulkPrice: 52.00, bulkMinQty: 5, supplier: 'Local Supplier' },

  // ─── ROOFING ────────────────────────────────────────────────────────
  { id: 'r1', name: 'Architectural Shingles (GAF Timberline HDZ)', category: 'roofing', unit: 'square', baseRetailPrice: 118.00, baseBulkPrice: 98.00, bulkMinQty: 10, supplier: 'ABC Supply' },
  { id: 'r2', name: '30-yr 3-Tab Shingles (Owens Corning)', category: 'roofing', unit: 'square', baseRetailPrice: 89.00, baseBulkPrice: 74.00, bulkMinQty: 10, supplier: 'ABC Supply' },
  { id: 'r3', name: 'Impact-Resistant Shingles Class 4', category: 'roofing', unit: 'square', baseRetailPrice: 145.00, baseBulkPrice: 122.00, bulkMinQty: 10, supplier: 'ABC Supply' },
  { id: 'r4', name: 'Metal Roofing Panel 26GA 12"x10\'', category: 'roofing', unit: 'each', baseRetailPrice: 24.98, baseBulkPrice: 20.50, bulkMinQty: 25, supplier: 'Metal Sales Mfg' },
  { id: 'r5', name: 'Standing Seam Metal Panel (sq)', category: 'roofing', unit: 'square', baseRetailPrice: 450.00, baseBulkPrice: 385.00, bulkMinQty: 5, supplier: 'Sheffield Metals' },
  { id: 'r6', name: 'Synthetic Roofing Felt 30lb (4 sq)', category: 'roofing', unit: 'roll', baseRetailPrice: 44.98, baseBulkPrice: 37.00, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'r7', name: 'Roofing Felt 15lb (4 sq)', category: 'roofing', unit: 'roll', baseRetailPrice: 22.98, baseBulkPrice: 18.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'r8', name: 'Ice & Water Shield (75 sq ft)', category: 'roofing', unit: 'roll', baseRetailPrice: 89.00, baseBulkPrice: 75.00, bulkMinQty: 5, supplier: 'ABC Supply' },
  { id: 'r9', name: 'Ridge Cap Shingles (20 lin ft)', category: 'roofing', unit: 'bundle', baseRetailPrice: 54.00, baseBulkPrice: 46.00, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'r10', name: "Drip Edge 10' Aluminum", category: 'roofing', unit: 'each', baseRetailPrice: 8.48, baseBulkPrice: 7.00, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'r11', name: "Step Flashing 5\"x7\" (25-pack)", category: 'roofing', unit: 'pack', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'r12', name: "Roll Flashing 10\" x 10ft Aluminum", category: 'roofing', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 12.00, bulkMinQty: 15, supplier: "Lowe's" },
  { id: 'r13', name: 'Roof Cement 1-gal', category: 'roofing', unit: 'gallon', baseRetailPrice: 12.97, baseBulkPrice: 10.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'r14', name: 'Ridge Vent 4ft (continuous)', category: 'roofing', unit: 'each', baseRetailPrice: 12.97, baseBulkPrice: 10.50, bulkMinQty: 20, supplier: "Lowe's" },
  { id: 'r15', name: 'Soffit Vented 12"x12ft', category: 'roofing', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 15, supplier: 'Home Depot' },
  { id: 'r16', name: 'Gutter 10ft K-Style Aluminum', category: 'roofing', unit: 'each', baseRetailPrice: 8.98, baseBulkPrice: 7.20, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'r17', name: 'Downspout 10ft Aluminum', category: 'roofing', unit: 'each', baseRetailPrice: 7.48, baseBulkPrice: 5.90, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'r18', name: 'Gutter Guard LeafFilter (per ft)', category: 'roofing', unit: 'lin ft', baseRetailPrice: 3.98, baseBulkPrice: 3.10, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'r19', name: 'Roofing Nails 1-3/4" Galv (1lb)', category: 'roofing', unit: 'lb', baseRetailPrice: 4.98, baseBulkPrice: 3.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'r20', name: 'Rubber Roof Sealant EPDM (gal)', category: 'roofing', unit: 'gallon', baseRetailPrice: 49.97, baseBulkPrice: 41.00, bulkMinQty: 5, supplier: 'ABC Supply' },

  // ─── INSULATION ──────────────────────────────────────────────────────
  { id: 'ins1', name: 'R-13 Kraft Batt 3.5" (40 sq ft)', category: 'insulation', unit: 'bag', baseRetailPrice: 19.97, baseBulkPrice: 16.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'ins2', name: 'R-19 Kraft Batt 6" (48 sq ft)', category: 'insulation', unit: 'bag', baseRetailPrice: 29.97, baseBulkPrice: 24.50, bulkMinQty: 15, supplier: 'Home Depot' },
  { id: 'ins3', name: 'R-21 HD Batt 5.5" (40 sq ft)', category: 'insulation', unit: 'bag', baseRetailPrice: 34.97, baseBulkPrice: 28.50, bulkMinQty: 15, supplier: "Lowe's" },
  { id: 'ins4', name: 'R-30 Batt 9.5" (40 sq ft)', category: 'insulation', unit: 'bag', baseRetailPrice: 38.97, baseBulkPrice: 32.00, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'ins5', name: 'R-38 Batt 12" (32 sq ft)', category: 'insulation', unit: 'bag', baseRetailPrice: 44.97, baseBulkPrice: 37.00, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'ins6', name: 'Rigid Foam Board R-10 2" 4x8', category: 'insulation', unit: 'sheet', baseRetailPrice: 24.97, baseBulkPrice: 20.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'ins7', name: 'Rigid Foam XPS 1" 4x8 R-5', category: 'insulation', unit: 'sheet', baseRetailPrice: 14.97, baseBulkPrice: 12.00, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'ins8', name: 'Rockwool Comfort Batt R-15 (40sf)', category: 'insulation', unit: 'bag', baseRetailPrice: 44.97, baseBulkPrice: 37.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'ins9', name: 'Blown-In Fiberglass (19.5 lb bag)', category: 'insulation', unit: 'bag', baseRetailPrice: 21.97, baseBulkPrice: 17.80, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'ins10', name: 'Spray Foam Can 12oz', category: 'insulation', unit: 'each', baseRetailPrice: 8.97, baseBulkPrice: 7.00, bulkMinQty: 24, supplier: 'Home Depot' },
  { id: 'ins11', name: 'Spray Foam 2-Part Kit 600 BF', category: 'insulation', unit: 'kit', baseRetailPrice: 299.00, baseBulkPrice: 255.00, bulkMinQty: 3, supplier: 'Fomo Products' },
  { id: 'ins12', name: 'Radiant Barrier Foil 1000 sq ft', category: 'insulation', unit: 'roll', baseRetailPrice: 89.97, baseBulkPrice: 74.00, bulkMinQty: 3, supplier: "Lowe's" },
  { id: 'ins13', name: 'Pipe Insulation 1/2" x 6ft', category: 'insulation', unit: 'each', baseRetailPrice: 2.97, baseBulkPrice: 2.20, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'ins14', name: 'Duct Wrap Insulation R-6 (75 sq ft)', category: 'insulation', unit: 'roll', baseRetailPrice: 34.97, baseBulkPrice: 28.50, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'ins15', name: 'Reflective Insulation Bubble 500 sqft', category: 'insulation', unit: 'roll', baseRetailPrice: 79.97, baseBulkPrice: 66.00, bulkMinQty: 3, supplier: 'Home Depot' },

  // ─── SIDING & EXTERIOR ───────────────────────────────────────────────
  { id: 'sid1', name: 'Vinyl Siding (100 sq ft square)', category: 'siding', unit: 'square', baseRetailPrice: 89.00, baseBulkPrice: 74.00, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'sid2', name: 'Fiber Cement Siding 7.25"x12ft', category: 'siding', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 12.20, bulkMinQty: 50, supplier: 'James Hardie/HD' },
  { id: 'sid3', name: 'LP SmartSide 8" Lap Siding 16ft', category: 'siding', unit: 'each', baseRetailPrice: 19.97, baseBulkPrice: 16.50, bulkMinQty: 40, supplier: "Lowe's" },
  { id: 'sid4', name: 'Cedar Bevel Siding 1x4 per lf', category: 'siding', unit: 'lin ft', baseRetailPrice: 3.97, baseBulkPrice: 3.10, bulkMinQty: 100, supplier: 'Home Depot' },
  { id: 'sid5', name: 'House Wrap Tyvek HomeWrap 9x100ft', category: 'siding', unit: 'roll', baseRetailPrice: 98.00, baseBulkPrice: 83.00, bulkMinQty: 3, supplier: 'Home Depot' },
  { id: 'sid6', name: 'Stucco Base Coat 80lb Bag', category: 'siding', unit: 'bag', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'sid7', name: 'Brick Veneer Panel (per sq ft)', category: 'siding', unit: 'sq ft', baseRetailPrice: 6.97, baseBulkPrice: 5.50, bulkMinQty: 100, supplier: 'Belden Brick' },
  { id: 'sid8', name: 'Stone Veneer Ledger Panel (sq ft)', category: 'siding', unit: 'sq ft', baseRetailPrice: 8.97, baseBulkPrice: 7.20, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'sid9', name: 'ZIP System Sheathing 4x8 7/16"', category: 'siding', unit: 'sheet', baseRetailPrice: 44.97, baseBulkPrice: 37.50, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'sid10', name: 'Exterior Caulk Siliconized (10oz)', category: 'siding', unit: 'tube', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 24, supplier: 'Home Depot' },
  { id: 'sid11', name: "J-Channel Vinyl Siding 12'6\"", category: 'siding', unit: 'each', baseRetailPrice: 3.97, baseBulkPrice: 3.10, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'sid12', name: 'Composite Siding Panel 4x8', category: 'siding', unit: 'sheet', baseRetailPrice: 49.97, baseBulkPrice: 41.50, bulkMinQty: 20, supplier: 'Home Depot' },

  // ─── WINDOWS & DOORS ─────────────────────────────────────────────────
  { id: 'wd1', name: 'Double-Hung Window 36"x60" Vinyl', category: 'windows', unit: 'each', baseRetailPrice: 289.00, baseBulkPrice: 245.00, bulkMinQty: 5, supplier: "Lowe's (JELD-WEN)" },
  { id: 'wd2', name: 'Single-Hung Window 24"x36" Vinyl', category: 'windows', unit: 'each', baseRetailPrice: 149.00, baseBulkPrice: 125.00, bulkMinQty: 5, supplier: "Lowe's (JELD-WEN)" },
  { id: 'wd3', name: 'Casement Window 24"x48" Vinyl', category: 'windows', unit: 'each', baseRetailPrice: 349.00, baseBulkPrice: 295.00, bulkMinQty: 5, supplier: 'Pella/HD' },
  { id: 'wd4', name: 'Sliding Patio Door 6ft Vinyl', category: 'windows', unit: 'each', baseRetailPrice: 697.00, baseBulkPrice: 595.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'wd5', name: 'French Patio Door 6ft Fiberglass', category: 'windows', unit: 'each', baseRetailPrice: 1249.00, baseBulkPrice: 1075.00, bulkMinQty: 2, supplier: 'Therma-Tru/HD' },
  { id: 'wd6', name: 'Entry Door 36"x80" Steel Prehung', category: 'windows', unit: 'each', baseRetailPrice: 399.00, baseBulkPrice: 339.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'wd7', name: 'Fiberglass Entry Door 36"x80"', category: 'windows', unit: 'each', baseRetailPrice: 649.00, baseBulkPrice: 550.00, bulkMinQty: 2, supplier: "Lowe's (Therma-Tru)" },
  { id: 'wd8', name: 'Interior Hollow Core Door 32"x80"', category: 'windows', unit: 'each', baseRetailPrice: 69.00, baseBulkPrice: 55.00, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'wd9', name: 'Interior Solid Core Door 32"x80"', category: 'windows', unit: 'each', baseRetailPrice: 149.00, baseBulkPrice: 125.00, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'wd10', name: 'Prehung Interior Door 36"x80"', category: 'windows', unit: 'each', baseRetailPrice: 229.00, baseBulkPrice: 195.00, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'wd11', name: 'Garage Door 16x7ft Steel 2-Panel', category: 'windows', unit: 'each', baseRetailPrice: 749.00, baseBulkPrice: 645.00, bulkMinQty: 2, supplier: 'Clopay/HD' },
  { id: 'wd12', name: 'Barn Door 36"x84" with Hardware', category: 'windows', unit: 'each', baseRetailPrice: 249.00, baseBulkPrice: 210.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'wd13', name: 'Door Knob Set (Interior)', category: 'windows', unit: 'each', baseRetailPrice: 29.98, baseBulkPrice: 23.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'wd14', name: 'Deadbolt Lock Keyed Entry', category: 'windows', unit: 'each', baseRetailPrice: 39.98, baseBulkPrice: 31.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'wd15', name: 'Window Screen 36"x60"', category: 'windows', unit: 'each', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── FLOORING ────────────────────────────────────────────────────────
  { id: 'f1', name: 'Hardwood Oak 3/4" Solid (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 5.49, baseBulkPrice: 4.20, bulkMinQty: 200, supplier: 'Floor & Decor' },
  { id: 'f2', name: 'Engineered Hardwood 5/8" (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 3.99, baseBulkPrice: 3.10, bulkMinQty: 200, supplier: 'Floor & Decor' },
  { id: 'f3', name: 'LVP Luxury Vinyl Plank (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 2.99, baseBulkPrice: 2.30, bulkMinQty: 300, supplier: 'Home Depot' },
  { id: 'f4', name: 'WPC Waterproof Vinyl Plank (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 3.79, baseBulkPrice: 2.95, bulkMinQty: 300, supplier: 'Floor & Decor' },
  { id: 'f5', name: 'Ceramic Tile 12x12" (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 1.98, baseBulkPrice: 1.45, bulkMinQty: 500, supplier: 'Floor & Decor' },
  { id: 'f6', name: 'Porcelain Tile 24x24" (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 4.49, baseBulkPrice: 3.50, bulkMinQty: 300, supplier: 'Tile Shop' },
  { id: 'f7', name: 'Subway Tile 3x6" Ceramic (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 2.49, baseBulkPrice: 1.90, bulkMinQty: 300, supplier: 'Floor & Decor' },
  { id: 'f8', name: 'Carpet Berber Loop (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 1.49, baseBulkPrice: 1.10, bulkMinQty: 500, supplier: 'Home Depot' },
  { id: 'f9', name: 'Carpet Plush Cut-Pile (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 2.49, baseBulkPrice: 1.85, bulkMinQty: 400, supplier: "Lowe's" },
  { id: 'f10', name: 'Laminate Flooring 8mm (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 1.29, baseBulkPrice: 0.99, bulkMinQty: 400, supplier: "Lowe's" },
  { id: 'f11', name: 'Bamboo Flooring Natural (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 3.49, baseBulkPrice: 2.75, bulkMinQty: 200, supplier: 'Floor & Decor' },
  { id: 'f12', name: 'Cork Flooring 12mm (sq ft)', category: 'flooring', unit: 'sq ft', baseRetailPrice: 4.99, baseBulkPrice: 3.95, bulkMinQty: 150, supplier: 'Floor & Decor' },
  { id: 'f13', name: 'Epoxy Floor Coating 2-Part Kit', category: 'flooring', unit: 'kit', baseRetailPrice: 149.00, baseBulkPrice: 124.00, bulkMinQty: 3, supplier: 'Home Depot' },
  { id: 'f14', name: 'Self-Leveling Compound 50lb', category: 'flooring', unit: 'bag', baseRetailPrice: 34.98, baseBulkPrice: 28.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'f15', name: 'Tile Mortar Modified 50lb Bag', category: 'flooring', unit: 'bag', baseRetailPrice: 19.98, baseBulkPrice: 16.00, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'f16', name: 'Grout Sanded 25lb Bag', category: 'flooring', unit: 'bag', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 15, supplier: 'Floor & Decor' },
  { id: 'f17', name: 'Grout Unsanded 10lb Bag', category: 'flooring', unit: 'bag', baseRetailPrice: 12.97, baseBulkPrice: 10.50, bulkMinQty: 20, supplier: 'Floor & Decor' },
  { id: 'f18', name: 'Underlayment 3mm Foam (100 sq ft)', category: 'flooring', unit: 'roll', baseRetailPrice: 24.98, baseBulkPrice: 19.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'f19', name: 'Carpet Pad 7/16" (sq yd)', category: 'flooring', unit: 'sq yd', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'f20', name: 'Tack Strip (100 lin ft pack)', category: 'flooring', unit: 'pack', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'f21', name: 'Tile Spacers 3/16" (100-pack)', category: 'flooring', unit: 'pack', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 20, supplier: 'Floor & Decor' },
  { id: 'f22', name: 'Schluter Tile Edge Strip 8ft', category: 'flooring', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 20, supplier: 'Floor & Decor' },

  // ─── PLUMBING ────────────────────────────────────────────────────────
  { id: 'p1', name: '1/2" Copper Pipe Type L (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 14.98, baseBulkPrice: 12.00, bulkMinQty: 25, supplier: 'Ferguson' },
  { id: 'p2', name: '3/4" Copper Pipe Type L (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 22.97, baseBulkPrice: 18.50, bulkMinQty: 20, supplier: 'Ferguson' },
  { id: 'p3', name: '3/4" PVC Schedule 40 (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 6.98, baseBulkPrice: 5.50, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'p4', name: '1.5" PVC DWV Pipe (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 9.97, baseBulkPrice: 7.80, bulkMinQty: 25, supplier: 'Home Depot' },
  { id: 'p5', name: '3" ABS Drain Pipe (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.50, bulkMinQty: 20, supplier: "Lowe's" },
  { id: 'p6', name: '4" PVC Sewer Pipe (10 ft)', category: 'plumbing', unit: 'each', baseRetailPrice: 22.97, baseBulkPrice: 18.80, bulkMinQty: 15, supplier: 'Ferguson' },
  { id: 'p7', name: '1/2" PEX-A Pipe (100 ft roll)', category: 'plumbing', unit: 'roll', baseRetailPrice: 48.00, baseBulkPrice: 39.00, bulkMinQty: 10, supplier: 'Ferguson' },
  { id: 'p8', name: '3/4" PEX-B Pipe (100 ft roll)', category: 'plumbing', unit: 'roll', baseRetailPrice: 72.00, baseBulkPrice: 59.00, bulkMinQty: 5, supplier: 'Ferguson' },
  { id: 'p9', name: 'Toilet Standard Elongated (ADA)', category: 'plumbing', unit: 'each', baseRetailPrice: 229.00, baseBulkPrice: 190.00, bulkMinQty: 3, supplier: 'Ferguson' },
  { id: 'p10', name: 'Bathroom Vanity Sink 30"', category: 'plumbing', unit: 'each', baseRetailPrice: 349.00, baseBulkPrice: 295.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'p11', name: 'Kitchen Sink Stainless 33"', category: 'plumbing', unit: 'each', baseRetailPrice: 199.00, baseBulkPrice: 165.00, bulkMinQty: 2, supplier: "Lowe's" },
  { id: 'p12', name: 'Sink Faucet Chrome Single-Handle', category: 'plumbing', unit: 'each', baseRetailPrice: 89.00, baseBulkPrice: 74.00, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'p13', name: 'Shower Valve Pressure Balance', category: 'plumbing', unit: 'each', baseRetailPrice: 149.00, baseBulkPrice: 124.00, bulkMinQty: 3, supplier: 'Ferguson' },
  { id: 'p14', name: 'Water Heater 50gal Electric', category: 'plumbing', unit: 'each', baseRetailPrice: 649.00, baseBulkPrice: 555.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'p15', name: 'Tankless Water Heater NG 199kBTU', category: 'plumbing', unit: 'each', baseRetailPrice: 899.00, baseBulkPrice: 769.00, bulkMinQty: 2, supplier: "Lowe's" },
  { id: 'p16', name: 'Sump Pump 1/3HP with Float', category: 'plumbing', unit: 'each', baseRetailPrice: 149.00, baseBulkPrice: 124.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'p17', name: 'SharkBite 1/2" Coupling Push-Fit', category: 'plumbing', unit: 'each', baseRetailPrice: 7.98, baseBulkPrice: 6.20, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'p18', name: 'Gate Valve 3/4" Brass', category: 'plumbing', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 15.20, bulkMinQty: 10, supplier: 'Ferguson' },
  { id: 'p19', name: 'P-Trap 1-1/2" PVC Adjustable', category: 'plumbing', unit: 'each', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 25, supplier: 'Home Depot' },
  { id: 'p20', name: 'Wax Ring Toilet with Bolts', category: 'plumbing', unit: 'each', baseRetailPrice: 8.97, baseBulkPrice: 6.80, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'p21', name: 'Washing Machine Valve Dual 3/4"', category: 'plumbing', unit: 'each', baseRetailPrice: 19.97, baseBulkPrice: 15.80, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'p22', name: 'PVC Cement & Primer Kit', category: 'plumbing', unit: 'kit', baseRetailPrice: 12.97, baseBulkPrice: 10.00, bulkMinQty: 20, supplier: 'Home Depot' },

  // ─── ELECTRICAL ──────────────────────────────────────────────────────
  { id: 'e1', name: '14/2 NM-B Wire (250 ft)', category: 'electrical', unit: 'roll', baseRetailPrice: 59.98, baseBulkPrice: 49.00, bulkMinQty: 10, supplier: 'Graybar' },
  { id: 'e2', name: '12/2 NM-B Wire (250 ft)', category: 'electrical', unit: 'roll', baseRetailPrice: 79.98, baseBulkPrice: 65.00, bulkMinQty: 10, supplier: 'Graybar' },
  { id: 'e3', name: '10/2 NM-B Wire (250 ft)', category: 'electrical', unit: 'roll', baseRetailPrice: 109.98, baseBulkPrice: 92.00, bulkMinQty: 5, supplier: 'Graybar' },
  { id: 'e4', name: '10/3 NM-B Wire (250 ft)', category: 'electrical', unit: 'roll', baseRetailPrice: 149.98, baseBulkPrice: 126.00, bulkMinQty: 5, supplier: 'Graybar' },
  { id: 'e5', name: '6/3 NM-B Wire (25 ft)', category: 'electrical', unit: 'roll', baseRetailPrice: 59.98, baseBulkPrice: 49.00, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'e6', name: '200A Main Breaker Panel 40-Space', category: 'electrical', unit: 'each', baseRetailPrice: 349.00, baseBulkPrice: 295.00, bulkMinQty: 2, supplier: 'Home Depot (Square D)' },
  { id: 'e7', name: '100A Main Breaker Panel 24-Space', category: 'electrical', unit: 'each', baseRetailPrice: 169.00, baseBulkPrice: 142.00, bulkMinQty: 2, supplier: "Lowe's (Siemens)" },
  { id: 'e8', name: 'GFCI Outlet 15A Tamper-Resistant', category: 'electrical', unit: 'each', baseRetailPrice: 18.98, baseBulkPrice: 14.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'e9', name: 'Standard Outlet 15A Duplex', category: 'electrical', unit: 'each', baseRetailPrice: 2.97, baseBulkPrice: 2.10, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'e10', name: 'USB Outlet 15A with USB-A/C Ports', category: 'electrical', unit: 'each', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'e11', name: 'LED Recessed Light 6" Canless', category: 'electrical', unit: 'each', baseRetailPrice: 14.98, baseBulkPrice: 11.00, bulkMinQty: 25, supplier: 'Home Depot' },
  { id: 'e12', name: 'LED Recessed 4" Canless (3-pack)', category: 'electrical', unit: 'pack', baseRetailPrice: 39.97, baseBulkPrice: 32.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'e13', name: 'Single Pole Light Switch 15A', category: 'electrical', unit: 'each', baseRetailPrice: 2.97, baseBulkPrice: 2.10, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'e14', name: '3-Way Switch 15A', category: 'electrical', unit: 'each', baseRetailPrice: 5.97, baseBulkPrice: 4.50, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'e15', name: 'Single Pole 15A Breaker', category: 'electrical', unit: 'each', baseRetailPrice: 8.98, baseBulkPrice: 6.80, bulkMinQty: 20, supplier: 'Graybar (Square D)' },
  { id: 'e16', name: 'Double Pole 30A Breaker', category: 'electrical', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Graybar (Square D)' },
  { id: 'e17', name: 'Double Pole 50A Breaker (HVAC)', category: 'electrical', unit: 'each', baseRetailPrice: 18.97, baseBulkPrice: 14.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'e18', name: 'Outlet Box 2-Gang Plastic', category: 'electrical', unit: 'each', baseRetailPrice: 2.48, baseBulkPrice: 1.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'e19', name: 'Metal Electrical Box 4" Square', category: 'electrical', unit: 'each', baseRetailPrice: 2.97, baseBulkPrice: 2.20, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'e20', name: 'Wire Connectors Twist (100-pack)', category: 'electrical', unit: 'pack', baseRetailPrice: 7.97, baseBulkPrice: 6.00, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'e21', name: 'Conduit EMT 1/2" x 10ft', category: 'electrical', unit: 'each', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 50, supplier: 'Graybar' },
  { id: 'e22', name: 'Conduit EMT 3/4" x 10ft', category: 'electrical', unit: 'each', baseRetailPrice: 7.97, baseBulkPrice: 6.20, bulkMinQty: 30, supplier: 'Graybar' },
  { id: 'e23', name: 'Smart Dimmer Switch Wi-Fi', category: 'electrical', unit: 'each', baseRetailPrice: 39.97, baseBulkPrice: 32.50, bulkMinQty: 10, supplier: "Lowe's (Lutron)" },
  { id: 'e24', name: 'Smoke Detector Hardwired', category: 'electrical', unit: 'each', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'e25', name: 'CO/Smoke Combo Alarm Hardwired', category: 'electrical', unit: 'each', baseRetailPrice: 39.97, baseBulkPrice: 32.50, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── HVAC ────────────────────────────────────────────────────────────
  { id: 'hv1', name: 'Central AC Unit 3-Ton 16 SEER', category: 'hvac', unit: 'each', baseRetailPrice: 1249.00, baseBulkPrice: 1075.00, bulkMinQty: 2, supplier: 'Johnstone Supply' },
  { id: 'hv2', name: 'Heat Pump 3-Ton 16 SEER (Condenser)', category: 'hvac', unit: 'each', baseRetailPrice: 1549.00, baseBulkPrice: 1320.00, bulkMinQty: 2, supplier: 'Johnstone Supply' },
  { id: 'hv3', name: 'Gas Furnace 80% AFUE 80,000 BTU', category: 'hvac', unit: 'each', baseRetailPrice: 649.00, baseBulkPrice: 555.00, bulkMinQty: 2, supplier: "Lowe's" },
  { id: 'hv4', name: 'Gas Furnace 96% AFUE 100,000 BTU', category: 'hvac', unit: 'each', baseRetailPrice: 1149.00, baseBulkPrice: 975.00, bulkMinQty: 2, supplier: 'Johnstone Supply' },
  { id: 'hv5', name: 'Mini-Split 9,000 BTU 230V 18 SEER', category: 'hvac', unit: 'each', baseRetailPrice: 749.00, baseBulkPrice: 640.00, bulkMinQty: 2, supplier: "Lowe's (Pioneer)" },
  { id: 'hv6', name: 'Mini-Split 12,000 BTU 230V 20 SEER', category: 'hvac', unit: 'each', baseRetailPrice: 949.00, baseBulkPrice: 815.00, bulkMinQty: 2, supplier: "Lowe's" },
  { id: 'hv7', name: 'Air Handler AHU 3-Ton Electric', category: 'hvac', unit: 'each', baseRetailPrice: 599.00, baseBulkPrice: 510.00, bulkMinQty: 2, supplier: 'Johnstone Supply' },
  { id: 'hv8', name: 'Flex Duct 6" x 25ft R-6', category: 'hvac', unit: 'each', baseRetailPrice: 29.97, baseBulkPrice: 24.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hv9', name: 'Duct Board 4x10ft R-6', category: 'hvac', unit: 'each', baseRetailPrice: 24.97, baseBulkPrice: 20.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'hv10', name: 'Supply Register 6"x10" Steel', category: 'hvac', unit: 'each', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 25, supplier: 'Home Depot' },
  { id: 'hv11', name: 'Return Air Grille 14"x14"', category: 'hvac', unit: 'each', baseRetailPrice: 8.97, baseBulkPrice: 7.00, bulkMinQty: 15, supplier: 'Home Depot' },
  { id: 'hv12', name: 'Thermostat Programmable 7-Day', category: 'hvac', unit: 'each', baseRetailPrice: 49.97, baseBulkPrice: 40.00, bulkMinQty: 5, supplier: 'Home Depot (Honeywell)' },
  { id: 'hv13', name: 'Smart Thermostat WiFi Learning', category: 'hvac', unit: 'each', baseRetailPrice: 129.97, baseBulkPrice: 109.00, bulkMinQty: 3, supplier: "Lowe's (ecobee)" },
  { id: 'hv14', name: 'Exhaust Fan 110 CFM', category: 'hvac', unit: 'each', baseRetailPrice: 49.97, baseBulkPrice: 40.50, bulkMinQty: 5, supplier: 'Home Depot (Broan)' },
  { id: 'hv15', name: 'Bath Fan/Light Combo 110CFM', category: 'hvac', unit: 'each', baseRetailPrice: 79.97, baseBulkPrice: 65.00, bulkMinQty: 5, supplier: "Lowe's (Broan)" },
  { id: 'hv16', name: 'Range Hood 30" Under Cabinet', category: 'hvac', unit: 'each', baseRetailPrice: 149.00, baseBulkPrice: 124.00, bulkMinQty: 2, supplier: 'Home Depot' },
  { id: 'hv17', name: 'Dryer Vent Kit 4" x 8ft', category: 'hvac', unit: 'kit', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── DRYWALL ────────────────────────────────────────────────────────
  { id: 'd1', name: '1/2" Drywall 4x8 Sheet', category: 'drywall', unit: 'sheet', baseRetailPrice: 13.98, baseBulkPrice: 10.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'd2', name: '1/2" Drywall 4x12 Sheet', category: 'drywall', unit: 'sheet', baseRetailPrice: 20.97, baseBulkPrice: 16.50, bulkMinQty: 40, supplier: 'USG/Home Depot' },
  { id: 'd3', name: '5/8" Fire-Rated Drywall 4x8 Type X', category: 'drywall', unit: 'sheet', baseRetailPrice: 16.98, baseBulkPrice: 13.50, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'd4', name: '1/2" Moisture-Resistant (Green Board)', category: 'drywall', unit: 'sheet', baseRetailPrice: 18.48, baseBulkPrice: 15.00, bulkMinQty: 40, supplier: 'Home Depot' },
  { id: 'd5', name: 'Cement Board 1/2" 3x5ft (HardieBacker)', category: 'drywall', unit: 'sheet', baseRetailPrice: 19.97, baseBulkPrice: 16.50, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'd6', name: 'Joint Compound All-Purpose 5gal', category: 'drywall', unit: 'bucket', baseRetailPrice: 18.98, baseBulkPrice: 15.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'd7', name: 'Lightweight Joint Compound 4.5qt', category: 'drywall', unit: 'each', baseRetailPrice: 12.97, baseBulkPrice: 10.20, bulkMinQty: 20, supplier: "Lowe's" },
  { id: 'd8', name: 'Drywall Tape Paper 500ft Roll', category: 'drywall', unit: 'roll', baseRetailPrice: 9.98, baseBulkPrice: 7.80, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'd9', name: 'Fiberglass Mesh Tape 2"x150ft', category: 'drywall', unit: 'roll', baseRetailPrice: 7.97, baseBulkPrice: 6.10, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'd10', name: 'Metal Corner Bead 10ft', category: 'drywall', unit: 'each', baseRetailPrice: 3.98, baseBulkPrice: 2.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'd11', name: 'L-Bead Vinyl 10ft', category: 'drywall', unit: 'each', baseRetailPrice: 3.47, baseBulkPrice: 2.60, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'd12', name: 'Drywall Screws 1-5/8" (5 lb box)', category: 'drywall', unit: 'box', baseRetailPrice: 8.97, baseBulkPrice: 7.00, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── PAINT & FINISHES ────────────────────────────────────────────────
  { id: 'pa1', name: 'Interior Latex Paint Eggshell (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 36.98, baseBulkPrice: 28.00, bulkMinQty: 10, supplier: 'Sherwin-Williams' },
  { id: 'pa2', name: 'Interior Latex Paint Semi-Gloss (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 42.98, baseBulkPrice: 34.00, bulkMinQty: 10, supplier: 'Sherwin-Williams' },
  { id: 'pa3', name: 'Exterior Paint Duration (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 54.98, baseBulkPrice: 44.00, bulkMinQty: 10, supplier: 'Sherwin-Williams' },
  { id: 'pa4', name: 'Exterior Paint SuperPaint (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 46.98, baseBulkPrice: 37.50, bulkMinQty: 10, supplier: 'Sherwin-Williams' },
  { id: 'pa5', name: 'Primer Sealer Interior (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 29.98, baseBulkPrice: 23.00, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'pa6', name: 'Primer Drywall PVA (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'pa7', name: 'Primer Stain-Block (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 34.97, baseBulkPrice: 27.50, bulkMinQty: 5, supplier: "Lowe's (KILZ)" },
  { id: 'pa8', name: 'Cabinet & Trim Enamel (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 59.97, baseBulkPrice: 49.50, bulkMinQty: 5, supplier: 'Benjamin Moore' },
  { id: 'pa9', name: 'Deck Stain Semi-Transparent (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 34.97, baseBulkPrice: 27.50, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'pa10', name: 'Concrete Paint/Sealant (gal)', category: 'paint', unit: 'gallon', baseRetailPrice: 29.97, baseBulkPrice: 23.50, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'pa11', name: '9" Roller Cover 3/8" nap (3-pack)', category: 'paint', unit: 'pack', baseRetailPrice: 9.97, baseBulkPrice: 7.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'pa12', name: '9" Roller Frame & Cover Kit', category: 'paint', unit: 'kit', baseRetailPrice: 12.98, baseBulkPrice: 9.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'pa13', name: 'Paint Brush 3" Angled Sash', category: 'paint', unit: 'each', baseRetailPrice: 8.98, baseBulkPrice: 6.50, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'pa14', name: "Painter's Tape 1.5\" Blue (60 yd)", category: 'paint', unit: 'roll', baseRetailPrice: 7.98, baseBulkPrice: 5.80, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'pa15', name: 'Paint Tray with Liners 9" (5-pack)', category: 'paint', unit: 'pack', baseRetailPrice: 9.97, baseBulkPrice: 7.50, bulkMinQty: 10, supplier: "Lowe's" },

  // ─── DECKING ─────────────────────────────────────────────────────────
  { id: 'dk1', name: 'Composite Deck Board 1x6x16 Trex', category: 'decking', unit: 'each', baseRetailPrice: 34.97, baseBulkPrice: 29.00, bulkMinQty: 30, supplier: "Lowe's (Trex)" },
  { id: 'dk2', name: 'Composite Deck Board 5/4x6x16 Fiberon', category: 'decking', unit: 'each', baseRetailPrice: 26.97, baseBulkPrice: 22.50, bulkMinQty: 30, supplier: "Lowe's" },
  { id: 'dk3', name: 'PT Deck Board 5/4x6x16', category: 'decking', unit: 'each', baseRetailPrice: 17.97, baseBulkPrice: 14.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'dk4', name: 'Cedar Deck Board 5/4x6x16', category: 'decking', unit: 'each', baseRetailPrice: 22.97, baseBulkPrice: 19.00, bulkMinQty: 30, supplier: "Lowe's" },
  { id: 'dk5', name: 'Deck Joist 2x8x12 Pressure Treated', category: 'decking', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 12.20, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'dk6', name: 'Deck Post 4x4x8 Pressure Treated', category: 'decking', unit: 'each', baseRetailPrice: 12.48, baseBulkPrice: 10.20, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'dk7', name: 'Deck Railing Post 4x4x42" Vinyl', category: 'decking', unit: 'each', baseRetailPrice: 24.97, baseBulkPrice: 20.50, bulkMinQty: 10, supplier: "Lowe's" },
  { id: 'dk8', name: 'Balusters Aluminum 32" (10-pack)', category: 'decking', unit: 'pack', baseRetailPrice: 34.97, baseBulkPrice: 28.50, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'dk9', name: 'Deck Post Anchor Base 4x4', category: 'decking', unit: 'each', baseRetailPrice: 14.97, baseBulkPrice: 12.00, bulkMinQty: 15, supplier: 'Home Depot' },
  { id: 'dk10', name: 'Deck Stain Semi-Solid (gal)', category: 'decking', unit: 'gallon', baseRetailPrice: 34.97, baseBulkPrice: 27.50, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'dk11', name: 'Deck Screw 3" Composite (350ct)', category: 'decking', unit: 'box', baseRetailPrice: 19.97, baseBulkPrice: 16.00, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── FENCING ─────────────────────────────────────────────────────────
  { id: 'fn1', name: 'Wood Privacy Fence Panel 6x8ft', category: 'fencing', unit: 'each', baseRetailPrice: 37.97, baseBulkPrice: 31.00, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'fn2', name: 'Cedar Fence Picket 1x6x6ft', category: 'fencing', unit: 'each', baseRetailPrice: 3.97, baseBulkPrice: 3.10, bulkMinQty: 100, supplier: "Lowe's" },
  { id: 'fn3', name: 'Vinyl Privacy Panel 6x8ft White', category: 'fencing', unit: 'each', baseRetailPrice: 59.97, baseBulkPrice: 49.50, bulkMinQty: 15, supplier: "Lowe's" },
  { id: 'fn4', name: 'Aluminum Fence Panel 4x6ft', category: 'fencing', unit: 'each', baseRetailPrice: 54.97, baseBulkPrice: 45.50, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'fn5', name: 'Chain Link Fence 4ft Galv (per ft)', category: 'fencing', unit: 'lin ft', baseRetailPrice: 3.97, baseBulkPrice: 3.10, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'fn6', name: 'Fence Post 4x4x8 Pressure Treated', category: 'fencing', unit: 'each', baseRetailPrice: 12.48, baseBulkPrice: 10.20, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'fn7', name: 'Fence Post 6x6x10 Pressure Treated', category: 'fencing', unit: 'each', baseRetailPrice: 32.97, baseBulkPrice: 27.50, bulkMinQty: 15, supplier: "Lowe's" },
  { id: 'fn8', name: 'Post Cap Aluminum 4x4', category: 'fencing', unit: 'each', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 20, supplier: 'Home Depot' },
  { id: 'fn9', name: 'Wood Gate 4ft Wide Single', category: 'fencing', unit: 'each', baseRetailPrice: 89.97, baseBulkPrice: 74.50, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'fn10', name: 'Fence Gate Hardware Kit', category: 'fencing', unit: 'kit', baseRetailPrice: 24.97, baseBulkPrice: 19.50, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── STEEL & METAL ───────────────────────────────────────────────────
  { id: 'st1', name: 'Steel Stud 3-5/8" x 10ft 25GA', category: 'steel', unit: 'each', baseRetailPrice: 7.97, baseBulkPrice: 6.20, bulkMinQty: 50, supplier: 'Graybar / ClarkDietrich' },
  { id: 'st2', name: 'Steel Track 3-5/8" x 10ft 25GA', category: 'steel', unit: 'each', baseRetailPrice: 5.97, baseBulkPrice: 4.60, bulkMinQty: 50, supplier: 'ClarkDietrich' },
  { id: 'st3', name: 'Metal Angle 1-1/2" x 10ft Galv', category: 'steel', unit: 'each', baseRetailPrice: 9.97, baseBulkPrice: 7.80, bulkMinQty: 30, supplier: 'Home Depot' },
  { id: 'st4', name: 'Corrugated Metal Panel 26GA 12"x3ft', category: 'steel', unit: 'each', baseRetailPrice: 19.97, baseBulkPrice: 16.20, bulkMinQty: 20, supplier: 'Metal Sales Mfg' },
  { id: 'st5', name: 'Steel Beam W6x12 (per LF)', category: 'steel', unit: 'lin ft', baseRetailPrice: 12.97, baseBulkPrice: 10.50, bulkMinQty: 20, supplier: 'Metal Depot' },
  { id: 'st6', name: 'Rebar Tie Wire 16GA (3.5 lb roll)', category: 'steel', unit: 'roll', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'st7', name: 'Galvanized Flashing Roll 14"x50ft', category: 'steel', unit: 'roll', baseRetailPrice: 34.97, baseBulkPrice: 28.50, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'st8', name: 'Expanded Metal Lath 27"x96" Sheet', category: 'steel', unit: 'each', baseRetailPrice: 9.97, baseBulkPrice: 7.80, bulkMinQty: 25, supplier: "Lowe's" },

  // ─── FASTENERS & HARDWARE ────────────────────────────────────────────
  { id: 'hw1', name: 'Framing Nails 16d 3.5" (5 lb box)', category: 'hardware', unit: 'box', baseRetailPrice: 18.97, baseBulkPrice: 14.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hw2', name: 'Framing Nails 8d 2.5" (5 lb box)', category: 'hardware', unit: 'box', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hw3', name: 'Deck Screws 3" Exterior (5 lb)', category: 'hardware', unit: 'box', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hw4', name: 'Roofing Nails Galv 1-3/4" (1 lb)', category: 'hardware', unit: 'lb', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'hw5', name: 'Structural Screw 3" Hex (50ct)', category: 'hardware', unit: 'box', baseRetailPrice: 12.97, baseBulkPrice: 10.20, bulkMinQty: 20, supplier: 'Home Depot (GRK)' },
  { id: 'hw6', name: 'Joist Hanger LUS26 (50ct)', category: 'hardware', unit: 'box', baseRetailPrice: 44.97, baseBulkPrice: 36.50, bulkMinQty: 5, supplier: 'Simpson Strong-Tie' },
  { id: 'hw7', name: 'Post Base Standoff 4x4 ABU44', category: 'hardware', unit: 'each', baseRetailPrice: 11.97, baseBulkPrice: 9.50, bulkMinQty: 15, supplier: 'Simpson Strong-Tie' },
  { id: 'hw8', name: 'Hurricane Tie H2.5A (50ct)', category: 'hardware', unit: 'box', baseRetailPrice: 39.97, baseBulkPrice: 32.50, bulkMinQty: 5, supplier: 'Simpson Strong-Tie' },
  { id: 'hw9', name: 'Lag Bolt 3/8"x3" (50ct)', category: 'hardware', unit: 'box', baseRetailPrice: 18.97, baseBulkPrice: 14.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hw10', name: 'Anchor Bolt 1/2"x8" (25ct)', category: 'hardware', unit: 'box', baseRetailPrice: 14.97, baseBulkPrice: 11.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'hw11', name: 'Nail Plate 3x5" (50ct)', category: 'hardware', unit: 'box', baseRetailPrice: 18.97, baseBulkPrice: 14.80, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'hw12', name: 'Construction Adhesive PL400 (10oz)', category: 'hardware', unit: 'tube', baseRetailPrice: 8.97, baseBulkPrice: 6.80, bulkMinQty: 24, supplier: 'Home Depot' },
  { id: 'hw13', name: 'Liquid Nails Heavy Duty (10oz)', category: 'hardware', unit: 'tube', baseRetailPrice: 4.97, baseBulkPrice: 3.70, bulkMinQty: 24, supplier: 'Home Depot' },
  { id: 'hw14', name: 'Self-Adhering Flashing 4"x50ft', category: 'hardware', unit: 'roll', baseRetailPrice: 24.97, baseBulkPrice: 19.80, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'hw15', name: 'Silicone Sealant Clear (10oz)', category: 'hardware', unit: 'tube', baseRetailPrice: 4.97, baseBulkPrice: 3.80, bulkMinQty: 24, supplier: 'Home Depot' },
  { id: 'hw16', name: 'Masonry Screw 3/16"x2-3/4" (100ct)', category: 'hardware', unit: 'box', baseRetailPrice: 12.97, baseBulkPrice: 10.20, bulkMinQty: 10, supplier: 'Home Depot' },

  // ─── LANDSCAPE ───────────────────────────────────────────────────────
  { id: 'la1', name: 'Topsoil Premium (cu yd)', category: 'landscape', unit: 'cu yd', baseRetailPrice: 45.00, baseBulkPrice: 35.00, bulkMinQty: 10, supplier: 'Local Supplier' },
  { id: 'la2', name: 'Mulch Hardwood (2 cu ft bag)', category: 'landscape', unit: 'bag', baseRetailPrice: 4.98, baseBulkPrice: 3.50, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'la3', name: 'Rubber Mulch Black (1.5 cu ft)', category: 'landscape', unit: 'bag', baseRetailPrice: 9.97, baseBulkPrice: 7.80, bulkMinQty: 30, supplier: "Lowe's" },
  { id: 'la4', name: 'Pea Gravel (50 lb bag)', category: 'landscape', unit: 'bag', baseRetailPrice: 6.48, baseBulkPrice: 4.80, bulkMinQty: 50, supplier: 'Home Depot' },
  { id: 'la5', name: 'River Rock Decorative (0.5 cu ft)', category: 'landscape', unit: 'bag', baseRetailPrice: 4.97, baseBulkPrice: 3.70, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'la6', name: 'Sod (per sq ft)', category: 'landscape', unit: 'sq ft', baseRetailPrice: 0.65, baseBulkPrice: 0.45, bulkMinQty: 500, supplier: 'Local Sod Farm' },
  { id: 'la7', name: 'Concrete Paver 12x12" Gray', category: 'landscape', unit: 'each', baseRetailPrice: 3.98, baseBulkPrice: 2.80, bulkMinQty: 100, supplier: 'Home Depot' },
  { id: 'la8', name: 'Patio Block 16x16" Smooth', category: 'landscape', unit: 'each', baseRetailPrice: 6.97, baseBulkPrice: 5.50, bulkMinQty: 50, supplier: "Lowe's" },
  { id: 'la9', name: 'Retaining Wall Block 8x4x4"', category: 'landscape', unit: 'each', baseRetailPrice: 3.47, baseBulkPrice: 2.60, bulkMinQty: 100, supplier: 'Home Depot' },
  { id: 'la10', name: 'Landscape Fabric 3x100ft Woven', category: 'landscape', unit: 'roll', baseRetailPrice: 24.98, baseBulkPrice: 19.00, bulkMinQty: 5, supplier: 'Home Depot' },
  { id: 'la11', name: 'Drip Irrigation Kit (50ft)', category: 'landscape', unit: 'kit', baseRetailPrice: 34.97, baseBulkPrice: 27.50, bulkMinQty: 5, supplier: "Lowe's" },
  { id: 'la12', name: 'Edging Steel 4"x20ft', category: 'landscape', unit: 'each', baseRetailPrice: 19.97, baseBulkPrice: 15.80, bulkMinQty: 10, supplier: 'Home Depot' },
  { id: 'la13', name: 'Flagstone Natural (per sq ft)', category: 'landscape', unit: 'sq ft', baseRetailPrice: 3.97, baseBulkPrice: 3.00, bulkMinQty: 100, supplier: 'Local Stone Yard' },
  { id: 'la14', name: 'Compost/Soil Amendment (1 cu ft)', category: 'landscape', unit: 'bag', baseRetailPrice: 6.97, baseBulkPrice: 5.30, bulkMinQty: 30, supplier: 'Home Depot' },
];

export const CATEGORY_COST_FACTORS: Record<string, { laborFactor: number; equipmentFactor: number; installTrade: string; installHoursPerUnit: number }> = {
  lumber:     { laborFactor: 0.20, equipmentFactor: 0.02, installTrade: 'Carpenter', installHoursPerUnit: 0.04 },
  concrete:   { laborFactor: 0.40, equipmentFactor: 0.15, installTrade: 'Concrete Finisher', installHoursPerUnit: 0.08 },
  roofing:    { laborFactor: 0.50, equipmentFactor: 0.05, installTrade: 'Roofer', installHoursPerUnit: 0.06 },
  insulation: { laborFactor: 0.25, equipmentFactor: 0.02, installTrade: 'Insulation Worker', installHoursPerUnit: 0.015 },
  siding:     { laborFactor: 0.35, equipmentFactor: 0.04, installTrade: 'Carpenter', installHoursPerUnit: 0.05 },
  windows:    { laborFactor: 0.30, equipmentFactor: 0.03, installTrade: 'Carpenter', installHoursPerUnit: 0.10 },
  flooring:   { laborFactor: 0.40, equipmentFactor: 0.02, installTrade: 'Flooring Installer', installHoursPerUnit: 0.06 },
  plumbing:   { laborFactor: 0.55, equipmentFactor: 0.05, installTrade: 'Plumber', installHoursPerUnit: 0.12 },
  electrical: { laborFactor: 0.60, equipmentFactor: 0.03, installTrade: 'Electrician', installHoursPerUnit: 0.10 },
  hvac:       { laborFactor: 0.50, equipmentFactor: 0.08, installTrade: 'HVAC Technician', installHoursPerUnit: 0.15 },
  drywall:    { laborFactor: 0.45, equipmentFactor: 0.03, installTrade: 'Drywall Installer', installHoursPerUnit: 0.08 },
  paint:      { laborFactor: 0.65, equipmentFactor: 0.05, installTrade: 'Painter', installHoursPerUnit: 0.02 },
  decking:    { laborFactor: 0.30, equipmentFactor: 0.03, installTrade: 'Carpenter', installHoursPerUnit: 0.05 },
  fencing:    { laborFactor: 0.35, equipmentFactor: 0.04, installTrade: 'Carpenter', installHoursPerUnit: 0.05 },
  steel:      { laborFactor: 0.45, equipmentFactor: 0.10, installTrade: 'Ironworker / Structural', installHoursPerUnit: 0.08 },
  hardware:   { laborFactor: 0.15, equipmentFactor: 0.01, installTrade: 'Carpenter', installHoursPerUnit: 0.02 },
  landscape:  { laborFactor: 0.40, equipmentFactor: 0.08, installTrade: 'Landscaper', installHoursPerUnit: 0.04 },
};

export function getMaterialCostBreakdown(material: MaterialItem): { laborCost: number; equipmentCost: number; materialCost: number } {
  const factors = CATEGORY_COST_FACTORS[material.category];
  if (!factors) return { laborCost: 0, equipmentCost: 0, materialCost: material.baseRetailPrice };
  const laborCost = material.laborCostPerUnit ?? (material.baseRetailPrice * factors.laborFactor);
  const equipmentCost = material.equipmentCostPerUnit ?? (material.baseRetailPrice * factors.equipmentFactor);
  return { laborCost: Number(laborCost.toFixed(2)), equipmentCost: Number(equipmentCost.toFixed(2)), materialCost: material.baseRetailPrice };
}

export const CATEGORY_META: Record<string, { color: string; emoji: string; label: string }> = {
  lumber:     { color: '#92400E', emoji: '🪵', label: 'Lumber & Framing' },
  concrete:   { color: '#6B7280', emoji: '🧱', label: 'Concrete & Masonry' },
  roofing:    { color: '#1A6B3C', emoji: '🏠', label: 'Roofing' },
  insulation: { color: '#0891B2', emoji: '🧊', label: 'Insulation' },
  siding:     { color: '#B45309', emoji: '🏗️', label: 'Siding & Exterior' },
  windows:    { color: '#6366F1', emoji: '🪟', label: 'Windows & Doors' },
  flooring:   { color: '#7C3AED', emoji: '🪟', label: 'Flooring' },
  plumbing:   { color: '#2563EB', emoji: '🔧', label: 'Plumbing' },
  electrical: { color: '#D97706', emoji: '⚡', label: 'Electrical' },
  hvac:       { color: '#0F766E', emoji: '❄️', label: 'HVAC' },
  drywall:    { color: '#BE185D', emoji: '🔲', label: 'Drywall' },
  paint:      { color: '#0F766E', emoji: '🎨', label: 'Paint & Finishes' },
  decking:    { color: '#78350F', emoji: '🌳', label: 'Decking' },
  fencing:    { color: '#4D7C0F', emoji: '🚧', label: 'Fencing' },
  steel:      { color: '#475569', emoji: '🔩', label: 'Steel & Metal' },
  hardware:   { color: '#374151', emoji: '🔨', label: 'Fasteners & Hardware' },
  landscape:  { color: '#15803D', emoji: '🌿', label: 'Landscape' },
};

export const PRICE_VOLATILITY: Record<string, number> = {
  lumber:     0.06,
  concrete:   0.03,
  roofing:    0.04,
  insulation: 0.03,
  siding:     0.03,
  windows:    0.02,
  flooring:   0.03,
  plumbing:   0.04,
  electrical: 0.05,
  hvac:       0.03,
  drywall:    0.04,
  paint:      0.02,
  decking:    0.05,
  fencing:    0.03,
  steel:      0.07,
  hardware:   0.03,
  landscape:  0.03,
};

export function applyPriceVariance(base: number, volatility: number, seed: number): number {
  const variation = (Math.sin(seed) * volatility);
  return parseFloat((base * (1 + variation)).toFixed(2));
}

export const REGIONAL_FACTORS = [
  { id: 'national', label: 'National Avg', multiplier: 1 },
  { id: 'northeast', label: 'Northeast', multiplier: 1.11 },
  { id: 'midatlantic', label: 'Mid-Atlantic', multiplier: 1.07 },
  { id: 'southeast', label: 'Southeast', multiplier: 0.96 },
  { id: 'florida', label: 'Florida', multiplier: 1.03 },
  { id: 'midwest', label: 'Midwest', multiplier: 0.94 },
  { id: 'texas', label: 'Texas', multiplier: 0.98 },
  { id: 'mountain', label: 'Mountain', multiplier: 1.02 },
  { id: 'southwest', label: 'Southwest', multiplier: 0.99 },
  { id: 'pacific', label: 'Pacific', multiplier: 1.14 },
  { id: 'northwest', label: 'Northwest', multiplier: 1.08 },
  { id: 'california', label: 'California', multiplier: 1.18 },
] as const;

const ASSEMBLY_FACTORS = [
  { id: 'open-shop', label: 'Open Shop', multiplier: 0.97 },
  { id: 'union', label: 'Union Crew', multiplier: 1.09 },
  { id: 'occupied', label: 'Occupied Remodel', multiplier: 1.12 },
] as const;

const PRICING_TIERS = [
  { id: 'stock', label: 'Stock', retailMultiplier: 0.98, bulkMultiplier: 0.97, wasteFactor: 0.04 },
  { id: 'contractor', label: 'Contractor', retailMultiplier: 1, bulkMultiplier: 1, wasteFactor: 0.06 },
  { id: 'premium', label: 'Premium', retailMultiplier: 1.08, bulkMultiplier: 1.06, wasteFactor: 0.08 },
] as const;

function formatMoney(value: number): number {
  return Number(value.toFixed(2));
}

function buildExpandedMaterials(): MaterialItem[] {
  const expanded: MaterialItem[] = [];

  for (const base of BASE_MATERIALS) {
    expanded.push({
      ...base,
      pricingModel: 'market',
      sourceLabel: 'Retail + wholesale market scan',
      region: 'National Avg',
      specTier: 'base',
      crew: 'Standard crew',
      wasteFactor: 0.05,
    });

    for (const region of REGIONAL_FACTORS) {
      for (const tier of PRICING_TIERS) {
        expanded.push({
          ...base,
          id: `${base.id}-${region.id}-${tier.id}`,
          name: `${base.name} · ${region.label} ${tier.label}`,
          supplier: `${base.supplier} · ${region.label}`,
          baseRetailPrice: formatMoney(base.baseRetailPrice * region.multiplier * tier.retailMultiplier),
          baseBulkPrice: formatMoney(base.baseBulkPrice * region.multiplier * tier.bulkMultiplier),
          pricingModel: 'regional_adjusted',
          sourceLabel: 'Regional city factor adjusted',
          region: region.label,
          specTier: 'regional',
          assemblyCode: `${base.category.toUpperCase()}-${base.id.toUpperCase()}-${region.id.toUpperCase()}`,
          crew: 'Standard crew',
          wasteFactor: tier.wasteFactor,
        });
      }

      for (const assembly of ASSEMBLY_FACTORS) {
        expanded.push({
          ...base,
          id: `${base.id}-${region.id}-${assembly.id}-assembly`,
          name: `${base.name} · ${region.label} ${assembly.label}`,
          supplier: `${base.supplier} · ${assembly.label}`,
          baseRetailPrice: formatMoney(base.baseRetailPrice * region.multiplier * assembly.multiplier),
          baseBulkPrice: formatMoney(base.baseBulkPrice * region.multiplier * (assembly.multiplier - 0.015)),
          pricingModel: 'regional_adjusted',
          sourceLabel: 'Regional assembly adjustment',
          region: region.label,
          specTier: 'assembly',
          assemblyCode: `${base.category.toUpperCase()}-${base.id.toUpperCase()}-${assembly.id.toUpperCase()}`,
          crew: assembly.label,
          wasteFactor: assembly.id === 'occupied' ? 0.1 : assembly.id === 'union' ? 0.07 : 0.05,
        });
      }
    }
  }

  return expanded;
}

export const EXPANDED_MATERIALS: MaterialItem[] = buildExpandedMaterials();

export const MATERIAL_CATALOG_STATS = {
  baseCount: BASE_MATERIALS.length,
  expandedCount: EXPANDED_MATERIALS.length,
  regionalAdjustedCount: EXPANDED_MATERIALS.filter(item => item.pricingModel === 'regional_adjusted').length,
  regionCount: REGIONAL_FACTORS.length,
};

export function getRegionMultiplier(location: string): number {
  const loc = location.toLowerCase().trim();
  const regionMap: Record<string, string> = {
    'california': 'california', 'ca': 'california', 'los angeles': 'california', 'san francisco': 'california', 'san diego': 'california', 'sacramento': 'california',
    'florida': 'florida', 'fl': 'florida', 'miami': 'florida', 'orlando': 'florida', 'tampa': 'florida', 'jacksonville': 'florida',
    'texas': 'texas', 'tx': 'texas', 'houston': 'texas', 'dallas': 'texas', 'austin': 'texas', 'san antonio': 'texas',
    'new york': 'northeast', 'ny': 'northeast', 'nyc': 'northeast', 'boston': 'northeast', 'ma': 'northeast', 'ct': 'northeast', 'connecticut': 'northeast', 'massachusetts': 'northeast',
    'new jersey': 'midatlantic', 'nj': 'midatlantic', 'pennsylvania': 'midatlantic', 'pa': 'midatlantic', 'philadelphia': 'midatlantic', 'maryland': 'midatlantic', 'md': 'midatlantic', 'dc': 'midatlantic', 'washington dc': 'midatlantic', 'virginia': 'midatlantic', 'va': 'midatlantic',
    'georgia': 'southeast', 'ga': 'southeast', 'atlanta': 'southeast', 'north carolina': 'southeast', 'nc': 'southeast', 'south carolina': 'southeast', 'sc': 'southeast', 'tennessee': 'southeast', 'tn': 'southeast', 'alabama': 'southeast', 'al': 'southeast',
    'illinois': 'midwest', 'il': 'midwest', 'chicago': 'midwest', 'ohio': 'midwest', 'oh': 'midwest', 'michigan': 'midwest', 'mi': 'midwest', 'indiana': 'midwest', 'in': 'midwest', 'wisconsin': 'midwest', 'wi': 'midwest', 'minnesota': 'midwest', 'mn': 'midwest',
    'colorado': 'mountain', 'co': 'mountain', 'denver': 'mountain', 'utah': 'mountain', 'ut': 'mountain', 'montana': 'mountain', 'mt': 'mountain', 'idaho': 'mountain', 'id': 'mountain', 'wyoming': 'mountain', 'wy': 'mountain',
    'arizona': 'southwest', 'az': 'southwest', 'phoenix': 'southwest', 'new mexico': 'southwest', 'nm': 'southwest', 'nevada': 'southwest', 'nv': 'southwest', 'las vegas': 'southwest',
    'oregon': 'northwest', 'or': 'northwest', 'portland': 'northwest', 'washington': 'northwest', 'wa': 'northwest', 'seattle': 'northwest',
  };

  for (const [key, regionId] of Object.entries(regionMap)) {
    if (loc.includes(key)) {
      const factor = REGIONAL_FACTORS.find(r => r.id === regionId);
      if (factor) {
        console.log('[Materials] Location "' + location + '" matched region:', factor.label, 'multiplier:', factor.multiplier);
        return factor.multiplier;
      }
    }
  }
  return 1;
}

export function getLivePrices(seed: number, locationMultiplier?: number): MaterialItem[] {
  const mult = locationMultiplier ?? 1;
  return EXPANDED_MATERIALS.map(m => {
    const vol = PRICE_VOLATILITY[m.category] ?? 0.03;
    const itemSeed = seed + m.id.charCodeAt(0) + m.id.charCodeAt(1);
    return {
      ...m,
      baseRetailPrice: applyPriceVariance(m.baseRetailPrice * mult, vol, itemSeed),
      baseBulkPrice: applyPriceVariance(m.baseBulkPrice * mult, vol * 0.8, itemSeed + 1),
    };
  });
}
