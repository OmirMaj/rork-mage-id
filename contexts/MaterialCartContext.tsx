// MaterialCartContext — shared materials cart for the Estimator tab.
//
// Why this exists: the Materials browser (app/(tabs)/materials/*) and the
// Estimate tab (app/(tabs)/estimate/index.tsx) both need to mutate the same
// cart. Pre-fix, the cart was a local useState inside Estimate, so there was
// no way to push into it from the Materials browser — users could only build
// estimates from the Estimate tab itself. The user reported:
//
//   "The Materials screen on the iPhone app doesn't allow me to add materials
//    to a cart and put it on a project. That workflow has been lost."
//
// This context restores the workflow. Browse → add → flip to Estimate →
// finalize markup → attach to a project (existing flow).
//
// Notes:
// - Persisted to AsyncStorage under `mageid_material_cart` (the new
//   namespace convention). Survives app restarts.
// - dedup-by-id semantics for addToCart so repeat taps bump quantity.
// - `usesBulk` is recomputed on every quantity change so the bulk-pricing
//   banner stays in sync without callers needing to think about it.
// - Hydrates once on mount. We don't sync to Supabase — cart is purely
//   client-side and not shared across devices (intentional; this is the
//   draft scratch area, not committed estimate data).

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';
import { markupDecidedFromStorage } from '@/utils/estimateMarkup';

const CART_KEY = 'mageid_material_cart';
const MARKUP_KEY = 'mageid_material_cart_markup';
// Labor and assemblies used to live as local useState inside estimate/full.tsx,
// so they were DESTROYED on unmount (lost work) and invisible to review.tsx,
// which read only this material cart and therefore under-reported every grand
// total by exactly labor + assemblies. Lifting them here (same mageid_ prefix,
// so the tenant-wipe sweep covers them) fixes both.
const LABOR_KEY = 'mageid_labor_cart';
const ASSEMBLY_KEY = 'mageid_assembly_cart';
// Has the contractor ever been ASKED what he adds on top of cost, and answered?
//
// DEFAULT_MARKUP below makes "15" indistinguishable from "he never told us",
// which is exactly the ambiguity that let the Quick Estimate wizard ship at
// cost: every AI path wrote markup 0 and there was no state that could say
// "nobody has decided this yet, go ask". This key is that state. It stores the
// literal string '1' once he has answered — including when he answers ZERO,
// which is a legitimate decision (cost-plus work, a favour, a friend's job)
// and must be remembered so he is never asked twice.
//
// Same mageid_ prefix as everything else here, so utils/localCacheKeys'
// prefix sweep wipes it on a tenant switch without a list edit.
//
// IT IS YOUNGER THAN THE VALUE IT DESCRIBES. Every contractor who set a markup
// in the estimator before this key existed has his percentage in MARKUP_KEY
// and no flag beside it, and would hydrate as "never asked" on his first
// launch after the update — quick-quote stops prefilling his 25%, the wizard
// shows him the at-cost band and blocks his PDF. Hydration therefore SEEDS the
// flag from MARKUP_KEY (utils/estimateMarkup.markupDecidedFromStorage) and
// writes the seed through, so the inference runs exactly once.
const MARKUP_DECIDED_KEY = 'mageid_markup_decided';

export interface MaterialCartItem {
  material: MaterialItem;
  quantity: number;
  markup: number; // percent, 0-100
  usesBulk: boolean;
}

export interface LaborCartItem {
  labor: LaborRate;
  hours: number;
  adjustedRate: number;
}

export interface AssemblyCartItem {
  assembly: AssemblyItem;
  quantity: number;
  materialsCost: number;
  laborCost: number;
  totalCost: number;
}

interface PersistedShape {
  cart: MaterialCartItem[];
  globalMarkup: number;
}

const DEFAULT_MARKUP = 15;

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Raw read — `loadLocal` collapses "absent" and "stored fallback value" into
 *  the same answer, and the markup seed above has to tell those two apart. */
async function loadRaw(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[MaterialCart] Local save failed for', key, err);
  }
}

export const [MaterialCartProvider, useMaterialCart] = createContextHook(() => {
  const [cart, setCart] = useState<MaterialCartItem[]>([]);
  const [laborCart, setLaborCart] = useState<LaborCartItem[]>([]);
  const [assemblyCart, setAssemblyCart] = useState<AssemblyCartItem[]>([]);
  const [globalMarkup, setGlobalMarkupState] = useState<number>(DEFAULT_MARKUP);
  // null while hydrating. Callers MUST treat null as "don't know yet" and not
  // prompt — otherwise the markup sheet flashes open on every cold start
  // before AsyncStorage has answered.
  const [markupDecided, setMarkupDecided] = useState<boolean | null>(null);
  // Track when we've hydrated so we don't write the empty initial state back
  // over the persisted cart on first mount.
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cartLoaded, markupRaw, laborLoaded, assemblyLoaded, decidedRaw] = await Promise.all([
        loadLocal<MaterialCartItem[]>(CART_KEY, []),
        loadRaw(MARKUP_KEY),
        loadLocal<LaborCartItem[]>(LABOR_KEY, []),
        loadLocal<AssemblyCartItem[]>(ASSEMBLY_KEY, []),
        loadRaw(MARKUP_DECIDED_KEY),
      ]);
      if (cancelled) return;
      const markupLoaded = parseNumber(markupRaw);
      // Seeded from the markup already on disk, not just from the new flag —
      // otherwise every existing estimator user hydrates as "never asked" and
      // loses the percentage he set months ago. See
      // utils/estimateMarkup.markupDecidedFromStorage for why the presence of
      // the key is a safe proxy for the decision.
      const decided = markupDecidedFromStorage(decidedRaw, markupRaw);
      setMarkupDecided(decided);
      // Persist the seed so the inference runs exactly once. Without this the
      // decided-flag stays absent forever and every consumer re-derives it,
      // which is fine until someone reads the raw key directly.
      if (decided && decidedRaw === null) void saveLocal(MARKUP_DECIDED_KEY, '1');
      if (Array.isArray(laborLoaded)) {
        setLaborCart(laborLoaded.filter(i =>
          i && typeof i === 'object' && i.labor && typeof i.labor === 'object' &&
          typeof i.hours === 'number' && typeof i.adjustedRate === 'number'));
      }
      if (Array.isArray(assemblyLoaded)) {
        setAssemblyCart(assemblyLoaded.filter(i =>
          i && typeof i === 'object' && i.assembly && typeof i.assembly === 'object' &&
          typeof i.totalCost === 'number'));
      }
      // Defensive: AsyncStorage values can drift between schema versions.
      // Ignore anything that doesn't look like our shape.
      if (Array.isArray(cartLoaded)) {
        const cleaned = cartLoaded.filter(item =>
          item &&
          typeof item === 'object' &&
          item.material &&
          typeof item.material === 'object' &&
          typeof item.material.id === 'string' &&
          typeof item.quantity === 'number' &&
          typeof item.markup === 'number'
        );
        setCart(cleaned);
      }
      if (markupLoaded !== null) {
        setGlobalMarkupState(markupLoaded);
      }
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist whenever cart or markup changes — only after hydration so we
  // don't write the initial empty state.
  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(CART_KEY, cart);
  }, [cart]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(MARKUP_KEY, globalMarkup);
  }, [globalMarkup]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(LABOR_KEY, laborCart);
  }, [laborCart]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(ASSEMBLY_KEY, assemblyCart);
  }, [assemblyCart]);

  const addToCart = useCallback((material: MaterialItem, quantity: number = 1) => {
    setCart(prev => {
      const existing = prev.find(i => i.material.id === material.id);
      if (existing) {
        const newQty = existing.quantity + quantity;
        return prev.map(i =>
          i.material.id === material.id
            ? { ...i, quantity: newQty, usesBulk: newQty >= i.material.bulkMinQty }
            : i,
        );
      }
      return [
        ...prev,
        {
          material,
          quantity,
          markup: globalMarkup,
          usesBulk: quantity >= material.bulkMinQty,
        },
      ];
    });
  }, [globalMarkup]);

  const removeFromCart = useCallback((materialId: string) => {
    setCart(prev => prev.filter(i => i.material.id !== materialId));
  }, []);

  const updateQuantity = useCallback((materialId: string, quantity: number) => {
    setCart(prev =>
      prev
        .map(i => {
          if (i.material.id !== materialId) return i;
          const newQty = Math.max(0, quantity);
          return { ...i, quantity: newQty, usesBulk: newQty >= i.material.bulkMinQty };
        })
        .filter(i => i.quantity > 0),
    );
  }, []);

  const updateMarkup = useCallback((materialId: string, markup: number) => {
    setCart(prev =>
      prev.map(i =>
        i.material.id === materialId ? { ...i, markup } : i,
      ),
    );
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  /**
   * Record the contractor's answer to "what do you add on top of cost?".
   *
   * This is the ONLY way `markupDecided` becomes true, and it is deliberately
   * not a side effect of the estimator's markup chips or of hydration — the
   * flag means "he was asked the question and answered it", which is a
   * stronger claim than "a number exists in storage". `pct` of 0 is a real
   * answer (quote at cost) and is recorded as decided, so the ask never
   * repeats; the at-cost disclosure on the estimate is what keeps that honest
   * rather than a second prompt.
   *
   * Writes through to AsyncStorage immediately instead of waiting on the
   * persist effect below: the caller's very next action is usually to share a
   * PDF, and a decision that only lived in React state would be re-asked after
   * a cold start.
   */
  const recordMarkupDecision = useCallback((pct: number) => {
    const safe = Number.isFinite(pct) && pct >= 0 ? pct : 0;
    setGlobalMarkupState(safe);
    setCart(prev => prev.map(i => ({ ...i, markup: safe })));
    setMarkupDecided(true);
    void saveLocal(MARKUP_DECIDED_KEY, '1');
    void saveLocal(MARKUP_KEY, safe);
  }, []);

  // Cascades to all current items so the cart view reflects the new value
  // immediately. Per-item updateMarkup overrides this for individual lines.
  //
  // Every call site is an explicit user gesture (the estimator's markup chips
  // and its custom-percent input — app/(tabs)/estimate/full.tsx:1271, :1799),
  // so setting a global markup here IS the contractor answering the markup
  // question. It records the decision, which is why a contractor who already
  // uses the estimator is never stopped by the wizard's markup sheet.
  const setGlobalMarkup = recordMarkupDecision;

  // Setter that updates JUST the global default (used for next adds) without
  // touching existing line items. Useful when the user wants to change the
  // default without disturbing manual per-line overrides.
  const setGlobalMarkupOnly = useCallback((value: number) => {
    setGlobalMarkupState(value);
  }, []);

  // Bulk-replace the cart. Used by AI suggestions / templates that compute
  // the whole cart and want to install it atomically.
  const replaceCart = useCallback((next: MaterialCartItem[]) => {
    setCart(next);
  }, []);

  // Atomic batch-add — useful when applying AI suggestions that may include
  // multiple items at once. Dedup-by-id, accumulating quantities.
  const addManyToCart = useCallback((items: { material: MaterialItem; quantity: number }[]) => {
    setCart(prev => {
      const map = new Map<string, MaterialCartItem>();
      for (const i of prev) map.set(i.material.id, i);
      for (const incoming of items) {
        const existing = map.get(incoming.material.id);
        if (existing) {
          const newQty = existing.quantity + incoming.quantity;
          map.set(incoming.material.id, {
            ...existing,
            quantity: newQty,
            usesBulk: newQty >= existing.material.bulkMinQty,
          });
        } else {
          map.set(incoming.material.id, {
            material: incoming.material,
            quantity: incoming.quantity,
            markup: globalMarkup,
            usesBulk: incoming.quantity >= incoming.material.bulkMinQty,
          });
        }
      }
      return Array.from(map.values());
    });
  }, [globalMarkup]);

  return {
    cart,
    laborCart,
    setLaborCart,
    assemblyCart,
    setAssemblyCart,
    globalMarkup,
    /** null = still hydrating (do not prompt); false = never asked;
     *  true = he answered, and `globalMarkup` is his answer. */
    markupDecided,
    recordMarkupDecision,
    addToCart,
    addManyToCart,
    removeFromCart,
    updateQuantity,
    updateMarkup,
    clearCart,
    setGlobalMarkup,
    setGlobalMarkupOnly,
    replaceCart,
  };
});

// Re-export the persisted-shape type for any future migration code.
export type { PersistedShape };
