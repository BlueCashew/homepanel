'use strict';
/*
 * Starter voor het huispaneel (dit is wat systemd start).
 * Startte een nieuwe versie na een update drie keer niet, dan zet dit bestand
 * de vorige versie terug uit .backup/ en start die.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MARK = path.join(ROOT, '.update-pending.json');
const BACKUP = path.join(ROOT, '.backup');

let mark = null;
try { mark = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) { mark = null; }

if (mark) {
  mark.tries = (Number(mark.tries) || 0) + 1;
  if (mark.tries > 3 && fs.existsSync(path.join(BACKUP, 'server.js'))) {
    fs.readdirSync(BACKUP).forEach((f) => {
      fs.rmSync(path.join(ROOT, f), { recursive: true, force: true });
      fs.cpSync(path.join(BACKUP, f), path.join(ROOT, f), { recursive: true });
    });
    try { fs.unlinkSync(MARK); } catch (e) { /* al weg */ }
    fs.writeFileSync(path.join(ROOT, '.update-rolledback'), String(mark.version || '') + '\n');
    console.log('[update] de nieuwe versie startte niet; vorige versie teruggezet');
  } else {
    fs.writeFileSync(MARK, JSON.stringify(mark));
  }
}

require('./server.js').start();
