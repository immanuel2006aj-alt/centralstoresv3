/* ============================================================
   CENTRAL & STORES — MULTI-SIZE IMAGE PROCESSOR
   ------------------------------------------------------------
   When an image is uploaded:
     1. Generate 3 variants: 400px, 800px, 1200px (max side)
     2. Each variant compressed as WebP (2–8 KB each)
     3. Upload all 3 to Supabase Storage with suffix:
          products/1234-abc.webp         (1200px, primary)
          products/1234-abc-400.webp     (400px)
          products/1234-abc-800.webp     (800px)
     4. Return { primary, src400, src800, src1200 }
        so pages can build a srcset.

   PUBLIC API (window.MultiSizeUploader):
     uploadAll(file, bucket, folder)  → Promise<{ url, srcset, sizes }>
     buildSrcset(urls)                → string (for HTML)

   USED BY: admin-products.js, admin-ads.js

   FALLBACK: if this file isn't loaded, the storefront will
   fall back to the single image_url column (backward compat).
   ============================================================ */

(function () {
  'use strict';

  const SIZES = [
    { key: 'src400', max: 400, targetBytes: 2048, quality: 0.75 },
    { key: 'src800', max: 800, targetBytes: 4096, quality: 0.78 },
    { key: 'src1200', max: 1200, targetBytes: 8192, quality: 0.80 }
  ];

  /* ============================================================
     UTILITIES
     ============================================================ */
  function generateBaseName() {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return ts + '-' + rand;
  }

  async function getBlobSize(blob) {
    return blob ? blob.size : 0;
  }

  /* ============================================================
     UPLOAD ONE VARIANT
     ============================================================ */
  async function uploadVariant(blob, bucket, path) {
    if (!window.db) throw new Error('Supabase not available');

    const { error } = await window.db.storage
      .from(bucket)
      .upload(path, blob, {
        cacheControl: '31536000', // 1 year — variants never change
        contentType: 'image/webp',
        upsert: false
      });

    if (error) throw error;

    const { data } = window.db.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /* ============================================================
     MAIN UPLOADER
     ------------------------------------------------------------
     @param {File|Blob} file  The user's original image
     @param {string} bucket   Storage bucket ('product-images', etc.)
     @param {string} folder   Subfolder ('products', 'ads', 'categories')
     @returns {Promise<{ url, srcset, sizes, all }>}
       - url: primary (largest) variant URL → stored in image_url
       - srcset: value for the HTML srcset attribute
       - sizes: value for the HTML sizes attribute
       - all: { src400, src800, src1200 } URLs
     ============================================================ */
  async function uploadAll(file, bucket, folder) {
    if (!file) throw new Error('No file provided');
    if (!window.ImageCompressor) {
      throw new Error('ImageCompressor not loaded — include admin-image-compressor.js first');
    }

    const base = generateBaseName();
    const cleanFolder = (folder || '').replace(/\/+$/, '');
    const prefix = cleanFolder ? cleanFolder + '/' : '';

    const variants = {};

    // Sequential uploads (Supabase free tier handles concurrent OK, but sequential is safer)
    for (const s of SIZES) {
      // Compress to target size
      const blob = await window.ImageCompressor.compressToTarget(
        file,
        s.targetBytes,
        {
          maxSize: s.max,
          quality: s.quality,
          minQuality: 0.4,
          background: null
        }
      );

      if (!blob || !blob.size) {
        console.warn('[multisize] compression failed for', s.max);
        continue;
      }

      // Naming: base.webp for 1200px, base-400.webp for 400px, etc.
      const suffix = s.key === 'src1200' ? '' : '-' + s.max;
      const path = prefix + base + suffix + '.webp';

      try {
        const url = await uploadVariant(blob, bucket, path);
        variants[s.key] = url;
      } catch (err) {
        console.warn('[multisize] upload failed for', s.max, err);
      }
    }

    // Determine primary (largest)
    const primary = variants.src1200 || variants.src800 || variants.src400;
    if (!primary) throw new Error('All variant uploads failed');

    // Build srcset
    const srcset = buildSrcset(variants);

    // Image URL naming: primary URL stored in image_url
    const sizes = '(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px';

    return {
      url: primary,
      srcset: srcset,
      sizes: sizes,
      all: variants
    };
  }

  /* ============================================================
     BUILD SRCSET ATTRIBUTE
     ============================================================ */
  function buildSrcset(variants) {
    const parts = [];
    if (variants.src400) parts.push(variants.src400 + ' 400w');
    if (variants.src800) parts.push(variants.src800 + ' 800w');
    if (variants.src1200) parts.push(variants.src1200 + ' 1200w');
    return parts.join(', ');
  }

  /* ============================================================
     PARSE VARIANTS FROM A PRIMARY URL
     ------------------------------------------------------------
     If you have a products/abc.webp URL, derive:
       products/abc-400.webp
       products/abc-800.webp
     Useful when reading from DB after upload.
     ============================================================ */
  function deriveVariantsFromUrl(primaryUrl) {
    if (!primaryUrl || typeof primaryUrl !== 'string') {
      return { src400: '', src800: '', src1200: '' };
    }

    const base = primaryUrl.replace(/\.webp$/i, '');
    return {
      src400: base + '-400.webp',
      src800: base + '-800.webp',
      src1200: primaryUrl
    };
  }

  /* ============================================================
     SRCSET BUILDER FOR PUBLIC SITE
     ------------------------------------------------------------
     Call this from products-grid.js / ads.js:
       <img src="${image_url}"
            srcset="${MultiSizeUploader.buildSrcsetFor(image_url)}"
            sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px"
            loading="lazy">
     ============================================================ */
  function buildSrcsetFor(primaryUrl) {
    const v = deriveVariantsFromUrl(primaryUrl);
    const parts = [];
    if (v.src400) parts.push(v.src400 + ' 400w');
    if (v.src800) parts.push(v.src800 + ' 800w');
    if (v.src1200) parts.push(v.src1200 + ' 1200w');
    return parts.join(', ');
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.MultiSizeUploader = {
    uploadAll: uploadAll,
    buildSrcset: buildSrcset,
    buildSrcsetFor: buildSrcsetFor,
    deriveVariantsFromUrl: deriveVariantsFromUrl,
    SIZES: SIZES
  };
})();