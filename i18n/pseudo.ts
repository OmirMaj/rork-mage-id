// i18n/pseudo.ts — the 'xx' pseudo-locale (docs/I18N.md §11).
//
// Dev builds and a hidden Settings toggle only; never a user choice, never
// stored. Every ASCII letter is swapped for an accented look-alike, the text
// is padded ~35% (Spanish runs 20–30% longer than English) and bracketed:
//
//     'Save'  →  '[Ŝàvé ··]'
//
// Reading the screen in xx:
//   - plain ASCII words  = a string that was never extracted into t();
//   - a clipped `]`      = a truncation bug (numberOfLines={1}, fixed widths)
//     that real Spanish will hit.
//
// `{placeholders}` and `{{` literal braces are left intact, so the pseudo
// template still interpolates exactly like the English one. PURE.

const MAP: Record<string, string> = {
  a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ',
  k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ',
  u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'À', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ',
  K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Ŝ', T: 'Ţ',
  U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

export const PSEUDO_OPEN = '[';
export const PSEUDO_CLOSE = ']';
export const PSEUDO_PAD = '·';

function accent(run: string): string {
  let out = '';
  for (const ch of run) out += MAP[ch] ?? ch;
  return out;
}

/** Accent + pad + bracket, leaving `{name}` placeholders and `{{`/`}}` alone. */
export function pseudoize(s: string): string {
  if (!s) return s;
  let out = '';
  let visible = 0;
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('{{', i) || s.startsWith('}}', i)) {
      out += s.slice(i, i + 2);
      i += 2;
      visible += 1;
      continue;
    }
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      if (end > i && /^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(s.slice(i, end + 1))) {
        out += s.slice(i, end + 1);
        i = end + 1;
        visible += 4; // a typical interpolated value
        continue;
      }
    }
    out += accent(s[i]);
    visible += 1;
    i += 1;
  }
  const pad = Math.max(2, Math.ceil(visible * 0.35));
  return `${PSEUDO_OPEN}${out} ${PSEUDO_PAD.repeat(pad)}${PSEUDO_CLOSE}`;
}
