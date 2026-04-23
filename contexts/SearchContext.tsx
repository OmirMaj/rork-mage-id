// ============================================================================
// contexts/SearchContext.tsx
//
// Tiny context wrapping the Universal Search modal's visibility. Lives above
// the router stack so Cmd+K and the home-header search button can both call
// `openSearch()` — the <UniversalSearch /> mount itself lives in app/_layout.
// ============================================================================

import { useCallback, useState } from 'react';
import createContextHook from '@nkzw/create-context-hook';

export const [SearchProvider, useSearch] = createContextHook(() => {
  const [isOpen, setIsOpen] = useState(false);

  const openSearch = useCallback(() => setIsOpen(true), []);
  const closeSearch = useCallback(() => setIsOpen(false), []);
  const toggleSearch = useCallback(() => setIsOpen(prev => !prev), []);

  return { isOpen, openSearch, closeSearch, toggleSearch };
});
