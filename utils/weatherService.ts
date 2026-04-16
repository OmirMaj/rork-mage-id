export interface DayForecast {
  date: string;
  condition: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'wind';
  tempHigh: number;
  tempLow: number;
  precipChance: number;
  windSpeed: number;
  isWorkable: boolean;
  icon: string;
}

const CONDITION_ICONS: Record<DayForecast['condition'], string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '🌨️',
  wind: '💨',
};

export function getConditionIcon(condition: DayForecast['condition']): string {
  return CONDITION_ICONS[condition] ?? '☀️';
}

export function getSimulatedForecast(startDate: Date, days: number, _region?: string): DayForecast[] {
  const forecasts: DayForecast[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const month = date.getMonth();
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

    const seed = (dayOfYear * 13 + date.getFullYear() * 7) % 100;
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;
    const isSpring = month >= 3 && month <= 4;

    let condition: DayForecast['condition'] = 'clear';
    let precipChance = 10;
    let tempHigh = 75;
    let tempLow = 55;
    let windSpeed = 8;

    if (isWinter) {
      tempHigh = 38 + (seed % 20);
      tempLow = tempHigh - 15;
      precipChance = 25 + (seed % 30);
      condition = seed < 20 ? 'snow' : seed < 45 ? 'cloudy' : seed < 60 ? 'rain' : 'clear';
    } else if (isSummer) {
      tempHigh = 78 + (seed % 20);
      tempLow = tempHigh - 18;
      precipChance = 15 + (seed % 25);
      condition = seed < 10 ? 'storm' : seed < 25 ? 'rain' : seed < 40 ? 'cloudy' : 'clear';
    } else if (isSpring) {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 30 + (seed % 25);
      condition = seed < 15 ? 'storm' : seed < 35 ? 'rain' : seed < 50 ? 'cloudy' : 'clear';
    } else {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 20 + (seed % 20);
      condition = seed < 10 ? 'rain' : seed < 30 ? 'cloudy' : 'clear';
    }

    windSpeed = 5 + (seed % 20);
    const isWorkable = condition !== 'storm' && condition !== 'snow' && precipChance < 70 && windSpeed < 30;

    forecasts.push({
      date: date.toISOString().split('T')[0],
      condition,
      tempHigh: Math.round(tempHigh),
      tempLow: Math.round(tempLow),
      precipChance,
      windSpeed: Math.round(windSpeed),
      isWorkable,
      icon: getConditionIcon(condition),
    });
  }
  return forecasts;
}

export function getWeatherRiskForDate(date: string, forecasts: DayForecast[]): DayForecast | null {
  return forecasts.find(f => f.date === date) ?? null;
}
