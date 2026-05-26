import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface LinkedEstimateItem { id: string; name: string; qboItemId?: string }
interface ProjectRow { id: string; linked_estimate: { items?: LinkedEstimateItem[] } | null }

/** Object IDs for items are encoded as "<projectId>::<itemId>" since items
 *  don't live in their own table — they're embedded in projects.linked_estimate.items. */
export async function upsertItem(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [projectId, itemId] = encodedId.split('::');
  if (!projectId || !itemId) throw new Error(`bad item id ${encodedId}`);

  const s = svc();
  const { data: row, error } = await s
    .from('projects').select('id,linked_estimate').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`project read: ${error.message}`);
  if (!row) throw new Error('project not found');
  const project = row as ProjectRow;
  const items = project.linked_estimate?.items ?? [];
  const item  = items.find(i => i.id === itemId);
  if (!item) throw new Error(`item ${itemId} not found`);
  if (item.qboItemId) return; // already linked

  // Look up the QBO default "Services" income account once.
  const accountQuery = await qboFetch(conn, "/query?query=" + encodeURIComponent("select Id from Account where AccountType = 'Income' MAXRESULTS 1"), { method: 'GET' }) as { QueryResponse?: { Account?: { Id?: string }[] } };
  const incomeId = accountQuery?.QueryResponse?.Account?.[0]?.Id;
  if (!incomeId) throw new Error('No Income account found in QBO');

  const r = await qboFetch(conn, '/item', { method: 'POST', body: JSON.stringify({ Name: item.name, Type: 'Service', IncomeAccountRef: { value: incomeId } }) }) as { Item?: { Id?: string } };
  const qboItemId = r?.Item?.Id;
  if (!qboItemId) throw new Error('QBO did not return an Item.Id');

  const nextItems = items.map(i => i.id === itemId ? { ...i, qboItemId } : i);
  const nextEstimate = { ...(project.linked_estimate ?? {}), items: nextItems };
  await s.from('projects').update({ linked_estimate: nextEstimate }).eq('id', projectId);
}
