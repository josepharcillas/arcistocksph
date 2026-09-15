import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/auth';

export const prerender = false;

/** Drop the session cookie. The session is stateless, so this is all sign-out is. */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  clearSessionCookie(cookies);
  return redirect('/login');
};

export const GET = POST;
