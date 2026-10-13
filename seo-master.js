/* ============================================================
   CENTRAL & STORES — Master SEO Engine
   ------------------------------------------------------------
   Runs on EVERY page. Silent. Idempotent. Zero visual impact.

   WHAT IT DOES
     1. Normalizes canonical URLs to non-www
     2. Ensures og:url and og:image use non-www
     3. Injects Organization schema if missing
     4. Injects Person schema (Ahmed, Owner) if missing
     5. Adds og:image dimensions if missing
     6. Adds Twitter card fallback if missing
     7. Ensures <html lang> is set
     8. Injects GBP <link rel="me"> for entity verification
     9. Fixes www.* → non-www in all <a href> attributes

   CONTRACT
     • Loads on every page
     • Never blocks rendering (small, deferred)
     • Never mutates DOM except <head> and <a href> fixes

   HOW TO INCLUDE (add to every HTML page's <head>):
     <script src="seo-master.js" defer></script>
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONFIG ---------- */
  const CANONICAL_HOST = 'https://central-and-stores.ct.ws';
  const WWW_HOST       = 'https://www.central-and-stores.ct.ws';
  const LOGO_URL       = CANONICAL_HOST + '/logo.png';
  const GBP_URL        = 'https://maps.app.goo.gl/sSM66eeLdxad84Sq5';
  const PHONE          = '+919344621645';
  const EMAIL          = 'centralstorezmangalam@gmail.com';
  const OWNER_NAME     = 'Ahmed';
  const BRAND_NAME     = 'Central & Stores';
  const ORG_ID         = CANONICAL_HOST + '/#organization';
  const PERSON_ID      = CANONICAL_HOST + '/#ahmed';

  /* ---------- Helpers ---------- */
  function normUrl(url) {
    if (!url || typeof url !== 'string') return url;
    return url.replace(WWW_HOST, CANONICAL_HOST);
  }

  function upsertMeta(attr, key, value) {
    let el = document.querySelector('meta[' + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  function upsertLink(rel, href, extraAttrs) {
    let el = document.querySelector('link[rel="' + rel + '"]' + (extraAttrs ? '[href*="' + extraAttrs + '"]' : ''));
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
    return el;
  }

  function hasSchemaType(type) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || '';
      if (text.indexOf('"' + type + '"') !== -1) return true;
    }
    return false;
  }

  function injectSchema(graphNode) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': graphNode
    });
    document.head.appendChild(script);
  }

  /* ---------- 1. Canonical + og:url normalization ---------- */
  function fixCanonical() {
    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href) {
      canonical.href = normUrl(canonical.href);
    } else {
      // Build from current URL, strip query + fragment, force non-www
      const clean = (window.location.origin + window.location.pathname).replace(WWW_HOST, CANONICAL_HOST);
      upsertLink('canonical', clean);
    }

    // og:url
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.setAttribute('content', normUrl(ogUrl.getAttribute('content')));
    } else {
      const clean = normUrl(window.location.origin + window.location.pathname);
      upsertMeta('property', 'og:url', clean);
    }
  }

  /* ---------- 2. Social meta enrichment ---------- */
  function enrichSocialMeta() {
    // og:image — force non-www + add dims
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) {
      ogImg.setAttribute('content', normUrl(ogImg.getAttribute('content')));
    } else {
      upsertMeta('property', 'og:image', LOGO_URL);
    }

    // og:image dims
    if (!document.querySelector('meta[property="og:image:width"]')) {
      upsertMeta('property', 'og:image:width', '1200');
    }
    if (!document.querySelector('meta[property="og:image:height"]')) {
      upsertMeta('property', 'og:image:height', '630');
    }

    // og:site_name
    if (!document.querySelector('meta[property="og:site_name"]')) {
      upsertMeta('property', 'og:site_name', BRAND_NAME);
    }

    // og:locale
    if (!document.querySelector('meta[property="og:locale"]')) {
      upsertMeta('property', 'og:locale', 'en_IN');
    }

    // og:type
    if (!document.querySelector('meta[property="og:type"]')) {
      upsertMeta('property', 'og:type', 'website');
    }

    // Twitter fallbacks
    if (!document.querySelector('meta[name="twitter:card"]')) {
      upsertMeta('name', 'twitter:card', 'summary_large_image');
    }
    if (!document.querySelector('meta[name="twitter:title"]')) {
      const t = document.querySelector('meta[property="og:title"]');
      upsertMeta('name', 'twitter:title', t ? t.getAttribute('content') : BRAND_NAME);
    }
    if (!document.querySelector('meta[name="twitter:description"]')) {
      const d = document.querySelector('meta[property="og:description"]');
      upsertMeta('name', 'twitter:description', d ? d.getAttribute('content') : 'Trusted grocery store in Mangalam, Tiruppur.');
    }
    if (!document.querySelector('meta[name="twitter:image"]')) {
      upsertMeta('name', 'twitter:image', LOGO_URL);
    }
  }

  /* ---------- 3. HTML lang ---------- */
  function fixHtmlLang() {
    const html = document.documentElement;
    if (!html.getAttribute('lang')) {
      html.setAttribute('lang', 'en-IN');
    }
  }

  /* ---------- 4. GBP <link rel="me"> ---------- */
  function injectGbpMe() {
    upsertLink('me', GBP_URL);
  }

  /* ---------- 5. Organization + Person schema ---------- */
  function injectEntitySchema() {
    const graph = [];

    if (!hasSchemaType('Organization')) {
      graph.push({
        '@type': 'Organization',
        '@id': ORG_ID,
        'name': BRAND_NAME,
        'alternateName': ['Central and Stores', 'Central Stores Mangalam'],
        'url': CANONICAL_HOST + '/',
        'logo': {
          '@type': 'ImageObject',
          'url': LOGO_URL,
          'caption': BRAND_NAME
        },
        'description': 'Trusted grocery and department store in Mangalam, Tiruppur.',
        'telephone': PHONE,
        'email': EMAIL,
        'founder': { '@id': PERSON_ID },
        'address': {
          '@type': 'PostalAddress',
          'streetAddress': '1/90 C Tirupur Main Road',
          'addressLocality': 'Mangalam',
          'addressRegion': 'Tamil Nadu',
          'postalCode': '641663',
          'addressCountry': 'IN'
        },
        'sameAs': [GBP_URL]
      });
    }

    if (!hasSchemaType('Person')) {
      graph.push({
        '@type': 'Person',
        '@id': PERSON_ID,
        'name': OWNER_NAME,
        'jobTitle': 'Owner',
        'worksFor': { '@id': ORG_ID },
        'url': CANONICAL_HOST + '/#about',
        'sameAs': [GBP_URL]
      });
    }

    if (graph.length > 0) {
      injectSchema(graph);
    }
  }

  /* ---------- 6. Fix www.* in all <a href> ---------- */
  function fixAnchorHrefs() {
    document.querySelectorAll('a[href*="www.central-and-stores.ct.ws"]').forEach(function (a) {
      const href = a.getAttribute('href');
      if (href) a.setAttribute('href', normUrl(href));
    });
  }

  /* ---------- 7. Ensure favicon + apple-touch-icon exist ---------- */
  function ensureIcons() {
    if (!document.querySelector('link[rel="icon"]')) {
      upsertLink('icon', '/favicon.png');
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      upsertLink('apple-touch-icon', '/apple-touch-icon.png');
    }
  }

  /* ---------- Run ---------- */
  function run() {
    try { fixCanonical(); } catch (e) {}
    try { enrichSocialMeta(); } catch (e) {}
    try { fixHtmlLang(); } catch (e) {}
    try { injectGbpMe(); } catch (e) {}
    try { injectEntitySchema(); } catch (e) {}
    try { fixAnchorHrefs(); } catch (e) {}
    try { ensureIcons(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
