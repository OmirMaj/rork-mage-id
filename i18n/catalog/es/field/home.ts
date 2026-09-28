// i18n/catalog/es/field/home.ts — Spanish for NEW keys under `field.home.` (surface field.home).
// Owner: W3 ESSHELL. Follows docs/i18n-glossary-es.md (tú in-app; cuadrilla; reporte diario).
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. Seed keys under `field.` stay in shared.ts. A `.legal.` key gets NO
// entry here unless a human legal translator wrote it (note LEGAL_PINNED + reviewedBy).

import type { EsCatalog } from '../../../types';

export const ES_FIELD_HOME: EsCatalog = {
  // W3 ESSHELL: Home's TODAY ON SITE rows and the quick field update. Reviewed-draft.
  "field.home.moreOnSite": { s: "+{todayOnSiteHidden} más en obra hoy", src: "4fec33ef" },
  "field.home.moreOnSiteA11y": { s: {one: "{count} proyecto más en obra hoy. Abre el resumen.", other: "{count} proyectos más en obra hoy. Abre el resumen."}, src: "e3220114" },
  "field.home.moreTasks": { s: "+{count} más", src: "1b6a0c82" },
  "field.home.qfu.inProgress": { s: "{task} → en proceso", src: "95d28ee6" },
  "field.home.qfu.issueLogged": { s: "Se registró un problema en {task}", src: "08ce1602" },
  "field.home.qfu.markedComplete": { s: "Se marcó como terminada la tarea {task}", src: "15d7424d" },
  "field.home.qfu.noSchedule": { s: "Este proyecto no tiene cronograma.", src: "872a6691" },
  "field.home.qfu.noteAdded": { s: "Se agregó una nota a {task}", src: "0ca6615f" },
  "field.home.qfu.pickProject": { s: "Primero elige un proyecto con cronograma.", src: "b2128e12" },
  "field.home.qfu.placeholder": { s: "p. ej., \"drywall terminado piso 3\" o \"framing 80%\"", src: "c0e4fc0d" },
  "field.home.qfu.project": { s: "Proyecto", src: "7b5fea5e" },
  "field.home.qfu.taskCount": { s: {one: "{count} tarea", other: "{count} tareas"}, src: "23143e62" },
  "field.home.qfu.taskGone": { s: "No se guardó: {task} ya no está en este cronograma. Desliza hacia abajo para actualizar e inténtalo de nuevo.", src: "61dc514d" },
  "field.home.qfu.title": { s: "Actualización rápida de campo", src: "675bdd79" },
  "field.home.qfu.viewOnly": { s: "No se guardó: solo tienes acceso de lectura a {project}. Pide al dueño del proyecto acceso de campo o de edición.", src: "7c3b6c5b" },
  "field.home.todayOnSite": { s: "HOY EN OBRA", src: "b7803d92" },
};
