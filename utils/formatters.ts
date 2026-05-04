// Coerce anything that *should* be a number into a finite number. Persisted
// records sometimes come back with missing fields (legacy estimates, partial
// AI tool failures, schema drift) and a raw `.toLocaleString()` on undefined
// crashes the screen. Treat bad inputs as 0 so the UI degrades gracefully.
function safeNum(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function formatMoney(n: number | null | undefined, decimals = 0): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  const formatted = '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return num < 0 ? '-' + formatted : formatted;
}

export function formatMoneyShort(n: number | null | undefined): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1000000) formatted = `$${(abs / 1000000).toFixed(1)}M`;
  else if (abs >= 10000) formatted = `$${(abs / 1000).toFixed(0)}K`;
  else formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? '-' + formatted : formatted;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  return safeNum(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
