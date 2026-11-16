/* Editor voor het beginscherm. ES5, werkt met tikken (iPad, telefoon) en met de muis (Mac). */
(function () {
  'use strict';

  var state = null;
  var tiles = [];          // { type, ref, x, y, w, h, variant }
  var sel = -1;            // index van de geselecteerde tegel
  var moving = false;
  var target = null;       // { x, y } van het lege vak waarvoor de kiezer open is
  var tileById = {};
  var dirty = false;
  var lastTouch = 0;
  var GAP = 14;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html) { e.innerHTML = html; } return e; }
  function txt(e, t) { e.textContent = t; return e; }
  function backUrl() { return /terug=paneel/.test(window.location.search) ? './' : 'setup'; }

  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'; }
  var ICON = {
    light: svg('<path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/><rect x="9" y="19.5" width="6" height="2.5" rx="1.2"/>'),
    group: svg('<path d="M7.5 3a5 5 0 0 0-2.9 9.07V13.5a.8.8 0 0 0 .8.8h4.2a.8.8 0 0 0 .8-.8v-1.43A5 5 0 0 0 7.5 3z"/><path d="M16.5 7a5 5 0 0 0-2.9 9.07v1.43a.8.8 0 0 0 .8.8h4.2a.8.8 0 0 0 .8-.8v-1.43A5 5 0 0 0 16.5 7z"/>'),
    'switch': svg('<path d="M12 3v8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M7 6.5a8 8 0 1 0 10 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    climate: svg('<path d="M12 2a3 3 0 0 0-3 3v8.3a5 5 0 1 0 6 0V5a3 3 0 0 0-3-3z"/>'),
    scene: svg('<path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"/>'),
    sensor: svg('<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
    clock: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    weather: svg('<path d="M7 19a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.47 1.47A3.75 3.75 0 0 1 17.25 19H7z"/>'),
    nowplaying: svg('<path d="M9 18a3 3 0 1 1-2-2.83V5.5a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 3v11.99a3 3 0 1 1-2-2.82V7.28l-8 2V18z"/>')
  };
  ICON.outlet = ICON.tv = ICON.fan = ICON.cover = ICON.lock = ICON['switch'];

  function tap(e, fn) {
    e.addEventListener('touchstart', function () { e.className += ' is-down'; }, false);
    e.addEventListener('touchmove', function () { e.className = e.className.replace(/ is-down/g, ''); }, false);
    e.addEventListener('touchend', function (ev) {
      var was = / is-down/.test(e.className);
      e.className = e.className.replace(/ is-down/g, '');
      lastTouch = Date.now();
      if (was) { ev.preventDefault(); ev.stopPropagation(); fn(); }
    }, false);
    e.addEventListener('click', function (ev) { ev.stopPropagation(); if (Date.now() - lastTouch > 700) { fn(); } }, false);
  }
  function toast(msg) {
    var e = $('offline');
    txt(e, msg); e.className = 'is-shown';
    setTimeout(function () { e.className = ''; }, 3000);
  }
  function api(method, url, body, cb) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.onreadystatechange = function () {
      var d = null;
      if (x.readyState !== 4) { return; }
      try { d = JSON.parse(x.responseText); } catch (e) { d = null; }
      cb(x.status >= 200 && x.status < 300 && d ? null : ((d && d.error) || 'Geen verbinding'), d);
    };
    if (body) { x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); } else { x.send(); }
  }

  /* ---------------------------------------------------------- raster */
  function grid() { return (state && state.layout && state.layout.grid) || { cols: 4, rows: 3 }; }
  function geom() {
    var a = $('area'), g = grid();
    var W = a.clientWidth - 48, H = a.clientHeight - 8;
    var cw = (W - GAP * (g.cols - 1)) / g.cols, ch = (H - GAP * (g.rows - 1)) / g.rows;
    /* Zelfde verhouding als op het paneel (ongeveer 230 x 221). */
    if (cw / ch > 1.12) { cw = ch * 1.04; } else if (ch / cw > 1.2) { ch = cw * 0.96; }
    var gw = cw * g.cols + GAP * (g.cols - 1), gh = ch * g.rows + GAP * (g.rows - 1);
    return { cw: cw, ch: ch, left: (a.clientWidth - gw) / 2, top: (a.clientHeight - gh) / 2 };
  }
  function occupied(skip, skip2) {
    var o = {};
    tiles.forEach(function (t, i) {
      var x, y;
      if (i === skip || i === skip2) { return; }
      /* Rijen tellen in halve stappen (scènes kunnen een halve tegel zijn). */
      for (x = t.x; x < t.x + t.w; x++) { for (y = t.y * 2; y < (t.y + t.h) * 2; y++) { o[x + ',' + y] = i; } }
    });
    return o;
  }
  function fits(x, y, w, h, skip, skip2) {
    var g = grid(), o = occupied(skip, skip2), i, j;
    if (x < 0 || y < 0 || x + w > g.cols || y + h > g.rows) { return false; }
    for (i = x; i < x + w; i++) { for (j = y * 2; j < (y + h) * 2; j++) { if (o[i + ',' + j] !== undefined) { return false; } } }
    return true;
  }

  /* ---------------------------------------------------------- tekenen */
  function label(t) {
    var d;
    if (t.type === 'clock') { return { name: 'Klok', kind: t.variant === 'digital' ? 'Digitaal' : 'Analoog', icon: ICON.clock }; }
    if (t.type === 'weather') { return { name: 'Weer', kind: 'Widget', icon: ICON.weather }; }
    if (t.type === 'nowplaying') { return { name: 'Nu speelt', kind: 'Sonos', icon: ICON.nowplaying }; }
    d = tileById[t.ref];
    if (!d) { return { name: 'Niet gevonden', kind: 'Verwijder of vervang', icon: ICON.sensor, missing: true }; }
    return { name: d.name === 'Alle lampen' ? d.room : d.name, kind: d.name === 'Alle lampen' ? 'Alle lampen' : (d.room || ''), icon: d.type === 'HueGroup' ? ICON.group : (ICON[d.kind] || ICON['switch']), on: d.on, scene: d.kind === 'scene' };
  }
  function draw() {
    var a = $('area'), g = grid(), G = geom(), x, y, o = occupied(-1);
    a.innerHTML = '';
    for (x = 0; x < g.cols; x++) {
      for (y = 0; y < g.rows * 2; y++) {
        if (o[x + ',' + y] !== undefined) { continue; }
        /* Hele vrije vakken als één vak, losse halve vakken als half vak. */
        var full = y % 2 === 0 && o[x + ',' + (y + 1)] === undefined;
        (function (cx, cy, ch) {
          var c = el('div', 'cell' + (ch === 0.5 ? ' is-half' : '') + (moving ? ' is-target' : ''));
          c.style.left = Math.round(G.left + cx * (G.cw + GAP)) + 'px';
          c.style.top = Math.round(G.top + cy * (G.ch + GAP)) + 'px';
          c.style.width = Math.round(G.cw) + 'px';
          c.style.height = Math.round(ch * (G.ch + GAP) - GAP) + 'px';
          tap(c, function () { cellTap(cx, cy, ch); });
          a.appendChild(c);
        }(x, y / 2, full ? 1 : 0.5));
        if (full) { y++; }
      }
    }
    tiles.forEach(function (t, i) {
      var L = label(t), e = el('div', 'tile s-' + t.w + 'x' + (t.h === 0.5 ? 'h' : t.h) + (L.scene ? ' k-scene' : '') + (L.on ? ' is-on' : '') + (i === sel ? ' is-sel' : '') + (i === sel && moving ? ' is-moving' : ''),
        '<div class="t-icon">' + L.icon + '</div><div class="t-name"></div><div class="ed-kind"></div><div class="ed-size">' + sizeLabel(t.w, t.h) + '</div>');
      txt(e.children[1], L.name);
      txt(e.children[2], L.kind);
      e.style.left = Math.round(G.left + t.x * (G.cw + GAP)) + 'px';
      e.style.top = Math.round(G.top + t.y * (G.ch + GAP)) + 'px';
      e.style.width = Math.round(G.cw * t.w + GAP * (t.w - 1)) + 'px';
      e.style.height = Math.round(t.h * (G.ch + GAP) - GAP) + 'px';
      tap(e, function () { tileTap(i); });
      a.appendChild(e);
    });
    drawBar();
  }
  function drawBar() {
    var b = $('bar'), t = tiles[sel], tools, sizes = isScene(t) ? [[1, 0.5], [2, 0.5], [1, 1], [2, 1]] : [[1, 1], [2, 1], [1, 2], [2, 2]];
    b.innerHTML = '';
    if (sel < 0 || !t) {
      b.appendChild(el('div', 'ed-msg', tiles.length ? 'Tik op een tegel om de grootte te kiezen, te verplaatsen of weg te halen.' : 'Het beginscherm is leeg. Tik op een vak om te beginnen.'));
      return;
    }
    if (moving) {
      b.appendChild(el('div', 'ed-msg', 'Tik op een leeg vak om de tegel daarheen te verplaatsen, of op een andere tegel om te wisselen.'));
      tools = el('div', 'ed-tools'); b.appendChild(tools);
      tools.appendChild(btn('Stoppen', '', function () { moving = false; draw(); }));
      tools.style.marginTop = '4px';
      b.children[0].style.marginTop = '12px';
      return;
    }
    tools = el('div', 'ed-tools');
    sizes.forEach(function (s) {
      var ok = fits(t.x, t.y, s[0], s[1], sel), on = t.w === s[0] && t.h === s[1];
      tools.appendChild(btn(sizeLabel(s[0], s[1]), on ? 'is-on' : (ok ? '' : 'is-off'), function () {
        if (!ok || on) { if (!ok) { toast('Past hier niet; verplaats de tegel eerst of maak ruimte.'); } return; }
        t.w = s[0]; t.h = s[1]; dirty = true; draw();
      }));
    });
    if (t.type === 'clock') {
      tools.appendChild(btn(t.variant === 'digital' ? 'Analoog' : 'Digitaal', '', function () { t.variant = t.variant === 'digital' ? 'analog' : 'digital'; dirty = true; draw(); }));
    }
    tools.appendChild(btn('Verplaatsen', '', function () { moving = true; draw(); }));
    tools.appendChild(btn('Weghalen', 'danger', function () { tiles.splice(sel, 1); sel = -1; dirty = true; draw(); }));
    b.appendChild(tools);
  }
  function sizeLabel(w, h) { return w + '×' + (h === 0.5 ? '½' : h); }
  function isScene(t) { var d = t && t.type === 'device' && tileById[t.ref]; return !!(d && d.kind === 'scene'); }
  function btn(label2, cls, fn) { var e = el('div', 'ed-tool' + (cls ? ' ' + cls : '')); txt(e, label2); tap(e, fn); return e; }

  /* ------------------------------------------------------------ acties */
  /* Wisselen: twee tegels ruilen van plek, als ze daarna allebei passen. */
  function swap(a, b) {
    var A = tiles[a], B = tiles[b], ax = A.x, ay = A.y;
    var g = grid();
    function inside(t, x, y) { return x + t.w <= g.cols && y + t.h <= g.rows; }
    if (!inside(A, B.x, B.y) || !inside(B, ax, ay)) { return false; }
    A.x = B.x; A.y = B.y; B.x = ax; B.y = ay;
    if (fits(A.x, A.y, A.w, A.h, a, b) && fits(B.x, B.y, B.w, B.h, a, b) && !overlap(A, B)) { return true; }
    B.x = A.x; B.y = A.y; A.x = ax; A.y = ay;
    return false;
  }
  function overlap(A, B) { return A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h; }
  function tileTap(i) {
    if (moving && i === sel) { moving = false; draw(); return; }
    if (moving && sel >= 0) {
      if (swap(sel, i)) { dirty = true; } else { toast('Deze twee passen niet op elkaars plek; maak eerst een tegel kleiner.'); }
      moving = false; draw(); return;
    }
    moving = false;
    sel = sel === i ? -1 : i;
    draw();
  }
  function cellTap(x, y, ch) {
    var t = tiles[sel], small = isScene(t) ? 0.5 : 1;
    if (moving && t) {
      if (fits(x, y, t.w, t.h, sel)) { t.x = x; t.y = y; }
      else if (fits(x, y, 1, small, sel)) { t.x = x; t.y = y; t.w = 1; t.h = small; toast('Te groot voor die plek; de tegel is nu ' + sizeLabel(1, small) + '.'); }
      else { toast('Hier past alleen een scène (halve hoogte).'); }
      moving = false; dirty = true; draw();
      return;
    }
    sel = -1;
    target = { x: x, y: y, half: ch === 0.5 };
    openPicker();
  }
  function place(item) {
    var x = target.x, y = target.y, w = 1, h = 1;
    if (item.scene) { h = 0.5; }
    else if (target.half) { toast('Hier past alleen een scène (halve hoogte).'); return; }
    delete item.scene;
    if (item.type === 'nowplaying' || item.type === 'weather') { if (fits(x, y, 2, 1, -1)) { w = 2; } }
    if (item.big) { if (fits(x, y, 2, 2, -1)) { w = 2; h = 2; } else if (fits(x, y, 1, 2, -1)) { h = 2; } }
    item.x = x; item.y = y; item.w = w; item.h = h;
    delete item.big;
    tiles.push(item);
    sel = tiles.length - 1;
    dirty = true;
    closePicker();
    draw();
  }

  /* ------------------------------------------------------------ kiezer */
  function openPicker() {
    var list = $('pk-list'), used = {}, rooms = (state.rooms || []).filter(function (r) { return !r.zone; }).concat((state.rooms || []).filter(function (r) { return r.zone; }));
    tiles.forEach(function (t) { if (t.ref) { used[t.ref] = true; } });
    list.innerHTML = '';
    list.appendChild(txt(el('div', 'pk-group'), 'Widgets'));
    item(list, ICON.clock, 'Klok', 'analoog', false, function () { place({ type: 'clock', variant: 'analog' }); });
    item(list, ICON.clock, 'Klok', 'digitaal', false, function () { place({ type: 'clock', variant: 'digital' }); });
    item(list, ICON.weather, 'Weer', '', false, function () { place({ type: 'weather' }); });
    item(list, ICON.nowplaying, 'Nu speelt', 'Sonos', false, function () { place({ type: 'nowplaying' }); });
    rooms.forEach(function (r) {
      if (!r.tiles.length) { return; }
      list.appendChild(txt(el('div', 'pk-group'), r.name + (r.zone ? ' (zone)' : '')));
      r.tiles.forEach(function (d) {
        var ic = d.type === 'HueGroup' ? ICON.group : (ICON[d.kind] || ICON['switch']);
        var kindTxt = d.kind === 'scene' ? 'scène' : d.kind === 'climate' ? 'thermostaat' : (d.readonly ? 'sensor' : '');
        item(list, ic, d.name, kindTxt, used[d.id], function () { place({ type: 'device', ref: d.id, big: d.kind === 'climate' && !!d.stepper, scene: d.kind === 'scene' }); });
      });
    });
    list.scrollTop = 0;
    $('picker').className = 'is-shown';
  }
  function item(list, icon, name, small, isUsed, fn) {
    var e = el('div', 'pk-item' + (isUsed ? ' is-used' : ''), icon + '<span></span>' + (small ? '<small></small>' : ''));
    txt(e.children[1], name);
    if (small) { txt(e.children[2], small + (isUsed ? ' · staat er al' : '')); } else if (isUsed) { e.appendChild(txt(el('small'), 'staat er al')); }
    tap(e, fn);
    list.appendChild(e);
  }
  function closePicker() { $('picker').className = ''; target = null; }

  /* ------------------------------------------------------------ opslaan */
  function save() {
    api('POST', 'api/layout', { home: tiles }, function (err) {
      if (err) { toast(err); return; }
      dirty = false;
      window.location.href = backUrl();
    });
  }
  function start() {
    api('GET', 'api/state?t=' + Date.now(), null, function (err, d) {
      if (err) { toast(err); return; }
      state = d;
      (d.rooms || []).forEach(function (r) { r.tiles.forEach(function (t) { if (!tileById[t.id]) { tileById[t.id] = t; } }); });
      tiles = JSON.parse(JSON.stringify((d.layout && d.layout.home) || []));
      document.body.className = 'theme-' + ((d.layout && d.layout.theme) || 'warm');
      if (d.layout && d.layout.theme === 'eigen' && d.bg) { $('bgimg').style.backgroundImage = 'url("bg?v=' + d.bg + '")'; }
      draw();
    });
    tap($('save'), save);
    tap($('cancel'), function () {
      if (dirty && !window.confirm('Wijzigingen weggooien?')) { return; }
      window.location.href = backUrl();
    });
    tap($('reset'), function () {
      if (!window.confirm('Terug naar de standaardindeling?')) { return; }
      api('POST', 'api/layout', { home: null }, function (err) {
        if (err) { toast(err); return; }
        api('GET', 'api/state?t=' + Date.now(), null, function (e2, d) { if (!e2) { tiles = JSON.parse(JSON.stringify(d.layout.home)); sel = -1; dirty = false; draw(); } });
      });
    });
    tap($('pk-close'), closePicker);
    $('picker').addEventListener('click', function (e) { if (e.target === $('picker')) { closePicker(); } }, false);
    window.addEventListener('resize', draw, false);
    window.addEventListener('orientationchange', function () { setTimeout(draw, 300); }, false);
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, false); } else { start(); }
}());
