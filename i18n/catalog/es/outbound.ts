// i18n/catalog/es/outbound.ts — Spanish, area "outbound". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_OUTBOUND: EsCatalog = {
  "outbound.lineup.subject": { s: "Plan para mañana — {project}", src: "5211a002", note: "SMS/share heading to a sub" },
  "outbound.lineup.confirmAsk": { s: "Por favor confirme que puede estar ahí.", src: "f8306535", note: "usted" },
};
