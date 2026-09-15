/// <reference path="../.astro/types.d.ts" />
/// <reference types="vite-plugin-pwa/client" />

declare namespace App {
  interface Locals {
    // Set by src/middleware.ts from the session cookie. Null when signed out.
    user: import('./lib/auth').AuthUser | null;
  }
}
