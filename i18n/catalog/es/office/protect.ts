// i18n/catalog/es/office/protect.ts — Spanish for the keys under `office.protect.` (surface office.protect).
// Owner: lane PROTECT-TEXT (2026-10-09). The agreement sentence above the
// sign-in buttons and the template notice a contractor reads where he edits a
// contract, proposal, lien waiver or AIA-style form.
// DRAFTS: these are legal notices and a legal translator has not read them.
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src` from the
// validator's stale list; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_PROTECT: EsCatalog = {
  "office.protect.agreeAnd": { s: "y la", src: "0f29c2a6" },
  "office.protect.agreeLead": { s: "Al continuar aceptas nuestros", src: "f95543cc" },
  "office.protect.privacyPolicy": { s: "Política de Privacidad", src: "2526541f" },
  "office.protect.templateNotice": { s: "Esta es una plantilla inicial, no asesoría legal. No está escrita para tu estado ni para tu trabajo. Pide a tu propio abogado que la revise antes de usarla.", src: "db4e35d9" },
  "office.protect.termsOfService": { s: "Términos de Servicio", src: "a96add92" },
};
