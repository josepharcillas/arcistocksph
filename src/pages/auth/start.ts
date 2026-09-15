import type { APIRoute } from 'astro';
import { beginSignIn, googleConfigured } from '../../lib/google';

export const prerender = false;

/** Kick off the Google flow. Public — this is what an unauthenticated user hits. */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  if (!googleConfigured()) {
    return new Response('Google sign-in is not configured on this server.', { status: 500 });
  }
  try {
    return redirect(await beginSignIn(cookies));
  } catch (err) {
    console.error('[auth/start]', err);
    return redirect('/login?error=' + encodeURIComponent('Could not start sign-in.'));
  }
};
