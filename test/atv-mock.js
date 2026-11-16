/* Nagebootste atv.py voor de tests: zelfde berichten, geen echte Apple TV. */
'use strict';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let pairing = null, connected = false, keys = [];
const state = () => send({ event: 'state', connected, name: 'Woonkamer', power: 'on', state: 'playing', title: 'Film', artist: 'Studio', app: { id: 'com.netflix.Netflix', name: 'Netflix' }, art: 'h1', apps: [{ id: 'com.netflix.Netflix', name: 'Netflix' }], keys });
send({ event: 'ready', pyatv: 'mock' });
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const ok = (result) => send({ id: m.id, ok: true, result });
    const err = (e) => send({ id: m.id, ok: false, error: e });
    if (m.cmd === 'scan') ok([{ id: 'ATV1', name: 'Woonkamer', address: '10.0.0.9', model: 'Apple TV 4K', paired: { companion: false, airplay: false } }]);
    else if (m.cmd === 'pair_begin') { pairing = m.protocol; ok({ pin: true }); }
    else if (m.cmd === 'pair_finish') { if (m.pin === '0000') err('Koppelen mislukt'); else { pairing = null; ok({ paired: true }); } }
    else if (m.cmd === 'connect') { connected = m.device === 'ATV1'; if (connected) { ok({}); state(); } else err('Apple TV niet gevonden'); }
    else if (m.cmd === 'key') { keys.push(m.key); ok({}); state(); }
    else if (m.cmd === 'launch') { keys.push('launch:' + m.app); ok({}); state(); }
    else if (m.cmd === 'artwork') ok({ mime: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') });
    else if (m.cmd === 'forget') { connected = false; ok({}); }
    else err('Onbekende opdracht');
  }
});
process.stdin.on('end', () => process.exit(0));
