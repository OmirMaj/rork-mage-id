// Owner / dev-only gate.
//
// Some features (demo data seeder, debug screens, dev tools) should be
// visible only to the platform owner — not to regular GCs using the app.
// This file centralizes that check so we don't sprinkle email comparisons
// across the codebase.
//
// Usage:
//   import { isOwner } from '@/utils/owner';
//   const { user } = useAuth();
//   if (!isOwner(user?.email)) return <Redirect href="/" />;
//
// To add a co-developer: append their email here. To remove access:
// take their email out and ship an OTA — they'll lose dev access on
// next reload.
//
// We do NOT gate via __DEV__ alone. Production OTA bundles run in
// non-DEV mode but the owner still needs access to seed demo data.

// Keep this list IN SYNC with every server copy (audit wave 5, #1):
//   - MASTER_EMAILS in supabase/functions/_shared/auth.ts (requireTier),
//   - public.is_master_account(uuid) in
//     supabase/migrations/20260922100000_master_account_project_cap.sql
//     (the free-plan project-cap trigger), and
//   - the private MASTER_EMAILS copies in edge functions that can't import
//     _shared/auth.ts's lookup (mcp/index.ts, project-memory-embed/planScopeIo.ts
//     today). The validator below lists every copy it checks and fails on a
//     copy it doesn't know about.
// Drift between client and server master lists creates "I'm an admin on the
// server but the UI shows me as Free" asymmetry that is impossible for the
// owner to debug from inside the app — and a trigger that missed the override
// refused the founder's every new job while the app said "unlimited".
// scripts/validate-w5-project-cap-master-lists.ts fails on any drift.
// A new email here needs a new migration re-creating is_master_account.
const OWNER_EMAILS: readonly string[] = [
  'omirmajeed2000@gmail.com',
  'support@mageid.app',
  // Add other dev/owner emails here as needed.
];

export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}
