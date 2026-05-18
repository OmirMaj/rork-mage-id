import type { AssemblyItem, AssemblyMaterial, AssemblyLabor } from '@/constants/assemblies';

export interface AssemblyRow {
  id: string; name: string; category: string; description: string | null; unit: string;
  materials: AssemblyMaterial[]; labor: AssemblyLabor[]; notes: string | null;
  is_system: boolean; is_custom: boolean; user_id: string;
  created_at: string; updated_at: string;
}

export function assemblyItemToRow(a: AssemblyItem, userId: string): AssemblyRow {
  const now = new Date().toISOString();
  return {
    id: a.id, name: a.name, category: a.category,
    description: a.description || null, unit: a.unit,
    materials: a.materialsPerUnit, labor: a.laborPerUnit,
    notes: a.notes || null,
    is_system: false, is_custom: true, user_id: userId,
    created_at: now, updated_at: now,
  };
}

export function rowToAssemblyItem(row: AssemblyRow): AssemblyItem {
  return {
    id: row.id, name: row.name, category: row.category,
    description: row.description ?? '', unit: row.unit,
    materialsPerUnit: Array.isArray(row.materials) ? row.materials : [],
    laborPerUnit: Array.isArray(row.labor) ? row.labor : [],
    notes: row.notes ?? '',
  };
}
