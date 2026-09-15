import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { AstroCookies } from 'astro';

/**
 * Google sign-in (OpenID Connect authorization code flow with PKCE).
 *
 * Google is only ever asked "who is this?" — scopes are openid/email/profile and
 * nothing else. The access token it returns is discarded unread; the identity
 * comes from the id_token, whose signature is verified against Google's keys.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const FLOW_COOKIE = 'stocks_oauth';

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export function googleConfigured(): boolean {
  return !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
}

function clientId(): string {
  const v = env('GOOGLE_CLIENT_ID');
  if (!v) throw new Error('GOOGLE_CLIENT_ID is not set');
  return v;
}

function clientSecret(): string {
  const v = env('GOOGLE_CLIENT_SECRET');
  if (!v) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  return v;
}

/**
 * The redirect URI, which must match Google's registered value byte for byte.
 *
 * Derived from a configured origin rather than from the incoming request: an
 * attacker-controlled Host header would otherwise be able to steer where the
 * code is sent back to.
 */
export function redirectUri(): string {
  const origin = env('PUBLIC_ORIGIN');
  if (!origin) throw new Error('PUBLIC_ORIGIN is not set');
  return `${origin.replace(/\/$/, '')}/auth/callback`;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  // Memoised so jose's internal cache survives between requests instead of
  // re-fetching Google's certs on every sign-in.
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedSecret: Uint8Array | null = null;
function flowSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = env('SESSION_SECRET');
  if (!raw || raw.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

/**
 * Begin sign-in: mint state, nonce and a PKCE verifier, stash them in a signed
 * short-lived cookie, and return the URL to send the browser to.
 *
 * The three guards do different jobs and all three are needed: `state` proves
 * the callback belongs to a flow this browser started, `nonce` binds the
 * id_token to that same flow, and PKCE stops a stolen authorization code being
 * redeemed by anyone who did not start it.
 */
export async function beginSignIn(cookies: AstroCookies): Promise<string> {
  const state = base64url(randomBytes(24));
  const nonce = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());

  const flowToken = await new SignJWT({ state, nonce, verifier })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(flowSecret());

  cookies.set(FLOW_COOKIE, flowToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env('STOCKS_INSECURE_COOKIES') !== '1',
    path: '/',
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Google only returns a verified email claim reliably when it knows we want
    // the account picker rather than a silent re-auth.
    prompt: 'select_account',
  });

  return `${AUTH_ENDPOINT}?${params}`;
}

export interface GoogleIdentity {
  email: string;
  name?: string;
}

export class SignInError extends Error {}

/**
 * Finish sign-in: validate state, exchange the code, verify the id_token.
 *
 * Throws SignInError with a message safe to show the user; anything else is a
 * bug worth a 500.
 */
export async function completeSignIn(
  cookies: AstroCookies,
  code: string,
  state: string
): Promise<GoogleIdentity> {
  const flowToken = cookies.get(FLOW_COOKIE)?.value;
  cookies.delete(FLOW_COOKIE, { path: '/' });
  if (!flowToken) throw new SignInError('Your sign-in took too long. Please try again.');

  let flow: Record<string, unknown>;
  try {
    flow = (await jwtVerify(flowToken, flowSecret())).payload;
  } catch {
    throw new SignInError('Your sign-in expired. Please try again.');
  }

  if (typeof flow.state !== 'string' || flow.state !== state) {
    throw new SignInError('Sign-in could not be verified. Please try again.');
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: String(flow.verifier ?? ''),
    }),
  });

  if (!res.ok) {
    // Google's body names the real cause (redirect_uri_mismatch, invalid_client)
    // and is worth having in the log even though the user sees a generic message.
    console.error('[google] token exchange failed:', res.status, await res.text().catch(() => ''));
    throw new SignInError('Google rejected the sign-in. Please try again.');
  }

  const body = await res.json();
  const idToken = body.id_token;
  if (typeof idToken !== 'string') throw new SignInError('Google did not return an identity.');

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keySet(), {
      issuer: ISSUERS,
      audience: clientId(),
    }));
  } catch (err) {
    console.error('[google] id_token verification failed:', err);
    throw new SignInError('Could not verify the Google sign-in.');
  }

  if (payload.nonce !== flow.nonce) {
    throw new SignInError('Sign-in could not be verified. Please try again.');
  }

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!email) throw new SignInError('That Google account has no email address.');

  // An unverified address could be anyone's claim, which would make the
  // allowlist meaningless.
  if (payload.email_verified !== true) {
    throw new SignInError('That Google account has an unverified email address.');
  }

  return { email, name: typeof payload.name === 'string' ? payload.name : undefined };
}
