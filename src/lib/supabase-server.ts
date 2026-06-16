import { createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

/**
 * Server-side Supabase client for Astro middleware, pages, and API routes.
 * Reads the session from the request's Cookie header and writes refreshed
 * cookies back through Astro's cookie API — the same cookies the browser
 * client (createBrowserClient) sets. This is what makes SSR auth see the
 * logged-in user instead of bouncing them to /login.
 */
export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  return createServerClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          const header = request.headers.get('cookie') ?? '';
          return header
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => {
              const i = p.indexOf('=');
              return { name: p.slice(0, i), value: decodeURIComponent(p.slice(i + 1)) };
            });
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, options);
          });
        },
      },
    }
  );
}
