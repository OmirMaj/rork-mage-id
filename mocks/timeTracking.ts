// This file used to export CREW_MEMBERS — a hardcoded list of fake
// worker names ("Carlos Mendez / James Williams / Mike Thompson") that
// surfaced to every customer of the app via the clock-in modal.
//
// The roster is now real, persisted, and per-org. See:
//   - hooks/useWorkers.ts  — the hook the time-tracking screen reads
//   - supabase/migrations/create_workers.sql — table + RLS
//
// Keeping the file (empty) so any in-flight branches that still
// `import` from this path get a clean diff to delete the import rather
// than a "module not found" build break.
export {};
