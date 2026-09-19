// useLaborRates — the GC's loaded labor rates, per trade, plus how he pays
// overtime (the multiplier and the overtime rule).
//
// The one missing piece between crew time tracking and the cost book: hours
// are measured, but no pay rate exists on TimeEntry or CrewMember. The GC
// knows his loaded rate (wages + burden) — he writes the paychecks — so he
// states it once per trade in Time Tracking's Labor rates sheet.
//
// Storage (#61). The rates used to live only in AsyncStorage on the device
// where he typed them, and the tenant sweep erases every `mageid_` key on
// sign-in and sign-out (the sweep is prefix-based now — the old header said
// "registered in LOCAL_USER_CACHE_KEYS", which stopped being the mechanism).
// On the web app, or after any sign-out, every clocked hour priced at $0. They
// now live on the ACCOUNT — gc_labor_rates + gc_labor_settings, RLS user_id =
// auth.uid(), written through utils/offlineQueue supabaseWrite — and
// `mageid_labor_rates` is only this device's cache of that book, so a jobsite
// with no signal still prices labor. The merge (newest edit wins, cell by
// cell, on device and server alike) is utils/laborSamples mergeRateBooks.
//
// Also exports useLaborCostSamples(): the read-side bridge that grounding
// screens (estimate wizard, quick estimate, judges, cost database) mount to
// fold self-perform labor into buildCostDatabase's 4th param. It reads the
// time-entry costing mirror from storage through hooks/useTimeEntries'
// loadTimeEntriesMirror — the user's own shifts plus the crew hours others
// logged on the jobs he OWNS (#28) — and never the store's context, so it has
// no notification side effects and works on any screen.

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry } from '@/types';
import type { CostSample } from '@/utils/costDatabase';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { useAuth } from '@/contexts/AuthContext';
import {
  buildLaborSamples, normalizeOvertimeMultiplier, DEFAULT_OVERTIME_MULTIPLIER,
  parseCachedBook, bookFromServer, mergeRateBooks, rateMapOf, rateRowFor, settingsRowFor, roundRate,
  type LaborRateBook, type LaborSettingsCell,
} from '@/utils/laborSamples';
import { DEFAULT_OVERTIME_RULE, normalizeOvertimeRule, type OvertimeRule } from '@/utils/overtime';
import { loadTimeEntriesMirror } from '@/hooks/useTimeEntries';

/** Device cache of the account's rate book (v2: `{ v: 2, userId, rates, settings }`;
 *  a v1 bare `{trade: rate}` map is read once and pushed up). `mageid_` prefix
 *  ⇒ swept on a tenant switch; the account copy survives that. */
const RATES_KEY = 'mageid_labor_rates';
// MONEY-F19's own key for the multiplier, from before the settings row existed.
// Read ONLY to carry a v1 device's multiplier into the book; never written.
const LEGACY_OVERTIME_KEY = 'mageid_labor_overtime_multiplier';
const RATES_QUERY = 'labor-rate-book';
const ENTRIES_MIRROR_QUERY = ['time-entries-mirror'] as const;
const EMPTY_BOOK: LaborRateBook = { rates: {}, settings: null };

async function readCache(userId: string | null): Promise<LaborRateBook> {
  try {
    const [raw, legacyOt] = await Promise.all([
      AsyncStorage.getItem(RATES_KEY),
      AsyncStorage.getItem(LEGACY_OVERTIME_KEY),
    ]);
    if (!raw && !legacyOt) return EMPTY_BOOK;
    const parsed = raw ? JSON.parse(raw) : {};
    // A cache stamped for another account is not this user's book. The sweep
    // should already have removed it; this is the belt to that brace.
    if (parsed && typeof parsed === 'object' && parsed.v === 2 && parsed.userId && parsed.userId !== userId) return EMPTY_BOOK;
    return parseCachedBook(parsed, legacyOt);
  } catch {
    return EMPTY_BOOK;
  }
}

async function writeCache(userId: string | null, book: LaborRateBook): Promise<void> {
  try {
    await AsyncStorage.setItem(RATES_KEY, JSON.stringify({ v: 2, userId, rates: book.rates, settings: book.settings }));
    await AsyncStorage.removeItem(LEGACY_OVERTIME_KEY);
  } catch (err) {
    console.log('[laborRates] cache write failed:', err);
  }
}

interface BookState { book: LaborRateBook }

/** The ACCOUNT half, run in the background (never on the path to `rates`).
 *  Read the account copy; merge it, newest cell wins, with what this device
 *  holds NOW — the in-memory book (every edit lands there synchronously),
 *  else the disk cache; publish the merge into the book query, write the
 *  cache, and push any cell the device holds newer. Returns true once the
 *  account copy has been read. A failed read (offline, or the migration not
 *  applied yet) changes nothing — never an empty book over a real one. */
async function syncBookWithAccount(
  userId: string,
  getLocal: () => LaborRateBook | undefined,
  publish: (book: LaborRateBook) => void,
): Promise<boolean> {
  try {
    const [ratesRes, settingsRes] = await Promise.all([
      supabase.from('gc_labor_rates').select('trade_key, rate, updated_at').eq('user_id', userId),
      supabase.from('gc_labor_settings').select('overtime_multiplier, ot_weekly_threshold, ot_daily_threshold, week_starts_on, updated_at').eq('user_id', userId).maybeSingle(),
    ]);
    if (ratesRes.error || settingsRes.error) return false;
    const server = bookFromServer(ratesRes.data ?? [], settingsRes.data ?? null);
    // Read the device side AFTER the round trip: an edit saved while the read
    // was in flight must win over the account's older copy.
    const local = getLocal() ?? await readCache(userId);
    const { merged, pushRates, pushSettings } = mergeRateBooks(local, server);
    publish(merged);
    // Cache what memory holds by now (an edit may have landed on top of the
    // merge), so the disk never lags the book the screens are showing.
    await writeCache(userId, getLocal() ?? merged);
    for (const k of pushRates) void supabaseWrite('gc_labor_rates', 'upsert', rateRowFor(userId, k, merged.rates[k]));
    if (pushSettings && merged.settings) void supabaseWrite('gc_labor_settings', 'upsert', settingsRowFor(userId, merged.settings));
    return true;
  } catch {
    return false;
  }
}

export function useLaborRates() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Keyed by user: the in-memory cache must never hand one account's book to
  // the next on a shared device.
  const queryKey = useMemo(() => [RATES_QUERY, userId] as const, [userId]);

  // CACHE FIRST (review). `rates` comes from THIS query, which only reads the
  // device cache — milliseconds, no network. Waiting on the account read
  // (supabase-js sets no timeout) left every costing screen at $0 labor and
  // a false "no rate" banner for the whole round trip on jobsite signal.
  // If the account sync has already published into this key, that wins.
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<BookState> => {
      const cached = await readCache(userId);
      return queryClient.getQueryData<BookState>(queryKey) ?? { book: cached };
    },
    // The cache only changes through this hook (commit / the sync below),
    // both of which update this key directly — re-reading it is never needed.
    staleTime: Infinity,
  });

  // The account sync, in the background: merges into the book above when it
  // lands. Every costing screen mounts this hook, so five minutes, plus a
  // fresh pull whenever the signed-in account changes (the key does).
  const { data: fromAccount } = useQuery({
    queryKey: [RATES_QUERY, 'account-sync', userId] as const,
    enabled: !!userId && isSupabaseConfigured,
    queryFn: () => syncBookWithAccount(
      userId as string,
      () => queryClient.getQueryData<BookState>(queryKey)?.book,
      (merged) => queryClient.setQueryData<BookState>(queryKey, { book: merged }),
    ),
    staleTime: 5 * 60 * 1000,
  });
  const book = data?.book ?? EMPTY_BOOK;
  const rates = useMemo(() => rateMapOf(book), [book]);

  // Read-modify-write against the CACHE, updated synchronously before any
  // await, so two edits in one tick each see the other (the old onSuccess
  // update lost all but the last of a multi-trade edit).
  const current = useCallback(
    (): BookState => queryClient.getQueryData<BookState>(queryKey) ?? { book },
    [queryClient, queryKey, book],
  );
  const commit = useCallback((next: LaborRateBook, rateKeys: string[], settings: boolean) => {
    queryClient.setQueryData<BookState>(queryKey, { book: next });
    void writeCache(userId, next);
    if (!userId) return;
    for (const k of rateKeys) void supabaseWrite('gc_labor_rates', 'upsert', rateRowFor(userId, k, next.rates[k]));
    if (settings && next.settings) void supabaseWrite('gc_labor_settings', 'upsert', settingsRowFor(userId, next.settings));
  }, [queryClient, queryKey, userId]);

  /** Apply a batch of rate edits in ONE read-merge-write. Set when rate > 0,
   *  clear when null/0/NaN. Only keys whose value actually changed are
   *  written (and re-dated), so saving the sheet unchanged sends nothing. */
  const setRates = useCallback((batch: Record<string, number | null>) => {
    const prev = current().book;
    const now = new Date().toISOString();
    const nextRates = { ...prev.rates };
    const changed: string[] = [];
    for (const [tradeKey, raw] of Object.entries(batch)) {
      const rate = raw !== null && Number.isFinite(raw) && raw > 0 ? roundRate(raw) : null;
      const had = prev.rates[tradeKey]?.rate ?? null;
      if (had === rate) continue;
      nextRates[tradeKey] = { rate, updatedAt: now };
      changed.push(tradeKey);
    }
    if (changed.length === 0) return;
    commit({ rates: nextRates, settings: prev.settings }, changed, false);
  }, [current, commit]);

  /** Set (rate > 0) or clear (rate null/0) the loaded $/hr for a normalized
   *  trade key (utils/laborSamples.ts normalizeTradeKey). For multiple
   *  edits use setRates — never call this in a loop. */
  const setRate = useCallback((tradeKey: string, rate: number | null) => {
    setRates({ [tradeKey]: rate });
  }, [setRates]);

  // MONEY-F19 / #153 / #65: how he pays overtime. The multiplier is sane-d on
  // the way in (normalizeOvertimeMultiplier: 1–3, junk → 1.5); the rule is the
  // federal weekly >40 until he says otherwise. `overtimeIsDefault` lets a
  // screen say "1.5× — the default" instead of presenting it as his setting.
  const overtimeMultiplier = book.settings?.overtimeMultiplier ?? DEFAULT_OVERTIME_MULTIPLIER;
  const overtimeRule: OvertimeRule = book.settings?.overtimeRule ?? DEFAULT_OVERTIME_RULE;
  const overtimeIsDefault = book.settings == null;

  const setOvertimeSettings = useCallback((patch: { overtimeMultiplier?: number; overtimeRule?: Partial<OvertimeRule> }) => {
    const prev = current().book;
    const base: LaborSettingsCell = prev.settings ?? {
      overtimeMultiplier: DEFAULT_OVERTIME_MULTIPLIER, overtimeRule: DEFAULT_OVERTIME_RULE, updatedAt: '',
    };
    const nextMultiplier = patch.overtimeMultiplier === undefined
      ? base.overtimeMultiplier : normalizeOvertimeMultiplier(patch.overtimeMultiplier);
    const nextRule = normalizeOvertimeRule({ ...base.overtimeRule, ...(patch.overtimeRule ?? {}) });
    // Nothing changed (including "still the defaults") ⇒ nothing written, so
    // closing the sheet untouched never stamps a setting he did not make.
    const same = nextMultiplier === base.overtimeMultiplier
      && JSON.stringify(nextRule) === JSON.stringify(normalizeOvertimeRule(base.overtimeRule));
    if (same) return;
    commit({
      rates: prev.rates,
      settings: { overtimeMultiplier: nextMultiplier, overtimeRule: nextRule, updatedAt: new Date().toISOString() },
    }, [], true);
  }, [current, commit]);

  const setOvertimeMultiplier = useCallback((multiplier: number) => {
    setOvertimeSettings({ overtimeMultiplier: multiplier });
  }, [setOvertimeSettings]);
  const setOvertimeRule = useCallback((rule: Partial<OvertimeRule>) => {
    setOvertimeSettings({ overtimeRule: rule });
  }, [setOvertimeSettings]);

  return {
    rates, isLoading, setRate, setRates,
    overtimeMultiplier, setOvertimeMultiplier, overtimeRule, setOvertimeRule, setOvertimeSettings, overtimeIsDefault,
    /** False until this device has read the account copy once this session
     *  (offline, or the migration not live yet) — the sheet says so. */
    ratesFromAccount: fromAccount === true,
  };
}

/**
 * Read-only view of the time-entry local mirror: the user's own shifts plus
 * the team's shifts on projects he owns (hooks/useTimeEntries
 * loadTimeEntriesMirror). Re-read on each mounting screen, and invalidated by
 * the time-entry store after every write (TIME_ENTRIES_MIRROR_QUERY_KEY). On a
 * brand-new device the mirror is empty until the store first syncs —
 * grounding just has no labor facts yet, which is honest. It reads storage
 * rather than the store's context so it stays a plain read wherever it is
 * called; it never touches shift alerts or the timesheet.
 */
export function useTimeEntriesMirror(): TimeEntry[] {
  const { data: entries = [] } = useQuery({
    queryKey: ENTRIES_MIRROR_QUERY,
    // Own shifts + the crew hours others logged on the jobs this user OWNS
    // (#28). Reading only the own-shift key showed $0 self-perform labour on
    // every job a foreman clocked the crew in on.
    queryFn: loadTimeEntriesMirror,
    refetchOnMount: 'always',
  });
  return entries;
}

/** Self-perform labor cost samples for buildCostDatabase's 4th param. */
export function useLaborCostSamples(): CostSample[] {
  const { rates, overtimeMultiplier, overtimeRule } = useLaborRates();
  const entries = useTimeEntriesMirror();
  return useMemo(
    () => buildLaborSamples(entries, rates, overtimeMultiplier, overtimeRule),
    [entries, rates, overtimeMultiplier, overtimeRule],
  );
}
