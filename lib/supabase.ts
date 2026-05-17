import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Single source of truth for the project's Supabase URL + anon key.
// Falls back to hardcoded production credentials so the app works even
// when env vars are missing (e.g., fresh clone, EAS build that lost the
// secret, OTA from before env was set). Other modules MUST import
// SUPABASE_URL / SUPABASE_ANON_KEY from here rather than reading
// process.env directly — otherwise they'll have their own empty-string
// fallback bugs (see Phase 25: the AI was broken for weeks because
// utils/mageAI.ts had `|| ''` instead of the real key).
//
// The anon key is INTENTIONALLY public — RLS protects every table.
// Embedding it in the JS bundle is normal for Supabase + RN.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = SUPABASE_ANON_KEY;

// Pre-fix these logged the first 30 chars of the URL and 20 chars of
// the anon key. Combined with Sentry's enableLogs + sendDefaultPii,
// those fragments ended up in production breadcrumbs. Now we just log
// presence — the keys themselves stay out of logs.
console.log('[Supabase] URL configured:', supabaseUrl.length > 0 ? 'yes' : 'NO');
console.log('[Supabase] Anon key configured:', supabaseAnonKey.length > 0 ? 'yes' : 'NO');

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

let _supabase: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
  console.log('[Supabase] Client initialized successfully.');
} else {
  console.error('[Supabase] CRITICAL: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. Supabase features will NOT work.');
}

export function supabaseGuard(): SupabaseClient {
  if (!isSupabaseConfigured || !_supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY environment variables.');
  }
  return _supabase;
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? _supabase!
  : new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        if (prop === 'auth') {
          return new Proxy({} as SupabaseClient['auth'], {
            get(_t, authProp) {
              if (authProp === 'onAuthStateChange') {
                return (_cb: unknown) => ({ data: { subscription: { unsubscribe: () => {} } } });
              }
              if (authProp === 'getSession') {
                return async () => ({ data: { session: null }, error: null });
              }
              return async () => ({ data: null, error: new Error('Supabase not configured') });
            },
          });
        }
        if (prop === 'from') {
          return () => new Proxy({} as Record<string, unknown>, {
            get() {
              return () => new Proxy({} as Record<string, unknown>, {
                get() {
                  return async () => ({ data: null, error: { message: 'Supabase not configured' } });
                },
              });
            },
          });
        }
        if (prop === 'channel') {
          return () => ({
            on: function () { return this; },
            subscribe: () => 'closed',
          });
        }
        if (prop === 'removeChannel') {
          return async () => {};
        }
        return undefined;
      },
    });
