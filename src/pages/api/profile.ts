import type { APIRoute } from 'astro';
import { queryOne } from '../../lib/db';

export const prerender = false;

interface Profile {
  id: string;
  display_name: string | null;
  leaderboard_opt_in: boolean;
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  const profile = await queryOne<Profile>(
    `select id, display_name, leaderboard_opt_in from profiles where id = $1`,
    [user.id]
  );
  return json({ profile });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { displayName?: string | null; leaderboardOptIn?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  await queryOne(
    `update profiles set display_name = $2, leaderboard_opt_in = $3 where id = $1`,
    [user.id, body.displayName?.trim() || null, !!body.leaderboardOptIn]
  );
  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
