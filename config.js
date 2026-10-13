/* ============================================================
   CENTRAL & STORES — Store Configuration
   ------------------------------------------------------------
   Single source of truth for business identity and contact
   facts. No product data, no prices, no Supabase keys.

   CONTRACT
     window.STORE_CONFIG       → frozen config object
     window.storeTelLink()     → "tel:+919344621645"
     window.storeWaLink(msg)   → "https://wa.me/919344621645?text=..."

   Every public page must read phone / WhatsApp / address /
   hours from here. Nothing is hard-coded in HTML.

   SEO NOTES
     siteUrl and logoUrl are non-www because the canonical
     host is https://central-and-stores.ct.ws (no www).
     The server 301-redirects www.* → non-www.
   ============================================================ */

(function () {
  'use strict';

  const STORE_CONFIG = {
    /* ----------------------------------------------------
       Identity
    ---------------------------------------------------- */
    name:        'Central & Stores',
    shortName:   'Central & Stores',
    tagline:     'Premium Grocery Store',
    category:    'Grocery & Department Store',
    description:
      'Trusted grocery and department store in Mangalam, Tiruppur. ' +
      'Quality products, honest prices and reliable service — every day.',

    /* ----------------------------------------------------
       Contact — one source for the whole site
       e164 is the format used by tel: and wa.me links.
       display is the human-readable version.
    ---------------------------------------------------- */
    phone: {
      e164:    '+919344621645',
      display: '+91 93446 21645'
    },
    whatsapp: {
      e164:    '+919344621645',
      display: '+91 93446 21645'
    },

    /* ----------------------------------------------------
       Address
    ---------------------------------------------------- */
    address: {
      street:      '1/90 C Tirupur Main Road',
      locality:    'Mangalam',
      region:      'Tamil Nadu',
      postalCode:  '641663',
      country:     'IN',
      countryName: 'India',
      plusCode:    '473C+3W6'
    },

    /* ----------------------------------------------------
       Map — canonical Google Business Profile link.
       Used in schema sameAs, GBP deep-links, and CTA buttons.
    ---------------------------------------------------- */
    mapsUrl: 'https://maps.app.goo.gl/sSM66eeLdxad84Sq5',

    /* ----------------------------------------------------
       Hours
    ---------------------------------------------------- */
    openingHours: {
      schema:   'Mo-Th,Sa-Su 08:00-22:00',
      display:  'Mon–Thu, Sat–Sun · 8:00 AM – 10:00 PM',
      timezone: 'Asia/Kolkata'
    },

    /* ----------------------------------------------------
       Locale / currency
    ---------------------------------------------------- */
    locale:         'en-IN',
    currency:       'INR',
    currencySymbol: '₹',

    /* ----------------------------------------------------
       Canonical / SEO — non-www
    ---------------------------------------------------- */
    siteUrl: 'https://central-and-stores.ct.ws',
    logoUrl: 'https://central-and-stores.ct.ws/logo.png'
  };

  /* Freeze top-level to prevent accidental mutation at runtime. */
  Object.freeze(STORE_CONFIG);
  Object.freeze(STORE_CONFIG.phone);
  Object.freeze(STORE_CONFIG.whatsapp);
  Object.freeze(STORE_CONFIG.address);
  Object.freeze(STORE_CONFIG.openingHours);

  window.STORE_CONFIG = STORE_CONFIG;

  /* ----------------------------------------------------
     Link builders — every page uses these, never string
     concatenation. Guarantees consistent URL encoding.
  ---------------------------------------------------- */

  window.storeTelLink = function () {
    return 'tel:' + STORE_CONFIG.phone.e164;
  };

  window.storeWaLink = function (message) {
    const base = 'https://wa.me/' + STORE_CONFIG.whatsapp.e164.replace(/^\+/, '');
    if (!message) return base;
    return base + '?text=' + encodeURIComponent(message);
  };

  window.storeMapsLink = function () {
    return STORE_CONFIG.mapsUrl || '';
  };

  /* ----------------------------------------------------
     Auto-hydrate links that opt in via data attributes.

       <a data-tel-link>Call Store</a>
       <a data-wa-link>WhatsApp Store</a>
       <a data-wa-link data-wa-message="Hello...">Contact</a>
       <a data-maps-link>Directions</a>
  ---------------------------------------------------- */

  function hydrateLinks() {
    document.querySelectorAll('a[data-tel-link]').forEach(function (el) {
      const href = el.getAttribute('href');
      if (!href || href === '#' || href.indexOf('tel:') !== 0) {
        el.setAttribute('href', window.storeTelLink());
      }
    });

    document.querySelectorAll('a[data-wa-link]').forEach(function (el) {
      const href = el.getAttribute('href');
      const isPlaceholder = !href || href === '#' || href.indexOf('wa.me') === -1;

      if (isPlaceholder) {
        const msg = el.getAttribute('data-wa-message') || undefined;
        el.setAttribute('href', window.storeWaLink(msg));
      }

      if (!el.hasAttribute('target')) {
        el.setAttribute('target', '_blank');
      }
      const rel = (el.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
      if (rel.indexOf('noopener') === -1) rel.push('noopener');
      el.setAttribute('rel', rel.join(' '));
    });

    document.querySelectorAll('a[data-maps-link]').forEach(function (el) {
      const href = el.getAttribute('href');
      if (!href || href === '#' || href.indexOf('maps.app.goo.gl') === -1 && href.indexOf('google.com/maps') === -1) {
        const url = window.storeMapsLink();
        if (url) {
          el.setAttribute('href', url);
          el.setAttribute('target', '_blank');
          const rel = (el.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
          if (rel.indexOf('noopener') === -1) rel.push('noopener');
          el.setAttribute('rel', rel.join(' '));
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateLinks, { once: true });
  } else {
    hydrateLinks();
  }
})();
