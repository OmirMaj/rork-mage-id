// i18n/catalog/es/office/manageSub.ts — Spanish for the keys under `office.manageSub.` (surface office.manage-sub).
// Owner: lane WEBCANCEL (2026-10-09). The Manage Subscription row in Settings
// and on the paywall: where a plan is changed or cancelled, and the date
// RevenueCat reports. Like the English, no line says a plan was cancelled and
// none promises a time.
// `src` = fnv1a32 of the English each entry translates (i18n/hash.ts): the stale
// check. When the English changes, re-translate and update `src` from the
// validator's stale list; never just bump the hash.

import type { EsCatalog } from '../../../types';

export const ES_OFFICE_MANAGE_SUB: EsCatalog = {
  "office.manageSub.apple.body": { s: "Te suscribiste en iPhone. Adminístrala en la configuración de tu cuenta de Apple.", src: "a632d830" },
  "office.manageSub.apple.downgrade": { s: "Te suscribiste en iPhone. Para pasar a Free, cancela la suscripción en la configuración de tu cuenta de Apple. No se borra nada.", src: "b2231a28" },
  "office.manageSub.apple.fallback": { s: "En tu iPhone, abre la app Configuración, toca tu nombre y luego Suscripciones.", src: "7ec2ca27" },
  "office.manageSub.byHand.body": { s: "Escribe a help@mageid.app para cambiarlo o cancelarlo. No se borra nada.", src: "e30e18c0" },
  "office.manageSub.byHand.downgrade": { s: "MAGE ID activó tu plan, así que no hay una suscripción de tienda que cancelar. Escribe a help@mageid.app para pasar a Free. No se borra nada.", src: "d287b354" },
  "office.manageSub.byHand.fallback": { s: "Escribe a help@mageid.app para cambiar o cancelar tu plan. No se borra nada.", src: "dac65c32" },
  "office.manageSub.byHand.label": { s: "MAGE ID Activó Tu Plan", src: "5429e817" },
  "office.manageSub.elsewhere.body": { s: "Este plan no se compró en este teléfono. Adminístralo donde te suscribiste.", src: "6ea43528" },
  "office.manageSub.elsewhere.downgrade": { s: "Este plan no se compró en este teléfono. Para pasar a Free, cancélalo donde te suscribiste. No se borra nada.", src: "c0d366ad" },
  "office.manageSub.elsewhereWeb.body": { s: "Te suscribiste en la app web. Adminístrala allí, en Configuración, Administrar Suscripción.", src: "898ca75b" },
  "office.manageSub.elsewhereWeb.downgrade": { s: "Te suscribiste en la app web. Para pasar a Free, cancela el plan allí, en Configuración, Administrar Suscripción. No se borra nada.", src: "aefc5e8b" },
  "office.manageSub.email.body": { s: "Para cambiar o cancelar tu plan, escribe a help@mageid.app.", src: "1342552c" },
  "office.manageSub.email.downgrade": { s: "Para pasar a Free, escribe a help@mageid.app. No se borra nada.", src: "7925d4fa" },
  "office.manageSub.endsOn": { s: "Termina el {date}", src: "3f432eb4" },
  "office.manageSub.google.body": { s: "Te suscribiste en Android. Adminístrala en tus suscripciones de Google Play.", src: "e9b52863" },
  "office.manageSub.google.downgrade": { s: "Te suscribiste en Android. Para pasar a Free, cancela la suscripción en Google Play. No se borra nada.", src: "13a5a602" },
  "office.manageSub.google.fallback": { s: "En tu teléfono Android, abre Google Play y luego Suscripciones.", src: "4f528b34" },
  "office.manageSub.label": { s: "Administrar Suscripción", src: "11820d57" },
  "office.manageSub.none.body": { s: "Esta cuenta no tiene una suscripción de pago.", src: "d4fdcac5" },
  "office.manageSub.none.downgrade": { s: "Esta cuenta no tiene una suscripción de pago, así que no hay nada que cancelar.", src: "9a397e57" },
  "office.manageSub.none.label": { s: "Sin Suscripción de Pago", src: "61efc225" },
  "office.manageSub.plan.downgrade": { s: "Tu plan {plan} no se puede cambiar desde esta pantalla. No se borra nada cuando termina un plan.", src: "800f8a44" },
  "office.manageSub.plan.label": { s: "Plan {plan}", src: "a5c3170f" },
  "office.manageSub.renewsOn": { s: "Se renueva el {date}", src: "2efcaeb0" },
  "office.manageSub.storeAndroid.body": { s: "Abre tus suscripciones de Google Play, donde puedes cambiar o cancelar tu plan.", src: "be7351c5" },
  "office.manageSub.storeAndroid.downgrade": { s: "Para pasar a Free, cancela tu suscripción en tus suscripciones de Google Play. Administrar Suscripción en esta pantalla las abre. No se borra nada.", src: "6fb29fce" },
  "office.manageSub.storeAndroid.fallback": { s: "Abre Google Play y luego Suscripciones para administrar tu plan de MAGE ID.", src: "46834882" },
  "office.manageSub.storeIos.body": { s: "Abre tus suscripciones del App Store, donde puedes cambiar o cancelar tu plan.", src: "2eea4bb6" },
  "office.manageSub.storeIos.downgrade": { s: "Para pasar a Free, cancela tu suscripción en tus suscripciones del App Store. Administrar Suscripción en esta pantalla las abre. No se borra nada.", src: "de359b87" },
  "office.manageSub.storeIos.fallback": { s: "Abre la app Configuración, toca tu nombre y luego Suscripciones para administrar tu plan de MAGE ID.", src: "19ad915d" },
  "office.manageSub.web.body": { s: "Abre tu página de facturación en una pestaña nueva, donde puedes cambiar o cancelar tu plan.", src: "60e00f63" },
  "office.manageSub.web.downgrade": { s: "Para pasar a Free, cancela tu plan en tu página de facturación. Administrar Suscripción en esta pantalla la abre. No se borra nada.", src: "bfa2fd62" },
  "office.manageSub.web.fallback": { s: "La página de facturación no se abrió. Para cambiar o cancelar tu plan, escribe a help@mageid.app.", src: "da147df7" },
};
