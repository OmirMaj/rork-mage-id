// i18n/catalog/es/field/dfr.ts — Spanish for NEW keys under `field.dfr.` (surface field.daily-report).
// Owner: W2 ESTOOLS fills the DailyLogCard keys; W3 ESDFR the rest. Follows docs/i18n-glossary-es.md (tú in-app; cuadrilla; reporte diario).
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. Seed keys under `field.` stay in shared.ts. A `.legal.` key gets NO
// entry here unless a human legal translator wrote it (note LEGAL_PINNED + reviewedBy).

import type { EsCatalog } from '../../../types';

export const ES_FIELD_DFR: EsCatalog = {
  // components/home/DailyLogCard.tsx (W2 ESTOOLS). Reviewed-draft until the bilingual reviewer signs off.
  "field.dfr.card.daysLogged": { s: "{filed} de {expected} días hábiles con reporte", src: "4dde8734" },
  "field.dfr.card.daysMissing": { s: { one: "Falta {count} día", other: "Faltan {count} días" }, src: "67687230" },
  "field.dfr.card.eyebrow": { s: "Reporte diario · últimos 30 días", src: "972d5591", note: "Card eyebrow, uppercased by style. Never \"bitácora\"." },
  "field.dfr.card.gapManyProjects": { s: "{projects} proyectos tienen huecos en los últimos 30 días: {days} días hábiles entre todos.", src: "b6b79707" },
  "field.dfr.card.gapOneProject": { s: { one: "A {count} día hábil de los últimos 30 le falta el reporte diario.", other: "A {count} días hábiles de los últimos 30 les falta el reporte diario." }, src: "f8e6eb24" },
  "field.dfr.card.more": { s: "+{overflow} más", src: "3e2a5705" },
  "field.dfr.card.noWorkDays": { s: "{days} sin trabajo en la obra", src: "64063f8c" },
  "field.dfr.card.openDailyReport": { s: "Abrir el reporte diario.", src: "72190a14" },
  "field.dfr.card.openReportFor": { s: "Abrir un reporte del {day}.", src: "c182948b" },
  "field.dfr.card.openVoiceNote": { s: "Abrir la nota de voz para terminarla.", src: "434e90ad" },
  "field.dfr.card.opensDay": { s: "abre el {day}", src: "5dd76d16" },
  "field.dfr.card.owedToday": { s: { one: "A {count} proyecto le falta el reporte diario de hoy.", other: "A {count} proyectos les falta el reporte diario de hoy." }, src: "5253eb1e" },
  "field.dfr.card.rowA11y": { s: "{name}: {state}. {logged}. {action}", src: "01aac03b" },
  "field.dfr.card.todayNotFiled": { s: "Hoy sin reporte", src: "5a9e7e05" },
  "field.dfr.card.voiceToFinish": { s: { one: "{count} proyecto tiene una nota de voz por terminar.", other: "{count} proyectos tienen una nota de voz por terminar." }, src: "b67a3b06" },
  "field.dfr.card.voiceToday": { s: { one: "{count} proyecto solo tiene una nota de voz de hoy. Termínala para registrar el día.", other: "{count} proyectos solo tienen una nota de voz de hoy. Termínalas para registrar el día." }, src: "175c6f76" },
  "field.dfr.card.why": { s: "Un reporte diario completo sirve más que uno muy detallado. Si no pasó nada en la obra, registra el día y dilo: eso también cuenta. Toca un proyecto con un hueco para registrar su día faltante más reciente, con la fecha del día que cubre.", src: "8475506a" },
};
