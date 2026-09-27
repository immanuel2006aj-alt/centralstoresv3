/* ============================================================
   CENTRAL & STORES — Site-wide product search
   ------------------------------------------------------------
   Responsibilities
     • Live-filter published products as the user types.
     • Render a dropdown of matches (loading / empty / error).
     • Keyboard navigation + ARIA combobox/listbox semantics.
     • Click on a result → navigate (homepage) or scroll+flash
       (products.html, where the product card exists).

   Data source
     • Supabase `products` table. No productsData global.
     • Waits for `window.db` (set by supabase-config.js).

   Security
     • User query is stripped of SQL wildcards (% _ \) and
       PostgREST filter metacharacters (, ( )) before use.
     • All product fields are rendered with textContent; no
       innerHTML on DB-supplied strings anywhere in this file.

   Contract
     #homeSearch  or  #productSearch  → input (either one)
     #searchResults                   → dropdown container
     .search-item / .search-info / .search-empty  → existing CSS
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONFIG ---------- */
  const DEBOUNCE_MS   = 200;
  const MIN_QUERY_LEN = 2;
  const RESULT_LIMIT  = 8;
  const CACHE_MAX     = 20;

  /* ---------- ELEMENTS ---------- */
  const searchInput =
    document.getElementById('homeSearch') ||
    document.getElementById('productSearch');

  const searchResults = document.getElementById('searchResults');

  if (!searchInput || !searchResults) return;

  /* ---------- STATE ---------- */
  let debounceTimer = null;
  let currentQuery  = '';
  let inFlight      = null;         /* AbortController or null */
  let activeIndex   = -1;
  let currentItems  = [];
  const queryCache  = new Map();

  /* ---------- ARIA WIRING (idempotent) ---------- */
  if (!searchResults.id) searchResults.id = 'searchResults';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', searchResults.id);
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.setAttribute('aria-haspopup', 'listbox');
  searchResults.setAttribute('role', 'listbox');
  searchResults.setAttribute('aria-live', 'polite');

  /* ============================================================
     HELPERS
     ============================================================ */

  /* Strip ILIKE wildcards and PostgREST filter delimiters. */
  function sanitizeQuery(raw) {
    return String(raw || '')
      .replace(/[%_\\]/g, ' ')   /* SQL wildcards + escape */
      .replace(/[,()]/g, ' ')    /* PostgREST filter delimiters */
      .trim();
  }

  function cacheGet(key) {
    if (!queryCache.has(key)) return null;
    const items = queryCache.get(key);
    queryCache.delete(key);
    queryCache.set(key, items);
    return items;
  }

  function cacheSet(key, items) {
    if (queryCache.has(key)) queryCache.delete(key);
    queryCache.set(key, items);
    while (queryCache.size > CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      queryCache.delete(oldest);
    }
  }

  function openDropdown() {
    searchResults.style.display = 'block';
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    searchResults.style.display = 'none';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function clearDropdown() {
    while (searchResults.firstChild) {
      searchResults.removeChild(searchResults.firstChild);
    }
    currentItems = [];
    activeIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
  }

  function renderMessage(text, extraClass) {
    clearDropdown();
    const row = document.createElement('div');
    row.className = 'search-empty' + (extraClass ? ' ' + extraClass : '');
    row.textContent = text;
    searchResults.appendChild(row);
    openDropdown();
  }

  /* Build the small search SVG via createElementNS so this file
     contains zero innerHTML usage anywhere. */
  function buildSearchIcon() {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '7');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '2');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'm20 20-4-4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');

    svg.appendChild(circle);
    svg.appendChild(path);
    return svg;
  }

  /* Fallback image for products with no image_url. Rendered as
     a neutral inline SVG so we never emit a broken <img>. */
  function buildImageFallback() {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 60');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.background = '#f5f5f5';
    svg.style.borderRadius = '10px';

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '18');
    rect.setAttribute('y', '22');
    rect.setAttribute('width', '24');
    rect.setAttribute('height', '16');
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#bdbdbd');
    rect.setAttribute('stroke-width', '2');

    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', 'M22 30h16');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#bdbdbd');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');

    svg.appendChild(rect);
    svg.appendChild(line);
    return svg;
  }

  /* ============================================================
     SUPABASE QUERY
     ============================================================ */

  function isDbReady() {
    return !!(window.db && typeof window.db.from === 'function');
  }

  async function fetchProducts(query, signal) {
    const like = '%' + query + '%';

    /* Only published rows. Out-of-stock rows are returned too
       so the customer can find them and view details, but the
       dropdown marks them clearly. */
    const request = window.db
      .from('products')
      .select('id, name, category, weight, price, image_url, is_available, is_published, is_featured')
      .eq('is_published', true)
      .or([
        'name.ilike.' + like,
        'category.ilike.' + like,
        'weight.ilike.' + like
      ].join(','))
      .order('is_featured', { ascending: false })
      .order('name',       { ascending: true })
      .limit(RESULT_LIMIT);

    /* postgrest-js v2 supports abortSignal via .abortSignal().
       Older versions silently ignore it. */
    if (signal) {
      try { request.abortSignal(signal); } catch (e) { /* no-op */ }
    }

    const { data, error } = await request;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  /* ============================================================
     RENDER
     ============================================================ */

  function renderItems(items) {
    clearDropdown();
    currentItems = items;
    activeIndex = -1;

    if (!items.length) {
      renderMessage('No products found');
      return;
    }

    const fragment = document.createDocumentFragment();

    items.forEach(function (product, index) {
      const row = document.createElement('div');
      row.className = 'search-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.id = 'search-item-' + index;
      row.dataset.id    = String(product.id);
      row.dataset.index = String(index);

      /* Image (or neutral SVG fallback) */
      const imageUrl = String(product.image_url || '').trim();
      if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        /* If the URL is broken, swap to the SVG fallback. */
        img.addEventListener('error', function () {
          if (!img.parentNode) return;
          const fb = buildImageFallback();
          fb.setAttribute('width', '58');
          fb.setAttribute('height', '58');
          img.parentNode.replaceChild(fb, img);
        }, { once: true });
        row.appendChild(img);
      } else {
        const fb = buildImageFallback();
        fb.setAttribute('width', '58');
        fb.setAttribute('height', '58');
        row.appendChild(fb);
      }

      /* Info block */
      const info = document.createElement('div');
      info.className = 'search-info';

      const h4 = document.createElement('h4');
      h4.textContent = String(product.name || '');

      const p = document.createElement('p');
      const cat = String(product.category || '');
      const wt  = String(product.weight || '');
      const parts = [];
      if (cat) parts.push(cat);
      if (wt)  parts.push(wt);
      if (product.is_available === false) parts.push('Out of stock');
      p.textContent = parts.join(' • ');

      info.appendChild(h4);
      info.appendChild(p);
      row.appendChild(info);

      fragment.appendChild(row);
    });

    searchResults.appendChild(fragment);
    openDropdown();
  }

  function setActiveIndex(next) {
    const items = searchResults.querySelectorAll('.search-item');
    if (!items.length) return;

    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.remove('is-active');
      items[activeIndex].setAttribute('aria-selected', 'false');
    }

    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    activeIndex = next;

    const el = items[activeIndex];
    el.classList.add('is-active');
    el.setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', el.id);

    if (typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  /* ============================================================
     ACTION ON SELECT
     ============================================================ */

  function selectProduct(product) {
    const id = product && product.id;
    if (id == null) return;

    closeDropdown();
    searchInput.value = '';

    /* If a matching card exists on this page (products.html),
       scroll to it and flash it. Otherwise navigate to the
       product details page. */
    const card = document.getElementById('product-' + id);

    if (card) {
      try {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        card.scrollIntoView();
      }
      const prevOutline = card.style.outline;
      card.style.outline = '3px solid #f5b400';
      setTimeout(function () {
        card.style.outline = prevOutline || 'none';
      }, 2000);
      return;
    }

    window.location.href =
      'product-details.html?id=' + encodeURIComponent(id);
  }

  /* ============================================================
     CORE SEARCH
     ============================================================ */

  async function runSearch(rawQuery) {
    const query = sanitizeQuery(rawQuery);

    if (!query || query.length < MIN_QUERY_LEN) {
      closeDropdown();
      clearDropdown();
      currentQuery = '';
      return;
    }

    currentQuery = query;

    const cached = cacheGet(query);
    if (cached) {
      renderItems(cached);
      return;
    }

    /* Cancel any pending request. */
    if (inFlight) {
      try { inFlight.abort(); } catch (e) { /* ignore */ }
      inFlight = null;
    }

    /* If the DB client hasn't initialised yet, wait briefly. */
    if (!isDbReady()) {
      renderMessage('Search is starting up…');

      if (window.dbReadyPromise && typeof window.dbReadyPromise.then === 'function') {
        window.dbReadyPromise
          .then(function () { runSearch(query); })
          .catch(function () { renderMessage('Search is unavailable right now.'); });
      } else {
        /* Poll once after 400ms, then give up gracefully. */
        setTimeout(function () {
          if (query !== currentQuery) return;
          if (isDbReady()) runSearch(query);
          else renderMessage('Search is unavailable right now.');
        }, 400);
      }
      return;
    }

    renderMessage('Searching…', 'search-loading');

    const controller = (typeof AbortController !== 'undefined')
      ? new AbortController()
      : null;
    inFlight = controller;

    try {
      const items = await fetchProducts(query, controller ? controller.signal : null);

      /* If the query changed while we were waiting, drop the result. */
      if (query !== currentQuery) return;

      cacheSet(query, items);
      renderItems(items);
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) return;
      renderMessage('Search is unavailable right now. Please try again.');
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  /* ============================================================
     EVENTS
     ============================================================ */

  searchInput.addEventListener('input', function () {
    const value = searchInput.value;

    if (debounceTimer) clearTimeout(debounceTimer);

    if (!value || value.trim().length < MIN_QUERY_LEN) {
      closeDropdown();
      clearDropdown();
      currentQuery = '';
      return;
    }

    debounceTimer = setTimeout(function () {
      runSearch(value);
    }, DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', function (e) {
    const dropdownOpen = searchResults.style.display === 'block';

    if (e.key === 'Escape') {
      if (dropdownOpen) {
        e.preventDefault();
        closeDropdown();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (!dropdownOpen || !currentItems.length) return;
      e.preventDefault();
      setActiveIndex(activeIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      if (!dropdownOpen || !currentItems.length) return;
      e.preventDefault();
      setActiveIndex(activeIndex - 1);
      return;
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && currentItems[activeIndex]) {
        e.preventDefault();
        selectProduct(currentItems[activeIndex]);
      } else if (currentItems.length === 1) {
        /* Common UX: single match → Enter picks it. */
        e.preventDefault();
        selectProduct(currentItems[0]);
      }
      return;
    }
  });

  searchResults.addEventListener('click', function (e) {
    const row = e.target.closest('.search-item');
    if (!row) return;
    const idx = Number(row.dataset.index);
    const product = currentItems[idx];
    if (product) selectProduct(product);
  });

  searchResults.addEventListener('mousemove', function (e) {
    const row = e.target.closest('.search-item');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (!isNaN(idx) && idx !== activeIndex) setActiveIndex(idx);
  });

  document.addEventListener('click', function (e) {
    if (e.target === searchInput) return;
    if (searchResults.contains(e.target)) return;
    closeDropdown();
  });

  /* ============================================================
     INITIAL STATE
     ============================================================ */
  closeDropdown();
})();