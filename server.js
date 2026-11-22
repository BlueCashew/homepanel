'use strict';
/*
 * Huispaneel - klein servertje voor op de Homebridge-Pi.
 * Serveert het dashboard (public/) en zet aanroepen door naar:
 *   - de Homebridge UI REST API (accessoires + kamerindeling)
 *   - Sonos, lokaal via UPnP/SOAP op poort 1400
 *   - Open-Meteo voor het weer (optioneel)
 * Geen npm-pakketten nodig, alleen Node.js (staat al op de Pi voor Homebridge).
 *
 * Starten:  node server.js            (leest config.json naast dit bestand)
 *           node server.js --demo     (nepdata, zonder Homebridge of Sonos)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const { URL } = require('url');

const DEMO = process.argv.includes('--demo');
const ROOT = __dirname;
/* Proefstart tijdens een update: andere poort, niets wegschrijven, geen automatische updates. */
const SELFTEST = process.env.HUISPANEEL_SELFTEST === '1';

const CONFIG_FILE = process.env.HUISPANEEL_CONFIG || path.join(ROOT, 'config.json');
function loadConfig() {
  const file = CONFIG_FILE;
  let cfg = {};
  if (fs.existsSync(file)) {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (!DEMO) {
    console.log('[config] geen config.json gevonden, standaardwaarden gebruikt');
  }
  cfg.port = cfg.port || 8600;
  cfg.homebridge = Object.assign({ url: 'http://127.0.0.1:8581', username: '', password: '' }, cfg.homebridge || {});
  cfg.homebridge.url = String(cfg.homebridge.url).replace(/\/+$/, '');
  cfg.sonos = Object.assign({ enabled: true, host: '', room: '' }, cfg.sonos || {});
  cfg.weather = Object.assign({ latitude: null, longitude: null, place: '' }, cfg.weather || {});
  cfg.hue = Object.assign({ host: '', key: '', name: '' }, cfg.hue || {});
  cfg.atv = Object.assign({ id: '', name: '' }, cfg.atv || {});
  cfg.groups = Array.isArray(cfg.groups) ? cfg.groups : [];
  cfg.update = Object.assign({ auto: false, repo: 'BlueCashew/homepanel', branch: 'main' }, cfg.update || {});
  cfg.layout = Object.assign({ theme: 'warm', mode: 'light', schedule: 'sun', darkFrom: '21:00', darkTo: '07:00', home: null, screens: null }, cfg.layout || {});
  cfg.hide = cfg.hide || [];
  return cfg;
}
const config = loadConfig();
const LISTEN_PORT = Number(process.env.HUISPANEEL_PORT) || config.port;
function saveConfig() {
  if (SELFTEST || DEMO) return;
  const out = { port: config.port, homebridge: config.homebridge, hue: config.hue, atv: config.atv, groups: config.groups, sonos: config.sonos, weather: config.weather, update: config.update, layout: config.layout, hide: config.hide };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (e) { /* niet erg */ }
}

/* ------------------------------------------------------------------ http */

function request(method, target, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && !Buffer.isBuffer(body)) body = Buffer.from(String(body));
    if (body) headers['Content-Length'] = body.length;
    const req = lib.request({
      method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers,
      rejectUnauthorized: opts.insecure ? false : undefined, // de Hue Bridge gebruikt een eigen, niet-publiek certificaat
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) { req.destroy(new Error('antwoord te groot')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(opts.timeout || 6000, () => req.destroy(new Error('timeout ' + u.host)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------ homebridge */

const hb = { token: null, exp: 0, cache: null, cacheAt: 0, inflight: null, error: null };

/* Eén login tegelijk: gelijktijdige aanroepen wachten op dezelfde poging. */
function hbLogin() {
  if (!hb.login) {
    hb.login = hbLoginOnce().then(() => { hb.login = null; }, (e) => { hb.login = null; throw e; });
  }
  return hb.login;
}
async function hbLoginOnce() {
  const base = config.homebridge.url;
  let r;
  if (config.homebridge.username) {
    r = await request('POST', base + '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.homebridge.username, password: config.homebridge.password }),
    });
  } else {
    r = await request('POST', base + '/api/auth/noauth', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }
  if (r.status >= 400) {
    throw new Error('De Homebridge-login ontbreekt of klopt niet. Open /setup op dit adres om hem in te vullen.');
  }
  const j = JSON.parse(r.body.toString('utf8'));
  hb.token = j.access_token;
  hb.exp = Date.now() + (Math.max(120, Number(j.expires_in) || 3600) - 60) * 1000;
}

async function hbCall(method, p, body) {
  if (!hb.token || Date.now() > hb.exp) await hbLogin();
  const go = () => request(method, config.homebridge.url + p, {
    headers: { Authorization: 'Bearer ' + hb.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout: 10000,
  });
  const used = hb.token;
  let r = await go();
  if (r.status === 401) {
    if (hb.token === used) await hbLogin(); // niet opnieuw als een andere aanroep al een nieuw token haalde
    r = await go();
  }
  const text = r.body.toString('utf8');
  if (r.status >= 400) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) { /* geen json */ }
    throw new Error('Homebridge: ' + (Array.isArray(msg) ? msg.join(', ') : msg));
  }
  return text ? JSON.parse(text) : null;
}

async function hbLoad() {
  if (hb.cache && Date.now() - hb.cacheAt < 2000) return hb.cache;
  if (hb.inflight) return hb.inflight;
  hb.inflight = (async () => {
    try {
      const both = await Promise.all([hbCall('GET', '/api/accessories'), hbCall('GET', '/api/accessories/layout')]);
      hb.cache = { services: both[0] || [], layout: both[1] || [] };
      hb.cacheAt = Date.now();
      hb.error = null;
      if (hbMissing(hb.cache.services)) hbNudge();
      return hb.cache;
    } catch (e) {
      hb.error = e.message;
      throw e;
    } finally {
      hb.inflight = null;
    }
  })();
  return hb.inflight;
}

/* De Homebridge-webinterface zoekt de bridges maar één keer, in de eerste minuut na zijn eigen start.
   Is een (trage) bridge dan nog niet klaar, dan blijven de accessoires weg tot iemand in Homebridge
   de pagina Accessoires opent. Dat doet het paneel hier zelf: kort verbinden met die pagina
   (socket.io, namespace /accessories, 'get-accessories') laat de webinterface opnieuw zoeken. */
function hbMissing(services) {
  if (!services.length) return true;
  const have = {};
  services.forEach((x) => { have[x.uniqueId] = true; });
  const home = (config.layout && Array.isArray(config.layout.home)) ? config.layout.home : [];
  return home.some((t) => t.type === 'device' && t.ref && !/^hue:/.test(t.ref) && !have[t.ref]);
}
function hbNudge() {
  if (typeof WebSocket !== 'function' || !hb.token) return;
  if (hb.nudgeAt && Date.now() - hb.nudgeAt < 120000) return;
  hb.nudgeAt = Date.now();
  const url = config.homebridge.url.replace(/\/+$/, '').replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket&token=' + encodeURIComponent(hb.token);
  let ws;
  try { ws = new WebSocket(url); } catch (e) { return; }
  const done = setTimeout(() => { try { ws.close(); } catch (e) { /* al dicht */ } }, 15000);
  ws.onmessage = (ev) => {
    const m = String(ev.data);
    if (m.charAt(0) === '0') ws.send('40/accessories,' + JSON.stringify({ token: hb.token }));
    else if (m === '2') ws.send('3');
    else if (m.indexOf('40/accessories') === 0) { console.log('[homebridge] accessoires ontbreken; webinterface opnieuw laten zoeken'); ws.send('42/accessories,["get-accessories"]'); }
    else if (m.indexOf('42/accessories,["accessories-data"') === 0) { hb.cacheAt = 0; clearTimeout(done); setTimeout(() => { try { ws.close(); } catch (e) { /* al dicht */ } }, 2000); }
  };
  ws.onerror = () => {};
  ws.onclose = () => clearTimeout(done);
}

/* Waarden van een service: hap-client vult `values`, anders uit de characteristics halen. */
function valuesOf(s) {
  const v = {};
  (s.serviceCharacteristics || []).forEach((c) => { v[c.type] = c.value; });
  Object.keys(s.values || {}).forEach((k) => { v[k] = s.values[k]; });
  return v;
}
function writable(s, type) {
  return (s.serviceCharacteristics || []).some((c) => c.type === type && (c.canWrite || (c.perms || []).indexOf('pw') !== -1));
}
function charOf(s, type) {
  return (s.serviceCharacteristics || []).filter((c) => c.type === type)[0] || {};
}
/* Temperatuur met hooguit één decimaal: 19,5 of 20 */
function temp(n) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  return String(Math.round(n * 10) / 10).replace('.', ',');
}
function num(n, digits) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  return n.toFixed(digits === undefined ? 0 : digits).replace('.', ',');
}

const ACTIVE_TYPES = { Fanv2: 'fan', Television: 'tv', AirPurifier: 'fan', HeaterCooler: 'climate', HumidifierDehumidifier: 'climate', Valve: 'switch', Faucet: 'switch', IrrigationSystem: 'switch' };

/* Vertaalt een Homebridge-service naar een tegel. Geeft null voor types die we niet tonen. */
function toTile(s) {
  const v = valuesOf(s);
  const t = { id: s.uniqueId, name: s.serviceName || s.humanType || s.type, type: s.type, kind: 'switch', on: false, text: '', readonly: false };
  switch (s.type) {
    case 'Lightbulb':
      t.kind = 'light'; t.on = !!v.On; t.char = 'On'; t.onValue = true; t.offValue = false;
      if (typeof v.Brightness === 'number' && writable(s, 'Brightness')) { t.level = v.Brightness; t.levelChar = 'Brightness'; }
      t.text = t.on ? (t.level !== undefined ? num(t.level) + '%' : 'Aan') : 'Uit';
      break;
    case 'Switch':
    case 'Outlet':
    case 'Fan':
      t.kind = s.type === 'Outlet' ? 'outlet' : (s.type === 'Fan' ? 'fan' : 'switch');
      t.on = !!v.On; t.char = 'On'; t.onValue = true; t.offValue = false;
      t.text = t.on ? 'Aan' : 'Uit';
      break;
    case 'WindowCovering':
    case 'Window':
    case 'Door':
      t.kind = 'cover'; t.level = Number(v.CurrentPosition) || 0; t.on = t.level > 0;
      t.char = 'TargetPosition'; t.onValue = 100; t.offValue = 0; t.levelChar = 'TargetPosition';
      t.text = t.level >= 100 ? 'Open' : (t.level <= 0 ? 'Dicht' : num(t.level) + '%');
      break;
    case 'LockMechanism':
      t.kind = 'lock'; t.on = Number(v.LockCurrentState) !== 1;
      t.char = 'LockTargetState'; t.onValue = 0; t.offValue = 1; t.confirm = true;
      t.text = t.on ? 'Open' : 'Op slot';
      break;
    case 'GarageDoorOpener':
      t.kind = 'cover'; t.on = Number(v.CurrentDoorState) !== 1;
      t.char = 'TargetDoorState'; t.onValue = 0; t.offValue = 1; t.confirm = true;
      t.text = t.on ? 'Open' : 'Dicht';
      break;
    case 'TemperatureSensor':
      t.kind = 'sensor'; t.readonly = true; t.text = temp(v.CurrentTemperature) + '°';
      break;
    case 'HumiditySensor':
      t.kind = 'sensor'; t.readonly = true; t.text = num(v.CurrentRelativeHumidity) + '%';
      break;
    case 'Thermostat':
      t.kind = 'climate'; t.on = Number(v.CurrentHeatingCoolingState) > 0;
      t.cur = v.CurrentTemperature;
      t.text = temp(v.CurrentTemperature) + '°';
      if (typeof v.TargetTemperature === 'number') {
        if (Math.abs(v.TargetTemperature - v.CurrentTemperature) >= 0.5) t.text += ' → ' + temp(v.TargetTemperature) + '°';
        if (writable(s, 'TargetTemperature')) {
          const tc = charOf(s, 'TargetTemperature');
          t.stepper = true; t.level = v.TargetTemperature; t.levelChar = 'TargetTemperature';
          t.min = typeof tc.minValue === 'number' ? tc.minValue : 5;
          t.max = typeof tc.maxValue === 'number' ? tc.maxValue : 30;
          t.step = Math.max(0.5, Number(tc.minStep) || 0.5);
        }
      }
      if (!t.levelChar) t.readonly = true;
      break;
    case 'LightSensor':
      t.kind = 'sensor'; t.readonly = true; t.text = num(v.CurrentAmbientLightLevel) + ' lux';
      break;
    case 'MotionSensor':
      t.kind = 'sensor'; t.readonly = true; t.on = !!v.MotionDetected; t.text = t.on ? 'Beweging' : 'Rustig';
      break;
    case 'OccupancySensor':
      t.kind = 'sensor'; t.readonly = true; t.on = !!v.OccupancyDetected; t.text = t.on ? 'Aanwezig' : 'Leeg';
      break;
    case 'ContactSensor':
      t.kind = 'sensor'; t.readonly = true; t.on = Number(v.ContactSensorState) === 1; t.text = t.on ? 'Open' : 'Dicht';
      break;
    case 'LeakSensor':
      t.kind = 'sensor'; t.readonly = true; t.on = !!v.LeakDetected; t.text = t.on ? 'Lekkage!' : 'Droog';
      break;
    case 'SmokeSensor':
      t.kind = 'sensor'; t.readonly = true; t.on = !!v.SmokeDetected; t.text = t.on ? 'Rook!' : 'In orde';
      break;
    default:
      if (ACTIVE_TYPES[s.type] && writable(s, 'Active')) {
        t.kind = ACTIVE_TYPES[s.type]; t.on = Number(v.Active) === 1; t.char = 'Active'; t.onValue = 1; t.offValue = 0;
        t.text = t.on ? 'Aan' : 'Uit';
      } else if (writable(s, 'On')) {
        t.on = !!v.On; t.char = 'On'; t.onValue = true; t.offValue = false; t.text = t.on ? 'Aan' : 'Uit';
      } else {
        return null;
      }
  }
  if (Number(v.StatusFault) === 1 && !t.readonly) {
    /* Onbereikbaar (bijvoorbeeld uit bij de wandschakelaar): de laatst bekende stand zegt dan niets. */
    t.fault = true; t.on = false; t.text = 'Geen contact';
  }
  return t;
}

/* Zet services + kamerindeling van de Homebridge UI om naar kamers met tegels. */
function buildRooms(data, opts) {
  opts = opts || {};
  const hide = config.hide.map((x) => String(x).toLowerCase());
  const tiles = {};
  const byName = {};
  const order = [];
  data.services.forEach((s) => {
    if (!s || !s.uniqueId || s.hidden) return;
    /* homebridge-hue zet bij elke Hue-lamp een Resource als /lights/13; die komen dan rechtstreeks uit de bridge */
    if (opts.skipHue && /^\/(lights|groups|sensors)\//.test(String(valuesOf(s).Resource || ''))) return;
    const t = toTile(s);
    if (!t) return;
    tiles[s.uniqueId] = t;
    if (s.nameBasedUniqueId) byName[s.nameBasedUniqueId] = t;
    order.push(t);
  });
  const used = {};
  const rooms = [];
  const layout = Array.isArray(data.layout) ? data.layout : [];
  const hasDefault = layout.some((r) => r.isDefault);
  /* Oude indelingen kennen alleen een naam: die telt als er precies één accessoire zo heet. */
  const byLabel = (label) => {
    const hits = order.filter((t) => !used[t.id] && label && t.name === label);
    return hits.length === 1 ? hits[0] : null;
  };
  layout.forEach((room, idx) => {
    const list = [];
    if (!hasDefault && idx === 0) room = Object.assign({}, room, { isDefault: true });
    (room.services || []).forEach((ls) => {
      const t = tiles[ls.uniqueId] || byName[ls.nameBasedUniqueId] || byLabel(ls.name);
      if (!t || used[t.id]) return;
      used[t.id] = true;
      if (ls.customName) t.name = ls.customName;
      if (ls.hidden) return;
      list.push(t);
    });
    rooms.push({ name: room.isDefault && room.name === 'Default Room' ? 'Overig' : room.name, isDefault: !!room.isDefault, tiles: list });
  });
  const rest = order.filter((t) => !used[t.id]);
  if (rest.length) {
    const def = rooms.filter((r) => r.isDefault)[0];
    if (def) def.tiles = def.tiles.concat(rest); else rooms.push({ name: 'Overig', isDefault: true, tiles: rest });
  }
  rooms.forEach((r) => { r.tiles = r.tiles.filter((t) => hide.indexOf(String(t.name).toLowerCase()) === -1); });
  const out = rooms.filter((r) => r.tiles.length).map((r) => ({ name: r.name, key: 'hb:' + r.name, tiles: r.tiles }));
  if (out.length === 1) out[0].name = 'Thuis';
  return out;
}

async function hbSet(id, char, value) {
  const data = await hbLoad();
  const s = data.services.filter((x) => x.uniqueId === id)[0];
  if (!s) throw new Error('Onbekend accessoire');
  if (!writable(s, char)) throw new Error('Deze eigenschap is niet te bedienen: ' + char);
  const c = charOf(s, char);
  if (typeof value === 'number' && ((typeof c.minValue === 'number' && value < c.minValue) || (typeof c.maxValue === 'number' && value > c.maxValue))) {
    throw new Error('Waarde buiten het bereik van ' + c.minValue + ' tot ' + c.maxValue);
  }
  await hbCall('PUT', '/api/accessories/' + encodeURIComponent(id), { characteristicType: char, value });
  hb.cacheAt = 0;
}

/* ----------------------------------------------------------------- sonos */

const sonos = { host: null, room: '', foundAt: 0, fails: 0, cache: null, cacheAt: 0, inflight: null, error: null, art: {} };

function unesc(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function tag(xml, name) {
  const m = new RegExp('<(?:[\\w-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>').exec(xml || '');
  return m ? m[1] : '';
}
function attr(xml, name) {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(xml || '');
  return m ? unesc(m[1]) : '';
}

const SOAP = {
  av: { path: '/MediaRenderer/AVTransport/Control', urn: 'urn:schemas-upnp-org:service:AVTransport:1' },
  rc: { path: '/MediaRenderer/RenderingControl/Control', urn: 'urn:schemas-upnp-org:service:RenderingControl:1' },
  zt: { path: '/ZoneGroupTopology/Control', urn: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1' },
  cd: { path: '/MediaServer/ContentDirectory/Control', urn: 'urn:schemas-upnp-org:service:ContentDirectory:1' },
};

async function soap(host, svc, action, args) {
  const s = SOAP[svc];
  let inner = '';
  Object.keys(args || {}).forEach((k) => { inner += '<' + k + '>' + esc(args[k]) + '</' + k + '>'; });
  const body = '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body><u:' + action + ' xmlns:u="' + s.urn + '">' + inner + '</u:' + action + '></s:Body></s:Envelope>';
  const r = await request('POST', 'http://' + host + ':1400' + s.path, {
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"' + s.urn + '#' + action + '"' },
    body, timeout: 4000,
  });
  const text = r.body.toString('utf8');
  if (r.status >= 400) throw new Error('Sonos ' + action + ' mislukt (' + (tag(text, 'errorCode') || r.status) + ')');
  return text;
}

function ssdp(ms) {
  return ssdpSearch('urn:schemas-upnp-org:device:ZonePlayer:1', ms, (text) => {
    const m = /LOCATION:\s*http:\/\/([^:\/\s]+):1400\//i.exec(text); // alleen Sonos: een Hue-bridge antwoordt ook op deze zoekvraag
    return m && m[1];
  });
}

function ssdpSearch(st, ms, pick) {
  return new Promise((resolve) => {
    const hosts = [];
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { resolve(hosts); return; }
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ' + st + '\r\n\r\n');
    sock.on('message', (buf) => {
      const h = pick(buf.toString());
      if (h && hosts.indexOf(h) === -1) hosts.push(h);
    });
    sock.on('error', () => {});
    sock.bind(() => {
      const send = () => { try { sock.send(msg, 0, msg.length, 1900, '239.255.255.250'); } catch (e) { /* negeren */ } };
      send(); setTimeout(send, 400);
    });
    setTimeout(() => { try { sock.close(); } catch (e) { /* al dicht */ } resolve(hosts); }, ms);
  });
}

/* Zoekt de coordinator van een Sonos-groep (bij een soundbar met surrounds: de soundbar). */
function parseZones(xml) {
  const state = unesc(tag(xml, 'ZoneGroupState'));
  const groups = [];
  const re = /<ZoneGroup\s([^>]*)>([\s\S]*?)<\/ZoneGroup>/g;
  let m;
  while ((m = re.exec(state))) {
    const coord = attr(' ' + m[1], 'Coordinator');
    const mre = /<ZoneGroupMember\s([^>]*?)\/?>/g;
    let mm;
    while ((mm = mre.exec(m[2]))) {
      const a = ' ' + mm[1];
      if (attr(a, 'UUID') !== coord) continue;
      const loc = /http:\/\/([^:\/]+)/.exec(attr(a, 'Location'));
      if (loc && attr(a, 'Invisible') !== '1') groups.push({ host: loc[1], room: attr(a, 'ZoneName'), uuid: coord });
    }
  }
  return groups;
}

async function sonosFind() {
  if (sonos.host && Date.now() - sonos.foundAt < 10 * 60 * 1000 && sonos.fails < 3) return sonos.host;
  let seeds = config.sonos.host ? [config.sonos.host] : await ssdp(1800);
  if (!seeds.length && sonos.host) seeds = [sonos.host];
  if (!seeds.length) throw new Error('Geen Sonos gevonden op het netwerk. Vul eventueel sonos.host in config.json in.');
  let groups = [];
  try { groups = parseZones(await soap(seeds[0], 'zt', 'GetZoneGroupState', {})); } catch (e) { /* val terug op de seed */ }
  let pick = null;
  if (config.sonos.room) pick = groups.filter((g) => g.room.toLowerCase() === String(config.sonos.room).toLowerCase())[0];
  if (!pick && config.sonos.host) pick = groups.filter((g) => g.host === config.sonos.host)[0];
  if (!pick) pick = groups[0] || { host: seeds[0], room: '' };
  sonos.host = pick.host; sonos.room = pick.room; sonos.uuid = pick.uuid || ''; sonos.foundAt = Date.now(); sonos.fails = 0;
  if (!sonos.uuid) {
    try {
      const d = await request('GET', 'http://' + sonos.host + ':1400/xml/device_description.xml', { timeout: 4000 });
      sonos.uuid = (/<UDN>uuid:([^<]+)<\/UDN>/.exec(d.body.toString('utf8')) || [])[1] || '';
    } catch (e) { /* zonder uuid geen wachtrij */ }
  }
  console.log('[sonos] gebruikt ' + (sonos.room || 'speler') + ' op ' + sonos.host);
  return sonos.host;
}

/* Hoezen lopen via de Pi: de iPad hoeft dan geen externe servers te vertrouwen, en ze worden bewaard. */
const art = new Map();
/* Eén sleutel voor een lijst adressen: de eerste die een afbeelding geeft, wint. */
function artKey(urls) {
  urls = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const k = crypto.createHash('sha1').update(urls.join('|')).digest('hex').slice(0, 12);
  if (!art.has(k)) {
    art.set(k, { urls, data: null, type: null, failedAt: 0 });
    while (art.size > 80) art.delete(art.keys().next().value);
  }
  return k;
}

async function sonosLoad() {
  if (sonos.cache && Date.now() - sonos.cacheAt < 1500) return sonos.cache;
  if (sonos.inflight) return sonos.inflight;
  sonos.inflight = (async () => {
    try {
      const host = await sonosFind();
      const a = { InstanceID: 0 };
      const r = await Promise.all([
        soap(host, 'av', 'GetTransportInfo', a),
        soap(host, 'av', 'GetPositionInfo', a),
        soap(host, 'av', 'GetMediaInfo', a),
        soap(host, 'rc', 'GetVolume', { InstanceID: 0, Channel: 'Master' }),
        soap(host, 'rc', 'GetMute', { InstanceID: 0, Channel: 'Master' }),
      ]);
      const ts = tag(r[0], 'CurrentTransportState');
      const uri = unesc(tag(r[1], 'TrackURI'));
      const meta = unesc(tag(r[1], 'TrackMetaData'));
      const mediaMeta = unesc(tag(r[2], 'CurrentURIMetaData'));
      const out = {
        ok: true, room: sonos.room,
        state: ts === 'PLAYING' || ts === 'TRANSITIONING' ? 'playing' : (ts === 'PAUSED_PLAYBACK' ? 'paused' : 'stopped'),
        source: 'music', title: unesc(tag(meta, 'title')), artist: unesc(tag(meta, 'creator')), album: unesc(tag(meta, 'album')),
        art: '', volume: Number(tag(r[3], 'CurrentVolume')) || 0, mute: tag(r[4], 'CurrentMute') === '1', canSkip: true,
      };
      if (/^x-sonos-htastream:/.test(uri)) {
        out.source = 'tv'; out.title = 'TV'; out.artist = ''; out.album = ''; out.canSkip = false;
      } else if (/^x-rincon-stream:/.test(uri)) {
        out.source = 'linein'; out.title = 'Lijningang'; out.artist = ''; out.canSkip = false;
      } else if (!uri) {
        out.source = 'none'; out.title = ''; out.canSkip = false;
      } else {
        const station = unesc(tag(mediaMeta, 'title'));
        const stream = unesc(tag(meta, 'streamContent'));
        const mediaUri = unesc(tag(r[2], 'CurrentURI'));
        const isRadio = /^(x-sonosapi-stream|x-sonosapi-radio|x-rincon-mp3radio|aac:|hls-radio|x-sonosapi-hls)/.test(mediaUri || uri);
        if (isRadio) {
          out.source = 'radio'; out.canSkip = /x-sonosapi-radio/.test(mediaUri);
          /* Bij radio is de titel vaak de technische streamnaam (bijv. 'radio2-bb-aac'): dan de zendernaam tonen. */
          const junk = (t) => !t || /\.(mp3|aac|m3u8?)|^x-|^[\w.-]+$/i.test(t) && !/\s/.test(t);
          if (stream && !junk(stream)) {
            out.title = stream; out.artist = station || out.artist;
          } else if (junk(out.title)) {
            out.title = station || out.artist || 'Radio'; out.artist = station && out.artist !== station ? out.artist : 'Radio';
          } else if (!out.artist) {
            out.artist = station;
          }
        }
        /* Hoes: eerst die van het nummer, dan die van de zender/het album; bij radio levert de Sonos zelf het zenderlogo. */
        const abs = (x) => (x && x.charAt(0) === '/' ? 'http://' + host + ':1400' + x : x);
        const urls = [abs(unesc(tag(meta, 'albumArtURI'))), abs(unesc(tag(mediaMeta, 'albumArtURI')))];
        if (isRadio && mediaUri) urls.push('http://' + host + ':1400/getaa?s=1&u=' + encodeURIComponent(mediaUri));
        if (urls.some(Boolean)) out.art = '/api/sonos/art?k=' + artKey(urls);
      }
      sonos.cache = out; sonos.cacheAt = Date.now(); sonos.error = null; sonos.fails = 0;
      return out;
    } catch (e) {
      sonos.fails++; sonos.error = e.message;
      throw e;
    } finally {
      sonos.inflight = null;
    }
  })();
  return sonos.inflight;
}

async function sonosDo(action, value) {
  const host = await sonosFind();
  const a = { InstanceID: 0 };
  if (action === 'toggle') {
    const cur = await sonosLoad();
    action = cur.state === 'playing' ? 'pause' : 'play';
  }
  if (action === 'play') await soap(host, 'av', 'Play', { InstanceID: 0, Speed: 1 });
  else if (action === 'pause') await soap(host, 'av', 'Pause', a);
  else if (action === 'next') await soap(host, 'av', 'Next', a);
  else if (action === 'prev') await soap(host, 'av', 'Previous', a);
  else if (action === 'volume') {
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (isNaN(v)) throw new Error('Ongeldig volume');
    await soap(host, 'rc', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: v });
  } else if (action === 'mute') await soap(host, 'rc', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: value ? 1 : 0 });
  else if (action === 'favorite') { await playFavorite(String(value)); return; }
  else throw new Error('Onbekende Sonos-actie');
  sonos.cacheAt = 0;
}

async function sonosArt(key) {
  const a = art.get(key);
  if (!a) return null;
  if (a.data) return a;
  if (a.failedAt && Date.now() - a.failedAt < 60000) return null; // niet elke paar seconden opnieuw proberen
  for (const first of a.urls) {
    let url = first;
    try {
      for (let i = 0; i < 4; i++) {
        const r = await request('GET', url, { timeout: 8000 });
        if (r.status >= 300 && r.status < 400 && r.headers.location) { url = new URL(r.headers.location, url).toString(); continue; }
        const type = String(r.headers['content-type'] || '');
        if (r.status === 200 && r.body.length > 0 && r.body.length <= 4 * 1024 * 1024 && (!type || /^image\//.test(type))) {
          a.data = r.body; a.type = type || 'image/jpeg';
          return a;
        }
        break;
      }
    } catch (e) { /* volgende adres proberen */ }
  }
  a.failedAt = Date.now();
  return null;
}

/* ----------------------------------------------------- sonos-favorieten */

const favs = { list: null, at: 0, inflight: null, items: {} };

function parseDidl(didl, host) {
  const out = [];
  const re = /<(item|container)\s([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(didl))) {
    const body = m[3];
    const id = attr(' ' + m[2], 'id');
    const uri = unesc(tag(body, 'res'));
    if (!id || !uri) continue;
    let a = unesc(tag(body, 'albumArtURI'));
    if (a && a.charAt(0) === '/') a = 'http://' + host + ':1400' + a;
    out.push({
      id, title: unesc(tag(body, 'title')), desc: unesc(tag(body, 'description')),
      uri, meta: unesc(tag(body, 'resMD')), art: a,
    });
  }
  return out;
}

async function browse(host, objectId) {
  const xml = await soap(host, 'cd', 'Browse', { ObjectID: objectId, BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: 100, SortCriteria: '' });
  return parseDidl(unesc(tag(xml, 'Result')), host);
}

async function favLoad() {
  if (favs.list && Date.now() - favs.at < 60000) return favs.list;
  if (favs.inflight) return favs.inflight;
  favs.inflight = (async () => {
    try {
      const host = await sonosFind();
      const list = [];
      const items = {};
      const add = (x, kind) => {
        items[x.id] = x;
        list.push({ id: x.id, title: x.title, desc: kind === 'playlist' ? 'Sonos-playlist' : x.desc, kind, art: x.art ? '/api/sonos/art?k=' + artKey(x.art) : '' });
      };
      (await browse(host, 'FV:2')).forEach((x) => add(x, 'favorite'));
      try { (await browse(host, 'SQ:')).forEach((x) => add(x, 'playlist')); } catch (e) { /* geen playlists */ }
      favs.list = list; favs.items = items; favs.at = Date.now();
      return list;
    } finally {
      favs.inflight = null;
    }
  })();
  return favs.inflight;
}

/* Een favoriet afspelen: playlists en albums via de wachtrij, zenders en losse nummers direct. */
async function playFavorite(id) {
  if (!favs.items[id]) { favs.at = 0; await favLoad(); }
  const f = favs.items[id];
  if (!f) throw new Error('Deze favoriet bestaat niet meer');
  const host = await sonosFind();
  const isStream = /^(x-sonosapi-stream|x-sonosapi-radio|x-rincon-mp3radio|x-sonosapi-hls|aac:|hls-radio)/.test(f.uri);
  const isContainer = !isStream && (/^x-rincon-cpcontainer:|^file:\/\/\/jffs\/settings\/savedqueues/.test(f.uri) || /<upnp:class>[^<]*container/i.test(f.meta));
  if (isContainer) {
    if (!sonos.uuid) throw new Error('Onbekende Sonos-speler');
    await soap(host, 'av', 'RemoveAllTracksFromQueue', { InstanceID: 0 });
    await soap(host, 'av', 'AddURIToQueue', { InstanceID: 0, EnqueuedURI: f.uri, EnqueuedURIMetaData: f.meta, DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 });
    await soap(host, 'av', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: 'x-rincon-queue:' + sonos.uuid + '#0', CurrentURIMetaData: '' });
  } else {
    await soap(host, 'av', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: f.uri, CurrentURIMetaData: f.meta });
  }
  await soap(host, 'av', 'Play', { InstanceID: 0, Speed: 1 });
  sonos.cacheAt = 0;
}

/* ------------------------------------------------------------------- hue */

const hue = { cache: null, cacheAt: 0, inflight: null, error: null, pairing: null, lastFind: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hueBase(host) {
  host = String(host || config.hue.host || '');
  return /^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : 'https://' + host;
}

async function hueCall(method, p, body) {
  const r = await request(method, hueBase() + p, {
    headers: { 'hue-application-key': config.hue.key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), timeout: 6000, insecure: true,
  });
  let j = null;
  try { j = JSON.parse(r.body.toString('utf8')); } catch (e) { /* geen json */ }
  if (r.status === 401 || r.status === 403) throw new Error('De Hue-koppeling is niet meer geldig. Koppel opnieuw via /setup.');
  if (r.status >= 400) throw new Error('Hue: ' + ((j && j.errors && j.errors[0] && j.errors[0].description) || 'HTTP ' + r.status));
  return j || {};
}

/* Controleert of er op dit adres een Hue Bridge zit; geeft naam en id terug. Hiervoor is geen sleutel nodig. */
async function hueInfo(host) {
  const r = await request('GET', hueBase(host) + '/api/0/config', { timeout: 4000, insecure: true });
  let j = null;
  try { j = JSON.parse(r.body.toString('utf8')); } catch (e) { /* geen json */ }
  if (!j || !j.bridgeid) throw new Error('Op ' + host + ' zit geen Hue Bridge.');
  return { name: j.name || 'Hue Bridge', id: j.bridgeid };
}

/* Zoekt de bridge op het netwerk (SSDP), anders via de zoekdienst van Philips. */
async function hueDiscover() {
  const found = await ssdpSearch('ssdp:all', 2500, (text) => {
    if (!/IpBridge/i.test(text)) return null;
    const m = /LOCATION:\s*https?:\/\/([^:\/\s]+)/i.exec(text);
    return m && m[1];
  });
  if (!found.length) {
    try {
      const r = await request('GET', 'https://discovery.meethue.com/', { timeout: 6000 });
      const list = r.status === 200 ? JSON.parse(r.body.toString('utf8')) : [];
      list.forEach((b) => { if (b.internalipaddress) found.push(b.internalipaddress); });
    } catch (e) { /* geen internet of geen antwoord */ }
  }
  for (let i = 0; i < found.length; i++) {
    try { await hueInfo(found[i]); return found[i]; } catch (e) { /* volgende */ }
  }
  return null;
}

async function hueLoad() {
  if (hue.cache && Date.now() - hue.cacheAt < 2000) return hue.cache;
  if (hue.inflight) return hue.inflight;
  hue.inflight = (async () => {
    const gen = hue.gen || 0;
    try {
      const j = await hueCall('GET', '/clip/v2/resource');
      const by = {};
      (j.data || []).forEach((x) => { by[x.id] = x; });
      hue.cache = { list: j.data || [], by };
      /* Is er tijdens het ophalen iets geschakeld, dan is dit antwoord al verouderd: niet bewaren als vers. */
      hue.cacheAt = (hue.gen || 0) === gen ? Date.now() : 0;
      hue.error = null;
      return hue.cache;
    } catch (e) {
      hue.error = e.message;
      /* Geen antwoord: misschien heeft de bridge een ander IP-adres gekregen. Hooguit eens per 5 minuten zoeken. */
      if (!/koppeling|Hue:/.test(e.message) && Date.now() - hue.lastFind > 5 * 60 * 1000) {
        hue.lastFind = Date.now();
        hueDiscover().then((h) => {
          if (h && h !== config.hue.host) { console.log('[hue] bridge gevonden op nieuw adres ' + h); config.hue.host = h; saveConfig(); }
        }, () => {});
      }
      throw e;
    } finally {
      hue.inflight = null;
    }
  })();
  return hue.inflight;
}

/* Koppelen: een minuut lang elke 2 seconden vragen om een sleutel, terwijl iemand op de knop van de bridge drukt. */
async function huePairStart(host) {
  if (hue.pairing && !hue.pairing.done && Date.now() < hue.pairing.until) return;
  host = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host && !/^[\w.:-]+$/.test(host)) throw new Error('Ongeldig adres');
  if (!host) host = config.hue.host;
  if (!host) host = await hueDiscover();
  if (!host) throw new Error('Geen Hue Bridge gevonden op het netwerk. Vul het IP-adres in.');
  const info = await hueInfo(host);
  const p = { host, name: info.name, until: Date.now() + 60000, done: false, expired: false, error: null };
  hue.pairing = p;
  (async () => {
    while (Date.now() < p.until && hue.pairing === p) {
      try {
        const r = await request('POST', hueBase(host) + '/api', {
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devicetype: 'huispaneel#pi' }), timeout: 5000, insecure: true,
        });
        const j = JSON.parse(r.body.toString('utf8'));
        const ok = Array.isArray(j) && j[0] && j[0].success && j[0].success.username;
        if (ok) {
          config.hue.host = host; config.hue.key = ok; config.hue.name = info.name;
          saveConfig();
          hue.cache = null; hue.cacheAt = 0; hue.error = null;
          p.done = true;
          console.log('[hue] gekoppeld met ' + info.name + ' op ' + host);
          return;
        }
        const err = Array.isArray(j) && j[0] && j[0].error;
        p.error = err && err.type !== 101 ? err.description : null; // 101 = knop nog niet ingedrukt
      } catch (e) {
        p.error = e.message;
      }
      await sleep(2000);
    }
    if (!p.done) p.expired = true;
  })();
}

function hueStatus() {
  const p = hue.pairing;
  return {
    paired: !!config.hue.key, host: config.hue.host, name: config.hue.name,
    ok: !!config.hue.key && !!hue.cache && !hue.error, error: config.hue.key ? hue.error : null,
    pairing: p ? { active: !p.done && !p.expired, secondsLeft: Math.max(0, Math.round((p.until - Date.now()) / 1000)), done: p.done, expired: p.expired, error: p.error, host: p.host, name: p.name } : null,
  };
}

/* Zet Hue-kamers, -zones, -lampen en -scènes om naar tegels. */
function hueRooms(data) {
  const by = data.by;
  const hide = config.hide.map((x) => String(x).toLowerCase());
  const conn = {};
  data.list.forEach((x) => { if (x.type === 'zigbee_connectivity' && x.owner) conn[x.owner.rid] = x.status; });
  const used = {};

  function lightTile(l) {
    const t = { id: 'hue:light:' + l.id, name: (l.metadata && l.metadata.name) || 'Lamp', type: 'HueLight', kind: 'light', on: !!(l.on && l.on.on), char: 'on', onValue: true, offValue: false };
    if (l.dimming) { t.level = Math.round(l.dimming.brightness); t.levelChar = 'brightness'; }
    const ct = l.color_temperature;
    if (ct && ct.mirek_schema && ct.mirek_schema.mirek_maximum > ct.mirek_schema.mirek_minimum) {
      const lo = ct.mirek_schema.mirek_minimum, hi = ct.mirek_schema.mirek_maximum;
      t.ctChar = 'ct';
      /* 0 = warm, 100 = koel */
      t.ct = ct.mirek_valid && typeof ct.mirek === 'number' ? Math.round((hi - Math.max(lo, Math.min(hi, ct.mirek))) / (hi - lo) * 100) : null;
    }
    t.text = t.on ? (t.level !== undefined ? t.level + '%' : 'Aan') : 'Uit';
    const st = l.owner && conn[l.owner.rid];
    if (st && st !== 'connected') { t.fault = true; t.on = false; t.text = 'Geen contact'; }
    return t;
  }
  function lightsOf(group) {
    const out = [];
    (group.children || []).forEach((c) => {
      if (c.rtype === 'light' && by[c.rid]) out.push(by[c.rid]);
      if (c.rtype === 'device' && by[c.rid]) (by[c.rid].services || []).forEach((sv) => { if (sv.rtype === 'light' && by[sv.rid]) out.push(by[sv.rid]); });
    });
    return out;
  }

  const rooms = [];
  ['room', 'zone'].forEach((type) => {
    data.list.filter((x) => x.type === type).forEach((g) => {
      const lights = lightsOf(g);
      if (!lights.length) return;
      const tiles = [];
      const glRef = (g.services || []).filter((sv) => sv.rtype === 'grouped_light')[0];
      const gl = glRef && by[glRef.rid];
      if (gl && lights.length > 1) {
        const t = { id: 'hue:group:' + gl.id, name: 'Alle lampen', type: 'HueGroup', kind: 'light', on: !!(gl.on && gl.on.on), char: 'on', onValue: true, offValue: false };
        if (gl.dimming) { t.level = Math.round(gl.dimming.brightness); t.levelChar = 'brightness'; }
        t.text = t.on ? (t.level !== undefined ? t.level + '%' : 'Aan') : 'Uit';
        tiles.push(t);
      }
      lights.forEach((l) => { if (type === 'room') used[l.id] = true; tiles.push(lightTile(l)); });
      data.list.filter((x) => x.type === 'scene' && x.group && x.group.rid === g.id)
        .sort((a, b) => String(a.metadata && a.metadata.name).localeCompare(String(b.metadata && b.metadata.name)))
        .forEach((sc) => {
          const on = !!(sc.status && sc.status.active && sc.status.active !== 'inactive');
          tiles.push({ id: 'hue:scene:' + sc.id, name: (sc.metadata && sc.metadata.name) || 'Scène', type: 'HueScene', kind: 'scene', group: g.id, on, char: 'recall', onValue: true, offValue: true, text: on ? 'Actief' : '' });
        });
      rooms.push({ name: (g.metadata && g.metadata.name) || (type === 'room' ? 'Kamer' : 'Zone'), key: 'hue:' + type + ':' + g.id, zone: type === 'zone', tiles: tiles.filter((t) => hide.indexOf(String(t.name).toLowerCase()) === -1) });
    });
  });
  const loose = data.list.filter((x) => x.type === 'light' && !used[x.id]).map(lightTile)
    .filter((t) => hide.indexOf(String(t.name).toLowerCase()) === -1);
  return { rooms: rooms.filter((r) => r.tiles.length), loose };
}

async function hueSet(id, ch, value) {
  const parts = String(id).split(':');
  const kind = parts[1], rid = parts[2];
  const data = await hueLoad();
  const res = data.by[rid];
  const want = { light: 'light', group: 'grouped_light', scene: 'scene' }[kind];
  if (!res || res.type !== want) throw new Error('Onbekend Hue-onderdeel');
  let body = null;
  if (kind === 'scene') {
    if (ch === 'recall') body = { recall: { action: 'active' } };
  } else if (ch === 'on' && typeof value === 'boolean') {
    body = { on: { on: value } };
  } else if (ch === 'brightness' && typeof value === 'number' && res.dimming) {
    body = { dimming: { brightness: Math.max(1, Math.min(100, Math.round(value))) } };
  } else if (ch === 'ct' && typeof value === 'number' && kind === 'light' && res.color_temperature && res.color_temperature.mirek_schema) {
    const lo = res.color_temperature.mirek_schema.mirek_minimum, hi = res.color_temperature.mirek_schema.mirek_maximum;
    body = { color_temperature: { mirek: Math.round(hi - Math.max(0, Math.min(100, value)) / 100 * (hi - lo)) } };
  }
  if (!body) throw new Error('Deze bediening kan niet bij dit Hue-onderdeel');
  /* Scènes na elkaar naar de bridge sturen, zodat de laatst getikte scène ook echt als laatste aankomt. */
  const run = () => hueCall('PUT', '/clip/v2/resource/' + want + '/' + rid, body);
  if (kind === 'scene') {
    const p = (hue.sceneQueue || Promise.resolve()).then(run, run);
    hue.sceneQueue = p.catch(() => {});
    await p;
  } else {
    await run();
  }
  hue.gen = (hue.gen || 0) + 1;
  hue.cacheAt = 0;
}

/* -------------------------------------------------------------- indeling */

const GRID = { cols: 4, rows: 3 };
const THEMES = ['warm', 'oceaan', 'bos', 'zand'];
// Weergave staat los van het thema: licht, donker of automatisch op tijd.
const MODES = ['light', 'dark', 'auto'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/* Controleert een indeling: binnen het raster, niets over elkaar heen, alleen bekende soorten tegels. */
const TILE_TYPES = ['device', 'clock', 'weather', 'nowplaying', 'atv', 'room'];
function cleanHome(tiles) {
  if (!Array.isArray(tiles)) throw new Error('Ongeldige indeling');
  // Rijen werken in halve stappen: scènes kunnen een halve tegel hoog zijn.
  const used = {};
  const out = [];
  tiles.slice(0, GRID.cols * GRID.rows * 2).forEach((t) => {
    if (!t || TILE_TYPES.indexOf(t.type) === -1) return;
    const w = t.w === 2 ? 2 : 1;
    const h = t.h === 2 ? 2 : (t.h === 0.5 && (t.type === 'device' || t.type === 'room') ? 0.5 : 1);
    const x = Math.floor(Number(t.x)), y2 = Math.floor(Number(t.y) * 2), h2 = h * 2;
    if (!(x >= 0 && y2 >= 0 && x + w <= GRID.cols && y2 + h2 <= GRID.rows * 2)) return;
    if ((t.type === 'device' || t.type === 'room') && (typeof t.ref !== 'string' || !t.ref || t.ref.length > 200)) return;
    for (let i = x; i < x + w; i++) for (let j = y2; j < y2 + h2; j++) if (used[i + ',' + j]) return;
    for (let i = x; i < x + w; i++) for (let j = y2; j < y2 + h2; j++) used[i + ',' + j] = true;
    const c = { type: t.type, x, y: y2 / 2, w, h };
    if (t.type === 'device' || t.type === 'room') c.ref = t.ref;
    if (t.type === 'clock') c.variant = t.variant === 'digital' ? 'digital' : 'analog';
    out.push(c);
  });
  return out;
}
function cleanScreens(list) {
  if (!Array.isArray(list)) throw new Error('Ongeldige schermen');
  const seen = {};
  return list.slice(0, 100).filter((x) => x && typeof x.key === 'string' && x.key.length <= 160 && !seen[x.key] && (seen[x.key] = true))
    .map((x) => ({ key: x.key, on: !!x.on }));
}

/* Standaardindeling zolang er niets is ingedeeld. */
function defaultHome(rooms) {
  const all = [];
  rooms.forEach((r) => r.tiles.forEach((t) => all.push(t)));
  const thermo = all.filter((t) => t.kind === 'climate' && !t.readonly)[0];
  const tiles = [];
  if (thermo) {
    tiles.push({ type: 'device', ref: thermo.id, x: 0, y: 0, w: 2, h: 2 });
    tiles.push({ type: 'clock', variant: 'analog', x: 2, y: 0, w: 1, h: 1 });
    tiles.push({ type: 'weather', x: 3, y: 0, w: 1, h: 1 });
  } else {
    tiles.push({ type: 'clock', variant: 'analog', x: 0, y: 0, w: 2, h: 2 });
    tiles.push({ type: 'weather', x: 2, y: 0, w: 2, h: 1 });
  }
  tiles.push({ type: 'nowplaying', x: 2, y: 1, w: 2, h: 1 });
  const picks = all.filter((t) => t !== thermo && !t.readonly && (t.name === 'Alle lampen' || t.kind === 'switch' || t.kind === 'scene'));
  const seen = {};
  const uniq = picks.filter((t) => !seen[t.id] && (seen[t.id] = true));
  // Gewone tegels eerst, scènes en lampen daarna als halve tegels (twee per vak).
  let col = 0, half = 0;
  const isHalf = (t) => t.kind === 'scene' || t.kind === 'light';
  uniq.filter((t) => !isHalf(t)).slice(0, uniq.some(isHalf) ? 2 : 4).forEach((t) => tiles.push({ type: 'device', ref: t.id, x: col++, y: 2, w: 1, h: 1 }));
  uniq.filter(isHalf).forEach((t) => {
    if (col >= GRID.cols) return;
    tiles.push({ type: 'device', ref: t.id, x: col, y: 2 + half * 0.5, w: 1, h: 0.5 });
    if (half) { col++; half = 0; } else half = 1;
  });
  return tiles;
}

/* Schermen: opgeslagen volgorde, nieuwe kamers erachter (zones standaard uit). */
function screensOut(rooms) {
  const saved = Array.isArray(config.layout.screens) ? config.layout.screens : [];
  const byKey = {};
  rooms.forEach((r) => { byKey[r.key] = r; });
  byKey.clock = { key: 'clock', name: 'Klok', zone: false, special: true };
  const hasAtv = DEMO || !!config.atv.id;
  if (hasAtv) byKey.atv = { key: 'atv', name: 'Apple TV', zone: false, special: true };
  const out = [];
  const seen = {};
  saved.forEach((x) => { if (byKey[x.key] && !seen[x.key]) { seen[x.key] = true; out.push({ key: x.key, name: byKey[x.key].name, zone: !!byKey[x.key].zone, on: x.on }); } });
  rooms.forEach((r) => { if (!seen[r.key]) { seen[r.key] = true; out.push({ key: r.key, name: r.name, zone: !!r.zone, on: !r.zone }); } });
  if (!seen.clock) out.push({ key: 'clock', name: 'Klok', zone: false, on: false });
  /* Net gekoppeld: de Apple TV komt vooraan, direct na het beginscherm. */
  if (hasAtv && !seen.atv) out.unshift({ key: 'atv', name: 'Apple TV', zone: false, on: true });
  return out;
}

/* Eigen schermen: elk een naam en een eigen raster met tegels, net als het beginscherm. */
function cleanPages(list) {
  if (!Array.isArray(list)) throw new Error('Ongeldige schermen');
  const seen = {};
  return list.slice(0, 12).map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error('Ongeldig scherm');
    let id = typeof p.id === 'string' && /^[a-z0-9]{1,16}$/.test(p.id) && !seen[p.id] ? p.id : '';
    while (!id || seen[id]) id = 'p' + crypto.randomBytes(4).toString('hex');
    seen[id] = true;
    const name = String(p.name || '').trim().slice(0, 40) || 'Scherm ' + (i + 1);
    return { id, name, tiles: cleanHome(Array.isArray(p.tiles) ? p.tiles : []) };
  });
}
/* Eerste keer na de overstap: de kamerschermen die aan stonden, worden kamerknoppen op een scherm 'Kamers'. */
function defaultPages(rooms) {
  const saved = Array.isArray(config.layout.screens) ? config.layout.screens : null;
  const keys = saved ? saved.filter((x) => x.on && x.key !== 'clock' && x.key !== 'atv').map((x) => x.key)
    : rooms.filter((r) => !r.zone).map((r) => r.key);
  const have = {};
  rooms.forEach((r) => { have[r.key] = true; });
  const list = keys.filter((k) => have[k]);
  const half = list.length > GRID.cols * GRID.rows; // veel kamers: knoppen van halve hoogte, twee per vak
  const tiles = list.slice(0, GRID.cols * GRID.rows * (half ? 2 : 1))
    .map((k, i) => ({ type: 'room', ref: k, x: i % GRID.cols, y: half ? Math.floor(i / GRID.cols) / 2 : Math.floor(i / GRID.cols), w: 1, h: half ? 0.5 : 1 }));
  return tiles.length ? [{ id: 'kamers', name: 'Kamers', tiles }] : [];
}

function layoutOut(rooms) {
  return {
    theme: THEMES.indexOf(config.layout.theme) === -1 ? 'warm' : config.layout.theme,
    mode: MODES.indexOf(config.layout.mode) === -1 ? 'light' : config.layout.mode,
    schedule: config.layout.schedule === 'custom' ? 'custom' : 'sun',
    darkFrom: HHMM.test(config.layout.darkFrom) ? config.layout.darkFrom : '21:00',
    darkTo: HHMM.test(config.layout.darkTo) ? config.layout.darkTo : '07:00',
    grid: GRID,
    home: Array.isArray(config.layout.home) ? config.layout.home : defaultHome(rooms),
    custom: Array.isArray(config.layout.home),
    pages: Array.isArray(config.layout.pages) ? config.layout.pages : defaultPages(rooms),
    pagesSaved: Array.isArray(config.layout.pages),
    groups: config.groups,
  };
}

function saveLayout(b) {
  /* Eerst alles controleren, pas daarna overnemen: een fout laat niets half veranderd achter. */
  const home = b.home !== undefined ? (b.home === null ? null : cleanHome(b.home)) : undefined;
  const screens = b.screens !== undefined ? cleanScreens(b.screens) : undefined;
  const pages = b.pages !== undefined ? (b.pages === null ? null : cleanPages(b.pages)) : undefined;
  const groups = b.groups !== undefined ? cleanGroups(b.groups) : undefined;
  if (home !== undefined) config.layout.home = home;
  if (screens !== undefined) config.layout.screens = screens;
  if (pages !== undefined) config.layout.pages = pages;
  if (groups !== undefined) config.groups = groups;
  if (b.theme !== undefined) {
    if (THEMES.indexOf(b.theme) === -1) throw new Error('Onbekend thema');
    config.layout.theme = b.theme;
  }
  if (b.mode !== undefined && MODES.indexOf(b.mode) === -1) throw new Error('Onbekende weergave');
  if (b.schedule !== undefined && ['sun', 'custom'].indexOf(b.schedule) === -1) throw new Error('Onbekend schema');
  const from = b.darkFrom !== undefined ? String(b.darkFrom) : config.layout.darkFrom;
  const to = b.darkTo !== undefined ? String(b.darkTo) : config.layout.darkTo;
  if (!HHMM.test(from) || !HHMM.test(to)) throw new Error('Tijd moet uu:mm zijn, bijvoorbeeld 21:00');
  if ((b.darkFrom !== undefined || b.darkTo !== undefined) && from === to) throw new Error('Begin- en eindtijd mogen niet gelijk zijn');
  if (b.mode !== undefined) config.layout.mode = b.mode;
  if (b.schedule !== undefined) config.layout.schedule = b.schedule;
  config.layout.darkFrom = from;
  config.layout.darkTo = to;
  saveConfig();
}

/* ------------------------------------------------------------- lampgroepen */
/* Een groep (bijv. 'Plafond spots') werkt in het paneel als één lamp. De losse lampen verdwijnen
   uit de kamers; op hun plek staat de groep. Schakelen gaat naar elke lamp in de groep. */
function cleanGroups(list) {
  if (!Array.isArray(list)) throw new Error('Ongeldige groepen');
  const seen = {};
  const taken = {}; // een lamp zit in hooguit één groep
  return list.slice(0, 50).map((g, i) => {
    if (!g || typeof g !== 'object') throw new Error('Ongeldige groep');
    let id = typeof g.id === 'string' && /^[a-z0-9]{1,16}$/.test(g.id) && !seen[g.id] ? g.id : '';
    while (!id || seen[id]) id = 'g' + crypto.randomBytes(4).toString('hex');
    seen[id] = true;
    const name = String(g.name || '').trim().slice(0, 40);
    if (!name) throw new Error('Geef groep ' + (i + 1) + ' een naam');
    const m = {};
    const members = (Array.isArray(g.members) ? g.members : []).filter((x) => typeof x === 'string' && x && x.length <= 200 && !/^grp:/.test(x) && !m[x] && (m[x] = true)).slice(0, 40);
    if (members.length < 2) throw new Error('Kies minstens twee lampen voor ' + name);
    members.forEach((x) => { if (taken[x]) throw new Error('Een lamp zit al in de groep ' + taken[x] + ' en kan niet ook in ' + name); taken[x] = name; });
    return { id, name, members };
  });
}
const groupMembers = {}; // laatst geziene lampen per groep, voor het schakelen
function applyGroups(rooms) {
  const all = {};
  rooms.forEach((r) => r.tiles.forEach((t) => { if (t.kind === 'light' && !all[t.id]) all[t.id] = t; }));
  /* Alleen echte lampen; Hue-kamers ('Alle lampen') kunnen niet in een groep. */
  const lights = Object.keys(all).filter((id) => all[id].type !== 'HueGroup' && all[id].name !== 'Alle lampen')
    .map((id) => ({ id, name: all[id].name, room: all[id].room || '', level: typeof all[id].level === 'number' }));
  (config.groups || []).forEach((g) => {
    const ms = g.members.map((id) => all[id]).filter(Boolean);
    groupMembers[g.id] = ms;
    if (!ms.length) return;
    const on = ms.filter((t) => t.on && !t.fault);
    const lv = (on.length ? on : ms).filter((t) => typeof t.level === 'number');
    const gt = { id: 'grp:' + g.id, name: g.name, type: 'Group', kind: 'light', isGroup: true, members: ms.length, char: 'on', onValue: true, offValue: false, on: on.length > 0 };
    if (lv.length) { gt.level = Math.round(lv.reduce((a, t) => a + t.level, 0) / lv.length); gt.levelChar = 'level'; }
    const cts = ms.filter((t) => t.ctChar && typeof t.ct === 'number');
    if (ms.some((t) => t.ctChar)) { gt.ctChar = 'ct'; gt.ct = cts.length ? Math.round(cts.reduce((a, t) => a + t.ct, 0) / cts.length) : null; }
    if (ms.every((t) => t.fault)) gt.fault = true;
    gt.text = gt.fault ? 'Geen contact' : (gt.on ? (gt.level !== undefined ? gt.level + '%' : 'Aan') : 'Uit');
    const ids = {};
    g.members.forEach((id) => { ids[id] = true; });
    rooms.forEach((r) => {
      const at = r.tiles.findIndex((t) => ids[t.id]);
      if (at === -1) return;
      r.tiles = r.tiles.filter((t) => !ids[t.id]);
      r.tiles.splice(at, 0, gt);
    });
    if (!gt.room) gt.room = (ms[0] && ms[0].room) || '';
  });
  return lights;
}
async function setOne(id, char, value) {
  if (DEMO) return demoSet(id, char, value);
  if (id.indexOf('hue:') === 0) return hueSet(id, char, value);
  return hbSet(id, char, value);
}
async function groupSet(id, char, value) {
  const ms = groupMembers[id.slice(4)];
  if (!ms || !ms.length) throw new Error('Groep niet gevonden');
  const jobs = ms.map((t) => {
    if (char === 'on') return setOne(t.id, t.char, value ? t.onValue : t.offValue);
    if (char === 'level') return t.levelChar ? setOne(t.id, t.levelChar, Number(value)) : setOne(t.id, t.char, Number(value) > 0 ? t.onValue : t.offValue);
    if (char === 'ct') return t.ctChar ? setOne(t.id, t.ctChar, Number(value)) : Promise.resolve();
    return Promise.reject(new Error('Onbekende bediening'));
  });
  const res = await Promise.all(jobs.map((p) => p.then(() => null, (e) => e)));
  const bad = res.filter(Boolean);
  if (bad.length === res.length) throw bad[0];
  if (bad.length) throw new Error(bad.length + ' van de ' + res.length + ' lampen reageerden niet');
}

/* ---------------------------------------------------------------- update */

const childProcess = require('child_process');
const GH_API = process.env.HUISPANEEL_GITHUB_API || 'https://api.github.com';
const GH_CODELOAD = process.env.HUISPANEEL_GITHUB_CODELOAD || 'https://codeload.github.com';
const MARK = path.join(ROOT, '.update-pending.json');
const BACKUP = path.join(ROOT, '.backup');
const WORK = path.join(ROOT, '.update');
/* Wat bij een update vervangen wordt. config.json staat er bewust niet tussen. */
const APP_FILES = ['server.js', 'start.js', 'atv.py', 'public', 'README.md', 'huispaneel.service', 'install.sh', 'config.example.json', 'test', 'VERSION'];
const upd = { latest: null, checkedAt: 0, checking: null, busy: false, step: '', error: null, done: null };

function currentVersion() {
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() || 'onbekend'; } catch (e) { return 'onbekend'; }
}
function rolledBack() {
  try { return fs.readFileSync(path.join(ROOT, '.update-rolledback'), 'utf8').trim(); } catch (e) { return ''; }
}
function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, { timeout: timeoutMs || 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split('\n').slice(-3).join(' '))); else resolve(stdout);
    });
  });
}
function repoOk() { return /^[\w.-]+\/[\w.-]+$/.test(config.update.repo) && /^[\w.\/-]+$/.test(config.update.branch); }

async function updCheck(force) {
  if (!force && upd.latest && Date.now() - upd.checkedAt < 10 * 60 * 1000) return upd.latest;
  if (upd.checking) return upd.checking;
  if (!repoOk()) throw new Error('Ongeldige repo in config.json');
  upd.checking = (async () => {
    try {
      const r = await request('GET', GH_API + '/repos/' + config.update.repo + '/commits/' + config.update.branch, {
        headers: { 'User-Agent': 'huispaneel', Accept: 'application/vnd.github+json' }, timeout: 10000,
      });
      if (r.status !== 200) throw new Error('GitHub antwoordde met HTTP ' + r.status);
      const j = JSON.parse(r.body.toString('utf8'));
      upd.latest = { sha: j.sha, message: String((j.commit && j.commit.message) || '').split('\n')[0].slice(0, 140), date: j.commit && j.commit.committer && j.commit.committer.date };
      upd.checkedAt = Date.now();
      upd.error = null;
      return upd.latest;
    } finally {
      upd.checking = null;
    }
  })();
  return upd.checking;
}

/* Wacht tot een proefstart op de eigen poort antwoordt. */
async function probe(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await request('GET', 'http://127.0.0.1:' + port + '/api/state', { timeout: 8000 });
      const j = JSON.parse(r.body.toString('utf8'));
      if (r.status === 200 && j.ok) return true;
    } catch (e) { /* nog niet klaar */ }
    await sleep(1000);
  }
  return false;
}

function copyApp(from, to) {
  fs.mkdirSync(to, { recursive: true });
  APP_FILES.forEach((f) => {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) return;
    fs.rmSync(path.join(to, f), { recursive: true, force: true });
    fs.cpSync(src, path.join(to, f), { recursive: true });
  });
}

async function updApply() {
  if (upd.busy) throw new Error('Er loopt al een update');
  if (SELFTEST || DEMO) throw new Error('Bijwerken kan niet in deze modus');
  upd.busy = true; upd.error = null; upd.done = null;
  let child = null;
  try {
    upd.step = 'Nieuwste versie opzoeken';
    const latest = await updCheck(true);
    if (latest.sha === currentVersion()) { upd.step = ''; upd.busy = false; upd.done = 'Je hebt de nieuwste versie al.'; return; }
    if (!/^[0-9a-f]{40}$/.test(latest.sha)) throw new Error('Onverwacht versienummer van GitHub');

    upd.step = 'Downloaden';
    const r = await request('GET', GH_CODELOAD + '/' + config.update.repo + '/tar.gz/' + latest.sha, { headers: { 'User-Agent': 'huispaneel' }, timeout: 60000 });
    if (r.status !== 200) throw new Error('Downloaden mislukt (HTTP ' + r.status + ')');
    fs.rmSync(WORK, { recursive: true, force: true });
    const dir = path.join(WORK, latest.sha.slice(0, 12));
    fs.mkdirSync(dir, { recursive: true });
    const tgz = path.join(WORK, 'pakket.tgz');
    fs.writeFileSync(tgz, r.body);
    await run('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1', '--no-same-owner']);

    upd.step = 'Controleren';
    ['server.js', 'start.js', 'public/index.html', 'public/app.js', 'public/setup.html'].forEach((f) => {
      if (!fs.existsSync(path.join(dir, f))) throw new Error('Bestand ontbreekt in de nieuwe versie: ' + f);
    });
    await run(process.execPath, ['--check', path.join(dir, 'server.js')]);
    await run(process.execPath, ['--check', path.join(dir, 'start.js')]);
    fs.writeFileSync(path.join(dir, 'VERSION'), latest.sha + '\n');

    upd.step = 'Proefstart';
    const port = LISTEN_PORT + 99;
    child = childProcess.spawn(process.execPath, ['--max-old-space-size=64', path.join(dir, 'server.js')], {
      env: Object.assign({}, process.env, { HUISPANEEL_SELFTEST: '1', HUISPANEEL_PORT: String(port), HUISPANEEL_CONFIG: CONFIG_FILE }),
      stdio: 'ignore',
    });
    const ok = await probe(port, 25000);
    child.kill(); child = null;
    if (!ok) throw new Error('De nieuwe versie startte niet goed op; er is niets veranderd.');

    upd.step = 'Overschakelen';
    fs.rmSync(BACKUP, { recursive: true, force: true });
    copyApp(ROOT, BACKUP);
    copyApp(dir, ROOT);
    fs.writeFileSync(MARK, JSON.stringify({ version: latest.sha, from: currentVersionOf(BACKUP), tries: 0 }));
    try { fs.unlinkSync(path.join(ROOT, '.update-rolledback')); } catch (e) { /* bestond niet */ }
    fs.rmSync(WORK, { recursive: true, force: true });

    upd.step = 'Herstarten';
    console.log('[update] bijgewerkt naar ' + latest.sha.slice(0, 7) + ', herstarten');
    setTimeout(() => process.exit(0), 800); // systemd start de dienst opnieuw (Restart=always)
  } catch (e) {
    if (child) { try { child.kill(); } catch (e2) { /* al weg */ } }
    fs.rmSync(WORK, { recursive: true, force: true });
    upd.error = e.message; upd.step = ''; upd.busy = false;
    console.log('[update] mislukt: ' + e.message);
  }
}
function currentVersionOf(dir) {
  try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch (e) { return ''; }
}

function updStatus() {
  const cur = currentVersion();
  return {
    current: cur, latest: upd.latest, available: !!(upd.latest && upd.latest.sha !== cur),
    busy: upd.busy, step: upd.step, error: upd.error, done: upd.done, auto: !!config.update.auto,
    rolledBack: rolledBack(), repo: config.update.repo,
  };
}

/* Elk uur kijken; 's nachts tussen 4 en 5 uur automatisch bijwerken als dat aan staat. */
function updTimer() {
  if (SELFTEST || DEMO) return;
  setInterval(() => {
    updCheck(true).then((l) => {
      if (config.update.auto && new Date().getHours() === 4 && l.sha !== currentVersion() && !upd.busy) updApply();
    }, () => {});
  }, 60 * 60 * 1000);
}

/* ------------------------------------------------------------- apple tv */
/* Het paneel praat met de Apple TV via een klein Python-proces (atv.py, met pyatv).
   Dat proces houdt de verbinding open, zodat een druk op een knop meteen doorkomt.
   pyatv staat in een eigen omgeving in data/pyatv; de koppelgegevens in data/atv.json. */
const ATV_DIR = process.env.HUISPANEEL_DATA || path.join(ROOT, 'data');
const ATV_PY = path.join(ATV_DIR, 'pyatv', 'bin', 'python');
const ATV_STORE = path.join(ATV_DIR, 'atv.json');
const atv = { proc: null, ready: null, seq: 0, wait: {}, state: { connected: false }, error: null, art: null, pair: null, install: null, restart: null, log: [] };

function atvCmd() {
  if (process.env.HUISPANEEL_ATV_CMD) return process.env.HUISPANEEL_ATV_CMD.split(' ');
  return [ATV_PY, path.join(ROOT, 'atv.py'), ATV_STORE];
}
function atvInstalled() {
  if (process.env.HUISPANEEL_ATV_CMD) return true;
  try {
    const lib = path.join(ATV_DIR, 'pyatv', 'lib');
    return fs.readdirSync(lib).some((d) => fs.existsSync(path.join(lib, d, 'site-packages', 'pyatv')));
  } catch (e) { return false; }
}

function atvStart() {
  if (atv.proc) return atv.ready;
  if (!atvInstalled()) return Promise.reject(new Error('De Apple TV-onderdelen zijn nog niet geïnstalleerd'));
  const cmd = atvCmd();
  const p = childProcess.spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
  atv.proc = p;
  atv.ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('De Apple TV-koppeling start niet op')), 60000);
    p.__ready = () => { clearTimeout(t); resolve(); };
    p.__fail = (e) => { clearTimeout(t); reject(e); };
  });
  atv.ready.catch(() => {});
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      atvMessage(p, m);
    }
  });
  p.stderr.on('data', (d) => { atv.log = atv.log.concat(String(d).split('\n').filter(Boolean)).slice(-20); });
  p.on('error', (e) => { atv.error = e.message; });
  p.on('exit', (code) => {
    if (atv.proc !== p) return;
    atv.proc = null; atv.state = { connected: false }; atv.pair = null;
    if (p.__fail) p.__fail(new Error('De Apple TV-koppeling is gestopt'));
    Object.keys(atv.wait).forEach((k) => { atv.wait[k].reject(new Error('De Apple TV-koppeling is gestopt')); delete atv.wait[k]; });
    if (code) console.log('[atv] hulpproces gestopt (' + code + '): ' + atv.log.slice(-3).join(' | '));
    /* Gekoppeld? Dan na een halve minuut opnieuw proberen. */
    if (config.atv.id && !atv.restart) atv.restart = setTimeout(() => { atv.restart = null; atvConnect().catch(() => {}); }, 30000);
  });
  return atv.ready;
}
function atvStop() {
  if (atv.proc) { const p = atv.proc; atv.proc = null; try { p.kill(); } catch (e) { /* al weg */ } }
  atv.state = { connected: false }; atv.art = null;
}
function atvMessage(p, m) {
  if (m.event === 'ready') { if (p.__ready) p.__ready(); return; }
  if (m.event === 'state') {
    delete m.event;
    atv.state = m;
    if (m.connected) atv.error = null;
    if (m.art && (!atv.art || atv.art.key !== m.art)) atvArtwork(m.art);
    return;
  }
  const w = atv.wait[m.id];
  if (!w) return;
  delete atv.wait[m.id];
  if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error || 'Apple TV gaf een fout'));
}
async function atvCall(cmd, args, timeout) {
  await atvStart();
  const id = ++atv.seq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { delete atv.wait[id]; reject(new Error('De Apple TV reageert niet')); }, timeout || 15000);
    atv.wait[id] = { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
    atv.proc.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args || {})) + '\n');
  });
}
async function atvConnect() {
  if (!config.atv.id) return;
  try {
    await atvCall('connect', { device: config.atv.id }, 30000);
  } catch (e) {
    atv.error = e.message;
    /* Niet gevonden (tv slaapt diep, netwerk weg): het hulpproces blijft draaien, dus zelf later opnieuw. */
    if (!atv.restart) atv.restart = setTimeout(() => { atv.restart = null; atvConnect().catch(() => {}); }, 60000);
    throw e;
  }
}
async function atvArtwork(key) {
  try {
    const a = await atvCall('artwork', { width: 512 });
    if (a && a.data && atv.state.art === key) atv.art = { key, type: a.mime || 'image/jpeg', data: Buffer.from(a.data, 'base64') };
  } catch (e) { /* geen afbeelding */ }
}
function atvOut() {
  if (!config.atv.id) return null;
  const s = atv.state;
  return {
    ok: !!s.connected, error: s.connected ? null : (atv.error || 'Verbinden…'),
    name: config.atv.name || s.name || 'Apple TV', power: s.power || 'unknown', state: s.state || 'idle',
    title: s.title || '', artist: s.artist || '', app: s.app ? s.app.name : '',
    art: s.title && atv.art && atv.art.key === s.art ? '/api/atv/art?k=' + encodeURIComponent(atv.art.key) : '',
    apps: s.apps || [],
  };
}
const ATV_KEYS = ['up', 'down', 'left', 'right', 'select', 'menu', 'home', 'top_menu', 'play_pause', 'play', 'pause', 'next', 'previous',
  'skip_forward', 'skip_backward', 'volume_up', 'volume_down', 'control_center', 'turn_on', 'turn_off'];
async function atvDo(b) {
  if (!config.atv.id) throw new Error('Er is geen Apple TV gekoppeld');
  if (b.action === 'key') {
    if (ATV_KEYS.indexOf(b.key) === -1) throw new Error('Onbekende toets');
    if (b.key === 'turn_on' || b.key === 'turn_off') atv.state.power = b.key === 'turn_on' ? 'on' : 'off';
    return atvCall('key', { key: b.key });
  }
  if (b.action === 'launch') {
    if (typeof b.app !== 'string' || !b.app || b.app.length > 200) throw new Error('Onbekende app');
    return atvCall('launch', { app: b.app });
  }
  throw new Error('Onbekende opdracht');
}

/* Installeren van pyatv vanuit de instellingen: duurt op een Pi Zero een paar minuten.
   srptools 2 werkt niet met pyatv 0.18 (koppelen mislukt), daarom vast op versie 1. */
function atvInstall() {
  if (atv.install && atv.install.busy) return;
  const venv = path.join(ATV_DIR, 'pyatv');
  fs.mkdirSync(ATV_DIR, { recursive: true });
  atv.install = { busy: true, ok: false, line: 'Omgeving aanmaken…', error: null };
  const sh = 'python3 -m venv "' + venv + '" && "' + venv + '/bin/pip" install --no-cache-dir --prefer-binary pyatv "srptools<2"';
  const p = childProcess.spawn('sh', ['-c', sh], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    const lines = String(d).split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) atv.install.line = lines[lines.length - 1].slice(0, 160);
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('exit', (code) => {
    atv.install.busy = false;
    atv.install.ok = code === 0 && atvInstalled();
    if (!atv.install.ok) atv.install.error = 'Installeren mislukt: ' + atv.install.line;
  });
}
function atvStatus() {
  return {
    installed: atvInstalled(), install: atv.install,
    device: config.atv.id ? { id: config.atv.id, name: config.atv.name } : null,
    connected: !!atv.state.connected, error: config.atv.id && !atv.state.connected ? atv.error : null,
    pairing: atv.pair ? { name: atv.pair.name, step: atv.pair.step } : null,
  };
}
async function atvSetup(b) {
  if (b.atv === 'install') { atvInstall(); return; }
  if (b.atv === 'scan') return atvCall('scan', { timeout: 5 }, 30000);
  if (b.atv === 'pair') {
    if (typeof b.device !== 'string' || !b.device) throw new Error('Kies een Apple TV');
    atv.pair = { device: b.device, name: String(b.name || 'Apple TV').slice(0, 80), step: 'companion' };
    try {
      await atvCall('pair_begin', { device: b.device, protocol: 'companion' }, 30000);
    } catch (e) {
      atv.pair = null;
      console.log('[atv] koppelen starten mislukt: ' + e.message);
      throw e;
    }
    return;
  }
  if (b.atv === 'pin') {
    const pr = atv.pair;
    if (!pr) throw new Error('Begin eerst met koppelen');
    if (!/^\d{4}$/.test(String(b.pin || '').trim())) throw new Error('Vul de 4 cijfers in die op de tv staan');
    /* Eén code tegelijk: twee keer dezelfde code tegelijk insturen breekt de koppeling. */
    if (pr.busy) throw new Error('Even geduld, de code wordt al gecontroleerd');
    pr.busy = true;
    try {
      await atvCall('pair_finish', { pin: String(b.pin).trim() }, 30000);
    } catch (e) {
      console.log('[atv] koppelen (' + pr.step + ') mislukt: ' + e.message);
      /* De Apple TV accepteert na een fout geen tweede poging met dezelfde koppeling: meteen een nieuwe starten. */
      try {
        await atvCall('pair_begin', { device: pr.device, protocol: pr.step }, 30000);
      } catch (e2) {
        atv.pair = null;
        throw new Error('Koppelen mislukt (' + e.message + '). Begin opnieuw met Zoek Apple TV.');
      }
      throw new Error('De code klopte niet of was verlopen. Er staat nu een nieuwe code op de tv.');
    } finally {
      pr.busy = false;
    }
    if (pr.step === 'companion') {
      /* Tweede stap: AirPlay, voor wat er speelt en de afbeelding. Lukt dat niet, dan werkt de bediening toch. */
      pr.step = 'airplay';
      try { await atvCall('pair_begin', { device: pr.device, protocol: 'airplay' }, 30000); return; } catch (e) { console.log('[atv] AirPlay-koppeling overgeslagen: ' + e.message); }
    }
    atv.pair = null;
    config.atv.id = pr.device; config.atv.name = pr.name; saveConfig();
    try { fs.chmodSync(ATV_STORE, 0o600); } catch (e) { /* nog geen bestand */ }
    atvConnect().catch(() => {});
    return;
  }
  if (b.atv === 'skip') {
    /* AirPlay-stap overslaan: de bediening werkt, alleen 'nu speelt' ontbreekt dan. */
    const pr = atv.pair;
    if (!pr || pr.step !== 'airplay') throw new Error('Er is niets om over te slaan');
    atv.pair = null;
    config.atv.id = pr.device; config.atv.name = pr.name; saveConfig();
    atvConnect().catch(() => {});
    return;
  }
  if (b.atv === 'cancel') { atv.pair = null; return; }
  if (b.atv === 'unpair') {
    const id = config.atv.id;
    config.atv.id = ''; config.atv.name = ''; saveConfig();
    if (atv.restart) { clearTimeout(atv.restart); atv.restart = null; }
    if (id && atv.proc) { try { await atvCall('forget', { device: id }, 20000); } catch (e) { /* tv onbereikbaar: gegevens blijven dan staan */ } }
    atvStop();
    return;
  }
  throw new Error('Onbekende Apple TV-opdracht');
}

/* ------------------------------------------------------------------ weer */

const WMO = {
  0: 'Helder', 1: 'Vrijwel helder', 2: 'Half bewolkt', 3: 'Bewolkt', 45: 'Mist', 48: 'Rijp en mist',
  51: 'Lichte motregen', 53: 'Motregen', 55: 'Dichte motregen', 56: 'IJzel', 57: 'IJzel',
  61: 'Lichte regen', 63: 'Regen', 65: 'Zware regen', 66: 'IJsregen', 67: 'IJsregen',
  71: 'Lichte sneeuw', 73: 'Sneeuw', 75: 'Zware sneeuw', 77: 'Motsneeuw',
  80: 'Lichte buien', 81: 'Buien', 82: 'Zware buien', 85: 'Sneeuwbuien', 86: 'Zware sneeuwbuien',
  95: 'Onweer', 96: 'Onweer met hagel', 99: 'Zwaar onweer met hagel',
};
const weather = { data: null, at: 0, busy: false };

function weatherTick() {
  const w = config.weather;
  if (DEMO || typeof w.latitude !== 'number' || typeof w.longitude !== 'number') return;
  if (weather.busy || Date.now() - weather.at < 15 * 60 * 1000) return;
  weather.busy = true;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.latitude + '&longitude=' + w.longitude +
    '&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=1&timezone=auto';
  request('GET', url, { timeout: 10000 }).then((r) => {
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const j = JSON.parse(r.body.toString('utf8'));
    const d = j.daily || {};
    weather.data = {
      temp: Math.round(j.current.temperature_2m), text: WMO[j.current.weather_code] || '', wind: Math.round(j.current.wind_speed_10m),
      max: d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : null,
      min: d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) : null,
      sunrise: d.sunrise ? String(d.sunrise[0]).slice(11, 16) : '', sunset: d.sunset ? String(d.sunset[0]).slice(11, 16) : '',
    };
    weather.at = Date.now();
  }).catch((e) => {
    console.log('[weer] ophalen mislukt: ' + e.message);
    weather.at = Date.now() - 13 * 60 * 1000; // over twee minuten opnieuw
  }).then(() => { weather.busy = false; });
}

async function geocode(place) {
  const r = await request('GET', 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=nl&format=json&name=' + encodeURIComponent(place), { timeout: 10000 });
  const j = r.status === 200 ? JSON.parse(r.body.toString('utf8')) : {};
  const hit = (j.results || [])[0];
  if (!hit) throw new Error('Plaats niet gevonden: ' + place);
  return { latitude: hit.latitude, longitude: hit.longitude, place: hit.name + (hit.country_code ? ' (' + hit.country_code + ')' : '') };
}

/* Instellen via de pagina /setup. Een login wordt alleen bewaard als Homebridge hem accepteert. */
async function setup(b) {
  const out = { ok: true };
  if (b.update === 'check') { try { await updCheck(true); } catch (e) { upd.error = e.message; } out.update = updStatus(); return out; }
  if (b.update === 'apply') { updApply(); await sleep(300); out.update = updStatus(); return out; }
  if (b.update === 'auto') { config.update.auto = !!b.value; saveConfig(); out.update = updStatus(); return out; }
  if (b.hue === 'pair') { await huePairStart(b.host); out.hue = hueStatus(); return out; }
  if (b.atv) { out.result = await atvSetup(b); out.atv = atvStatus(); return out; }
  if (b.hue === 'unpair') {
    config.hue.key = ''; config.hue.name = ''; hue.cache = null; hue.error = null; hue.pairing = null;
    saveConfig(); out.hue = hueStatus(); return out;
  }
  if (b.username || b.password) {
    const old = { username: config.homebridge.username, password: config.homebridge.password };
    config.homebridge.username = String(b.username || '');
    config.homebridge.password = String(b.password || '');
    hb.token = null;
    try {
      await hbLogin();
    } catch (e) {
      config.homebridge.username = old.username; config.homebridge.password = old.password; hb.token = null;
      throw new Error('Inloggen bij Homebridge lukte niet met deze gegevens.');
    }
    hb.cacheAt = 0; hb.error = null;
    saveConfig();
    out.homebridge = true;
  }
  if (typeof b.place === 'string' && b.place.trim()) {
    const g = await geocode(b.place.trim());
    config.weather.latitude = g.latitude; config.weather.longitude = g.longitude; config.weather.place = g.place;
    weather.at = 0;
    saveConfig();
    out.place = g.place;
  }
  return out;
}

/* ------------------------------------------------------------------ demo */

const demo = {
  rooms: [
    { name: 'Woonkamer', tiles: [
      { id: 'd1', name: 'Staande lamp', type: 'Lightbulb', kind: 'light', on: true, level: 60, levelChar: 'Brightness', char: 'On', onValue: true, offValue: false, ctChar: 'ct', ct: 30 },
      { id: 'd11', group: 'demo-wk', name: 'Avond', type: 'HueScene', kind: 'scene', on: false, char: 'recall', onValue: true, offValue: true },
      { id: 'd12', group: 'demo-wk', name: 'Film kijken', type: 'HueScene', kind: 'scene', on: false, char: 'recall', onValue: true, offValue: true },
      { id: 'd13', group: 'demo-wk', name: 'Helder', type: 'HueScene', kind: 'scene', on: false, char: 'recall', onValue: true, offValue: true },
      { id: 'd2', name: 'Eettafel', type: 'Lightbulb', kind: 'light', on: true, level: 85, levelChar: 'Brightness', char: 'On', onValue: true, offValue: false },
      { id: 'd3', name: 'Leeslamp', type: 'Lightbulb', kind: 'light', on: false, level: 40, levelChar: 'Brightness', char: 'On', onValue: true, offValue: false },
      { id: 'd4', name: 'Art Frame', type: 'Switch', kind: 'switch', on: true, char: 'On', onValue: true, offValue: false },
      { id: 'd5', name: 'Woonkamer TV', type: 'Television', kind: 'tv', on: false, char: 'Active', onValue: 1, offValue: 0 },
      { id: 'd6', name: 'Thermostaat', type: 'Thermostat', kind: 'climate', on: false, cur: 19.5, level: 20, levelChar: 'TargetTemperature', stepper: true, min: 5, max: 35, step: 0.5 },
    ] },
    { name: 'Keuken', tiles: [
      { id: 'd7', name: 'Aanrecht', type: 'Lightbulb', kind: 'light', on: false, level: 100, levelChar: 'Brightness', char: 'On', onValue: true, offValue: false },
      { id: 'd8', name: 'Koffiemachine', type: 'Outlet', kind: 'outlet', on: false, char: 'On', onValue: true, offValue: false },
    ] },
    { name: 'Slaapkamer', tiles: [
      { id: 'd9', name: 'Nachtlampje', type: 'Lightbulb', kind: 'light', on: false, level: 20, levelChar: 'Brightness', char: 'On', onValue: true, offValue: false },
      { id: 'd10', name: 'Gordijn', type: 'WindowCovering', kind: 'cover', on: true, level: 100, levelChar: 'TargetPosition', char: 'TargetPosition', onValue: 100, offValue: 0 },
    ] },
  ],
  sonos: { ok: true, room: 'Woonkamer', state: 'playing', source: 'music', title: 'Voorbeeldnummer', artist: 'Voorbeeldartiest', album: 'Demo-album', art: '', volume: 28, mute: false, canSkip: true },
  atv: { ok: true, error: null, name: 'Woonkamer', power: 'on', state: 'playing', title: 'Planet Earth III', artist: 'Aflevering 2 · Oceaan', app: 'TV', art: '',
    apps: [{ id: 'com.apple.TVWatchList', name: 'TV' }, { id: 'com.netflix.Netflix', name: 'Netflix' }, { id: 'com.google.ios.youtube', name: 'YouTube' },
      { id: 'nl.npo.player', name: 'NPO Start' }, { id: 'com.disney.disneyplus', name: 'Disney+' }, { id: 'com.apple.TVMusic', name: 'Muziek' },
      { id: 'com.videoland.app', name: 'Videoland' }, { id: 'com.apple.TVPhotos', name: 'Foto\'s' }, { id: 'com.spotify.client', name: 'Spotify' }] },
  weather: { temp: 9, text: 'Half bewolkt', wind: 14, max: 11, min: 5, sunrise: '07:52', sunset: '16:47' },
  favorites: [
    { id: 'FV:2/1', title: 'Zondagochtend', desc: 'Apple Music-playlist', kind: 'favorite', art: '' },
    { id: 'FV:2/2', title: 'NPO Radio 2', desc: 'Sonos Radio', kind: 'favorite', art: '' },
    { id: 'FV:2/3', title: 'Focus', desc: 'Apple Music-playlist', kind: 'favorite', art: '' },
    { id: 'FV:2/4', title: 'Jazz bij het eten', desc: 'Apple Music-album', kind: 'favorite', art: '' },
    { id: 'FV:2/5', title: 'Kinderliedjes', desc: 'Apple Music-playlist', kind: 'favorite', art: '' },
    { id: 'SQ:1', title: 'Feestje', desc: 'Sonos-playlist', kind: 'playlist', art: '' },
  ],
};
function demoText(t) {
  if (t.readonly) return t.text;
  if (t.kind === 'scene') return t.on ? 'Actief' : '';
  if (t.kind === 'climate') return temp(t.cur) + '°' + (Math.abs(t.level - t.cur) >= 0.5 ? ' → ' + temp(t.level) + '°' : '');
  if (t.kind === 'light') return t.on ? t.level + '%' : 'Uit';
  if (t.kind === 'cover') return t.level >= 100 ? 'Open' : (t.level <= 0 ? 'Dicht' : t.level + '%');
  return t.on ? 'Aan' : 'Uit';
}
function demoAtv(b) {
  const a = demo.atv;
  if (b.action === 'key') {
    if (b.key === 'turn_on') a.power = 'on';
    if (b.key === 'turn_off') a.power = 'off';
    if (b.key === 'play_pause') a.state = a.state === 'playing' ? 'paused' : 'playing';
  }
  if (b.action === 'launch') { const x = a.apps.filter((y) => y.id === b.app)[0]; if (x) { a.app = x.name; a.power = 'on'; } }
}
function demoSet(id, char, value) {
  demo.rooms.forEach((r) => r.tiles.forEach((t) => {
    if (t.id !== id) return;
    if (char === 'ct') { t.ct = Number(value); }
    else if (t.kind === 'scene') {
      // Zoals de Hue Bridge: één actieve scène per kamer of zone.
      demo.rooms.forEach((r2) => r2.tiles.forEach((o) => { if (o.kind === 'scene' && o.group === t.group) o.on = false; }));
      t.on = true;
    }
    else if (t.kind === 'climate') { t.level = Number(value); t.on = t.level > t.cur; }
    else if (char === t.levelChar && char !== t.char) { t.level = Number(value); t.on = t.level > 0; }
    else if (t.kind === 'cover') { t.level = Number(value); t.on = t.level > 0; }
    else t.on = value === t.onValue;
  }));
}

/* ------------------------------------------------------------- endpoints */

async function getState() {
  if (DEMO) {
    demo.rooms.forEach((r) => r.tiles.forEach((t) => { t.text = demoText(t); }));
    demo.rooms.forEach((r) => { r.key = r.key || 'hb:' + r.name; r.tiles.forEach((t) => { t.room = r.name; }); });
    const rooms = demo.rooms.map((r) => Object.assign({}, r, { tiles: r.tiles.slice() }));
    const lights = applyGroups(rooms);
    return { ok: true, demo: true, time: Date.now(), version: 'demo', homebridge: { ok: true }, rooms, lights, sonos: demo.sonos, weather: demo.weather, layout: layoutOut(rooms), favorites: demo.favorites, atv: demo.atv };
  }
  weatherTick();
  const out = { ok: true, time: Date.now(), version: currentVersion(), homebridge: { ok: true }, rooms: [], sonos: null, weather: weather.data };
  let hb2 = null, hue2 = null;
  const jobs = [
    hbLoad().then((d) => { hb2 = d; }, (e) => { out.homebridge = { ok: false, error: e.message }; }),
  ];
  if (config.hue.key) {
    jobs.push(hueLoad().then((d) => { hue2 = hueRooms(d); out.hue = { ok: true }; }, (e) => { out.hue = { ok: false, error: e.message }; }));
  }
  if (config.sonos.enabled) {
    jobs.push(sonosLoad().then((s) => { out.sonos = s; }, (e) => { out.sonos = { ok: false, error: e.message }; }));
  }
  await Promise.all(jobs);
  /* Werkt Hue rechtstreeks, dan komen de lampen uit de bridge en niet nog eens via Homebridge. */
  const hbRooms = hb2 ? buildRooms(hb2, { skipHue: !!hue2 }) : [];
  if (hue2) {
    if (hbRooms.length === 1 && hbRooms[0].name === 'Thuis') { hbRooms[0].name = 'Overig'; hbRooms[0].key = 'hb:Overig'; }
    if (hue2.loose.length) {
      const o = hbRooms.filter((r) => r.name === 'Overig')[0];
      if (o) o.tiles = o.tiles.concat(hue2.loose); else hbRooms.push({ name: 'Overig', key: 'hb:Overig', tiles: hue2.loose });
    }
    out.rooms = hue2.rooms.concat(hbRooms);
  } else {
    out.rooms = hbRooms;
  }
  /* Bij elke tegel de kamer (voor de ondertitel op het beginscherm); kamers gaan voor zones. */
  out.rooms.filter((r) => !r.zone).concat(out.rooms.filter((r) => r.zone)).forEach((r) => {
    r.tiles.forEach((t) => { if (!t.room) t.room = r.name; });
  });
  out.lights = applyGroups(out.rooms);
  out.layout = layoutOut(out.rooms);
  out.atv = atvOut();
  if (config.sonos.enabled) {
    try { out.favorites = await favLoad(); } catch (e) { out.favorites = null; }
  }
  return out;
}

const STATIC = { '/editor': ['editor.html', 'text/html; charset=utf-8'], '/editor.js': ['editor.js', 'application/javascript; charset=utf-8'], '/setup': ['setup.html', 'text/html; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/icon.png': ['icon.png', 'image/png'] };

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function json(res, status, obj) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj)); }
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > (max || 20000)) { reject(new Error('te groot')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('ongeldige JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && STATIC[u.pathname]) {
      const f = path.join(ROOT, 'public', STATIC[u.pathname][0]);
      if (!fs.existsSync(f)) return send(res, 404, 'text/plain', 'niet gevonden');
      return send(res, 200, STATIC[u.pathname][1], fs.readFileSync(f));
    }
    if (req.method === 'GET' && u.pathname === '/api/state') return json(res, 200, await getState());
    if (req.method === 'POST' && u.pathname === '/api/layout') {
      try { saveLayout(await readBody(req, 60000)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/set') {
      const b = await readBody(req);
      if (typeof b.id !== 'string' || typeof b.char !== 'string' || ['boolean', 'number'].indexOf(typeof b.value) === -1) return json(res, 400, { ok: false, error: 'ongeldig verzoek' });
      if (b.id.indexOf('grp:') === 0) await groupSet(b.id, b.char, b.value);
      else await setOne(b.id, b.char, b.value);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/setup' && !DEMO) {
      if (req.method === 'POST') {
        try { return json(res, 200, await setup(await readBody(req))); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      if (config.homebridge.username && !hb.token && !hb.error) { try { await hbLoad(); } catch (e) { /* status hieronder */ } }
      if (config.hue.key && !hue.cache && !hue.error) { try { await hueLoad(); } catch (e) { /* status hieronder */ } }
      if (!DEMO) { try { await updCheck(false); } catch (e) { upd.error = upd.busy ? upd.error : e.message; } }
      return json(res, 200, { ok: true, homebridge: { configured: !!config.homebridge.username, ok: !!hb.token && !hb.error, error: hb.error }, hue: hueStatus(), atv: atvStatus(), update: updStatus(), place: config.weather.place || '' });
    }
    if (req.method === 'POST' && u.pathname === '/api/sonos') {
      const b = await readBody(req);
      if (DEMO) {
        const s = demo.sonos;
        if (b.action === 'toggle') s.state = s.state === 'playing' ? 'paused' : 'playing';
        if (b.action === 'play') s.state = 'playing';
        if (b.action === 'pause') s.state = 'paused';
        if (b.action === 'volume') s.volume = Math.max(0, Math.min(100, Math.round(Number(b.value) || 0)));
        if (b.action === 'mute') s.mute = !!b.value;
        if (b.action === 'favorite') { const f = demo.favorites.filter((x) => x.id === b.value)[0]; if (f) { s.title = f.title; s.artist = f.desc; s.state = 'playing'; } }
      } else {
        await sonosDo(String(b.action), b.value);
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/atv') {
      const b = await readBody(req);
      if (DEMO) demoAtv(b); else await atvDo(b);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/api/atv/art') {
      if (!atv.art || atv.art.key !== u.searchParams.get('k')) return send(res, 404, 'text/plain', 'geen afbeelding');
      res.writeHead(200, { 'Content-Type': atv.art.type, 'Cache-Control': 'max-age=86400', 'Content-Length': atv.art.data.length });
      return res.end(atv.art.data);
    }
    if (req.method === 'GET' && u.pathname === '/api/sonos/art') {
      const a = await sonosArt(u.searchParams.get('k') || '');
      if (!a) return send(res, 404, 'text/plain', 'geen hoes');
      res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'max-age=86400', 'Content-Length': a.data.length });
      return res.end(a.data);
    }
    send(res, 404, 'text/plain', 'niet gevonden');
  } catch (e) {
    json(res, 502, { ok: false, error: e.message });
  }
});

function start() {
  server.listen(LISTEN_PORT, SELFTEST ? '127.0.0.1' : '0.0.0.0', () => {
    console.log('Huispaneel ' + currentVersion().slice(0, 7) + ' draait op poort ' + LISTEN_PORT + (DEMO ? ' (demo)' : SELFTEST ? ' (proefstart)' : ', Homebridge: ' + config.homebridge.url));
    /* Na een update: draait deze versie een halve minuut, dan is de update geslaagd. */
    if (!SELFTEST) setTimeout(() => { try { fs.unlinkSync(MARK); } catch (e) { /* geen update bezig */ } }, 30000);
  });
  updTimer();
  if (!SELFTEST && !DEMO && config.atv.id) atvConnect().catch((e) => console.log('[atv] ' + e.message));
}

if (require.main === module) start();

module.exports = { toTile, buildRooms, parseZones, tag, unesc, server, config, hbSet, hueRooms, start };
