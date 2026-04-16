import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomTemplate } from '@/types';
import { generateUUID } from '@/utils/generateId';

const TEMPLATES_KEY = 'mage_custom_templates';

export async function getTemplates(): Promise<CustomTemplate[]> {
  try {
    const stored = await AsyncStorage.getItem(TEMPLATES_KEY);
    if (stored) return JSON.parse(stored) as CustomTemplate[];
    return [];
  } catch (err) {
    console.log('[TemplateManager] Failed to load templates:', err);
    return [];
  }
}

export async function saveTemplate(template: CustomTemplate): Promise<void> {
  try {
    const templates = await getTemplates();
    const idx = templates.findIndex(t => t.id === template.id);
    if (idx >= 0) {
      templates[idx] = template;
    } else {
      templates.push(template);
    }
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    console.log('[TemplateManager] Template saved:', template.name);
  } catch (err) {
    console.log('[TemplateManager] Failed to save template:', err);
  }
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    const templates = await getTemplates();
    const filtered = templates.filter(t => t.id !== id);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(filtered));
    console.log('[TemplateManager] Template deleted:', id);
  } catch (err) {
    console.log('[TemplateManager] Failed to delete template:', err);
  }
}

export function createTemplate(
  name: string,
  type: CustomTemplate['type'],
  mode: CustomTemplate['mode'],
  fileUri?: string,
  htmlContent?: string,
): CustomTemplate {
  return {
    id: generateUUID(),
    name,
    type,
    mode,
    fileUri,
    htmlContent,
    createdAt: new Date().toISOString(),
  };
}

export function applyPlaceholders(html: string, data: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

export const PROPOSAL_PLACEHOLDERS = [
  'company_name', 'company_address', 'company_phone', 'company_email',
  'company_logo', 'license_number',
  'project_name', 'project_location', 'project_type', 'project_description',
  'estimate_total', 'material_cost', 'labor_cost', 'equipment_cost',
  'tax_amount', 'contingency_amount', 'grand_total',
  'line_items_table', 'cost_summary_table',
  'date_generated', 'valid_until',
  'client_name', 'client_address',
];

export const SCHEDULE_PLACEHOLDERS = [
  'project_name', 'schedule_start', 'schedule_end', 'total_duration',
  'task_table', 'gantt_chart', 'summary_stats',
  'health_score', 'risk_items', 'milestone_list',
  'company_name', 'date_generated',
];

export const BUILT_IN_TEMPLATES: CustomTemplate[] = [
  {
    id: 'builtin-proposal-modern',
    name: 'Modern Blue',
    type: 'proposal',
    mode: 'dynamic',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-schedule-professional',
    name: 'Professional',
    type: 'schedule',
    mode: 'dynamic',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-schedule-compact',
    name: 'Compact — Gantt Only',
    type: 'schedule',
    mode: 'dynamic',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];
