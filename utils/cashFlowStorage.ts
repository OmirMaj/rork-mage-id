import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CashFlowExpense, ExpectedPayment } from './cashFlowEngine';

const CASHFLOW_DATA_KEY = 'mage_cashflow_data';
const CASHFLOW_SETUP_KEY = 'mage_cashflow_setup_complete';
const CASHFLOW_AI_CACHE_KEY = 'mage_cashflow_ai_cache';

export interface CashFlowData {
  startingBalance: number;
  // The timestamp the startingBalance was last set. Any invoice payments dated
  // AFTER this get auto-added to the effective current balance — that way the
  // GC doesn't have to manually bump the bank balance every time a check clears.
  balanceAsOf?: string;
  expenses: CashFlowExpense[];
  expectedPayments: ExpectedPayment[];
  defaultPaymentTerms: string;
  dailyOverheadCost: number;
  lastUpdated: string;
}

const DEFAULT_CASHFLOW_DATA: CashFlowData = {
  startingBalance: 0,
  balanceAsOf: new Date().toISOString(),
  expenses: [],
  expectedPayments: [],
  defaultPaymentTerms: 'net_30',
  dailyOverheadCost: 350,
  lastUpdated: new Date().toISOString(),
};

export async function loadCashFlowData(): Promise<CashFlowData> {
  try {
    const stored = await AsyncStorage.getItem(CASHFLOW_DATA_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CashFlowData;
      return { ...DEFAULT_CASHFLOW_DATA, ...parsed };
    }
    return DEFAULT_CASHFLOW_DATA;
  } catch (err) {
    console.log('[CashFlowStorage] Load failed:', err);
    return DEFAULT_CASHFLOW_DATA;
  }
}

export async function saveCashFlowData(data: CashFlowData): Promise<void> {
  try {
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    await AsyncStorage.setItem(CASHFLOW_DATA_KEY, JSON.stringify(toSave));
    console.log('[CashFlowStorage] Data saved');
  } catch (err) {
    console.log('[CashFlowStorage] Save failed:', err);
  }
}

export async function isSetupComplete(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(CASHFLOW_SETUP_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markSetupComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(CASHFLOW_SETUP_KEY, 'true');
  } catch (err) {
    console.log('[CashFlowStorage] Setup flag save failed:', err);
  }
}

export interface CachedAIAnalysis {
  data: unknown;
  timestamp: number;
  projectId?: string;
}

export async function getCachedAIAnalysis(projectId?: string): Promise<CachedAIAnalysis | null> {
  try {
    const stored = await AsyncStorage.getItem(CASHFLOW_AI_CACHE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as CachedAIAnalysis;
    const fourHours = 4 * 60 * 60 * 1000;
    if (Date.now() - parsed.timestamp > fourHours) return null;
    if (projectId && parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedAIAnalysis(data: unknown, projectId?: string): Promise<void> {
  try {
    const cache: CachedAIAnalysis = { data, timestamp: Date.now(), projectId };
    await AsyncStorage.setItem(CASHFLOW_AI_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.log('[CashFlowStorage] AI cache save failed:', err);
  }
}
