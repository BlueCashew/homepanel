'use strict';
/*
 * Test van het bijwerken, in een tijdelijke kopie van het paneel:
 *  1. een geslaagde update via de knop (downloaden, proefstart, overschakelen, herstart)
 *  2. een kapotte versie die de proefstart niet haalt (er verandert niets)
 *  3. een versie die na het overschakelen niet start (start.js zet de vorige terug)
 * systemd wordt nagebootst: stopt het proces, dan start de test het opnieuw.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const SRC = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'huispaneel-update-'));
const APP = path.join(TMP, 'app');
const FILES = ['server.js', 'start.js', 'public', 'README.md', 'huispaneel.service', 'config.example.json'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  FILES.forEach((f) => fs.cpSync(path.join(SRC, f), path.join(dir, f), { recursive: true }));
}

/* Maakt een pakket zoals GitHub het levert: één map <repo>-<sha>/ met de bestanden. */
function makeRelease(sha, change) {
  const dir = path.join(TMP, 'rel-' + sha.slice(0, 6), 'huispaneel-' + sha);
  copyTo(dir);
  change(dir);
  const tgz = path.join(TMP, sha + '.tgz');
  cp.execFileSync('tar', ['-czf', tgz, '-C', path.dirname(dir), path.basename(dir)]);
  return fs.readFileSync(tgz);
}

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const releases = {
  [SHA_B]: makeRelease(SHA_B, (d) => {
    const f = path.join(d, 'public', 'index.html');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<title>Huispaneel</title>', '<title>Huispaneel v2</title>'));
  }),
  /* Syntactisch goed, maar crasht bij het starten. */
  [SHA_C]: makeRelease(SHA_C, (d) => {
    const f = path.join(d, 'server.js');
    fs.writeFileSync(f, "'use strict';\nthrow new Error('kapotte versie');\n" + fs.readFileSync(f, 'utf8').replace("'use strict';", ''));
  }),
};
let latest = SHA_B;
let downloads = 0;

const gh = http.createServer((req, res) => {
  if (req.url === '/repos/test/huispaneel/commits/main') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ sha: latest, commit: { message: 'Versie ' + latest.slice(0, 1) + '\nmeer tekst', committer: { date: '2026-11-16T10:00:00Z' } } }));
  }
  const m = /^\/test\/huispaneel\/tar\.gz\/([0-9a-f]{40})$/.exec(req.url);
  if (m && releases[m[1]]) { downloads++; res.writeHead(200, { 'Content-Type': 'application/x-gzip' }); return res.end(releases[m[1]]); }
  res.writeHead(404); res.end();
});

function call(port, method, p, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* html */ } resolve({ status: res.statusCode, json: j, text: d }); });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let proc = null;
let keep = true;
let starts = 0;
const logs = [];
function launch(env) {
  starts++;
  proc = cp.spawn(process.execPath, [path.join(APP, 'start.js')], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (c) => logs.push(String(c).trim()));
  proc.stderr.on('data', (c) => logs.push('ERR ' + String(c).trim().split('\n')[0]));
  proc.on('exit', () => { if (keep) setTimeout(() => launch(env), 300); }); // zoals Restart=always
}

async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await fn()) return; await sleep(500); }
  throw new Error('Te lang gewacht op: ' + what + '\n' + logs.slice(-8).join('\n'));
}

(async () => {
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  const ghPort = gh.address().port;
  copyTo(APP);
  fs.writeFileSync(path.join(APP, 'VERSION'), SHA_A + '\n');
  const port = 18600 + Math.floor(Math.random() * 300);
  const cfg = { port, homebridge: { url: 'http://127.0.0.1:9' }, sonos: { enabled: false }, update: { repo: 'test/huispaneel', branch: 'main' }, hide: [] };
  fs.writeFileSync(path.join(APP, 'config.json'), JSON.stringify(cfg, null, 2));
  const cfgBefore = fs.readFileSync(path.join(APP, 'config.json'), 'utf8');
  const env = Object.assign({}, process.env, {
    HUISPANEEL_GITHUB_API: 'http://127.0.0.1:' + ghPort, HUISPANEEL_GITHUB_CODELOAD: 'http://127.0.0.1:' + ghPort,
  });
  delete env.HUISPANEEL_CONFIG;
  launch(env);
  await waitFor(async () => (await call(port, 'GET', '/api/setup')).status === 200, 15000, 'eerste start');

  /* --- 1. geslaagde update --- */
  let r = await call(port, 'GET', '/api/setup');
  assert.strictEqual(r.json.update.current, SHA_A);
  assert.strictEqual(r.json.update.available, true);
  assert.strictEqual(r.json.update.latest.message, 'Versie b');
  r = await call(port, 'POST', '/api/setup', { update: 'apply' });
  assert.strictEqual(r.json.update.busy, true);
  await waitFor(async () => { const s = await call(port, 'GET', '/api/setup'); return s.status === 200 && s.json.update.current === SHA_B; }, 60000, 'versie B');
  r = await call(port, 'GET', '/');
  assert.ok(r.text.includes('<title>Huispaneel v2</title>'), 'nieuwe pagina wordt geserveerd');
  assert.strictEqual(fs.readFileSync(path.join(APP, 'config.json'), 'utf8'), cfgBefore, 'config.json onaangeroerd');
  assert.strictEqual(fs.readFileSync(path.join(APP, '.backup', 'VERSION'), 'utf8').trim(), SHA_A, 'vorige versie bewaard');
  assert.ok(!fs.existsSync(path.join(APP, '.update')), 'werkmap opgeruimd');
  r = await call(port, 'GET', '/api/state');
  assert.strictEqual(r.json.version, SHA_B, 'paneel meldt nieuwe versie (iPad herlaadt daardoor)');
  console.log('ok  update: downloaden, proefstart, overschakelen en herstarten');

  await waitFor(async () => !fs.existsSync(path.join(APP, '.update-pending.json')), 40000, 'update als geslaagd gemarkeerd');
  console.log('ok  update: na een halve minuut draaien als geslaagd gemarkeerd');

  r = await call(port, 'POST', '/api/setup', { update: 'apply' });
  await waitFor(async () => { const s = await call(port, 'GET', '/api/setup'); return s.json && !s.json.update.busy; }, 10000, 'klaar');
  r = await call(port, 'GET', '/api/setup');
  assert.strictEqual(r.json.update.done, 'Je hebt de nieuwste versie al.');
  assert.strictEqual(downloads, 1, 'niet opnieuw gedownload');
  console.log('ok  update: niets te doen als de nieuwste versie al draait');

  /* --- 2. kapotte versie haalt de proefstart niet --- */
  latest = SHA_C;
  const startsBefore = starts;
  r = await call(port, 'POST', '/api/setup', { update: 'apply' });
  await waitFor(async () => { const s = await call(port, 'GET', '/api/setup'); return s.json && !s.json.update.busy && s.json.update.error; }, 60000, 'foutmelding');
  r = await call(port, 'GET', '/api/setup');
  assert.ok(/startte niet goed/.test(r.json.update.error), r.json.update.error);
  assert.strictEqual(r.json.update.current, SHA_B, 'versie B draait nog');
  assert.strictEqual(starts, startsBefore, 'geen herstart');
  assert.ok(!fs.readFileSync(path.join(APP, 'server.js'), 'utf8').includes('kapotte versie'), 'bestanden niet vervangen');
  console.log('ok  update: kapotte versie wordt geweigerd, er verandert niets');

  /* --- 3. versie die na het overschakelen niet start: start.js zet de vorige terug --- */
  keep = false;
  proc.kill(); await sleep(500);
  fs.rmSync(path.join(APP, '.backup'), { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, '.backup'));
  ['server.js', 'start.js', 'public', 'VERSION'].forEach((f) => fs.cpSync(path.join(APP, f), path.join(APP, '.backup', f), { recursive: true }));
  fs.cpSync(path.join(TMP, 'rel-cccccc', 'huispaneel-' + SHA_C, 'server.js'), path.join(APP, 'server.js'));
  fs.writeFileSync(path.join(APP, 'VERSION'), SHA_C + '\n');
  fs.writeFileSync(path.join(APP, '.update-pending.json'), JSON.stringify({ version: SHA_C, tries: 0 }));
  keep = true;
  const s0 = starts;
  launch(env);
  await waitFor(async () => (await call(port, 'GET', '/api/setup')).status === 200, 30000, 'terugzetten');
  assert.strictEqual(starts - s0, 4, 'drie mislukte starts, de vierde zet terug');
  r = await call(port, 'GET', '/api/setup');
  assert.strictEqual(r.json.update.current, SHA_B, 'vorige versie draait weer');
  assert.strictEqual(r.json.update.rolledBack, SHA_C, 'setup meldt het terugdraaien');
  assert.ok(!fs.existsSync(path.join(APP, '.update-pending.json')));
  console.log('ok  update: crashende versie wordt na drie pogingen teruggedraaid');

  keep = false; proc.kill(); gh.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nAlle updatetests geslaagd.');
  process.exit(0);
})().catch((e) => { console.error('MISLUKT:', e.message); keep = false; if (proc) proc.kill(); process.exit(1); });
