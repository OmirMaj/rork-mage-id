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
// - Persisted to AsyncStorage under `tertiary_material_cart` (the new
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

const CART_KEY = 'tertiary_material_cart';
const MARKUP_KEY = 'tertiary_material_cart_markup';

export interface MaterialCartItem {
  material: MaterialItem;
  quantity: number;
  markup: number; // percent, 0-100
  usesBulk: boolean;
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

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[MaterialCart] Local save failed for', key, err);
  }
}

export const [MaterialCartProvider, useMaterialCart] = createContextHook(() => {
  const [cart, setCart] = useState<MaterialCartItem[]>([]);
  const [globalMarkup, setGlobalMarkupState] = useState<number>(DEFAULT_MARKUP);
  // Track when we've hydrated so we don't write the empty initial state back
  // over the persisted cart on first mount.
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cartLoaded, markupLoaded] = await Promise.all([
        loadLocal<MaterialCartItem[]>(CART_KEY, []),
        loadLocal<number>(MARKUP_KEY, DEFAULT_MARKUP),
      ]);
      if (cancelled) return;
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
      if (typeof markupLoaded === 'number' && !Number.isNaN(markupLoaded)) {
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

  const setGlobalMarkup = useCallback((value: number) => {
    setGlobalMarkupState(value);
    // Cascade to all current items so the cart view reflects the new value
    // immediately. Per-item updateMarkup overrides this for individual lines.
    setCart(prev => prev.map(i => ({ ...i, markup: value })));
  }, []);

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
    globalMarkup,
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
