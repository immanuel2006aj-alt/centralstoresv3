/* ============================================================
   CENTRAL & STORES — Advertisements Module (public renderer)
   ------------------------------------------------------------
   Matches the CURRENT Supabase schema:
     advertisements(
       id, title, description, image_url, image_url_tablet,
       image_url_mobile, alt_text, placement, campaign_type,
       status, start_at, end_at, target_category, target_product_id,
       cta_type, cta_url, cta_label, display_order,
       impression_count, click_count, created_at, updated_at
     )

   PUBLIC API
     Ads.renderInto(container, placement, options) -> Promise<Boolean>
     Ads.getForPlacement(placement, options)       -> Promise<Array>
     Ads.trackImpression(id)
     Ads.trackClick(id)
     Ads.previewRender(container, adRecord)        // admin preview
     Ads.sanitizeCtaUrl(url)                       // admin validation helper
     Ads.resolveCtaHref(ad)

   Reads window.db (or awaits window.dbReadyPromise) created by
   supabase-config.js. Does not create its own client.

   Renders image-less ads as a text-only card so we never end up
   with an invisible slot again.
   ============================================================ */

(function () {
  'use strict';

  var IMPRESSION_KEY_PREFIX = 'cs_ad_seen_';
  var MIN_VISIBLE_RATIO = 0.5;
  var MIN_VISIBLE_MS = 1000;

  var cachedClient = null;

  /* ---------- Supabase client resolver ---------- */
  function getDb() {
    if (cachedClient && typeof cachedClient.from === 'function') {
      return Promise.resolve(cachedClient);
    }
    if (window.db && typeof window.db.from === 'function') {
      cachedClient = window.db;
      return Promise.resolve(cachedClient);
    }
    if (window.dbReadyPromise && typeof window.dbReadyPromise.then === 'function') {
      return window.dbReadyPromise.then(function (c) {
        cachedClient = c;
        return c;
      });
    }
    return Promise.resolve(null);
  }

  /* ---------- Session dedupe ---------- */
  function seenKey(id) { return IMPRESSION_KEY_PREFIX + String(id); }
  function hasSeen(id) {
    try { return sessionStorage.getItem(seenKey(id)) === '1'; }
    catch (e) { return false; }
  }
  function markSeen(id) {
    try { sessionStorage.setItem(seenKey(id), '1'); } catch (e) {}
  }

  /* ---------- CTA URL safety ---------- */
  function sanitizeCtaUrl(raw) {
    if (!raw) return null;
    var url = String(raw).trim();
    if (!url) return null;
    var low = url.toLowerCase();
    if (low.indexOf('javascript:') === 0) return null;
    if (low.indexOf('data:') === 0) return null;
    if (low.indexOf('vbscript:') === 0) return null;
    if (low.indexOf('file:') === 0) return null;
    if (low.indexOf('blob:') === 0) return null;
    if (low.indexOf('https://') === 0) return url;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') return url;
    return null;
  }

  function resolveCtaHref(ad) {
    if (!ad) return null;
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
        return (typeof window.storeWaLink === 'function') ? window.storeWaLink() : null;
      case 'contact':
        return '#contact';
      case 'none':
      default:
        return null;
    }
  }

  function defaultCtaLabel(ad) {
    if (ad && ad.cta_label) return String(ad.cta_label);
    var type = String((ad && ad.cta_type) || '').toLowerCase();
    switch (type) {
      case 'product':  return 'View Product';
      case 'category': return 'Shop Now';
      case 'url':      return 'Learn More';
      case 'whatsapp': return 'Chat on WhatsApp';
      case 'contact':  return 'Contact Us';
      default:         return null;
    }
  }

  /* ---------- Image element ---------- */
  function buildAdImage(ad) {
    if (!ad) return null;

    var desktop = (typeof ad.image_url === 'string' && ad.image_url.trim()) ? ad.image_url.trim() : '';
    var tablet  = (typeof ad.image_url_tablet === 'string' && ad.image_url_tablet.trim()) ? ad.image_url_tablet.trim() : '';
    var mobile  = (typeof ad.image_url_mobile === 'string' && ad.image_url_mobile.trim()) ? ad.image_url_mobile.trim() : '';

    /* Fallback chain */
    if (!tablet && desktop) tablet = desktop;
    if (!mobile && tablet)  mobile = tablet;
    if (!mobile && desktop) mobile = desktop;

    var primary = desktop || tablet || mobile;
    if (!primary) return null; /* no image at all */

    var picture = document.createElement('picture');

    if (desktop && desktop !== mobile) {
      var s1 = document.createElement('source');
      s1.media = '(min-width: 1024px)';
      s1.srcset = desktop;
      picture.appendChild(s1);
    }
    if (tablet && tablet !== mobile) {
      var s2 = document.createElement('source');
      s2.media = '(min-width: 768px)';
      s2.srcset = tablet;
      picture.appendChild(s2);
    }

    var img = document.createElement('img');
    img.src = mobile || tablet || desktop;
    img.alt = String(ad.alt_text || ad.title || 'Advertisement');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'ad-image';
    img.referrerPolicy = 'no-referrer';

    img.addEventListener('error', function () {
      /* Swap to a text-only fallback if the image can't load. */
      var picture = img.closest('picture');
      if (picture) {
        picture.style.display = 'none';
        var card = picture.closest('.ad-card');
        if (card) card.classList.add('ad-card--no-image');
      }
    }, { once: true });

    picture.appendChild(img);
    return picture;
  }

  /* ---------- CTA element ---------- */
  function buildCta(ad) {
    var href = resolveCtaHref(ad);
    var label = defaultCtaLabel(ad);
    if (!href || !label) return null;

    var a = document.createElement('a');
    a.className = 'ad-cta';
    a.href = href;
    a.textContent = label;
    a.setAttribute('data-ad-id', String(ad.id));

    var type = String(ad.cta_type || '').toLowerCase();
    if (type === 'url' || type === 'whatsapp') {
      if (href.indexOf('http') === 0) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    }
    a.addEventListener('click', function () { trackClick(ad.id); });
    return a;
  }

  /* ---------- Full card ---------- */
  function buildAdElement(ad) {
    var card = document.createElement('article');
    card.className = 'ad-card';
    card.setAttribute('data-ad-id', String(ad.id));
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', String(ad.title || 'Advertisement'));

    var hasImage = !!(ad.image_url || ad.image_url_tablet || ad.image_url_mobile);

    if (hasImage) {
      var media = document.createElement('div');
      media.className = 'ad-media';

      var mediaLink = document.createElement('a');
      mediaLink.className = 'ad-media-link';
      var href = resolveCtaHref(ad);
      if (href) {
        mediaLink.href = href;
        if (href.indexOf('http') === 0) {
          mediaLink.target = '_blank';
          mediaLink.rel = 'noopener noreferrer';
        }
        mediaLink.addEventListener('click', function () { trackClick(ad.id); });
      } else {
        mediaLink.setAttribute('aria-label', String(ad.title || 'Advertisement'));
        mediaLink.style.pointerEvents = 'none';
      }

      var img = buildAdImage(ad);
      if (img) mediaLink.appendChild(img);
      media.appendChild(mediaLink);
      card.appendChild(media);
    } else {
      card.classList.add('ad-card--no-image');
    }

    var body = document.createElement('div');
    body.className = 'ad-body';

    if (ad.title) {
      var h = document.createElement('h3');
      h.className = 'ad-title';
      h.textContent = String(ad.title);
      body.appendChild(h);
    }
    if (ad.description) {
      var p = document.createElement('p');
      p.className = 'ad-desc';
      p.textContent = String(ad.description);
      body.appendChild(p);
    }
    var cta = buildCta(ad);
    if (cta) body.appendChild(cta);

    /* If the body ends up empty (no title, no desc, no cta), skip it. */
    if (body.children.length > 0) {
      card.appendChild(body);
    }

    return card;
  }

  /* ---------- Impression observer ---------- */
  function watchForImpression(root, adId) {
    if (typeof IntersectionObserver !== 'function') return;
    if (hasSeen(adId)) return;

    var timer = null;
    var fired = false;

    var observer = new IntersectionObserver(function (entries) {
      if (fired) return;
      entries.forEach(function (entry) {
        if (entry.intersectionRatio >= MIN_VISIBLE_RATIO) {
          if (!timer) {
            timer = setTimeout(function () {
              if (fired) return;
              if (document.visibilityState === 'visible') {
                fired = true;
                markSeen(adId);
                trackImpression(adId);
                observer.disconnect();
              }
            }, MIN_VISIBLE_MS);
          }
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      });
    }, { threshold: [0, MIN_VISIBLE_RATIO, 1] });

    observer.observe(root);
  }

  /* ---------- Tracking RPCs ---------- */
  function trackImpression(adId) {
    if (adId == null) return;
    getDb().then(function (client) {
      if (!client) return;
      try {
        client.rpc('increment_ad_impression', { p_ad_id: Number(adId) })
          .then(function (r) {
            if (r && r.error) {
              console.warn('[ads] impression RPC error:', r.error.message);
            }
          })
          .catch(function () {});
      } catch (e) {}
    });
  }

  function trackClick(adId) {
    if (adId == null) return;
    getDb().then(function (client) {
      if (!client) return;
      try {
        client.rpc('increment_ad_click', { p_ad_id: Number(adId) })
          .then(function (r) {
            if (r && r.error) {
              console.warn('[ads] click RPC error:', r.error.message);
            }
          })
          .catch(function () {});
      } catch (e) {}
    });
  }

  /* ---------- Query ---------- */
  function getForPlacement(placement, options) {
    options = options || {};
    var limit = Number(options.limit) || 1;
    var category = options.category || null;
    var productId = options.productId || null;

    if (!placement) return Promise.resolve([]);

    return getDb().then(function (client) {
      if (!client) {
        console.warn('[ads] No Supabase client available.');
        return [];
      }

      /* Preferred path: SECURITY DEFINER RPC does the eligibility check. */
      return client.rpc('get_eligible_ads', {
        p_placement: placement,
        p_category: category,
        p_product_id: productId,
        p_limit: limit
      }).then(function (res) {
        if (res && res.error) {
          console.warn('[ads] get_eligible_ads failed, falling back:', res.error.message);
          return fallbackQuery(client, placement, limit, category, productId);
        }
        return Array.isArray(res && res.data) ? res.data : [];
      });
    });
  }

  function fallbackQuery(client, placement, limit, category, productId) {
    var q = client
      .from('advertisements')
      .select('id,title,description,image_url,image_url_tablet,image_url_mobile,alt_text,' +
              'placement,campaign_type,status,start_at,end_at,' +
              'target_category,target_product_id,cta_type,cta_url,cta_label,' +
              'display_order,impression_count,click_count,created_at')
      .eq('placement', placement)
      .eq('status', 'active')
      .order('display_order', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);

    return q.then(function (res) {
      if (res && res.error) {
        console.warn('[ads] fallback query failed:', res.error.message);
        return [];
      }
      var rows = Array.isArray(res && res.data) ? res.data : [];

      /* Client-side schedule + targeting filter */
      var now = Date.now();
      rows = rows.filter(function (r) {
        var startOk = !r.start_at || new Date(r.start_at).getTime() <= now;
        var endOk = !r.end_at || new Date(r.end_at).getTime() >= now;
        var catOk = !r.target_category || !category || String(r.target_category) === String(category);
        var prodOk = r.target_product_id == null || !productId || String(r.target_product_id) === String(productId);
        return startOk && endOk && catOk && prodOk;
      });
      return rows;
    });
  }

  /* ---------- Public render ---------- */
  function renderInto(container, placement, options) {
    if (!container || !placement) return Promise.resolve(false);

    options = options || {};
    container.setAttribute('aria-busy', 'true');
    container.innerHTML = '';

    return getForPlacement(placement, options).then(function (rows) {
      if (!rows || rows.length === 0) {
        container.setAttribute('data-ad-empty', 'true');
        container.setAttribute('aria-busy', 'false');
        console.info('[ads] no eligible ad for placement:', placement);
        return false;
      }

      var ad = rows[0];
      var el = buildAdElement(ad);
      container.appendChild(el);
      container.removeAttribute('data-ad-empty');
      container.setAttribute('aria-busy', 'false');

      console.info('[ads] rendered ad', ad.id, 'in', placement);

      watchForImpression(el, ad.id);
      return true;
    }).catch(function (err) {
      container.setAttribute('data-ad-empty', 'true');
      container.setAttribute('aria-busy', 'false');
      console.warn('[ads] render error:', err && err.message);
      return false;
    });
  }

  /* ---------- Admin preview (no network) ---------- */
  function previewRender(container, adRecord) {
    if (!container || !adRecord) return false;
    var el = buildAdElement(adRecord);
    container.innerHTML = '';
    container.appendChild(el);
    return true;
  }

  /* ---------- Auto-mount on DOM ready ---------- */
  function autoMount() {
    var slots = document.querySelectorAll('[data-ad-placement]');
    if (!slots.length) return;
    slots.forEach(function (slot) {
      var placement = slot.getAttribute('data-ad-placement');
      var category = slot.getAttribute('data-ad-category') || null;
      var productId = slot.getAttribute('data-ad-product-id') || null;
      var limit = parseInt(slot.getAttribute('data-ad-limit') || '1', 10) || 1;

      /* If the slot itself is the .ad-slot container, render into it. */
      renderInto(slot, placement, {
        category: category,
        productId: productId ? Number(productId) : null,
        limit: limit
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  /* ---------- Exports ---------- */
  window.Ads = {
    renderInto: renderInto,
    getForPlacement: getForPlacement,
    trackImpression: trackImpression,
    trackClick: trackClick,
    previewRender: previewRender,
    sanitizeCtaUrl: sanitizeCtaUrl,
    resolveCtaHref: resolveCtaHref
  };
})();