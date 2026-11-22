/* Editor voor het beginscherm en de eigen schermen. ES5, werkt met tikken (iPad, telefoon) en met de muis (Mac). */
(function () {
  'use strict';

  var state = null;
  var tiles = [];          // tegels van het scherm dat nu open staat: { type, ref, x, y, w, h, variant }
  var home = [];           // tegels van het beginscherm
  var pages = [];          // eigen schermen: { id, name, tiles }
  var cur = -1;            // -1 = beginscherm, anders index in pages
  var sel = -1;            // index van de geselecteerde tegel
  var moving = false;
  var target = null;       // { x, y } van het lege vak waarvoor de kiezer open is
  var tileById = {};
  var dirty = false;
  var groups = [];         // lampgroepen, lokaal tot Opslaan: { id, name, members }
  var groupsDirty = false;
  var backFn = null;       // wat '‹ Terug' in de kiezer doet
  var lastTouch = 0;
  var GAP = 14;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html) { e.innerHTML = html; } return e; }
  function txt(e, t) { e.textContent = t; return e; }
  function isDark(l) {
    var now = new Date(), n = now.getHours() * 60 + now.getMinutes(), a, b, w = state && state.weather;
    function m(x) { var p = String(x || '').split(':'); return Number(p[0]) * 60 + Number(p[1]); }
    if (!l || l.mode !== 'auto') { return !!(l && l.mode === 'dark'); }
    if (l.schedule !== 'custom' && w && /^\d\d:\d\d$/.test(w.sunset) && /^\d\d:\d\d$/.test(w.sunrise)) { a = m(w.sunset); b = m(w.sunrise); }
    else { a = m(l.darkFrom); b = m(l.darkTo); }
    return a < b ? (n >= a && n < b) : (n >= a || n < b);
  }
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
  ICON.room = svg('<path d="M3.5 11.2L12 4l8.5 7.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 9.6V19a1 1 0 0 0 1 1h3.6v-5.2h2.8V20H17a1 1 0 0 0 1-1V9.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>');
  ICON.tvset = svg('<rect x="2" y="4" width="20" height="13" rx="2.5"/><rect x="7" y="19" width="10" height="2" rx="1"/>');

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

  /* ---------------------------------------------------------- soorten */
  /* Welke formaten bij welke tegel horen. */
  var S_HALF = [[1, 0.5], [2, 0.5], [1, 1], [2, 1]];
  var S_DEV = [[1, 0.5], [2, 0.5], [1, 1], [2, 1], [1, 2], [2, 2]];
  var S_BIG = [[1, 1], [2, 1], [1, 2], [2, 2]];
  function devOf(t) { return t && t.type === 'device' ? tileById[t.ref] : null; }
  function sizesFor(t) {
    var d = devOf(t);
    if (t.type === 'room') { return S_HALF; }
    if (t.type !== 'device') { return S_BIG; }
    if (d && d.kind === 'climate' && d.stepper) { return S_BIG; }
    if (d && d.kind === 'scene') { return S_HALF; }
    return S_DEV;
  }
  function canHalf(t) { return sizesFor(t)[0][1] === 0.5; }
  function cat(d) {
    if (d.kind === 'scene') { return 'scene'; }
    if (d.kind === 'light') { return 'light'; }
    return 'device';
  }

  /* ---------------------------------------------------------- tekenen */
  function roomByKey(key) {
    var i, rs = (state && state.rooms) || [];
    for (i = 0; i < rs.length; i++) { if (rs[i].key === key) { return rs[i]; } }
    return null;
  }
  function label(t) {
    var d, r;
    if (t.type === 'clock') { return { name: 'Klok', kind: t.variant === 'digital' ? 'Digitaal' : 'Analoog', icon: ICON.clock }; }
    if (t.type === 'weather') { return { name: 'Weer', kind: 'Widget', icon: ICON.weather }; }
    if (t.type === 'nowplaying') { return { name: 'Nu speelt', kind: 'Sonos', icon: ICON.nowplaying }; }
    if (t.type === 'atv') { return { name: (state.atv && state.atv.name) || 'Apple TV', kind: 'Apple TV', icon: ICON.tvset }; }
    if (t.type === 'room') {
      r = roomByKey(t.ref);
      return r ? { name: r.name, kind: r.zone ? 'Zone' : 'Kamer', icon: ICON.room } : { name: 'Kamer niet gevonden', kind: 'Verwijder of vervang', icon: ICON.room, missing: true };
    }
    d = tileById[t.ref];
    if (!d) { return { name: 'Niet gevonden', kind: 'Verwijder of vervang', icon: ICON.sensor, missing: true }; }
    return { name: d.name === 'Alle lampen' ? d.room : d.name, kind: d.name === 'Alle lampen' ? 'Alle lampen' : (d.isGroup ? 'Groep' : (d.room || '')), icon: d.type === 'HueGroup' || d.isGroup ? ICON.group : (ICON[d.kind] || ICON['switch']), on: d.on, scene: d.kind === 'scene' };
  }
  function pageName() { return cur < 0 ? 'Beginscherm' : pages[cur].name; }
  function drawTabs() {
    var b = $('tabs');
    b.innerHTML = '';
    function tab(name, idx) {
      var e = el('div', 'ed-tab' + (idx === cur ? ' is-on' : ''));
      txt(e, name);
      tap(e, function () { switchTo(idx); });
      b.appendChild(e);
    }
    tab('Beginscherm', -1);
    pages.forEach(function (p, i) { tab(p.name, i); });
    var add = el('div', 'ed-tab ed-add');
    txt(add, '+ Scherm');
    tap(add, addPage);
    b.appendChild(add);
  }
  function switchTo(idx) {
    keep();
    cur = idx; sel = -1; moving = false;
    tiles = cur < 0 ? home : pages[cur].tiles;
    draw();
  }
  function keep() { if (cur < 0) { home = tiles; } else if (pages[cur]) { pages[cur].tiles = tiles; } }
  function addPage() {
    if (pages.length >= 12) { toast('Maximaal 12 eigen schermen.'); return; }
    var name = window.prompt('Naam van het nieuwe scherm', 'Scherm ' + (pages.length + 1));
    if (name === null) { return; }
    name = String(name).replace(/^\s+|\s+$/g, '').slice(0, 40) || 'Scherm ' + (pages.length + 1);
    keep();
    pages.push({ id: '', name: name, tiles: [] });
    dirty = true;
    switchTo(pages.length - 1);
  }
  function draw() {
    var a = $('area'), g = grid(), G = geom(), x, y, o = occupied(-1);
    drawTabs();
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
    var b = $('bar'), t = tiles[sel], tools;
    b.innerHTML = '';
    if (sel < 0 || !t) {
      tools = el('div', 'ed-tools');
      if (cur < 0) {
        tools.appendChild(btn('Standaardindeling', '', resetHome));
      } else {
        tools.appendChild(btn('Naam wijzigen', '', renamePage));
        tools.appendChild(btn('◀ Naar links', cur > 0 ? '' : 'is-off', function () { movePage(-1); }));
        tools.appendChild(btn('Naar rechts ▶', cur < pages.length - 1 ? '' : 'is-off', function () { movePage(1); }));
        tools.appendChild(btn('Scherm verwijderen', 'danger', removePage));
      }
      b.appendChild(tools);
      b.appendChild(el('div', 'ed-msg ed-msg-small', tiles.length ? 'Tik op een tegel om hem aan te passen, of op een leeg vak om iets toe te voegen.' : pageName() + ' is leeg. Tik op een vak om te beginnen.'));
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
    sizesFor(t).forEach(function (s) {
      var ok = fits(t.x, t.y, s[0], s[1], sel), on = t.w === s[0] && t.h === s[1];
      tools.appendChild(btn(sizeLabel(s[0], s[1]), on ? 'is-on' : (ok ? '' : 'is-off'), function () {
        if (!ok || on) { if (!ok) { toast('Past hier niet; verplaats de tegel eerst of maak ruimte.'); } return; }
        t.w = s[0]; t.h = s[1]; dirty = true; draw();
      }));
    });
    if (t.type === 'clock') {
      tools.appendChild(btn(t.variant === 'digital' ? 'Analoog' : 'Digitaal', '', function () { t.variant = t.variant === 'digital' ? 'analog' : 'digital'; dirty = true; draw(); }));
    }
    if (groupByRef(t.ref)) {
      tools.appendChild(btn('Groep wijzigen', '', function () { target = null; openGroup(groupByRef(t.ref), null); }));
    }
    tools.appendChild(btn('Verplaatsen', '', function () { moving = true; draw(); }));
    tools.appendChild(btn('Weghalen', 'danger', function () { tiles.splice(sel, 1); sel = -1; dirty = true; draw(); }));
    b.appendChild(tools);
  }
  function sizeLabel(w, h) { return w + '×' + (h === 0.5 ? '½' : h); }
  function btn(label2, cls, fn) { var e = el('div', 'ed-tool' + (cls ? ' ' + cls : '')); txt(e, label2); tap(e, function () { if (/is-off/.test(e.className) && cls === 'is-off') { return; } fn(); }); return e; }

  /* ------------------------------------------------------------ schermen */
  function renamePage() {
    var name = window.prompt('Nieuwe naam', pages[cur].name);
    if (name === null) { return; }
    name = String(name).replace(/^\s+|\s+$/g, '').slice(0, 40);
    if (!name) { return; }
    pages[cur].name = name; dirty = true; draw();
  }
  function movePage(d) {
    var j = cur + d, p;
    if (j < 0 || j >= pages.length) { return; }
    keep();
    p = pages[cur]; pages[cur] = pages[j]; pages[j] = p;
    cur = j; dirty = true; draw();
  }
  function removePage() {
    if (!window.confirm('Het scherm "' + pages[cur].name + '" verwijderen?')) { return; }
    pages.splice(cur, 1);
    dirty = true;
    cur = -1; tiles = home; sel = -1;
    draw();
  }
  function resetHome() {
    if (!window.confirm('Het beginscherm terugzetten naar de standaardindeling?')) { return; }
    api('POST', 'api/layout', { home: null }, function (err) {
      if (err) { toast(err); return; }
      api('GET', 'api/state?t=' + Date.now(), null, function (e2, d) { if (!e2) { home = JSON.parse(JSON.stringify(d.layout.home)); if (cur < 0) { tiles = home; } sel = -1; draw(); } });
    });
  }

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
    var t = tiles[sel], small = t && canHalf(t) ? 0.5 : 1;
    if (moving && t) {
      if (fits(x, y, t.w, t.h, sel)) { t.x = x; t.y = y; }
      else if (fits(x, y, 1, small, sel)) { t.x = x; t.y = y; t.w = 1; t.h = small; toast('Te groot voor die plek; de tegel is nu ' + sizeLabel(1, small) + '.'); }
      else { toast('Deze tegel past niet in een half vak.'); }
      moving = false; dirty = true; draw();
      return;
    }
    sel = -1;
    target = { x: x, y: y, half: ch === 0.5 };
    openPicker();
  }
  /* Nieuwe tegel op het gekozen vak, in een passend standaardformaat. */
  function place(item) {
    var x = target.x, y = target.y, d = devOf(item), w = 1, h = 1;
    var halfFirst = item.type === 'device' && d && (d.kind === 'scene' || d.kind === 'light');
    if (target.half && !canHalf(item)) { toast('Hier past alleen een tegel van halve hoogte.'); return; }
    if (target.half || halfFirst) { h = 0.5; }
    else if (item.type === 'nowplaying' || item.type === 'weather' || item.type === 'atv') { if (fits(x, y, 2, 1, -1)) { w = 2; } }
    else if (d && d.kind === 'climate' && d.stepper) { if (fits(x, y, 2, 2, -1)) { w = 2; h = 2; } else if (fits(x, y, 2, 1, -1)) { w = 2; } }
    if (!fits(x, y, w, h, -1)) { w = 1; h = canHalf(item) && !fits(x, y, 1, 1, -1) ? 0.5 : 1; }
    item.x = x; item.y = y; item.w = w; item.h = h;
    tiles.push(item);
    sel = tiles.length - 1;
    dirty = true;
    closePicker();
    draw();
  }

  /* ------------------------------------------------------------ kiezer */
  /* Eerst een soort kiezen, dan een korte lijst van alleen die soort. */
  function used() { var u = {}; tiles.forEach(function (t) { if (t.ref) { u[t.ref] = true; } }); return u; }
  function roomsSorted() { var rs = state.rooms || []; return rs.filter(function (r) { return !r.zone; }).concat(rs.filter(function (r) { return r.zone; })); }
  function count(kind) {
    var n = 0;
    if (kind === 'light') { return lightsByRoom().reduce(function (a, r) { return a + r.items.length; }, groups.length); }
    var seen = {};
    roomsSorted().forEach(function (r) { r.tiles.forEach(function (d) { if (!seen[d.id] && cat(d) === kind) { seen[d.id] = true; n++; } }); });
    return n;
  }
  function openPicker() {
    var list = $('pk-list');
    backFn = openPicker;
    $('pk-box').className = 'pk-box';
    txt($('pk-title'), 'Wat komt hier?');
    list.innerHTML = '';
    category(list, ICON.light, 'Lampen', count('light'), function () { showKind('light', 'Lampen'); });
    category(list, ICON.scene, 'Scènes', count('scene'), function () { showKind('scene', 'Scènes'); });
    category(list, ICON['switch'], 'Schakelaars en apparaten', count('device'), function () { showKind('device', 'Schakelaars en apparaten'); });
    category(list, ICON.room, 'Kamers', (state.rooms || []).length, showRooms);
    category(list, ICON.clock, 'Widgets', '', showWidgets);
    list.scrollTop = 0;
    $('picker').className = 'is-shown';
  }
  function category(list, icon, name, n, fn) {
    var e = el('div', 'pk-cat', icon + '<span></span>' + (n !== '' ? '<small></small>' : ''));
    txt(e.children[1], name);
    if (n !== '') { txt(e.children[2], n + (n === 1 ? ' keuze' : ' keuzes')); }
    tap(e, fn);
    list.appendChild(e);
  }
  function sub(title) {
    var list = $('pk-list');
    $('pk-box').className = 'pk-box is-sub';
    txt($('pk-title'), title);
    list.innerHTML = '';
    list.scrollTop = 0;
    return list;
  }
  function showKind(kind, title) {
    if (kind === 'light') { showLights(); return; }
    var list = sub(title), u = used(), seen = {};
    roomsSorted().forEach(function (r) {
      var ds = r.tiles.filter(function (d) { return cat(d) === kind && !seen[d.id]; });
      if (!ds.length) { return; }
      list.appendChild(txt(el('div', 'pk-group'), r.name + (r.zone ? ' (zone)' : '')));
      ds.forEach(function (d) {
        seen[d.id] = true;
        var ic = d.type === 'HueGroup' || d.isGroup ? ICON.group : (ICON[d.kind] || ICON['switch']);
        var small = d.isGroup ? 'groep' : (d.kind === 'climate' ? 'thermostaat' : (d.readonly ? 'sensor' : ''));
        item(list, ic, d.name === 'Alle lampen' ? 'Alle lampen in ' + r.name : d.name, small, u[d.id], function () { place({ type: 'device', ref: d.id }); });
      });
    });
    if (!list.children.length) { list.appendChild(txt(el('div', 'pk-group'), 'Niets gevonden')); }
  }
  /* ------------------------------------------------------------ lampen en groepen */
  function newGroupId() { return 'g' + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '0'); }
  function groupByRef(ref) {
    var i;
    if (typeof ref !== 'string' || ref.indexOf('grp:') !== 0) { return null; }
    for (i = 0; i < groups.length; i++) { if (groups[i].id === ref.slice(4)) { return groups[i]; } }
    return null;
  }
  function groupOfLamp(id, skipId) {
    var i;
    for (i = 0; i < groups.length; i++) { if (groups[i].id !== skipId && groups[i].members.indexOf(id) !== -1) { return groups[i]; } }
    return null;
  }
  /* Alle losse lampen (niet in een groep), per kamer. Lampen die al in een opgeslagen groep zitten
     staan niet meer in state.rooms, daarom komt de lijst uit state.lights. */
  function lightsByRoom(skipGroup, withGrouped) {
    var out = [], byName = {}, seen = {};
    function add(roomName, d) {
      if (seen[d.id]) { return; }
      seen[d.id] = true;
      if (!byName[roomName]) { byName[roomName] = { name: roomName, items: [] }; out.push(byName[roomName]); }
      byName[roomName].items.push(d);
    }
    roomsSorted().forEach(function (r) {
      r.tiles.forEach(function (d) {
        if (d.kind !== 'light' || d.isGroup) { return; }
        if (skipGroup === 'lamps' && (d.type === 'HueGroup' || d.name === 'Alle lampen')) { return; }
        if (!withGrouped && groupOfLamp(d.id)) { return; }
        add(r.name, d);
      });
    });
    (state.lights || []).forEach(function (l) {
      if (!withGrouped && groupOfLamp(l.id)) { return; }
      add(l.room || 'Zonder kamer', tileById[l.id] || l);
    });
    return out;
  }
  function showLights() {
    var list = sub('Lampen'), u = used();
    backFn = openPicker;
    list.appendChild(txt(el('div', 'pk-group'), 'Lampgroepen'));
    item(list, ICON.group, '+ Nieuwe lampgroep', 'meerdere lampen als één lamp', false, function () { openGroup(null, 'picker'); });
    groups.forEach(function (g) {
      item(list, ICON.group, g.name, g.members.length + ' lampen', u['grp:' + g.id], function () { place({ type: 'device', ref: 'grp:' + g.id }); });
    });
    lightsByRoom().forEach(function (r) {
      list.appendChild(txt(el('div', 'pk-group'), r.name));
      r.items.forEach(function (d) {
        var ic = d.type === 'HueGroup' ? ICON.group : ICON.light;
        item(list, ic, d.name === 'Alle lampen' ? 'Alle lampen in ' + r.name : d.name, '', u[d.id], function () { place({ type: 'device', ref: d.id }); });
      });
    });
  }
  /* Pop-up om een groep te maken of te wijzigen. from = 'picker' als hij uit 'Wat komt hier?' komt. */
  function openGroup(g, from) {
    var edit = { id: g ? g.id : newGroupId(), sel: {}, n: 0 }, list, name, foot = $('pk-foot');
    if (g) { g.members.forEach(function (m) { edit.sel[m] = true; edit.n++; }); }
    list = sub(g ? 'Groep wijzigen' : 'Nieuwe lampgroep');
    $('pk-box').className = 'pk-box is-sub is-group';
    backFn = from === 'picker' ? showLights : closePicker;
    $('picker').className = 'is-shown';
    name = el('input', 'pk-name');
    name.setAttribute('maxlength', '40');
    name.setAttribute('placeholder', 'Naam, bijvoorbeeld Plafond spots');
    name.setAttribute('autocorrect', 'off');
    name.value = g ? g.name : '';
    list.appendChild(name);
    list.appendChild(txt(el('div', 'pk-hint'), 'Kies de lampen die samen als één lamp moeten werken. Aan, uit en dimmen gaan dan naar alle lampen tegelijk.'));
    lightsByRoom('lamps', true).forEach(function (r) {
      list.appendChild(txt(el('div', 'pk-group'), r.name));
      r.items.forEach(function (d) {
        var other = groupOfLamp(d.id, edit.id);
        var e = el('div', 'pk-item pk-check' + (edit.sel[d.id] ? ' is-on' : '') + (other ? ' is-used' : ''), '<span></span>' + (other ? '<small></small>' : ''));
        txt(e.children[0], d.name);
        if (other) { txt(e.children[1], 'in ' + other.name); }
        tap(e, function () {
          if (other) { toast(d.name + ' zit al in de groep ' + other.name + '.'); return; }
          edit.sel[d.id] = !edit.sel[d.id];
          edit.n += edit.sel[d.id] ? 1 : -1;
          e.className = 'pk-item pk-check' + (edit.sel[d.id] ? ' is-on' : '');
          drawFoot();
        });
        list.appendChild(e);
      });
    });
    function drawFoot() {
      foot.innerHTML = '';
      var ok = el('div', 'pk-save' + (edit.n < 2 ? ' is-off' : ''));
      txt(ok, edit.n < 2 ? 'Kies minstens twee lampen' : (g ? 'Groep opslaan' : 'Groep maken') + ' (' + edit.n + ' lampen)');
      tap(ok, function () { saveGroup(g, edit, name.value, from); });
      foot.appendChild(ok);
      if (g) {
        var del = el('div', 'pk-save pk-del');
        txt(del, 'Groep opheffen');
        tap(del, function () { removeGroup(g); });
        foot.appendChild(del);
      }
    }
    drawFoot();
    if (!g) { setTimeout(function () { try { name.focus(); } catch (e) { /* iOS */ } }, 50); }
  }
  /* Lokale tegel voor een groep, zodat hij meteen in de editor staat (de echte komt na Opslaan). */
  function syncGroupTiles() {
    groups.forEach(function (g) {
      var old = tileById['grp:' + g.id] || {}, first = tileById[g.members[0]] || {};
      tileById['grp:' + g.id] = { id: 'grp:' + g.id, name: g.name, kind: 'light', isGroup: true, room: old.room || first.room || '', on: old.on };
    });
  }
  /* Op elk scherm: de eerste lamp uit de groep wordt de groep, de andere lampen gaan weg. */
  function screensEach(fn) { keep(); fn(home); pages.forEach(function (p) { fn(p.tiles); }); }
  function putGroupOnScreens(g) {
    var ref = 'grp:' + g.id, mem = {};
    g.members.forEach(function (m) { mem[m] = true; });
    screensEach(function (list) {
      var has = list.some(function (t) { return t.ref === ref; }), i;
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i].type !== 'device' || !mem[list[i].ref]) { continue; }
        if (!has && !list.slice(0, i).some(function (t) { return t.type === 'device' && mem[t.ref]; })) { list[i].ref = ref; has = true; }
        else { list.splice(i, 1); }
      }
    });
    return tiles.some(function (t) { return t.ref === ref; });
  }
  function saveGroup(g, edit, nameVal, from) {
    var name2 = String(nameVal || '').replace(/^\s+|\s+$/g, '').slice(0, 40), members = [], id, ng, onScreen;
    if (!name2) { toast('Geef de groep een naam.'); return; }
    for (id in edit.sel) { if (edit.sel[id]) { members.push(id); } }
    if (members.length < 2) { toast('Kies minstens twee lampen.'); return; }
    ng = { id: edit.id, name: name2, members: members };
    if (g) { groups[groups.indexOf(g)] = ng; } else { groups.push(ng); }
    groupsDirty = true; dirty = true;
    syncGroupTiles();
    onScreen = putGroupOnScreens(ng);
    sel = -1;
    if (from === 'picker' && target && !onScreen) { place({ type: 'device', ref: 'grp:' + ng.id }); }
    else { closePicker(); draw(); }
    toast(g ? 'Groep aangepast. Druk op Opslaan om het te bewaren.' : 'Groep gemaakt. Druk op Opslaan om hem te bewaren.');
  }
  /* Opheffen: de groepstegel wordt weer de eerste lamp, de lampen komen los in hun kamer. */
  function removeGroup(g) {
    if (!window.confirm('De groep "' + g.name + '" opheffen? De lampen worden weer los.')) { return; }
    var ref = 'grp:' + g.id;
    groups.splice(groups.indexOf(g), 1);
    groupsDirty = true; dirty = true;
    screensEach(function (list) { list.forEach(function (t) { if (t.ref === ref) { t.ref = g.members[0]; } }); });
    sel = -1;
    closePicker(); draw();
  }

  function showRooms() {
    var list = sub('Kamers'), u = used();
    roomsSorted().forEach(function (r) {
      item(list, ICON.room, r.name, r.zone ? 'zone' : '', u[r.key], function () { place({ type: 'room', ref: r.key }); });
    });
  }
  function showWidgets() {
    var list = sub('Widgets');
    item(list, ICON.clock, 'Klok', 'analoog', false, function () { place({ type: 'clock', variant: 'analog' }); });
    item(list, ICON.clock, 'Klok', 'digitaal', false, function () { place({ type: 'clock', variant: 'digital' }); });
    item(list, ICON.weather, 'Weer', '', false, function () { place({ type: 'weather' }); });
    item(list, ICON.nowplaying, 'Nu speelt', 'Sonos', false, function () { place({ type: 'nowplaying' }); });
    if (state.atv) { item(list, ICON.tvset, 'Apple TV', state.atv.name, false, function () { place({ type: 'atv' }); }); }
  }
  function item(list, icon, name, small, isUsed, fn) {
    var e = el('div', 'pk-item' + (isUsed ? ' is-used' : ''), icon + '<span></span>' + (small ? '<small></small>' : ''));
    txt(e.children[1], name);
    if (small) { txt(e.children[2], small + (isUsed ? ' · staat er al' : '')); } else if (isUsed) { e.appendChild(txt(el('small'), 'staat er al')); }
    tap(e, fn);
    list.appendChild(e);
  }
  function closePicker() { $('picker').className = ''; target = null; $('pk-foot').innerHTML = ''; }

  /* ------------------------------------------------------------ opslaan */
  function save() {
    keep();
    var body = { home: home, pages: pages };
    if (groupsDirty) { body.groups = groups; }
    api('POST', 'api/layout', body, function (err) {
      if (err) { toast(err); return; }
      dirty = false;
      window.location.href = backUrl();
    });
  }
  function start() {
    api('GET', 'api/state?t=' + Date.now(), null, function (err, d) {
      var want = (/[?&]scherm=([^&]+)/.exec(window.location.search) || [])[1], i;
      if (err) { toast(err); return; }
      state = d;
      (d.rooms || []).forEach(function (r) { r.tiles.forEach(function (t) { if (!tileById[t.id]) { tileById[t.id] = t; } }); });
      /* Lampen die nu in een groep zitten staan niet meer in de kamers; wel nodig voor namen. */
      (d.lights || []).forEach(function (l) { if (!tileById[l.id]) { tileById[l.id] = { id: l.id, name: l.name, kind: 'light', room: l.room }; } });
      groups = JSON.parse(JSON.stringify((d.layout && d.layout.groups) || []));
      syncGroupTiles();
      home = JSON.parse(JSON.stringify((d.layout && d.layout.home) || []));
      pages = JSON.parse(JSON.stringify((d.layout && d.layout.pages) || []));
      cur = -1;
      if (want && want.indexOf('page%3A') === 0) { want = 'page:' + want.slice(7); }
      for (i = 0; i < pages.length; i++) { if ('page:' + pages[i].id === want) { cur = i; } }
      tiles = cur < 0 ? home : pages[cur].tiles;
      /* Overgezette schermen (zoals 'Kamers') bestaan pas echt na opslaan. */
      if (!d.layout.pagesSaved && pages.length) { dirty = true; }
      document.body.className = 'theme-' + ((d.layout && d.layout.theme) || 'warm') + (isDark(d.layout) ? ' mode-dark' : '');
      try { window.localStorage.setItem('hp-theme', document.body.className); } catch (e) { /* privémodus */ }
      draw();
    });
    tap($('save'), save);
    tap($('cancel'), function () {
      if (dirty && !window.confirm('Wijzigingen weggooien?')) { return; }
      window.location.href = backUrl();
    });
    tap($('pk-close'), closePicker);
    tap($('pk-back'), function () { if (backFn) { backFn(); } else { openPicker(); } });
    $('picker').addEventListener('click', function (e) { if (e.target === $('picker')) { closePicker(); } }, false);
    window.addEventListener('resize', draw, false);
    window.addEventListener('orientationchange', function () { setTimeout(draw, 300); }, false);
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, false); } else { start(); }
}());
