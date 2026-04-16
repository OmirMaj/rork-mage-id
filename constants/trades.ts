import type { TradeCategory } from '@/types';

export const TRADE_CATEGORIES: { id: TradeCategory; label: string }[] = [
  { id: 'general_laborer', label: 'General Laborer' },
  { id: 'carpenter', label: 'Carpenter' },
  { id: 'electrician', label: 'Electrician' },
  { id: 'plumber', label: 'Plumber' },
  { id: 'hvac_tech', label: 'HVAC Technician' },
  { id: 'welder', label: 'Welder' },
  { id: 'iron_worker', label: 'Iron Worker' },
  { id: 'mason', label: 'Mason / Bricklayer' },
  { id: 'painter', label: 'Painter' },
  { id: 'roofer', label: 'Roofer' },
  { id: 'heavy_equipment_op', label: 'Heavy Equipment Operator' },
  { id: 'concrete_worker', label: 'Concrete Worker' },
  { id: 'demolition', label: 'Demolition' },
  { id: 'drywall', label: 'Drywall / Insulation' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'glazier', label: 'Glazier' },
  { id: 'sheet_metal', label: 'Sheet Metal Worker' },
  { id: 'pipefitter', label: 'Pipefitter' },
  { id: 'sprinkler_fitter', label: 'Sprinkler Fitter' },
  { id: 'fire_protection', label: 'Fire Protection' },
  { id: 'civil_engineer', label: 'Civil Engineer' },
  { id: 'structural_engineer', label: 'Structural Engineer' },
  { id: 'mechanical_engineer', label: 'Mechanical Engineer' },
  { id: 'electrical_engineer', label: 'Electrical Engineer' },
  { id: 'project_manager', label: 'Project Manager' },
  { id: 'site_superintendent', label: 'Site Superintendent' },
  { id: 'safety_manager', label: 'Safety Manager' },
  { id: 'estimator', label: 'Estimator' },
  { id: 'surveyor', label: 'Surveyor' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'architect', label: 'Architect' },
];

export function getTradeLabel(id: TradeCategory): string {
  return TRADE_CATEGORIES.find(t => t.id === id)?.label ?? id;
}
