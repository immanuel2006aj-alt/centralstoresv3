/* ============================================================
   CENTRAL & STORES — Cart state (hardened)
   ------------------------------------------------------------
   RESPONSIBILITY
     • Read / write cart in the best available storage tier.
     • Tiers, in order of preference:
         1. localStorage   (persists across sessions)
         2. sessionStorage (persists across refresh in this tab)
         3. in-memory      (last resort; lost on refresh)
     • Update all cart badges on the page.
     • Expose cart mutation helpers (add / change / remove / clear).
     • Emit `centralCartUpdated` on every mutation and on
       cross-tab storage events.
     • Emit `centralCartStorageError` when persistence fails and
       the caller should warn the user.

   CART ITEM SHAPE (stable contract — do not break)
     {
       id:       string | number   (compared as string)
       name:     string
       category: string
       weight:   string
       price:    number            (snapshot at add-time)
       image:    string            (URL; accepts `image_url` on input)
       quantity: integer 1..MAX_QTY_PER_ITEM
     }

   GLOBAL API (preserved — do not rename)
     getCentralCart()
     saveCentralCart(cart)
     getCartTotalQuantity()
     updateAllCartBadges()
     addProductToCart(product)
     changeCartQuantity(productId, change)
     removeProductFromCart(productId)
     clearCentralCart()

   ADDITIVE HELPERS
     getCartItem(productId)
     onCartUpdated(cb) → unsubscribe
     window.CentralCart (namespaced constants + debug)

   EVENTS
     document: 'centralCartUpdated'       detail: { cart }
     document: 'centralCartStorageError'  detail: { reason, tier }

   SECURITY
     • No HTML parsing, no network requests.
     • Cart contents are snapshots; consumers must render them
       with textContent, never innerHTML.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  const CART_KEY          = "centralStoresCart";
  const MAX_QTY_PER_ITEM  = 99;

  const BADGE_SELECTOR = [
    ".cart-count",
    ".cart-badge",
    ".bottom-cart-count",
    ".nav-cart-count",
    "[data-cart-count]",
    "#bottomCartCount"
  ].join(",");

  /* ---------- STORAGE TIER DETECTION ---------- */
  /*
     We probe once at startup. If localStorage.setItem + removeItem
     succeeds with a probe key, we use localStorage. Otherwise we
     try sessionStorage. Otherwise we fall back to in-memory.

     Probing once is intentional: some browsers throw on the first
     write and succeed on later writes, and some succeed on write
     but fail on next read. We use a strong probe (write + read +
     delete) so we detect the common "writes silently no-op" case
     seen in certain iOS Safari configurations.
  */

  let storageTier = 'memory';
  let activeStore = null;      /* object with getItem/setItem/removeItem */
  let memoryStore = Object.create(null); /* in-memory fallback */

  function probeStorage(candidate) {
    if (!candidate) return false;
    try {
      const probeKey = '__cs_storage_probe__';
      const probeVal = 'p' + Date.now();
      candidate.setItem(probeKey, probeVal);
      const readBack = candidate.getItem(probeKey);
      candidate.removeItem(probeKey);
      return readBack === probeVal;
    } catch (e) {
      return false;
    }
  }

  function detectStorageTier() {
    /* localStorage */
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (probeStorage(window.localStorage)) {
          storageTier = 'local';
          activeStore = window.localStorage;
          return;
        }
      }
    } catch (e) { /* fall through */ }

    /* sessionStorage */
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (probeStorage(window.sessionStorage)) {
          storageTier = 'session';
          activeStore = window.sessionStorage;
          return;
        }
      }
    } catch (e) { /* fall through */ }

    /* in-memory */
    storageTier = 'memory';
    activeStore = {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(memoryStore, k)
          ? memoryStore[k]
          : null;
      },
      setItem: function (k, v) {
        memoryStore[k] = String(v);
      },
      removeItem: function (k) {
        delete memoryStore[k];
      }
    };
  }

  detectStorageTier();

  /* Notify listeners which tier we ended up on.
     Small pages can show a warning banner if tier === 'memory'. */
  function emitStorageError(reason) {
    try {
      document.dispatchEvent(
        new CustomEvent('centralCartStorageError', {
          detail: { reason: reason || 'unknown', tier: storageTier }
        })
      );
    } catch (e) { /* ignore */ }
  }

  /* If we couldn't even get a persistent tier, tell the page. */
  if (storageTier === 'memory') {
    /* Defer until DOMContentLoaded so listeners can subscribe. */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        emitStorageError('no-persistent-storage');
      }, { once: true });
    } else {
      setTimeout(function () { emitStorageError('no-persistent-storage'); }, 0);
    }
  }

  /* ---------- LOW-LEVEL STORAGE ---------- */

  /**
   * Read + normalise cart from the active storage tier.
   * Drops malformed entries silently and coerces quantities.
   * @returns {Array}
   */
  function getCentralCart() {
    let raw = null;
    try {
      raw = activeStore.getItem(CART_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const clean = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || item.id == null) continue;

      const qty = clampQty(item.quantity);
      if (qty <= 0) continue;

      const price = Number(item.price);
      clean.push({
        id:       item.id,
        name:     String(item.name || ''),
        category: String(item.category || ''),
        weight:   String(item.weight || ''),
        price:    isFinite(price) ? price : 0,
        /* Accept `image` or `image_url` on input; store as `image`. */
        image:    String(item.image || item.image_url || ''),
        quantity: qty
      });
    }
    return clean;
  }

  function clampQty(value) {
    let n = Number(value);
    if (!isFinite(n)) n = 1;
    n = Math.floor(n);
    if (n < 1) return 0;
    if (n > MAX_QTY_PER_ITEM) return MAX_QTY_PER_ITEM;
    return n;
  }

  /**
   * Persist the cart. Tries the active tier; on failure, downgrades
   * to the next tier and retries. Emits `centralCartStorageError`
   * only if even the final tier fails (which is not expected — the
   * in-memory tier never throws).
   *
   * @param {Array} cart
   * @returns {boolean} true if the cart was persisted to at least
   *                    sessionStorage; false if only in memory.
   */
  function saveCentralCart(cart) {
    const serialized = JSON.stringify(cart);

    /* Try the currently active tier. */
    try {
      activeStore.setItem(CART_KEY, serialized);
      updateAllCartBadges();
      return storageTier !== 'memory';
    } catch (primaryErr) {
      /* Primary tier failed mid-session (quota exceeded, revoked
         permission, private mode flipped on, etc.). Try to
         downgrade. */
    }

    /* Try downgrading tiers in order. */
    const fallbackOrder = [];
    if (storageTier === 'local')   { fallbackOrder.push('session'); }
    if (storageTier !== 'memory')  { fallbackOrder.push('memory'); }

    for (let i = 0; i < fallbackOrder.length; i++) {
      const tier = fallbackOrder[i];

      if (tier === 'session') {
        try {
          if (window.sessionStorage) {
            window.sessionStorage.setItem(CART_KEY, serialized);
            activeStore = window.sessionStorage;
            storageTier = 'session';
            updateAllCartBadges();
            emitStorageError('downgraded-to-session');
            return true;
          }
        } catch (e) { /* continue */ }
      }

      if (tier === 'memory') {
        try {
          memoryStore[CART_KEY] = serialized;
          activeStore = {
            getItem: function (k) {
              return Object.prototype.hasOwnProperty.call(memoryStore, k)
                ? memoryStore[k] : null;
            },
            setItem: function (k, v) { memoryStore[k] = String(v); },
            removeItem: function (k) { delete memoryStore[k]; }
          };
          storageTier = 'memory';
          updateAllCartBadges();
          emitStorageError('downgraded-to-memory');
          return false;
        } catch (e) { /* truly nothing works */ }
      }
    }

    /* Everything failed — still update the in-memory badge. */
    updateAllCartBadges();
    emitStorageError('all-tiers-failed');
    return false;
  }

  /* ---------- BADGES ---------- */

  function getCartTotalQuantity() {
    const cart = getCentralCart();
    let total = 0;
    for (let i = 0; i < cart.length; i++) {
      total += Number(cart[i].quantity) || 0;
    }
    return total;
  }

  function updateAllCartBadges() {
    const total = getCartTotalQuantity();
    const badges = document.querySelectorAll(BADGE_SELECTOR);
    badges.forEach(function (badge) {
      badge.textContent = String(total);
      badge.style.display = total > 0 ? "flex" : "none";
    });
  }

  /* ---------- DISPATCH ---------- */

  function emitCartUpdated(cart) {
    document.dispatchEvent(
      new CustomEvent("centralCartUpdated", { detail: { cart: cart } })
    );
  }

  /* ---------- HELPERS ---------- */

  function findItem(cart, productId) {
    const target = String(productId);
    for (let i = 0; i < cart.length; i++) {
      if (String(cart[i].id) === target) return cart[i];
    }
    return null;
  }

  /* ---------- PUBLIC MUTATIONS ---------- */

  function addProductToCart(product) {
    if (!product || product.id == null) {
      throw new Error("addProductToCart requires a product with an id.");
    }
    if (product.is_available === false) {
      return;
    }

    const cart = getCentralCart();
    const existing = findItem(cart, product.id);

    const incomingImage = product.image || product.image_url || '';

    if (existing) {
      existing.quantity = clampQty((Number(existing.quantity) || 0) + 1);
      existing.name     = product.name     || existing.name;
      existing.category = product.category || existing.category;
      existing.weight   = product.weight   || existing.weight;
      if (product.price != null) existing.price = Number(product.price) || 0;
      if (incomingImage) existing.image = String(incomingImage);
    } else {
      cart.push({
        id:       product.id,
        name:     String(product.name     || ''),
        category: String(product.category || ''),
        weight:   String(product.weight   || ''),
        price:    Number(product.price) || 0,
        image:    String(incomingImage),
        quantity: 1
      });
    }

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  function changeCartQuantity(productId, change) {
    const delta = Number(change);
    if (!isFinite(delta) || Math.floor(delta) !== delta || delta === 0) {
      return;
    }

    let cart = getCentralCart();
    const item = findItem(cart, productId);
    if (!item) return;

    const next = (Number(item.quantity) || 0) + delta;

    if (next <= 0) {
      cart = cart.filter(function (i) {
        return String(i.id) !== String(productId);
      });
    } else {
      item.quantity = clampQty(next);
    }

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  function removeProductFromCart(productId) {
    const target = String(productId);
    const cart = getCentralCart().filter(function (i) {
      return String(i.id) !== target;
    });

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  function clearCentralCart() {
    try {
      activeStore.removeItem(CART_KEY);
    } catch (e) { /* ignored */ }

    updateAllCartBadges();
    emitCartUpdated([]);
  }

  /* ---------- READ HELPERS ---------- */

  function getCartItem(productId) {
    return findItem(getCentralCart(), productId);
  }

  function onCartUpdated(cb) {
    if (typeof cb !== 'function') return function () {};
    const handler = function (e) {
      cb(e && e.detail ? e.detail.cart : getCentralCart());
    };
    document.addEventListener('centralCartUpdated', handler);
    cb(getCentralCart());
    return function () {
      document.removeEventListener('centralCartUpdated', handler);
    };
  }

  /* ---------- INIT ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    updateAllCartBadges();
  });

  /* Cross-tab sync. Storage events only fire for the tier the
     other tab is using, so listen for both. */
  window.addEventListener("storage", function (event) {
    if (event.key !== CART_KEY) return;
    updateAllCartBadges();
    emitCartUpdated(getCentralCart());
  });

  /* Failsafe: re-save on page hide so a mid-write unload doesn't
     lose the latest cart. Cheap, idempotent. */
  window.addEventListener("pagehide", function () {
    try {
      const cart = getCentralCart();
      if (cart && cart.length) {
        activeStore.setItem(CART_KEY, JSON.stringify(cart));
      }
    } catch (e) { /* ignore */ }
  });

  /* Also save on visibilitychange when the tab is backgrounded —
     some mobile browsers fire this before pagehide on memory
     pressure. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    try {
      const cart = getCentralCart();
      if (cart && cart.length) {
        activeStore.setItem(CART_KEY, JSON.stringify(cart));
      }
    } catch (e) { /* ignore */ }
  });

  /* ---------- GLOBAL EXPORTS (preserve existing names) ---------- */

  window.getCentralCart         = getCentralCart;
  window.saveCentralCart        = saveCentralCart;
  window.getCartTotalQuantity   = getCartTotalQuantity;
  window.updateAllCartBadges    = updateAllCartBadges;
  window.addProductToCart       = addProductToCart;
  window.changeCartQuantity     = changeCartQuantity;
  window.removeProductFromCart  = removeProductFromCart;
  window.clearCentralCart       = clearCentralCart;

  window.getCartItem            = getCartItem;
  window.onCartUpdated          = onCartUpdated;

  window.CentralCart = Object.freeze({
    KEY:              CART_KEY,
    MAX_QTY_PER_ITEM: MAX_QTY_PER_ITEM,
    BADGE_SELECTOR:   BADGE_SELECTOR,
    onUpdated:        onCartUpdated,
    getItem:          getCartItem,
    /* Debug helper — returns 'local' | 'session' | 'memory'. */
    getStorageTier:   function () { return storageTier; }
  });
})();
