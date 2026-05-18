export interface RateOverride {
  id: string;
  kind: 'labor' | 'material';
  key: string;        // labor: trade name; material: materialId
  value: number;      // labor: $/hr; material: unit price
  label?: string;     // display (trade / material name)
}
export interface RateOverrideRow {
  id: string; user_id: string; kind: string; override_key: string;
  value: number; label: string | null; created_at: string; updated_at: string;
}
export function rateOverrideToRow(o: RateOverride, userId: string): RateOverrideRow {
  const now = new Date().toISOString();
  return {
    id: o.id, user_id: userId, kind: o.kind, override_key: o.key,
    value: o.value, label: o.label || null, created_at: now, updated_at: now,
  };
}
export function rowToRateOverride(r: RateOverrideRow): RateOverride {
  return {
    id: r.id,
    kind: r.kind === 'material' ? 'material' : 'labor',
    key: r.override_key,
    value: Number(r.value),
    label: r.label ?? undefined,
  };
}
