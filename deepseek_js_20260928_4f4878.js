/* ============================================================
   CENTRAL & STORES — Product Grid
   ------------------------------------------------------------
   Renders the catalogue from window.productsData (Supabase),
   handles category filtering, and wires "Add to cart".

   CONTRACT WITH products-live.js
     • window.productsData is an array of product objects:
         {
           id, name, category, weight,
           price,                 (required)
           original_price,        (optional — enables offer badge)
           image_url, image,      (either — image_url preferred)
           description,
           is_available, is_published, is_featured
         }
     • document fires:
         'productsLoaded'  detail: products[]
         'productsError'   detail: { message }

   CONTRACT WITH cart-common.js
     • window.addProductToCart(product) is expected to exist.

   CONTRACT WITH search.js
     • Each product card has id="product-{id}" so search can
       scroll to it after selection.

   CONTRACT WITH style.css
     • Uses these existing classes:
         .product-card, .product-image, .product-details,
         .product-category, .product-name, .product-weight,
         .product-offer-badge, .product-price-row,
         .product-price, .product-price-original,
         .product-bottom, .product-stock,
         .product-stock--out, .add-cart-btn,
         .product-card--skeleton, .product-card--out-of-stock
         .skeleton-line, .state-block, .products-empty-state

   SECURITY
     All product fields are rendered with textContent.
     Image URLs are assigned to img.src, never innerHTML.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  'use strict';

  /* ---------- DOM ---------- */
  var productsGrid = document.getElementById("productsGrid");
  var productCount = document.getElementById("productCount");

  if (!productsGrid) {
    if (window.console && console.warn) {
      console.warn("[products-grid] #productsGrid not found.");
    }
    return;
  }

  /* Announce count changes to screen readers. */
  if (productCount && !productCount.hasAttribute("aria-live")) {
    productCount.setAttribute("aria-live", "polite");
  }

  /* ---------- STATE ---------- */
  var productsLoadedFlag = false;
  var pendingCategory = null;
  var activeCategory = "All";
  var lastItems = [];

  if (!Array.isArray(window.productsData)) {
    window.productsData = [];
  }

  /* ---------- HELPERS ---------- */

  function normaliseCategory(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function productMatchesCategory(product, category) {
    if (category === "All") return true;
    return normaliseCategory(product.category) === normaliseCategory(category);
  }

  function formatNumber(n) {
    var value = Number(n) || 0;
    try {
      return new Intl.NumberFormat("en-IN").format(value);
    } catch (e) {
      return String(value);
    }
  }

  function formatINR(n) {
    return "₹" + formatNumber(n);
  }

  function computeDiscountPercent(price, originalPrice) {
    var p = Number(price);
    var o = Number(originalPrice);
    if (!isFinite(p) || !isFinite(o)) return 0;
    if (o <= 0 || p <= 0) return 0;
    if (o <= p) return 0;
    var pct = Math.round(((o - p) / o) * 100);
    if (pct <= 0) return 0;
    if (pct > 99) pct = 99;
    return pct;
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* Trusted inline SVG fragments — no user data. */
  function svgFromSymbol(symbolId, className) {
    var SVG_NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (className) svg.setAttribute("class", className);
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", symbolId);
    svg.appendChild(use);
    return svg;
  }

  function svgSearch() {
    return svgFromSymbol("#icon-search");
  }

  function svgCheck() {
    var SVG_NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "m5 12 5 5L20 7");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function svgPlus() {
    var SVG_NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var p1 = document.createElementNS(SVG_NS, "path");
    p1.setAttribute("d", "M12 5v14");
    p1.setAttribute("fill", "none");
    p1.setAttribute("stroke", "currentColor");
    p1.setAttribute("stroke-width", "2.4");
    p1.setAttribute("stroke-linecap", "round");
    var p2 = document.createElementNS(SVG_NS, "path");
    p2.setAttribute("d", "M5 12h14");
    p2.setAttribute("fill", "none");
    p2.setAttribute("stroke", "currentColor");
    p2.setAttribute("stroke-width", "2.4");
    p2.setAttribute("stroke-linecap", "round");
    svg.appendChild(p1);
    svg.appendChild(p2);
    return svg;
  }

  /* ---------- CARD BUILDER ---------- */

  function buildImagePlaceholder() {
    var ph = document.createElement("div");
    ph.className = "product-image-placeholder";
    var span = document.createElement("span");
    span.textContent = "NO IMAGE";
    ph.appendChild(span);
    return ph;
  }

  function buildCard(product) {
    var card = document.createElement("article");
    card.className = "product-card";
    if (product.id != null) card.id = "product-" + String(product.id);

    var isAvailable = product.is_available !== false;
    var price = Number(product.price) || 0;
    var originalPrice = Number(product.original_price) || 0;
    var discountPct = computeDiscountPercent(price, originalPrice);

    if (!isAvailable) card.classList.add("product-card--out-of-stock");
    if (discountPct > 0) card.classList.add("product-card--has-offer");

    /* ---------- IMAGE ---------- */
    var imageWrap = document.createElement("div");
    imageWrap.className = "product-image";

    var imgSrc =
      (typeof product.image_url === "string" && product.image_url) ||
      (typeof product.image === "string" && product.image) ||
      "";

    if (imgSrc) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = String(product.name || "Product");
      img.addEventListener(
        "error",
        function () {
          if (img.parentNode === imageWrap) {
            imageWrap.removeChild(img);
            imageWrap.appendChild(buildImagePlaceholder());
          }
        },
        { once: true }
      );
      img.src = imgSrc;
      imageWrap.appendChild(img);
    } else {
      imageWrap.appendChild(buildImagePlaceholder());
    }

    /* Offer badge — only when there is a real discount. */
    if (discountPct > 0) {
      var offerBadge = document.createElement("span");
      offerBadge.className = "product-offer-badge";
      offerBadge.textContent = discountPct + "% OFF";
      offerBadge.setAttribute("aria-label", discountPct + " percent off");
      imageWrap.appendChild(offerBadge);
    }

    /* Wishlist — visual only, feature not implemented. */
    var wishlist = document.createElement("button");
    wishlist.type = "button";
    wishlist.className = "wishlist-btn";
    wishlist.setAttribute(
      "aria-label",
      "Save " + (product.name || "product") + " to wishlist (coming soon)"
    );
    var heartSvg = svgFromSymbol("#icon-heart");
    wishlist.appendChild(heartSvg);
    imageWrap.appendChild(wishlist);

    card.appendChild(imageWrap);

    /* ---------- DETAILS ---------- */
    var details = document.createElement("div");
    details.className = "product-details";

    if (product.category) {
      var catSpan = document.createElement("span");
      catSpan.className = "product-category";
      catSpan.textContent = String(product.category);
      details.appendChild(catSpan);
    }

    var nameEl = document.createElement("h3");
    nameEl.className = "product-name";
    nameEl.textContent = String(product.name || "Product");
    details.appendChild(nameEl);

    if (product.weight) {
      var weightSpan = document.createElement("span");
      weightSpan.className = "product-weight";
      weightSpan.textContent = String(product.weight);
      details.appendChild(weightSpan);
    }

    /* ---------- PRICE ROW ---------- */
    var priceRow = document.createElement("div");
    priceRow.className = "product-price-row";

    if (price > 0) {
      var currentPrice = document.createElement("span");
      currentPrice.className = "product-price";
      currentPrice.textContent = formatINR(price);
      priceRow.appendChild(currentPrice);

      if (discountPct > 0) {
        var origPrice = document.createElement("span");
        origPrice.className = "product-price-original";
        origPrice.textContent = formatINR(originalPrice);
        origPrice.setAttribute(
          "aria-label",
          "Original price " + formatINR(originalPrice)
        );
        priceRow.appendChild(origPrice);
      }
    } else {
      var onCall = document.createElement("span");
      onCall.className = "product-price-on-call";
      onCall.textContent = "Price on call";
      priceRow.appendChild(onCall);
    }

    details.appendChild(priceRow);

    /* ---------- STOCK + ACTION ---------- */
    var bottom = document.createElement("div");
    bottom.className = "product-bottom";

    var stock = document.createElement("span");
    stock.className =
      "product-stock" + (isAvailable ? "" : " product-stock--out");
    stock.textContent = isAvailable ? "In Stock" : "Out of Stock";
    bottom.appendChild(stock);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-cart-btn";
    addBtn.dataset.id = String(product.id);

    if (!isAvailable) {
      addBtn.disabled = true;
      addBtn.textContent = "Out of Stock";
      addBtn.setAttribute(
        "aria-label",
        (product.name || "Product") + " is out of stock"
      );
    } else {
      addBtn.appendChild(svgPlus());
      addBtn.appendChild(document.createTextNode(" Add"));
      addBtn.setAttribute(
        "aria-label",
        "Add " + (product.name || "product") + " to cart"
      );
    }

    bottom.appendChild(addBtn);
    details.appendChild(bottom);

    card.appendChild(details);

    return card;
  }

  /* ---------- STATE RENDERERS ---------- */

  function renderSkeleton() {
    productsGrid.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 6; i++) {
      var card = document.createElement("article");
      card.className = "product-card product-card--skeleton";
      card.setAttribute("aria-hidden", "true");
      var line1 = document.createElement("div");
      line1.className = "skeleton-line";
      line1.style.height = "130px";
      line1.style.marginBottom = "12px";
      line1.style.borderRadius = "6px";
      card.appendChild(line1);
      var line2 = document.createElement("div");
      line2.className = "skeleton-line";
      line2.style.height = "12px";
      line2.style.marginBottom = "8px";
      card.appendChild(line2);
      var line3 = document.createElement("div");
      line3.className = "skeleton-line";
      line3.style.height = "12px";
      line3.style.width = "60%";
      card.appendChild(line3);
      frag.appendChild(card);
    }
    productsGrid.appendChild(frag);
    productsGrid.setAttribute("aria-busy", "true");
  }

  function renderEmpty() {
    productsGrid.innerHTML = "";
    productsGrid.setAttribute("aria-busy", "false");

    var wrap = document.createElement("div");
    wrap.className = "products-empty-state show";

    var icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.appendChild(svgSearch());

    var h = document.createElement("h3");
    h.textContent = "No products found";

    var p = document.createElement("p");
    p.textContent = "Try another category or search word.";

    wrap.appendChild(icon);
    wrap.appendChild(h);
    wrap.appendChild(p);
    productsGrid.appendChild(wrap);
  }

  function renderError() {
    productsGrid.innerHTML = "";
    productsGrid.setAttribute("aria-busy", "false");

    var wrap = document.createElement("div");
    wrap.className = "products-empty-state show";

    var h = document.createElement("h3");
    h.textContent = "We couldn't load products";

    var p = document.createElement("p");
    p.textContent =
      "Please check your connection and try again.";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-cart-btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", function () {
      if (typeof window.reloadLiveProducts === "function") {
        renderSkeleton();
        window.reloadLiveProducts();
      } else {
        window.location.reload();
      }
    });

    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(btn);
    productsGrid.appendChild(wrap);
  }

  /* ---------- MAIN RENDER ---------- */

  function renderProducts(items) {
    productsGrid.innerHTML = "";
    productsGrid.setAttribute("aria-busy", "false");

    if (!Array.isArray(items) || !items.length) {
      renderEmpty();
      if (productCount) productCount.textContent = "0";
      return;
    }

    var frag = document.createDocumentFragment();
    items.forEach(function (product) {
      frag.appendChild(buildCard(product));
    });
    productsGrid.appendChild(frag);

    if (productCount) productCount.textContent = String(items.length);
  }

  /* ---------- FILTER ---------- */

  function applyCategory(category, sourceItems) {
    activeCategory = category || "All";
    var items = sourceItems || window.productsData;

    if (!Array.isArray(items)) items = [];

    var filtered =
      activeCategory === "All"
        ? items
        : items.filter(function (p) {
            return productMatchesCategory(p, activeCategory);
          });

    lastItems = filtered;

    var pills = document.querySelectorAll(".category-pill");
    pills.forEach(function (btn) {
      var isActive = (btn.dataset.category || "All") === activeCategory;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    renderProducts(filtered);
  }

  /* ---------- EVENTS ---------- */

  /* Category pills */
  document.querySelectorAll(".category-pill").forEach(function (button) {
    if (!button.hasAttribute("aria-pressed")) {
      button.setAttribute(
        "aria-pressed",
        button.classList.contains("active") ? "true" : "false"
      );
    }

    button.addEventListener("click", function () {
      var selectedCategory = button.dataset.category || "All";

      if (!productsLoadedFlag) {
        pendingCategory = selectedCategory;
        return;
      }

      applyCategory(selectedCategory, window.productsData);
    });
  });

  /* Add to cart — event delegation */
  document.addEventListener("click", function (event) {
    var button = event.target.closest(".add-cart-btn");
    if (!button) return;
    if (button.disabled) return;

    var id = button.dataset.id;
    if (id == null) return;

    var product = (window.productsData || []).find(function (item) {
      return String(item.id) === String(id);
    });
    if (!product) return;

    if (typeof window.addProductToCart !== "function") {
      if (window.console && console.warn) {
        console.warn("[products-grid] cart-common.js is not loaded.");
      }
      return;
    }

    window.addProductToCart({
      id: product.id,
      name: product.name,
      category: product.category,
      weight: product.weight,
      price: product.price,
      image_url: product.image_url || "",
      image: product.image || product.image_url || ""
    });

    /* Visual feedback */
    var originalText = button.textContent;
    button.classList.add("added");
    button.textContent = "";
    var check = svgCheck();
    check.classList.add("add-cart-btn__icon");
    button.appendChild(check);
    button.appendChild(document.createTextNode(" Added"));

    clearTimeout(button._addedTimer);
    button._addedTimer = setTimeout(function () {
      button.classList.remove("added");
      button.innerHTML = "";
      button.appendChild(svgPlus());
      button.appendChild(document.createTextNode(" Add"));
    }, 900);
  });

  /* Products loaded */
  document.addEventListener("productsLoaded", function () {
    productsLoadedFlag = true;
    var category = pendingCategory || "All";
    pendingCategory = null;
    applyCategory(category, window.productsData);
  });

  /* Products failed */
  document.addEventListener("productsError", function () {
    productsLoadedFlag = true;
    renderError();
    if (productCount) productCount.textContent = "0";
  });

  /* ---------- INITIAL RENDER ---------- */

  if (window.productsData && window.productsData.length) {
    productsLoadedFlag = true;
    applyCategory("All", window.productsData);
  } else {
    renderSkeleton();
    if (productCount) productCount.textContent = "0";
  }
});