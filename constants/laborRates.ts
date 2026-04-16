export interface LaborRate {
  id: string;
  trade: string;
  category: string;
  hourlyRate: number;
  rateRange: { low: number; high: number };
  unit: string;
  dailyOutput: string;
  crew: string;
  wageType: 'open_shop' | 'union' | 'blended';
}

export const LABOR_RATES: LaborRate[] = [
  { id: 'lab-carpenter', trade: 'Carpenter', category: 'structural', hourlyRate: 28.50, rateRange: { low: 22, high: 38 }, unit: 'per hour', dailyOutput: '500 SF wall framing/day', crew: '1 Carpenter + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-electrician', trade: 'Electrician', category: 'electrical', hourlyRate: 32.00, rateRange: { low: 24, high: 45 }, unit: 'per hour', dailyOutput: '8-10 outlets/day', crew: '1 Electrician + 1 Apprentice', wageType: 'open_shop' },
  { id: 'lab-plumber', trade: 'Plumber', category: 'plumbing', hourlyRate: 30.50, rateRange: { low: 23, high: 42 }, unit: 'per hour', dailyOutput: '5 fixture rough-ins/day', crew: '1 Plumber + 1 Apprentice', wageType: 'open_shop' },
  { id: 'lab-hvac', trade: 'HVAC Technician', category: 'hvac', hourlyRate: 29.00, rateRange: { low: 22, high: 40 }, unit: 'per hour', dailyOutput: '1 mini-split install/day', crew: '1 HVAC Tech + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-painter', trade: 'Painter', category: 'finishing', hourlyRate: 22.00, rateRange: { low: 17, high: 30 }, unit: 'per hour', dailyOutput: '400 SF (2 coats)/day', crew: '1 Painter', wageType: 'open_shop' },
  { id: 'lab-roofer', trade: 'Roofer', category: 'roofing', hourlyRate: 25.00, rateRange: { low: 19, high: 34 }, unit: 'per hour', dailyOutput: '5 squares shingles/day', crew: '1 Roofer + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-mason', trade: 'Mason / Bricklayer', category: 'masonry', hourlyRate: 27.00, rateRange: { low: 21, high: 36 }, unit: 'per hour', dailyOutput: '400 bricks/day', crew: '1 Mason + 1 Tender', wageType: 'open_shop' },
  { id: 'lab-concrete', trade: 'Concrete Finisher', category: 'concrete', hourlyRate: 24.50, rateRange: { low: 19, high: 33 }, unit: 'per hour', dailyOutput: '500 SF slab/day', crew: '1 Finisher + 2 Laborers', wageType: 'open_shop' },
  { id: 'lab-drywall', trade: 'Drywall Installer', category: 'drywall', hourlyRate: 24.00, rateRange: { low: 18, high: 32 }, unit: 'per hour', dailyOutput: '1,200 SF hang/day', crew: '2 Drywall Installers + 1 Taper', wageType: 'open_shop' },
  { id: 'lab-flooring', trade: 'Flooring Installer', category: 'flooring', hourlyRate: 23.50, rateRange: { low: 18, high: 31 }, unit: 'per hour', dailyOutput: '200 SF hardwood/day', crew: '1 Installer + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-ironworker', trade: 'Ironworker / Structural', category: 'structural', hourlyRate: 33.00, rateRange: { low: 25, high: 46 }, unit: 'per hour', dailyOutput: '2 tons steel/day', crew: '2 Ironworkers + 1 Crane Op', wageType: 'union' },
  { id: 'lab-operator', trade: 'Equipment Operator', category: 'general', hourlyRate: 28.00, rateRange: { low: 21, high: 38 }, unit: 'per hour', dailyOutput: '200 CY excavation/day', crew: '1 Operator', wageType: 'blended' },
  { id: 'lab-laborer', trade: 'General Laborer', category: 'general', hourlyRate: 19.50, rateRange: { low: 15, high: 26 }, unit: 'per hour', dailyOutput: 'Various support tasks', crew: '1 Laborer', wageType: 'open_shop' },
  { id: 'lab-glazier', trade: 'Glazier', category: 'finishing', hourlyRate: 26.00, rateRange: { low: 20, high: 35 }, unit: 'per hour', dailyOutput: '8-10 windows/day', crew: '1 Glazier + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-insulation', trade: 'Insulation Worker', category: 'insulation', hourlyRate: 22.50, rateRange: { low: 17, high: 30 }, unit: 'per hour', dailyOutput: '1,500 SF batt/day', crew: '1 Insulation Installer', wageType: 'open_shop' },
  { id: 'lab-sheetmetal', trade: 'Sheet Metal Worker', category: 'hvac', hourlyRate: 29.50, rateRange: { low: 22, high: 40 }, unit: 'per hour', dailyOutput: '80 LF ductwork/day', crew: '1 Sheet Metal + 1 Helper', wageType: 'blended' },
  { id: 'lab-pipefitter', trade: 'Pipefitter', category: 'plumbing', hourlyRate: 31.00, rateRange: { low: 24, high: 42 }, unit: 'per hour', dailyOutput: '50 LF pipe/day', crew: '1 Pipefitter + 1 Helper', wageType: 'union' },
  { id: 'lab-welder', trade: 'Welder', category: 'structural', hourlyRate: 27.50, rateRange: { low: 21, high: 38 }, unit: 'per hour', dailyOutput: '20 LF structural weld/day', crew: '1 Welder', wageType: 'blended' },
  { id: 'lab-landscape', trade: 'Landscaper', category: 'landscape', hourlyRate: 18.50, rateRange: { low: 14, high: 25 }, unit: 'per hour', dailyOutput: '500 SF sod/day', crew: '1 Landscaper + 1 Helper', wageType: 'open_shop' },
  { id: 'lab-demolition', trade: 'Demolition Worker', category: 'general', hourlyRate: 21.00, rateRange: { low: 16, high: 28 }, unit: 'per hour', dailyOutput: '400 SF gut demo/day', crew: '2 Laborers', wageType: 'open_shop' },
];

export const LABOR_CATEGORIES = [
  { id: 'all', label: 'All Trades' },
  { id: 'structural', label: 'Structural' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'hvac', label: 'HVAC' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'general', label: 'General' },
  { id: 'roofing', label: 'Roofing' },
  { id: 'masonry', label: 'Masonry' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'drywall', label: 'Drywall' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'insulation', label: 'Insulation' },
  { id: 'landscape', label: 'Landscape' },
];
