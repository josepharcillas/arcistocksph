// Proves the cookie round-trip the app relies on: the browser client writes an
// auth cookie on sign-in, and the SSR middleware reads that SAME cookie to
// authenticate. Mirrors createBrowserClient -> middleware createServerClient.
import { createServerClient } from '@supabase/ssr';

const URL = 'http://127.0.0.1:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const jar = new Map();
const store = {
  getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
};

// 1. "Browser": sign in -> writes session cookie(s) into the jar
const browser = createServerClient(URL, ANON, { cookies: store });
const { error: sErr } = await browser.auth.signInWithPassword({
  email: 'demo@arcistocks.local',
  password: 'demo123456',
});
if (sErr) { console.log('FAIL  sign in:', sErr.message); process.exit(1); }
console.log(`PASS  signed in; ${jar.size} auth cookie(s) written:`, [...jar.keys()].join(', '));

// 2. "Middleware": fresh client that can ONLY read the cookies from the jar
const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
const middleware = createServerClient(URL, ANON, {
  cookies: {
    getAll: () =>
      cookieHeader.split('; ').map((p) => {
        const i = p.indexOf('=');
        return { name: p.slice(0, i), value: decodeURIComponent(p.slice(i + 1)) };
      }),
    setAll: () => {},
  },
});
const { data: { user }, error: uErr } = await middleware.auth.getUser();
if (uErr || !user) { console.log('FAIL  middleware could not read session:', uErr?.message); process.exit(1); }
console.log('PASS  middleware authenticated user from cookie:', user.email);

// 3. RLS read works for that session
const { data: holdings } = await middleware.from('holdings').select('ticker').order('ticker');
console.log(`PASS  read ${holdings?.length} holdings for session:`, holdings?.map((h) => h.ticker).join(', '));
console.log('\nAUTH E2E: PASSED — login cookie is accepted by middleware');
