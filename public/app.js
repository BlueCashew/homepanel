/* Huispaneel - frontend.
   Alleen ES5 en XMLHttpRequest, zodat het draait in Safari op iOS 9 (iPad mini 1). */
(function () {
  'use strict';

  var DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  var FACES = 3;
  var POLL_MS = 3000;

  var state = null;
  var face = 0;
  var roomName = null;
  var layoutSig = '';
  var tileEls = {};
  var tileData = {};
  var pending = {};
  var lastOk = 0;
  var lastTouch = 0;
  var startedAt = Date.now();
  var artUrl = null;
  var sheet = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function addClass(el, c) { if ((' ' + el.className + ' ').indexOf(' ' + c + ' ') === -1) { el.className = (el.className + ' ' + c).replace(/^\s+/, ''); } }
  function removeClass(el, c) { el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  function setClass(el, c, on) { if (on) { addClass(el, c); } else { removeClass(el, c); } }
  function setText(el, t) { t = t === undefined || t === null ? '' : String(t); if (el.textContent !== t) { el.textContent = t; } }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function temp(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
  function hasClassUp(el, c) {
    while (el && el !== document.body) {
      if (el.className && typeof el.className === 'string' && (' ' + el.className + ' ').indexOf(' ' + c + ' ') !== -1) { return true; }
      el = el.parentNode;
    }
    return false;
  }

  /* ------------------------------------------------------------ iconen */
  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'; }
  var STROKE = ' fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"';
  var NEXT = '<path d="M4 5v14a1 1 0 0 0 1.55.83L15 13.6V19a1.5 1.5 0 0 0 3 0V5a1.5 1.5 0 0 0-3 0v5.4L5.55 4.17A1 1 0 0 0 4 5z"/>';
  var SPEAKER = '<path d="M3 9.5v5a1 1 0 0 0 1 1h3.5l4.8 4a1 1 0 0 0 1.7-.77V5.27a1 1 0 0 0-1.7-.77l-4.8 4H4a1 1 0 0 0-1 1z"/>';
  var ICON = {
    light: svg('<path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/><rect x="9" y="19.5" width="6" height="2.5" rx="1.2"/>'),
    'switch': svg('<path d="M12 3v8"' + STROKE + '/><path d="M7 6.5a8 8 0 1 0 10 0"' + STROKE + '/>'),
    outlet: svg('<path fill-rule="evenodd" d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zm1 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>'),
    tv: svg('<rect x="2" y="4" width="20" height="13" rx="2.5"/><rect x="7" y="19" width="10" height="2" rx="1"/>'),
    climate: svg('<path d="M12 2a3 3 0 0 0-3 3v8.3a5 5 0 1 0 6 0V5a3 3 0 0 0-3-3z"/>'),
    sensor: svg('<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
    cover: svg('<rect x="3" y="3" width="18" height="3" rx="1.5"/><rect x="5" y="8" width="14" height="3" rx="1.5"/><rect x="5" y="13" width="14" height="3" rx="1.5"/><rect x="5" y="18" width="14" height="3" rx="1.5"/>'),
    lock: svg('<path fill-rule="evenodd" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2.5 0h5V7a2.5 2.5 0 0 0-5 0v3z"/>'),
    play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>'),
    pause: svg('<rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/>'),
    next: svg(NEXT),
    prev: svg('<g transform="translate(24 0) scale(-1 1)">' + NEXT + '</g>'),
    volume: svg(SPEAKER + '<path d="M17 8.5a5 5 0 0 1 0 7"' + STROKE + '/>'),
    muted: svg(SPEAKER + '<path d="M17 9.5l5 5M22 9.5l-5 5"' + STROKE + '/>'),
    note: svg('<path d="M9 18a3 3 0 1 1-2-2.83V5.5a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 3v11.99a3 3 0 1 1-2-2.82V7.28l-8 2V18z"/>')
  };
  ICON.fan = ICON['switch'];
  ICON.scene = svg('<path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>');

  /* -------------------------------------------------------------- xhr */
  function api(method, url, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    function finish(err, data) { if (done) { return; } done = true; if (cb) { cb(err, data); } }
    x.open(method, url, true);
    x.timeout = 8000;
    x.onreadystatechange = function () {
      var data = null;
      if (x.readyState !== 4) { return; }
      try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
      if (x.status >= 200 && x.status < 300 && data) { finish(null, data); } else { finish((data && data.error) || 'Geen verbinding', null); }
    };
    x.ontimeout = function () { finish('Geen antwoord', null); };
    x.onerror = function () { finish('Geen verbinding', null); };
    if (body) {
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(body));
    } else {
      x.send();
    }
  }

  function toast(msg) {
    var el = $('offline');
    setText(el, msg);
    addClass(el, 'is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { removeClass(el, 'is-shown'); }, 3500);
  }

  /* ------------------------------------------------------------- tikken */
  /* Eigen tik-afhandeling: voorkomt de 300 ms vertraging van iOS 9 en geeft lang indrukken. */
  function onTap(el, fn, longFn) {
    var sx = 0, sy = 0, moved = false, fired = false, timer = null;
    function clear() { clearTimeout(timer); removeClass(el, 'is-down'); }
    el.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; moved = false; fired = false;
      addClass(el, 'is-down');
      if (longFn) { timer = setTimeout(function () { fired = true; removeClass(el, 'is-down'); longFn(); }, 450); }
    }, false);
    el.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { moved = true; clear(); }
    }, false);
    el.addEventListener('touchend', function (e) {
      clear();
      lastTouch = Date.now();
      if (fired) { e.preventDefault(); return; }
      if (!moved) { e.preventDefault(); fn(); }
    }, false);
    el.addEventListener('touchcancel', clear, false);
    el.addEventListener('click', function () { if (Date.now() - lastTouch > 800) { fn(); } }, false);
    if (longFn) {
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); if (Date.now() - lastTouch > 800) { longFn(); } }, false);
    }
  }

  /* ------------------------------------------------------------- slider */
  function Slider(el, onCommit) {
    var self = this;
    this.el = el;
    this.fill = el.children[0];
    this.knob = el.children[1];
    this.value = 0;
    this.dragging = false;
    this.holdUntil = 0;
    this.onCommit = onCommit;
    this.onInput = null;
    this.lastSent = 0;
    function at(clientX) {
      var r = el.getBoundingClientRect();
      var v = Math.round((clientX - r.left) / r.width * 100);
      return v < 0 ? 0 : (v > 100 ? 100 : v);
    }
    function move(clientX) {
      self.draw(at(clientX));
      if (self.onInput) { self.onInput(self.value); }
      if (Date.now() - self.lastSent > 250) { self.lastSent = Date.now(); self.onCommit(self.value, false); }
    }
    function end() {
      if (!self.dragging) { return; }
      self.dragging = false;
      self.holdUntil = Date.now() + 4000;
      self.onCommit(self.value, true);
    }
    el.addEventListener('touchstart', function (e) { self.dragging = true; e.preventDefault(); e.stopPropagation(); move(e.touches[0].clientX); }, false);
    el.addEventListener('touchmove', function (e) { if (self.dragging) { e.preventDefault(); e.stopPropagation(); move(e.touches[0].clientX); } }, false);
    el.addEventListener('touchend', function (e) { e.preventDefault(); lastTouch = Date.now(); end(); }, false);
    el.addEventListener('touchcancel', end, false);
    el.addEventListener('mousedown', function (e) {
      if (Date.now() - lastTouch < 800) { return; }
      self.dragging = true; move(e.clientX);
      function mm(ev) { move(ev.clientX); }
      function mu() { document.removeEventListener('mousemove', mm, false); document.removeEventListener('mouseup', mu, false); end(); }
      document.addEventListener('mousemove', mm, false);
      document.addEventListener('mouseup', mu, false);
    }, false);
  }
  Slider.prototype.draw = function (v) {
    this.value = v;
    this.fill.style.width = v + '%';
    this.knob.style.left = v + '%';
  };
  /* Waarde van de server overnemen, behalve tijdens en vlak na slepen. */
  Slider.prototype.sync = function (v) {
    if (this.dragging || Date.now() < this.holdUntil) { return; }
    if (v !== this.value) { this.draw(v); }
  };

  /* ---------------------------------------------------------- schermen */
  function trackTo(px, anim) {
    var t = $('track');
    setClass(t, 'anim', anim);
    t.style.webkitTransform = 'translate3d(' + px + 'px,0,0)';
    t.style.transform = 'translate3d(' + px + 'px,0,0)';
  }
  function goFace(n, anim) {
    var dots = $('dots').children, i;
    face = n < 0 ? 0 : (n > FACES - 1 ? FACES - 1 : n);
    trackTo(-face * window.innerWidth, anim !== false);
    for (i = 0; i < dots.length; i++) { setClass(dots[i], 'is-active', i === face); }
    try { window.localStorage.setItem('hp-face', String(face)); } catch (e) { /* privemodus */ }
  }
  function initSwipe() {
    var stage = $('stage');
    var sw = { on: false, lock: null, x: 0, y: 0, dx: 0 };
    var i, d;
    for (i = 0; i < FACES; i++) {
      d = document.createElement('span');
      d.className = 'dot';
      $('dots').appendChild(d);
    }
    stage.addEventListener('touchstart', function (e) {
      sw.on = e.touches.length === 1 && !hasClassUp(e.target, 'slider');
      sw.lock = null; sw.dx = 0;
      sw.x = e.touches[0].clientX; sw.y = e.touches[0].clientY;
    }, false);
    stage.addEventListener('touchmove', function (e) {
      var dx, dy, w = window.innerWidth;
      if (!sw.on) { return; }
      dx = e.touches[0].clientX - sw.x; dy = e.touches[0].clientY - sw.y;
      if (!sw.lock) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { sw.lock = 'h'; } else if (Math.abs(dy) > 10) { sw.lock = 'v'; }
      }
      if (sw.lock === 'h') {
        e.preventDefault();
        if ((face === 0 && dx > 0) || (face === FACES - 1 && dx < 0)) { dx = dx / 3; }
        sw.dx = dx;
        trackTo(-face * w + dx, false);
      }
    }, false);
    function end() {
      if (sw.on && sw.lock === 'h') {
        if (sw.dx < -70) { goFace(face + 1); } else if (sw.dx > 70) { goFace(face - 1); } else { goFace(face); }
      }
      sw.on = false;
    }
    stage.addEventListener('touchend', end, false);
    stage.addEventListener('touchcancel', end, false);

    /* Het hele scherm mag niet meeveren; alleen de tegellijst mag scrollen. */
    document.addEventListener('touchmove', function (e) {
      var tiles = $('tiles');
      if (sw.lock !== 'h' && hasClassUp(e.target, 'tiles') && tiles.scrollHeight > tiles.clientHeight) { return; }
      e.preventDefault();
    }, false);

    onTap($('dots'), function () { goFace(face === FACES - 1 ? 0 : face + 1); });
    window.addEventListener('resize', function () { goFace(face, false); }, false);
    window.addEventListener('orientationchange', function () { setTimeout(function () { goFace(face, false); }, 300); }, false);
    document.addEventListener('keydown', function (e) {
      if (e.keyCode === 37) { goFace(face - 1); } else if (e.keyCode === 39) { goFace(face + 1); }
    }, false);
  }

  /* --------------------------------------------------------------- klok */
  function tick() {
    var d = new Date();
    var t = two(d.getHours()) + ':' + two(d.getMinutes());
    var date = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    setText($('h-time'), t);
    setText($('c-time'), t);
    setText($('h-date'), date);
    setText($('c-date'), date);
    /* Eens per etmaal herladen (rond 04:00) houdt een oude iPad fris. */
    if (d.getHours() === 4 && Date.now() - startedAt > 6 * 3600 * 1000 && !sheet) { window.location.reload(); }
  }

  /* ------------------------------------------------------------- tegels */
  function shown(t) {
    /* Na een tik tonen we meteen de nieuwe stand, tot de server hem bevestigt. */
    var p = pending[t.id], o = { on: t.on, level: t.level, text: t.text };
    if (!p) { return o; }
    if (Date.now() > p.until || ((p.on === undefined || p.on === t.on) && (p.level === undefined || p.level === t.level))) {
      delete pending[t.id];
      return o;
    }
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

  function paintTile(t) {
    var el = tileEls[t.id], s;
    if (!el) { return; }
    s = shown(t);
    setClass(el, 'is-on', !!s.on);
    setClass(el, 'is-fault', !!t.fault && !pending[t.id]);
    setText(el.children[1], s.text);
    setText(el.children[2], t.name);
  }

  function send(t, ch, value, opt) {
    pending[t.id] = { on: opt.on, level: opt.level, until: Date.now() + (opt.wait || 6000) };
    paintTile(t);
    api('POST', 'api/set', { id: t.id, 'char': ch, value: value }, function (err) {
      if (err) { delete pending[t.id]; paintTile(t); toast(err); }
    });
  }

  function toggle(t) {
    var cur = shown(t);
    send(t, t['char'], cur.on ? t.offValue : t.onValue, { on: !cur.on, level: t.kind === 'cover' ? (cur.on ? 0 : 100) : undefined });
  }

  function tapTile(id) {
    var t = tileData[id];
    if (!t || t.readonly) { return; }
    if (t.stepper) { openStep(t); return; }
    if (!t['char']) { return; }
    if (t.kind === 'scene') { send(t, t['char'], true, { on: true }); return; }
    if (t.confirm) { openConfirm(t); } else { toggle(t); }
  }
  function holdTile(id) {
    var t = tileData[id];
    if (t && t.stepper) { openStep(t); } else if (t && t.levelChar && !t.confirm) { openLevel(t); }
  }

  function buildTiles(room) {
    var box = $('tiles'), i, t, el;
    box.innerHTML = '';
    tileEls = {};
    for (i = 0; i < room.tiles.length; i++) {
      t = room.tiles[i];
      el = document.createElement('div');
      el.className = 'tile k-' + t.kind;
      el.innerHTML = '<div class="tile-icon">' + (ICON[t.kind] || ICON['switch']) + '</div><div class="tile-state"></div><div class="tile-name"></div>';
      box.appendChild(el);
      tileEls[t.id] = el;
      (function (id) {
        onTap(el, function () { tapTile(id); }, function () { holdTile(id); });
      }(t.id));
    }
    box.scrollTop = 0;
  }

  function buildTabs(rooms) {
    var box = $('tabs'), i, el;
    box.innerHTML = '';
    if (rooms.length < 2) { return; }
    for (i = 0; i < rooms.length; i++) {
      el = document.createElement('div');
      el.className = 'tab';
      el.textContent = rooms[i].name;
      box.appendChild(el);
      (function (name) {
        onTap(el, function () {
          roomName = name;
          try { window.localStorage.setItem('hp-room', name); } catch (e) { /* privemodus */ }
          layoutSig = '';
          renderHome();
        });
      }(rooms[i].name));
    }
  }

  function renderHome() {
    var rooms = (state && state.rooms) || [];
    var notice = $('notice');
    var room = null, sig = '', i, j, tabs;
    for (i = 0; i < rooms.length; i++) { if (rooms[i].name === roomName) { room = rooms[i]; } }
    if (!room && rooms.length) { room = rooms[0]; roomName = room.name; }

    for (i = 0; i < rooms.length; i++) {
      sig += '|' + rooms[i].name;
      if (rooms[i] === room) { for (j = 0; j < room.tiles.length; j++) { sig += ',' + room.tiles[j].id + ':' + room.tiles[j].kind; } }
    }
    sig = roomName + sig;
    if (sig !== layoutSig) {
      layoutSig = sig;
      buildTabs(rooms);
      if (room) { buildTiles(room); } else { $('tiles').innerHTML = ''; tileEls = {}; }
    }
    tabs = $('tabs').children;
    for (i = 0; i < tabs.length; i++) { setClass(tabs[i], 'is-active', rooms[i] && rooms[i].name === roomName); }

    tileData = {};
    if (room) {
      for (j = 0; j < room.tiles.length; j++) { tileData[room.tiles[j].id] = room.tiles[j]; paintTile(room.tiles[j]); }
    }

    if (state && state.homebridge && !state.homebridge.ok) {
      setText(notice, 'Homebridge is niet bereikbaar. ' + (state.homebridge.error || ''));
      addClass(notice, 'is-shown');
    } else if (state && !rooms.length) {
      setText(notice, 'Geen bedienbare accessoires gevonden. Staat Homebridge in insecure mode?');
      addClass(notice, 'is-shown');
    } else {
      removeClass(notice, 'is-shown');
    }
  }

  /* ----------------------------------------------------------- overlay */
  var sheetSlider = null;
  var ctSlider = null;
  function closeSheet() { sheet = null; removeClass($('sheet'), 'is-shown'); }
  /* Thermostaat: doeltemperatuur kiezen met - en +, pas versturen bij Instellen. */
  function openStep(t) {
    var cur = shown(t);
    sheet = { t: t, mode: 'step', value: typeof cur.level === 'number' ? cur.level : t.cur };
    setClass($('sheet'), 'no-slider', false);
    setClass($('sheet'), 'has-ct', false);
    setClass($('sheet'), 'mode-step', true);
    setText($('sheet-title'), t.name);
    setText($('sheet-value'), 'Nu ' + temp(t.cur) + '°. Doeltemperatuur:');
    setText($('sheet-no'), 'Sluiten');
    setText($('sheet-yes'), 'Instellen');
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
    var cur = shown(t);
    sheet = { t: t, mode: 'level' };
    setClass($('sheet'), 'mode-step', false);
    setClass($('sheet'), 'no-slider', false);
    setClass($('sheet'), 'has-ct', !!t.ctChar && typeof t.ct === 'number');
    if (t.ctChar && typeof t.ct === 'number') { ctSlider.holdUntil = 0; ctSlider.draw(t.ct); }
    setText($('sheet-title'), t.name);
    setText($('sheet-no'), 'Sluiten');
    sheetSlider.holdUntil = 0;
    sheetSlider.draw(cur.on ? (cur.level || 0) : 0);
    paintSheet();
    addClass($('sheet'), 'is-shown');
  }
  function openConfirm(t) {
    var cur = shown(t);
    sheet = { t: t, mode: 'confirm' };
    setClass($('sheet'), 'mode-step', false);
    setClass($('sheet'), 'has-ct', false);
    setClass($('sheet'), 'no-slider', true);
    setText($('sheet-title'), t.name);
    setText($('sheet-value'), 'Nu: ' + cur.text.toLowerCase() + '. Weet je het zeker?');
    setText($('sheet-no'), 'Annuleren');
    setText($('sheet-yes'), cur.on ? 'Sluiten' : 'Openen');
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
        if (final && t.kind === 'light' && !t.on) {
          api('POST', 'api/set', { id: t.id, 'char': t['char'], value: t.onValue }, null);
        }
      }
      paintSheet();
    });
    sheetSlider.onInput = paintSheet;
    /* Kleurtemperatuur (Hue): 0 = warm, 100 = koel. */
    ctSlider = new Slider($('sheet-ct'), function (v) {
      var t = sheet && sheet.t;
      if (!t || !t.ctChar) { return; }
      api('POST', 'api/set', { id: t.id, 'char': t.ctChar, value: v }, function (err) { if (err) { toast(err); } });
    });
    onTap($('sheet-no'), closeSheet);
    onTap($('sheet-yes'), function () {
      if (!sheet) { return; }
      if (sheet.mode === 'step') {
        send(sheet.t, sheet.t.levelChar, sheet.value, { on: undefined, level: sheet.value, wait: 30000 });
      } else {
        toggle(sheet.t);
      }
      closeSheet();
    });
    onTap($('step-minus'), function () { step(-1); });
    onTap($('step-plus'), function () { step(1); });
    $('sheet').addEventListener('touchend', function (e) { if (e.target === $('sheet')) { e.preventDefault(); lastTouch = Date.now(); closeSheet(); } }, false);
    $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet') && Date.now() - lastTouch > 800) { closeSheet(); } }, false);
  }

  /* --------------------------------------------------------------- sonos */
  var volSlider = null;
  var sonosHold = 0;
  function sonosCmd(action, value) {
    api('POST', 'api/sonos', { action: action, value: value }, function (err) { if (err) { toast(err); } });
  }
  function renderSonos() {
    var s = state && state.sonos;
    var np = $('h-np');
    var playing, title, artist, url;
    if (!s) { np.style.display = 'none'; setText($('m-title'), 'Sonos staat uit in de instellingen'); return; }
    np.style.display = '';
    if (!s.ok) {
      addClass(np, 'is-off');
      setText($('h-np-title'), 'Sonos niet bereikbaar');
      setText($('h-np-artist'), '');
      setText($('m-room'), 'Sonos');
      setText($('m-title'), 'Niet bereikbaar');
      setText($('m-artist'), s.error || '');
      return;
    }
    removeClass(np, 'is-off');
    playing = s.state === 'playing';
    if (Date.now() < sonosHold) { playing = sonosHold_playing; }
    title = s.title || (s.source === 'none' ? 'Niets in de wachtrij' : 'Onbekend nummer');
    artist = s.artist || (s.source === 'tv' ? 'Geluid van de televisie' : '');
    setText($('h-np-title'), title);
    setText($('h-np-artist'), artist || s.room || 'Sonos');
    setText($('m-room'), s.room || 'Sonos');
    setText($('m-title'), title);
    setText($('m-artist'), artist + (s.album && artist ? ' · ' + s.album : (s.album || '')));

    if ($('h-np-toggle').getAttribute('data-p') !== String(playing)) {
      $('h-np-toggle').setAttribute('data-p', String(playing));
      $('h-np-toggle').innerHTML = playing ? ICON.pause : ICON.play;
      $('m-toggle').innerHTML = playing ? ICON.pause : ICON.play;
    }
    setClass($('m-prev'), 'is-disabled', !s.canSkip);
    setClass($('m-next'), 'is-disabled', !s.canSkip);

    url = s.art || '';
    if (url !== artUrl) {
      artUrl = url;
      $('h-np-art').style.backgroundImage = url ? 'url("' + url + '")' : 'none';
      $('m-art').style.backgroundImage = url ? 'url("' + url + '")' : 'none';
      $('m-art').innerHTML = url ? '' : ICON.note;
    }

    volSlider.sync(s.volume);
    setText($('m-volnum'), volSlider.value);
    if ($('m-mute').getAttribute('data-m') !== String(!!s.mute)) {
      $('m-mute').setAttribute('data-m', String(!!s.mute));
      $('m-mute').innerHTML = s.mute ? ICON.muted : ICON.volume;
      setClass($('m-mute'), 'is-muted', !!s.mute);
    }
  }
  var sonosHold_playing = false;
  function togglePlay() {
    var s = state && state.sonos;
    if (!s || !s.ok) { return; }
    sonosHold_playing = !(Date.now() < sonosHold ? sonosHold_playing : s.state === 'playing');
    sonosHold = Date.now() + 4000;
    sonosCmd(sonosHold_playing ? 'play' : 'pause');
    renderSonos();
  }
  function initSonos() {
    $('m-prev').innerHTML = ICON.prev;
    $('m-next').innerHTML = ICON.next;
    $('m-art').innerHTML = ICON.note;
    volSlider = new Slider($('m-slider'), function (v) { sonosCmd('volume', v); });
    volSlider.onInput = function (v) { setText($('m-volnum'), v); };
    onTap($('h-np-toggle'), togglePlay);
    onTap($('m-toggle'), togglePlay);
    onTap($('h-np-art'), function () { goFace(1); });
    onTap($('m-prev'), function () { if (state && state.sonos && state.sonos.canSkip) { sonosCmd('prev'); } });
    onTap($('m-next'), function () { if (state && state.sonos && state.sonos.canSkip) { sonosCmd('next'); } });
    onTap($('m-mute'), function () {
      var s = state && state.sonos;
      if (!s || !s.ok) { return; }
      s.mute = !s.mute;
      sonosCmd('mute', s.mute);
      renderSonos();
    });
  }

  /* ---------------------------------------------------------------- weer */
  function renderWeather() {
    var w = state && state.weather;
    if (!w) { $('h-wx').style.display = 'none'; setText($('c-wx'), ''); return; }
    $('h-wx').style.display = '';
    setText($('h-wx-temp'), w.temp + '°');
    setText($('h-wx-text'), w.text + (w.min !== null && w.max !== null ? ' · ' + w.min + '° tot ' + w.max + '°' : ''));
    setText($('c-wx'), w.temp + '° ' + String(w.text).toLowerCase() + (w.sunset ? ' · zon onder ' + w.sunset : ''));
  }

  /* --------------------------------------------------------------- start */
  function render() {
    renderHome();
    renderSonos();
    renderWeather();
    paintSheet();
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
    var f = 0;
    try {
      roomName = window.localStorage.getItem('hp-room');
      f = parseInt(window.localStorage.getItem('hp-face'), 10) || 0;
    } catch (e) { f = 0; }
    initSwipe();
    initSheet();
    initSonos();
    goFace(f, false);
    tick();
    setInterval(tick, 1000);
    lastOk = Date.now();
    poll();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, false); } else { start(); }
}());
