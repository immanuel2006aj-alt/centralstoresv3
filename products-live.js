/* ============================================================
   CENTRAL & STORES — Live Products from Supabase
   ------------------------------------------------------------
   RESPONSIBILITY
     • Load published products from Supabase.
     • Populate window.productsData (canonical app shape).
     • Dispatch `productsLoaded` on success, `productsError`
       on failure.

   CONTRACT (product shape — see master prompt §22)
     {
       id:                uuid | number
       name:              string
       category:          string
       weight:            string
       price:             number
       original_price:    number | null
       offer_percentage:  number | null
       image_url:         string        // canonical
       image:             string        // legacy alias — same value
       description:       string
       is_available:      boolean
       is_published:      boolean
       is_featured:       boolean
     }

   EVENTS
     document: 'productsLoaded'  detail: products[]
     document: 'productsError'   detail: { message: string }

   NO LEGACY SOURCE
     The hard-coded catalogue (products-name.js / price.js /
     image-links.js) is intentionally NOT consulted. The
     database is the only source of truth.
   ============================================================ */

window.productsData = window.productsData || [];

(function () {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  var SELECT_COLUMNS = [
    'id',
    'name',
    'category',
    'weight',
    'price',
    'original_price',
    'offer_percentage',
    'image_url',
    'description',
    'is_available',
    'is_published',
    'is_featured'
  ].join(',');

  var RESULT_LIMIT    = 1000;
  var LOAD_TIMEOUT_MS = 15000;

  /* ---------- STATE ---------- */
  var loadPromise = null;

  /* ---------- MAPPING ---------- */

  /**
   * Convert a DB row to the canonical app shape.
   * @param {Object} row
   * @returns {Object}
   */
  function mapRow(row) {
    var imageUrl = typeof row.image_url === 'string' ? row.image_url : '';

    var price         = Number(row.price);
    var originalPrice = Number(row.original_price);
    var offerPct      = Number(row.offer_percentage);

    return {
      id:               row.id,
      name:             String(row.name || ''),
      category:         String(row.category || ''),
      weight:           String(row.weight || ''),
      price:            isFinite(price) && price > 0 ? price : 0,
      original_price:   isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
      offer_percentage: isFinite(offerPct) && offerPct > 0 ? offerPct : null,
      image_url:        imageUrl,
      image:            imageUrl,
      description:      String(row.description || ''),
      is_available:     row.is_available !== false,
      is_published:     row.is_published !== false,
      is_featured:      row.is_featured === true
    };
  }

  /* ---------- FETCH ---------- */

  /**
   * Run the Supabase query. Rejects on error.
   * @returns {Promise<Array>}
   */
  function fetchProducts() {
    if (!window.db || typeof window.db.from !== 'function') {
      return Promise.reject(new Error('Supabase client not ready.'));
    }

    return window.db
      .from('products')
      .select(SELECT_COLUMNS)
      .eq('is_published', true)
      .order('is_featured', { ascending: false })
      .order('name',        { ascending: true })
      .limit(RESULT_LIMIT)
      .then(function (res) {
        if (res && res.error) {
          throw new Error('Database read failed.');
        }
        var data = (res && res.data) || [];
        return data.map(mapRow);
      });
  }

  /* ---------- READINESS ---------- */

  /**
   * Resolve when the Supabase client is available.
   * Prefers window.dbReadyPromise (set by supabase-config.js),
   * falls back to polling.
   * @returns {Promise<void>}
   */
  function waitForClient() {
    if (window.db && typeof window.db.from === 'function') {
      return Promise.resolve();
    }

    if (window.dbReadyPromise && typeof window.dbReadyPromise.then === 'function') {
      return window.dbReadyPromise.then(function () {
        if (!window.db || typeof window.db.from !== 'function') {
          throw new Error('Supabase client not ready.');
        }
      });
    }

    /* Fallback — brief polling for environments where
       supabase-config.js hasn't installed the readiness promise. */
    return new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      var poll = setInterval(function () {
        if (window.db && typeof window.db.from === 'function') {
          clearInterval(poll);
          resolve();
          return;
        }
        if (Date.now() - startedAt > LOAD_TIMEOUT_MS) {
          clearInterval(poll);
          reject(new Error('Supabase client not ready.'));
        }
      }, 100);
    });
  }

  /* ---------- EVENT DISPATCH ---------- */

  function emitLoaded(products) {
    document.dispatchEvent(
      new CustomEvent('productsLoaded', { detail: products })
    );
  }

  function emitError(message) {
    document.dispatchEvent(
      new CustomEvent('productsError', {
        detail: { message: message || 'Unable to load products.' }
      })
    );
  }

  /* ---------- PUBLIC LOAD ---------- */

  /**
   * Load published products. Idempotent — repeated calls return
   * the same promise. Resolves with the array.
   * @returns {Promise<Array>}
   */
  function loadLiveProducts() {
    if (loadPromise) return loadPromise;

    loadPromise = waitForClient()
      .then(fetchProducts)
      .then(function (products) {
        window.productsData = products;
        emitLoaded(products);
        return products;
      })
      .catch(function (err) {
        if (window.console && console.warn) {
          console.warn('[products-live] load failed:', err && err.message);
        }
        window.productsData = [];
        emitError('Unable to load products right now.');
        return [];
      });

    return loadPromise;
  }

  /**
   * Force a reload. Clears the cached promise, re-queries.
   * @returns {Promise<Array>}
   */
  function reloadLiveProducts() {
    loadPromise = null;
    return loadLiveProducts();
  }

  /* ---------- EXPOSE ---------- */

  window.loadLiveProducts   = loadLiveProducts;
  window.reloadLiveProducts = reloadLiveProducts;

  /* ---------- BOOT ---------- */

  /* Fire immediately. If the Supabase SDK hasn't loaded yet,
     waitForClient() defers until it has. */
  loadLiveProducts();
})();
