# Deploying ArciStocks PH to a Vultr server

This is the one-time setup that takes the app from "works locally" to "running in
production". The deploy itself is automated (`.github/workflows/deploy.yml`):
once set up, every push to `main` builds on GitHub Actions, copies `dist/` to the
server, and restarts the app under PM2.

Architecture reminder: your Vultr box only runs the **Astro Node web app** (capped
at ~300 MB via PM2). Postgres/auth lives on **hosted Supabase** (free tier), and
market data (phisix, PSE Edge) + AI (Gemini/Groq) are external APIs. So the
cheapest Vultr plan (1 vCPU / 1 GB) is plenty.

---

## 1. Hosted Supabase (the database)

1. Create a project at <https://supabase.com> (free tier is fine).
2. Open **SQL Editor** → paste the contents of [`docs/schema.sql`](./schema.sql) → run it.
   This creates all tables, RLS policies, the signup→profile trigger, and the
   `signal_cache` table.
3. From **Project Settings → API**, copy:
   - **Project URL** → `PUBLIC_SUPABASE_URL`
   - **anon public key** → `PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose to the client)
4. Enable **Google OAuth** under **Authentication → Providers** (optional but
   recommended). Add `https://YOUR_DOMAIN/auth/callback` to the redirect allow-list.

## 2. An AI key

Get at least one (the app auto-picks Gemini if set, else Groq):
- **Groq** (free, fast): <https://console.groq.com> → `GROQ_API_KEY`
- **Gemini**: <https://aistudio.google.com/app/apikey> → `GEMINI_API_KEY`

## 3. Provision the Vultr server

1. Deploy a new instance: **Ubuntu 24.04 LTS**, smallest plan with **≥1 GB RAM**.
2. SSH in as root and create a deploy user + install the runtime:

```bash
# as root
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Node 24 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs nginx
npm install -g pm2

# app directory owned by the deploy user
mkdir -p /var/www/arcistocksph
chown -R deploy:deploy /var/www/arcistocksph
```

## 4. SSH key for GitHub Actions

GitHub needs a private key to SSH in and deploy. Generate a dedicated keypair
(on your laptop or the server) — do NOT reuse a personal key:

```bash
ssh-keygen -t ed25519 -f arcistocks_deploy -N "" -C "github-actions"
```

- Append the **public** key (`arcistocks_deploy.pub`) to the server's
  `/home/deploy/.ssh/authorized_keys`.
- Keep the **private** key (`arcistocks_deploy`) for the GitHub secret below.

## 5. GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `PUBLIC_SUPABASE_URL` | from step 1 (baked into the build) |
| `PUBLIC_SUPABASE_ANON_KEY` | from step 1 (baked into the build) |
| `DEPLOY_HOST` | your Vultr IP or domain |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | the **private** key from step 4 (full contents) |

> `SUPABASE_SERVICE_ROLE_KEY` and the AI key are **not** build secrets — they go in
> the server's `.env` (next step) because they're read at runtime.

## 6. Runtime `.env` on the server

PM2 loads `/var/www/arcistocksph/.env` at runtime (`--env-file=.env` in
`ecosystem.config.cjs`). Create it:

```bash
# as deploy, on the server
cat > /var/www/arcistocksph/.env <<'EOF'
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_key
# or GEMINI_API_KEY=your_gemini_key

# REQUIRED for the cron endpoints (snapshot-balances, advisor-alerts) — they 401
# without it. Use any long random string; reuse it in the crontab (step 10).
PUSH_NOTIFY_SECRET=your_long_random_secret

# REQUIRED to view the private bot dashboard (/dashboard/bots). The gate FAILS
# CLOSED — if this is unset, even you are redirected away. Must be the exact
# email you sign in with.
ADMIN_EMAIL=joseph.arcillas26@gmail.com

# OPTIONAL — Web Push (TASK-041). Leave blank to ship without push; advisor-alerts
# + SELL-flip pushes then no-op gracefully. NOTE: PUBLIC_FCM_VAPID_KEY is baked
# into the CLIENT at build time, so to actually enable push you must ALSO add it
# as a GitHub build secret and pass it in deploy.yml's build step — setting it
# only here is not enough for the browser to subscribe.
# PUBLIC_FCM_VAPID_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:you@example.com
EOF
chmod 600 /var/www/arcistocksph/.env
```

> The bots, signal refresh, and dividend tracker all run on an **in-process
> scheduler** (`src/lib/scheduler.ts`, started from middleware) — no external
> crontab needed for those. Tuning/disable knobs (`STOCK_MIN_TURNOVER`,
> `DIVIDEND_MIN_YIELD`, `SIGNAL_REFRESH_*`, `DISABLE_BOT_SCHEDULER=1`, etc.) are
> documented in `.env.example`; the defaults are sensible, so you can omit them.

## 7. Nginx reverse proxy + HTTPS

The app listens on `127.0.0.1:4321`. Put Nginx in front:

```nginx
# /etc/nginx/sites-available/arcistocksph
server {
  listen 80;
  server_name YOUR_DOMAIN;
  location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/arcistocksph /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# free HTTPS
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d YOUR_DOMAIN

# firewall
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

## 8. First deploy

The deploy workflow currently only fires when you push to `main` **without**
`[skip ci]` in the commit message. Until now we've used `[skip ci]` precisely
because the server wasn't ready. To trigger the first real deploy:

```bash
git commit --allow-empty -m "chore: trigger first production deploy"
git push origin main
```

Watch it under the repo's **Actions** tab. It will build, SCP `dist/` +
`ecosystem.config.cjs` to `/var/www/arcistocksph/`, and `pm2 start` the app.

## 9. Verify

```bash
# on the server
pm2 status            # arcistocksph should be "online"
pm2 logs arcistocksph # check for startup errors
curl -I http://127.0.0.1:4321/login   # expect HTTP 200
```

Then open `https://YOUR_DOMAIN/login` and sign in.

## 10. Seed the paper-trading bots (one-time)

The three bots (STOCK AI, CRYPTO AI, DCA 🐢) need their ₱10,000 paper accounts
created once against the prod database, or the scheduler runs them against nothing
and `/dashboard/bots` shows "No bots found". Run the seeder pointed at prod
Supabase (from your laptop with the repo checked out, or on the server):

```bash
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
node scripts/seed-bot.mjs
```

Then sign in as `ADMIN_EMAIL` and open `https://YOUR_DOMAIN/dashboard/bots` — you
should see all three bots at ₱10,000. From here the in-process scheduler grows
them automatically (stocks 2×/weekday, crypto every 4h, DCA weekly). Sanity-check
that terminal and page agree by running `node scripts/scoreboard.mjs` against the
same env.

---

## Scheduled crons (external)

> **Most scheduling is already in-process.** `src/lib/scheduler.ts` (started from
> middleware on the first request after boot) runs the three bots, **signal
> refresh**, the daily report, and the dividend sync + STRONG-ENTRY alerts. Do
> **NOT** add an external `refresh-signals` cron — it would double-run signal
> refresh and waste the AI budget. Only the two endpoints below live *outside* the
> scheduler and need a real crontab.
>
> Because the scheduler starts on the first HTTP request, hit the site once after
> a fresh `pm2 start` (or point an uptime monitor at it) so the bots begin ticking.

The `Content-Type: application/json` header is required on every call — Astro's
CSRF guard rejects server-to-server POSTs without it. All endpoints are protected
by the `PUSH_NOTIFY_SECRET` bearer token (set in the server `.env`, step 6).

For the leaderboard's 7-day / 30-day returns, snapshot balances daily after
market close:

```cron
# 09:00 UTC ≈ 17:00 PHT, weekdays
0 9 * * 1-5 curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_PUSH_NOTIFY_SECRET" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/cron/snapshot-balances
```

(The week/month filters fall back to the ₱100k baseline until snapshots accrue,
so returns become meaningful after a few days of snapshots.)

To push each user the advisor's headline action when it changes, run the
advisor-alerts cron. The in-process scheduler already refreshes signals at 10:00am
+ 2:00pm PHT weekdays, so schedule this a bit after the afternoon refresh warms the
cache:

```cron
# 09:15 UTC ≈ 17:15 PHT, weekdays (after the in-process 2:00pm PHT signal refresh)
15 9 * * 1-5 curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_PUSH_NOTIFY_SECRET" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/cron/advisor-alerts
```

(Requires VAPID keys configured. Dedups on the headline-action signature, so it
only notifies on a change.)

## Notes

- **CI vs deploy:** `ci.yml` (unit tests + build + browser smoke test) runs on
  pull requests and on pushes to `main` that don't carry `[skip ci]`. `deploy.yml`
  also runs on push to `main`. Once the server is configured you can stop adding
  `[skip ci]` so both run on every push.
- **Service worker / updates:** the app prompts users to refresh when a new build
  is deployed (see `src/components/pwa/PwaUpdater.astro`), so they won't get stuck
  on a stale cached bundle.
- **Push notifications** (TASK-041–044) are a separate setup requiring a Firebase
  project + FCM/VAPID keys — not covered here.
