// i18n/catalog/es/office/notices.ts — Spanish for the scan notice, keys under `office.notices.scan.` (surface office.notices).
// Owner: lane PROTECT-SERVER. Follows docs/i18n-glossary-es.md (tú in-app).
// DRAFT: written by the build lane, not yet read by a bilingual person.
// The re-acceptance sheet's keys (office.notices.legal.*) are NOT here and must
// not be added by a build lane: a `.legal.` key is translated only by a human
// legal translator (docs/I18N.md section 9), so that sheet shows English.
// The title and body below are what a Spanish-language phone shows and what its
// saved record's hash is taken over (utils/legalAcceptanceCore
// SCAN_ACK_TEXT_SHA256_ES, pinned by scripts/validate-legal-acceptance.ts):
// change them and that hash together.
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src` from the
// validator's stale list; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_NOTICES: EsCatalog = {
  "office.notices.scan.ackLabel": { s: "Entiendo", src: "725e0e9e" },
  "office.notices.scan.body": { s: "Un escaneo es una primera medida. Puede variar una pulgada o más. Verifica antes de pedir, cortar, cotizar o construir con él.", src: "1226e350" },
  "office.notices.scan.title": { s: "Antes de confiar en un escaneo", src: "2576ed7e" },
};
