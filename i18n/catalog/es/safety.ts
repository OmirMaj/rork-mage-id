// i18n/catalog/es/safety.ts — Spanish, area "safety". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_SAFETY: EsCatalog = {
  "safety.title": { s: "Seguridad", src: "b04d1727" },
  "safety.jha.title": { s: "Análisis de riesgos del trabajo (JHA)", src: "cbd0c522" },
  "safety.jha.hazard": { s: "Peligro", src: "bdd9f28d" },
  "safety.jha.control": { s: "Medida de control", src: "8347bf3e" },
  "safety.jha.addHazard": { s: "Agregar peligro", src: "27c19d4c" },
  "safety.toolbox.title": { s: "Charla de seguridad", src: "08e1a8b6" },
  "safety.toolbox.presenter": { s: "Presentador", src: "2b961f3b" },
  "safety.toolbox.attendees": { s: "Asistentes", src: "3c81ce60" },
  "safety.toolbox.attendeeCount": { s: { one: "{count} asistente", other: "{count} asistentes" }, src: "2c89fbf0" },
  "safety.ppe": { s: "EPP", src: "9b35f758" },
  "safety.fallProtection": { s: "Protección contra caídas", src: "faa3006b" },
  "safety.competentPerson": { s: "Persona competente", src: "4635c99d" },
  "safety.lockoutTagout": { s: "Bloqueo y etiquetado", src: "3b0206e3" },
  "safety.incident.title": { s: "Incidente", src: "89aa0b87" },
  "safety.incident.injury": { s: "Lesión", src: "293d0d86" },
  "safety.incident.nearMiss": { s: "Casi accidente", src: "04d19db1" },
  "safety.incident.firstAid": { s: "Primeros auxilios", src: "3b0d73cb" },
  "safety.incident.correctiveAction": { s: "Acción correctiva", src: "c541e00d" },
  "safety.incident.investigating": { s: "En investigación", src: "924ba467" },
  "safety.cert.status.current": { s: "Vigente", src: "b3d0c37a" },
  "safety.cert.status.expiringSoon": { s: "Por vencer", src: "0639c31c" },
  "safety.cert.status.expired": { s: "Vencida", src: "bca9f3d2", note: "Agrees with \"certificación\" (feminine)" },
};
