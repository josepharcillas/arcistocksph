// PM2 process config for production (referenced by .github/workflows/deploy.yml).
// The Astro node adapter builds dist/server/entry.mjs and listens on HOST/PORT.
// Server-side secrets (SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY/GEMINI_API_KEY)
// are loaded at runtime from a .env file placed on the server next to dist/.
// (PUBLIC_SUPABASE_* are baked in at build time by the CI workflow.)
module.exports = {
  apps: [
    {
      name: 'arcistocksph',
      script: './dist/server/entry.mjs',
      node_args: '--env-file=.env', // Node 18.20+/20+/22 — loads ./.env at runtime
      env: {
        HOST: '127.0.0.1',
        PORT: 4321,
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
    },
  ],
};
