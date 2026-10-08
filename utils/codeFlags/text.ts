// utils/codeFlags/text.ts — Code Flags: how a line's words are read. Small,
// fixed word lists and a tokeniser, so the matcher stays a table lookup that a
// person can follow by hand.
//
// TOKENS. A line is lower-cased, its ACCENTS ARE FOLDED FIRST ("línea" reads as
// "linea", never "l nea"), "&" reads as "and", and everything that is not a
// letter or a digit separates words. That is the rule of
// utils/scopeCoverage.normalizeScopeText (a shared helper, left alone because
// eight other modules read through it); the fold happens here, in front of it.
// A comma, a semicolon or a colon becomes a BREAK token: no phrase and no
// verb-and-noun pair reaches across one.
//
// Pure: no React, no storage, no network.

/** The token a comma, a semicolon or a colon turns into. Never a word. */
export const BREAK = '|';

/** Accents folded to their plain letters (NFD, combining marks dropped). */
export function foldAccents(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The words of a line, in order, with BREAK where a comma, semicolon or colon stood. */
export function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return foldAccents(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[,;:|]+/g, ` ${BREAK} `)
    .replace(/[^a-z0-9/| ]/g, ' ')
    .split(/[ /]+/)
    .filter(Boolean);
}

/** The words of a rule phrase (a phrase never holds a BREAK). */
export function phraseTokens(phrase: string): string[] {
  return tokenize(phrase).filter((t) => t !== BREAK);
}

/** True when `token` is `base` or a plural of it: "s", "es", or "y" to "ies". */
export function isFormOf(token: string, base: string): boolean {
  if (token === base) return true;
  if (token === `${base}s`) return !base.endsWith('s');
  if (token === `${base}es`) return true;
  return base.endsWith('y') && token === `${base.slice(0, -1)}ies`;
}

/** The singular forms `token` could be a plural of (itself first). */
export function baseForms(token: string): string[] {
  const out = [token];
  if (token.endsWith('ies') && token.length > 3) out.push(`${token.slice(0, -3)}y`);
  if (token.endsWith('es') && token.length > 2) out.push(token.slice(0, -2));
  if (token.endsWith('s') && token.length > 1) out.push(token.slice(0, -1));
  return out;
}

const set = (words: string): ReadonlySet<string> => new Set(words.split(/\s+/).filter(Boolean));

/** How many ordinary words may stand between a verb and its noun. */
export const PAIR_WINDOW = 3;

/**
 * Words that cost nothing between a verb and its noun: articles, room names,
 * positions and a few plain adjectives ("remove THE EXISTING KITCHEN wall").
 * A number is free too ("add 4 20A circuits").
 */
export const SKIP_WORDS: ReadonlySet<string> = set(`
  the a an this that these those all both entire whole any some
  existing exist new old damaged rotted
  front rear back side left right north south east west upper lower top bottom main
  interior exterior int ext inside first second third 1st 2nd 3rd floor level story
  kitchen bath bathroom bedroom living dining room hall hallway closet basement cellar attic garage
  laundry powder master primary guest family den office pantry mudroom foyer entry lr dr br mbr unit apt apartment
  non load bearing
  el la los las un una unos unas existente nuevo nueva
  cocina bano sala comedor cuarto dormitorio recamara sotano atico garaje pasillo
`);

/**
 * Words that END a verb's reach, and the words a noun may be followed by and
 * still be the thing itself ("remove wall BETWEEN the kitchen and dining").
 */
export const BREAK_WORDS: ReadonlySet<string> = set(`
  and or with for at in on to from by of into onto then plus but per as between behind above below
  under over near along across through thru around where that which after before during
  including incl excluding not no if when until is are be
  y o u con sin para por en de del desde hasta entre sobre bajo que donde
`);

/** Words a noun may also be followed by and still be the thing itself. */
export const HEAD_TAIL_WORDS: ReadonlySet<string> = set(`
  section sections framing assembly completely entirely only complete approx separating dividing
  nic typ lf sf ea ft allowance
  nuevo nueva nuevos nuevas existente existentes adicional adicionales
`);

/** "no X", "excluding X", "sin X": the word right before a trigger that cancels it. */
export const NEGATORS: ReadonlySet<string> = set('no excluding excludes exclude excl sin excluye excluyendo');
/** "not including X", "no incluye X": the second word of a two-word negation. */
export const NEGATOR_SECOND: ReadonlySet<string> = set('including included incl incluye incluido incluyendo');
export const NEGATOR_FIRST: ReadonlySet<string> = set('not no');
/** Words that may stand between the negation and the trigger ("no NEW circuits"). */
export const NEGATION_SKIP: ReadonlySet<string> = set('the a an any new additional un una ningun ninguna nuevo nueva trabajo trabajos obra');

/**
 * A trigger followed by one of these (directly, or after one more word) is the
 * thing's cover, sticker, delivery or rental, not the work ("exit sign
 * sticker", "induction cooktop delivery", "hot tub cover").
 */
export const QUIET_AFTER: ReadonlySet<string> = set('delivery rental cover covers sticker stickers decal decals label labels cleaning warranty');

export function isSkipWord(token: string): boolean {
  return SKIP_WORDS.has(token) || token.length === 1 || /^\d/.test(token);
}
