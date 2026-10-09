// hooks/useCodeFlagsCopy.ts — the ONLY place the Code Flags strings live
// (Big Bets, Bet 4, Phase 1). Every string goes through
// t('office.codeFlags.*', english, vars), so the i18n registry stays in one
// file (surface 'office.code-flags', Spanish in
// i18n/catalog/es/office/codeFlags.ts). components/codeFlags/* import this and
// add no t() keys of their own.
//
// WORDING (docs/VOICE.md): a key ending in `Label` is a name or an action in
// Title Case. A key ending in `Body` or `Why` is one or more whole sentences in
// sentence case. No em dashes, no "and" sign, no "e.g.", no arrows.
//
// WHAT A FLAG MAY SAY. It says a KIND of work is commonly looked at on a permit
// or by an inspector, and why, in the app's own words. It never says this job
// needs anything, never says anything is fine, and never reads like a code
// book: no quotation marks, none of the words a copied code sentence carries.
// scripts/validate-code-flags.ts reads the English shard and the Spanish file
// and fails on a banned word in either ("compliant", "passes", "meets code",
// "approved", "required", and their Spanish forms), on a line the own-words
// gate (utils/codeCard/echoCheck) would withhold, and when the sentence saying
// that no flag means nothing is missing.
//
// TWO HOOKS, for cost. A chip is drawn on every flagged line, so it reads only
// its two labels (useCodeFlagChipLabels: one small object, built once per
// language and shared by every chip on the screen). The sheet's sixty-odd
// sentences are built by useCodeFlagsCopy, which ONLY the sheet calls, so they
// are built when a sheet opens and not once per line.
//
// Never call t() at module scope: the objects are rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import type { CodeFlagFamilyId } from '@/utils/codeFlags/rules';
import type { CodeFlagPlace, CodeFlagPlaceId, CodeFlagSectionId } from '@/utils/codeFlags/place';
import type { CodeFlagTrigger } from '@/utils/codeFlags/match';

/** All a chip or the building-age row needs: its words and what a screen reader says. */
export interface CodeFlagChipLabels {
  permitLabel: string;
  permitA11yBody: string;
  ageLabel: string;
  ageA11yBody: string;
}

const LABELS = new Map<string, CodeFlagChipLabels>();

/** The chip's labels. One object per language, shared by every chip on screen. */
export function useCodeFlagChipLabels(): CodeFlagChipLabels {
  const { t, displayLang } = useT();
  let labels = LABELS.get(displayLang);
  if (!labels) {
    labels = {
      permitLabel: t('office.codeFlags.chip.permitLabel', 'May Need a Permit Amendment or an Inspection'),
      permitA11yBody: t('office.codeFlags.chip.permitA11yBody', 'May need a permit amendment or an inspection. Opens the reason.'),
      ageLabel: t('office.codeFlags.chip.ageLabel', 'Check Building-Age Rules'),
      ageA11yBody: t('office.codeFlags.chip.ageA11yBody', 'Check building-age rules. Opens the reason.'),
    };
    LABELS.set(displayLang, labels);
  }
  return labels;
}

export interface CodeFlagsCopy {
  // ── the sheet ──
  sheetTitleLabel: string;
  ageSheetTitleLabel: string;
  ageSheetBody: string;
  introBody: string;
  /** The sentence that says an unflagged line means nothing. */
  noFlagBody: string;
  neverBlocksBody: string;
  privateBody: string;
  starterBody: string;
  whyHeadingLabel: string;
  triggerHeadingLabel: string;
  sectionHeadingLabel: string;
  sourcesHeadingLabel: string;
  booksLabel: (books: string) => string;
  familyNameLabel: (id: CodeFlagFamilyId) => string;
  familyWhy: (id: CodeFlagFamilyId, place: CodeFlagPlaceId) => string;
  triggerBody: (triggers: readonly CodeFlagTrigger[], categoryName: string | null) => string;
  /** The building-age row: the words, and how many lines carry them. */
  docTriggerBody: (triggers: readonly CodeFlagTrigger[], lineCount: number) => string;
  builtBody: (id: CodeFlagFamilyId, year: number) => string;
  marylandLeadBody: string;
  ageNotCheckedBody: string;
  noSectionBody: string;
  sectionBody: (id: CodeFlagSectionId, label: string) => string;
  checkedSub: (date: string) => string;
  placeBody: (place: CodeFlagPlace, hasProject: boolean) => string;
  standingNoteBody: string;
  askLabel: string;
  askBody: string;
  hideLabel: string;
  hideBody: (hasProject: boolean) => string;
  openLinkFailedBody: string;
}

export function useCodeFlagsCopy(): CodeFlagsCopy {
  const { t, lang } = useT();
  return useMemo<CodeFlagsCopy>(() => {
    const familyNames: Record<CodeFlagFamilyId, string> = {
      egress: t('office.codeFlags.family.egress.nameLabel', 'Exits and Ways Out'),
      fire_rating: t('office.codeFlags.family.fireRating.nameLabel', 'Fire-Rated Walls, Doors and Ceilings'),
      fire_protection: t('office.codeFlags.family.fireProtection.nameLabel', 'Sprinklers, Alarms and Hood Suppression'),
      structural: t('office.codeFlags.family.structural.nameLabel', 'Bearing Walls, Beams and Foundations'),
      electrical_service: t('office.codeFlags.family.electrical.nameLabel', 'Electrical Service, Panels and Big New Loads'),
      plumbing: t('office.codeFlags.family.plumbing.nameLabel', 'Added or Moved Plumbing'),
      gas: t('office.codeFlags.family.gas.nameLabel', 'Gas Piping and Gas Appliances'),
      mechanical: t('office.codeFlags.family.mechanical.nameLabel', 'Heating, Cooling, Ventilation and Venting'),
      change_of_use: t('office.codeFlags.family.changeOfUse.nameLabel', 'Change of Use or Occupancy'),
      energy_tests: t('office.codeFlags.family.energyTests.nameLabel', 'Energy Code Tests'),
      decks_stairs: t('office.codeFlags.family.decksStairs.nameLabel', 'Decks, Stairs, Guards and Railings'),
      layout_change: t('office.codeFlags.family.layoutChange.nameLabel', 'Room Layout Changes'),
      lead_age: t('office.codeFlags.family.leadAge.nameLabel', 'Lead-Safe Work in an Older Home'),
      asbestos_age: t('office.codeFlags.family.asbestosAge.nameLabel', 'Asbestos Check in an Older New York City Building'),
    };
    const familyWhys: Record<CodeFlagFamilyId, string> = {
      egress: t('office.codeFlags.family.egress.why', 'Work on exit doors, exit stairs, escape windows and exit lighting changes how people get out of a building. Building departments commonly review that on the permit drawings, and inspectors commonly look at it.'),
      fire_rating: t('office.codeFlags.family.fireRating.why', 'A fire-rated wall, door or ceiling is built as a tested assembly. Changing it, or running a pipe, duct or cable through it, is commonly reviewed on a permit. It is commonly looked at before it is covered up.'),
      fire_protection: t('office.codeFlags.family.fireProtection.why', 'Sprinkler, fire alarm and kitchen hood suppression work is commonly filed and tested on its own, often with the fire department. Moving even a few sprinkler heads can bring that in.'),
      structural: t('office.codeFlags.family.structural.why', 'This work carries the weight of the building: bearing walls, beams, joists, footings and new openings. It is commonly designed by an engineer or an architect and shown on the permit drawings. It is commonly inspected before it is covered.'),
      electrical_service: t('office.codeFlags.family.electrical.why', 'A new or larger service, a panel change, new circuits and large new loads are commonly done under an electrical permit and inspected. A car charger and a heat pump are large new loads. The utility can have its own steps for a service change.'),
      plumbing: t('office.codeFlags.family.plumbing.why', 'Adding or moving a fixture, a drain, a stack, a water heater or the water or sewer service is commonly done under a plumbing permit. It is commonly done by a licensed plumber and inspected before the walls are closed.'),
      gas: t('office.codeFlags.family.gas.why', 'New or changed gas piping and gas appliances are commonly done under a permit by a licensed plumber or gas fitter, with a pressure test. The gas utility can have its own steps.'),
      mechanical: t('office.codeFlags.family.mechanical.why', 'New or replaced heating and cooling equipment, ducts, exhaust fans, hoods, flues and chimney liners are commonly done under a mechanical permit and inspected. How a replaced appliance vents is one of the things commonly checked.'),
      change_of_use: t('office.codeFlags.family.changeOfUse.why', 'This work turns a space into something it was not. A garage becomes a room, a basement becomes an apartment, a store becomes a restaurant, or a bedroom or a dwelling unit is added. That commonly changes which rules the building falls under, and it can change the Certificate of Occupancy.'),
      energy_tests: t('office.codeFlags.family.energyTests.why', 'A blower door test, a duct leakage test and a heating and cooling load calculation are commonly asked for with the permit or at the final inspection. A line for one of them usually means an inspector will want to see the result.'),
      decks_stairs: t('office.codeFlags.family.decksStairs.why', 'New or rebuilt decks, porches, stairs, guards and handrails are commonly built under a permit and inspected. How a deck attaches to the house is commonly looked at. So are the height and the openings of a guard.'),
      layout_change: t('office.codeFlags.family.layoutChange.why', 'Taking out, adding or moving a wall or a partition changes the layout of rooms. Building departments commonly look at a layout change on a permit.'),
      lead_age: t('office.codeFlags.family.leadAge.why', 'Some of this work touches painted surfaces in a home on file as built before 1978. Federal lead-safe work rules cover homes built before 1978 when the work disturbs paint. Small jobs and buildings tested lead-free can be exempt. MAGE ID does not know whether this building has lead paint.'),
      asbestos_age: t('office.codeFlags.family.asbestosAge.why', 'New York City has asbestos rules for permit work on buildings from before April 1, 1987. An asbestos investigation, on form ACP-5, commonly comes before the permit. MAGE ID does not know whether this building has asbestos.'),
    };
    const layoutNycWhy = t('office.codeFlags.family.layoutChange.nycWhy', 'Taking out, adding or moving a wall or a partition changes the layout of rooms. In New York City, changing the layout of rooms commonly involves a filing with the Department of Buildings.');
    const sectionBodies: Record<CodeFlagSectionId, (label: string) => string> = {
      baltimore_city_105_1_3: (label) => t('office.codeFlags.section.baltimoreCityUnderpinningBody', '{label}. It covers who applies for the permit for underpinning work.', { label }),
      baltimore_county_21_7_303: (label) => t('office.codeFlags.section.baltimoreCountyElectricalBody', '{label} sets when each new edition of the electrical code takes effect.', { label }),
    };
    const wordsOf = (triggers: readonly CodeFlagTrigger[]) => triggers.filter((x) => x.via !== 'permit_flag').map((x) => x.phrase).join(', ');
    return {
      sheetTitleLabel: t('office.codeFlags.sheet.titleLabel', 'Why This Line Has a Flag'),
      ageSheetTitleLabel: t('office.codeFlags.sheet.ageTitleLabel', 'Building-Age Rules'),
      ageSheetBody: t('office.codeFlags.sheet.ageBody', 'One flag for the whole page, not one on each line.'),
      introBody: t('office.codeFlags.sheet.introBody', 'This kind of work is commonly looked at on a permit or by an inspector. MAGE ID flags it so you can check. You decide what to do.'),
      noFlagBody: t('office.codeFlags.sheet.noFlagBody', 'A line with no flag can still need a permit or an inspection. No flag means nothing.'),
      neverBlocksBody: t('office.codeFlags.sheet.neverBlocksBody', 'A flag never stops you from saving, sending, signing or billing.'),
      privateBody: t('office.codeFlags.sheet.privateBody', 'This flag is not on anything you send.'),
      starterBody: t('office.codeFlags.sheet.starterBody', 'This is a starter list of work types. An architect or an expediter has not checked it yet.'),
      whyHeadingLabel: t('office.codeFlags.sheet.whyHeadingLabel', 'Why It Is Flagged'),
      triggerHeadingLabel: t('office.codeFlags.sheet.triggerHeadingLabel', 'What Triggered It'),
      sectionHeadingLabel: t('office.codeFlags.sheet.sectionHeadingLabel', 'Section Number'),
      sourcesHeadingLabel: t('office.codeFlags.sheet.sourcesHeadingLabel', 'Official Sources'),
      booksLabel: (books) => t('office.codeFlags.sheet.booksBody', 'Code family: {books}.', { books }),
      familyNameLabel: (id) => familyNames[id],
      familyWhy: (id, place) => (id === 'layout_change' && place === 'nyc' ? layoutNycWhy : familyWhys[id]),
      triggerBody: (triggers, categoryName) => {
        const first = triggers[0];
        if (!first) return '';
        const words = wordsOf(triggers);
        if (first.via === 'category' && categoryName) {
          return t('office.codeFlags.trigger.categoryBody', 'These words on a line filed under {category}: {words}.', { category: categoryName, words });
        }
        return t('office.codeFlags.trigger.wordsBody', 'These words on the line: {words}.', { words });
      },
      docTriggerBody: (triggers, lineCount) => {
        const words = wordsOf(triggers);
        if (!words) return t('office.codeFlags.trigger.permitFlagBody', 'A line here has a permit flag, and the age of the building adds this one.');
        return t('office.codeFlags.trigger.docWordsBody', 'These words, on {count} of the lines: {words}.', { count: String(lineCount), words });
      },
      builtBody: (id, year) => (id === 'asbestos_age' && year === 1987
        ? t('office.codeFlags.age.built1987Body', 'On file as built in 1987. The rule depends on whether the new-building permit was issued before April 1, 1987.')
        : t('office.codeFlags.age.builtBody', 'On file as built in {year}.', { year: String(year) })),
      marylandLeadBody: t('office.codeFlags.age.marylandLeadBody', 'Maryland has its own lead law for rental homes built before 1978. The owner registers the home with the state and keeps a lead inspection certificate for each new tenant, unless the home is certified lead-free.'),
      ageNotCheckedBody: t('office.codeFlags.age.notCheckedBody', 'The year built is not on file for this project, so lead and asbestos rules were not checked.'),
      noSectionBody: t('office.codeFlags.section.noneBody', 'MAGE ID has no checked section number for this yet.'),
      sectionBody: (id, label) => sectionBodies[id](label),
      checkedSub: (date) => t('office.codeFlags.source.checkedSub', 'Checked {date}', { date: formatCalendarDay(calendarDayOf(date), undefined, lang) }),
      placeBody: (place, hasProject) => {
        if (place.id !== 'other' && place.name) {
          return t('office.codeFlags.place.localBody', 'Local links are for {place}.', { place: place.name });
        }
        if (!hasProject) {
          return t('office.codeFlags.place.noProjectBody', 'This estimate is not on a project yet. This is a general flag, with no section number and no local link.');
        }
        if (place.unsettledBaltimore) {
          return t('office.codeFlags.place.baltimoreBody', 'This address could be in Baltimore City or in Baltimore County, and they are separate governments. Add the county or the ZIP code to the project to see local links.');
        }
        if (!place.hasAddress) {
          return t('office.codeFlags.place.noAddressBody', 'This project has no address MAGE ID can place. This is a general flag, with no section number and no local link.');
        }
        return t('office.codeFlags.place.otherBody', 'MAGE ID has no local rules for this place. This is a general flag, with no section number and no local link. Ask your building department.');
      },
      standingNoteBody: t('office.codeFlags.sheet.standingNoteBody', 'Not a substitute for the adopted code. Confirm with your building department.'),
      askLabel: t('office.codeFlags.sheet.askLabel', 'Ask Code Check'),
      askBody: t('office.codeFlags.sheet.askBody', 'Opens Code Check for the detail. Code Check has its own daily limit on your plan.'),
      hideLabel: t('office.codeFlags.sheet.hideLabel', 'Hide This Flag'),
      hideBody: (hasProject) => (hasProject
        ? t('office.codeFlags.sheet.hideBody', 'Hidden on this device. It comes back if the line changes to a new kind of work.')
        : t('office.codeFlags.sheet.hideNoProjectBody', 'Hidden while this estimate is open. Nothing is saved, because the estimate is not on a project yet.')),
      openLinkFailedBody: t('office.codeFlags.source.openFailedBody', 'That page did not open. Try again in a moment.'),
    };
  }, [t, lang]);
}

export default useCodeFlagsCopy;
