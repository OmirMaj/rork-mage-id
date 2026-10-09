// i18n/catalog/es/office/codeFlags.ts — Spanish for the keys under `office.codeFlags.` (surface office.code-flags).
// Owner: lane CODEFLAGS. Follows docs/i18n-glossary-es.md (tú in-app; permiso,
// inspección, renglón for a line, estimado, plomería, subcontratista). Spanish
// labels are in sentence case, which is correct Spanish; only the English is
// written in Title Case. "Aviso" is the word for a flag: a note, not an alarm.
// The trigger words printed after "Estas palabras" are the rule table's own
// words: English ones in English, Spanish ones (utils/codeFlags/rules `es`) in Spanish.
// DRAFT: written by the build lane, not yet read by a bilingual construction
// person. The trade words to check first: recalce (underpinning), bajante
// (stack), zapata (footing), vigueta (joist), vano (opening), tiro (flue),
// gestor de permisos (expediter), enmienda al permiso (permit amendment),
// tabique (partition), distribución (layout), trámite (a filing).
// HONESTY: no entry may say a thing is in order, allowed or mandatory.
// scripts/validate-code-flags.ts holds the banned Spanish forms.
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src` from the
// validator's stale list; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_CODE_FLAGS: EsCatalog = {
  "office.codeFlags.age.built1987Body": { s: "Consta como construido en 1987. La regla depende de si el permiso de obra nueva se emitió antes del 1 de abril de 1987.", src: "1c050502" },
  "office.codeFlags.age.builtBody": { s: "Consta como construido en {year}.", src: "e38cccc6" },
  "office.codeFlags.age.marylandLeadBody": { s: "Maryland tiene su propia ley de plomo para viviendas en renta construidas antes de 1978. El dueño registra la vivienda ante el estado y guarda un certificado de inspección de plomo por cada inquilino nuevo, salvo que la vivienda esté certificada como libre de plomo.", src: "09d671e7" },
  "office.codeFlags.age.notCheckedBody": { s: "El año de construcción no consta en este proyecto, así que no se revisaron las reglas de plomo y asbesto.", src: "1bd63c40" },
  "office.codeFlags.chip.ageA11yBody": { s: "Revisa las reglas por la edad del edificio. Abre el motivo.", src: "08233a0e" },
  "office.codeFlags.chip.ageLabel": { s: "Revisa las reglas por edad del edificio", src: "97fc5a34" },
  "office.codeFlags.chip.permitA11yBody": { s: "Puede necesitar una enmienda al permiso o una inspección. Abre el motivo.", src: "99ea707f" },
  "office.codeFlags.chip.permitLabel": { s: "Puede necesitar una enmienda al permiso o una inspección", src: "abe87bc7" },
  "office.codeFlags.family.asbestosAge.nameLabel": { s: "Revisión de asbesto en un edificio antiguo de la ciudad de Nueva York", src: "1ed6500b" },
  "office.codeFlags.family.asbestosAge.why": { s: "La ciudad de Nueva York tiene reglas de asbesto para trabajos con permiso en edificios anteriores al 1 de abril de 1987. Es común que una investigación de asbesto, en el formulario ACP-5, vaya antes del permiso. MAGE ID no sabe si este edificio tiene asbesto.", src: "1b6bc5c9" },
  "office.codeFlags.family.changeOfUse.nameLabel": { s: "Cambio de uso u ocupación", src: "ab301b03" },
  "office.codeFlags.family.changeOfUse.why": { s: "Este trabajo convierte un espacio en algo que no era. Un garaje se vuelve cuarto, un sótano se vuelve apartamento, una tienda se vuelve restaurante, o se agrega una recámara o una vivienda. Eso suele cambiar las reglas que aplican al edificio, y puede cambiar el Certificado de Ocupación.", src: "ddc70ddc" },
  "office.codeFlags.family.decksStairs.nameLabel": { s: "Terrazas, escaleras, barandales y pasamanos", src: "6a8c86bd" },
  "office.codeFlags.family.decksStairs.why": { s: "Las terrazas, porches, escaleras, barandales y pasamanos nuevos o reconstruidos suelen hacerse con permiso y con inspección. Es común que se revise cómo se une la terraza a la casa. También la altura y las aberturas del barandal.", src: "7df5db44" },
  "office.codeFlags.family.egress.nameLabel": { s: "Salidas y rutas de salida", src: "67061c19" },
  "office.codeFlags.family.egress.why": { s: "El trabajo en puertas de salida, escaleras de salida, ventanas de escape y luces de salida cambia la forma en que la gente sale de un edificio. Es común que el departamento de construcción lo revise en los planos del permiso y que el inspector lo mire.", src: "3a7b08bb" },
  "office.codeFlags.family.electrical.nameLabel": { s: "Servicio eléctrico, tableros y cargas nuevas grandes", src: "e64f95cb" },
  "office.codeFlags.family.electrical.why": { s: "Un servicio nuevo o más grande, un cambio de tablero, circuitos nuevos y cargas nuevas grandes suelen hacerse con permiso eléctrico y con inspección. Un cargador de auto y una bomba de calor son cargas nuevas grandes. La compañía de luz puede tener sus propios pasos para un cambio de servicio.", src: "d860c557" },
  "office.codeFlags.family.energyTests.nameLabel": { s: "Pruebas del código de energía", src: "3bf8c8ab" },
  "office.codeFlags.family.energyTests.why": { s: "Hay tres cosas que es común que se pidan con el permiso o en la inspección final. Son la prueba de hermeticidad con ventilador en la puerta, la prueba de fugas en ductos y el cálculo de carga de calefacción y enfriamiento. Un renglón para una de ellas casi siempre significa que un inspector va a querer ver el resultado.", src: "97fbb41d" },
  "office.codeFlags.family.fireProtection.nameLabel": { s: "Rociadores, alarmas y supresión en campanas", src: "610b6008" },
  "office.codeFlags.family.fireProtection.why": { s: "El trabajo de rociadores, alarma contra incendios y supresión en campanas de cocina suele tramitarse y probarse por separado, muchas veces con el departamento de bomberos. Mover aunque sea unos cuantos rociadores puede traer ese trámite.", src: "3795db27" },
  "office.codeFlags.family.fireRating.nameLabel": { s: "Muros, puertas y techos con resistencia al fuego", src: "b1870333" },
  "office.codeFlags.family.fireRating.why": { s: "Un muro, una puerta o un techo con resistencia al fuego se construye como un conjunto probado. Es común que cambiarlo, o cruzarlo con un tubo, un ducto o un cable, se revise en un permiso. Es común que se mire antes de taparlo.", src: "a06168d1" },
  "office.codeFlags.family.gas.nameLabel": { s: "Tubería de gas y aparatos de gas", src: "aeeed1ab" },
  "office.codeFlags.family.gas.why": { s: "La tubería de gas nueva o modificada y los aparatos de gas suelen hacerse con permiso, por un plomero o gasista con licencia, con una prueba de presión. La compañía de gas puede tener sus propios pasos.", src: "f9ebc31f" },
  "office.codeFlags.family.layoutChange.nameLabel": { s: "Cambios en la distribución de los cuartos", src: "92fafd89" },
  "office.codeFlags.family.layoutChange.nycWhy": { s: "Quitar, agregar o mover una pared o un tabique cambia la distribución de los cuartos. En la ciudad de Nueva York, cambiar la distribución de los cuartos comúnmente implica un trámite ante el Departamento de Edificios.", src: "c964fb62" },
  "office.codeFlags.family.layoutChange.why": { s: "Quitar, agregar o mover una pared o un tabique cambia la distribución de los cuartos. Es común que los departamentos de edificios revisen un cambio de distribución en un permiso.", src: "0060d32a" },
  "office.codeFlags.family.leadAge.nameLabel": { s: "Trabajo seguro con plomo en una vivienda antigua", src: "33bf7777" },
  "office.codeFlags.family.leadAge.why": { s: "Parte de este trabajo toca superficies pintadas en una vivienda que consta como construida antes de 1978. Las reglas federales de trabajo seguro con plomo cubren las viviendas construidas antes de 1978 cuando el trabajo altera la pintura. Los trabajos pequeños y los edificios con prueba de estar libres de plomo pueden quedar exentos. MAGE ID no sabe si este edificio tiene pintura con plomo.", src: "9dfa3371" },
  "office.codeFlags.family.mechanical.nameLabel": { s: "Calefacción, enfriamiento, ventilación y salida de gases", src: "5208b3df" },
  "office.codeFlags.family.mechanical.why": { s: "Los equipos de calefacción y enfriamiento nuevos o reemplazados, los ductos, los extractores, las campanas, los tiros y los forros de chimenea suelen hacerse con permiso mecánico y con inspección. Cómo saca los gases un aparato reemplazado es una de las cosas que se suelen revisar.", src: "9bc9733d" },
  "office.codeFlags.family.plumbing.nameLabel": { s: "Plomería agregada o movida", src: "abc55f6f" },
  "office.codeFlags.family.plumbing.why": { s: "Agregar o mover un mueble sanitario, un desagüe, una bajante, un calentador de agua o la toma de agua o de drenaje suele hacerse con permiso de plomería. Es común que lo haga un plomero con licencia y que se inspeccione antes de cerrar los muros.", src: "f10ecb33" },
  "office.codeFlags.family.structural.nameLabel": { s: "Muros de carga, vigas y cimientos", src: "f42e33bf" },
  "office.codeFlags.family.structural.why": { s: "Este trabajo carga el peso del edificio: muros de carga, vigas, viguetas, zapatas y vanos nuevos. Es común que lo diseñe un ingeniero o un arquitecto y que vaya en los planos del permiso. Es común que se inspeccione antes de taparlo.", src: "52420ca2" },
  "office.codeFlags.place.baltimoreBody": { s: "Esta dirección puede estar en la ciudad de Baltimore o en el condado de Baltimore, y son gobiernos separados. Agrega el condado o el código postal al proyecto para ver los enlaces locales.", src: "2aff901e" },
  "office.codeFlags.place.localBody": { s: "Los enlaces locales son de {place}.", src: "ed6d5747" },
  "office.codeFlags.place.noAddressBody": { s: "Este proyecto no tiene una dirección que MAGE ID pueda ubicar. Este es un aviso general, sin número de sección y sin enlace local.", src: "43a725b2" },
  "office.codeFlags.place.noProjectBody": { s: "Este estimado todavía no está en un proyecto. Este es un aviso general, sin número de sección y sin enlace local.", src: "099cedd4" },
  "office.codeFlags.place.otherBody": { s: "MAGE ID no tiene reglas locales para este lugar. Este es un aviso general, sin número de sección y sin enlace local. Pregunta en tu departamento de construcción.", src: "8d0c12e0" },
  "office.codeFlags.section.baltimoreCityUnderpinningBody": { s: "{label}. Trata de quién solicita el permiso para trabajos de recalce de cimientos.", src: "74795d4e" },
  "office.codeFlags.section.baltimoreCountyElectricalBody": { s: "{label} fija cuándo entra en vigor cada edición nueva del código eléctrico.", src: "cde508d7" },
  "office.codeFlags.section.noneBody": { s: "MAGE ID todavía no tiene un número de sección verificado para esto.", src: "ad9caf59" },
  "office.codeFlags.sheet.ageBody": { s: "Un solo aviso para toda la página, no uno en cada renglón.", src: "5ba165da" },
  "office.codeFlags.sheet.ageTitleLabel": { s: "Reglas por la edad del edificio", src: "1dc6a3b4" },
  "office.codeFlags.sheet.askBody": { s: "Abre Code Check para ver el detalle. Code Check tiene su propio límite diario según tu plan.", src: "e2e943a0" },
  "office.codeFlags.sheet.askLabel": { s: "Preguntar a Code Check", src: "c7eb6f93" },
  "office.codeFlags.sheet.booksBody": { s: "Familia de códigos: {books}.", src: "b01a3b94" },
  "office.codeFlags.sheet.hideBody": { s: "Se oculta en este dispositivo. Vuelve si el renglón cambia a otro tipo de trabajo.", src: "5cd4e724" },
  "office.codeFlags.sheet.hideLabel": { s: "Ocultar este aviso", src: "2f8e4787" },
  "office.codeFlags.sheet.hideNoProjectBody": { s: "Se oculta mientras este estimado esté abierto. No se guarda nada, porque el estimado todavía no está en un proyecto.", src: "7e039ded" },
  "office.codeFlags.sheet.introBody": { s: "Es común que este tipo de trabajo se revise en un permiso o lo mire un inspector. MAGE ID lo marca para que lo revises. Tú decides qué hacer.", src: "2c3004fc" },
  "office.codeFlags.sheet.neverBlocksBody": { s: "Un aviso nunca te impide guardar, enviar, firmar ni facturar.", src: "9cc2c7bd" },
  "office.codeFlags.sheet.noFlagBody": { s: "Un renglón sin aviso todavía puede necesitar un permiso o una inspección. Que no haya aviso no significa nada.", src: "43870887" },
  "office.codeFlags.sheet.privateBody": { s: "Este aviso no aparece en nada de lo que envías.", src: "7abb1128" },
  "office.codeFlags.sheet.sectionHeadingLabel": { s: "Número de sección", src: "e9efe4f5" },
  "office.codeFlags.sheet.sourcesHeadingLabel": { s: "Fuentes oficiales", src: "f8536942" },
  "office.codeFlags.sheet.standingNoteBody": { s: "No sustituye al código adoptado. Confírmalo con tu departamento de construcción.", src: "f2a79512" },
  "office.codeFlags.sheet.starterBody": { s: "Esta es una lista inicial de tipos de trabajo. Todavía no la ha revisado un arquitecto ni un gestor de permisos.", src: "ff20bd9f" },
  "office.codeFlags.sheet.titleLabel": { s: "Por qué este renglón tiene un aviso", src: "0bc42076" },
  "office.codeFlags.sheet.triggerHeadingLabel": { s: "Qué lo activó", src: "aaac8f83" },
  "office.codeFlags.sheet.whyHeadingLabel": { s: "Por qué se marca", src: "1f7889f8" },
  "office.codeFlags.source.checkedSub": { s: "Verificado el {date}", src: "458b0266" },
  "office.codeFlags.source.openFailedBody": { s: "Esa página no abrió. Intenta de nuevo en un momento.", src: "da81705e" },
  "office.codeFlags.trigger.categoryBody": { s: "Estas palabras en un renglón clasificado como {category}: {words}.", src: "50f3ff78" },
  "office.codeFlags.trigger.docWordsBody": { s: "Estas palabras, en {count} de los renglones: {words}.", src: "4c3dd0e7" },
  "office.codeFlags.trigger.permitFlagBody": { s: "Un renglón de aquí tiene un aviso de permiso, y la edad del edificio agrega este.", src: "2a4f40cf" },
  "office.codeFlags.trigger.wordsBody": { s: "Estas palabras en el renglón: {words}.", src: "ca6792ee" },
};
