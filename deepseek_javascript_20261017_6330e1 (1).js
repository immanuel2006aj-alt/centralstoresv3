/* ============================================================
   CENTRAL & STORES — Cart page controller (cart.html)
   ------------------------------------------------------------
   RESPONSIBILITY
     • Render the cart list from cart-common.js state.
     • Toggle empty / products / customer-details / confirmation.
     • Handle +/− quantity and remove-item actions.
     • Validate the enquiry form.
     • PRIMARY: create a real order in Supabase
       (orders + order_items) with server-side price validation.
     • SECONDARY: send the same order as a WhatsApp enquiry.

   DEPENDENCIES
     • cart-common.js     → getCentralCart, saveCentralCart, ...
     • config.js          → window.storeWaLink(message), STORE_CONFIG
     • supabase-config.js → window.db / window.supabaseReady
     • cart.html DOM      → #emptyCart, #cartProductsCard,
                            #customerDetailsCard, #cartItemsList,
                            #cartItemCount, #orderForm,
                            #placeOrderBtn, #sendOrderBtn,
                            #orderConfirmation (optional)

   ORDER FLOW
     1. Validate form.
     2. Fetch each product fresh from Supabase (published + available).
     3. Verify cart price matches current DB price.
     4. Insert order + order_items (RPC if available).
     5. On success: clear cart, show confirmation.
     6. On failure: keep cart, show error.

   SECURITY
     • All user / product fields are rendered with textContent.
     • Image URLs are assigned to img.src, never to innerHTML.
     • No innerHTML is used anywhere in this file.
     • Order total is recomputed from DB prices, not trusted from cart.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  'use strict';

  /* ---------- DOM ---------- */
  var emptyCart           = document.getElementById("emptyCart");
  var cartProductsCard    = document.getElementById("cartProductsCard");
  var customerDetailsCard = document.getElementById("customerDetailsCard");
  var cartItemsList       = document.getElementById("cartItemsList");
  var cartItemCount       = document.getElementById("cartItemCount");
  var orderForm           = document.getElementById("orderForm");
  var sendOrderBtn        = document.getElementById("sendOrderBtn");
  var placeOrderBtn       = document.getElementById("placeOrderBtn");
  var orderConfirmation   = document.getElementById("orderConfirmation");

  var nameInput    = document.getElementById("customerName");
  var phoneInput   = document.getElementById("customerPhone");
  var addressInput = document.getElementById("customerAddress");
  var noteInput    = document.getElementById("customerNote");

  var nameError    = document.getElementById("customerNameError");
  var phoneError   = document.getElementById("customerPhoneError");
  var addressError = document.getElementById("customerAddressError");

  /* If the page is missing required nodes, do nothing. */
  if (!cartItemsList) return;

  /* ---------- CONSTANTS ---------- */
  var COOLDOWN_KEY        = 'cs_last_enquiry_ms';
  var COOLDOWN_MS         = 30 * 1000;
  var ORDER_COOLDOWN_KEY  = 'cs_last_order_ms';
  var ORDER_COOLDOWN_MS   = 30 * 1000;
  var DB_READY_TIMEOUT_MS = 10000;

  var STATUS_NEW = 'NEW';

  var isSubmitting = false;

  /* ---------- STATE ADAPTERS ---------- */
  function getCart() {
    return (typeof window.getCentralCart === 'function')
      ? window.getCentralCart()
      : [];
  }

  function saveCart(cart) {
    if (typeof window.saveCentralCart === 'function') {
      window.saveCentralCart(cart);
    }
  }

  function clearCart() {
    if (typeof window.clearCentralCart === 'function') {
      window.clearCentralCart();
    } else {
      try { localStorage.removeItem(getCartKey()); } catch (e) {}
      document.dispatchEvent(new CustomEvent('centralCartUpdated', { detail: { cart: [] } }));
    }
  }

  function getCartKey() {
    return (window.CentralCart && window.CentralCart.KEY) || 'centralStoresCart';
  }

  /* ---------- SUPABASE CLIENT ---------- */
  function getDb() {
    return window.db || null;
  }

  /**
   * Resolve when a Supabase client is available.
   * Supports the three ready patterns in this project:
   *   window.supabaseReady       (Promise)
   *   window.dbReadyPromise      (Promise)
   *   window.dbReady             (Promise)
   * If none exist, polls for window.db for up to DB_READY_TIMEOUT_MS.
   */
  function waitForDb() {
    if (window.db) return Promise.resolve(window.db);

    var candidates = [window.supabaseReady, window.dbReadyPromise, window.dbReady];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && typeof candidates[i].then === 'function') {
        return candidates[i].then(function () { return window.db || null; });
      }
    }

    return new Promise(function (resolve) {
      var startedAt = Date.now();
      var timer = setInterval(function () {
        if (window.db) {
          clearInterval(timer);
          resolve(window.db);
          return;
        }
        if (Date.now() - startedAt > DB_READY_TIMEOUT_MS) {
          clearInterval(timer);
          resolve(null);
        }
      }, 100);
    });
  }

  /* ---------- UTILITIES ---------- */

  function formatINR(n) {
    if (typeof window.storeFormatPrice === 'function') {
      return window.storeFormatPrice(n);
    }
    var value = Number(n) || 0;
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(value);
    } catch (e) {
      return '₹' + value;
    }
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function showToast(msg, type) {
    var toast = document.getElementById('cartToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cartToast';
      toast.className = 'cart-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.hidden = true;
      document.body.appendChild(toast);
      toast.style.position = 'fixed';
      toast.style.left = '50%';
      toast.style.bottom = '90px';
      toast.style.transform = 'translateX(-50%)';
      toast.style.maxWidth = '90vw';
      toast.style.padding = '12px 18px';
      toast.style.borderRadius = '12px';
      toast.style.background = '#111111';
      toast.style.color = '#ffffff';
      toast.style.fontSize = '12px';
      toast.style.fontWeight = '700';
      toast.style.zIndex = '10000';
      toast.style.boxShadow = '0 12px 30px rgba(0,0,0,0.25)';
      toast.style.transition = 'opacity 0.25s, transform 0.25s';
    }
    toast.textContent = msg;
    toast.className = 'cart-toast ' + (type || '');
    toast.hidden = false;
    toast.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.hidden = true; }, 300);
    }, 3400);
  }

  /* ---------- RENDER ---------- */

  function buildImageFallback() {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('style', 'width:32px;height:32px;color:#bd8500;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-cart');
    svg.appendChild(use);
    return svg;
  }

  function buildItemNode(product) {
    var article = document.createElement('article');
    article.className = 'cart-item';
    article.dataset.id = String(product.id);

    /* --- image --- */
    var imgWrap = document.createElement('div');
    imgWrap.className = 'cart-item-image-wrap';

    if (typeof product.image === 'string' && product.image.trim()) {
      var img = document.createElement('img');
      img.className = 'cart-item-image';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = String(product.name || 'Product');
      img.addEventListener('error', function () {
        clearChildren(imgWrap);
        imgWrap.appendChild(buildImageFallback());
      }, { once: true });
      img.src = product.image;
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(buildImageFallback());
    }
    article.appendChild(imgWrap);

    /* --- details --- */
    var details = document.createElement('div');
    details.className = 'cart-item-details';

    var cat = document.createElement('span');
    cat.className = 'cart-item-category';
    cat.textContent = String(product.category || '');
    if (!cat.textContent) cat.style.display = 'none';
    details.appendChild(cat);

    var name = document.createElement('h4');
    name.textContent = String(product.name || 'Product');
    details.appendChild(name);

    var weight = document.createElement('span');
    weight.className = 'cart-item-weight';
    weight.textContent = String(product.weight || '');
    if (!weight.textContent) weight.style.display = 'none';
    details.appendChild(weight);

    if (Number(product.price) > 0) {
      var price = document.createElement('span');
      price.className = 'cart-item-price';
      price.textContent = formatINR(product.price);
      details.appendChild(price);
    }

    /* --- actions --- */
    var actions = document.createElement('div');
    actions.className = 'cart-item-actions';

    var qtyCtrl = document.createElement('div');
    qtyCtrl.className = 'quantity-control';
    qtyCtrl.setAttribute('role', 'group');
    qtyCtrl.setAttribute('aria-label', 'Quantity for ' + (product.name || 'product'));

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'quantity-btn';
    minus.dataset.action = 'minus';
    minus.dataset.id = String(product.id);
    minus.setAttribute('aria-label', 'Decrease quantity');
    minus.textContent = '−';

    var value = document.createElement('span');
    value.className = 'quantity-value';
    value.setAttribute('aria-live', 'polite');
    value.textContent = String(Number(product.quantity) || 0);

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'quantity-btn';
    plus.dataset.action = 'plus';
    plus.dataset.id = String(product.id);
    plus.setAttribute('aria-label', 'Increase quantity');
    plus.textContent = '+';

    qtyCtrl.appendChild(minus);
    qtyCtrl.appendChild(value);
    qtyCtrl.appendChild(plus);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-cart-item';
    removeBtn.dataset.id = String(product.id);
    removeBtn.setAttribute('aria-label', 'Remove ' + (product.name || 'product') + ' from cart');
    removeBtn.textContent = 'Remove';

    actions.appendChild(qtyCtrl);
    actions.appendChild(removeBtn);

    details.appendChild(actions);
    article.appendChild(details);

    return article;
  }

  function renderCart() {
    var cart = getCart();

    /* Hide confirmation panel whenever the cart changes. */
    if (orderConfirmation) orderConfirmation.hidden = true;

    if (!cart.length) {
      if (emptyCart) emptyCart.hidden = false;
      if (cartProductsCard) cartProductsCard.hidden = true;
      if (customerDetailsCard) customerDetailsCard.hidden = true;
      if (cartItemCount) cartItemCount.textContent = '0';
      clearChildren(cartItemsList);
      return;
    }

    if (emptyCart) emptyCart.hidden = true;
    if (cartProductsCard) cartProductsCard.hidden = false;
    if (customerDetailsCard) customerDetailsCard.hidden = false;

    var totalQty = cart.reduce(function (t, p) {
      return t + (Number(p.quantity) || 0);
    }, 0);

    if (cartItemCount) cartItemCount.textContent = String(totalQty);

    var fragment = document.createDocumentFragment();
    cart.forEach(function (product) {
      fragment.appendChild(buildItemNode(product));
    });

    clearChildren(cartItemsList);
    cartItemsList.appendChild(fragment);
  }

  /* ---------- EVENT DELEGATION ---------- */

  document.addEventListener("click", function (event) {
    var quantityBtn = event.target.closest(".quantity-btn");
    var removeBtn   = event.target.closest(".remove-cart-item");

    if (!quantityBtn && !removeBtn) return;

    var cart = getCart();

    if (removeBtn) {
      var removeId = String(removeBtn.dataset.id);
      cart = cart.filter(function (item) {
        return String(item.id) !== removeId;
      });
      saveCart(cart);
      renderCart();
      return;
    }

    var itemId = String(quantityBtn.dataset.id);
    var product = cart.find(function (item) {
      return String(item.id) === itemId;
    });
    if (!product) return;

    if (quantityBtn.dataset.action === "plus") {
      product.quantity = (Number(product.quantity) || 0) + 1;
    } else {
      product.quantity = (Number(product.quantity) || 0) - 1;
      if (product.quantity <= 0) {
        cart = cart.filter(function (item) {
          return String(item.id) !== itemId;
        });
      }
    }

    saveCart(cart);
    renderCart();
  });

  document.addEventListener("centralCartUpdated", function () {
    renderCart();
  });

  window.addEventListener("storage", function (event) {
    if (event.key && event.key !== getCartKey()) return;
    renderCart();
  });

  /* ---------- FORM VALIDATION ---------- */

  if (!orderForm) {
    renderCart();
    return;
  }

  function setFieldError(input, errorEl, message) {
    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.classList.toggle('show', !!message);
    }
    if (input) {
      var group = input.closest('.form-group');
      if (group) group.classList.toggle('has-error', !!message);
      if (message) input.setAttribute('aria-invalid', 'true');
      else         input.removeAttribute('aria-invalid');
    }
  }

  function clearAllFieldErrors() {
    setFieldError(nameInput, nameError, '');
    setFieldError(phoneInput, phoneError, '');
    setFieldError(addressInput, addressError, '');
  }

  [nameInput, phoneInput, addressInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', function () {
      var errorEl = null;
      if (el === nameInput) errorEl = nameError;
      if (el === phoneInput) errorEl = phoneError;
      if (el === addressInput) errorEl = addressError;
      setFieldError(el, errorEl, '');
    });
  });

  function validateForm() {
    var name    = nameInput    ? String(nameInput.value || '').trim()    : '';
    var phone   = phoneInput   ? String(phoneInput.value || '').trim()   : '';
    var address = addressInput ? String(addressInput.value || '').trim() : '';

    clearAllFieldErrors();

    var firstInvalid = null;

    if (!name) {
      setFieldError(nameInput, nameError, 'Please enter your name.');
      firstInvalid = firstInvalid || nameInput;
    } else if (name.length > 60) {
      setFieldError(nameInput, nameError, 'Name is too long.');
      firstInvalid = firstInvalid || nameInput;
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      setFieldError(phoneInput, phoneError, 'Please enter a valid 10-digit mobile number.');
      firstInvalid = firstInvalid || phoneInput;
    }

    if (!address) {
      setFieldError(addressInput, addressError, 'Please enter your delivery address.');
      firstInvalid = firstInvalid || addressInput;
    } else if (address.length > 300) {
      setFieldError(addressInput, addressError, 'Address is too long.');
      firstInvalid = firstInvalid || addressInput;
    }

    if (firstInvalid) {
      try { firstInvalid.focus({ preventScroll: false }); } catch (e) {}
      return null;
    }

    return { name: name, phone: phone, address: address };
  }

  /* ---------- WHATSAPP PATH (secondary) ---------- */

  function buildWhatsAppMessage(payload) {
    var cart = getCart();
    var storeName = (window.STORE_CONFIG && window.STORE_CONFIG.name) || 'Central & Stores';
    var note = noteInput ? String(noteInput.value || '').trim() : '';

    var lines = [];
    var totalQty = 0;
    var subtotal = 0;
    var hasPrices = false;

    cart.forEach(function (item) {
      var qty = Number(item.quantity) || 0;
      var price = Number(item.price) || 0;
      totalQty += qty;

      var line = '• ' + String(item.name || 'Product') + ' × ' + qty;
      if (item.weight) line += '  (' + String(item.weight) + ')';

      if (price > 0) {
        hasPrices = true;
        subtotal += price * qty;
        line += '  —  ' + formatINR(price * qty);
      }

      lines.push(line);
    });

    var msg = '';
    msg += '🛒 *' + storeName + '*\n';
    msg += '━━━━━━━━━━━━━━━━━━\n\n';
    msg += '👤 *Customer Details*\n';
    msg += 'Name    : ' + payload.name + '\n';
    msg += 'Phone   : ' + payload.phone + '\n';
    msg += 'Address : ' + payload.address + '\n';

    if (note) {
      msg += '\n📝 *Additional Note*\n' + note + '\n';
    }

    msg += '\n🛍️ *Order Items*\n';
    msg += '━━━━━━━━━━━━━━━━━━\n\n';
    msg += lines.join('\n') + '\n';

    msg += '\n━━━━━━━━━━━━━━━━━━\n';
    msg += '📦 Total Items : ' + totalQty + '\n';
    if (hasPrices && subtotal > 0) {
      msg += '💰 Estimated Total : ' + formatINR(subtotal) + '\n';
      msg += '(Final price confirmed on call)\n';
    }
    msg += '\n📞 Please confirm availability, final price and delivery time.\n\n';
    msg += 'Thank you ❤️\n' + storeName;

    return msg;
  }

  function cooldownRemainingMs() {
    var last = 0;
    try { last = Number(localStorage.getItem(COOLDOWN_KEY) || 0); } catch (e) {}
    if (!last) return 0;
    var remain = COOLDOWN_MS - (Date.now() - last);
    return remain > 0 ? remain : 0;
  }

  function setCooldown() {
    try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch (e) {}
  }

  function openWhatsApp(url) {
    var win = null;
    try { win = window.open(url, '_blank'); } catch (e) {}
    if (!win) {
      window.location.href = url;
    }
  }

  function submitViaWhatsApp() {
    if (isSubmitting) return;

    var cart = getCart();
    if (!cart.length) {
      showToast('Your cart is empty.', 'error');
      return;
    }

    var payload = validateForm();
    if (!payload) {
      showToast('Please complete the required fields.', 'error');
      return;
    }

    var wait = cooldownRemainingMs();
    if (wait > 0) {
      showToast('Please wait ' + Math.ceil(wait / 1000) + 's before sending again.', 'error');
      return;
    }

    var message = buildWhatsAppMessage(payload);

    var url;
    if (typeof window.storeWaLink === 'function') {
      url = window.storeWaLink(message);
    } else {
      url = 'https://wa.me/919344621645?text=' + encodeURIComponent(message);
    }

    isSubmitting = true;
    setButtonBusy(sendOrderBtn, true, 'Opening WhatsApp…');

    setCooldown();
    openWhatsApp(url);

    setTimeout(function () {
      isSubmitting = false;
      setButtonBusy(sendOrderBtn, false);
    }, 1500);
  }

  /* ---------- ORDER PATH (primary) ---------- */

  function orderCooldownRemainingMs() {
    var last = 0;
    try { last = Number(localStorage.getItem(ORDER_COOLDOWN_KEY) || 0); } catch (e) {}
    if (!last) return 0;
    var remain = ORDER_COOLDOWN_MS - (Date.now() - last);
    return remain > 0 ? remain : 0;
  }

  function setOrderCooldown() {
    try { localStorage.setItem(ORDER_COOLDOWN_KEY, String(Date.now())); } catch (e) {}
  }

  function generateOrderNumber() {
    /* Short, human-readable, unique enough for a single store.
       Format: CS-YYMMDD-XXXXX (XXXXX = 5 random digits). */
    var d = new Date();
    var yy = String(d.getFullYear()).slice(-2);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var rand = String(Math.floor(Math.random() * 90000) + 10000);
    return 'CS-' + yy + mm + dd + '-' + rand;
  }

  /**
   * Fetch fresh product rows for the cart items.
   * Returns { ok: true, items: [...] } or { ok: false, reason: "..." }.
   */
  async function loadFreshProducts(db, cart) {
    if (!db || !db.from) return { ok: false, reason: 'Database not available.' };

    var ids = cart
      .map(function (i) { return i.id; })
      .filter(function (id) { return id != null; });

    if (!ids.length) return { ok: false, reason: 'Cart is empty.' };

    var query = db
      .from('products')
      .select('id, name, category, weight, price, original_price, image_url, is_available, is_published')
      .in('id', ids);

    var res = await query;

    if (res.error) {
      return { ok: false, reason: 'Unable to verify products right now.' };
    }

    var rowsById = {};
    (res.data || []).forEach(function (row) {
      rowsById[String(row.id)] = row;
    });

    var verified = [];

    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      var row = rowsById[String(item.id)];

      if (!row) {
        return { ok: false, reason: 'A product in your cart is no longer available.' };
      }
      if (row.is_published === false) {
        return { ok: false, reason: '"' + (row.name || 'A product') + '" is no longer on the menu.' };
      }
      if (row.is_available === false) {
        return { ok: false, reason: '"' + (row.name || 'A product') + '" is out of stock. Please remove it and try again.' };
      }
      if (!(Number(row.price) > 0)) {
        return { ok: false, reason: '"' + (row.name || 'A product') + '" has no valid price. Please contact the store.' };
      }

      var qty = Number(item.quantity) || 0;
      if (qty <= 0 || qty > 999) {
        return { ok: false, reason: 'Invalid quantity for "' + (row.name || 'a product') + '".' };
      }

      var unitPrice = Number(row.price);
      verified.push({
        product_id: row.id,
        product_name: String(row.name || ''),
        product_weight: String(row.weight || ''),
        category: String(row.category || ''),
        unit_price: unitPrice,
        quantity: qty,
        line_total: unitPrice * qty
      });
    }

    return { ok: true, items: verified };
  }

  /**
   * Create the order in Supabase.
   * Tries an RPC (create_order) first for atomicity.
   * Falls back to sequential inserts if the RPC isn't deployed.
   */
  async function createOrder(db, payload, verifiedItems) {
    var subtotal = verifiedItems.reduce(function (sum, it) {
      return sum + it.line_total;
    }, 0);

    var orderNumber = generateOrderNumber();
    var note = noteInput ? String(noteInput.value || '').trim() : '';

    var orderRow = {
      order_number: orderNumber,
      customer_name: payload.name,
      customer_phone: payload.phone,
      customer_address: payload.address,
      customer_note: note || null,
      subtotal: subtotal,
      delivery_charge: 0,
      discount: 0,
      total: subtotal,
      status: STATUS_NEW,
      payment_status: 'UNPAID'
    };

    /* ---- Attempt RPC first (atomic) ---- */
    try {
      var rpc = await db.rpc('create_order', {
        p_order: orderRow,
        p_items: verifiedItems
      });

      if (!rpc.error && rpc.data) {
        /* RPC returns the created order (or its id). Handle both shapes. */
        var returned = rpc.data;
        var confirmedNumber =
          (returned && returned.order_number) ||
          (Array.isArray(returned) && returned[0] && returned[0].order_number) ||
          orderNumber;
        return { ok: true, order_number: confirmedNumber, subtotal: subtotal };
      }
      /* If the RPC is missing the function, fall through to direct insert.
         Otherwise, surface the real error. */
      var msg = (rpc.error && rpc.error.message) || '';
      var missing = msg.toLowerCase().indexOf('does not exist') !== -1 ||
                    msg.toLowerCase().indexOf('function') !== -1 &&
                    msg.toLowerCase().indexOf('not found') !== -1;
      if (!missing) {
        return { ok: false, reason: 'Unable to place order. Please try again.' };
      }
    } catch (rpcErr) {
      /* RPC missing or network issue — try direct insert. */
    }

    /* ---- Direct insert fallback ---- */
    var orderInsert = await db
      .from('orders')
      .insert([orderRow])
      .select('id, order_number')
      .single();

    if (orderInsert.error || !orderInsert.data) {
      return { ok: false, reason: 'Unable to place order right now. Please try again.' };
    }

    var orderId = orderInsert.data.id;
    var confirmedNumber = orderInsert.data.order_number || orderNumber;

    var itemsToInsert = verifiedItems.map(function (it) {
      return {
        order_id: orderId,
        product_id: it.product_id,
        product_name: it.product_name,
        product_weight: it.product_weight,
        unit_price: it.unit_price,
        quantity: it.quantity,
        line_total: it.line_total
      };
    });

    var itemsInsert = await db.from('order_items').insert(itemsToInsert);

    if (itemsInsert.error) {
      /* Best-effort cleanup: remove the orphan order so the admin
         doesn't see a half-created row. Non-fatal if it fails. */
      try { await db.from('orders').delete().eq('id', orderId); } catch (e) {}
      return { ok: false, reason: 'Unable to place order right now. Please try again.' };
    }

    return { ok: true, order_number: confirmedNumber, subtotal: subtotal };
  }

  function setButtonBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('loading');
      var spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      btn.textContent = '';
      btn.appendChild(spinner);
      if (label) {
        var span = document.createElement('span');
        span.textContent = ' ' + label;
        btn.appendChild(span);
      }
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('loading');
      if (btn.dataset.origLabel) {
        btn.textContent = btn.dataset.origLabel;
        delete btn.dataset.origLabel;
      }
    }
  }

  function showOrderConfirmation(orderNumber, subtotal) {
    /* Populate the confirmation panel if it exists. */
    if (orderConfirmation) {
      var numEl = orderConfirmation.querySelector('[data-order-number]');
      if (numEl) numEl.textContent = orderNumber || '—';

      var totalEl = orderConfirmation.querySelector('[data-order-total]');
      if (totalEl) totalEl.textContent = subtotal ? formatINR(subtotal) : '—';

      orderConfirmation.hidden = false;
      if (cartProductsCard) cartProductsCard.hidden = true;
      if (customerDetailsCard) customerDetailsCard.hidden = true;
      if (emptyCart) emptyCart.hidden = true;
      try {
        orderConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {}
      return;
    }

    /* Fallback: persist the confirmation and redirect to a dedicated page. */
    try {
      sessionStorage.setItem('cs_last_order', JSON.stringify({
        order_number: orderNumber || null,
        subtotal: subtotal || 0,
        at: Date.now()
      }));
    } catch (e) {}
    window.location.href = 'order-success.html';
  }

  async function submitViaOrder() {
    if (isSubmitting) return;

    var cart = getCart();
    if (!cart.length) {
      showToast('Your cart is empty.', 'error');
      return;
    }

    var payload = validateForm();
    if (!payload) {
      showToast('Please complete the required fields.', 'error');
      return;
    }

    var wait = orderCooldownRemainingMs();
    if (wait > 0) {
      showToast('Please wait ' + Math.ceil(wait / 1000) + 's before placing another order.', 'error');
      return;
    }

    isSubmitting = true;
    setButtonBusy(placeOrderBtn, true, 'Placing order…');
    if (sendOrderBtn) sendOrderBtn.disabled = true;

    try {
      /* Ensure the shared Supabase client is available. */
      var db = getDb();
      if (!db) db = await waitForDb();

      if (!db || !db.from) {
        throw new Error('We are unable to reach our store system right now. Please try the WhatsApp enquiry instead.');
      }

      /* Verify products and prices against the database. */
      var verified = await loadFreshProducts(db, cart);
      if (!verified.ok) {
        throw new Error(verified.reason || 'Unable to verify your cart.');
      }

      /* Create the order. */
      var result = await createOrder(db, payload, verified.items);
      if (!result.ok) {
        throw new Error(result.reason || 'Unable to place order.');
      }

      /* Success: clear cart, show confirmation, cooldown. */
      setOrderCooldown();
      clearCart();
      showOrderConfirmation(result.order_number, result.subtotal);
      showToast('Order placed successfully.', 'success');
    } catch (err) {
      showToast(
        (err && err.message) || 'Something went wrong. Please try again.',
        'error'
      );
    } finally {
      isSubmitting = false;
      setButtonBusy(placeOrderBtn, false);
      if (sendOrderBtn) sendOrderBtn.disabled = false;
    }
  }

  /* ---------- WIRING ---------- */

  orderForm.addEventListener('submit', function (e) {
    e.preventDefault();
    submitViaOrder();
  });

  if (placeOrderBtn) {
    placeOrderBtn.addEventListener('click', function (e) {
      e.preventDefault();
      submitViaOrder();
    });
  }

  if (sendOrderBtn) {
    sendOrderBtn.addEventListener('click', function (e) {
      e.preventDefault();
      submitViaWhatsApp();
    });
  }

  /* If WhatsApp button is not present, ensure primary flow still works
     via the form submit. */
  if (!placeOrderBtn && !sendOrderBtn) {
    /* Legacy fallback: submit goes through WhatsApp (original behaviour). */
    orderForm.addEventListener('submit', function (e) {
      e.preventDefault();
      submitViaWhatsApp();
    });
  }

  /* ---------- INIT ---------- */
  renderCart();
});