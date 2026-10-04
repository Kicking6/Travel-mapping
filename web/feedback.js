/* ── feedback.js — in-app feedback capture ─────────────────────────────────
   From Site Scout (LINZ API Tester/web/feedback.js), which ported it from the
   Akahu app (IN_APP_FEEDBACK_DESIGN.md). Behaviour is the same; what changed
   is the page hooks: SUBJECT_ATTRS knows this app's routes, stays, photos and
   album pages, a click on a map records where the map was looking, and "who"
   comes from TA_USER.

   Trigger is ARMED MODE, not a contextmenu hijack: a visible button arms it,
   the next ordinary click captures the element under the pointer, Escape
   cancels. Overriding right-click app-wide would remove copy, paste and
   open-in-new-tab throughout the app for exactly the non-technical users this
   exists for.                                                              */
(function (global) {
  'use strict';

  var ARMED_CLASS = 'fb-armed';
  var KINDS = [
    { value: 'bug', label: 'Something’s wrong' },
    { value: 'idea', label: 'An idea' },
    { value: 'question', label: 'A question' }
  ];
  var CRITICALITIES = [
    { value: 'low', label: 'Low — minor, no rush' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High — getting in the way' },
    { value: 'critical', label: 'Critical — broken / blocking, notify now' }
  ];

  var armed = false;
  var hoverEl = null;
  var captured = null;      // the element the report is about
  var shotDataUrl = null;   // annotated PNG, set by the editor
  var els = {};             // lazily built DOM

  /* ── The app's own base text size, measured rather than assumed ──────────
     The highlighter's default tip is 2x the app's standard text size. Reading
     --fs-base directly gives a rem string; what's wanted is real pixels after
     the root font size applies, so this measures a probe element actually
     styled with the token. Falls back to the probe's computed size if the
     token is missing (the V1 pages predate the token set). */
  function baseTextPx() {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--fs-base,0.84375rem)';
    probe.textContent = 'x';
    document.body.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).fontSize) || 13.5;
    probe.remove();
    return px;
  }
  function defaultTipPx() { return Math.round(baseTextPx() * 2); }

  /* ── Layer 3: what did they click ───────────────────────────────────────
     The load-bearing part is subjectOf(): walking UP from the clicked node to
     the nearest DOMAIN identity. "This looks wrong" is unactionable; "this
     looks wrong, on transaction 2026-08-14-ASB-1234" is reproducible. */
  var SUBJECT_ATTRS = [
    { attr: 'data-route-id', type: 'route' },
    { attr: 'data-place-id', type: 'place' },
    { attr: 'data-photo-id', type: 'photo' },
    { attr: 'data-leg-id', type: 'leg' },
    { attr: 'data-feedback-id', type: 'feedback' },
    { attr: 'data-path', type: 'style_setting' },
    { attr: 'data-user-email', type: 'user' }
  ];

  /* The map is one canvas, so "what did they click" is a place on it: the
     coordinates under the pointer and the route there, if any. */
  function mapSubject(el, e) {
    var map = global.__taMap;
    if (!map || !el || !el.closest || !el.closest('.maplibregl-map')) return null;
    try {
      var r = map.getCanvas().getBoundingClientRect();
      var pt = [e.clientX - r.left, e.clientY - r.top];
      var ll = map.unproject(pt);
      var hit = map.queryRenderedFeatures([[pt[0] - 5, pt[1] - 5], [pt[0] + 5, pt[1] + 5]]).filter(function (f) { return f.source === 'ta-routes' || f.source === 'ta-places'; })[0];
      return {
        label: hit ? (hit.properties.name || 'the map') : 'the map at ' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4),
        subjectType: hit ? (hit.source === 'ta-routes' ? 'route' : 'place') : 'map_point',
        subjectId: hit ? String(hit.properties.id) : ll.lat.toFixed(5) + ',' + ll.lng.toFixed(5)
      };
    } catch (_) { return null; }
  }
  function mapCamera() {
    var map = global.__taMap;
    if (!map || !document.body.contains(map.getContainer())) return null;
    try { var c = map.getCenter(); return { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), bearing: Math.round(map.getBearing()), pitch: Math.round(map.getPitch()) }; } catch (_) { return null; }
  }

  function subjectOf(el) {
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth++ < 12) {
      for (var i = 0; i < SUBJECT_ATTRS.length; i++) {
        var v = node.getAttribute && node.getAttribute(SUBJECT_ATTRS[i].attr);
        if (v) return { subjectType: SUBJECT_ATTRS[i].type, subjectId: v };
      }
      node = node.parentElement;
    }
    return { subjectType: null, subjectId: null };
  }

  function selectorFor(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth++ < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) part += '.' + cls;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function labelFor(el) {
    var text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 120);
    return el.getAttribute('aria-label') || el.getAttribute('placeholder')
      || el.getAttribute('title') || el.tagName.toLowerCase();
  }

  function describeElement(el, e) {
    if (!el) return null;
    var onMap = e && mapSubject(el, e);
    if (onMap) return { label: onMap.label, selector: selectorFor(el), tag: el.tagName.toLowerCase(), subjectType: onMap.subjectType, subjectId: onMap.subjectId };
    var subject = subjectOf(el);
    return {
      label: labelFor(el),
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      subjectType: subject.subjectType,
      subjectId: subject.subjectId
    };
  }

  /* ── Layers 1 & 2: who, when, where ───────────────────────────────────── */
  function activeTab() {
    var active = document.querySelector('#nav a.active');
    return active ? (active.getAttribute('data-nav') || active.textContent.trim()) : null;
  }
  function openSettingsCard() {
    var sec = document.querySelector('.seg [aria-pressed="true"], .seg .on');
    return sec ? (sec.getAttribute('data-tab') || sec.textContent.trim()).slice(0, 60) : null;
  }

  function buildContext(elementInfo) {
    var who = global.TA_USER || {};
    return {
      who: {
        loginEmail: who.email || null,
        isAdmin: !!who.isAdmin,
        appVersion: global.TA_APP_VERSION || null,
        at: new Date().toISOString()
      },
      where: {
        pathname: location.pathname,
        hash: location.hash,
        search: location.search,
        activeTab: activeTab(),
        openCard: openSettingsCard(),
        inFrame: global !== global.parent,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        userAgent: navigator.userAgent,
        map: mapCamera()
      },
      what: elementInfo || { label: null, selector: null, subjectType: null, subjectId: null },
      diagnostics: global.TA_DIAG ? global.TA_DIAG.snapshot() : null
    };
  }

  /* ── Armed mode ──────────────────────────────────────────────────────── */
  // Arming spans every same-origin frame. The Review tab and its Auto-approved
  // popup are an iframe, and a click inside one never reaches the parent's
  // listeners — so the picker used to silently land on the header instead
  // (feedback #5). The frame that gets the click owns the report.
  function sameOriginFeedback(win) {
    try { return (win && win !== global && win.TA_FEEDBACK) || null; } catch (e) { return null; }
  }
  function childFrames() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) {
      var fb = sameOriginFeedback(f.contentWindow);
      if (fb) out.push(fb);
    });
    return out;
  }
  var embeddedParent = sameOriginFeedback(global.parent);

  function arm() {
    if (armed) return;
    armed = true;
    document.body.classList.add(ARMED_CLASS);
    ensureDom();
    els.ring.hidden = false;
    els.hint.hidden = !!embeddedParent;
    document.addEventListener('mousemove', onArmedMove, true);
    document.addEventListener('click', onArmedClick, true);
    document.addEventListener('keydown', onArmedKey, true);
    childFrames().forEach(function (fb) { fb.arm(); });
  }

  // A pick or Escape in one frame ends armed mode everywhere.
  function disarmAll() {
    if (embeddedParent) embeddedParent.disarm(); else disarm();
  }

  function disarm() {
    childFrames().forEach(function (fb) { fb.disarm(); });
    if (!armed) return;
    armed = false;
    document.body.classList.remove(ARMED_CLASS);
    if (els.ring) els.ring.hidden = true;
    if (els.hint) els.hint.hidden = true;
    hoverEl = null;
    document.removeEventListener('mousemove', onArmedMove, true);
    document.removeEventListener('click', onArmedClick, true);
    document.removeEventListener('keydown', onArmedKey, true);
  }

  function onArmedMove(e) {
    var el = e.target;
    if (!el || el === hoverEl || els.root.contains(el)) return;
    hoverEl = el;
    var r = el.getBoundingClientRect();
    els.ring.style.top = r.top + 'px';
    els.ring.style.left = r.left + 'px';
    els.ring.style.width = r.width + 'px';
    els.ring.style.height = r.height + 'px';
  }

  function onArmedClick(e) {
    if (els.root.contains(e.target)) return;
    // Swallow the click entirely: while armed, clicking is "pick this", and
    // letting it also activate the control would fire a real action the user
    // didn't intend (deleting a row while reporting a bug about it).
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    disarmAll();
    openBox(describeElement(el, e));
  }

  function onArmedKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); disarmAll(); }
  }

  /* ── Screenshot annotation ──────────────────────────────────────────────
     The user supplies the image (paste or file) rather than the page
     screenshotting itself: html2canvas is a CDN dependency the CSP would
     fight, and this way they choose exactly what is in frame.

     Two tools. REDACT paints opaque black — it must be destructive on the
     flattened bitmap, because a "redaction" that is only a drawn overlay is
     recoverable and therefore a lie. HIGHLIGHT paints translucent colour under
     multiply blending so text stays readable. */
  var shot = {
    img: null, canvas: null, ctx: null,
    tool: 'highlight', tip: null, drawing: false, last: null,
    undoStack: []
  };

  function loadShotImage(src) {
    var img = new Image();
    img.onload = function () {
      shot.img = img;
      var canvas = els.canvas;
      // Cap the working surface so a 6000px retina grab doesn't produce a
      // 30MB PNG; scale is uniform so annotation coordinates stay honest.
      var maxW = 1600;
      var scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      shot.ctx = canvas.getContext('2d');
      shot.ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      shot.undoStack = [shot.ctx.getImageData(0, 0, canvas.width, canvas.height)];
      els.shotEmpty.hidden = true;
      els.shotEditor.hidden = false;
      syncShot();
    };
    img.src = src;
  }

  function pushUndo() {
    if (!shot.ctx) return;
    shot.undoStack.push(shot.ctx.getImageData(0, 0, els.canvas.width, els.canvas.height));
    // Bounded: full-canvas ImageData is megabytes each.
    if (shot.undoStack.length > 12) shot.undoStack.shift();
  }

  function undoShot() {
    if (shot.undoStack.length < 2) return;
    shot.undoStack.pop();
    shot.ctx.putImageData(shot.undoStack[shot.undoStack.length - 1], 0, 0);
    syncShot();
  }

  function canvasPoint(e) {
    var r = els.canvas.getBoundingClientRect();
    // touchend fires with an empty `touches` (the finger already lifted), so
    // the last known position has to come from `changedTouches` instead.
    var touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    var cx = touch ? touch.clientX : e.clientX;
    var cy = touch ? touch.clientY : e.clientY;
    return {
      x: (cx - r.left) * (els.canvas.width / r.width),
      y: (cy - r.top) * (els.canvas.height / r.height)
    };
  }

  function startDraw(e) {
    if (!shot.ctx) return;
    e.preventDefault();
    pushUndo();
    shot.drawing = true;
    shot.last = canvasPoint(e);
    if (shot.tool === 'redact' || shot.tool === 'crop') shot.redactStart = shot.last;
    else strokeTo(shot.last, true);
  }

  function strokeTo(pt, isStart) {
    var ctx = shot.ctx;
    ctx.save();
    // Multiply with a PALE yellow is what reads as a highlighter: it tints
    // without darkening. The previous mid-yellow at 0.45 alpha muddied whatever
    // it crossed, which is the "too dark" complaint.
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = 'rgba(255, 246, 143, 0.9)';
    ctx.lineWidth = shot.tip;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(shot.last.x, shot.last.y);
    ctx.lineTo(pt.x, pt.y);
    if (isStart) ctx.lineTo(pt.x + 0.01, pt.y);
    ctx.stroke();
    ctx.restore();
    shot.last = pt;
  }

  function moveDraw(e) {
    if (!shot.drawing) return;
    e.preventDefault();
    var pt = canvasPoint(e);
    if (shot.tool === 'highlight') {
      strokeTo(pt);
    } else if (shot.tool === 'crop') {
      // Non-destructive preview: a dashed marquee, not a fill — the pixels
      // outside it aren't gone until the drag ends and the crop is applied.
      shot.ctx.putImageData(shot.undoStack[shot.undoStack.length - 1], 0, 0);
      var sc = shot.redactStart;
      shot.ctx.save();
      shot.ctx.strokeStyle = '#1c5d8c';
      shot.ctx.lineWidth = 2;
      shot.ctx.setLineDash([6, 4]);
      shot.ctx.strokeRect(Math.min(sc.x, pt.x), Math.min(sc.y, pt.y), Math.abs(pt.x - sc.x), Math.abs(pt.y - sc.y));
      shot.ctx.restore();
    } else {
      // Live preview of the rectangle, redrawn from the pre-drag snapshot each
      // frame so the preview never accumulates.
      shot.ctx.putImageData(shot.undoStack[shot.undoStack.length - 1], 0, 0);
      var s = shot.redactStart;
      shot.ctx.fillStyle = '#000';
      shot.ctx.fillRect(Math.min(s.x, pt.x), Math.min(s.y, pt.y), Math.abs(pt.x - s.x), Math.abs(pt.y - s.y));
    }
  }

  function endDraw(e) {
    if (!shot.drawing) return;
    shot.drawing = false;
    if (shot.tool === 'crop' && shot.redactStart) {
      applyCrop(shot.redactStart, canvasPoint(e));
      shot.redactStart = null;
      return;
    }
    syncShot();
  }

  // Crops the working canvas down to the dragged rect. Destructive and its own
  // undo checkpoint (rather than pushed onto the existing stack) because every
  // prior snapshot was taken at the old canvas size and can't be restored into
  // the new one.
  function applyCrop(start, end) {
    var x = Math.round(Math.min(start.x, end.x));
    var y = Math.round(Math.min(start.y, end.y));
    var w = Math.round(Math.abs(end.x - start.x));
    var h = Math.round(Math.abs(end.y - start.y));
    if (w < 10 || h < 10) { syncShot(); return; } // too small to be an intentional crop
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, els.canvas.width - x);
    h = Math.min(h, els.canvas.height - y);
    var cropped = shot.ctx.getImageData(x, y, w, h);
    els.canvas.width = w;
    els.canvas.height = h;
    shot.ctx.putImageData(cropped, 0, 0);
    shot.undoStack = [shot.ctx.getImageData(0, 0, w, h)];
    syncShot();
  }

  function syncShot() {
    // PNG keeps redaction crisp; JPEG artefacts around a black box look like
    // the redaction failed even when it didn't.
    shotDataUrl = els.canvas.toDataURL('image/png');
    var kb = Math.round((shotDataUrl.length * 0.75) / 1024);
    els.shotSize.textContent = kb + ' KB';
    els.shotClear.hidden = false;
  }

  function clearShot() {
    shotDataUrl = null;
    shot.img = null; shot.ctx = null; shot.undoStack = [];
    els.shotEditor.hidden = true;
    els.shotEmpty.hidden = false;
    els.shotClear.hidden = true;
    els.shotSize.textContent = '';
    els.file.value = '';
  }

  /* Native screen capture — no library, no CDN. The browser shows its own
     picker, so nothing is captured without an explicit choice. The box hides
     during the grab so it isn't in the shot of the thing being reported. */
  function grabScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus('This browser can\u2019t grab the screen — paste an image instead.', 'err');
      return;
    }
    var modal = els.backdrop;
    modal.style.visibility = 'hidden';
    navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false })
      .then(function (stream) {
        var video = document.createElement('video');
        video.srcObject = stream;
        return video.play().then(function () {
          // The first frame can arrive before the surface has painted, so wait a
          // beat rather than capturing black.
          return new Promise(function (res) { setTimeout(res, 320); });
        }).then(function () {
          var c = document.createElement('canvas');
          c.width = video.videoWidth;
          c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          stream.getTracks().forEach(function (t) { t.stop(); });
          modal.style.visibility = '';
          loadShotImage(c.toDataURL('image/png'));
          setStatus('', '');
        });
      })
      .catch(function (err) {
        modal.style.visibility = '';
        // Cancelling the browser's own picker is not an error worth shouting about.
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) { setStatus('', ''); return; }
        setStatus('Couldn\u2019t grab the screen: ' + (err && err.message), 'err');
      });
  }

  function onPaste(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) { e.preventDefault(); readFile(file); return; }
      }
    }
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () { loadShotImage(reader.result); };
    reader.readAsDataURL(file);
  }

  /* ── The box ─────────────────────────────────────────────────────────── */
  function openBox(elementInfo) {
    ensureDom();
    captured = elementInfo;
    els.subject.innerHTML = '';
    if (elementInfo) {
      var bits = ['You clicked: “' + truncate(elementInfo.label, 60) + '”'];
      if (elementInfo.subjectType) bits.push(elementInfo.subjectType.replace(/_/g, ' ') + ' ' + elementInfo.subjectId);
      els.subject.textContent = bits.join(' · ');
      els.subject.hidden = false;
    } else {
      els.subject.hidden = true;
    }
    renderIncluded(elementInfo);
    els.status.textContent = '';
    els.status.className = 'fb-status';
    global.DSOverlay
      ? DSOverlay.openModal(els.backdrop, { initialFocus: els.text })
      : (els.backdrop.hidden = false, els.text.focus());
    els.backdrop.hidden = false;
  }

  function closeBox() {
    els.backdrop.classList.remove('fb-full');
    var exp = els.root.querySelector('#fb-expand');
    if (exp) { exp.setAttribute('aria-pressed', 'false'); exp.textContent = 'Full screen'; }
    if (global.DSOverlay) DSOverlay.closeModal(els.backdrop);
    els.backdrop.hidden = true;
    els.text.value = '';
    clearShot();
    captured = null;
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* Plain-language list of what is about to be sent. Not a legal disclaimer —
     an element capture contains real transaction text, and the user should be
     able to see that before they press send, not consent to it in the
     abstract. */
  function renderIncluded(elementInfo) {
    var ctx = buildContext(elementInfo);
    var lines = [];
    lines.push('The page you’re on — ' + (ctx.where.activeTab || ctx.where.pathname));
    if (elementInfo) lines.push('The thing you clicked — “' + truncate(elementInfo.label, 50) + '”');
    if (elementInfo && elementInfo.subjectType) {
      lines.push('Which ' + elementInfo.subjectType.replace(/_/g, ' ') + ' it belongs to');
    }
    var d = ctx.diagnostics;
    var errs = d ? d.console.length : 0;
    var nets = d ? d.net.length : 0;
    if (errs || nets) lines.push('Recent errors on this tab — ' + errs + ' message' + (errs === 1 ? '' : 's')
      + ', ' + nets + ' failed or slow request' + (nets === 1 ? '' : 's'));
    lines.push('Your email, and which browser you’re using');
    lines.push('Where the map was looking, if you were on a map');
    lines.push('Nothing else from the trip, beyond what’s on screen where you clicked');
    els.included.innerHTML = lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function submit() {
    var text = els.text.value.trim();
    if (!text) { setStatus('Tell us what happened first.', 'err'); return; }
    var payload = {
      body: text,
      kind: els.kind.value || null,
      criticality: els.crit.value || 'medium',
      context: buildContext(captured),
      screenshot: shotDataUrl
    };
    els.send.disabled = true;
    setStatus('Sending…', '');

    var transport = defaultTransport;
    transport(payload).then(function (res) {
      els.send.disabled = false;
      if (res && res.screenshotError) {
        setStatus('Thanks — sent. ' + res.screenshotError, 'warn');
        setTimeout(closeBox, 5200);
      } else {
        setStatus('Thanks — sent.', 'ok');
        setTimeout(closeBox, 1100);
      }
      global.dispatchEvent(new CustomEvent('ta:feedback-submitted'));
    }).catch(function (e) {
      els.send.disabled = false;
      setStatus(e.message || 'Could not send that.', 'err');
    });
  }

  function defaultTransport(payload) {
    return fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
        return b;
      });
    });
  }

  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'fb-status' + (cls ? ' ' + cls : '');
  }

  /* ── DOM, built once on first use ────────────────────────────────────── */
  function ensureDom() {
    if (els.root) return;
    var root = document.createElement('div');
    root.className = 'fb-root';
    root.innerHTML = [
      '<button type="button" class="fb-launch" id="fb-launch" title="Report a problem or an idea (Shift+F)" aria-label="Report a problem or an idea">',
      '<span aria-hidden="true">✎</span></button>',
      '<div class="fb-ring" id="fb-ring" hidden></div>',
      '<div class="fb-hint" id="fb-hint" hidden>Click anything to report it · <kbd>Esc</kbd> to cancel</div>',
      '<div class="ds-modal-backdrop fb-backdrop" id="fb-backdrop" hidden>',
      '  <div class="ds-modal fb-modal" role="dialog" aria-modal="true" aria-labelledby="fb-title">',
      '    <div class="ds-modal-head"><span id="fb-title">Send feedback</span>',
      '      <button type="button" class="ds-btn" id="fb-close">Close</button></div>',
      '    <div class="ds-modal-body">',
      '      <div class="fb-subject" id="fb-subject" hidden></div>',
      '      <label class="fb-label" for="fb-kind">What kind of thing is this?</label>',
      '      <select id="fb-kind" class="fb-select">',
      '        <option value="">— not sure —</option>',
      KINDS.map(function (k) { return '<option value="' + k.value + '">' + k.label + '</option>'; }).join(''),
      '      </select>',
      '      <label class="fb-label" for="fb-crit">How urgent is this?</label>',
      '      <select id="fb-crit" class="fb-select">',
      CRITICALITIES.map(function (c) { return '<option value="' + c.value + '"' + (c.value === 'medium' ? ' selected' : '') + '>' + c.label + '</option>'; }).join(''),
      '      </select>',
      '      <label class="fb-label" for="fb-text">What happened?</label>',
      '      <textarea id="fb-text" class="fb-text" rows="5" placeholder="What were you expecting, and what did you get instead?"></textarea>',
      '      <div class="fb-shot">',
      '        <div class="fb-label">Screenshot <span class="fb-opt">optional</span></div>',
      '        <div class="fb-shot-empty" id="fb-shot-empty">',
      '          <div class="fb-shot-drop">',
      '            <button type="button" class="ds-btn primary" id="fb-grab">Grab this screen</button>',
      '            <div class="fb-note" style="margin-top:8px">or paste an image (<kbd>⌘V</kbd>), or ',
      '              <button type="button" class="ds-btn" id="fb-pick">choose a file</button></div>',
      '          </div>',
      '          <div class="fb-note">You can black out anything private before it sends.</div>',
      '        </div>',
      '        <div class="fb-shot-editor" id="fb-shot-editor" hidden>',
      '          <div class="fb-tools">',
      '            <div class="ds-segmented fb-seg" role="group" aria-label="Annotation tool">',
      '              <button type="button" data-tool="highlight" aria-pressed="true">Highlight</button>',
      '              <button type="button" data-tool="redact" aria-pressed="false">Black out</button>',
      '              <button type="button" data-tool="crop" aria-pressed="false">Crop</button>',
      '            </div>',
      '            <label class="fb-tip"><span>Tip</span>',
      '              <input type="range" id="fb-tip" min="4" max="120" step="1">',
      '              <output id="fb-tip-val"></output></label>',
      '            <button type="button" class="ds-btn" id="fb-expand" aria-pressed="false">Full screen</button>',
      '            <button type="button" class="ds-btn" id="fb-undo">Undo</button>',
      '            <button type="button" class="ds-btn" id="fb-shot-clear" hidden>Remove</button>',
      '            <span class="fb-shot-size" id="fb-shot-size"></span>',
      '          </div>',
      '          <div class="fb-canvas-wrap"><canvas id="fb-canvas"></canvas></div>',
      '        </div>',
      '        <input type="file" id="fb-file" accept="image/*" hidden>',
      '      </div>',
      '      <details class="fb-included"><summary>What gets sent with this</summary>',
      '        <ul id="fb-included"></ul></details>',
      '      <div class="fb-status" id="fb-status"></div>',
      '    </div>',
      '    <div class="ds-modal-foot">',
      '      <button type="button" class="ds-btn" id="fb-cancel">Cancel</button>',
      '      <button type="button" class="ds-btn primary" id="fb-send">Send feedback</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(root);

    els = {
      root: root,
      launch: root.querySelector('#fb-launch'),
      ring: root.querySelector('#fb-ring'),
      hint: root.querySelector('#fb-hint'),
      backdrop: root.querySelector('#fb-backdrop'),
      subject: root.querySelector('#fb-subject'),
      kind: root.querySelector('#fb-kind'),
      crit: root.querySelector('#fb-crit'),
      text: root.querySelector('#fb-text'),
      included: root.querySelector('#fb-included'),
      status: root.querySelector('#fb-status'),
      send: root.querySelector('#fb-send'),
      canvas: root.querySelector('#fb-canvas'),
      file: root.querySelector('#fb-file'),
      shotEmpty: root.querySelector('#fb-shot-empty'),
      shotEditor: root.querySelector('#fb-shot-editor'),
      shotSize: root.querySelector('#fb-shot-size'),
      shotClear: root.querySelector('#fb-shot-clear'),
      tip: root.querySelector('#fb-tip'),
      tipVal: root.querySelector('#fb-tip-val')
    };

    // The default tip is 2x the app's own base text size, measured at runtime
    // — so it still reads as "twice the text" if the type scale ever changes.
    shot.tip = defaultTipPx();
    els.tip.value = String(shot.tip);
    els.tipVal.textContent = shot.tip + 'px';

    // Inside the app shell the parent's button already covers this frame;
    // a second one sat on top of it in the corner.
    if (embeddedParent) els.launch.hidden = true;
    els.launch.addEventListener('click', function () { armed ? disarm() : arm(); });
    root.querySelector('#fb-close').addEventListener('click', closeBox);
    root.querySelector('#fb-cancel').addEventListener('click', closeBox);
    els.send.addEventListener('click', submit);
    root.querySelector('#fb-pick').addEventListener('click', function () { els.file.click(); });
    els.file.addEventListener('change', function () { if (els.file.files[0]) readFile(els.file.files[0]); });
    els.shotClear.addEventListener('click', clearShot);
    root.querySelector('#fb-undo').addEventListener('click', undoShot);
    root.querySelector('#fb-expand').addEventListener('click', function () {
      var on = els.backdrop.classList.toggle('fb-full');
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.textContent = on ? 'Exit full screen' : 'Full screen';
    });

    root.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        shot.tool = btn.getAttribute('data-tool');
        root.querySelectorAll('[data-tool]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        els.canvas.classList.toggle('is-redact', shot.tool === 'redact');
        els.canvas.classList.toggle('is-crop', shot.tool === 'crop');
      });
    });

    els.tip.addEventListener('input', function () {
      shot.tip = Number(els.tip.value);
      els.tipVal.textContent = shot.tip + 'px';
    });

    els.canvas.addEventListener('mousedown', startDraw);
    els.canvas.addEventListener('touchstart', startDraw, { passive: false });
    window.addEventListener('mousemove', moveDraw);
    window.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('mouseup', endDraw);
    window.addEventListener('touchend', endDraw);

    // A paste event fires on the FOCUSED element. Clicking the drop zone focuses
    // nothing, so the target was <body> — outside the backdrop — and a listener
    // bound there never saw it. Bound to document, gated on the box being open.
    document.addEventListener('paste', function (e) {
      if (els.backdrop.hidden) return;
      onPaste(e);
    });
    root.querySelector('#fb-grab').addEventListener('click', grabScreen);
  }

  /* Shift+F arms it from the keyboard, but never while the user is typing —
     otherwise writing "Shift+F" into any text field would arm the picker. */
  document.addEventListener('keydown', function (e) {
    if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (String(e.key).toLowerCase() !== 'f') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (embeddedParent) { embeddedParent.arm(); return; }
    ensureDom();
    armed ? disarm() : arm();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDom);
  } else {
    ensureDom();
  }

  global.TA_FEEDBACK = {
    arm: arm,
    disarm: disarm,
    open: function () { ensureDom(); openBox(null); },
    close: function () { if (els.backdrop && !els.backdrop.hidden) closeBox(); },
    defaultTipPx: defaultTipPx,
    buildContext: buildContext,
    describeElement: describeElement,
    subjectOf: subjectOf
  };
})(window);
