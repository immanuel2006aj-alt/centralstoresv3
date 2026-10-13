/* ============================================================
   CENTRAL & STORES — Live Categories (public site)
   ------------------------------------------------------------
   Loads categories from Supabase and renders:
     • Homepage category grid    →  #homeCategoryGrid
     • Products page pills       →  #categoryFilter

   When admin adds/edits/deletes a category, the change appears
   here within ~2 seconds via Supabase Realtime.

   Fallback: if Supabase is unreachable, uses FALLBACK_CATEGORIES
   (same list as the original hard-coded HTML).
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     FALLBACK — used only if Supabase is unreachable
     ============================================================ */
  const FALLBACK_CATEGORIES = [
    { name: 'Rice & Flours',       slug: 'rice-flours',        icon: '🌾' },
    { name: 'Pulses & Dals',       slug: 'pulses-dals',        icon: '🥣' },
    { name: 'Oils & Ghee',         slug: 'oils-ghee',          icon: '🫗' },
    { name: 'Masalas',             slug: 'masalas',            icon: '🌶️' },
    { name: 'Beverages',           slug: 'beverages',          icon: '☕' },
    { name: 'Kitchen Essentials',  slug: 'kitchen-essentials', icon: '🍳' },
    { name: 'Biscuits',            slug: 'biscuits',           icon: '🍪' },
    { name: 'Home Care',           slug: 'home-care',          icon: '🧴' },
    { name: 'Personal Care',       slug: 'personal-care',      icon: '🧼' },
    { name: 'Baby Care',           slug: 'baby-care',          icon: '🍼' },
    { name: 'Tamil Nadu Snacks',   slug: 'tamil-nadu-snacks',  icon: '🥟' }
  ];

  /* ============================================================
     STATE
     ============================================================ */
  let currentCategories = [];
  let loaded = false;
  let renderAttempts = 0;

  /* ============================================================
     HELPERS
     ============================================================ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getSelectedCategoryFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('category') || 'All';
    } catch (e) {
      return 'All';
    }
  }

  /* ============================================================
     RENDER HOMEPAGE CATEGORY GRID
     ============================================================ */
  function renderHomeGrid(list) {
    const container = document.getElementById('homeCategoryGrid');
    if (!container) return;

    if (!list || !list.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = list.map(function (c) {
      const slug = c.slug || slugify(c.name);
      const icon = c.icon || '🛒';
      const img = c.image_url ? String(c.image_url).trim() : '';

      // Visual: image OR emoji
      let visual = '';
      if (img) {
        visual = '<img src="' + esc(img) + '" alt="' + esc(c.name) + '" loading="lazy" decoding="async" width="400" height="400">';
      } else {
        visual = '<span style="font-size:2.4rem;line-height:1;display:block">' + esc(icon) + '</span>';
      }

      return '<a href="products.html?category=' + encodeURIComponent(c.name) + '" ' +
                  'class="category-card" ' +
                  'data-category="' + esc(c.name) + '" ' +
                  'data-slug="' + esc(slug) + '" ' +
                  'title="' + esc(c.name) + '">' +
        '<div class="category-image">' + visual + '</div>' +
        '<span>' + esc(c.name) + '</span>' +
      '</a>';
    }).join('');
  }

  /* ============================================================
     RENDER PRODUCTS PAGE CATEGORY PILLS
     ============================================================ */
  function renderFilterPills(list) {
    const container = document.getElementById('categoryFilter');
    if (!container) return;

    const selectedFromUrl = getSelectedCategoryFromUrl();

    const allPills = [
      { name: 'All', label: 'All Products' }
    ].concat(list);

    container.innerHTML = allPills.map(function (c) {
      const name = c.name;
      const label = c.label || c.name;
      const isActive = (name === selectedFromUrl) ||
                       (name === 'All' && (selectedFromUrl === 'All' || !selectedFromUrl));

      return '<button type="button" ' +
                  'class="category-pill' + (isActive ? ' active' : '') + '" ' +
                  'data-category="' + esc(name) + '" ' +
                  'aria-pressed="' + (isActive ? 'true' : 'false') + '">' +
        esc(label) +
      '</button>';
    }).join('');

    // Tell products-grid.js the pills changed so it can rewire click handlers
    document.dispatchEvent(new CustomEvent('categoryPillsRebuilt', {
      detail: { count: allPills.length }
    }));
  }

  /* ============================================================
     LOAD FROM SUPABASE
     ============================================================ */
  async function loadCategories() {
    renderAttempts++;

    // Wait for Supabase client
    if (!window.db && window.dbReadyPromise) {
      try { await window.dbReadyPromise; } catch (e) {}
    }

    // If Supabase still not ready, try one more time in 500ms
    if (!window.db && renderAttempts < 10) {
      setTimeout(loadCategories, 500);
      return;
    }

    // No Supabase → fallback
    if (!window.db) {
      console.warn('[categories-live] Supabase not available — using fallback list');
      currentCategories = FALLBACK_CATEGORIES;
      renderHomeGrid(currentCategories);
      renderFilterPills(currentCategories);
      loaded = true;
      return;
    }

    // Query Supabase
    try {
      const { data, error } = await window.db
        .from('categories')
        .select('id, name, name_ta, slug, icon, image_url, display_order, is_published')
        .eq('is_published', true)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      // If no categories in DB, fall back
      const list = (data && data.length) ? data : FALLBACK_CATEGORIES;
      currentCategories = list;
      loaded = true;

      renderHomeGrid(list);
      renderFilterPills(list);

      console.log('[categories-live] Loaded ' + list.length + ' categories from Supabase');
    } catch (err) {
      console.warn('[categories-live] load failed:', err);

      // Fallback on error
      currentCategories = FALLBACK_CATEGORIES;
      renderHomeGrid(currentCategories);
      renderFilterPills(currentCategories);
      loaded = true;
    }
  }

  /* ============================================================
     REALTIME SUBSCRIPTION
     ------------------------------------------------------------
     Listens for INSERT / UPDATE / DELETE on the categories table.
     When a change arrives, reloads the list.
     ============================================================ */
  function subscribeRealtime() {
    if (!window.db || typeof window.db.channel !== 'function') return;

    try {
      window.db
        .channel('public-categories-live')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'categories' },
          function (payload) {
            console.log('[categories-live] realtime event:', payload.eventType);
            // Small delay so the DB commit completes before we read
            setTimeout(loadCategories, 800);
          })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            console.log('[categories-live] Realtime subscribed');
          }
        });
    } catch (e) {
      console.warn('[categories-live] realtime failed:', e);
    }
  }

  /* ============================================================
     ALSO LOAD HOMEPAGE FEATURED PRODUCTS (if container exists)
     ============================================================ */
  async function loadFeaturedProducts() {
    const grid = document.getElementById('homeProductGrid');
    if (!grid || !window.db) return;

    try {
      const { data, error } = await window.db
        .from('products')
        .select('id, name, category, weight, price, image_url, is_featured')
        .eq('is_published', true)
        .is('deleted_at', null)          // hide soft-deleted
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8);

      if (error) throw error;
      if (!data || !data.length) return;

      grid.innerHTML = data.map(function (p) {
        const img = p.image_url || '';
        return '<a href="products.html" class="product-card">' +
          '<div class="product-image">' +
            (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy">' : '') +
          '</div>' +
          '<div class="product-details">' +
            (p.category ? '<span class="product-category">' + esc(p.category) + '</span>' : '') +
            '<h3>' + esc(p.name) + '</h3>' +
            (p.weight ? '<span class="product-weight">' + esc(p.weight) + '</span>' : '') +
            '<span class="product-price">₹' + esc(p.price) + '</span>' +
          '</div>' +
        '</a>';
      }).join('');
    } catch (e) {
      console.warn('[categories-live] featured products load failed:', e);
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    loadCategories();
    loadFeaturedProducts();
    subscribeRealtime();
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  window.CategoriesLive = {
    reload: loadCategories,
    getList: function () { return currentCategories.slice(); },
    isLoaded: function () { return loaded; },
    slugify: slugify,
    FALLBACK: FALLBACK_CATEGORIES
  };
  window.reloadCategories = loadCategories;

  /* ============================================================
     BOOT
     ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
