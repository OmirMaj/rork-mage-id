// utils/constructionFacts.ts - rotating one-liners for long loading waits.
//
// Shown one at a time while MAGE works (estimate pricing, drawing/spec AI
// analysis) so a 20-60s wait feels like progress, not a hang. Plain contractor
// voice: estimating math, materials, jobsite, safety, code, money, a little
// history. Kept short (one line) and accuracy-checked before shipping.

export const CONSTRUCTION_FACTS: readonly string[] = [
  'Markup and margin aren\'t the same. A 25% margin needs about a 33% markup on cost.',
  'Price off margin, not markup. Marking up cost 20% only leaves you a 16.7% margin.',
  'Divide cost by (1 minus your margin) to hit the margin you actually want.',
  'Contingency isn\'t padding. It covers the unknowns you can\'t line-item yet.',
  'The tighter your scope, the smaller your contingency needs to be.',
  'A clear scope of work wins more bids than the lowest price.',
  'Bid the scope, not the drawing. What\'s missing costs more than what\'s shown.',
  'Unit pricing beats lump sums when quantities can change on you.',
  'Take off twice, price once. A missed quantity is a missed dollar.',
  'Every exclusion you write down is a change order you get paid for later.',
  'Labor is where estimates go to die. Overhead and slow days hide in the hours.',
  'Add waste to material takeoffs before you price, not after you order.',
  'Round quantities up to how material actually ships, not down to the drawing.',
  'Overhead is real cost. If it\'s not in your rate, it\'s coming out of profit.',
  'The cheapest bid often means the estimator missed something you didn\'t.',
  'Concrete gains most of its strength in the first month but keeps curing for years.',
  'Concrete is strong in compression, weak in tension. That\'s why we add rebar.',
  'Wet concrete is caustic. It can burn skin, so rinse it off, don\'t let it sit.',
  'Curing concrete keeps water in, it doesn\'t dry it out. Cover it and keep it moist.',
  'Concrete doesn\'t dry, it cures. The chemical reaction is what builds strength.',
  'A 2x4 isn\'t 2 by 4. It\'s actually 1.5 by 3.5 inches after milling.',
  'Nominal lumber sizes are before drying and planing. Real dimensions run smaller.',
  'Wood shrinks across the grain, barely along it. That\'s why joints open up.',
  'Steel expands and contracts with heat. That\'s why long spans need expansion joints.',
  'Steel is strong in both tension and compression, which is why it frames tall.',
  'Drywall comes in fire-rated types. Type X is thicker for a reason, don\'t sub it out.',
  'Green board resists moisture, but it\'s not waterproof. Use backer board in showers.',
  'Rebar is deformed on purpose. Those ridges grip the concrete so it can\'t slip.',
  'Plywood is cross-laminated so it stays strong and stable in both directions.',
  'Order lumber for the day you frame, not the week before. Warp is real.',
  'Sequence the trades or they\'ll trip over each other and your schedule.',
  'A tidy jobsite is a fast jobsite. Time lost hunting for tools adds up.',
  'Build the punch list as you go, not at the end when memory fades.',
  'Weather is a schedule risk, not a surprise. Build float in around it.',
  'The critical path is the tasks that move the finish date. Protect those first.',
  'Front-load your long-lead materials. Ordering late stalls the whole job.',
  'A daily log takes five minutes and settles disputes months later.',
  'Falls are the leading cause of death in construction. Tie off, every time.',
  'Silica dust from cutting concrete is invisible and permanent. Wet-cut or use a vac.',
  'Call before you dig. Hitting a buried line can kill you and cost a fortune.',
  'Trenches cave without warning. Slope, shore, or box anything deep enough to bury you.',
  'Hard hats expire. Sun and impact break down the shell over time.',
  'Ladder rule of thumb: one foot out for every four feet up.',
  'Lock out and tag out before you service it. Stored energy doesn\'t care.',
  'Most struck-by injuries come from vehicles and swinging loads. Watch the zone.',
  'Pull permits before you build, not after. Retroactive approval costs more.',
  'Inspections happen at set stages. Cover work before signoff and you\'ll open it back up.',
  'Egress rules exist so people get out in a fire. Don\'t shortcut window and door sizes.',
  'Codes set the minimum, not the goal. Build better than the floor when it matters.',
  'Permitted work protects the resale. Unpermitted additions can tank a sale.',
  'Cash flow kills more contractors than bad bids. Bill early, bill often.',
  'Get a deposit. Financing the client\'s job with your own cash is how you go under.',
  'Change orders in writing, signed, before the work. Verbal is a gift you won\'t get paid for.',
  'Retainage is your money held back. Track it or you\'ll forget to collect it.',
  'Profit isn\'t cash in the bank. You can be profitable and still run out of money.',
  'Bid too low and you win the job but lose the year. Know your walk-away number.',
  'The Romans built with concrete, and some of it is still standing today.',
  'The Great Pyramid was the tallest structure humans built for thousands of years.',
  'Skyscrapers only took off once safe elevators made the top floors worth having.',
  'The word \'architect\' comes from Greek for chief builder.',
];

/**
 * A shuffled copy so each loader session opens on a different fact. Pass a seed
 * (e.g. Date.now()) to vary per mount; deterministic given the same seed.
 */
export function shuffledFacts(seed = 1): string[] {
  const a = [...CONSTRUCTION_FACTS];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
