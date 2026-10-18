/* ============================================================
   CENTRAL & STORES — Master SEO Engine v2.1
   Primary canonical domain:
   https://www.central-and-stores.ct.ws/

   Reads seo-config.json for page-specific SEO metadata.
   ============================================================ */

(function () {
  'use strict';

  const PRIMARY_HOST = 'https://www.central-and-stores.ct.ws';
  const NON_WWW_HOST = 'https://central-and-stores.ct.ws';

  /* ---------- FALLBACK CONFIG ---------- */
  const FALLBACK = {
    _meta: {
      canonicalHost: PRIMARY_HOST,
      siteName: 'Central & Stores',
      owner: 'Ahmed',
      phone: '+919344621645',
      email: 'centralstorezmangalam@gmail.com',
      gbpUrl: 'https://maps.app.goo.gl/sSM66eeLdxad84Sq5',
      logoUrl: PRIMARY_HOST + '/logo.png'
    },
    defaults: {
      descriptionFallback:
        'Grocery and department store in Mangalam, Tiruppur. Explore groceries, household items and daily essentials.',
      ogImage: PRIMARY_HOST + '/logo.png',
      ogImageWidth: 1200,
      ogImageHeight: 630,
      twitterCard: 'summary_large_image',
      robots:
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    },
    pages: {}
  };

  /* ---------- URL NORMALIZATION ---------- */
  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') {
      return url;
    }

    if (url.indexOf(NON_WWW_HOST) === 0) {
      return PRIMARY_HOST + url.substring(NON_WWW_HOST.length);
    }

    return url;
  }

  /* ---------- META HELPERS ---------- */
  function upsertMeta(attribute, key, value) {
    if (!value) return;

    let element = document.querySelector(
      'meta[' + attribute + '="' + key + '"]'
    );

    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }

    element.setAttribute('content', value);
  }

  function upsertLink(rel, href) {
    if (!href) return;

    let element = document.querySelector(
      'link[rel="' + rel + '"]'
    );

    if (!element) {
      element = document.createElement('link');
      element.setAttribute('rel', rel);
      document.head.appendChild(element);
    }

    element.setAttribute('href', href);
  }

  function upsertTitle(value) {
    if (value) {
      document.title = value;
    }
  }

  /* ---------- STRUCTURED DATA HELPERS ---------- */
  function hasSchemaType(type) {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    for (let i = 0; i < scripts.length; i++) {
      try {
        const parsed = JSON.parse(scripts[i].textContent || '{}');
        const graph = parsed['@graph'] || [parsed];

        if (
          graph.some(function (item) {
            const types = Array.isArray(item['@type'])
              ? item['@type']
              : [item['@type']];

            return types.indexOf(type) !== -1;
          })
        ) {
          return true;
        }
      } catch (error) {
        // Ignore invalid existing JSON-LD.
      }
    }

    return false;
  }

  function injectSchema(nodes) {
    if (!nodes.length) return;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': nodes
    });

    document.head.appendChild(script);
  }

  /* ---------- CURRENT PAGE PATH ---------- */
  function getCurrentPath() {
    let path = window.location.pathname;

    if (path.indexOf('/shop/') === 0) {
      path = path.replace('/shop/', '/');
    }

    if (path.charAt(0) !== '/') {
      path = '/' + path;
    }

    if (
      !path.endsWith('/') &&
      !/\.[a-z0-9]+$/i.test(path)
    ) {
      path += '/';
    }

    return path;
  }

  /* ---------- LOAD SEO CONFIG ---------- */
  function loadConfig() {
    return fetch('/seo-config.json', {
      cache: 'no-cache'
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Could not load seo-config.json');
        }

        return response.json();
      })
      .catch(function (error) {
        console.warn(
          '[seo-master] Using fallback configuration:',
          error
        );

        return FALLBACK;
      });
  }

  /* ---------- APPLY SEO CONFIG ---------- */
  function applyConfig(config) {
    const meta = config._meta || FALLBACK._meta;
    const defaults = config.defaults || FALLBACK.defaults;

    const configuredHost = (
      meta.canonicalHost || PRIMARY_HOST
    ).replace(/\/+$/, '');

    /*
      Enforce the selected www canonical domain.
      URLs from the previous non-www host are normalized.
    */
    const canonicalHost = PRIMARY_HOST;
    const path = getCurrentPath();

    let pageConfig =
      config.pages && config.pages[path];

    if (!pageConfig) {
      const noTrailingSlash = path.replace(/\/$/, '');

      pageConfig =
        config.pages && config.pages[noTrailingSlash];
    }

    if (!pageConfig && path === '/') {
      pageConfig = config.pages && config.pages['/'];
    }

    /* ---------- TITLE ---------- */
    if (pageConfig && pageConfig.title) {
      upsertTitle(pageConfig.title);

      upsertMeta(
        'property',
        'og:title',
        pageConfig.title
      );

      upsertMeta(
        'name',
        'twitter:title',
        pageConfig.title
      );
    }

    /* ---------- DESCRIPTION ---------- */
    const description =
      (pageConfig && pageConfig.description) ||
      defaults.descriptionFallback ||
      FALLBACK.defaults.descriptionFallback;

    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:description', description);
    upsertMeta('name', 'twitter:description', description);

    /* ---------- KEYWORDS ---------- */
    if (pageConfig && pageConfig.keywords) {
      upsertMeta(
        'name',
        'keywords',
        pageConfig.keywords
      );
    }

    /* ---------- ROBOTS ---------- */
    const robots =
      (pageConfig && pageConfig.robots) ||
      defaults.robots ||
      FALLBACK.defaults.robots;

    upsertMeta('name', 'robots', robots);

    /* ---------- CANONICAL ---------- */
    const canonicalUrl = normalizeUrl(
      canonicalHost + path
    );

    upsertLink('canonical', canonicalUrl);

    /* ---------- OPEN GRAPH URL ---------- */
    upsertMeta(
      'property',
      'og:url',
      canonicalUrl
    );

    /* ---------- OPEN GRAPH IMAGE ---------- */
    const imageUrl = normalizeUrl(
      defaults.ogImage ||
      meta.logoUrl ||
      FALLBACK._meta.logoUrl
    );

    upsertMeta('property', 'og:image', imageUrl);

    upsertMeta(
      'property',
      'og:image:width',
      String(defaults.ogImageWidth || 1200)
    );

    upsertMeta(
      'property',
      'og:image:height',
      String(defaults.ogImageHeight || 630)
    );

    /* ---------- OPEN GRAPH TYPE ---------- */
    upsertMeta(
      'property',
      'og:type',
      (pageConfig && pageConfig.ogType) || 'website'
    );

    upsertMeta(
      'property',
      'og:site_name',
      meta.siteName || FALLBACK._meta.siteName
    );

    upsertMeta(
      'property',
      'og:locale',
      'en_IN'
    );

    /* ---------- TWITTER CARD ---------- */
    upsertMeta(
      'name',
      'twitter:card',
      defaults.twitterCard || 'summary_large_image'
    );

    upsertMeta(
      'name',
      'twitter:image',
      imageUrl
    );

    /* ---------- HTML LANGUAGE ---------- */
    document.documentElement.setAttribute(
      'lang',
      config._meta && config._meta.language
        ? config._meta.language
        : 'en-IN'
    );

    /* ---------- GOOGLE BUSINESS PROFILE ---------- */
    if (meta.gbpUrl) {
      upsertLink('me', meta.gbpUrl);
    }

    /* ---------- ORGANIZATION SCHEMA ---------- */
    const graph = [];
    const organizationId =
      canonicalHost + '/#organization';

    const personId =
      canonicalHost + '/#ahmed';

    if (!hasSchemaType('Organization')) {
      graph.push({
        '@type': 'Organization',
        '@id': organizationId,
        'name': meta.siteName || 'Central & Stores',
        'alternateName': (
          config.brand_aliases || [
            'Central and Stores',
            'Central Stores Mangalam'
          ]
        ).slice(0, 5),
        'url': canonicalHost + '/',
        'logo': {
          '@type': 'ImageObject',
          'url': normalizeUrl(
            meta.logoUrl || FALLBACK._meta.logoUrl
          ),
          'caption': meta.siteName || 'Central & Stores'
        },
        'description': description,
        'telephone': meta.phone,
        'email': meta.email,
        'sameAs': meta.gbpUrl ? [meta.gbpUrl] : []
      });
    }

    /* ---------- PERSON SCHEMA ---------- */
    if (!hasSchemaType('Person')) {
      graph.push({
        '@type': 'Person',
        '@id': personId,
        'name': meta.owner || 'Ahmed',
        'jobTitle': 'Owner',
        'worksFor': {
          '@id': organizationId
        },
        'url': canonicalHost + '/#about',
        'sameAs': meta.gbpUrl ? [meta.gbpUrl] : []
      });
    }

    injectSchema(graph);

    /* ---------- NORMALIZE INTERNAL LINKS ---------- */
    document
      .querySelectorAll('a[href*="central-and-stores.ct.ws"]')
      .forEach(function (anchor) {
        const href = anchor.getAttribute('href');

        if (href) {
          anchor.setAttribute(
            'href',
            normalizeUrl(href)
          );
        }
      });

    /* ---------- FAVICON FALLBACK ---------- */
    if (!document.querySelector('link[rel="icon"]')) {
      upsertLink('icon', '/favicon.png');
    }

    if (
      !document.querySelector(
        'link[rel="apple-touch-icon"]'
      )
    ) {
      upsertLink(
        'apple-touch-icon',
        '/apple-touch-icon.png'
      );
    }
  }

  /* ---------- START ENGINE ---------- */
  function run() {
    loadConfig()
      .then(applyConfig)
      .catch(function (error) {
        console.error(
          '[seo-master] SEO initialization failed:',
          error
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      run,
      { once: true }
    );
  } else {
    run();
  }
})();
