import { computeSupplierScorecards, summarizeSuppliers } from '../../utils/supplierScorecard';
import type { Delivery } from '../../utils/deliverySchedule';

const D = (o: Partial<Delivery>): Delivery => ({
  id: o.id!, projectId: 'p', description: o.description ?? 'stuff',
  supplier: o.supplier!, expectedDate: o.expectedDate!, status: o.status ?? 'delivered',
  deliveredAt: o.deliveredAt, confirmedAt: o.confirmedAt,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as Delivery);

// Supplier A: never late, never confirms, all loads damaged -> low score
// Supplier B: confirms + undamaged, but 2 of 3 loads LATE -> higher score
const deliveries: Delivery[] = [
  D({ id:'a1', supplier:'Acme Glass', expectedDate:'2026-01-05', deliveredAt:'2026-01-05' }),
  D({ id:'a2', supplier:'Acme Glass', expectedDate:'2026-01-06', deliveredAt:'2026-01-06' }),
  D({ id:'a3', supplier:'Acme Glass', expectedDate:'2026-01-07', deliveredAt:'2026-01-07' }),
  D({ id:'b1', supplier:'Bolt Supply', expectedDate:'2026-01-05', deliveredAt:'2026-01-07', confirmedAt:'2026-01-01' }),
  D({ id:'b2', supplier:'Bolt Supply', expectedDate:'2026-01-06', deliveredAt:'2026-01-08', confirmedAt:'2026-01-01' }),
  D({ id:'b3', supplier:'Bolt Supply', expectedDate:'2026-01-07', deliveredAt:'2026-01-07', confirmedAt:'2026-01-01' }),
];
const receipts = [
  { supplier:'Acme Glass', hasDamage:true }, { supplier:'Acme Glass', hasDamage:true }, { supplier:'Acme Glass', hasDamage:true },
  { supplier:'Bolt Supply', hasDamage:false }, { supplier:'Bolt Supply', hasDamage:false }, { supplier:'Bolt Supply', hasDamage:false },
];
const cards = computeSupplierScorecards({ deliveries, receipts });
for (const c of cards) console.log(`  ${c.supplier}: score=${c.score} grade=${c.grade} lateCount=${c.lateCount} settled=${c.settledCount}`);
console.log('  summarizeSuppliers =>', JSON.stringify(summarizeSuppliers(cards)));
console.log('  TRUTH: Bolt Supply was late on 2 of 3 loads.');
