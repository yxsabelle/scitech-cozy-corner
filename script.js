/* ==========================================================================
   SCITECH COZY CORNER — Photobooth
   PCU-M Society of Computing Technologists

   Plain vanilla JavaScript. No frameworks, no build step.

   Contents
   1.  Settings you may want to edit
   2.  Filters (one definition drives BOTH the live preview and the saved photo)
   3.  Strip colors + layout
   4.  State + small helpers
   5.  Screen navigation
   6.  Welcome, logos, payment
   7.  Delivery + email
   8.  Format
   9.  Camera
   10. Capture (countdown, flash, photos)
   11. Review + retake
   12. Photostrip drawing
   13. Strip color screen
   14. Final screen: download / print / send soft copy
   15. Start over + init
   ========================================================================== */
(function () {
  'use strict';

  /* ========================================================================
     1. SETTINGS
     ====================================================================== */
  const CONFIG = {
    boothName: 'SCITECH COZY CORNER',

    // The header is split into two balanced lines. Edit here if needed.
    orgNameLines: ['PCU-M SOCIETY OF', 'COMPUTING TECHNOLOGISTS'],

    countdownSeconds: 3,        // 3 → 2 → 1
    pauseBetweenShotsMs: 900,   // short breather after each photo

    downloadFileName: 'scitech-cozy-corner-photostrip.jpg',
    jpegQuality: 0.95,

    /* --- SOFT COPY (EMAIL) -------------------------------------------------
       A browser-only page cannot send email by itself, and secret API keys must
       never be placed in front-end code. To enable "Send Soft Copy", run a small
       backend (or a serverless function) that holds the email-service key, and
       put its public URL here. The page will POST multipart/form-data with:
           email       – the customer's address
           delivery    – "soft" or "both"
           photostrip  – the JPEG file
       The endpoint should reply with a 2xx status when the email was queued.
       Leave empty until that backend exists. */
    emailEndpoint: ''
  };

  const MESSAGES = {
    prompt:      'Allow camera access to start your photobooth session.',
    denied:      'Camera access is required to take your photos. Please allow camera access in your browser settings.',
    unavailable: "We couldn't access the camera. Please check your camera permissions and try again.",
    unsupported: "This browser can't run the photobooth camera. Please open this page in a modern browser such as Safari or Chrome.",
    insecure:    'The camera only works when this page is opened over HTTPS (or on localhost).',
    email:       'Please enter a valid email address.'
  };

  const DELIVERY_LABEL = { soft: 'Soft Copy', hard: 'Hard Copy', both: 'Soft + Hard Copy' };

  const FONT = '"Fredoka", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';


  /* ========================================================================
     2. FILTERS
     Each filter is a short list of standard operations plus an optional tint.
     • The live preview uses them as a CSS filter + a tint overlay.
     • The captured photo runs the SAME maths on the pixels (canvas.filter is
       not supported by every iPad Safari, so we don't rely on it).
     ====================================================================== */
  const FILTERS = {
    original: { label: 'Original',      ops: [], tint: null, dot: '#FFFFFF' },
    warm:     { label: 'Warm',          ops: [['sepia', 0.2], ['saturate', 1.15], ['brightness', 1.03]], tint: [255, 160, 80, 0.10], dot: '#FFB067' },
    cool:     { label: 'Cool',          ops: [['saturate', 1.05], ['contrast', 1.02], ['brightness', 1.03]], tint: [80, 140, 255, 0.13], dot: '#8DB2FF' },
    soft:     { label: 'Soft',          ops: [['brightness', 1.08], ['contrast', 0.86], ['saturate', 0.92]], tint: [255, 235, 235, 0.08], dot: '#F6DEDA' },
    vintage:  { label: 'Vintage',       ops: [['sepia', 0.4], ['contrast', 0.9], ['saturate', 0.9], ['brightness', 1.05]], tint: [255, 215, 150, 0.08], dot: '#CDA56B' },
    bw:       { label: 'Black & White', ops: [['grayscale', 1], ['contrast', 1.1]], tint: null, dot: 'linear-gradient(90deg, #000 50%, #fff 50%)' }
  };

  function filterToCss(f) {
    if (!f.ops.length) return 'none';
    return f.ops.map(function (op) { return op[0] + '(' + op[1] + ')'; }).join(' ');
  }

  const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function mul3(a, b) {
    const r = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
      }
    }
    return r;
  }

  function mulVec(a, v) {
    return [
      a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
      a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
      a[6] * v[0] + a[7] * v[1] + a[8] * v[2]
    ];
  }

  // Same definitions as the CSS filter functions (sRGB, 0..1 values)
  function opTransform(name, v) {
    switch (name) {
      case 'brightness':
        return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [0, 0, 0] };
      case 'contrast': {
        const off = 0.5 * (1 - v);
        return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [off, off, off] };
      }
      case 'saturate':
        return { m: [
          0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
          0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
          0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v
        ], o: [0, 0, 0] };
      case 'grayscale': {
        const a = 1 - v;
        return { m: [
          0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
          0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
          0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a
        ], o: [0, 0, 0] };
      }
      case 'sepia': {
        const a = 1 - v;
        return { m: [
          0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
          0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
          0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a
        ], o: [0, 0, 0] };
      }
      default:
        return { m: IDENT, o: [0, 0, 0] };
    }
  }

  // Fold all operations (and the tint) into one matrix + offset
  function filterTransform(f) {
    let M = IDENT.slice();
    let O = [0, 0, 0];
    f.ops.forEach(function (op) {
      const t = opTransform(op[0], op[1]);
      const moved = mulVec(t.m, O);
      O = [moved[0] + t.o[0], moved[1] + t.o[1], moved[2] + t.o[2]];
      M = mul3(t.m, M);
    });
    if (f.tint) {
      const a = f.tint[3];
      const k = 1 - a;
      O = [O[0] * k + (f.tint[0] / 255) * a, O[1] * k + (f.tint[1] / 255) * a, O[2] * k + (f.tint[2] / 255) * a];
      M = M.map(function (x) { return x * k; });
    }
    return { M: M, O: O };
  }

  function applyFilterToCanvas(canvas, key) {
    const f = FILTERS[key];
    if (!f || (!f.ops.length && !f.tint)) return;
    const t = filterTransform(f);
    const M = t.M, o0 = t.O[0] * 255, o1 = t.O[1] * 255, o2 = t.O[2] * 255;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i]     = M[0] * r + M[1] * g + M[2] * b + o0;   // Uint8ClampedArray clamps for us
      d[i + 1] = M[3] * r + M[4] * g + M[5] * b + o1;
      d[i + 2] = M[6] * r + M[7] * g + M[8] * b + o2;
    }
    ctx.putImageData(img, 0, 0);
  }


  /* ========================================================================
     3. STRIP COLORS + LAYOUT
     ====================================================================== */
  const STRIP_COLORS = {
    white:  { label: 'White',       bg: '#FFFFFF', ink: '#000000', orange: '#FF7A1A', blue: '#2F6BFF' },
    cream:  { label: 'Cream',       bg: '#FBF0D9', ink: '#000000', orange: '#FF7A1A', blue: '#2F6BFF' },
    orange: { label: 'Soft Orange', bg: '#FFD6B0', ink: '#000000', orange: '#F2600C', blue: '#2F6BFF' },
    blue:   { label: 'Light Blue',  bg: '#CFE2FF', ink: '#000000', orange: '#FF7A1A', blue: '#1F4FD8' },
    black:  { label: 'Black',       bg: '#000000', ink: '#FFFFFF', orange: '#FF7A1A', blue: '#5C8DFF' }
  };

  // Measurements are in "design units" (800 wide). The canvas is drawn at
  // `scale` × that size for a sharper download / print.
  const STRIP = {
    w: 800, pad: 56,
    photoW: 688, photoH: 516,      // 4:3 photos
    gap: 28, top: 60, bottom: 60, sectionGap: 44,
    radius: 20, scale: 1.5
  };

  const CAPTURE = { w: 1280, h: 960 };   // raw photo size (4:3)


  /* ========================================================================
     4. STATE + HELPERS
     ====================================================================== */
  function freshState() {
    return {
      payment: null,          // 'cash' | 'qr'
      paymentDone: false,
      delivery: null,         // 'soft' | 'hard' | 'both'
      email: '',
      format: null,           // 3 | 4
      filter: 'original',
      photos: [],             // raw (mirrored, unfiltered) canvases
      captureMode: { type: 'all' },   // or { type: 'single', index }
      selectedPhoto: null,
      stripColor: 'white',
      returnTo: null,         // where "Continue" goes after "Change"
      finalCanvas: null,
      finalUrl: ''
    };
  }

  let state = freshState();
  let deliveryDraft = null;
  const photoCache = new Map();

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const range = function (n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; };

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;            // restart the CSS animation
    el.classList.add(cls);
  }

  function isValidEmail(v) {
    return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  function hasCameraSupport() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function ensureFonts() {
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([
          Promise.all([document.fonts.load('600 40px "Fredoka"'), document.fonts.load('700 40px "Fredoka"')]),
          sleep(1500)
        ]);
      }
    } catch (e) { /* fall back to system font */ }
  }


  /* ========================================================================
     5. SCREEN NAVIGATION
     ====================================================================== */
  const screens = {};
  $$('.screen').forEach(function (el) { screens[el.dataset.screen] = el; });

  const STEP_OF = {
    welcome: 0, payment: 1, 'payment-confirm': 1, delivery: 2, format: 3,
    camera: 4, review: 4, color: 5, final: 5
  };

  let currentScreen = 'welcome';

  const enterHooks = {
    'payment-confirm': enterPaymentConfirm,
    delivery: enterDelivery,
    format: enterFormat,
    camera: enterCamera,
    review: enterReview,
    color: enterColor,
    final: enterFinal
  };

  function showScreen(name) {
    const prev = currentScreen;
    if (prev === 'camera' && name !== 'camera') leaveCamera();

    currentScreen = name;
    document.body.dataset.screen = name;
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('active', k === name); });

    const idx = STEP_OF[name] || 0;
    $$('.step').forEach(function (li, i) {
      li.classList.toggle('done', i + 1 < idx);
      li.classList.toggle('current', i + 1 === idx);
      if (i + 1 === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });

    renderSummaries();
    window.scrollTo(0, 0);
    if (enterHooks[name]) enterHooks[name]();

    const heading = $('h1, h2', screens[name]);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  // Delegated clicks for simple navigation buttons
  document.addEventListener('click', function (e) {
    const go = e.target.closest('[data-goto]');
    if (go) { showScreen(go.dataset.goto); return; }

    const change = e.target.closest('[data-action="change-delivery"]');
    if (change) {
      state.returnTo = currentScreen;
      showScreen('delivery');
    }
  });


  /* ========================================================================
     6. WELCOME, LOGOS, PAYMENT
     ====================================================================== */

  // Logos + QR: show the image when the file exists, otherwise the dashed label.
  $$('[data-logo]').forEach(function (slot) {
    const img = $('img', slot);
    const ok = function () { slot.classList.add('is-loaded'); };
    const bad = function () { slot.classList.remove('is-loaded'); };
    img.addEventListener('load', ok);
    img.addEventListener('error', bad);
    if (img.complete && img.naturalWidth > 0) ok();
  });

  $('#btn-start').addEventListener('click', function () { showScreen('payment'); });

  function syncPaymentUI() {
    $$('[data-payment]').forEach(function (b) {
      b.classList.toggle('is-selected', b.dataset.payment === state.payment);
    });
  }

  $$('[data-payment]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (state.payment !== btn.dataset.payment) state.paymentDone = false;
      state.payment = btn.dataset.payment;
      if (state.payment === 'cash') state.paymentDone = true;
      syncPaymentUI();
      setTimeout(function () { showScreen('payment-confirm'); }, 220);
    });
  });

  function enterPaymentConfirm() {
    const isQR = state.payment === 'qr';
    $('#payment-cash').hidden = isQR;
    $('#payment-qr').hidden = !isQR;
    syncPaymentComplete();
  }

  function syncPaymentComplete() {
    const btn = $('#btn-payment-complete');
    btn.setAttribute('aria-pressed', String(state.paymentDone));
    btn.classList.toggle('is-done', state.paymentDone);
    $('#btn-payment-continue').disabled = state.payment === 'qr' && !state.paymentDone;
  }

  $('#btn-payment-complete').addEventListener('click', function () {
    state.paymentDone = !state.paymentDone;
    syncPaymentComplete();
  });

  $('#btn-payment-continue').addEventListener('click', function () {
    if (state.payment === 'qr' && !state.paymentDone) return;
    showScreen('delivery');
  });


  /* ========================================================================
     7. DELIVERY + EMAIL
     ====================================================================== */
  const emailInput = $('#email-input');
  const emailError = $('#email-error');

  function selectDelivery(kind) {
    deliveryDraft = kind;
    $$('[data-delivery]').forEach(function (b) {
      const on = b.dataset.delivery === kind;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
    });

    const needsEmail = kind !== 'hard';
    $('#delivery-panel').hidden = false;
    $('#email-field').hidden = !needsEmail;
    $('#hard-note').hidden = needsEmail;
    $('#btn-delivery-continue').disabled = false;
    hideEmailError();
  }

  function hideEmailError() {
    emailError.hidden = true;
    emailInput.removeAttribute('aria-invalid');
  }

  function enterDelivery() {
    deliveryDraft = null;
    $$('[data-delivery]').forEach(function (b) { b.classList.remove('is-selected'); b.setAttribute('aria-checked', 'false'); });
    $('#delivery-panel').hidden = true;
    $('#btn-delivery-continue').disabled = true;
    emailInput.value = state.email || '';
    hideEmailError();
    if (state.delivery) selectDelivery(state.delivery);   // coming back via "Change"
  }

  $$('[data-delivery]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectDelivery(btn.dataset.delivery); });
  });

  emailInput.addEventListener('input', hideEmailError);
  emailInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); continueFromDelivery(); }
  });

  function continueFromDelivery() {
    if (!deliveryDraft) return;

    if (deliveryDraft !== 'hard') {
      const value = emailInput.value.trim();
      if (!isValidEmail(value)) {
        emailError.textContent = MESSAGES.email;
        emailError.hidden = false;
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.focus();
        return;
      }
      state.email = value;
    } else {
      state.email = '';
    }

    state.delivery = deliveryDraft;
    const next = state.returnTo || 'format';
    state.returnTo = null;
    showScreen(next);
  }

  $('#btn-delivery-continue').addEventListener('click', continueFromDelivery);

  $('#btn-delivery-back').addEventListener('click', function () {
    const back = state.returnTo || 'payment-confirm';
    state.returnTo = null;
    showScreen(back);
  });

  // "Delivery: … / Email: …" blocks (format screen, color screen, final screen)
  function summaryLine(label, value) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = label + ':';
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' ' + value));   // textNode → safe for any email text
    return p;
  }

  function renderSummaries() {
    $$('[data-summary]').forEach(function (box) {
      const text = $('[data-summary-text]', box);
      if (!state.delivery) { if (!box.classList.contains('summary-static')) box.hidden = true; return; }
      box.hidden = false;
      text.textContent = '';
      text.appendChild(summaryLine('Delivery', DELIVERY_LABEL[state.delivery]));
      if (state.delivery !== 'hard' && state.email) text.appendChild(summaryLine('Email', state.email));
    });
  }


  /* ========================================================================
     8. FORMAT
     ====================================================================== */
  function syncFormatUI() {
    $$('[data-format]').forEach(function (b) {
      const on = Number(b.dataset.format) === state.format;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  function enterFormat() { syncFormatUI(); }

  $$('[data-format]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.format = Number(btn.dataset.format);
      state.photos = new Array(state.format).fill(null);
      state.selectedPhoto = null;
      state.captureMode = { type: 'all' };
      photoCache.clear();
      syncFormatUI();
      setTimeout(function () { showScreen('camera'); }, 260);
    });
  });


  /* ========================================================================
     9. CAMERA
     ====================================================================== */
  const video = $('#camera-video');
  const tintEl = $('#camera-tint');
  const overlay = $('#camera-overlay');
  const overlayMsg = $('#camera-message');
  const retryBtn = $('#btn-camera-retry');
  const startBtn = $('#btn-start-capture');
  const cancelBtn = $('#btn-cancel-capture');
  const badge = $('#progress-badge');
  const slotsEl = $('#shot-slots');
  const filtersEl = $('#filters');

  let stream = null;
  let cameraState = 'requesting';     // requesting | ready | denied | error | unsupported
  let capturing = false;
  let captureToken = 0;
  let passDone = new Set();           // photo indexes captured in the current pass

  // Build filter chips once
  Object.keys(FILTERS).forEach(function (key) {
    const f = FILTERS[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.filter = key;
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.setProperty('--dot', f.dot);
    const label = document.createElement('span');
    label.textContent = f.label;
    b.appendChild(dot);
    b.appendChild(label);
    b.addEventListener('click', function () {
      if (capturing) return;
      state.filter = key;
      photoCache.clear();
      syncFilterUI();
      applyPreviewFilter();
      refreshSlots();
    });
    filtersEl.appendChild(b);
  });

  function syncFilterUI() {
    $$('.chip', filtersEl).forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.filter === state.filter));
      b.disabled = capturing;
    });
  }

  function applyPreviewFilter() {
    const f = FILTERS[state.filter];
    video.style.filter = filterToCss(f);
    video.style.webkitFilter = filterToCss(f);
    tintEl.style.background = f.tint
      ? 'rgba(' + f.tint[0] + ',' + f.tint[1] + ',' + f.tint[2] + ',' + f.tint[3] + ')'
      : 'transparent';
  }

  function setCameraState(kind, message) {
    cameraState = kind;
    overlay.dataset.state = kind;
    if (message) overlayMsg.textContent = message;
    retryBtn.hidden = !(kind === 'denied' || kind === 'error');
    startBtn.disabled = kind !== 'ready' || capturing;
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.srcObject = null;
  }

  async function getStream() {
    const wanted = { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
    try {
      return await navigator.mediaDevices.getUserMedia(wanted);
    } catch (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw err;
    }
  }

  async function startCamera() {
    if (!hasCameraSupport()) {
      setCameraState('unsupported', window.isSecureContext === false
        ? MESSAGES.unsupported + ' ' + MESSAGES.insecure
        : MESSAGES.unsupported);
      return;
    }

    stopCamera();
    setCameraState('requesting', MESSAGES.prompt);

    let s;
    try {
      s = await getStream();
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setCameraState('denied', MESSAGES.denied);
      } else {
        setCameraState('error', MESSAGES.unavailable);
      }
      return;
    }

    if (currentScreen !== 'camera') {          // customer left while the prompt was open
      s.getTracks().forEach(function (t) { t.stop(); });
      return;
    }

    stream = s;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.srcObject = s;

    try { await video.play(); } catch (e) { /* autoplay is allowed for muted inline video */ }

    if (!video.videoWidth) {
      await new Promise(function (resolve) {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }

    s.getVideoTracks().forEach(function (t) {
      t.addEventListener('ended', function () {
        if (currentScreen === 'camera' && stream === s) {
          abortCapture();
          setCameraState('error', MESSAGES.unavailable);
        }
      });
    });

    setCameraState('ready');
  }

  function leaveCamera() {
    abortCapture();
    stopCamera();
  }

  // If the tab was hidden and the browser paused the camera, bring it back.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || currentScreen !== 'camera' || capturing) return;
    const live = stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'live'; });
    if (!live && (cameraState === 'ready' || cameraState === 'requesting')) startCamera();
  });

  retryBtn.addEventListener('click', startCamera);

  function currentIndexLabel(idx) { return 'Photo ' + (idx + 1) + ' of ' + state.format; }

  function updateIdleTexts() {
    const single = state.captureMode.type === 'single';
    const idx = state.captureMode.index;
    badge.textContent = single ? 'Retake Photo ' + (idx + 1) : currentIndexLabel(0);
    startBtn.textContent = single ? 'Retake Photo ' + (idx + 1) : 'Start Photos';
    $('#filter-note').hidden = !single;
    setActiveSlot(single ? idx : -1);
  }

  function enterCamera() {
    if (!state.format) { showScreen('format'); return; }
    passDone = new Set();
    buildSlots();
    capturing = false;
    setCaptureUI(false);
    syncFilterUI();
    applyPreviewFilter();
    updateIdleTexts();
    startCamera();
  }

  $('#btn-camera-back').addEventListener('click', function () {
    const complete = state.photos.length > 0 && state.photos.every(Boolean);
    showScreen(state.captureMode.type === 'single' || complete ? 'review' : 'format');
  });


  /* ========================================================================
     10. CAPTURE
     ====================================================================== */
  function buildSlots() {
    slotsEl.textContent = '';
    for (let i = 0; i < state.format; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot ratio';
      const num = document.createElement('span');
      num.className = 'slot-num fill';
      num.textContent = String(i + 1);
      slot.appendChild(num);
      slotsEl.appendChild(slot);
    }
    refreshSlots();
  }

  function slotIsFilled(i) {
    if (!state.photos[i]) return false;
    return state.captureMode.type === 'single' ? true : passDone.has(i);
  }

  function refreshSlots(justFilled) {
    $$('.slot', slotsEl).forEach(function (slot, i) {
      const filled = slotIsFilled(i);
      const oldImg = $('img', slot);
      if (oldImg) oldImg.remove();
      slot.classList.remove('is-filled');
      if (filled) {
        const img = document.createElement('img');
        img.className = 'fill';
        img.alt = 'Photo ' + (i + 1);
        img.src = getFilteredPhoto(i, 240).toDataURL('image/jpeg', 0.8);
        slot.appendChild(img);
        slot.classList.add('is-filled');
        if (i !== justFilled) slot.style.animation = 'none';   // only the newest one pops
        else slot.style.animation = '';
      }
    });
  }

  function setActiveSlot(idx) {
    $$('.slot', slotsEl).forEach(function (slot, i) { slot.classList.toggle('is-active', i === idx); });
  }

  function setCaptureUI(on) {
    startBtn.hidden = on;
    cancelBtn.hidden = !on;
    $('#btn-camera-back').hidden = on;
    syncFilterUI();
    startBtn.disabled = cameraState !== 'ready' || on;
    if (!on) setActiveSlot(-1);
  }

  function showCount(n) {
    const el = $('#countdown');
    el.textContent = String(n);
    retrigger(el, 'tick');
  }

  function hideCount() {
    const el = $('#countdown');
    el.classList.remove('tick');
    el.textContent = '';
  }

  function fireFlash() { retrigger($('#flash'), 'go'); }

  // Crop the live frame to 4:3 exactly like the preview shows it (object-fit: cover),
  // and mirror it so the photo matches the selfie-style preview.
  function grabFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    const target = CAPTURE.w / CAPTURE.h;
    let sw, sh, sx, sy;
    if (vw / vh > target) { sh = vh; sw = vh * target; sx = (vw - sw) / 2; sy = 0; }
    else { sw = vw; sh = vw / target; sx = 0; sy = (vh - sh) / 2; }

    const outW = Math.min(CAPTURE.w, Math.round(sw));
    const outH = Math.round(outW / target);
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    return c;
  }

  function abortCapture() {
    captureToken++;
    if (capturing) {
      capturing = false;
      hideCount();
    }
  }

  async function startCapture() {
    if (capturing || cameraState !== 'ready' || !state.format) return;

    const single = state.captureMode.type === 'single';
    const indices = single ? [state.captureMode.index] : range(state.format);

    if (!single) {
      state.photos = new Array(state.format).fill(null);
      photoCache.clear();
      passDone = new Set();
      refreshSlots();
    }

    capturing = true;
    const token = ++captureToken;
    setCaptureUI(true);

    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      badge.textContent = single ? 'Retaking Photo ' + (idx + 1) + ' of ' + state.format : currentIndexLabel(k);
      setActiveSlot(idx);

      for (let n = CONFIG.countdownSeconds; n >= 1; n--) {
        showCount(n);
        await sleep(1000);
        if (token !== captureToken) return;
      }
      hideCount();

      const shot = grabFrame();
      if (!shot) {
        capturing = false;
        setCaptureUI(false);
        setCameraState('error', MESSAGES.unavailable);
        return;
      }

      state.photos[idx] = shot;
      passDone.add(idx);
      photoCache.clear();
      fireFlash();
      refreshSlots(idx);

      await sleep(CONFIG.pauseBetweenShotsMs);
      if (token !== captureToken) return;
    }

    capturing = false;
    state.selectedPhoto = null;
    showScreen('review');
  }

  startBtn.addEventListener('click', startCapture);

  cancelBtn.addEventListener('click', function () {
    abortCapture();
    if (state.captureMode.type === 'all') {
      state.photos = new Array(state.format).fill(null);
      photoCache.clear();
    }
    passDone = new Set();
    setCaptureUI(false);
    updateIdleTexts();
    refreshSlots();
  });


  /* ========================================================================
     11. REVIEW + RETAKE
     ====================================================================== */

  // Filtered copy of a raw photo at a given pixel width (cached)
  function getFilteredPhoto(i, width) {
    const key = i + '|' + state.filter + '|' + width;
    if (photoCache.has(key)) return photoCache.get(key);

    const raw = state.photos[i];
    const h = Math.round(width * CAPTURE.h / CAPTURE.w);
    const c = document.createElement('canvas');
    c.width = width; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(raw, 0, 0, width, h);
    applyFilterToCanvas(c, state.filter);
    photoCache.set(key, c);
    return c;
  }

  const reviewGrid = $('#review-grid');
  const retakeSelectedBtn = $('#btn-retake-selected');

  function syncReviewSelection() {
    $$('.photo-tile', reviewGrid).forEach(function (tile, i) {
      const on = state.selectedPhoto === i;
      tile.classList.toggle('is-selected', on);
      tile.setAttribute('aria-pressed', String(on));
    });
    const has = state.selectedPhoto !== null;
    retakeSelectedBtn.disabled = !has;
    retakeSelectedBtn.textContent = has ? 'Retake Photo ' + (state.selectedPhoto + 1) : 'Retake Selected Photo';
  }

  function enterReview() {
    if (!state.photos.length || !state.photos.every(Boolean)) { showScreen('format'); return; }

    reviewGrid.className = 'review-grid count-' + state.format;
    reviewGrid.textContent = '';

    state.photos.forEach(function (_, i) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'photo-tile';
      tile.setAttribute('aria-label', 'Photo ' + (i + 1));

      const box = document.createElement('span');
      box.className = 'ratio';

      const img = document.createElement('img');
      img.className = 'fill';
      img.alt = '';
      img.src = getFilteredPhoto(i, 640).toDataURL('image/jpeg', 0.88);

      const num = document.createElement('span');
      num.className = 'tile-badge';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(i + 1);

      box.appendChild(img);
      box.appendChild(num);
      tile.appendChild(box);
      tile.addEventListener('click', function () {
        state.selectedPhoto = state.selectedPhoto === i ? null : i;
        syncReviewSelection();
      });
      reviewGrid.appendChild(tile);
    });

    syncReviewSelection();
  }

  retakeSelectedBtn.addEventListener('click', function () {
    if (state.selectedPhoto === null) return;
    state.captureMode = { type: 'single', index: state.selectedPhoto };
    showScreen('camera');
  });

  $('#btn-retake-all').addEventListener('click', function () {
    state.captureMode = { type: 'all' };
    state.selectedPhoto = null;
    showScreen('camera');
  });

  $('#btn-use-photos').addEventListener('click', function () {
    state.selectedPhoto = null;
    showScreen('color');
  });


  /* ========================================================================
     12. PHOTOSTRIP DRAWING
     ====================================================================== */
  function fitFont(ctx, lines, maxW, start, weight) {
    let size = start;
    while (size > 12) {
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      const widest = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }));
      if (widest <= maxW) break;
      size -= 1;
    }
    return size;
  }

  function drawHeart(ctx, cx, cy, size, fill, stroke) {
    const s = size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.75);
    ctx.bezierCurveTo(-s * 1.55, -s * 0.25, -s * 0.95, -s * 1.25, 0, -s * 0.4);
    ctx.bezierCurveTo(s * 0.95, -s * 1.25, s * 1.55, -s * 0.25, 0, s * 0.75);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }

  // Draws the complete strip: header, photos, footer. Never crops anything.
  function buildStripCanvas(colorKey) {
    const S = STRIP;
    const col = STRIP_COLORS[colorKey] || STRIP_COLORS.white;
    const n = state.format;
    const lines = CONFIG.orgNameLines;

    const measure = document.createElement('canvas').getContext('2d');
    const orgSize = fitFont(measure, lines, S.photoW, 40, 600);
    const lineH = orgSize * 1.2;
    const headerH = lineH * lines.length + 24 + 10;

    const nameSize = fitFont(measure, [CONFIG.boothName], S.photoW, 58, 700);
    const footerH = nameSize * 1.2 + 26 + 30;

    const photosH = n * S.photoH + (n - 1) * S.gap;
    const H = Math.round(S.top + headerH + S.sectionGap + photosH + S.sectionGap + footerH + S.bottom);

    const c = document.createElement('canvas');
    c.width = Math.round(S.w * S.scale);
    c.height = Math.round(H * S.scale);
    const ctx = c.getContext('2d');
    ctx.scale(S.scale, S.scale);

    // Background
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, S.w, H);

    // Header text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col.ink;
    ctx.font = '600 ' + orgSize + 'px ' + FONT;
    lines.forEach(function (line, i) { ctx.fillText(line, S.w / 2, S.top + lineH * (i + 0.5)); });

    // Small orange + blue accent under the header
    const pillY = S.top + lineH * lines.length + 24;
    const pillX = S.w / 2 - 51;
    ctx.fillStyle = col.orange;
    roundRectPath(ctx, pillX, pillY, 64, 10, 5); ctx.fill();
    ctx.fillStyle = col.blue;
    roundRectPath(ctx, pillX + 74, pillY, 28, 10, 5); ctx.fill();

    // Photos
    const photoPx = Math.round(S.photoW * S.scale);
    const y0 = S.top + headerH + S.sectionGap;
    for (let i = 0; i < n; i++) {
      const x = S.pad;
      const y = y0 + i * (S.photoH + S.gap);
      const photo = getFilteredPhoto(i, photoPx);

      ctx.save();
      roundRectPath(ctx, x, y, S.photoW, S.photoH, S.radius);
      ctx.clip();
      ctx.drawImage(photo, x, y, S.photoW, S.photoH);
      ctx.restore();

      roundRectPath(ctx, x, y, S.photoW, S.photoH, S.radius);
      ctx.lineWidth = 4;
      ctx.strokeStyle = col.ink;
      ctx.stroke();
    }

    // Footer
    const fy = y0 + photosH + S.sectionGap;
    ctx.fillStyle = col.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + nameSize + 'px ' + FONT;
    ctx.fillText(CONFIG.boothName, S.w / 2, fy + nameSize * 0.6);

    const hy = fy + nameSize * 1.2 + 26 + 15;
    ctx.fillStyle = col.blue;
    ctx.beginPath(); ctx.arc(S.w / 2 - 44, hy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(S.w / 2 + 44, hy, 5, 0, Math.PI * 2); ctx.fill();
    drawHeart(ctx, S.w / 2, hy, 30, col.orange, col.ink);

    return c;
  }


  /* ========================================================================
     13. STRIP COLOR SCREEN
     ====================================================================== */
  const swatchesEl = $('#swatches');

  Object.keys(STRIP_COLORS).forEach(function (key) {
    const c = STRIP_COLORS[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.color = key;
    const dot = document.createElement('span');
    dot.className = 'swatch-dot';
    dot.style.setProperty('--c', c.bg);
    const label = document.createElement('span');
    label.textContent = c.label;
    b.appendChild(dot);
    b.appendChild(label);
    b.addEventListener('click', function () {
      state.stripColor = key;
      syncColorUI();
      renderStripPreview();
    });
    swatchesEl.appendChild(b);
  });

  function syncColorUI() {
    $$('.swatch', swatchesEl).forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.color === state.stripColor));
    });
  }

  function renderStripPreview() {
    if (currentScreen !== 'color') return;
    const strip = buildStripCanvas(state.stripColor);
    const view = $('#strip-preview');
    view.width = strip.width;
    view.height = strip.height;
    view.getContext('2d').drawImage(strip, 0, 0);
    retrigger(view, 'swap');
  }

  function enterColor() {
    if (!state.photos.length || !state.photos.every(Boolean)) { showScreen('format'); return; }
    syncColorUI();
    ensureFonts().then(renderStripPreview);
  }

  $('#btn-create-strip').addEventListener('click', function () { showScreen('final'); });


  /* ========================================================================
     14. FINAL SCREEN
     ====================================================================== */
  const finalImg = $('#final-strip');
  const printImg = $('#print-strip');
  const statusEl = $('#final-status');

  function setStatus(message, tone) {
    if (!message) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.textContent = message;
    statusEl.dataset.tone = tone || 'info';
    statusEl.hidden = false;
  }

  const ACTIONS_BY_DELIVERY = {
    soft: ['send', 'download'],
    hard: ['print', 'download'],
    both: ['send', 'print', 'download']
  };

  function enterFinal() {
    if (!state.photos.length || !state.photos.every(Boolean)) { showScreen('format'); return; }
    setStatus('');

    // Delivery info + action buttons
    const wanted = ACTIONS_BY_DELIVERY[state.delivery] || ['download'];
    let firstShown = true;
    $$('[data-final]').forEach(function (btn) {
      const show = wanted.indexOf(btn.dataset.final) !== -1;
      btn.hidden = !show;
      btn.disabled = false;
      btn.classList.remove('btn-primary', 'btn-secondary');
      if (show) {
        btn.classList.add(firstShown ? 'btn-primary' : 'btn-secondary');
        firstShown = false;
      }
    });

    ensureFonts().then(function () {
      if (currentScreen !== 'final') return;
      state.finalCanvas = buildStripCanvas(state.stripColor);
      state.finalUrl = state.finalCanvas.toDataURL('image/jpeg', CONFIG.jpegQuality);
      finalImg.src = state.finalUrl;       // preview (whole strip, no cropping)
      printImg.src = state.finalUrl;       // used only by @media print
      retrigger(finalImg, 'reveal');
    });
  }

  function downloadStrip() {
    if (!state.finalCanvas) return;
    const done = function (href, revoke) {
      const a = document.createElement('a');
      a.href = href;
      a.download = CONFIG.downloadFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
      setStatus('Your photostrip is downloading.', 'info');
    };

    if (state.finalCanvas.toBlob) {
      state.finalCanvas.toBlob(function (blob) {
        if (blob) done(URL.createObjectURL(blob), true);
        else done(state.finalUrl, false);
      }, 'image/jpeg', CONFIG.jpegQuality);
    } else {
      done(state.finalUrl, false);
    }
  }

  function printStrip() {
    if (!state.finalUrl) return;
    printImg.src = state.finalUrl;
    const go = function () { window.print(); };
    if (printImg.decode) printImg.decode().then(go, go); else go();
  }

  function getStripBlob() {
    return new Promise(function (resolve) {
      state.finalCanvas.toBlob(resolve, 'image/jpeg', CONFIG.jpegQuality);
    });
  }

  /* Hook for your email backend — see CONFIG.emailEndpoint at the top of this file. */
  async function deliverSoftCopy(payload) {
    if (!CONFIG.emailEndpoint) return { sent: false, reason: 'not-configured' };

    const form = new FormData();
    form.append('email', payload.email);
    form.append('delivery', payload.delivery);
    form.append('photostrip', payload.blob, payload.fileName);

    const res = await fetch(CONFIG.emailEndpoint, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Email service replied with status ' + res.status);
    return { sent: true };
  }

  async function sendSoftCopy(btn) {
    if (!state.finalCanvas || !isValidEmail(state.email)) {
      setStatus(MESSAGES.email, 'error');
      return;
    }
    btn.disabled = true;
    setStatus('Sending…', 'info');
    try {
      const blob = await getStripBlob();
      const result = await deliverSoftCopy({
        email: state.email,
        delivery: state.delivery,
        fileName: CONFIG.downloadFileName,
        blob: blob
      });
      if (result.sent) {
        setStatus('Your photostrip was sent to ' + state.email + '.', 'info');
      } else {
        setStatus("Email sending isn't connected on this booth yet, so nothing was emailed. Please use Download Photo to save your photostrip.", 'warn');
      }
    } catch (err) {
      setStatus("We couldn't send the email. Please try again, or use Download Photo to save your photostrip.", 'error');
    } finally {
      btn.disabled = false;
    }
  }

  $('#final-actions').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-final]');
    if (!btn) return;
    const action = btn.dataset.final;
    if (action === 'download') downloadStrip();
    else if (action === 'print') printStrip();
    else if (action === 'send') sendSoftCopy(btn);
  });

  $('#btn-another').addEventListener('click', resetSession);


  /* ========================================================================
     15. START OVER + INIT
     ====================================================================== */
  function resetSession() {
    abortCapture();
    stopCamera();

    state = freshState();
    deliveryDraft = null;
    passDone = new Set();
    photoCache.clear();

    emailInput.value = '';
    hideEmailError();
    syncPaymentUI();
    syncFormatUI();
    syncFilterUI();
    syncColorUI();
    setStatus('');
    finalImg.removeAttribute('src');
    printImg.removeAttribute('src');
    $('#delivery-panel').hidden = true;
    $('#btn-delivery-continue').disabled = true;

    showScreen('welcome');
  }

  // Confirmation before wiping a session in progress
  const modal = $('#modal');
  let lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    $('#modal-confirm').focus();
  }
  function closeModal() {
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  $('#btn-start-over').addEventListener('click', openModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-confirm').addEventListener('click', function () { closeModal(); resetSession(); });
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  // Early heads-up on the welcome screen if this browser can't run the camera
  if (!hasCameraSupport()) {
    const notice = $('#browser-notice');
    notice.textContent = window.isSecureContext === false
      ? MESSAGES.unsupported + ' ' + MESSAGES.insecure
      : MESSAGES.unsupported;
    notice.hidden = false;
  }

  window.addEventListener('pagehide', stopCamera);

  showScreen('welcome');
})();
