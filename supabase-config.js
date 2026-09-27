/* ============================================================
   CENTRAL & STORES — Supabase Configuration
   ------------------------------------------------------------
   Public anon key only. Never place the service-role key,
   database password, or any private secret in this file.

   CONTRACT
     window.db              → a single shared Supabase client
                              (or null if the SDK failed to load)
     window.dbReady         → true when window.db is usable
     window.dbReadyPromise  → Promise<client|null>, resolves once
                              initialisation has been attempted.
                              Never rejects — settles to null on
                              failure so callers can fall back
                              without a try/catch.

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

  /* ----------------------------------------------------------
     Resolver — every exit path of this file calls settle()
     exactly once. Consumers `await window.dbReadyPromise`
     and always receive either the client or null.
  ---------------------------------------------------------- */

  let _resolve;
  window.dbReadyPromise = new Promise(function (resolve) {
    _resolve = resolve;
  });

  function settle(client) {
    window.db = client;
    window.dbReady = client !== null && client !== undefined;
    _resolve(client);
  }

  /* ----------------------------------------------------------
     Guard 1 — SDK present?
     The Supabase CDN script loads with `defer`; this file also
     loads with `defer`, so ordering is guaranteed by the HTML.
     If the CDN is unreachable (offline, blocked, CSP) we still
     resolve the promise so callers don't hang forever.
  ---------------------------------------------------------- */

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error(
      '[Central & Stores] Supabase client library failed to load. ' +
      'Data-driven sections will be unavailable until the CDN script is reachable.'
    );
    settle(null);
    return;
  }

  /* ----------------------------------------------------------
     Guard 2 — already initialised?
     Protects against this file being included twice on the
     same page. The existing client is reused.
  ---------------------------------------------------------- */

  if (window.db) {
    settle(window.db);
    return;
  }

  /* ----------------------------------------------------------
     Initialise
  ---------------------------------------------------------- */

  try {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    settle(client);
  } catch (err) {
    console.error('[Central & Stores] Failed to initialise Supabase client.', err);
    settle(null);
  }
})();
