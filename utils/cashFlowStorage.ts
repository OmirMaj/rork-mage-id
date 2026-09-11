// cashFlowStorage.ts — where the cash-flow setup lives, and why it lives in
// two places.
//
// Until the 2026-09-07 audit (do-next #12c) it lived in exactly one: the
// device. Starting balance, the expense list, expected payments, payment terms
// and daily overhead were all in `mage_cashflow_data` in AsyncStorage and
// nowhere else, so a GC who set the whole thing up on his laptop opened Cash
// Flow on his phone to a $0 starting balance and an empty expense list — on the
// one screen whose entire purpose is answering "can I make payroll on Friday".
// Nothing on that screen said the setup was missing; it just answered the
// question with the wrong numbers.
//
// public.cash_flow_settings (migration 20260908120100) is now the source of
// truth: one owner-scoped row per user, read through on load and written
// through on every change. AsyncStorage stays as the OFFLINE READ CACHE — it
// is what the screen shows on a plane, and it is what the morning brief and
// the AI fact blocks read, since those call the loaders without a user id.
//
// THE MERGE MODEL, stated because it is a real limitation the UI must not hide:
// `expenses` and `expected_payments` are jsonb LISTS, so they are
// last-writer-wins as a whole. The failure this closes is an EMPTY second
// device, not a merge conflict — a GC editing the expense list on two devices
// at the same time will lose one side's edits. The migration header says the
// same thing and says not to describe the column as merged; app/cash-flow.tsx
// prints that caveat under both lists.
//
// Every write goes through utils/offlineQueue.supabaseWrite, never a direct
// supabase.from(...).upsert — an edit made in a basement with no signal has to
// survive until the phone finds a tower, and the queue is the only thing in
// this app that guarantees it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { stripDerivedExpenses } from './cashFlowEngine';
import type { CashFlowExpense, ExpectedPayment } from './cashFlowEngine';

const CASHFLOW_DATA_KEY = 'mage_cashflow_data';
const CASHFLOW_SETUP_KEY = 'mage_cashflow_setup_complete';
const CASHFLOW_AI_CACHE_KEY = 'mage_cashflow_ai_cache';
const CASHFLOW_TABLE = 'cash_flow_settings';

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

/** What one read-through returns: the setup itself, the setup-complete flag
 *  (they live in the same server row), and where the answer came from, so the
 *  screen can tell a real empty setup from an offline cache miss. */
export interface CashFlowSettings {
  data: CashFlowData;
  setupComplete: boolean;
  source: 'server' | 'device' | 'default';
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

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The server row → the shape the screen already speaks.
 *
 * `starting_balance` and `daily_overhead_cost` are `numeric` columns, and
 * PostgREST hands numerics back as STRINGS to preserve precision — a raw
 * assignment would put "42000.00" where the forecast expects a number, and
 * `balance + netCashFlow` would then concatenate rather than add.
 */
function rowToData(row: Record<string, unknown>): CashFlowData {
  return {
    startingBalance: num(row.starting_balance, 0),
    balanceAsOf: typeof row.balance_as_of === 'string' ? row.balance_as_of : undefined,
    // stripDerivedExpenses on the way IN as well as out: a build that shipped
    // before the derived rows were kept out of storage could have frozen one
    // into the row, and a frozen copy would be counted alongside the live
    // commitment it came from — the double count this whole path exists to
    // avoid — at whatever amount it had the day it was written.
    expenses: stripDerivedExpenses(list<CashFlowExpense>(row.expenses)),
    expectedPayments: list<ExpectedPayment>(row.expected_payments),
    defaultPaymentTerms: typeof row.default_payment_terms === 'string' ? row.default_payment_terms : 'net_30',
    dailyOverheadCost: num(row.daily_overhead_cost, DEFAULT_CASHFLOW_DATA.dailyOverheadCost),
    lastUpdated: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function dataToRow(userId: string, data: CashFlowData, setupComplete?: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    starting_balance: data.startingBalance,
    balance_as_of: data.balanceAsOf ?? null,
    expenses: data.expenses,
    expected_payments: data.expectedPayments,
    default_payment_terms: data.defaultPaymentTerms,
    daily_overhead_cost: data.dailyOverheadCost,
    updated_at: new Date().toISOString(),
  };
  if (setupComplete !== undefined) row.setup_complete = setupComplete;
  return row;
}

async function readCache(): Promise<CashFlowData | null> {
  try {
    const stored = await AsyncStorage.getItem(CASHFLOW_DATA_KEY);
    if (!stored) return null;
    const parsed = { ...DEFAULT_CASHFLOW_DATA, ...(JSON.parse(stored) as CashFlowData) };
    return { ...parsed, expenses: stripDerivedExpenses(parsed.expenses) };
  } catch (err) {
    console.log('[CashFlowStorage] Cache read failed:', err);
    return null;
  }
}

async function writeCache(data: CashFlowData): Promise<void> {
  try {
    await AsyncStorage.setItem(CASHFLOW_DATA_KEY, JSON.stringify(data));
  } catch (err) {
    console.log('[CashFlowStorage] Cache write failed:', err);
  }
}

/**
 * The read-through entry point. Pass the signed-in user's id to get the server
 * row (and refresh the offline cache with it); omit it — as the morning brief
 * and the AI fact blocks do — to read the device cache only.
 *
 * A server error or a cold network never blanks the screen: the cache answers,
 * and `source` says which side spoke so the caller can be honest about it.
 */
export async function loadCashFlowSettings(userId?: string | null): Promise<CashFlowSettings> {
  const cached = await readCache();
  const cachedFlag = await readSetupFlag();

  if (userId && isSupabaseConfigured) {
    try {
      const { data: row, error } = await supabase
        .from(CASHFLOW_TABLE)
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (row) {
        const data = rowToData(row as Record<string, unknown>);
        await writeCache(data);
        // MONOTONIC. Nothing in the app un-completes cash-flow setup, so the
        // flag may only ever go false → true, and the two sides are OR-ed
        // rather than the server simply overwriting the device.
        //
        // A plain mirror of a false server flag reopened the setup wizard on
        // the device that had just finished the wizard. `markSetupComplete`
        // fires its own queued upsert, so any moment where that write is still
        // in the offline queue — a basement, a dropped request, a terminal RLS
        // failure — leaves the server saying `setup_complete = false` while the
        // GC's balance and expense list are sitting right there on the screen
        // behind the wizard.
        const serverFlag = (row as { setup_complete?: boolean }).setup_complete === true;
        const setupComplete = serverFlag || cachedFlag;
        await writeSetupFlag(setupComplete);
        // Converge the server on the device's answer instead of leaving the
        // row permanently disagreeing with every other device.
        if (setupComplete && !serverFlag) void markSetupComplete(userId);
        return { data, setupComplete, source: 'server' };
      }
    } catch (err) {
      console.log('[CashFlowStorage] Server read failed, using device cache:', err);
    }
  }

  if (cached) return { data: cached, setupComplete: cachedFlag, source: 'device' };
  return { data: DEFAULT_CASHFLOW_DATA, setupComplete: cachedFlag, source: 'default' };
}

/** Device-cache read, kept for the callers that have no user id in hand
 *  (hooks/useMorningBrief.ts, utils/oneMind/factBlocks.ts, the summary tab). */
export async function loadCashFlowData(userId?: string | null): Promise<CashFlowData> {
  return (await loadCashFlowSettings(userId)).data;
}

/**
 * Write-through. The device cache is updated FIRST so the screen stays
 * responsive and correct offline, then the row goes out through the offline
 * queue — which either lands it now or holds it until the phone is back.
 */
export async function saveCashFlowData(data: CashFlowData, userId?: string | null): Promise<void> {
  // Sanitised once, here, so BOTH destinations get the same list. Derived rows
  // are a view of the live commitments and must never be frozen into storage —
  // see stripDerivedExpenses in utils/cashFlowEngine.ts.
  const toSave = {
    ...data,
    expenses: stripDerivedExpenses(data.expenses),
    lastUpdated: new Date().toISOString(),
  };
  await writeCache(toSave);
  if (userId) {
    // Upsert, not insert: the row is keyed on user_id and every save after the
    // first is an edit to a row that already exists. A plain insert would fail
    // the primary-key constraint, which offlineQueue classifies as terminal —
    // the edit would be dropped and the next server read would revert it.
    void supabaseWrite(CASHFLOW_TABLE, 'upsert', dataToRow(userId, toSave));
  }
}

async function readSetupFlag(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CASHFLOW_SETUP_KEY)) === 'true';
  } catch {
    return false;
  }
}

async function writeSetupFlag(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CASHFLOW_SETUP_KEY, value ? 'true' : 'false');
  } catch (err) {
    console.log('[CashFlowStorage] Setup flag save failed:', err);
  }
}

export async function isSetupComplete(userId?: string | null): Promise<boolean> {
  if (!userId) return readSetupFlag();
  return (await loadCashFlowSettings(userId)).setupComplete;
}

export async function markSetupComplete(userId?: string | null): Promise<void> {
  await writeSetupFlag(true);
  if (userId) {
    // Only the flag column. PostgREST's upsert issues INSERT … ON CONFLICT DO
    // UPDATE over exactly the keys in the payload, so this cannot blank the
    // balance or the lists that saveCashFlowData wrote a moment earlier — and
    // if the row does not exist yet, the columns it omits take the NOT NULL
    // defaults the migration gives them.
    void supabaseWrite(CASHFLOW_TABLE, 'upsert', {
      user_id: userId,
      setup_complete: true,
      updated_at: new Date().toISOString(),
    });
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
