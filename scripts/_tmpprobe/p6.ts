import { slipDays, computeSupplierScorecards } from '../../utils/supplierScorecard';
import type { Delivery } from '../../utils/deliverySchedule';
const D = (o: any): Delivery => ({ id:o.id, projectId:'p', description:'x', supplier:o.supplier,
  expectedDate:o.expectedDate, status:'delivered', deliveredAt:o.deliveredAt,
  createdAt:'2026-01-01', updatedAt:'2026-01-01' } as Delivery);

console.log('process TZ =', Intl.DateTimeFormat().resolvedOptions().timeZone);
// A truck received at 20:30 local on the promised day, stamped with new Date().toISOString()
const evening = new Date(2026, 7, 20, 20, 30, 0); // Aug 20 2026, 20:30 LOCAL
console.log('local receive time  =', evening.toString());
console.log('stored deliveredAt  =', evening.toISOString());
const d = D({ id:'d1', supplier:'Acme', expectedDate:'2026-08-20', deliveredAt: evening.toISOString() });
console.log('slipDays            =', slipDays(d), '(0 = on time)');

const morning = new Date(2026, 7, 20, 9, 0, 0);
console.log('morning receive slipDays =', slipDays(D({ id:'d2', supplier:'Acme', expectedDate:'2026-08-20', deliveredAt: morning.toISOString() })));
