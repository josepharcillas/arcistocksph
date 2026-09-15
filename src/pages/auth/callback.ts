import type { APIRoute } from 'astro';
import { completeSignIn, SignInError } from '../../lib/google';
import { createSessionCookie, isAllowed } from '../../lib/auth';
import { getOrCreateUser } from '../../lib/repo';

export const prerender = false;

/** Where Google sends the browser back. Public by necessity. */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const fail = (msg: string) => redirect('/login?error=' + encodeURIComponent(msg));

  // The user cancelled, or Google refused before we ever got a code.
  const denied = url.searchParams.get('error');
  if (denied) return fail(denied === 'access_denied' ? 'Sign-in was cancelled.' : denied);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Sign-in did not complete. Please try again.');

  let identity;
  try {
    identity = await completeSignIn(cookies, code, state);
  } catch (err) {
    if (err instanceof SignInError) return fail(err.message);
    console.error('[auth/callback]', err);
    return fail('Something went wrong signing in.');
  }

  // Google has proved who they are; this decides whether that person may in.
  // Normally open (STOCKS_ALLOWED_EMAILS=*) — see src/lib/auth.ts.
  if (!isAllowed(identity.email)) {
    console.warn(`[auth] rejected sign-in from ${identity.email}`);
    return fail('That account is not allowed to sign in to ArciStocks.');
  }

  try {
    await getOrCreateUser(identity.email, identity.name);
  } catch (err) {
    // Signing someone in without a profile row would hand them a session that
    // 500s on every page that joins to it, so fail here where we can explain.
    console.error('[auth/callback] database unavailable:', err);
    return fail('ArciStocks cannot reach its database right now. Try again shortly.');
  }

  await createSessionCookie(cookies, identity.email);
  return redirect('/dashboard');
};
