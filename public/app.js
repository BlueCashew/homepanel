/* Huispaneel - frontend.
   Alleen ES5 en XMLHttpRequest, zodat het draait in Safari op iOS 9 (iPad mini 1).
   Schermen: Muziek | Beginscherm | kamers en zones die aan staan (en eventueel Klok). */
(function () {
  'use strict';

  var DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  var POLL_MS = 3000;
  var GAP = 16;

  var state = null;
  var faces = [];          // [{ key, el }]
  var face = 1;
  var faceSig = '';
  var bound = [];          // tegels die bij elke ronde bijgewerkt worden
  var clocks = [];         // klokken die elke seconde bijgewerkt worden
  var tileById = {};
  var pending = {};
  var lastOk = 0;
  var lastTouch = 0;
  var startedAt = Date.now();
  var sheet = null;
  var toastTimer = null;
  var favPlaying = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html) { e.innerHTML = html; } return e; }
  function addClass(e, c) { if ((' ' + e.className + ' ').indexOf(' ' + c + ' ') === -1) { e.className = (e.className + ' ' + c).replace(/^\s+/, ''); } }
  function removeClass(e, c) { e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  function setClass(e, c, on) { if (on) { addClass(e, c); } else { removeClass(e, c); } }
  function setText(e, t) { t = t === undefined || t === null ? '' : String(t); if (e.textContent !== t) { e.textContent = t; } }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function temp(n) { return typeof n === 'number' ? String(Math.round(n * 10) / 10).replace('.', ',') : ''; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function hasClassUp(e, c) {
    while (e && e !== document.body) {
      if (e.className && typeof e.className === 'string' && (' ' + e.className + ' ').indexOf(' ' + c + ' ') !== -1) { return true; }
      e = e.parentNode;
    }
    return false;
  }

  /* ------------------------------------------------------------ iconen */
  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'; }
  var STROKE = ' fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
  var NEXT = '<path d="M4 5v14a1 1 0 0 0 1.55.83L15 13.6V19a1.5 1.5 0 0 0 3 0V5a1.5 1.5 0 0 0-3 0v5.4L5.55 4.17A1 1 0 0 0 4 5z"/>';
  var SPEAKER = '<path d="M3 9.5v5a1 1 0 0 0 1 1h3.5l4.8 4a1 1 0 0 0 1.7-.77V5.27a1 1 0 0 0-1.7-.77l-4.8 4H4a1 1 0 0 0-1 1z"/>';
  var ICON = {
    light: svg('<path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/><rect x="9" y="19.5" width="6" height="2.5" rx="1.2"/>'),
    group: svg('<path d="M7.5 3a5 5 0 0 0-2.9 9.07V13.5a.8.8 0 0 0 .8.8h4.2a.8.8 0 0 0 .8-.8v-1.43A5 5 0 0 0 7.5 3z"/><path d="M16.5 7a5 5 0 0 0-2.9 9.07v1.43a.8.8 0 0 0 .8.8h4.2a.8.8 0 0 0 .8-.8v-1.43A5 5 0 0 0 16.5 7z"/><rect x="5.5" y="15.4" width="4" height="2" rx="1"/><rect x="14.5" y="19.4" width="4" height="2" rx="1"/>'),
    'switch': svg('<path d="M12 3v8"' + STROKE + '/><path d="M7 6.5a8 8 0 1 0 10 0"' + STROKE + '/>'),
    outlet: svg('<path fill-rule="evenodd" d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zm1 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>'),
    tv: svg('<rect x="2" y="4" width="20" height="13" rx="2.5"/><rect x="7" y="19" width="10" height="2" rx="1"/>'),
    climate: svg('<path d="M12 2a3 3 0 0 0-3 3v8.3a5 5 0 1 0 6 0V5a3 3 0 0 0-3-3z"/>'),
    sensor: svg('<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
    cover: svg('<rect x="3" y="3" width="18" height="3" rx="1.5"/><rect x="5" y="8" width="14" height="3" rx="1.5"/><rect x="5" y="13" width="14" height="3" rx="1.5"/><rect x="5" y="18" width="14" height="3" rx="1.5"/>'),
    lock: svg('<path fill-rule="evenodd" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2.5 0h5V7a2.5 2.5 0 0 0-5 0v3z"/>'),
    scene: svg('<path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
    play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>'),
    pause: svg('<rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/>'),
    next: svg(NEXT),
    prev: svg('<g transform="translate(24 0) scale(-1 1)">' + NEXT + '</g>'),
    volume: svg(SPEAKER + '<path d="M17 8.5a5 5 0 0 1 0 7"' + STROKE + '/>'),
    muted: svg(SPEAKER + '<path d="M17 9.5l5 5M22 9.5l-5 5"' + STROKE + '/>'),
    note: svg('<path d="M9 18a3 3 0 1 1-2-2.83V5.5a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 3v11.99a3 3 0 1 1-2-2.82V7.28l-8 2V18z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"' + STROKE + '/>'),
    minus: svg('<path d="M5 12h14"' + STROKE + '/>'),
    gear: svg('<path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7c.1.6.1 1.2 0 1.8l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.7a6 6 0 0 1 0-1.8l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9L10.3 2zM12 8.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" transform="translate(0 .5)"/>'),
    pencil: svg('<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"' + STROKE + '/>'),
    cloud: svg('<path d="M7 19a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.47 1.47A3.75 3.75 0 0 1 17.25 19H7z"/>'),
    partly: svg('<circle cx="8.5" cy="8.5" r="3.5"/><path d="M8.5 1.8v1.4M2 8.5h1.4M3.9 3.9l1 1M13.1 3.9l-1 1"' + STROKE + '/><path d="M9 20a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.5 1.3A3.4 3.4 0 0 1 18.6 20H9z"/>'),
    rain: svg('<path d="M7 15a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.47 1.47A3.75 3.75 0 0 1 17.25 15H7z"/><path d="M8 18l-1 3M12.5 18l-1 3M17 18l-1 3"' + STROKE + '/>'),
    snow: svg('<path d="M7 14a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.47 1.47A3.75 3.75 0 0 1 17.25 14H7z"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="12.5" cy="20" r="1.3"/><circle cx="17" cy="18.5" r="1.3"/>'),
    storm: svg('<path d="M7 14a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.47 1.47A3.75 3.75 0 0 1 17.25 14H7z"/><path d="M13 14l-3 5h3l-2 4"' + STROKE + '/>'),
    fog: svg('<path d="M4 8h16M2 12h18M5 16h15M7 20h10"' + STROKE + '/>')
  };
  ICON.fan = ICON['switch'];
  function iconFor(t) {
    if (t.type === 'HueGroup') { return ICON.group; }
    return ICON[t.kind] || ICON['switch'];
  }
  function weatherIcon(text) {
    text = String(text || '').toLowerCase();
    if (/onweer/.test(text)) { return ICON.storm; }
    if (/sneeuw|ijzel|ijsregen/.test(text)) { return ICON.snow; }
    if (/regen|bui|motregen/.test(text)) { return ICON.rain; }
    if (/mist|rijp/.test(text)) { return ICON.fog; }
    if (/half|vrijwel/.test(text)) { return ICON.partly; }
    if (/bewolkt/.test(text)) { return ICON.cloud; }
    return ICON.sun;
  }

  /* -------------------------------------------------------------- xhr */
  function api(method, url, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    function finish(err, data) { if (done) { return; } done = true; if (cb) { cb(err, data); } }
    x.open(method, url, true);
    x.timeout = 10000;
    x.onreadystatechange = function () {
      var data = null;
      if (x.readyState !== 4) { return; }
      try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
      if (x.status >= 200 && x.status < 300 && data) { finish(null, data); } else { finish((data && data.error) || 'Geen verbinding', null); }
    };
    x.ontimeout = function () { finish('Geen antwoord', null); };
    x.onerror = function () { finish('Geen verbinding', null); };
    if (body) { x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); } else { x.send(); }
  }
  function toast(msg, good) {
    var e = $('offline');
    setText(e, msg);
    e.style.background = good ? '#2f7a55' : '';
    addClass(e, 'is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { removeClass(e, 'is-shown'); }, 3000);
  }

  /* ------------------------------------------------------------- tikken */
  /* Eigen tik-afhandeling: geen 300 ms vertraging op iOS 9, en lang indrukken.
     Een tik op een knop binnen een tegel gaat niet ook naar de tegel zelf. */
  function onTap(e, fn, longFn) {
    var sx = 0, sy = 0, moved = false, fired = false, timer = null, mine = false;
    function clear() { clearTimeout(timer); removeClass(e, 'is-down'); }
    e.addEventListener('touchstart', function (ev) {
      var t = ev.touches[0];
      mine = !ev.__tapTaken; ev.__tapTaken = true;
      if (!mine) { return; }
      sx = t.clientX; sy = t.clientY; moved = false; fired = false;
      addClass(e, 'is-down');
      if (longFn) { timer = setTimeout(function () { fired = true; removeClass(e, 'is-down'); longFn(); }, 450); }
    }, false);
    e.addEventListener('touchmove', function (ev) {
      var t = ev.touches[0];
      if (!mine) { return; }
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { moved = true; clear(); }
    }, false);
    e.addEventListener('touchend', function (ev) {
      if (!mine) { return; }
      clear();
      lastTouch = Date.now();
      if (fired) { ev.preventDefault(); return; }
      if (!moved) { ev.preventDefault(); fn(); }
    }, false);
    e.addEventListener('touchcancel', clear, false);
    e.addEventListener('click', function (ev) {
      if (ev.__tapTaken) { return; }
      ev.__tapTaken = true;
      if (Date.now() - lastTouch > 800) { fn(); }
    }, false);
    if (longFn) { e.addEventListener('contextmenu', function (ev) { ev.preventDefault(); if (Date.now() - lastTouch > 800) { longFn(); } }, false); }
  }

  /* ------------------------------------------------------------- slider */
  function Slider(e, onCommit) {
    var self = this;
    this.el = e; this.fill = e.children[0]; this.knob = e.children[1];
    this.value = 0; this.dragging = false; this.holdUntil = 0; this.onCommit = onCommit; this.onInput = null; this.lastSent = 0;
    function at(clientX) { var r = e.getBoundingClientRect(); var v = Math.round((clientX - r.left) / r.width * 100); return v < 0 ? 0 : (v > 100 ? 100 : v); }
    function move(clientX) {
      self.draw(at(clientX));
      if (self.onInput) { self.onInput(self.value); }
      if (Date.now() - self.lastSent > 250) { self.lastSent = Date.now(); self.onCommit(self.value, false); }
    }
    function end() { if (!self.dragging) { return; } self.dragging = false; self.holdUntil = Date.now() + 4000; self.onCommit(self.value, true); }
    e.addEventListener('touchstart', function (ev) { self.dragging = true; ev.preventDefault(); ev.stopPropagation(); move(ev.touches[0].clientX); }, false);
    e.addEventListener('touchmove', function (ev) { if (self.dragging) { ev.preventDefault(); ev.stopPropagation(); move(ev.touches[0].clientX); } }, false);
    e.addEventListener('touchend', function (ev) { ev.preventDefault(); lastTouch = Date.now(); end(); }, false);
    e.addEventListener('touchcancel', end, false);
    e.addEventListener('mousedown', function (ev) {
      if (Date.now() - lastTouch < 800) { return; }
      self.dragging = true; move(ev.clientX);
      function mm(e2) { move(e2.clientX); }
      function mu() { document.removeEventListener('mousemove', mm, false); document.removeEventListener('mouseup', mu, false); end(); }
      document.addEventListener('mousemove', mm, false);
      document.addEventListener('mouseup', mu, false);
    }, false);
  }
  Slider.prototype.draw = function (v) { this.value = v; this.fill.style.width = v + '%'; this.knob.style.left = v + '%'; };
  Slider.prototype.sync = function (v) { if (this.dragging || Date.now() < this.holdUntil) { return; } if (v !== this.value) { this.draw(v); } };

  /* ---------------------------------------------------------- schermen */
  function W() { return window.innerWidth; }
  function trackTo(px, anim) {
    var t = $('track');
    setClass(t, 'anim', anim);
    t.style.webkitTransform = 'translate3d(' + px + 'px,0,0)';
    t.style.transform = 'translate3d(' + px + 'px,0,0)';
  }
  function goFace(n, anim) {
    var dots = $('dots').children, i;
    face = n < 0 ? 0 : (n > faces.length - 1 ? faces.length - 1 : n);
    trackTo(-face * W(), anim !== false);
    for (i = 0; i < dots.length; i++) { setClass(dots[i], 'is-active', i === face); }
    $('edit').style.display = faces[face] && faces[face].key === 'home' ? '' : 'none';
    try { window.localStorage.setItem('hp-face', faces[face] ? faces[face].key : 'home'); } catch (e) { /* privemodus */ }
  }
  function initSwipe() {
    var stage = $('stage');
    var sw = { on: false, lock: null, x: 0, y: 0, dx: 0 };
    stage.addEventListener('touchstart', function (e) {
      sw.on = e.touches.length === 1 && !hasClassUp(e.target, 'slider') && !sheet;
      sw.lock = null; sw.dx = 0; sw.x = e.touches[0].clientX; sw.y = e.touches[0].clientY;
    }, false);
    stage.addEventListener('touchmove', function (e) {
      var dx, dy;
      if (!sw.on) { return; }
      dx = e.touches[0].clientX - sw.x; dy = e.touches[0].clientY - sw.y;
      if (!sw.lock) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { sw.lock = 'h'; } else if (Math.abs(dy) > 10) { sw.lock = 'v'; } }
      if (sw.lock === 'h') {
        e.preventDefault();
        if ((face === 0 && dx > 0) || (face === faces.length - 1 && dx < 0)) { dx = dx / 3; }
        sw.dx = dx;
        trackTo(-face * W() + dx, false);
      }
    }, false);
    function end() {
      if (sw.on && sw.lock === 'h') { if (sw.dx < -70) { goFace(face + 1); } else if (sw.dx > 70) { goFace(face - 1); } else { goFace(face); } }
      sw.on = false;
    }
    stage.addEventListener('touchend', end, false);
    stage.addEventListener('touchcancel', end, false);
    /* Het scherm mag niet meeveren; alleen lijsten met .scroll mogen scrollen. */
    document.addEventListener('touchmove', function (e) {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.className && typeof t.className === 'string' && / scroll /.test(' ' + t.className + ' ') && t.scrollHeight > t.clientHeight && sw.lock !== 'h') { return; }
        t = t.parentNode;
      }
      e.preventDefault();
    }, false);
    window.addEventListener('resize', function () { faceSig = ''; render(); }, false);
    window.addEventListener('orientationchange', function () { setTimeout(function () { faceSig = ''; render(); }, 300); }, false);
    document.addEventListener('keydown', function (e) { if (e.keyCode === 37) { goFace(face - 1); } else if (e.keyCode === 39) { goFace(face + 1); } }, false);
  }

  /* ------------------------------------------------------------- tegels */
  function shown(t) {
    /* Na een tik tonen we meteen de nieuwe stand, tot de server hem bevestigt. */
    var p = pending[t.id], o = { on: t.on, level: t.level, text: t.text }, h = t.kind === 'scene' && t.group && sceneHold[t.group];
    /* Net een scène gekozen in deze kamer: die keuze tonen tot de bridge bij is. */
    if (h && Date.now() < h.until) { o.on = t.id === h.id; o.text = o.on ? 'Actief' : ''; return o; }
    if (!p) { return o; }
    if (Date.now() > p.until || ((p.on === undefined || p.on === t.on) && (p.level === undefined || p.level === t.level))) { delete pending[t.id]; return o; }
    if (p.on !== undefined) { o.on = p.on; }
    if (p.level !== undefined) { o.level = p.level; }
    if (t.kind === 'climate') { o.text = temp(t.cur) + '°' + (Math.abs(o.level - t.cur) >= 0.5 ? ' → ' + temp(o.level) + '°' : ''); }
    else if (t.kind === 'scene') { o.text = o.on ? 'Actief' : ''; }
    else if (t.kind === 'light') { o.text = o.on ? (o.level !== undefined ? o.level + '%' : 'Aan') : 'Uit'; }
    else if (t.kind === 'cover') { o.text = o.on ? 'Open' : 'Dicht'; }
    else if (t.kind === 'lock') { o.text = o.on ? 'Open' : 'Op slot'; }
    else { o.text = o.on ? 'Aan' : 'Uit'; }
    return o;
  }
  function send(t, ch, value, opt) {
    pending[t.id] = { on: opt.on, level: opt.level, until: Date.now() + (opt.wait || 6000) };
    paintAll();
    api('POST', 'api/set', { id: t.id, 'char': ch, value: value }, function (err) {
      if (err) { delete pending[t.id]; paintAll(); toast(err); return; }
      refreshSoon();
    });
  }
  /* Een scène aanzetten zet de andere scènes van dezelfde kamer of zone uit:
     dat tonen we meteen, in plaats van te wachten op de volgende ronde. */
  var sceneHold = {};
  function sceneOn(t) {
    if (!t.group) { send(t, t['char'], true, { on: true }); return; }
    var hold = { id: t.id, until: Date.now() + 8000 };
    sceneHold[t.group] = hold;
    paintAll();
    api('POST', 'api/set', { id: t.id, 'char': t['char'], value: true }, function (err) {
      if (sceneHold[t.group] !== hold) { return; }
      if (err) { delete sceneHold[t.group]; paintAll(); toast(err); return; }
      /* Nog even vasthouden na het antwoord: de bridge meldt de nieuwe scène soms pas later. */
      hold.until = Math.max(hold.until, Date.now() + 3000);
      refreshSoon();
    });
  }
  function refreshSoon() {
    setTimeout(function () {
      api('GET', 'api/state?t=' + Date.now(), null, function (err, data) {
        if (err || !data || (state && data.version !== state.version)) { return; }
        state = data; render();
      });
    }, 700);
  }
  function toggle(t) {
    var cur = shown(t);
    send(t, t['char'], cur.on ? t.offValue : t.onValue, { on: !cur.on, level: t.kind === 'cover' ? (cur.on ? 0 : 100) : undefined });
  }
  function tapDevice(id) {
    var t = tileById[id];
    if (!t || t.readonly) { return; }
    if (t.stepper) { openStep(t); return; }
    if (!t['char']) { return; }
    if (t.kind === 'scene') { sceneOn(t); return; }
    if (t.confirm) { openConfirm(t); } else { toggle(t); }
  }
  function holdDevice(id) {
    var t = tileById[id];
    if (t && t.stepper) { openStep(t); } else if (t && t.levelChar && !t.confirm) { openLevel(t); }
  }
  function subText(t, s, inRoom) {
    var st = t.fault && !pending[t.id] ? 'Geen contact' : (t.kind === 'scene' ? (s.on ? 'Actief' : 'Scène') : s.text);
    if (inRoom || !t.room) { return st; }
    return t.room + (st ? ' · ' + st : '');
  }

  /* Gewone apparaattegel (lamp, groep, schakelaar, scène, sensor). */
  function makeDevice(id, size, inRoom) {
    var e = el('div', 'tile s-' + size, '<div class="t-icon"></div><div class="t-name"></div><div class="t-sub"></div>');
    var iconKind = '';
    onTap(e, function () { tapDevice(id); }, function () { holdDevice(id); });
    bound.push({ el: e, paint: function () {
      var t = tileById[id], s, k;
      if (!t) { e.className = 'tile t-missing s-' + size + (e.getAttribute('data-end') ? ' endrow' : ''); setText(e.children[1], 'Niet gevonden'); setText(e.children[2], 'Pas het beginscherm aan'); return; }
      s = shown(t);
      e.className = 'tile s-' + size + ' k-' + t.kind + (s.on ? ' is-on' : '') + (t.fault && !pending[t.id] ? ' is-fault' : '') + (e.getAttribute('data-end') ? ' endrow' : '');
      k = t.type === 'HueGroup' ? 'group' : t.kind;
      if (k !== iconKind) { iconKind = k; e.children[0].innerHTML = iconFor(t); }
      setText(e.children[1], t.name === 'Alle lampen' && !inRoom && t.room ? t.room : t.name);
      if (t.kind === 'scene' && !inRoom) { setText(e.children[2], (t.room || 'Scène') + (s.on ? ' · actief' : '')); return; }
      setText(e.children[2], t.name === 'Alle lampen' && !inRoom ? 'Alle lampen · ' + (t.fault ? 'Geen contact' : s.text) : subText(t, s, inRoom));
    } });
    return e;
  }

  /* Thermostaat: groot met - en +, of klein (tik opent de stapjes). */
  function makeThermo(id, size) {
    var big = size === '2x2' || size === '1x2';
    var e = el('div', 'tile big-thermo s-' + size + (big ? '' : ' th-small'),
      '<div class="th-num"></div><div class="th-label"></div><div class="th-sub"></div>' +
      (big ? '<div class="th-btn th-minus">' + ICON.minus + '</div><div class="th-btn th-plus">' + ICON.plus + '</div>' : ''));
    var local = null, timer = null;
    function shownTarget(t) { return local !== null ? local : shown(t).level; }
    function bump(dir) {
      var t = tileById[id], v;
      if (!t || !t.stepper) { return; }
      v = Math.round((shownTarget(t) + dir * t.step) / t.step) * t.step;
      local = v < t.min ? t.min : (v > t.max ? t.max : v);
      paint();
      clearTimeout(timer);
      timer = setTimeout(function () { var v2 = local; local = null; send(t, t.levelChar, v2, { level: v2, wait: 30000 }); }, 1200);
    }
    function paint() {
      var t = tileById[id], target;
      if (!t) { e.children[0].innerHTML = '–'; setText(e.children[1], 'Niet gevonden'); return; }
      target = shownTarget(t);
      e.children[0].innerHTML = esc(temp(big ? target : t.cur)) + '<small>°</small>';
      setText(e.children[1], t.name === t.room || !t.room ? 'Thermostaat' : t.name);
      setText(e.children[2], big ? ((t.room ? t.room + ' · ' : '') + 'nu ' + temp(t.cur) + '°') : (typeof target === 'number' && Math.abs(target - t.cur) >= 0.5 ? 'naar ' + temp(target) + '°' : (t.room || '')));
    }
    if (big) {
      onTap(e.children[3], function () { bump(-1); });
      onTap(e.children[4], function () { bump(1); });
    } else {
      onTap(e, function () { tapDevice(id); });
    }
    bound.push({ el: e, paint: paint });
    return e;
  }

  function makeClock(variant, size) {
    var e = el('div', 'tile k-clock s-' + size);
    var d = Math.min(cellPx(size).w, cellPx(size).h) - 34;
    var hands = null, i, ticks = '';
    if (variant === 'digital') {
      e.innerHTML = '<div class="clock-digital"><div class="cd-time"></div><div class="cd-date"></div></div>';
      clocks.push(function (now) {
        setText(e.children[0].children[0], two(now.getHours()) + ':' + two(now.getMinutes()));
        setText(e.children[0].children[1], DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
      });
    } else {
      for (i = 0; i < 12; i++) {
        ticks += '<line x1="50" y1="' + (i % 3 === 0 ? 6 : 8) + '" x2="50" y2="' + (i % 3 === 0 ? 17 : 14) + '" stroke="currentColor" stroke-width="' + (i % 3 === 0 ? 3.4 : 2.4) + '" stroke-linecap="round" transform="rotate(' + (i * 30) + ' 50 50)"/>';
      }
      e.innerHTML = '<svg class="clock-svg" viewBox="0 0 100 100" width="' + d + '" height="' + d + '" style="margin:' + (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px">' + ticks +
        '<line x1="50" y1="50" x2="50" y2="27" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>' +
        '<line x1="50" y1="50" x2="50" y2="15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
        '<line x1="50" y1="56" x2="50" y2="13" stroke="#e8792c" stroke-width="1.4" stroke-linecap="round"/>' +
        '<circle cx="50" cy="50" r="3.2" fill="currentColor"/></svg>';
      hands = e.getElementsByTagName('line');
      clocks.push(function (now) {
        var n = hands.length, h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
        hands[n - 3].setAttribute('transform', 'rotate(' + (h * 30 + m / 2) + ' 50 50)');
        hands[n - 2].setAttribute('transform', 'rotate(' + (m * 6 + s / 10) + ' 50 50)');
        hands[n - 1].setAttribute('transform', 'rotate(' + (s * 6) + ' 50 50)');
      });
    }
    return e;
  }

  function makeWeather(size) {
    var e = el('div', 'tile k-weather s-' + size, '<div class="wx-icon"></div><div class="wx-temp"></div><div class="wx-text"></div><div class="wx-sub"></div>');
    var last = null;
    bound.push({ el: e, paint: function () {
      var w = state && state.weather;
      if (!w) { if (last !== '') { last = ''; e.children[0].innerHTML = ICON.partly; } setText(e.children[2], 'Weer'); setText(e.children[3], 'Stel een plaats in bij Instellingen'); return; }
      if (w.text !== last) { last = w.text; e.children[0].innerHTML = weatherIcon(w.text); }
      setText(e.children[1], w.temp + '°');
      setText(e.children[2], w.text);
      setText(e.children[3], (w.min !== null ? w.min + '° / ' + w.max + '°' : '') + (size !== '1x1' && w.sunset ? '  ·  zon onder ' + w.sunset : ''));
    } });
    return e;
  }

  function makeNowPlaying(size) {
    var e = el('div', 'tile k-np s-' + size, '<div class="np-art"></div><div class="np-noart">' + ICON.note + '</div><div class="np-shade"></div><div class="np-title"></div><div class="np-artist"></div><div class="np-btn"></div>');
    var lastArt = null, lastP = null;
    onTap(e.children[5], togglePlay);
    onTap(e, function () { goFace(0); });
    bound.push({ el: e, paint: function () {
      var s = state && state.sonos, p, url;
      if (!s || !s.ok) { setText(e.children[3], 'Sonos'); setText(e.children[4], s && s.error ? 'Niet bereikbaar' : ''); e.children[5].style.display = 'none'; return; }
      e.children[5].style.display = '';
      p = isPlaying();
      if (p !== lastP) { lastP = p; e.children[5].innerHTML = p ? ICON.pause : ICON.play; }
      url = s.art || '';
      if (url !== lastArt) { lastArt = url; e.children[0].style.backgroundImage = url ? 'url("' + url + '")' : 'none'; e.children[1].style.display = url ? 'none' : ''; }
      setText(e.children[3], s.title || 'Niets aan het spelen');
      setText(e.children[4], s.artist || s.room || '');
    } });
    return e;
  }

  /* ------------------------------------------------------- beginscherm */
  function grid() { return (state && state.layout && state.layout.grid) || { cols: 4, rows: 3 }; }
  function cellPx(size) {
    var g = grid(), w = W(), h = window.innerHeight;
    var cw = (w - 56 - GAP * (g.cols - 1)) / g.cols, ch = (h - 28 - 60 - GAP * (g.rows - 1)) / g.rows;
    var sw = size ? Number(size.charAt(0)) : 1, sh = size ? (size.charAt(2) === 'h' ? 0.5 : Number(size.charAt(2))) : 1;
    return { w: cw * sw + GAP * (sw - 1), h: ch * sh + GAP * (sh - 1), cw: cw, ch: ch };
  }
  function buildHome() {
    var f = el('div', 'face face-home');
    var tiles = (state.layout && state.layout.home) || [];
    var c = cellPx('1x1');
    tiles.forEach(function (t) {
      var size = t.w + 'x' + (t.h === 0.5 ? 'h' : t.h), e, dev, p = cellPx(size);
      if (t.type === 'clock') { e = makeClock(t.variant, size); }
      else if (t.type === 'weather') { e = makeWeather(size); }
      else if (t.type === 'nowplaying') { e = makeNowPlaying(size); }
      else {
        dev = tileById[t.ref];
        e = dev && dev.kind === 'climate' && dev.stepper ? makeThermo(t.ref, size) : makeDevice(t.ref, size, false);
      }
      e.style.left = Math.round(28 + t.x * (c.cw + GAP)) + 'px';
      e.style.top = Math.round(28 + t.y * (c.ch + GAP)) + 'px';
      e.style.width = Math.round(p.w) + 'px';
      e.style.height = Math.round(p.h) + 'px';
      f.appendChild(e);
    });
    return f;
  }

  /* ------------------------------------------------------- kamerscherm */
  function roomByKey(key) {
    var i, rs = (state && state.rooms) || [];
    for (i = 0; i < rs.length; i++) { if (rs[i].key === key) { return rs[i]; } }
    return null;
  }
  function buildRoom(room) {
    var f = el('div', 'face face-room', '<div class="room-title"></div><div class="room-count"></div><div class="room-tiles scroll"></div>');
    setText(f.children[0], room.name);
    bound.push({ el: f, paint: function () {
      var r = roomByKey(room.key), on = 0;
      if (!r) { return; }
      r.tiles.forEach(function (t) { if (t.kind === 'light' && t.type !== 'HueGroup' && shown(t).on) { on++; } });
      setText(f.children[1], on ? on + (on === 1 ? ' lamp aan' : ' lampen aan') : 'Alles uit');
    } });
    /* Scènes bovenaan als rij halve knoppen, daarna de rest. */
    var box = f.children[2], n = 0, scenes = room.tiles.filter(function (t) { return t.kind === 'scene'; });
    scenes.forEach(function (t, i) {
      var e = makeDevice(t.id, '1xh', true);
      if (i % 5 === 4) { e.className += ' endrow'; e.setAttribute('data-end', '1'); }
      box.appendChild(e);
    });
    if (scenes.length) { box.appendChild(el('div', 'rowbreak')); }
    room.tiles.forEach(function (t) {
      if (t.kind === 'scene') { return; }
      var e = t.kind === 'climate' && t.stepper ? makeThermo(t.id, '1x1') : makeDevice(t.id, '1x1', true);
      if (n++ % 5 === 4) { e.className += ' endrow'; e.setAttribute('data-end', '1'); }
      box.appendChild(e);
    });
    return f;
  }

  /* -------------------------------------------------------- klokscherm */
  function buildClockFace() {
    var f = el('div', 'face face-clock', '<div class="fc-time"></div><div class="fc-date"></div><div class="fc-wx"></div>');
    clocks.push(function (now) {
      setText(f.children[0], two(now.getHours()) + ':' + two(now.getMinutes()));
      setText(f.children[1], DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
    });
    bound.push({ el: f, paint: function () {
      var w = state && state.weather;
      setText(f.children[2], w ? w.temp + '° ' + String(w.text).toLowerCase() + (w.sunset ? ' · zon onder ' + w.sunset : '') : '');
    } });
    return f;
  }

  /* ----------------------------------------------------------- muziek */
  var volSlider = null, sonosHold = 0, sonosHoldPlaying = false, muEls = null, favSig = '';
  function isPlaying() {
    var s = state && state.sonos;
    if (Date.now() < sonosHold) { return sonosHoldPlaying; }
    return !!(s && s.state === 'playing');
  }
  function sonosCmd(action, value) { api('POST', 'api/sonos', { action: action, value: value }, function (err) { if (err) { toast(err); } }); }
  function togglePlay() {
    var s = state && state.sonos;
    if (!s || !s.ok) { return; }
    sonosHoldPlaying = !isPlaying();
    sonosHold = Date.now() + 4000;
    sonosCmd(sonosHoldPlaying ? 'play' : 'pause');
    paintAll();
  }
  function buildMusic() {
    var f = el('div', 'face face-music',
      '<div class="mu-left"><div class="mu-art"><div class="np-noart">' + ICON.note + '</div></div><div class="mu-title"></div><div class="mu-artist"></div>' +
      '<div class="mu-ctrl"><div class="mu-btn mu-prev">' + ICON.prev + '</div><div class="mu-btn mu-play"></div><div class="mu-btn mu-next">' + ICON.next + '</div></div>' +
      '<div class="mu-vol"><div class="mu-mute"></div><div class="slider"><div class="slider-fill"></div><div class="slider-knob"></div></div><div class="mu-volnum"></div></div></div>' +
      '<div class="mu-right"><div class="mu-head">Favorieten</div><div class="mu-room"></div><div class="mu-favs scroll"></div></div>');
    var q = function (c) { return f.getElementsByClassName(c)[0]; };
    muEls = { art: q('mu-art'), title: q('mu-title'), artist: q('mu-artist'), play: q('mu-play'), prev: q('mu-prev'), next: q('mu-next'),
      mute: q('mu-mute'), volnum: q('mu-volnum'), room: q('mu-room'), favs: q('mu-favs'), lastArt: null, lastP: null, lastMute: null };
    muEls.noart = muEls.art.children[0];
    favSig = '';
    volSlider = new Slider(f.getElementsByClassName('slider')[0], function (v) { sonosCmd('volume', v); });
    volSlider.onInput = function (v) { setText(muEls.volnum, v); };
    onTap(muEls.play, togglePlay);
    onTap(muEls.prev, function () { if (state && state.sonos && state.sonos.canSkip) { sonosCmd('prev'); } });
    onTap(muEls.next, function () { if (state && state.sonos && state.sonos.canSkip) { sonosCmd('next'); } });
    onTap(muEls.mute, function () {
      var s = state && state.sonos;
      if (!s || !s.ok) { return; }
      s.mute = !s.mute; sonosCmd('mute', s.mute); paintAll();
    });
    bound.push({ el: f, paint: paintMusic });
    return f;
  }
  function paintMusic() {
    var s = state && state.sonos, m = muEls, p, url;
    if (!m) { return; }
    if (!s || !s.ok) {
      setText(m.title, s ? 'Sonos niet bereikbaar' : 'Sonos staat uit');
      setText(m.artist, s && s.error ? s.error : '');
    } else {
      p = isPlaying();
      if (p !== m.lastP) { m.lastP = p; m.play.innerHTML = p ? ICON.pause : ICON.play; }
      url = s.art || '';
      if (url !== m.lastArt) { m.lastArt = url; m.art.style.backgroundImage = url ? 'url("' + url + '")' : 'none'; m.noart.style.display = url ? 'none' : ''; }
      setText(m.title, s.title || (s.source === 'none' ? 'Niets in de wachtrij' : 'Onbekend nummer'));
      setText(m.artist, (s.artist || (s.source === 'tv' ? 'Geluid van de televisie' : '')) + (s.album && s.artist ? ' · ' + s.album : ''));
      setClass(m.prev, 'is-disabled', !s.canSkip);
      setClass(m.next, 'is-disabled', !s.canSkip);
      volSlider.sync(s.volume);
      setText(m.volnum, volSlider.value);
      if (m.lastMute !== !!s.mute) { m.lastMute = !!s.mute; m.mute.innerHTML = s.mute ? ICON.muted : ICON.volume; }
      setText(m.room, s.room || '');
    }
    paintFavs();
  }
  function paintFavs() {
    var list = (state && state.favorites) || null, sig, box = muEls.favs;
    sig = list ? list.map(function (x) { return x.id + x.art; }).join('|') : 'x';
    if (sig !== favSig) {
      favSig = sig;
      box.innerHTML = '';
      if (!list || !list.length) {
        box.appendChild(el('div', 'mu-empty', list ? 'Nog geen favorieten. Bewaar in de Sonos-app playlists, albums of zenders als favoriet (bijvoorbeeld uit Apple Music of Sonos Radio); ze verschijnen dan hier.' : 'Favorieten zijn nu niet op te halen.'));
      }
      (list || []).forEach(function (x) {
        var e = el('div', 'fav', '<div class="fav-art">' + (x.art ? '' : '<div class="np-noart">' + ICON.note + '</div>') + '</div><div class="fav-title"></div><div class="fav-desc"></div>');
        if (x.art) { e.children[0].style.backgroundImage = 'url("' + x.art + '")'; }
        setText(e.children[1], x.title);
        setText(e.children[2], x.desc || '');
        e.setAttribute('data-id', x.id);
        onTap(e, function () {
          favPlaying = x.id;
          sonosHoldPlaying = true; sonosHold = Date.now() + 5000;
          toast('Speelt: ' + x.title, true);
          paintAll();
          api('POST', 'api/sonos', { action: 'favorite', value: x.id }, function (err) { if (err) { favPlaying = null; toast(err); } });
        });
        box.appendChild(e);
      });
    }
    Array.prototype.forEach.call(box.children, function (e) { setClass(e, 'is-playing', !!favPlaying && e.getAttribute('data-id') === favPlaying && isPlaying()); });
  }

  /* ----------------------------------------------------------- overlay */
  var sheetSlider = null, ctSlider = null;
  function closeSheet() { sheet = null; removeClass($('sheet'), 'is-shown'); }
  function setMode(mode, ct) {
    setClass($('sheet'), 'mode-step', mode === 'step');
    setClass($('sheet'), 'no-slider', mode === 'confirm');
    setClass($('sheet'), 'has-ct', !!ct);
  }
  function openStep(t) {
    var cur = shown(t);
    sheet = { t: t, mode: 'step', value: typeof cur.level === 'number' ? cur.level : t.cur };
    setMode('step');
    setText($('sheet-title'), t.name);
    setText($('sheet-value'), 'Nu ' + temp(t.cur) + '°. Doeltemperatuur:');
    setText($('sheet-no'), 'Sluiten'); setText($('sheet-yes'), 'Instellen');
    setText($('step-val'), temp(sheet.value) + '°');
    addClass($('sheet'), 'is-shown');
  }
  function step(dir) {
    var t, v;
    if (!sheet || sheet.mode !== 'step') { return; }
    t = sheet.t;
    v = Math.round((sheet.value + dir * t.step) / t.step) * t.step;
    sheet.value = v < t.min ? t.min : (v > t.max ? t.max : v);
    setText($('step-val'), temp(sheet.value) + '°');
  }
  function openLevel(t) {
    var cur = shown(t), ct = !!t.ctChar && typeof t.ct === 'number';
    sheet = { t: t, mode: 'level' };
    setMode('level', ct);
    if (ct) { ctSlider.holdUntil = 0; ctSlider.draw(t.ct); }
    setText($('sheet-title'), t.name); setText($('sheet-no'), 'Sluiten');
    sheetSlider.holdUntil = 0;
    sheetSlider.draw(cur.on ? (cur.level || 0) : 0);
    paintSheet();
    addClass($('sheet'), 'is-shown');
  }
  function openConfirm(t) {
    var cur = shown(t);
    sheet = { t: t, mode: 'confirm' };
    setMode('confirm');
    setText($('sheet-title'), t.name);
    setText($('sheet-value'), 'Nu: ' + cur.text.toLowerCase() + '. Weet je het zeker?');
    setText($('sheet-no'), 'Annuleren'); setText($('sheet-yes'), cur.on ? 'Sluiten' : 'Openen');
    addClass($('sheet'), 'is-shown');
  }
  function paintSheet() {
    var cur;
    if (!sheet || sheet.mode !== 'level') { return; }
    cur = shown(sheet.t);
    setText($('sheet-value'), sheet.t.kind === 'cover' ? sheetSlider.value + '% open' : (sheetSlider.value > 0 ? sheetSlider.value + '%' : 'Uit'));
    setText($('sheet-yes'), sheet.t.kind === 'cover' ? (cur.on ? 'Dicht' : 'Open') : (cur.on ? 'Uit' : 'Aan'));
  }
  function initSheet() {
    sheetSlider = new Slider($('sheet-slider'), function (v, final) {
      var t = sheet && sheet.t;
      if (!t) { return; }
      if (t.kind === 'light' && v === 0) {
        if (final) { send(t, t['char'], t.offValue, { on: false }); }
      } else {
        send(t, t.levelChar, v, { on: v > 0, level: v });
        if (final && t.kind === 'light' && !t.on) { api('POST', 'api/set', { id: t.id, 'char': t['char'], value: t.onValue }, null); }
      }
      paintSheet();
    });
    sheetSlider.onInput = paintSheet;
    ctSlider = new Slider($('sheet-ct'), function (v) {
      var t = sheet && sheet.t;
      if (!t || !t.ctChar) { return; }
      api('POST', 'api/set', { id: t.id, 'char': t.ctChar, value: v }, function (err) { if (err) { toast(err); } });
    });
    onTap($('sheet-no'), closeSheet);
    onTap($('sheet-yes'), function () {
      if (!sheet) { return; }
      if (sheet.mode === 'step') { send(sheet.t, sheet.t.levelChar, sheet.value, { level: sheet.value, wait: 30000 }); }
      else { toggle(sheet.t); }
      closeSheet();
    });
    onTap($('step-minus'), function () { step(-1); });
    onTap($('step-plus'), function () { step(1); });
    $('sheet').addEventListener('touchend', function (e) { if (e.target === $('sheet')) { e.preventDefault(); lastTouch = Date.now(); closeSheet(); } }, false);
    $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet') && Date.now() - lastTouch > 800) { closeSheet(); } }, false);
  }

  /* ------------------------------------------------------------ render */
  /* Donker: altijd, of automatisch tussen twee tijden (ook over middernacht heen). */
  function mins(hhmm) { var p = String(hhmm || '').split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function isDark(l) {
    var now, a, b;
    if (!l || l.mode === 'dark') { return !!l; }
    if (l.mode !== 'auto') { return false; }
    now = new Date(); now = now.getHours() * 60 + now.getMinutes();
    a = mins(l.darkFrom); b = mins(l.darkTo);
    return a < b ? (now >= a && now < b) : (now >= a || now < b);
  }
  function applyTheme() {
    var th = (state.layout && state.layout.theme) || 'warm';
    var cls = 'theme-' + th + (isDark(state.layout) ? ' mode-dark' : '');
    if (document.body.className !== cls) { document.body.className = cls; }
    if (th === 'eigen' && state.bg && $('bgimg').style.backgroundImage.indexOf('v=' + state.bg) === -1) {
      $('bgimg').style.backgroundImage = 'url("bg?v=' + state.bg + '")';
    }
  }
  function screensOn() { return ((state.layout && state.layout.screens) || []).filter(function (s) { return s.on; }); }
  function buildFaces() {
    var track = $('track'), dots = $('dots'), wanted = 1, i, keyNow;
    keyNow = faces[face] ? faces[face].key : null;
    if (!keyNow) { try { keyNow = window.localStorage.getItem('hp-face'); } catch (e) { keyNow = null; } }
    bound = []; clocks = [];
    track.innerHTML = ''; dots.innerHTML = '';
    faces = [{ key: 'music', el: buildMusic() }, { key: 'home', el: buildHome() }];
    screensOn().forEach(function (s) {
      var r;
      if (s.key === 'clock') { faces.push({ key: 'clock', el: buildClockFace() }); return; }
      r = roomByKey(s.key);
      if (r && r.tiles.length) { faces.push({ key: s.key, el: buildRoom(r) }); }
    });
    track.style.width = (faces.length * W()) + 'px';
    faces.forEach(function (f, n) {
      f.el.style.width = W() + 'px';
      track.appendChild(f.el);
      dots.appendChild(el('span', 'dot' + (n === 0 ? ' is-music' : '')));
    });
    for (i = 0; i < faces.length; i++) { if (faces[i].key === keyNow) { wanted = i; } }
    goFace(wanted, false);
    tickClocks();
  }
  function signature() {
    var l = state.layout || {}, rs = (state.rooms || []).map(function (r) { return r.key + ':' + r.tiles.map(function (t) { return t.id + t.kind; }).join(','); });
    return W() + 'x' + window.innerHeight + '|' + JSON.stringify(l.home) + '|' + JSON.stringify(screensOn()) + '|' + rs.join(';');
  }
  function paintAll() {
    var i;
    for (i = 0; i < bound.length; i++) { bound[i].paint(); }
    paintSheet();
  }
  function render() {
    var sig;
    if (!state) { return; }
    tileById = {};
    (state.rooms || []).forEach(function (r) { r.tiles.forEach(function (t) { if (!tileById[t.id]) { tileById[t.id] = t; } }); });
    applyTheme();
    sig = signature();
    if (sig !== faceSig) { faceSig = sig; buildFaces(); }
    paintAll();
  }
  function tickClocks() {
    var now = new Date(), i;
    for (i = 0; i < clocks.length; i++) { clocks[i](now); }
  }
  function tick() {
    var d = new Date();
    tickClocks();
    if (state && d.getSeconds() === 0) { applyTheme(); }
    /* Eens per etmaal herladen (rond 04:00) houdt een oude iPad fris. */
    if (d.getHours() === 4 && Date.now() - startedAt > 6 * 3600 * 1000 && !sheet) { window.location.reload(); }
  }
  function poll() {
    if (document.hidden) { setTimeout(poll, POLL_MS); return; }
    api('GET', 'api/state?t=' + Date.now(), null, function (err, data) {
      if (err || !data) {
        if (Date.now() - lastOk > 12000) { toast('Geen verbinding met het paneel'); }
        setTimeout(poll, 5000);
        return;
      }
      lastOk = Date.now();
      /* Na een update op de Pi: de pagina zelf ook vernieuwen. */
      if (state && state.version && data.version && data.version !== state.version && !sheet) { window.location.reload(); return; }
      state = data;
      render();
      setTimeout(poll, POLL_MS);
    });
  }

  function start() {
    $('gear').innerHTML = ICON.gear;
    $('edit').innerHTML = ICON.pencil;
    onTap($('gear'), function () { window.location.href = 'setup'; });
    onTap($('edit'), function () { window.location.href = 'editor?terug=paneel'; });
    initSwipe();
    initSheet();
    setInterval(tick, 1000);
    lastOk = Date.now();
    poll();
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, false); } else { start(); }
}());
