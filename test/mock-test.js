'use strict';
/* Test de echte codepaden van server.js tegen een nagebootste Homebridge UI en een nagebootste Sonos.
   De vormen van de Homebridge-antwoorden volgen de broncode van homebridge-config-ui-x en hap-client. */
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const log = [];
let lights = { On: false, Brightness: 40 };
let logins = 0;
let target = 19.5;

function svc(id, type, name, chars) {
  return {
    uniqueId: id, nameBasedUniqueId: 'n-' + id, type, humanType: type, serviceName: name, aid: 1, iid: 1, uuid: 'x',
    serviceCharacteristics: Object.keys(chars).map((k) => ({ type: k, value: chars[k].v, canWrite: !!chars[k].w, perms: chars[k].w ? ['pr', 'pw'] : ['pr'], format: 'bool' })),
    values: Object.keys(chars).reduce((o, k) => { o[k] = chars[k].v; return o; }, {}),
    accessoryInformation: {}, instance: { username: 'AA:BB' },
  };
}
function services() {
  return [
    svc('a1', 'Lightbulb', 'Staande lamp', { On: { v: lights.On, w: 1 }, Brightness: { v: lights.Brightness, w: 1 } }),
    svc('a2', 'Switch', 'Art Frame', { On: { v: 1, w: 1 } }),
    svc('a3', 'TemperatureSensor', 'Temperatuur', { CurrentTemperature: { v: 20.46 } }),
    svc('a4', 'Television', 'Woonkamer TV', { Active: { v: 0, w: 1 } }),
    svc('a5', 'InputSource', 'HDMI 1', { ConfiguredName: { v: 'HDMI 1' } }),
    svc('a6', 'Outlet', 'Verborgen stekker', { On: { v: false, w: 1 } }),
    svc('a7', 'Switch', 'Los schakelaartje', { On: { v: false, w: 1 } }),
    svc('a9', 'Lightbulb', 'Hue lamp via HB', { On: { v: false, w: 1 }, Resource: { v: '/lights/1' } }),
    Object.assign(svc('a8', 'Thermostat', 'Thermostaat', { CurrentHeatingCoolingState: { v: 0 }, CurrentTemperature: { v: 19.5 }, TargetTemperature: { v: target, w: 1 } }), {}),
  ].map((s) => { s.serviceCharacteristics.forEach((ch) => { if (ch.type === 'TargetTemperature') { ch.minValue = 5; ch.maxValue = 35; ch.format = 'float'; } }); return s; });
}
const layout = [
  { name: 'Default Room', isDefault: true, services: [{ uniqueId: 'a3' }] },
  { name: 'Woonkamer', services: [{ uniqueId: 'a1', customName: 'Leeslamp' }, { uniqueId: 'stale', nameBasedUniqueId: 'n-a2' }, { uniqueId: 'a4' }, { uniqueId: 'a6', hidden: true }] },
];

const hbMock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/auth/login') {
      const b = JSON.parse(body);
      logins++;
      if (b.username !== 'admin' || b.password !== 'geheim') return send(401, { message: 'Unauthorized' });
      return send(201, { access_token: 'tok' + logins, token_type: 'Bearer', expires_in: 28800 });
    }
    if (req.headers.authorization !== 'Bearer tok' + logins) return send(401, { message: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/api/accessories') return send(200, services());
    if (req.method === 'GET' && req.url === '/api/accessories/layout') return send(200, layout);
    if (req.method === 'PUT' && req.url.indexOf('/api/accessories/') === 0) {
      const b = JSON.parse(body);
      log.push(req.url.split('/').pop() + ' ' + b.characteristicType + '=' + b.value);
      if (req.url.endsWith('/a1')) lights[b.characteristicType] = b.value;
      if (req.url.endsWith('/a8')) target = b.value;
      return send(200, {});
    }
    send(404, {});
  });
});

/* Nagebootste Sonos op poort 1400 (alleen op een eigen loopback-adres). */
const sonosLog = [];
let volume = 31;
function soapOut(action, inner) {
  return '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:' + action + 'Response xmlns:u="urn:x">' + inner + '</u:' + action + 'Response></s:Body></s:Envelope>';
}
const didl = '&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot;&gt;&lt;item id=&quot;-1&quot;&gt;&lt;res protocolInfo=&quot;x&quot; duration=&quot;0:03:20&quot;&gt;x-sonos-spotify:spotify%3atrack%3a1&lt;/res&gt;&lt;upnp:albumArtURI&gt;/getaa?s=1&amp;amp;u=x-sonos-spotify%3aspotify&lt;/upnp:albumArtURI&gt;&lt;dc:title&gt;Rock &amp;amp; Roll&lt;/dc:title&gt;&lt;dc:creator&gt;De Band&lt;/dc:creator&gt;&lt;upnp:album&gt;Het Album&lt;/upnp:album&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;';
const zones = '&lt;ZoneGroupState&gt;&lt;ZoneGroups&gt;&lt;ZoneGroup Coordinator=&quot;RINCON_A&quot; ID=&quot;RINCON_A:1&quot;&gt;&lt;ZoneGroupMember UUID=&quot;RINCON_A&quot; Location=&quot;http://127.0.0.1:1400/xml/device_description.xml&quot; ZoneName=&quot;Woonkamer&quot; HTSatChanMapSet=&quot;x&quot;&gt;&lt;Satellite UUID=&quot;RINCON_B&quot; Location=&quot;http://127.0.0.9:1400/xml/device_description.xml&quot; ZoneName=&quot;Woonkamer&quot; Invisible=&quot;1&quot;/&gt;&lt;/ZoneGroupMember&gt;&lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;&lt;/ZoneGroupState&gt;';
const escx = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"';
const metaPl = '<DIDL-Lite ' + NS + '><item id="1006206cplaylist"><dc:title>Focus</dc:title><upnp:class>object.container.playlistContainer</upnp:class><desc id="cdudn">SA_RINCON52231_X_#Svc52231-0-Token</desc></item></DIDL-Lite>';
const metaRadio = '<DIDL-Lite ' + NS + '><item id="F00092020s6707"><dc:title>NPO Radio 2</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class></item></DIDL-Lite>';
const favDidl = '<DIDL-Lite ' + NS + '>' +
  '<item id="FV:2/3" parentID="FV:2"><dc:title>Focus &amp; rust</dc:title><upnp:class>object.itemobject.item.sonos-favorite</upnp:class><res protocolInfo="x-rincon-cpcontainer:*:*:*">x-rincon-cpcontainer:1006206cplaylist</res><upnp:albumArtURI>/getaa?s=1&amp;u=fav</upnp:albumArtURI><r:description>Apple Music</r:description><r:resMD>' + escx(metaPl) + '</r:resMD></item>' +
  '<item id="FV:2/4" parentID="FV:2"><dc:title>NPO Radio 2</dc:title><upnp:class>object.itemobject.item.sonos-favorite</upnp:class><res protocolInfo="x-sonosapi-stream:*:*:*">x-sonosapi-stream:s6707?sid=303&amp;flags=8224</res><r:description>Sonos Radio</r:description><r:resMD>' + escx(metaRadio) + '</r:resMD></item>' +
  '</DIDL-Lite>';
const sqDidl = '<DIDL-Lite ' + NS + '><container id="SQ:1" parentID="SQ:"><dc:title>Feestje</dc:title><upnp:class>object.container.playlistContainer</upnp:class><res protocolInfo="file:*:audio/mpegurl:*">file:///jffs/settings/savedqueues.rsq#1</res></container></DIDL-Lite>';
const sonosMock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.indexOf('/getaa') === 0) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([255, 216, 255])); }
    const action = /#(\w+)"/.exec(req.headers.soapaction || '')[1];
    sonosLog.push(action + (/<DesiredVolume>(\d+)/.exec(body) ? '=' + /<DesiredVolume>(\d+)/.exec(body)[1] : '') +
      (/<CurrentURI>([^<]*)/.exec(body) ? '=' + /<CurrentURI>([^<]*)/.exec(body)[1] : '') + (/<EnqueuedURI>([^<]*)/.exec(body) ? '=' + /<EnqueuedURI>([^<]*)/.exec(body)[1] : '') +
      (action === 'SetAVTransportURI' && /<CurrentURIMetaData>&lt;DIDL/.test(body) ? ' +meta' : '') + (action === 'AddURIToQueue' && /<EnqueuedURIMetaData>&lt;DIDL/.test(body) ? ' +meta' : ''));
    const map = {
      GetZoneGroupState: '<ZoneGroupState>' + zones + '</ZoneGroupState>',
      GetTransportInfo: '<CurrentTransportState>PLAYING</CurrentTransportState>',
      GetPositionInfo: '<Track>1</Track><TrackURI>x-sonos-spotify:spotify%3atrack%3a1</TrackURI><TrackMetaData>' + didl + '</TrackMetaData>',
      GetMediaInfo: '<CurrentURI>x-rincon-queue:RINCON_A#0</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>',
      GetVolume: '<CurrentVolume>' + volume + '</CurrentVolume>',
      GetMute: '<CurrentMute>0</CurrentMute>',
      Browse: '<Result>' + escx(/<ObjectID>FV:2/.test(body) ? favDidl : sqDidl) + '</Result><NumberReturned>2</NumberReturned>',
    };
    if (action === 'SetVolume') volume = Number(/<DesiredVolume>(\d+)/.exec(body)[1]);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(soapOut(action, map[action] || ''));
  });
});

/* Nagebootste Hue Bridge (CLIP v2), vormen volgens de Hue-documentatie. */
const hueLog = [];
let pairTries = 0;
const hueRes = [
  { id: 'dev1', type: 'device', metadata: { name: 'Spot 1' }, services: [{ rid: 'l1', rtype: 'light' }, { rid: 'z1', rtype: 'zigbee_connectivity' }] },
  { id: 'dev2', type: 'device', metadata: { name: 'Spot 2' }, services: [{ rid: 'l2', rtype: 'light' }, { rid: 'z2', rtype: 'zigbee_connectivity' }] },
  { id: 'dev3', type: 'device', metadata: { name: 'Los' }, services: [{ rid: 'l3', rtype: 'light' }, { rid: 'z3', rtype: 'zigbee_connectivity' }] },
  { id: 'l1', type: 'light', owner: { rid: 'dev1', rtype: 'device' }, metadata: { name: 'Zolderkamer spot 1' }, on: { on: false }, dimming: { brightness: 100 }, color_temperature: { mirek: 346, mirek_valid: true, mirek_schema: { mirek_minimum: 250, mirek_maximum: 454 } } },
  { id: 'l2', type: 'light', owner: { rid: 'dev2', rtype: 'device' }, metadata: { name: 'Gang spot 2' }, on: { on: true }, dimming: { brightness: 49.8 } },
  { id: 'l3', type: 'light', owner: { rid: 'dev3', rtype: 'device' }, metadata: { name: 'Losse lamp' }, on: { on: true } },
  { id: 'z1', type: 'zigbee_connectivity', owner: { rid: 'dev1', rtype: 'device' }, status: 'connected' },
  { id: 'z2', type: 'zigbee_connectivity', owner: { rid: 'dev2', rtype: 'device' }, status: 'connected' },
  { id: 'z3', type: 'zigbee_connectivity', owner: { rid: 'dev3', rtype: 'device' }, status: 'connectivity_issue' },
  { id: 'r1', type: 'room', metadata: { name: 'Zolderkamer' }, children: [{ rid: 'dev1', rtype: 'device' }, { rid: 'dev2', rtype: 'device' }], services: [{ rid: 'g1', rtype: 'grouped_light' }] },
  { id: 'zn1', type: 'zone', metadata: { name: 'Beneden' }, children: [{ rid: 'l2', rtype: 'light' }], services: [] },
  { id: 'g1', type: 'grouped_light', owner: { rid: 'r1', rtype: 'room' }, on: { on: true }, dimming: { brightness: 60 } },
  { id: 's2', type: 'scene', metadata: { name: 'Lezen' }, group: { rid: 'r1', rtype: 'room' }, status: { active: 'static' } },
  { id: 's1', type: 'scene', metadata: { name: 'Avond' }, group: { rid: 'r1', rtype: 'room' }, status: { active: 'inactive' } },
];
const hueMock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && req.url === '/api/0/config') return send(200, { name: 'Hue Bridge', bridgeid: 'ECB5FAFFFE000001', apiversion: '1.78.0' });
    if (req.method === 'POST' && req.url === '/api') {
      pairTries++;
      if (pairTries < 3) return send(200, [{ error: { type: 101, address: '', description: 'link button not pressed' } }]);
      return send(200, [{ success: { username: 'sleutel-123' } }]);
    }
    if (req.headers['hue-application-key'] !== 'sleutel-123') return send(403, { errors: [{ description: 'unauthorized user' }] });
    if (req.method === 'GET' && req.url === '/clip/v2/resource') return send(200, { errors: [], data: hueRes });
    if (req.method === 'PUT' && req.url.indexOf('/clip/v2/resource/') === 0) {
      hueLog.push(req.url.replace('/clip/v2/resource/', '') + ' ' + body);
      return send(200, { errors: [], data: [] });
    }
    send(404, { errors: [{ description: 'not found' }] });
  });
});

function call(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let j = null;
        try { j = JSON.parse(buf.toString()); } catch (e) { /* binair */ }
        resolve({ status: res.statusCode, json: j, raw: buf, type: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  await new Promise((r) => hbMock.listen(0, '127.0.0.1', r));
  await new Promise((r) => hueMock.listen(0, '127.0.0.1', r));
  let sonosUp = true;
  await new Promise((r) => { sonosMock.once('error', () => { sonosUp = false; r(); }); sonosMock.listen(1400, '127.0.0.1', r); });

  const cfgFile = path.join(os.tmpdir(), 'huispaneel-test-config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    port: 0,
    homebridge: { url: 'http://127.0.0.1:' + hbMock.address().port + '/', username: 'admin', password: 'geheim' },
    sonos: { enabled: sonosUp, host: '127.0.0.1' },
    hue: { host: 'http://127.0.0.1:' + hueMock.address().port },
    hide: ['Los schakelaartje'],
  }));
  process.env.HUISPANEEL_CONFIG = cfgFile;
  process.env.HUISPANEEL_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'huispaneel-data-'));
  const app = require('../server.js');
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;

  let r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.status, 200);
  const st = r.json;
  assert.strictEqual(st.homebridge.ok, true);
  assert.deepStrictEqual(st.rooms.map((x) => x.name), ['Overig', 'Woonkamer']);
  const wk = st.rooms[1].tiles;
  assert.deepStrictEqual(wk.map((t) => t.name), ['Leeslamp', 'Art Frame', 'Woonkamer TV'], 'customName, nameBasedUniqueId, hidden');
  assert.deepStrictEqual(st.rooms[0].tiles.map((t) => t.name), ['Temperatuur', 'Hue lamp via HB', 'Thermostaat']);
  assert.strictEqual(wk[0].kind, 'light'); assert.strictEqual(wk[0].on, false); assert.strictEqual(wk[0].level, 40); assert.strictEqual(wk[0].text, 'Uit');
  assert.strictEqual(wk[1].on, true, 'On=1 telt als aan');
  assert.strictEqual(wk[2].kind, 'tv'); assert.strictEqual(wk[2].char, 'Active');
  assert.strictEqual(st.rooms[0].tiles[0].text, '20,5°');
  assert.ok(!JSON.stringify(st).includes('HDMI 1'), 'InputSource wordt niet getoond');
  assert.ok(!JSON.stringify(st).includes('Los schakelaartje'), 'hide uit config');
  console.log('ok  accessoires en kamers');

  r = await call(port, 'POST', '/api/set', { id: 'a1', char: 'On', value: true });
  assert.strictEqual(r.status, 200);
  r = await call(port, 'POST', '/api/set', { id: 'a1', char: 'Brightness', value: 75 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(log, ['a1 On=true', 'a1 Brightness=75']);
  r = await call(port, 'GET', '/api/state');
  const lamp = r.json.rooms[1].tiles[0];
  assert.strictEqual(lamp.on, true); assert.strictEqual(lamp.text, '75%');
  console.log('ok  schakelen en dimmen komt aan bij Homebridge');

  r = await call(port, 'POST', '/api/set', { id: 'a3', char: 'CurrentTemperature', value: 30 });
  assert.strictEqual(r.status, 502, 'alleen-lezen eigenschap wordt geweigerd');
  r = await call(port, 'POST', '/api/set', { id: 'bestaat-niet', char: 'On', value: true });
  assert.strictEqual(r.status, 502);
  r = await call(port, 'POST', '/api/set', { id: 'a1', char: 'On', value: 'true' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(log.length, 2, 'geweigerde verzoeken bereiken Homebridge niet');
  console.log('ok  ongeldige verzoeken worden geweigerd');

  r = await call(port, 'POST', '/api/set', { id: 'a8', char: 'TargetTemperature', value: 21.5 });
  assert.strictEqual(r.status, 200);
  r = await call(port, 'POST', '/api/set', { id: 'a8', char: 'TargetTemperature', value: 40 });
  assert.strictEqual(r.status, 502, 'buiten het bereik van de thermostaat');
  assert.strictEqual(target, 21.5);
  r = await call(port, 'GET', '/api/state');
  const th = r.json.rooms[0].tiles.filter((t) => t.name === 'Thermostaat')[0];
  assert.strictEqual(th.text, '19,5° → 21,5°'); assert.strictEqual(th.level, 21.5); assert.strictEqual(th.min, 5); assert.strictEqual(th.max, 35);
  console.log('ok  thermostaat: doeltemperatuur instellen, bereik bewaakt');

  r = await call(port, 'POST', '/api/setup', { username: 'admin', password: 'fout' });
  assert.strictEqual(r.status, 400, 'verkeerde login wordt niet bewaard');
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).homebridge.password, 'geheim');
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.homebridge.ok, true, 'oude login blijft werken na mislukte poging');
  r = await call(port, 'POST', '/api/setup', { username: 'admin', password: 'geheim' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((fs.statSync(cfgFile).mode & 0o777), 0o600, 'config alleen leesbaar voor de eigenaar');
  r = await call(port, 'GET', '/api/setup');
  assert.strictEqual(r.json.homebridge.ok, true); assert.ok(!JSON.stringify(r.json).includes('geheim'), 'wachtwoord komt nooit terug');
  console.log('ok  setup: alleen een werkende login wordt bewaard');

  logins = 99; // maakt het oude token ongeldig: de server moet opnieuw inloggen
  await new Promise((res2) => setTimeout(res2, 2100));
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.homebridge.ok, true, 'opnieuw inloggen na 401');
  assert.ok(logins >= 100);
  console.log('ok  opnieuw inloggen na verlopen token');

  if (sonosUp) {
    const s = r.json.sonos;
    assert.strictEqual(s.ok, true, JSON.stringify(s));
    assert.strictEqual(s.room, 'Woonkamer');
    assert.strictEqual(s.state, 'playing');
    assert.strictEqual(s.title, 'Rock & Roll');
    assert.strictEqual(s.artist, 'De Band');
    assert.strictEqual(s.album, 'Het Album');
    assert.strictEqual(s.volume, 31);
    assert.ok(/^\/api\/sonos\/art\?k=/.test(s.art));
    const art = await call(port, 'GET', s.art);
    assert.strictEqual(art.status, 200); assert.strictEqual(art.type, 'image/jpeg'); assert.strictEqual(art.raw.length, 3);
    r = await call(port, 'POST', '/api/sonos', { action: 'volume', value: 44.4 });
    assert.strictEqual(r.status, 200);
    r = await call(port, 'POST', '/api/sonos', { action: 'toggle' });
    r = await call(port, 'POST', '/api/sonos', { action: 'next' });
    assert.ok(sonosLog.includes('SetVolume=44')); assert.ok(sonosLog.includes('Pause')); assert.ok(sonosLog.includes('Next'));
    r = await call(port, 'POST', '/api/sonos', { action: 'rm -rf' });
    assert.strictEqual(r.status, 502);
    console.log('ok  sonos: nu speelt, hoes, volume, pauze, volgende');

    await new Promise((res2) => setTimeout(res2, 2100));
    r = await call(port, 'GET', '/api/state');
    const fv = r.json.favorites;
    assert.deepStrictEqual(fv.map((x) => x.title + '|' + x.desc + '|' + x.kind), ['Focus & rust|Apple Music|favorite', 'NPO Radio 2|Sonos Radio|favorite', 'Feestje|Sonos-playlist|playlist']);
    assert.ok(/^\/api\/sonos\/art\?k=/.test(fv[0].art), 'hoes via de Pi'); assert.strictEqual(fv[1].art, '');
    const fart = await call(port, 'GET', fv[0].art);
    assert.strictEqual(fart.status, 200, 'hoes van een favoriet ophalen');
    sonosLog.length = 0;
    assert.strictEqual((await call(port, 'POST', '/api/sonos', { action: 'favorite', value: 'FV:2/3' })).status, 200);
    assert.deepStrictEqual(sonosLog, ['RemoveAllTracksFromQueue', 'AddURIToQueue=x-rincon-cpcontainer:1006206cplaylist +meta', 'SetAVTransportURI=x-rincon-queue:RINCON_A#0', 'Play'], 'playlist via de wachtrij');
    sonosLog.length = 0;
    assert.strictEqual((await call(port, 'POST', '/api/sonos', { action: 'favorite', value: 'FV:2/4' })).status, 200);
    assert.deepStrictEqual(sonosLog, ['SetAVTransportURI=x-sonosapi-stream:s6707?sid=303&amp;flags=8224 +meta', 'Play'], 'zender direct');
    sonosLog.length = 0;
    assert.strictEqual((await call(port, 'POST', '/api/sonos', { action: 'favorite', value: 'SQ:1' })).status, 200);
    assert.deepStrictEqual(sonosLog.slice(0, 2), ['RemoveAllTracksFromQueue', 'AddURIToQueue=file:///jffs/settings/savedqueues.rsq#1'], 'sonos-playlist via de wachtrij');
    assert.strictEqual((await call(port, 'POST', '/api/sonos', { action: 'favorite', value: 'FV:2/999' })).status, 502);
    console.log('ok  sonos: favorieten en playlists ophalen en afspelen');
  } else {
    console.log('--  sonos-test overgeslagen (poort 1400 bezet)');
  }

  const tv = app.parseZones('<ZoneGroupState>' + zones + '</ZoneGroupState>');
  assert.deepStrictEqual(tv, [{ host: '127.0.0.1', room: 'Woonkamer', uuid: 'RINCON_A' }], 'surrounds worden genegeerd, soundbar is coordinator');
  console.log('ok  sonos-groepen: soundbar gekozen, surrounds genegeerd');

  /* Vormen zoals de echte Homebridge ze teruggeeft (homebridge-hue, Eve-thermostaat, eigen schakelaars)
     en een oude kamerindeling met verlopen id's en zonder nameBasedUniqueId of isDefault. */
  const c = (type, value, canWrite) => ({ type, value, canWrite: !!canWrite });
  const real = {
    services: [
      { uniqueId: 'p1', type: 'ProtocolInformation', serviceName: 'Homebridge', values: { Version: '1.1.0' }, serviceCharacteristics: [c('Version', '1.1.0')] },
      { uniqueId: 's1', type: 'Switch', serviceName: 'Poster op frame', values: { On: 0 }, serviceCharacteristics: [c('On', 0, 1)] },
      { uniqueId: 's2', type: 'Switch', serviceName: 'Surrounds', values: { On: 0 }, serviceCharacteristics: [c('On', 0, 1)] },
      { uniqueId: 'h1', type: 'History', serviceName: 'Woonkamer Thermostat History', values: {}, serviceCharacteristics: [c('HistoryRequest', undefined, 1), c('SetTime', undefined, 1)] },
      { uniqueId: 't1', type: 'Thermostat', serviceName: 'Woonkamer', values: { CurrentHeatingCoolingState: 0, TargetHeatingCoolingState: 1, CurrentTemperature: 19.5, TargetTemperature: 19.5 }, serviceCharacteristics: [Object.assign(c('TargetTemperature', 19.5, 1), { minValue: 5, maxValue: 35 }), c('CurrentTemperature', 19.5)] },
      { uniqueId: 'b1', type: 'Battery', serviceName: 'Woonkamer Battery', values: { BatteryLevel: 100 }, serviceCharacteristics: [c('BatteryLevel', 100)] },
      { uniqueId: 'hb', type: 'HueBridge', serviceName: 'Hue Bridge', values: { Heartrate: 5, Restart: 0, Search: 0 }, serviceCharacteristics: [c('Heartrate', 5, 1), c('Restart', 0, 1), c('Search', 0, 1)] },
      { uniqueId: 'l1', type: 'Lightbulb', serviceName: 'Gang spot 2', values: { Brightness: 50, StatusFault: 0, On: 0 }, serviceCharacteristics: [c('Brightness', 50, 1), c('BrightnessChange', 0, 1), c('StatusFault', 0), c('On', 0, 1)] },
      { uniqueId: 'l2', type: 'Lightbulb', serviceName: 'Innr spot 2', values: { Brightness: 100, StatusFault: 1, On: 1 }, serviceCharacteristics: [c('Brightness', 100, 1), c('StatusFault', 1), c('On', 1, 1)] },
      { uniqueId: 'l3', type: 'Lightbulb', serviceName: 'Zolderkamer spot 1', values: { Brightness: 100, ColorTemperature: 346, StatusFault: 1, On: 0 }, serviceCharacteristics: [c('Brightness', 100, 1), c('ColorTemperature', 346, 1), c('StatusFault', 1), c('On', 0, 1)] },
    ],
    layout: [{ name: 'Default Room', services: [{ uniqueId: 'verlopen-1', name: 'Energy Socket' }, { uniqueId: 'verlopen-2', name: 'Zolderkamer spot 1' }, { uniqueId: 'verlopen-3', name: 'Gang spot 2' }] }],
  };
  const rr = app.buildRooms(real);
  assert.strictEqual(rr.length, 1); assert.strictEqual(rr[0].name, 'Thuis');
  assert.deepStrictEqual(rr[0].tiles.map((t) => t.name), ['Zolderkamer spot 1', 'Gang spot 2', 'Poster op frame', 'Surrounds', 'Woonkamer', 'Innr spot 2'], 'alleen bedienbare/zinvolle services, oude indeling op naam');
  const by = {}; rr[0].tiles.forEach((t) => { by[t.name] = t; });
  assert.strictEqual(by['Woonkamer'].text, '19,5°'); assert.strictEqual(by['Woonkamer'].readonly, false);
  assert.strictEqual(by['Woonkamer'].stepper, true); assert.strictEqual(by['Woonkamer'].level, 19.5); assert.strictEqual(by['Woonkamer'].levelChar, 'TargetTemperature');
  assert.strictEqual(by['Gang spot 2'].text, 'Uit'); assert.strictEqual(by['Gang spot 2'].level, 50);
  assert.strictEqual(by['Innr spot 2'].fault, true); assert.strictEqual(by['Innr spot 2'].on, false); assert.strictEqual(by['Innr spot 2'].text, 'Geen contact');
  assert.strictEqual(by['Poster op frame'].char, 'On');
  console.log('ok  vormen uit de echte Homebridge: 6 van 10 services worden tegels, storing herkend');

  /* ---- indeling, schermen, thema, achtergrond ---- */
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.layout.custom, false);
  assert.ok(r.json.layout.home.length >= 4, 'standaardindeling');
  assert.deepStrictEqual(r.json.layout.home[0], { type: 'device', ref: 'a8', x: 0, y: 0, w: 2, h: 2 }, 'thermostaat groot linksboven');
  r = await call(port, 'POST', '/api/layout', { home: [
    { type: 'clock', variant: 'digital', x: 0, y: 0, w: 2, h: 2 },
    { type: 'weather', x: 1, y: 1, w: 1, h: 1 },          // overlapt de klok
    { type: 'nowplaying', x: 3, y: 2, w: 2, h: 1 },       // valt buiten het raster
    { type: 'script', x: 3, y: 0 },                        // onbekend soort
    { type: 'device', x: 2, y: 0 },                        // zonder apparaat
    { type: 'device', ref: 'a1', x: 2, y: 0, w: 2, h: 1, extra: 'weg' },
  ] });
  assert.strictEqual(r.status, 200);
  r = await call(port, 'GET', '/api/state');
  assert.deepStrictEqual(r.json.layout.home, [{ type: 'clock', x: 0, y: 0, w: 2, h: 2, variant: 'digital' }, { type: 'device', x: 2, y: 0, w: 2, h: 1, ref: 'a1' }], 'alleen geldige tegels');
  assert.strictEqual(r.json.layout.custom, true);
  r = await call(port, 'POST', '/api/layout', { screens: [{ key: 'clock', on: true }, { key: 'hb:Woonkamer', on: false }, { key: 'clock', on: false }] });
  r = await call(port, 'GET', '/api/state');
  assert.deepStrictEqual(r.json.layout.screens.map((x) => x.key + ':' + x.on), ['clock:true', 'hb:Woonkamer:false', 'hb:Overig:true'], 'opgeslagen volgorde, nieuwe kamers erachter');
  assert.strictEqual((await call(port, 'POST', '/api/layout', { theme: 'roze' })).status, 400);
  assert.strictEqual((await call(port, 'POST', '/api/layout', { theme: 'eigen' })).status, 400, 'eigen foto vereist een upload');
  assert.strictEqual((await call(port, 'POST', '/api/layout', { theme: 'nacht' })).status, 200);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
  assert.strictEqual((await call(port, 'POST', '/api/background', { image: 'data:image/png;base64,AAAA' })).status, 400);
  r = await call(port, 'POST', '/api/background', { image: 'data:image/jpeg;base64,' + jpg.toString('base64') });
  assert.strictEqual(r.status, 200); assert.ok(r.json.bg > 0);
  const bgr = await call(port, 'GET', '/bg');
  assert.strictEqual(bgr.status, 200); assert.strictEqual(bgr.raw.length, jpg.length); assert.strictEqual(bgr.type, 'image/jpeg');
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.layout.theme, 'eigen');
  await call(port, 'POST', '/api/background', { remove: true });
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.layout.theme, 'warm'); assert.strictEqual(r.json.bg, 0);
  assert.strictEqual((await call(port, 'GET', '/bg')).status, 404);
  const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.strictEqual(saved.layout.home.length, 2, 'indeling bewaard in config.json');
  await call(port, 'POST', '/api/layout', { home: null, screens: [] });
  for (const pg of ['/editor', '/editor.js', '/setup']) assert.strictEqual((await call(port, 'GET', pg)).status, 200, pg);
  console.log('ok  indeling: controle, schermen, thema\'s en eigen achtergrond');

  /* ---- Hue rechtstreeks ---- */
  r = await call(port, 'POST', '/api/setup', { hue: 'pair' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.hue.pairing.active, true);
  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    await new Promise((res2) => setTimeout(res2, 750));
    r = await call(port, 'GET', '/api/setup');
    done = r.json.hue.pairing && r.json.hue.pairing.done;
  }
  assert.ok(done, 'koppelen gelukt na knopdruk');
  assert.strictEqual(pairTries, 3, 'bleef vragen tot de knop ingedrukt was');
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).hue.key, 'sleutel-123');
  assert.strictEqual(r.json.hue.paired, true); assert.strictEqual(r.json.hue.ok, true, JSON.stringify(r.json.hue));
  assert.ok(!JSON.stringify(r.json).includes('sleutel-123'), 'sleutel komt nooit terug naar de browser');
  console.log('ok  hue: koppelen wacht op de knop en bewaart de sleutel');

  await new Promise((res2) => setTimeout(res2, 2100)); // homebridge-cache laten verlopen
  r = await call(port, 'GET', '/api/state');
  const hr = r.json.rooms;
  assert.deepStrictEqual(hr.map((x) => x.name), ['Zolderkamer', 'Beneden', 'Overig', 'Woonkamer']);
  assert.strictEqual(hr[1].zone, true); assert.strictEqual(hr[1].key, 'hue:zone:zn1');
  assert.strictEqual(hr[0].tiles.filter((t) => t.name === 'Gang spot 2')[0].room, 'Zolderkamer', 'kamer gaat voor zone');
  const scr = r.json.layout.screens;
  assert.deepStrictEqual(scr.map((x) => x.name + ':' + x.on), ['Zolderkamer:true', 'Beneden:false', 'Overig:true', 'Woonkamer:true', 'Klok:false'], 'zones en klok standaard uit');
  assert.deepStrictEqual(hr[0].tiles.map((t) => t.name), ['Alle lampen', 'Zolderkamer spot 1', 'Gang spot 2', 'Avond', 'Lezen']);
  const ht = {}; hr[0].tiles.forEach((t) => { ht[t.name] = t; });
  assert.strictEqual(ht['Zolderkamer spot 1'].ct, 53); assert.strictEqual(ht['Zolderkamer spot 1'].text, 'Uit');
  assert.strictEqual(ht['Gang spot 2'].level, 50); assert.strictEqual(ht['Gang spot 2'].ct, undefined);
  assert.strictEqual(ht['Alle lampen'].on, true); assert.strictEqual(ht['Alle lampen'].level, 60);
  assert.strictEqual(ht['Lezen'].on, true); assert.strictEqual(ht['Avond'].on, false); assert.strictEqual(ht['Lezen'].kind, 'scene');
  const overig = hr[2].tiles.map((t) => t.name);
  assert.ok(overig.indexOf('Hue lamp via HB') === -1, 'Hue-lamp niet dubbel via Homebridge');
  assert.ok(overig.indexOf('Thermostaat') !== -1, 'Homebridge-tegels blijven');
  const los = hr[2].tiles.filter((t) => t.name === 'Losse lamp')[0];
  assert.ok(los && los.fault && los.text === 'Geen contact', 'lamp zonder kamer en zonder verbinding');
  console.log('ok  hue: kamers, groep, scènes, kleurtemperatuur, storing, geen dubbele lampen');

  const set = (id, ch, value) => call(port, 'POST', '/api/set', { id, char: ch, value });
  assert.strictEqual((await set('hue:light:l1', 'on', true)).status, 200);
  assert.strictEqual((await set('hue:light:l1', 'brightness', 35)).status, 200);
  assert.strictEqual((await set('hue:light:l1', 'ct', 0)).status, 200);
  assert.strictEqual((await set('hue:light:l1', 'ct', 100)).status, 200);
  assert.strictEqual((await set('hue:group:g1', 'on', false)).status, 200);
  assert.strictEqual((await set('hue:scene:s1', 'recall', true)).status, 200);
  assert.strictEqual((await set('hue:light:l2', 'ct', 50)).status, 502, 'lamp zonder kleurtemperatuur');
  assert.strictEqual((await set('hue:light:g1', 'on', true)).status, 502, 'verkeerd soort id');
  assert.strictEqual((await set('hue:light:bestaat-niet', 'on', true)).status, 502);
  assert.deepStrictEqual(hueLog, [
    'light/l1 {"on":{"on":true}}',
    'light/l1 {"dimming":{"brightness":35}}',
    'light/l1 {"color_temperature":{"mirek":454}}',
    'light/l1 {"color_temperature":{"mirek":250}}',
    'grouped_light/g1 {"on":{"on":false}}',
    'scene/s1 {"recall":{"action":"active"}}',
  ]);
  console.log('ok  hue: schakelen, dimmen, kleurtemperatuur, kamer uit, scène');

  r = await call(port, 'POST', '/api/setup', { hue: 'unpair' });
  assert.strictEqual(r.json.hue.paired, false);
  await new Promise((res2) => setTimeout(res2, 2100));
  r = await call(port, 'GET', '/api/state');
  assert.ok(r.json.rooms.some((x) => x.tiles.some((t) => t.name === 'Hue lamp via HB')), 'na ontkoppelen weer via Homebridge');
  console.log('ok  hue: ontkoppelen valt terug op Homebridge');

  r = await call(port, 'GET', '/');
  assert.strictEqual(r.status, 200);
  r = await call(port, 'GET', '/../server.js');
  assert.strictEqual(r.status, 404);
  console.log('ok  statische bestanden');

  app.server.close(); hbMock.close(); sonosMock.close(); hueMock.close();
  console.log('\nAlle tests geslaagd.');
})().catch((e) => { console.error('MISLUKT:', e); process.exit(1); });
