import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";
// Money lives in project_financials now, not on the projects row — see
// financials.ts. Reads fall back to the legacy column, writes hit both.
import { readLinkedEstimate, writeLinkedEstimate } from "./financials.ts";

/** Object IDs for items are encoded as "<projectId>::<materialId>" since items
 *  don't live in their own table — they're embedded in projects.linked_estimate.items[]
 *  and keyed by `materialId` (NOT `id`). */
export async function upsertItem(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [projectId, materialId] = encodedId.split('::');
  if (!projectId || !materialId) throw new Error(`bad item id ${encodedId}`);

  const s = svc();
  const linkedEstimate = await readLinkedEstimate(s, projectId, userId);
  if (!linkedEstimate) throw new Error('project not found');
  const items = linkedEstimate.items ?? [];
  const item  = items.find(i => i.materialId === materialId);
  if (!item) throw new Error(`item ${materialId} not found`);
  if (item.qboItemId) return; // already linked

  // Look up the QBO default "Services" income account once.
  const accountQuery = await qboFetch(conn, "/query?query=" + encodeURIComponent("select Id from Account where AccountType = 'Income' MAXRESULTS 1"), { method: 'GET' }) as { QueryResponse?: { Account?: { Id?: string }[] } };
  const incomeId = accountQuery?.QueryResponse?.Account?.[0]?.Id;
  if (!incomeId) throw new Error('No Income account found in QBO');

  const r = await qboFetch(conn, '/item', { method: 'POST', body: JSON.stringify({ Name: item.name, Type: 'Service', IncomeAccountRef: { value: incomeId } }) }) as { Item?: { Id?: string } };
  const qboItemId = r?.Item?.Id;
  if (!qboItemId) throw new Error('QBO did not return an Item.Id');

  const nextItems = items.map(i => i.materialId === materialId ? { ...i, qboItemId } : i);
  const nextEstimate = { ...linkedEstimate, items: nextItems };
  // Dual-write: project_financials is authoritative, the legacy column stays in
  // step until the phase-2 drop. Writing only the legacy one would let these
  // qboItemIds be discarded when that migration runs.
  await writeLinkedEstimate(s, projectId, userId, nextEstimate);
}
