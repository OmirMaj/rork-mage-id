export interface ProjectCategory {
  id: string;
  label: string;
  icon: string;
}

export const PROJECT_CATEGORIES: ProjectCategory[] = [
  { id: 'kitchen_remodel', label: 'Kitchen Remodel', icon: '🍳' },
  { id: 'bathroom_remodel', label: 'Bathroom Remodel', icon: '🚿' },
  { id: 'roof_repair', label: 'Roof Repair/Replace', icon: '🏠' },
  { id: 'painting_interior', label: 'Painting (Interior)', icon: '🎨' },
  { id: 'painting_exterior', label: 'Painting (Exterior)', icon: '🖌️' },
  { id: 'flooring', label: 'Flooring', icon: '🪵' },
  { id: 'plumbing', label: 'Plumbing', icon: '🔧' },
  { id: 'electrical', label: 'Electrical', icon: '⚡' },
  { id: 'hvac', label: 'HVAC', icon: '❄️' },
  { id: 'fencing', label: 'Fencing', icon: '🏗️' },
  { id: 'deck_patio', label: 'Deck/Patio', icon: '🪑' },
  { id: 'basement_finishing', label: 'Basement Finishing', icon: '🏚️' },
  { id: 'addition', label: 'Addition', icon: '➕' },
  { id: 'windows_doors', label: 'Windows/Doors', icon: '🪟' },
  { id: 'siding', label: 'Siding', icon: '🧱' },
  { id: 'landscaping', label: 'Landscaping', icon: '🌿' },
  { id: 'demolition', label: 'Demolition', icon: '💥' },
  { id: 'general_renovation', label: 'General Renovation', icon: '🔨' },
  { id: 'other', label: 'Other', icon: '📋' },
];

export const TIMELINE_OPTIONS = [
  { id: 'asap', label: 'ASAP' },
  { id: 'two_weeks', label: 'Within 2 weeks' },
  { id: 'one_month', label: 'Within 1 month' },
  { id: 'three_months', label: 'Within 3 months' },
  { id: 'flexible', label: 'Flexible / Just planning' },
] as const;

export const PROPERTY_TYPES = [
  { id: 'house', label: 'House' },
  { id: 'apartment', label: 'Apartment' },
  { id: 'condo', label: 'Condo' },
  { id: 'townhouse', label: 'Townhouse' },
  { id: 'commercial', label: 'Commercial' },
] as const;

export const CONTACT_PREFERENCES = [
  { id: 'in_app', label: 'In-app messaging only (private)' },
  { id: 'show_email', label: 'Show my email to responders' },
  { id: 'show_phone', label: 'Show my phone to responders' },
] as const;

export const POSTING_LIMITS = {
  free: { requests: 2, responses: 5 },
  pro: { requests: 5, responses: 20 },
  business: { requests: 10, responses: 999 },
} as const;

export function getCategoryLabel(id: string): string {
  return PROJECT_CATEGORIES.find(c => c.id === id)?.label ?? id;
}

export function getCategoryIcon(id: string): string {
  return PROJECT_CATEGORIES.find(c => c.id === id)?.icon ?? '📋';
}
