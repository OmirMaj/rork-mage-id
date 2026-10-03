// utils/contentCredits.ts — the credit lines third-party data needs where it
// is shown, and the one rule for when each shows.
//
// WHY (contentfix-specs/RIGHTS-VERDICT.md, MAGE ID's first App Store
// submission, guideline 5.2.2 — "you must be specifically permitted to do so
// under the service's terms of use"):
//   * OpenWeather's free and lower paid plans require the visible line
//     "Weather data provided by OpenWeather", linked to openweathermap.org.
//   * OpenStreetMap's license (and the Nominatim usage policy) require
//     "© OpenStreetMap contributors" wherever a geocoder built on OSM data is
//     used — the place in "Weather for <place>" and the map pin behind the
//     forecast both come from Nominatim (utils/geocodeProject.ts).
//   * Baltimore County's open-data license requires its disclaimer to be
//     attached, verbatim, by anyone who disseminates or cites County data.
//   * Baltimore City's Real Property dataset is CC BY 3.0, which requires a
//     license link.
//
// Pure: no React, no react-native, no imports — scripts/validate-content-
// rights.ts runs every function here under bun.

export const OPENWEATHER_CREDIT = 'Weather data provided by OpenWeather';
export const OPENWEATHER_URL = 'https://openweathermap.org/';

export const OSM_CREDIT = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/** The County's disclaimer, copied verbatim (including its doubled "only")
 *  from https://opendata.baltimorecountymd.gov/pages/data-license, read on
 *  2026-10-02 through its ArcGIS page item ba4f6e9a350b43d3aae973ed3bcf6ce3.
 *  Do not edit the wording: the license requires this exact text. */
export const BALTIMORE_COUNTY_DISCLAIMER =
  'This data is only for general information purposes only. This data may be inaccurate or contain errors or omissions. '
  + 'Baltimore County, Maryland does not warrant the accuracy or reliability of the data and disclaims all warranties with regard '
  + 'to the data, including but not limited to, all warranties, express or implied, of merchantability and fitness for any '
  + 'particular purpose. Baltimore County, Maryland disclaims all obligation and liability for damages, including but not '
  + "limited to, actual, special, indirect, and consequential damages, attorneys' and experts' fees, and court costs incurred "
  + 'as a result of, arising from or in connection with the use of or reliance upon this data.';
export const BALTIMORE_COUNTY_DISCLAIMER_TITLE = 'Baltimore County data disclaimer';
export const BALTIMORE_COUNTY_LICENSE_URL = 'https://opendata.baltimorecountymd.gov/pages/data-license';

export const BALTIMORE_CITY_CC_BY_LINE = 'Real Property data: City of Baltimore, CC BY 3.0';
export const CC_BY_3_URL = 'https://creativecommons.org/licenses/by/3.0/';

/** Anything carrying forecast provenance (DayForecast, a hit day…). */
interface SourcedDay {
  source: string;
}

/**
 * True when at least one day on screen is a real OpenWeather reading. A
 * simulated day is invented by the app (getSimulatedForecast), not
 * OpenWeather's data, so a window with no live day carries no credit — it
 * keeps its "SIMULATED WEATHER — NOT A FORECAST" marking instead.
 */
export function showsOpenWeatherCredit(days: readonly SourcedDay[] | null | undefined): boolean {
  if (!days) return false;
  return days.some((d) => d.source === 'live');
}

/** The same rule for a surface that only knows the window's coverage
 *  (utils/weatherProvenance ForecastCoverage). */
export function coverageShowsOpenWeatherCredit(coverage: string | null | undefined): boolean {
  return coverage === 'live' || coverage === 'mixed';
}

export type BuildingRecordCredit =
  | { kind: 'county_disclaimer'; title: string; text: string; url: string }
  | { kind: 'city_cc_by'; text: string; url: string };

/** Which license notice a Baltimore record carries, by the side it came from.
 *  Null for anything else (no record, or an unknown side). */
export function mdRecordCredit(side: string | null | undefined): BuildingRecordCredit | null {
  if (side === 'baltimore_county') {
    return { kind: 'county_disclaimer', title: BALTIMORE_COUNTY_DISCLAIMER_TITLE, text: BALTIMORE_COUNTY_DISCLAIMER, url: BALTIMORE_COUNTY_LICENSE_URL };
  }
  if (side === 'baltimore_city') {
    return { kind: 'city_cc_by', text: BALTIMORE_CITY_CC_BY_LINE, url: CC_BY_3_URL };
  }
  return null;
}
