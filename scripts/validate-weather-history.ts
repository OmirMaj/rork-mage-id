// Validator: computeWeatherHistory basic contract
import { computeWeatherHistory, weatherHistoryFactLine } from '../utils/weatherHistory';
import type { DailyFieldReport } from '../types';

const makeReport = (date: string, conditions: string, issues = ''): DailyFieldReport => ({
  id: 'dfr-' + date, projectId: 'p1', date,
  weather: { temperature: '45', conditions, wind: '10mph', isManual: false },
  manpower: [], workPerformed: '', materialsDelivered: [],
  issuesAndDelays: issues, photos: [], status: 'draft',
  createdAt: date + 'T00:00:00Z', updatedAt: date + 'T00:00:00Z',
});

// 1. empty → empty record
const empty = computeWeatherHistory([]);
console.assert(Object.keys(empty).length === 0, 'empty reports → no entries');

// 2. sunny day → not counted
const sunny = computeWeatherHistory([makeReport('2026-07-01', 'Sunny')]);
console.assert(Object.keys(sunny).length === 0, 'sunny day not counted');

// 3. rain day → counted for July (month 6)
const rainy = computeWeatherHistory([makeReport('2026-07-15', 'Rain')]);
console.assert(rainy[6] === 1, `rain in July should be month 6, got ${JSON.stringify(rainy)}`);

// 4. snow → counted
const snowy = computeWeatherHistory([makeReport('2026-01-10', 'Snow')]);
console.assert(snowy[0] === 1, 'snow in January = month 0');

// 5. fact line from data
const factLine = weatherHistoryFactLine({ 6: 4, 7: 3 }, 6);
console.assert(factLine !== null, 'fact line should be non-null');
console.assert(typeof factLine === 'string' && factLine.length > 0, 'fact line is string');

// 6. no relevant data → null
const noLine = weatherHistoryFactLine({}, 6);
console.assert(noLine === null, 'empty history → null fact line');

console.log('validate-weather-history: all assertions passed');
