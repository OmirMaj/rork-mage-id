import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AIMaterialResult } from './materialFinder';

const CUSTOM_MATERIALS_KEY = 'mage_custom_materials';
const RECENT_MATERIALS_KEY = 'mage_recent_materials';

export interface SavedMaterial {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: number;
  category: string;
  brand?: string;
  size?: string;
  specifications?: string;
  commonUses: string[];
  alternateNames: string[];
  priceSource: string;
  priceDate: string;
  laborHoursPerUnit?: number;
  laborCrew?: string;
  laborCrewSize?: number;
  isCustom: boolean;
  searchCount: number;
}

export interface RecentMaterial {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  timestamp: string;
  source: 'builtin' | 'ai' | 'custom';
}

export async function saveToLocalDatabase(material: SavedMaterial): Promise<boolean> {
  try {
    const existing = await getCustomMaterials();
    const isDuplicate = existing.some(
      m => m.name.toLowerCase().trim() === material.name.toLowerCase().trim(),
    );
    if (!isDuplicate) {
      existing.push({ ...material, id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, searchCount: 1 });
      await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(existing));
      console.log('[MaterialDB] Saved new material:', material.name);
    } else {
      const idx = existing.findIndex(m => m.name.toLowerCase().trim() === material.name.toLowerCase().trim());
      if (idx >= 0) {
        existing[idx].searchCount += 1;
        existing[idx].unitPrice = material.unitPrice;
        existing[idx].priceDate = material.priceDate;
        await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(existing));
      }
      console.log('[MaterialDB] Material already exists, updated count:', material.name);
    }
    return !isDuplicate;
  } catch (err) {
    console.error('[MaterialDB] Save error:', err);
    return false;
  }
}

export async function getCustomMaterials(): Promise<SavedMaterial[]> {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_MATERIALS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('[MaterialDB] Get custom materials error:', err);
    return [];
  }
}

export async function searchCustomMaterials(query: string): Promise<SavedMaterial[]> {
  const materials = await getCustomMaterials();
  const q = query.toLowerCase();
  return materials.filter(
    m =>
      m.name.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.alternateNames?.some(alt => alt.toLowerCase().includes(q)) ||
      m.category?.toLowerCase().includes(q),
  );
}

export async function getPopularCustomMaterials(limit: number = 20): Promise<SavedMaterial[]> {
  const materials = await getCustomMaterials();
  return materials
    .sort((a, b) => b.searchCount - a.searchCount)
    .slice(0, limit);
}

export function aiResultToSavedMaterial(result: AIMaterialResult): SavedMaterial {
  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: result.name,
    description: result.description,
    unit: result.unit,
    unitPrice: result.unitPrice,
    category: result.category.toLowerCase(),
    brand: result.brand,
    size: result.size,
    specifications: result.specifications,
    commonUses: result.commonUses,
    alternateNames: result.alternateNames,
    priceSource: result.priceSource,
    priceDate: new Date().toISOString(),
    laborHoursPerUnit: result.laborToInstall?.hoursPerUnit,
    laborCrew: result.laborToInstall?.crew,
    laborCrewSize: result.laborToInstall?.crewSize,
    isCustom: false,
    searchCount: 1,
  };
}

export async function addRecentMaterial(material: RecentMaterial): Promise<void> {
  try {
    const recents = await getRecentMaterials();
    const filtered = recents.filter(m => m.id !== material.id);
    filtered.unshift({ ...material, timestamp: new Date().toISOString() });
    const trimmed = filtered.slice(0, 20);
    await AsyncStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(trimmed));
    console.log('[MaterialDB] Added recent material:', material.name);
  } catch (err) {
    console.error('[MaterialDB] Add recent error:', err);
  }
}

export async function getRecentMaterials(): Promise<RecentMaterial[]> {
  try {
    const data = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('[MaterialDB] Get recents error:', err);
    return [];
  }
}

export async function getCustomMaterialCount(): Promise<number> {
  const materials = await getCustomMaterials();
  return materials.length;
}

export async function deleteCustomMaterial(id: string): Promise<void> {
  try {
    const materials = await getCustomMaterials();
    const filtered = materials.filter(m => m.id !== id);
    await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(filtered));
    console.log('[MaterialDB] Deleted material:', id);
  } catch (err) {
    console.error('[MaterialDB] Delete error:', err);
  }
}
