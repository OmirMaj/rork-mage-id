// i18n/catalog/es/common.ts — Spanish, area "common". Follows docs/i18n-glossary-es.md.
// `src` = fnv1a32 of the English each entry translates (stale check). Edit
// `s`; when the English changes, re-translate and update `src` from the
// validator's stale list — never just bump the hash.

import type { EsCatalog } from '../../types';

export const ES_COMMON: EsCatalog = {
  "common.action.save": { s: "Guardar", src: "4d2d5d68" },
  "common.action.cancel": { s: "Cancelar", src: "35afca3b" },
  "common.action.done": { s: "Listo", src: "8dd31791" },
  "common.action.next": { s: "Siguiente", src: "dce2da08" },
  "common.action.back": { s: "Atrás", src: "c2954bc2" },
  "common.action.add": { s: "Agregar", src: "9dc3aa14" },
  "common.action.edit": { s: "Editar", src: "c2c76cb1" },
  "common.action.delete": { s: "Eliminar", src: "5797ea6a" },
  "common.action.remove": { s: "Quitar", src: "21a5901d" },
  "common.action.send": { s: "Enviar", src: "f28e14cf" },
  "common.action.share": { s: "Compartir", src: "4f856dd8" },
  "common.action.approve": { s: "Aprobar", src: "e6edf55a" },
  "common.action.reject": { s: "Rechazar", src: "cb4844e6" },
  "common.action.sign": { s: "Firmar", src: "8f6340c4" },
  "common.action.search": { s: "Buscar", src: "c646a2c9" },
  "common.action.filter": { s: "Filtrar", src: "f4a9c097" },
  "common.action.sort": { s: "Ordenar", src: "8459a7f1" },
  "common.action.takePhoto": { s: "Tomar foto", src: "d520b6ea" },
  "common.action.upload": { s: "Subir", src: "826f7f7c" },
  "common.action.download": { s: "Descargar", src: "6964bb19" },
  "common.action.retry": { s: "Reintentar", src: "8036af59" },
  "common.action.undo": { s: "Deshacer", src: "71fd4acf" },
  "common.action.close": { s: "Cerrar", src: "cd86acc3" },
  "common.action.open": { s: "Abrir", src: "538b10e9" },
  "common.day.today": { s: "Hoy", src: "e7c0775e" },
  "common.day.tomorrow": { s: "Mañana", src: "4d56d846" },
  "common.day.yesterday": { s: "Ayer", src: "93ae68c7" },
  "common.sync.offlineSaved": { s: "Sin conexión — guardado en este teléfono, se sincroniza después", src: "9bfb1873" },
  "common.error.saveFailed": { s: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.", src: "4b67043f" },
  "common.count.items": { s: { one: "{count} elemento", other: "{count} elementos" }, src: "a03ee5c6" },
  "common.count.daysAgo": { s: { one: "hace {count} día", other: "hace {count} días" }, src: "db8ab0b6" },
};
