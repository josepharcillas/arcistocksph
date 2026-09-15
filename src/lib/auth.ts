import { SignJWT, jwtVerify } from 'jose';
import type { AstroCookies } from 'astro';

/**
 * Sessions and the allowlist.
 *
 * The session is a signed JWT in an httpOnly cookie — stateless, so there is no
 * session table to expire or clean up, and no third-party auth service in the
 * request path. (The previous Supabase-hosted auth is what took this app down
 * when that project was deleted.)
 *
 * Identity is the verified Google email. It is also the primary key users are
 * stored under, so a session survives a database rebuild.
 */

const SESSION_COOKIE = 'stocks_session';
const SESSION_DAYS = 30;

export interface AuthUser {
  /** Stable per-user key — the verified Google email, lowercased. */
  id: string;
  email: string;
}

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

let cachedSecret: Uint8Array | null = null;

function secret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = env('SESSION_SECRET');
  // Refusing to run is the right failure. A generated-per-boot fallback would
  // "work" in testing and then silently log everyone out on every deploy, and a
  // hardcoded default would be worse than either.
  if (!raw || raw.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

/**
 * Addresses permitted to sign in. Read fresh so a change needs no rebuild.
 *
 * ArciStocks has a public leaderboard and is meant to be open, so the normal
 * production value is `*`. The list form is here for staging and for locking
 * the app down in a hurry without a redeploy.
 */
export function allowedEmails(): string[] {
  return (env('STOCKS_ALLOWED_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the app is open to any Google account. */
export function isOpenToEveryone(): boolean {
  return allowedEmails().includes('*');
}

export function isAllowed(email: string): boolean {
  const list = allowedEmails();

  // `*` opens the app to anyone with a Google account. It has to be written out
  // explicitly rather than being what an empty value means: a typo or a dropped
  // environment variable should lock us out, never silently open the door.
  if (list.includes('*')) return true;

  if (list.length === 0) {
    console.error('[auth] STOCKS_ALLOWED_EMAILS is empty — nobody can sign in');
    return false;
  }
  return list.includes(email.toLowerCase());
}

export async function createSessionCookie(cookies: AstroCookies, email: string): Promise<void> {
  const token = await new SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a top-level navigation from
    // accounts.google.com, and Strict would withhold the cookie on that first
    // hop back, bouncing the user straight to the login page they just left.
    sameSite: 'lax',
    secure: env('STOCKS_INSECURE_COOKIES') !== '1',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * The signed-in user, or null.
 *
 * Verifies the signature and then re-checks the allowlist, so revoking access
 * takes effect on the next request rather than whenever the token happens to
 * expire.
 */
export async function getSessionUser(cookies: AstroCookies): Promise<AuthUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!email || !isAllowed(email)) return null;
    return { id: email, email };
  } catch {
    // Expired or tampered — treated the same as not being signed in at all.
    return null;
  }
}
