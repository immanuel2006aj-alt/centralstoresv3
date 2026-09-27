/* ============================================================
   CENTRAL & STORES — Supabase Configuration
   ------------------------------------------------------------
   Public anon key only. Never place the service-role key,
   database password, or any private secret in this file.

   CONTRACT
     window.db  → a single shared Supabase client

   Every page that needs data reads from window.db.
   No other file creates its own client.

   AUTH OPTIONS
     persistSession    : true  → admin login survives reloads
     autoRefreshToken  : true  → silent token refresh
     detectSessionInUrl: true  → handles magic-link callbacks

   The public site never reads the session, so these options
   are harmless for customers and required for admin.
   ============================================================ */

(function () {
  'use strict';

  const SUPABASE_URL = 'https://xcdzozyhvkonvesqvxbp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZHpvenlodmtvbnZlc3F2eGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDIwMTYsImV4cCI6MjEwNTQ3ODAxNn0.mX0u55mSR14FGr8Lt6ofENfaOqH6JcGp4ACjKnC3gKA';

  /* The Supabase CDN script loads with `defer`, and this file
     also loads with `defer`, so ordering is guaranteed by HTML.
     The guard below protects against the CDN failing to load
     (offline, blocked, or CSP) without throwing a hard error. */

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error(
      '[Central & Stores] Supabase client library failed to load. ' +
      'Data-driven sections will not work until the CDN script is reachable.'
    );
    window.db = null;
    return;
  }

  if (window.db) {
    /* Prevent accidental double-initialisation if this file is
       included twice on the same page. */
    return;
  }

  try {
    window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: {
          'x-application-name': 'central-and-stores-web'
        }
      }
    });
  } catch (err) {
    console.error('[Central & Stores] Failed to initialise Supabase client.', err);
    window.db = null;
  }
})();