// i18n/catalog/es/ai.ts — Spanish, area "ai". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_AI: EsCatalog = {
  "ai.label.draftCheck": { s: "Borrador de IA — revísalo antes de enviar", src: "dd183ae5" },
  "ai.label.translatedFromEnglish": { s: "Traducido del inglés por IA", src: "ce4c17f8" },
  "ai.label.translatedFromSpanish": { s: "Traducido del español por IA", src: "97fd2e50" },
  "ai.label.showOriginal": { s: "Ver original", src: "b9aefad3" },
  "ai.label.estimatedNoLearned": { s: "Estimado — todavía sin datos aprendidos", src: "24fe1fef" },
};
