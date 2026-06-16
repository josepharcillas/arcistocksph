import { createBrowserClient } from '@supabase/ssr';

// Browser client — stores the session in cookies (not localStorage) so that
// SSR middleware and API routes can read the same session. See supabase-server.ts
// for the server-side counterpart.
export const supabase = createBrowserClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);
