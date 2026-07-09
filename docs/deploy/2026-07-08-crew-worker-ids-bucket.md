# Crew / Worker-IDs — owner deploy runbook (2026-07-08)

Two owner-only steps. Do BOTH before publishing the OTA that ships app/crew.tsx.

## 1. Apply the migration
Supabase MCP `apply_migration` (project nteoqhcswappxxjlpvap), name `crew_members`,
body = supabase/migrations/20260708130000_crew_members.sql. NEVER `supabase db push`
(divergent history). Verify with `execute_sql`:
`select column_name from information_schema.columns where table_name='crew_members';`

## 2. Create the private `worker-ids` storage bucket
Only needed for the opt-in "retain raw ID image" path (default flow stores NO image).
- Storage → New bucket → name `worker-ids`, **Public = OFF** (private).
- RLS on storage.objects, folder-scoped to the owner (folder[1] = auth.uid()):

```sql
create policy "worker_ids_rw_own" on storage.objects
  for all using (
    bucket_id = 'worker-ids' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'worker-ids' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Retention: deleting a CrewMember purges its retained image (CrewContext.deleteCrewMember →
deleteStorageFile('worker-ids', idImagePath)). Document a retention window in the privacy policy.
