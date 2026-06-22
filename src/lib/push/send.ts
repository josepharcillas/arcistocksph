import webpush from 'web-push';
import { createSupabaseAdmin } from '../supabase-admin';

// SERVER-ONLY. Sends Web Push notifications via VAPID. Never import into client code.

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
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
  const admin = createSupabaseAdmin();
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  return sendToSubscriptions(admin, (subs ?? []) as SubRow[], payload);
}

// TASK-043: notify everyone holding `ticker` (who hasn't opted out for it) about a signal.
export async function notifyHoldersOfSignal(
  ticker: string,
  verdict: string,
  rationale: string
): Promise<number> {
  configureVapid();
  const admin = createSupabaseAdmin();

  const { data: holdings } = await admin
    .from('holdings')
    .select('user_id')
    .eq('ticker', ticker);
  const userIds = [...new Set((holdings ?? []).map((h: any) => h.user_id))];
  if (userIds.length === 0) return 0;

  // Respect per-stock opt-out (push_preferences.enabled = false). Absence = opted in.
  const { data: prefs } = await admin
    .from('push_preferences')
    .select('user_id, enabled')
    .eq('ticker', ticker)
    .in('user_id', userIds);
  const optedOut = new Set((prefs ?? []).filter((p: any) => p.enabled === false).map((p: any) => p.user_id));
  const recipients = userIds.filter((id) => !optedOut.has(id));
  if (recipients.length === 0) return 0;

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipients);

  const payload: PushPayload = {
    title: `${verdict} signal: ${ticker}`,
    body: rationale.slice(0, 140),
    url: `/stock/${ticker}`,
    ticker,
  };
  return sendToSubscriptions(admin, (subs ?? []) as SubRow[], payload);
}

async function sendToSubscriptions(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subs: SubRow[],
  payload: PushPayload
): Promise<number> {
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

  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return sent;
}
