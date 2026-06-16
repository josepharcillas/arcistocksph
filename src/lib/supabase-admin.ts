import { createClient } from '@supabase/supabase-js';

// SERVER-ONLY service-role client. Bypasses RLS — never import this into a
// client component or expose the key. Used for cross-user aggregation
// (e.g. the public leaderboard) that RLS intentionally blocks for normal users.
export function createSupabaseAdmin() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
