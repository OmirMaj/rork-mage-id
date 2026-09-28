// supabase/functions/_shared/replyLanguage.ts — the reply-language rule an AI
// relay appends to its system prompt when the caller asks for Spanish
// (docs/I18N.md §7).
//
// THE RULE: the reply LANGUAGE changes. Nothing else does — not grounding,
// not honesty, not schemas. JSON keys, enum values, IDs, numbers, money,
// dates, units, CSI codes, code citations, names and quoted evidence come
// back exactly as given, so client parsing, grounding chips, honesty labels
// and requireTier metering are untouched. Honesty/grounding LABELS are
// human-translated catalog strings in the app, never AI output.
//
// ENGLISH IS UNTOUCHED: replyLanguageRule() returns '' for anything but an
// explicit 'es' (including a missing or malformed `locale`), so an English
// request's system prompt is byte-identical to before.
//
// AI_GLOSSARY_ES is a COPY of i18n/aiGlossary.ts (edge functions cannot import
// the app tree). scripts/validate-i18n.ts fails if the two drift — edit the
// app file and paste here.
//
// Pure — no Deno or npm imports.

export type ReplyLocale = 'en' | 'es';

/** Parse a request body's `locale`. Only an exact 'es' (or an es-* tag)
 *  selects Spanish; everything else is English. */
export function parseReplyLocale(v: unknown): ReplyLocale {
  if (typeof v !== 'string') return 'en';
  const t = v.trim().toLowerCase();
  return t === 'es' || t.startsWith('es-') || t.startsWith('es_') ? 'es' : 'en';
}

export const AI_GLOSSARY_ES: readonly (readonly [en: string, es: string])[] = [
  ['crew', 'cuadrilla (never "equipo")'],
  ['equipment', 'maquinaria y equipo'],
  ['estimate', 'estimado (never "estimación")'],
  ['budget', 'presupuesto'],
  ['pay app / progress billing', 'solicitud de pago'],
  ['retainage', 'retención'],
  ['lien waiver', 'liberación de gravamen'],
  ['punch list / punch item', 'lista de pendientes / pendiente'],
  ['pending (CO, invite)', 'en espera / por aprobar'],
  ['markup', 'recargo'],
  ['backcharge', 'cargo al subcontratista'],
  ['change order', 'orden de cambio (change order)'],
  ['invoice', 'factura'],
  ['bid (a sub\'s price)', 'oferta'],
  ['quote', 'cotización'],
  ['deposit', 'anticipo'],
  ['schedule', 'cronograma'],
  ['critical path / float / baseline / milestone', 'ruta crítica / holgura / línea base / hito'],
  ['look-ahead', 'programa de 3 semanas'],
  ['delay / weather delay', 'retraso / retraso por clima'],
  ['daily report', 'reporte diario (never "bitácora")'],
  ['drawings / specs', 'planos / especificaciones'],
  ['RFI', 'solicitud de información (RFI)'],
  ['submittal', 'submittal'],
  ['inspection / permit', 'inspección / permiso'],
  ['certificate of occupancy', 'certificado de ocupación'],
  ['closeout', 'cierre de obra'],
  ['warranty', 'garantía'],
  ['takeoff', 'cuantificación (takeoff)'],
  ['scope', 'alcance'],
  ['T&M ticket', 'boleta de trabajo (T&M)'],
  ['material delivery / delivery ticket', 'entrega de material / remisión'],
  ['supplier', 'proveedor'],
  ['job / jobsite', 'proyecto / obra'],
  ['general contractor', 'contratista general'],
  ['subcontractor', 'subcontratista'],
  ['property owner (client)', 'propietario'],
  ['account owner (app role)', 'titular de la cuenta'],
  ['foreman', 'capataz'],
  ['crew lead', 'líder de cuadrilla'],
  ['superintendent', 'superintendente'],
  ['laborer / helper', 'trabajador / ayudante'],
  ['clock in / clock out', 'marcar entrada / marcar salida'],
  ['time card', 'tarjeta de horas'],
  ['overtime', 'horas extra (never "OT")'],
  ['JHA', 'análisis de riesgos del trabajo (JHA)'],
  ['hazard / control', 'peligro / medida de control'],
  ['toolbox talk', 'charla de seguridad'],
  ['PPE', 'EPP (equipo de protección personal)'],
  ['fall protection', 'protección contra caídas'],
  ['near miss', 'casi accidente'],
  ['corrective action', 'acción correctiva'],
  ['concrete', 'concreto (never "hormigón")'],
  ['plumbing', 'plomería (never "fontanería")'],
  ['drywall', 'drywall (tablaroca)'],
  ['framing', 'framing (estructura)'],
  ['phone / computer', 'celular / computadora'],
  ['add / delete', 'agregar / eliminar'],
];

/**
 * The text to APPEND to a relay's system prompt. '' unless Spanish was asked
 * for. Leads with two newlines so `sys + replyLanguageRule(body.locale)` reads
 * as a separate section and leaves English prompts byte-identical.
 */
export function replyLanguageRule(locale: unknown): string {
  if (parseReplyLocale(locale) !== 'es') return '';
  const terms = AI_GLOSSARY_ES.map(([en, es]) => `${en} = ${es}`).join('; ');
  return (
    '\n\nREPLY LANGUAGE: Write all human-readable text in Spanish for US construction crews ' +
    '(neutral Latin American Spanish that leans Mexican; use "tú" in the app). ' +
    'Keep EXACTLY as given, never translated: JSON keys, enum values, IDs, numbers, dollar amounts ' +
    '(US format, e.g. $1,234.50), dates you were given, units (sq ft, LF, CY, psi), CSI codes, ' +
    'building-code citations (e.g. IRC R602.3), agency names, product and company names, ' +
    'acronyms (RFI, JHA, OSHA, COI, AIA G702/G703, WIP, T&M), and any quoted source or evidence text. ' +
    'When you write a date yourself, use the month name (e.g. "27 de septiembre"), never a numeric date. ' +
    `Use these construction terms: ${terms}. ` +
    'If you are unsure of a trade term, add the English in parentheses. ' +
    'If you are drafting a message that will be sent to a subcontractor, client or homeowner, use "usted". ' +
    'All honesty rules above still apply in Spanish: never invent data to complete a Spanish sentence, ' +
    'and if something is unknown, say so.'
  );
}
