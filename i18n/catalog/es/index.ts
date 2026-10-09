// i18n/catalog/es/index.ts — the Spanish catalog, merged from area files.
// Pure data (no React Native), so the same files can feed the Deno edge
// functions and the static portal pages later (scripts/i18n-sync-edge).
//
// i18n/core.ts loads this LAZILY (require() on the first Spanish lookup), so
// an English user never parses Spanish (docs/I18N.md §2).
//
// Shards (wave-next W2, lane ESTOOLS): the field area is split per surface
// (es/field/*.ts) so parallel lanes never edit the same file. Each file is
// owned by exactly one lane per phase (see the file's header).

import type { EsCatalog } from '../../types';
import { ES_NAV } from './nav';
import { ES_SETTINGS } from './settings';
import { ES_COMMON } from './common';
import { ES_AI } from './ai';
import { ES_SAFETY } from './safety';
import { ES_OUTBOUND } from './outbound';
import { ES_FIELD_SHARED } from './field/shared';
import { ES_FIELD_DFR } from './field/dfr';
import { ES_FIELD_TIME } from './field/time';
import { ES_FIELD_PUNCH } from './field/punch';
import { ES_FIELD_PUNCH_WALK } from './field/punchWalk';
import { ES_FIELD_TICKET } from './field/ticket';
import { ES_FIELD_CREW } from './field/crew';
import { ES_FIELD_LINEUP } from './field/lineup';
import { ES_FIELD_HOME } from './field/home';
import { ES_FIELD_CHROME } from './field/chrome';
import { ES_FIELD_DELIVERY } from './field/delivery';
import { ES_FIELD_PHOTO } from './field/photo';
import { ES_FIELD_VOICE } from './field/voice';
import { ES_OFFICE_FIRST_JOB } from './office/firstJob';
import { ES_OFFICE_PROTECT } from './office/protect';
import { ES_OFFICE_ROOM_SCAN } from './office/roomScan';
import { ES_OFFICE_CODE_FLAGS } from './office/codeFlags';
import { ES_OFFICE_PROOF_PACK } from './office/proofPack';
import { ES_OFFICE_LIVING_MODEL } from './office/livingModel';
import { ES_OFFICE_LIVING_MODEL_PHONE } from './office/livingModelPhone';
import { ES_OFFICE_SCAN_CLEARANCE } from './office/scanClearance';
import { ES_OFFICE_NOTICES } from './office/notices';

/** Every Spanish file by its path under es/ (validate-i18n checks a key never sits in two). */
export const ES_SHARDS: Record<string, EsCatalog> = {
  nav: ES_NAV,
  settings: ES_SETTINGS,
  common: ES_COMMON,
  ai: ES_AI,
  safety: ES_SAFETY,
  outbound: ES_OUTBOUND,
  'field/shared': ES_FIELD_SHARED,
  'field/dfr': ES_FIELD_DFR,
  'field/time': ES_FIELD_TIME,
  'field/punch': ES_FIELD_PUNCH,
  'field/punchWalk': ES_FIELD_PUNCH_WALK,
  'field/ticket': ES_FIELD_TICKET,
  'field/crew': ES_FIELD_CREW,
  'field/lineup': ES_FIELD_LINEUP,
  'field/home': ES_FIELD_HOME,
  'field/chrome': ES_FIELD_CHROME,
  'field/delivery': ES_FIELD_DELIVERY,
  'field/photo': ES_FIELD_PHOTO,
  'field/voice': ES_FIELD_VOICE,
  'office/firstJob': ES_OFFICE_FIRST_JOB,
  'office/protect': ES_OFFICE_PROTECT,
  'office/roomScan': ES_OFFICE_ROOM_SCAN,
  'office/codeFlags': ES_OFFICE_CODE_FLAGS,
  'office/proofPack': ES_OFFICE_PROOF_PACK,
  'office/livingModel': ES_OFFICE_LIVING_MODEL,
  'office/livingModelPhone': ES_OFFICE_LIVING_MODEL_PHONE,
  'office/scanClearance': ES_OFFICE_SCAN_CLEARANCE,
  'office/notices': ES_OFFICE_NOTICES,
};

export const ES_CATALOG: EsCatalog = Object.assign({}, ...Object.values(ES_SHARDS)) as EsCatalog;
