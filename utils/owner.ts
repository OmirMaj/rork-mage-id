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

// Keep this list IN SYNC with MASTER_EMAILS in supabase/functions/_shared/auth.ts.
// Drift between client and server master lists creates "I'm an admin on the
// server but the UI shows me as Free" asymmetry that is impossible for the
// owner to debug from inside the app.
const OWNER_EMAILS: readonly string[] = [
  'omirmajeed2000@gmail.com',
  'support@mageid.app',
  // Add other dev/owner emails here as needed.
];

export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}
