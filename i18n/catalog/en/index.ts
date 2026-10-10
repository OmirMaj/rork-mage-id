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
import { EN as EN_AI_ASK } from './ai.ask.generated';
import { EN as EN_COMMON_TUTORIAL } from './common.tutorial.generated';
import { EN as EN_SETTINGS_LEARN } from './settings.learn.generated';
import { EN as EN_OFFICE_PROJECT_HEALTH } from './office.project-health.generated';
import { EN as EN_MONEY_CO_PROOF } from './money.co-proof.generated';
import { EN as EN_OFFICE_CLIENT_MESSAGES } from './office.client-messages.generated';
import { EN as EN_OFFICE_NY_CONTRACT } from './office.ny-contract.generated';
import { EN as EN_MONEY_COST_XRAY } from './money.cost-xray.generated';
import { EN as EN_OFFICE_JOB_FACTS } from './office.job-facts.generated';
import { EN as EN_SCHEDULE_LATENESS } from './schedule.lateness.generated';
import { EN as EN_FIELD_PUNCH_SEAL } from './field.punch-seal.generated';
import { EN as EN_OFFICE_PERMIT_PATH } from './office.permit-path.generated';
import { EN as EN_OFFICE_WHOSON } from './office.whoson.generated';
import { EN as EN_OFFICE_PROTECT } from './office.protect.generated';
import { EN as EN_OFFICE_MANAGE_SUB } from './office.manage-sub.generated';
import { EN as EN_OFFICE_CODE_FLAGS } from './office.code-flags.generated';
import { EN as EN_OFFICE_FIRST_JOB } from './office.first-job.generated';
import { EN as EN_OFFICE_ROOM_SCAN } from './office.room-scan.generated';
import { EN as EN_OFFICE_LIVING_MODEL } from './office.living-model.generated';
import { EN as EN_OFFICE_LIVING_MODEL_PHONE } from './office.living-model-phone.generated';
import { EN as EN_OFFICE_PROOF_PACK } from './office.proof-pack.generated';
import { EN as EN_OFFICE_SCAN_CLEARANCE } from './office.scan-clearance.generated';
import { EN as EN_OFFICE_NOTICES } from './office.notices.generated';
import { EN as EN_OFFICE_DELIVERIES_SCHEDULE } from './office.deliveries-schedule.generated';

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
  'ai.ask': EN_AI_ASK,
  'common.tutorial': EN_COMMON_TUTORIAL,
  'settings.learn': EN_SETTINGS_LEARN,
  'office.project-health': EN_OFFICE_PROJECT_HEALTH,
  'money.co-proof': EN_MONEY_CO_PROOF,
  'office.client-messages': EN_OFFICE_CLIENT_MESSAGES,
  'office.ny-contract': EN_OFFICE_NY_CONTRACT,
  'money.cost-xray': EN_MONEY_COST_XRAY,
  'office.job-facts': EN_OFFICE_JOB_FACTS,
  'schedule.lateness': EN_SCHEDULE_LATENESS,
  'field.punch-seal': EN_FIELD_PUNCH_SEAL,
  'office.permit-path': EN_OFFICE_PERMIT_PATH,
  'office.whoson': EN_OFFICE_WHOSON,
  'office.protect': EN_OFFICE_PROTECT,
  'office.manage-sub': EN_OFFICE_MANAGE_SUB,
  'office.code-flags': EN_OFFICE_CODE_FLAGS,
  'office.first-job': EN_OFFICE_FIRST_JOB,
  'office.room-scan': EN_OFFICE_ROOM_SCAN,
  'office.living-model': EN_OFFICE_LIVING_MODEL,
  'office.living-model-phone': EN_OFFICE_LIVING_MODEL_PHONE,
  'office.proof-pack': EN_OFFICE_PROOF_PACK,
  'office.scan-clearance': EN_OFFICE_SCAN_CLEARANCE,
  'office.notices': EN_OFFICE_NOTICES,
  'office.deliveries-schedule': EN_OFFICE_DELIVERIES_SCHEDULE,
};

export { EN_SEED, EN_UNASSIGNED };

export const EN_CATALOG: EnCatalog = {
  ...EN_SEED,
  ...Object.assign({}, ...Object.values(EN_SHARDS)),
  ...EN_UNASSIGNED,
};
