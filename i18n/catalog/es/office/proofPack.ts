// i18n/catalog/es/office/proofPack.ts — Spanish for the keys under `office.proofPack.` (surface office.proof-pack).
// Owner: lane PROOFPACK. Follows docs/i18n-glossary-es.md (tú in-app). Spanish
// labels are in sentence case, which is correct Spanish; only the English is
// written in Title Case. The package's Spanish name is "Paquete de respaldo de
// obra": a name, chosen so the word "prueba" (which claims more than the
// package shows) never appears.
// DRAFT: written by the build lane, not yet read by a bilingual construction
// person. The words to check first: huella (fingerprint), renuncia de gravamen
// (lien waiver), pendientes (punch items), boleta de campo (field ticket),
// solicitud de pago (pay application), registro (record), archivar (to put on file).
// HONESTY: no entry may say the work was checked, vouched for or promised, and
// none may promise anything about a bank, a lender, a surety or an insurer.
// scripts/validate-proof-pack.ts holds the banned Spanish forms.
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src` from the
// validator's stale list; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_PROOF_PACK: EsCatalog = {
  "office.proofPack.check.changedBody": { s: "La copia en este dispositivo da una huella distinta de la archivada. No es el paquete que se archivó.", src: "dad88837" },
  "office.proofPack.check.matchBody": { s: "La copia en este dispositivo da la misma huella que el servidor tiene archivada.", src: "4821caaa" },
  "office.proofPack.check.notCheckedBody": { s: "No se pudo contactar al servidor, así que este paquete no se revisó. Intenta otra vez cuando tengas señal.", src: "adced635" },
  "office.proofPack.check.notOnFileBody": { s: "No hay una huella archivada para este paquete, así que no se puede revisar.", src: "c7085ed0" },
  "office.proofPack.counts.headingLabel": { s: "Registros según cómo se guardan", src: "c6d41ddc" },
  "office.proofPack.create.creatingLabel": { s: "Haciendo el paquete", src: "a66e6737" },
  "office.proofPack.create.label": { s: "Crear y compartir", src: "c7619e3b" },
  "office.proofPack.entry.body": { s: "Un documento para este periodo de pago: lo que se cobró y los registros que MAGE ID guarda.", src: "7cdc254c" },
  "office.proofPack.entry.label": { s: "Armar paquete de respaldo de obra", src: "ebe318e7" },
  "office.proofPack.entry.ownerPreviewLabel": { s: "Vista previa del dueño", src: "4dc2d218" },
  "office.proofPack.fileCheck.changedBody": { s: "Este archivo no es el que MAGE ID archivó con huella. Se cambió, otro programa lo guardó de nuevo o es otro archivo.", src: "560ece92" },
  "office.proofPack.fileCheck.matchBody": { s: "Este archivo es el que MAGE ID archivó con huella. No difiere ni un byte.", src: "8a038be6" },
  "office.proofPack.fileCheck.nativeBody": { s: "La revisión de un archivo funciona en la app del teléfono.", src: "04138455" },
  "office.proofPack.fileCheck.notCheckedBody": { s: "No se pudo contactar al servidor, así que este archivo no se revisó. Intenta otra vez cuando tengas señal.", src: "b673c613" },
  "office.proofPack.fileCheck.notOnFileBody": { s: "No hay una huella de archivo para este paquete. Solo se toma cuando el paquete se hace en la app del teléfono.", src: "f4149580" },
  "office.proofPack.item.emptyKindBody": { s: "No hay ninguno de este periodo. El paquete lo dice.", src: "c83049f3" },
  "office.proofPack.item.includeA11yLabel": { s: "Incluir {name}", src: "1885d4f4" },
  "office.proofPack.item.includedCountBody": { s: "{included} de {total} incluidos.", src: "ca0bd3a4" },
  "office.proofPack.kind.changeOrderLabel": { s: "Órdenes de cambio", src: "c6ee7a3e" },
  "office.proofPack.kind.dailyReportLabel": { s: "Reportes diarios", src: "730e7ce9" },
  "office.proofPack.kind.fieldTicketLabel": { s: "Boletas de campo firmadas", src: "90770b78" },
  "office.proofPack.kind.inspectionLabel": { s: "Resultados de inspección", src: "73922761" },
  "office.proofPack.kind.lienWaiverLabel": { s: "Renuncias de gravamen", src: "a9d6067c" },
  "office.proofPack.kind.photoLabel": { s: "Fotos", src: "cde554d0" },
  "office.proofPack.kind.punchItemLabel": { s: "Pendientes", src: "6186cdf3" },
  "office.proofPack.kind.punchSealLabel": { s: "Lista final de pendientes sellada", src: "4adb4915" },
  "office.proofPack.language.englishLabel": { s: "Inglés", src: "1b9ae0bb" },
  "office.proofPack.language.headingLabel": { s: "Idioma del documento", src: "61e17c06" },
  "office.proofPack.language.spanishLabel": { s: "Español", src: "b819825b" },
  "office.proofPack.leftOut.manyBody": { s: "Dejaste fuera {n} registros. El paquete dirá que el contratista dejó fuera {n} registros.", src: "fa2399f8" },
  "office.proofPack.leftOut.noneBody": { s: "Todo está incluido. Apaga un registro para dejarlo fuera. El paquete dice cuántos se dejaron fuera.", src: "1137945a" },
  "office.proofPack.leftOut.oneBody": { s: "Dejaste fuera 1 registro. El paquete dirá que el contratista dejó fuera 1 registro.", src: "728d7636" },
  "office.proofPack.missing.loadingBody": { s: "Leyendo los registros de este periodo.", src: "afa24e5e" },
  "office.proofPack.missing.payBody": { s: "Ese documento de pago no está en este dispositivo. Ábrelo desde el proyecto e intenta otra vez.", src: "bef26bb2" },
  "office.proofPack.missing.periodBody": { s: "Este documento de pago no tiene fecha final, así que MAGE ID no puede saber qué registros le corresponden. Agrega la fecha e intenta otra vez.", src: "fb33abc5" },
  "office.proofPack.missing.retryLabel": { s: "Intentar otra vez", src: "f5b37c9a" },
  "office.proofPack.missing.roleErrorBody": { s: "No se pudo revisar tu acceso a este proyecto. Revisa tu señal e intenta otra vez.", src: "2e484901" },
  "office.proofPack.missing.seatBody": { s: "Solo el dueño del proyecto puede hacer un paquete de respaldo de obra. Lleva el nombre del cliente, la dirección y los montos.", src: "d1c8c956" },
  "office.proofPack.missing.waiversBody": { s: "Las renuncias de gravamen no se pudieron leer. El paquete dirá que esa parte no se revisó.", src: "a9a8de06" },
  "office.proofPack.open.headingLabel": { s: "Puntos abiertos", src: "2bf7b12d" },
  "office.proofPack.open.manyBody": { s: "El paquete enumera {n} cosas que un lector puede preguntar y que MAGE ID no guarda.", src: "990e6ad2" },
  "office.proofPack.open.oneBody": { s: "El paquete enumera 1 cosa que un lector puede preguntar y que MAGE ID no guarda.", src: "9f2ce4aa" },
  "office.proofPack.pay.billedLabel": { s: "Cobrado en este periodo", src: "e5acbcd4" },
  "office.proofPack.pay.invoiceLabel": { s: "Factura {n}", src: "ad366030" },
  "office.proofPack.pay.payAppLabel": { s: "Solicitud de pago {n}", src: "b2ac8877" },
  "office.proofPack.period.headingLabel": { s: "Periodo de pago", src: "beb84c02" },
  "office.proofPack.period.openBody": { s: "Hasta {to}. No hay un documento de pago anterior, así que el periodo no tiene primer día.", src: "5690fc66" },
  "office.proofPack.period.rangeBody": { s: "{from} a {to}", src: "7385f2d1" },
  "office.proofPack.photo.gpsBody": { s: "Hora del reloj del teléfono, lugar del GPS del teléfono.", src: "5ce3934b" },
  "office.proofPack.photo.noneBody": { s: "Hora del reloj del teléfono, sin lugar anotado.", src: "59c05067" },
  "office.proofPack.photo.typedBody": { s: "Hora del reloj del teléfono, lugar escrito a mano.", src: "2592780b" },
  "office.proofPack.privacy.body": { s: "El paquete lleva el nombre de tu cliente, la dirección, los montos y fotos de la propiedad. Solo va a donde tú lo envíes. MAGE ID guarda una sola cosa en su servidor: la huella, sin monto, nombre ni dirección. Nada se envía a un modelo de IA.", src: "2a2e489e" },
  "office.proofPack.privacy.headingLabel": { s: "Lo que sale de este dispositivo", src: "7bd6344f" },
  "office.proofPack.privacy.peopleBody": { s: "Los trabajadores aparecen como oficios y número de personas. El paquete no lleva el nombre, el teléfono, la identificación ni la tarifa de ningún trabajador. Una firma conserva el nombre de quien firmó.", src: "0287d4d8" },
  "office.proofPack.result.failedBody": { s: "No se pudo hacer el paquete. No se envió nada. Intenta otra vez.", src: "62a1c949" },
  "office.proofPack.result.notKeptBody": { s: "La copia no se pudo guardar en este dispositivo, así que este paquete no se puede revisar aquí otra vez.", src: "56b0fe88" },
  "office.proofPack.result.notOnFileBody": { s: "El paquete se hizo, pero su huella no se pudo archivar. El documento dice que no se podrá revisar después.", src: "cdef8bfc" },
  "office.proofPack.result.onFileBody": { s: "Paquete hecho. Su huella está archivada. Código de revisión {code}.", src: "4db4dbf1" },
  "office.proofPack.saved.checkAgainLabel": { s: "Revisar huella", src: "97429f9b" },
  "office.proofPack.saved.checkCodeLabel": { s: "Código de revisión", src: "5cdaf394" },
  "office.proofPack.saved.checkFileLabel": { s: "Revisar un archivo", src: "11210a12" },
  "office.proofPack.saved.emptyBody": { s: "No se ha hecho ningún paquete en este dispositivo para este proyecto.", src: "dd0ce512" },
  "office.proofPack.saved.fingerprintLabel": { s: "Huella", src: "1df4441b" },
  "office.proofPack.saved.headingLabel": { s: "Paquetes hechos en este dispositivo", src: "2ee5c6ec" },
  "office.proofPack.saved.rowLabel": { s: "Código de revisión {code}", src: "87ca62cb" },
  "office.proofPack.screen.backLabel": { s: "Atrás", src: "c2954bc2" },
  "office.proofPack.screen.titleLabel": { s: "Paquete de respaldo de obra", src: "6db6c683" },
  "office.proofPack.screen.whatThisIsBody": { s: "Este es un registro de lo que MAGE ID guarda de este periodo de pago.", src: "99aa32a5" },
  "office.proofPack.screen.whatThisIsNotBody": { s: "No es una inspección, un avalúo ni una certificación de la obra.", src: "7b6145e5" },
  "office.proofPack.strength.lockedBody": { s: "La base de datos rechaza cambios al contenido del registro a partir de cierto punto. No se guarda firma con hora del servidor ni huella.", src: "46033c42" },
  "office.proofPack.strength.lockedLabel": { s: "Bloqueado", src: "406a5eb3" },
  "office.proofPack.strength.recordedBody": { s: "Guardado en la app con la hora del reloj del teléfono. La cuenta que lo hizo puede cambiarlo después y no se guarda historial de cambios.", src: "07c1146e" },
  "office.proofPack.strength.recordedLabel": { s: "Registrado", src: "aaec27dd" },
  "office.proofPack.strength.sealedBody": { s: "El servidor puso la hora, guardó una huella del registro y la base de datos rechaza todo cambio posterior.", src: "872790a7" },
  "office.proofPack.strength.sealedLabel": { s: "Sellado", src: "0feb83c1" },
  "office.proofPack.strength.signedBody": { s: "Una persona con nombre firmó, el servidor puso la hora de la firma y la base de datos conserva la firma tal como se firmó.", src: "28f93e3b" },
  "office.proofPack.strength.signedLabel": { s: "Firmado", src: "27c3ab35" },
  "office.proofPack.strength.statedBody": { s: "Escrito por el contratista, sin nada más que lo respalde.", src: "68d419e4" },
  "office.proofPack.strength.statedLabel": { s: "Declarado", src: "0d87a8f6" },
};
