import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

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
