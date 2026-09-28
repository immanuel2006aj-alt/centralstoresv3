/* ============================================================
   CENTRAL & STORES — Advertisements Module
   ------------------------------------------------------------
   RESPONSIBILITY
     • Fetch eligible ads from Supabase for a given placement.
     • Render ads into a container with responsive images.
     • Track impressions (once per session per ad) and clicks
       via SECURITY DEFINER RPCs.
     • Validate CTA URLs to prevent unsafe schemes.

   PUBLIC API
     Ads.getForPlacement(placement, options)  → Promise<Array>
     Ads.renderInto(container, placement, options) → Promise<Boolean>
     Ads.trackImpression(id)
     Ads.trackClick(id)
     Ads.previewRender(container, adRecord)

   OPTIONS
     {
       category: string | null,   // match ads whose target_category
                                  // equals this OR target_category is null
       productId: number | null,  // match ads whose target_product_id
                                  // equals this OR target_product_id is null
       limit: number,             // default 1
       trackImpressions: boolean, // default true
     }

   CONTRACT WITH index.html
     <section data-ad-placement="homepage_promotional_banner">
       <div class="ad-slot" id="...">  ← renderInto target
     </section>

   CONTRACT WITH supabase-config.js
     window.db              (client) OR
     window.dbReadyPromise  (Promise resolving to client|null)

   SECURITY
     • Reads via anon key + RLS. Public can only see active,
       in-window ads.
     • CTA URLs validated. javascript:/data:/vbscript: rejected.
     • All text rendered with textContent. No innerHTML on data.
     • No counters updated directly — only via RPCs.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  var IMPRESSION_KEY_PREFIX = 'cs_ad_seen_';
  var MIN_IMP_VISIBLE_RATIO = 0.5;
  var MIN_IMP_MS = 1000;

  /* ---------- RUNTIME STATE ---------- */
  var cachedClient = null;

  /* ---------- HELPERS ---------- */

  function getDb() {
    if (cachedClient && typeof cachedClient.from === 'function') {
      return Promise.resolve(cachedClient);
    }
    if (window.db && typeof window.db.from === 'function') {
      cachedClient = window.db;
      return Promise.resolve(cachedClient);
    }
    if (window.dbReadyPromise && typeof window.dbReadyPromise.then === 'function') {
      return window.dbReadyPromise.then(function (client) {
        cachedClient = client;
        return client;
      });
    }
    return Promise.resolve(null);
  }

  function sessionKeyForImpression(adId) {
    return IMPRESSION_KEY_PREFIX + String(adId);
  }

  function hasSeenInSession(adId) {
    try {
      return sessionStorage.getItem(sessionKeyForImpression(adId)) === '1';
    } catch (e) {
      return false;
    }
  }

  function markSeenInSession(adId) {
    try {
      sessionStorage.setItem(sessionKeyForImpression(adId), '1');
    } catch (e) { /* ignore */ }
  }

  /**
   * Validate CTA URL — allow only https and internal relative paths.
   * @returns {string|null} safe URL, or null if rejected.
   */
  function sanitizeCtaUrl(raw) {
    if (!raw) return null;
    var url = String(raw).trim();
    if (!url) return null;

    /* Reject dangerous schemes explicitly. */
    var lower = url.toLowerCase();
    if (lower.indexOf('javascript:') === 0) return null;
    if (lower.indexOf('data:') === 0) return null;
    if (lower.indexOf('vbscript:') === 0) return null;
    if (lower.indexOf('file:') === 0) return null;

    /* Allow https. */
    if (lower.indexOf('https://') === 0) return url;

    /* Allow internal relative paths that start with /. */
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') return url;

    /* Everything else: reject. */
    return null;
  }

  /**
   * Resolve the CTA destination for a given ad record.
   * @returns {string|null}
   */
  function resolveCtaHref(ad) {
    if (!ad || ad.cta_enabled === false) return null;
    var type = String(ad.cta_type || 'none').toLowerCase();

    switch (type) {
      case 'product':
        if (ad.target_product_id == null) return null;
        return '/product-details.html?id=' + encodeURIComponent(String(ad.target_product_id));

      case 'category':
        if (!ad.target_category) return null;
        return '/products.html?category=' + encodeURIComponent(String(ad.target_category));

      case 'url':
        return sanitizeCtaUrl(ad.cta_url);

      case 'whatsapp':
        if (typeof window.storeWaLink === 'function') {
          return window.storeWaLink();
        }
        return null;

      case 'contact':
        return '#contact';

      case 'none':
      default:
        return null;
    }
  }

  /**
   * Build a responsive <picture> element for an ad.
   * Uses desktop/tablet/mobile sources when available.
   */
  function buildAdImage(ad, options) {
    var sources = {
      mobile:  (ad && typeof ad.image_mobile  === 'string' && ad.image_mobile)  ? ad.image_mobile  : '',
      tablet:  (ad && typeof ad.image_tablet  === 'string' && ad.image_tablet)  ? ad.image_tablet  : '',
      desktop: (ad && typeof ad.image_desktop === 'string' && ad.image_desktop) ? ad.image_desktop : ''
    };

    /* Fallback chain: if mobile missing, use tablet; if tablet missing, use desktop. */
    if (!sources.mobile && sources.tablet)  sources.mobile  = sources.tablet;
    if (!sources.mobile && sources.desktop) sources.mobile  = sources.desktop;
    if (!sources.tablet && sources.desktop) sources.tablet  = sources.desktop;

    if (!sources.desktop && !sources.tablet && !sources.mobile) {
      return null;
    }

    var picture = document.createElement('picture');

    if (sources.desktop && sources.desktop !== sources.mobile) {
      var srcDesktop = document.createElement('source');
      srcDesktop.setAttribute('media', '(min-width: 1024px)');
      srcDesktop.setAttribute('srcset', sources.desktop);
      picture.appendChild(srcDesktop);
    }

    if (sources.tablet && sources.tablet !== sources.mobile) {
      var srcTablet = document.createElement('source');
      srcTablet.setAttribute('media', '(min-width: 768px)');
      srcTablet.setAttribute('srcset', sources.tablet);
      picture.appendChild(srcTablet);
    }

    var img = document.createElement('img');
    img.src = sources.mobile || sources.tablet || sources.desktop;
    img.alt = String(ad.title || ad.name || 'Advertisement');
    img.loading = options && options.eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.className = 'ad-image';

    /* If the image fails to load, hide the whole ad slot cleanly. */
    img.addEventListener('error', function () {
      var root = picture.closest('.ad-slot__inner') || picture.parentNode;
      if (root && root.classList) {
        root.classList.add('ad-slot__inner--broken');
      }
    }, { once: true });

    picture.appendChild(img);
    return picture;
  }

  /**
   * Build the CTA element for an ad.
   * Returns null if no valid CTA.
   */
  function buildCta(ad) {
    if (!ad || ad.cta_enabled === false) return null;
    if (!ad.cta_text) return null;

    var href = resolveCtaHref(ad);
    if (!href) return null;

    var cta = document.createElement('a');
    cta.className = 'ad-cta';
    cta.href = href;
    cta.textContent = String(ad.cta_text);
    cta.setAttribute('data-ad-id', String(ad.id));

    var type = String(ad.cta_type || '').toLowerCase();
    if (type === 'url' && href.indexOf('https://') === 0) {
      cta.setAttribute('target', '_blank');
      cta.setAttribute('rel', 'noopener noreferrer');
    } else if (type === 'whatsapp') {
      cta.setAttribute('target', '_blank');
      cta.setAttribute('rel', 'noopener noreferrer');
    }

    cta.addEventListener('click', function () {
      trackClick(ad.id);
    });

    return cta;
  }

  /**
   * Build the full ad root element for a given record.
   */
  function buildAdElement(ad, options) {
    var root = document.createElement('article');
    root.className = 'ad-slot__inner';
    root.setAttribute('data-ad-id', String(ad.id));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', String(ad.title || ad.name || 'Advertisement'));

    var mediaLink = document.createElement('a');
    mediaLink.className = 'ad-media';
    mediaLink.href = resolveCtaHref(ad) || '#';
    mediaLink.setAttribute('aria-label', String(ad.title || ad.name || 'Advertisement'));
    mediaLink.setAttribute('data-ad-id', String(ad.id));
    mediaLink.addEventListener('click', function (e) {
      if (mediaLink.getAttribute('href') === '#') {
        e.preventDefault();
        return;
      }
      trackClick(ad.id);
    });

    var img = buildAdImage(ad, options);
    if (img) {
      mediaLink.appendChild(img);
    } else {
      /* No image — build a minimal text-only block. */
      var placeholder = document.createElement('div');
      placeholder.className = 'ad-image ad-image--placeholder';
      mediaLink.appendChild(placeholder);
    }

    root.appendChild(mediaLink);

    /* Optional overlay with title/subtitle/description/CTA */
    if (ad.title || ad.subtitle || ad.description || ad.cta_text) {
      var overlay = document.createElement('div');
      overlay.className = 'ad-overlay';

      if (ad.title) {
        var h3 = document.createElement('h3');
        h3.className = 'ad-title';
        h3.textContent = String(ad.title);
        overlay.appendChild(h3);
      }

      if (ad.subtitle) {
        var sub = document.createElement('p');
        sub.className = 'ad-subtitle';
        sub.textContent = String(ad.subtitle);
        overlay.appendChild(sub);
      }

      if (ad.description) {
        var desc = document.createElement('p');
        desc.className = 'ad-description';
        desc.textContent = String(ad.description);
        overlay.appendChild(desc);
      }

      var cta = buildCta(ad);
      if (cta) overlay.appendChild(cta);

      root.appendChild(overlay);
    }

    return root;
  }

  /* ---------- IMPRESSION TRACKING ---------- */

  /**
   * Attach an IntersectionObserver to trigger impression once
   * per session per ad, when ≥50% visible for ≥1 second.
   */
  function watchForImpression(root, adId) {
    if (typeof IntersectionObserver !== 'function') return;

    var alreadySeen = hasSeenInSession(adId);
    if (alreadySeen) return;

    var enteredAt = 0;
    var timer = null;
    var fired = false;

    var observer = new IntersectionObserver(function (entries) {
      if (fired) return;
      entries.forEach(function (entry) {
        if (entry.intersectionRatio >= MIN_IMP_VISIBLE_RATIO) {
          if (!enteredAt) {
            enteredAt = Date.now();
            timer = setTimeout(function () {
              if (fired) return;
              /* Double-check it's still visible at threshold. */
              if (document.visibilityState === 'visible') {
                fired = true;
                markSeenInSession(adId);
                trackImpression(adId);
                observer.disconnect();
              }
            }, MIN_IMP_MS);
          }
        } else {
          /* Left the visible area before the timer completed. */
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          enteredAt = 0;
        }
      });
    }, { threshold: [0, MIN_IMP_VISIBLE_RATIO, 1] });

    observer.observe(root);
  }

  /* ---------- RPC WRAPPERS ---------- */

  function trackImpression(adId) {
    if (adId == null) return;
    getDb().then(function (client) {
      if (!client) return;
      try {
        client.rpc('increment_ad_impression', { p_ad_id: Number(adId) })
          .then(function () { /* silent */ })
          .catch(function () { /* silent */ });
      } catch (e) { /* silent */ }
    });
  }

  function trackClick(adId) {
    if (adId == null) return;
    getDb().then(function (client) {
      if (!client) return;
      try {
        client.rpc('increment_ad_click', { p_ad_id: Number(adId) })
          .then(function () { /* silent */ })
          .catch(function () { /* silent */ });
      } catch (e) { /* silent */ }
    });
  }

  /* ---------- QUERY ---------- */

  /**
   * Fetch eligible ads for a placement.
   * @param {string} placement
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  function getForPlacement(placement, options) {
    options = options || {};
    var limit = Number(options.limit) || 1;
    var category = options.category || null;
    var productId = options.productId || null;

    if (!placement) return Promise.resolve([]);

    return getDb().then(function (client) {
      if (!client) return [];

      var query = client
        .from('advertisements')
        .select(
          'id, name, title, subtitle, description,' +
          'image_desktop, image_tablet, image_mobile,' +
          'cta_enabled, cta_text, cta_type, cta_url,' +
          'target_product_id, target_category,' +
          'placement, campaign_type, priority, status,' +
          'start_at, end_at'
        )
        .eq('placement', placement)
        .eq('status', 'active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      /* RLS already restricts to in-window ads.
         Add an extra belt-and-braces filter to avoid surprises. */
      var nowIso = new Date().toISOString();
      query = query
        .or('start_at.is.null,start_at.lte.' + nowIso)
        .or('end_at.is.null,end_at.gte.' + nowIso);

      return query.then(function (res) {
        if (res && res.error) {
          if (window.console && console.warn) {
            console.warn('[ads] query failed:', res.error.message);
          }
          return [];
        }
        var rows = Array.isArray(res && res.data) ? res.data : [];

        /* Client-side targeting filter:
           keep ads where the target matches OR is unset. */
        if (category) {
          rows = rows.filter(function (r) {
            return !r.target_category ||
                   String(r.target_category) === String(category);
          });
        }
        if (productId) {
          rows = rows.filter(function (r) {
            return r.target_product_id == null ||
                   String(r.target_product_id) === String(productId);
          });
        }

        return rows;
      });
    });
  }

  /* ---------- RENDER ---------- */

  function showSkeleton(container) {
    container.innerHTML = '';
    var sk = document.createElement('div');
    sk.className = 'ad-skeleton';
    sk.setAttribute('aria-hidden', 'true');
    container.appendChild(sk);
    container.setAttribute('aria-busy', 'true');
  }

  function hideContainer(container) {
    container.innerHTML = '';
    container.setAttribute('aria-busy', 'false');
    container.hidden = true;
  }

  function showContainer(container) {
    container.hidden = false;
  }

  /**
   * Render the best ad for a given placement into a container.
   * Resolves to true if an ad was rendered, false otherwise.
   */
  function renderInto(container, placement, options) {
    if (!container || !placement) return Promise.resolve(false);

    options = options || {};
    var trackImps = options.trackImpressions !== false;

    showSkeleton(container);

    return getForPlacement(placement, options).then(function (rows) {
      if (!rows || !rows.length) {
        hideContainer(container);
        return false;
      }

      var ad = rows[0]; /* Highest priority wins. */
      var root = buildAdElement(ad, { eager: placement === 'homepage_hero' });

      container.innerHTML = '';
      container.appendChild(root);
      container.setAttribute('aria-busy', 'false');
      showContainer(container);

      if (trackImps) {
        watchForImpression(root, ad.id);
      }
      return true;
    }).catch(function (err) {
      if (window.console && console.warn) {
        console.warn('[ads] render error:', err && err.message);
      }
      hideContainer(container);
      return false;
    });
  }

  /**
   * Admin preview: render an in-memory ad record without DB.
   */
  function previewRender(container, adRecord) {
    if (!container || !adRecord) return false;
    var root = buildAdElement(adRecord, { eager: true });
    container.innerHTML = '';
    container.appendChild(root);
    return true;
  }

  /* ---------- EXPORTS ---------- */

  window.Ads = {
    getForPlacement: getForPlacement,
    renderInto: renderInto,
    trackImpression: trackImpression,
    trackClick: trackClick,
    previewRender: previewRender,
    /* Exposed for admin form validation. */
    sanitizeCtaUrl: sanitizeCtaUrl,
    resolveCtaHref: resolveCtaHref
  };
})();
