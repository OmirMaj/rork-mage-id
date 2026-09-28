// i18n/catalog/en/index.ts — the English catalog: the hand-kept seed plus one
// GENERATED shard per surface (wave-next W2, lane ESTOOLS).
//
// Why shards: parallel Spanish lanes each own one surface, so each only ever
// rewrites its own `<surfaceId>.generated.ts` through
//   bun run scripts/i18n-extract.ts --surface <surfaceId>
// and two lanes never edit the same catalog file. `unassigned.generated.ts`
// holds keys no surface owns and must stay empty.
//
// The translator's source and the parity reference. NEVER the runtime source
// for English: t() returns the inline English at the call site. Imported
// statically: validators and the extractor read it; the app never does.

import type { EnCatalog } from '../../types';
import { EN_SEED } from './seed';
import { EN as EN_UNASSIGNED } from './unassigned.generated';
import { EN as EN_FIELD_DAILY_REPORT } from './field.daily-report.generated';
import { EN as EN_FIELD_SAFETY } from './field.safety.generated';
import { EN as EN_FIELD_TIME_CLOCK } from './field.time-clock.generated';
import { EN as EN_FIELD_PUNCH } from './field.punch.generated';
import { EN as EN_FIELD_PUNCH_WALK } from './field.punch-walk.generated';
import { EN as EN_FIELD_TICKET } from './field.ticket.generated';
import { EN as EN_FIELD_CREW } from './field.crew.generated';
import { EN as EN_FIELD_LINEUP } from './field.lineup.generated';
import { EN as EN_FIELD_HOME } from './field.home.generated';
import { EN as EN_FIELD_SHELL } from './field.shell.generated';
import { EN as EN_FIELD_CHROME } from './field.chrome.generated';
import { EN as EN_COMMON_ERRORS } from './common.errors.generated';
import { EN as EN_COMMON_MOMENTS } from './common.moments.generated';
import { EN as EN_FIELD_DELIVERIES } from './field.deliveries.generated';
import { EN as EN_FIELD_PHOTOS } from './field.photos.generated';
import { EN as EN_FIELD_VOICE } from './field.voice.generated';
import { EN as EN_DESK_SIDEBAR } from './desk.sidebar.generated';
import { EN as EN_DESK_CREW_REGISTER } from './desk.crew-register.generated';

/** Every generated shard by surface id (validate-i18n checks duplicates across them). */
export const EN_SHARDS: Record<string, EnCatalog> = {
  'field.daily-report': EN_FIELD_DAILY_REPORT,
  'field.safety': EN_FIELD_SAFETY,
  'field.time-clock': EN_FIELD_TIME_CLOCK,
  'field.punch': EN_FIELD_PUNCH,
  'field.punch-walk': EN_FIELD_PUNCH_WALK,
  'field.ticket': EN_FIELD_TICKET,
  'field.crew': EN_FIELD_CREW,
  'field.lineup': EN_FIELD_LINEUP,
  'field.home': EN_FIELD_HOME,
  'field.shell': EN_FIELD_SHELL,
  'field.chrome': EN_FIELD_CHROME,
  'common.errors': EN_COMMON_ERRORS,
  'common.moments': EN_COMMON_MOMENTS,
  'field.deliveries': EN_FIELD_DELIVERIES,
  'field.photos': EN_FIELD_PHOTOS,
  'field.voice': EN_FIELD_VOICE,
  'desk.sidebar': EN_DESK_SIDEBAR,
  'desk.crew-register': EN_DESK_CREW_REGISTER,
};

export { EN_SEED, EN_UNASSIGNED };

export const EN_CATALOG: EnCatalog = {
  ...EN_SEED,
  ...Object.assign({}, ...Object.values(EN_SHARDS)),
  ...EN_UNASSIGNED,
};
