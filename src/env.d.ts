/// <reference path="../.astro/types.d.ts" />
/// <reference types="vite-plugin-pwa/client" />

declare namespace App {
  interface Locals {
    // Set by src/middleware.ts on protected /dashboard routes.
    user: import('@supabase/supabase-js').User | null;
  }
}
