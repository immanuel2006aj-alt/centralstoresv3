/* ============================================================
   CENTRAL & STORES — Master SEO Engine v2.0
   ------------------------------------------------------------
   Runs on EVERY page. Silent. Idempotent. Reads seo-config.json
   for page-specific SEO overrides.

   WHAT IT DOES
     1. Fetches /seo-config.json
     2. Detects the current page path
     3. Applies per-page title / description / keywords / robots
     4. Normalizes canonical to non-www
     5. Ensures og:url and og:image use non-www
     6. Injects Organization + Person schema if missing
     7. Adds og:image dims, og:locale, og:site_name if missing
     8. Adds Twitter card fallback if missing
     9. Ensures <html lang="en-IN">
    10. Injects GBP <link rel="me"> for entity verification
    11. Fixes www.* → non-www in all <a href> attributes

   CONTRACT
     • Loads on every page
     • Never blocks rendering (defer + async fetch)
     • Never mutates DOM except <head> and <a href> fixes
     • Falls back gracefully if seo-config.json is missing

   HOW TO INCLUDE:
     <script src="seo-master.js" defer></script>
   ============================================================ */

(function () {
  'use strict';

  /* ---------- FALLBACK CONFIG (used if seo-config.json unavailable) ---------- */
  const FALLBACK = {
    _meta: {
      canonicalHost: 'https://central-and-stores.ct.ws',
      siteName: 'Central & Stores',
      owner: 'Ahmed',
      phone: '+919344621645',
      email: 'centralstorezmangalam@gmail.com',
      gbpUrl: 'https://maps.app.goo.gl/sSM66eeLdxad84Sq5',
      logoUrl: 'https://central-and-stores.ct.ws/logo.png'
    },
    defaults: {
      descriptionFallback: 'Trusted grocery and department store in Mangalam, Tiruppur. Fresh groceries, household items, daily essentials with free same-day home delivery.',
      ogImage: 'https://central-and-stores.ct.ws/logo.png',
      ogImageWidth: 1200,
      ogImageHeight: 630,
      twitterCard: 'summary_large_image',
      robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    },
    pages: {}
  };

  /* ---------- Helpers ---------- */
  function normUrl(url, canonicalHost, wwwHost) {
    if (!url || typeof url !== 'string') return url;
    return url.replace(wwwHost, canonicalHost);
  }

  function upsertMeta(attr, key, value) {
    if (!value) return;
    let el = document.querySelector('meta[' + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  function upsertLink(rel, href) {
    if (!href) return;
    let el = document.querySelector('link[rel="' + rel + '"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  function upsertTitle(value) {
    if (!value) return;
    document.title = value;
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

  /* ---------- Path detection ---------- */
  function getCurrentPath() {
    let path = window.location.pathname;

    // Normalize: strip /shop/ prefix if the proxy added it
    if (path.indexOf('/shop/') === 0) {
      path = path.replace('/shop/', '/');
    }

    // Ensure leading slash
    if (path.charAt(0) !== '/') path = '/' + path;

    // If path is a folder, normalize to trailing slash
    if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) {
      path = path + '/';
    }

    return path;
  }

  /* ---------- Fetch config ---------- */
  function loadConfig() {
    return fetch('/seo-config.json', { cache: 'force-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('config not found');
        return res.json();
      })
      .catch(function () {
        return FALLBACK;
      });
  }

  /* ---------- Apply config to page ---------- */
  function applyConfig(config) {
    const meta = config._meta || FALLBACK._meta;
    const defaults = config.defaults || FALLBACK.defaults;
    const canonicalHost = meta.canonicalHost || FALLBACK._meta.canonicalHost;
    const wwwHost = canonicalHost.replace('https://', 'https://www.');
    const path = getCurrentPath();

    // Find page entry — exact match, then try without trailing slash, then home fallback
    let pageCfg = config.pages && config.pages[path];
    if (!pageCfg) {
      const noSlash = path.replace(/\/$/, '');
      pageCfg = config.pages && config.pages[noSlash];
    }
    if (!pageCfg && path === '/') {
      pageCfg = config.pages && config.pages['/'];
    }

    /* --- Title --- */
    if (pageCfg && pageCfg.title) {
      upsertTitle(pageCfg.title);
      upsertMeta('property', 'og:title', pageCfg.title);
      upsertMeta('name', 'twitter:title', pageCfg.title);
    }

    /* --- Description --- */
    const desc = (pageCfg && pageCfg.description) || defaults.descriptionFallback;
    if (desc) {
      upsertMeta('name', 'description', desc);
      upsertMeta('property', 'og:description', desc);
      upsertMeta('name', 'twitter:description', desc);
    }

    /* --- Keywords --- */
    if (pageCfg && pageCfg.keywords) {
      upsertMeta('name', 'keywords', pageCfg.keywords);
    }

    /* --- Robots --- */
    const robots = (pageCfg && pageCfg.robots) || defaults.robots;
    if (robots) {
      upsertMeta('name', 'robots', robots);
    }

    /* --- Canonical --- */
    const canonical = document.querySelector('link[rel="canonical"]');
    const cleanUrl = (canonicalHost + path).replace(/\/+$/, '/');
    if (canonical) {
      canonical.href = normUrl(canonical.href || cleanUrl, canonicalHost, wwwHost);
    } else {
      upsertLink('canonical', cleanUrl);
    }

    /* --- og:url --- */
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.setAttribute('content', normUrl(ogUrl.getAttribute('content') || cleanUrl, canonicalHost, wwwHost));
    } else {
      upsertMeta('property', 'og:url', cleanUrl);
    }

    /* --- og:image --- */
    const ogImg = document.querySelector('meta[property="og:image"]');
    const imgUrl = defaults.ogImage || (meta.logoUrl || FALLBACK._meta.logoUrl);
    if (ogImg) {
      ogImg.setAttribute('content', normUrl(ogImg.getAttribute('content') || imgUrl, canonicalHost, wwwHost));
    } else {
      upsertMeta('property', 'og:image', imgUrl);
    }

    /* --- og:image dims --- */
    if (!document.querySelector('meta[property="og:image:width"]')) {
      upsertMeta('property', 'og:image:width', String(defaults.ogImageWidth || 1200));
    }
    if (!document.querySelector('meta[property="og:image:height"]')) {
      upsertMeta('property', 'og:image:height', String(defaults.ogImageHeight || 630));
    }

    /* --- og:type / og:site_name / og:locale --- */
    if (pageCfg && pageCfg.ogType) {
      upsertMeta('property', 'og:type', pageCfg.ogType);
    } else if (!document.querySelector('meta[property="og:type"]')) {
      upsertMeta('property', 'og:type', 'website');
    }

    if (!document.querySelector('meta[property="og:site_name"]')) {
      upsertMeta('property', 'og:site_name', meta.siteName || FALLBACK._meta.siteName);
    }
    if (!document.querySelector('meta[property="og:locale"]')) {
      upsertMeta('property', 'og:locale', 'en_IN');
    }

    /* --- Twitter card --- */
    if (!document.querySelector('meta[name="twitter:card"]')) {
      upsertMeta('name', 'twitter:card', defaults.twitterCard || 'summary_large_image');
    }
    if (!document.querySelector('meta[name="twitter:image"]')) {
      upsertMeta('name', 'twitter:image', imgUrl);
    }

    /* --- HTML lang --- */
    if (!document.documentElement.getAttribute('lang')) {
      document.documentElement.setAttribute('lang', 'en-IN');
    }

    /* --- GBP <link rel="me"> --- */
    if (meta.gbpUrl) {
      upsertLink('me', meta.gbpUrl);
    }

    /* --- Entity schema (Organization + Person) --- */
    const graph = [];
    const ORG_ID = canonicalHost + '/#organization';
    const PERSON_ID = canonicalHost + '/#ahmed';

    if (!hasSchemaType('Organization')) {
      graph.push({
        '@type': 'Organization',
        '@id': ORG_ID,
        'name': meta.siteName,
        'alternateName': (config.brand_aliases || ['Central and Stores', 'Central Stores Mangalam']).slice(0, 5),
        'url': canonicalHost + '/',
        'logo': {
          '@type': 'ImageObject',
          'url': meta.logoUrl || FALLBACK._meta.logoUrl,
          'caption': meta.siteName
        },
        'description': defaults.descriptionFallback,
        'telephone': meta.phone,
        'email': meta.email,
        'founder': { '@id': PERSON_ID },
        'sameAs': meta.gbpUrl ? [meta.gbpUrl] : []
      });
    }

    if (!hasSchemaType('Person')) {
      graph.push({
        '@type': 'Person',
        '@id': PERSON_ID,
        'name': meta.owner || 'Ahmed',
        'jobTitle': 'Owner',
        'worksFor': { '@id': ORG_ID },
        'url': canonicalHost + '/#about',
        'sameAs': meta.gbpUrl ? [meta.gbpUrl] : []
      });
    }

    if (graph.length > 0) {
      injectSchema(graph);
    }

    /* --- Fix www.* in <a href> --- */
    document.querySelectorAll('a[href*="www.central-and-stores"]').forEach(function (a) {
      const href = a.getAttribute('href');
      if (href) a.setAttribute('href', normUrl(href, canonicalHost, wwwHost));
    });

    /* --- Favicon fallback --- */
    if (!document.querySelector('link[rel="icon"]')) {
      upsertLink('icon', '/favicon.png');
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      upsertLink('apple-touch-icon', '/apple-touch-icon.png');
    }
  }

  /* ---------- Run ---------- */
  function run() {
    loadConfig()
      .then(applyConfig)
      .catch(function (err) {
        // Even if everything fails, apply the fallback
        if (window.console && console.warn) {
          console.warn('[seo-master] config load failed, using fallback:', err);
        }
        try { applyConfig(FALLBACK); } catch (e) {}
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();