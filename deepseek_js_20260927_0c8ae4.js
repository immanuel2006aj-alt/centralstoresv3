/* ============================================================
   CENTRAL & STORES — Add-to-cart sound feedback
   ------------------------------------------------------------
   RESPONSIBILITY
     • Play a short confirmation sound when the customer adds
       an item to the cart (.add-cart-btn).

   WHY EVENT DELEGATION
     Product grids render AFTER the page loads (when Supabase
     resolves). A DOMContentLoaded-time querySelectorAll finds
     nothing. We listen on the document instead, so dynamically
     rendered buttons work automatically.

   PREFERENCES RESPECTED
     • prefers-reduced-motion: reduce → no sound
     • localStorage['cs_sound_muted'] === '1' → no sound
     • document.hidden === true → no sound (backgrounded tab)

   PUBLIC API
     window.playAddCartSound()    — play now (respects prefs)
     window.toggleStoreSound()    — flip mute; returns sound-on boolean
     window.isStoreSoundMuted()   — boolean
   ============================================================ */

(function () {
  'use strict';

  var SOUND_FILE    = 'add-cart.mp3';
  var VOLUME        = 0.6;
  var COOLDOWN_MS   = 150;
  var MUTE_KEY      = 'cs_sound_muted';
  var UNLOCK_FLAG   = 'cs_audio_unlocked';

  var audio         = null;
  var lastPlayedAt  = 0;

  /* ---------- PREFERENCES ---------- */

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function isMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setMuted(value) {
    try {
      if (value) localStorage.setItem(MUTE_KEY, '1');
      else       localStorage.removeItem(MUTE_KEY);
    } catch (e) { /* ignore — storage may be blocked */ }
  }

  /* ---------- AUDIO ---------- */

  function ensureAudio() {
    if (audio) return audio;
    try {
      audio = new Audio(SOUND_FILE);
      audio.volume = VOLUME;
      audio.preload = 'none';
      /* Avoid hot-linking console noise if the file is missing. */
      audio.addEventListener('error', function () {
        /* Non-fatal: the sound is a nicety. */
        audio = null;
      }, { once: true });
    } catch (e) {
      audio = null;
    }
    return audio;
  }

  /* iOS Safari requires the first play() to happen inside a
     user gesture. This silent unlock runs on the first tap
     anywhere on the page so the add-to-cart click that follows
     is allowed to play audio without a second gesture. */
  function unlockOnce() {
    if (sessionStorage.getItem(UNLOCK_FLAG) === '1') return;
    try {
      var a = ensureAudio();
      if (!a) return;
      var prevVol = a.volume;
      a.volume = 0;
      var p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          a.pause();
          a.currentTime = 0;
          a.volume = prevVol;
          try { sessionStorage.setItem(UNLOCK_FLAG, '1'); } catch (e) {}
        }).catch(function () {
          a.volume = prevVol;
        });
      } else {
        a.volume = prevVol;
      }
    } catch (e) { /* ignore */ }
  }

  function playNow() {
    if (prefersReducedMotion()) return;
    if (isMuted()) return;
    if (typeof document.hidden === 'boolean' && document.hidden) return;

    var now = Date.now();
    if (now - lastPlayedAt < COOLDOWN_MS) return;
    lastPlayedAt = now;

    var a = ensureAudio();
    if (!a) return;

    try {
      a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* silent — sound is a nicety, not a requirement */ }
  }

  /* ---------- EVENT DELEGATION ---------- */

  /* Fire even if another handler stops propagation. */
  document.addEventListener('click', function (event) {
    var button = event.target.closest('.add-cart-btn');
    if (!button) return;
    playNow();
  }, true);

  /* Silent warm-up — only on the first user interaction of the
     session. Doesn't produce sound. */
  document.addEventListener('pointerdown', unlockOnce, { once: true, capture: true });

  /* ---------- PUBLIC API ---------- */

  window.playAddCartSound = playNow;

  /**
   * Flip the mute state.
   * @returns {boolean} true when sound is now ON, false when muted.
   */
  window.toggleStoreSound = function () {
    var nextMuted = !isMuted();
    setMuted(nextMuted);
    return !nextMuted;
  };

  window.isStoreSoundMuted = function () {
    return isMuted();
  };

})();