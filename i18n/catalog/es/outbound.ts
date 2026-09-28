// i18n/catalog/es/outbound.ts — Spanish, area "outbound". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_OUTBOUND: EsCatalog = {
  "outbound.lineup.subject": { s: "Plan para mañana — {project}", src: "5211a002", note: "SMS/share heading to a sub" },
  "outbound.lineup.confirmAsk": { s: "Por favor confirme que puede estar ahí.", src: "f8306535", note: "usted" },
  // W3 ESSHELL (surface field.lineup): each sub's lineup text, in the SUB's language. usted. Reviewed-draft.
  "outbound.lineup.accessBooked": { s: "{kind}: reserva confirmada, {slot}", src: "f2c2eeaf", note: "SMS to a sub, usted" },
  "outbound.lineup.accessBookedRef": { s: "{kind}: reserva confirmada, {slot}, ref. {ref}", src: "d067db7d", note: "SMS to a sub, usted" },
  "outbound.lineup.accessLine": { s: "Acceso: {items}.", src: "3465c2b9", note: "SMS to a sub, usted" },
  "outbound.lineup.accessRequested": { s: "{kind}: solicitud hecha; el edificio aún no la confirma", src: "67b1cc29", note: "SMS to a sub, usted" },
  "outbound.lineup.accessRequestedWindow": { s: "{kind} {window}: solicitud hecha; el edificio aún no la confirma", src: "e6df9fb3", note: "SMS to a sub, usted" },
  "outbound.lineup.deliveriesLine": { s: "Entregas: {items}.", src: "ce643f6f", note: "SMS to a sub, usted" },
  "outbound.lineup.deliveryFallback": { s: "Entrega", src: "48f38d75", note: "SMS to a sub, usted" },
  "outbound.lineup.deliveryFrom": { s: "{what} de {supplier}", src: "13bb382b", note: "SMS to a sub, usted" },
  "outbound.lineup.deliveryText": { s: "{item}, {when}", src: "1e7bec08", note: "SMS to a sub, usted" },
  "outbound.lineup.deliveryUnconfirmed": { s: "{item}, {when} (sin confirmar por el proveedor)", src: "072bc4f1", note: "SMS to a sub, usted" },
  "outbound.lineup.inspectionFallback": { s: "Inspección", src: "9cf74fb3", note: "SMS to a sub, usted" },
  "outbound.lineup.inspectionNamed": { s: "Inspección de {name}", src: "d5a181d6", note: "SMS to a sub, usted" },
  "outbound.lineup.inspectionText": { s: "{label}: {time}", src: "0c9fd8c6", note: "SMS to a sub, usted" },
  "outbound.lineup.inspectionsLine": { s: "Inspecciones: {items}.", src: "4ab05cc2", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.afterHours": { s: "trabajo fuera de horario", src: "23a86ad4", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.badging": { s: "acreditación", src: "84f1cc13", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.dock": { s: "muelle de carga", src: "5f9af2ca", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.freightElevator": { s: "elevador de carga", src: "220d2506", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.hotWork": { s: "permiso de trabajo en caliente", src: "89899300", note: "SMS to a sub, usted" },
  "outbound.lineup.kind.shutdown": { s: "corte del sistema", src: "5bc21abe", note: "SMS to a sub, usted" },
  "outbound.lineup.lead": { s: "{sub}: {day} en {place}: {work}.", src: "56738bb0", note: "SMS to a sub, usted" },
  "outbound.lineup.milestone": { s: "{task} (hito)", src: "b2252920", note: "SMS to a sub, usted" },
  "outbound.lineup.more": { s: "+{count} más", src: "1b6a0c82", note: "SMS to a sub, usted" },
  "outbound.lineup.noTasks": { s: "no tiene tareas en el cronograma", src: "8a90df53", note: "SMS to a sub, usted" },
  "outbound.lineup.replyConfirm": { s: "Responda para confirmar que estará ahí.", src: "b724d767", note: "SMS to a sub, usted" },
  "outbound.lineup.timeNotSet": { s: "hora sin fijar", src: "adb417ad", note: "SMS to a sub, usted" },
  "outbound.lineup.timeNotSetParens": { s: "({time})", src: "b3730353", note: "SMS to a sub, usted" },
  "outbound.lineup.window": { s: "horario {window}", src: "4c89630f", note: "SMS to a sub, usted" },
};
