import webpush from 'web-push';
import { query } from '../db';

// SERVER-ONLY. Sends Web Push notifications via VAPID. Never import into client code.

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

// Cheap check so callers can skip push work entirely when keys aren't set.
export function isPushConfigured(): boolean {
  return !!env('PUBLIC_FCM_VAPID_KEY') && !!env('VAPID_PRIVATE_KEY');
}

let configured = false;
function configureVapid(): void {
  if (configured) return;
  const publicKey = env('PUBLIC_FCM_VAPID_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT') ?? 'mailto:admin@arcistocks.local';
  if (!publicKey || !privateKey) {
    throw new Error('Push not configured: set PUBLIC_FCM_VAPID_KEY and VAPID_PRIVATE_KEY');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  ticker?: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Sends to every subscription for one user. Dead endpoints (404/410) are pruned.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  configureVapid();
  const subs = await query<SubRow>(
    `select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1`,
    [userId]
  );
  return sendToSubscriptions(subs, payload);
}

// TASK-043: notify everyone holding `ticker` (who hasn't opted out) about a signal.
export async function notifyHoldersOfSignal(
  ticker: string,
  verdict: string,
  rationale: string
): Promise<number> {
  configureVapid();

  const holders = await query<{ user_id: string }>(
    `select distinct user_id from holdings where ticker = $1`,
    [ticker]
  );
  const userIds = holders.map((h) => h.user_id);
  if (userIds.length === 0) return 0;

  // Respect per-stock opt-out (push_preferences.enabled = false). Absence = opted in.
  const prefs = await query<{ user_id: string; enabled: boolean }>(
    `select user_id, enabled from push_preferences where ticker = $1 and user_id = any($2::text[])`,
    [ticker, userIds]
  );
  const optedOut = new Set(prefs.filter((p) => p.enabled === false).map((p) => p.user_id));
  const recipients = userIds.filter((id) => !optedOut.has(id));
  if (recipients.length === 0) return 0;

  const subs = await query<SubRow>(
    `select id, endpoint, p256dh, auth from push_subscriptions where user_id = any($1::text[])`,
    [recipients]
  );

  const payload: PushPayload = {
    title: `${verdict} signal: ${ticker}`,
    body: rationale.slice(0, 140),
    url: `/stock/${ticker}`,
    ticker,
  };
  return sendToSubscriptions(subs, payload);
}

async function sendToSubscriptions(subs: SubRow[], payload: PushPayload): Promise<number> {
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
        else console.warn('push send failed:', err?.statusCode, err?.body ?? err?.message);
      }
    })
  );

  if (dead.length) await query(`delete from push_subscriptions where id = any($1::uuid[])`, [dead]);
  return sent;
}
