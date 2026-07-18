// utils/copilot/schedule/dateSignal.ts — did the contractor actually state a
// start date?
//
// The schedule interview must ASK "when do you break ground?" whenever the
// contractor did NOT give a date — that clarifying question is the whole point.
// But single-turn-trained models tend to PRESUME a date and fill the field
// anyway (the ICLR "double-turn" failure the spec calls out), which silently
// skips the question. So we don't trust a model-extracted startDate unless the
// contractor's own words carry a real temporal signal. Deterministic + pure so
// it can be unit-validated without a model in the loop.

// Word-boundary temporal tokens: month names, weekdays, relative units, seasons,
// quarters, named days. Kept to genuinely time-bearing words to avoid false
// positives on ordinary scope text ("kitchen and two baths" has none of these).
const WORD_SIGNAL = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?|today|tonight|tomorrow|yesterday|week|weeks|month|months|quarter|spring|summer|autumn|winter|q[1-4])\b/i;

// Numeric / phrase date forms: ISO, M/D or M-D, "the 5th", "in 3 weeks/days".
const NUMERIC_SIGNAL = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,                 // 2026-03-21
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,    // 3/21 or 03-21-2026
  /\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/i,         // "the 21st"
  /\bin\s+\d+\s+(?:day|days|week|weeks|month|months)\b/i, // "in 3 weeks"
  /\bnext\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|spring|summer|fall|winter)\b/i,
];

/** True when the transcript contains an explicit start/timing signal the model
 *  could legitimately turn into a start date. */
export function hasDateSignal(transcript: string): boolean {
  if (!transcript) return false;
  if (WORD_SIGNAL.test(transcript)) return true;
  // "fall" is excluded from WORD_SIGNAL (too many non-seasonal senses — "fall
  // protection", "a fall"); only accept it as a season when paired with timing.
  if (/\b(this|next|by|in|early|late|mid)\s+fall\b/i.test(transcript)) return true;
  return NUMERIC_SIGNAL.some((re) => re.test(transcript));
}

/** Whether to fold a model-extracted startDate into the draft. Accept only a
 *  real string date AND either a date signal in the contractor's own words or
 *  that they are directly answering the start-date question. Pure so the gate
 *  is unit-validated without the capability's (RN-heavy) dependency chain. */
export function shouldAcceptStartDate(
  aiStartDate: unknown,
  transcript: string,
  answeringStartDate: boolean,
): boolean {
  return typeof aiStartDate === 'string' && (hasDateSignal(transcript) || answeringStartDate);
}
