// i18n/catalog/es/index.ts — the Spanish catalog, merged from area files.
// Pure data (no React Native), so the same files can feed the Deno edge
// functions and the static portal pages later (scripts/i18n-sync-edge).
//
// Loaded statically for now: the seed is small. When the Phase 1 catalog
// lands (~1,700 strings) switch core.ts to a lazy require() so English users
// never parse Spanish.

import type { EsCatalog } from '../../types';
import { ES_NAV } from './nav';
import { ES_SETTINGS } from './settings';
import { ES_COMMON } from './common';
import { ES_AI } from './ai';
import { ES_FIELD } from './field';
import { ES_SAFETY } from './safety';
import { ES_OUTBOUND } from './outbound';

export const ES_CATALOG: EsCatalog = {
  ...ES_NAV,
  ...ES_SETTINGS,
  ...ES_COMMON,
  ...ES_AI,
  ...ES_FIELD,
  ...ES_SAFETY,
  ...ES_OUTBOUND,
};
