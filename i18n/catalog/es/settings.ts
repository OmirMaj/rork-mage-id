// i18n/catalog/es/settings.ts — Spanish, area "settings". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_SETTINGS: EsCatalog = {
  "settings.language.rowLabel": { s: "Idioma / Language", src: "39edb031", note: "Settings row. Bilingual on purpose so a Spanish speaker stuck in English can find it." },
  "settings.language.title": { s: "Idioma", src: "9a73db9b", note: "Screen title" },
  "settings.language.eyebrow": { s: "Pantalla", src: "5a05d9b5", note: "Eyebrow above the screen title" },
  "settings.language.heading": { s: "Idioma de la app", src: "b86ed10e" },
  "settings.language.subtitle": { s: "Elige el idioma en que MAGE ID te habla en este dispositivo. Cambia al instante. Las personas con las que trabajas conservan su propio idioma.", src: "3b02e110" },
  "settings.language.outboundNote": { s: "Los mensajes, correos y portales que envías salen en el idioma de cada persona, no en el tuyo.", src: "d11b13e1" },
  "settings.language.partialNote": { s: "El español se está agregando pantalla por pantalla. Lo que aún no está traducido aparece en inglés.", src: "dcc9ef33" },
  "settings.language.pseudoLabel": { s: "Pseudolocalización (desarrollador)", src: "94cd04d9", note: "Dev builds only" },
  "settings.language.pseudoHelper": { s: "Acentúa cada texto traducido y lo alarga un 35%. El texto normal que quede en pantalla nunca se tradujo.", src: "e388fc85", note: "Dev builds only" },
  "settings.language.a11yHint": { s: "Abre el selector de idioma", src: "7d9f4d2d" },
};
