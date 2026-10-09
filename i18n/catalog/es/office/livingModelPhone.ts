// i18n/catalog/es/office/livingModelPhone.ts — Spanish for the keys under `office.livingModelPhone.` (surface office.living-model-phone).
// Owner: lane PHONE3D. Follows docs/i18n-glossary-es.md (tú in-app) and the
// words of i18n/catalog/es/office/livingModel.ts: vista 3D, repetición, cuarto,
// se dibuja plana.
// DRAFT: written by the build lane, not yet read by a bilingual construction person.
// HONESTY: no entry may say how right the model is (scripts/validate-phone-3d.ts
// reads this file against the same list the Living Model holds).
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src`; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_LIVING_MODEL_PHONE: EsCatalog = {
  "office.livingModelPhone.couldNotStartBody": { s: "La vista 3D no pudo iniciar en este teléfono. La misma repetición se dibuja plana abajo.", src: "d6d7f387" },
  "office.livingModelPhone.modelA11yBody": { s: "Modelo esquemático del trabajo en 3D. La lista de cuartos de abajo lee cada cuarto.", src: "430df9ab" },
  "office.livingModelPhone.needsNewVersionBody": { s: "La vista 3D necesita la versión más nueva de la app.", src: "2766902b" },
  "office.livingModelPhone.qualityHelpSub": { s: "Solo para el dueño. Alta dibuja cada píxel de la pantalla y usa más batería", src: "c1d30cef" },
  "office.livingModelPhone.qualityHighLabel": { s: "Alta", src: "be0a061d" },
  "office.livingModelPhone.qualityLabel": { s: "Calidad 3D", src: "33584753" },
  "office.livingModelPhone.qualityStandardLabel": { s: "Estándar", src: "0016ab68" },
  "office.livingModelPhone.touchHelpSub": { s: "Arrastra para girar. Usa dos dedos para mover. Pellizca para acercar. Toca un cuarto para elegirlo", src: "16129bd2" },
};
