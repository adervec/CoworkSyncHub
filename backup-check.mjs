// Cold backup self-check: seeds a throwaway browser with settings, databases (a recording, dates, maps,
// tokens) and a pretend Google Drive, then drives backup.html and compares the downloaded file.
// Usage: node backup-check.mjs [--url https://adervec.github.io/portal-beta/backup.html]   (default: this folder, served locally)
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ui = process.argv.indexOf('--url');
let url = ui >= 0 ? process.argv[ui + 1] : null, server = null;
if (!url) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2' };
  server = http.createServer(async (req, res) => {
    try { const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); const body = await readFile(f); res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }).end(body); }
    catch { res.writeHead(404).end(); }
  }).listen(0);
  url = `http://localhost:${server.address().port}/backup.html`;
}
const fails = [], ok = (name, cond) => { if (!cond) fails.push(name); };
const TOKEN = 'ya29.' + 'a'.repeat(40);
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const p = await ctx.newPage(), errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });

// one app with a data inventory (house standard 23); the rest are matched by name
await p.route('**/Tachyread/app-data.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 1, localStorage: ['tr-*'], indexedDB: ['books'], drive: ['tachy-*.json'] }) }));
// a pretend Google: sign-in always succeeds, the Drive folder holds one text and one binary file
await p.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript',
  body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:'${TOKEN}'})},0)}}}}}};` }));
await p.route('https://www.googleapis.com/drive/v3/files**', r => {
  const u = new URL(r.request().url()), cors = { 'access-control-allow-origin': '*' };
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
  if (r.request().headers().authorization !== 'Bearer ' + TOKEN) return r.fulfill({ status: 401, headers: cors });
  if (u.pathname.endsWith('/files')) {
    return u.searchParams.get('pageToken')
      ? r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'f2', name: 'gymtracker-photo.bin', modifiedTime: '2026-11-02T00:00:00Z' }] }) })
      : r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ nextPageToken: 'p2', files: [{ id: 'f1', name: 'tachy-library.json', modifiedTime: '2026-11-01T00:00:00Z' }] }) });
  }
  return u.pathname.endsWith('/f1') ? r.fulfill({ headers: cors, contentType: 'application/json', body: '{"books":2}' })
    : r.fulfill({ headers: cors, contentType: 'application/octet-stream', body: Buffer.from([255, 254, 0, 1]) });
});

await p.goto(url);
await p.evaluate(async (TOKEN) => {
  localStorage.clear();
  localStorage.setItem('gymtracker-log', '{"a":1}');
  localStorage.setItem('tr-settings', '{"wpm":300}');
  localStorage.setItem('maker-font', 'serif');
  localStorage.setItem('zz-misc', 'x');
  localStorage.setItem('gymtracker-access-token', 'abc');
  localStorage.setItem('gymtracker-session', JSON.stringify({ access_token: TOKEN }));
  const open = (name, v, up) => new Promise((res, rej) => { const q = indexedDB.open(name, v); q.onupgradeneeded = () => up(q.result); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  let db = await open('speechimprover-db', 3, d => { d.createObjectStore('takes', { keyPath: 'id' }).createIndex('byWhen', 'when'); d.createObjectStore('kv'); });
  let tx = db.transaction(['takes', 'kv'], 'readwrite');
  tx.objectStore('takes').put({ id: 1, when: new Date(1e12), audio: new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'audio/webm' }),
    wave: new Float32Array([0.5, -1]), tags: new Map([['a', 1]]), tok: TOKEN, gone: undefined, $t: 'mine' });
  tx.objectStore('kv').put('hello', 'greeting');
  await done(tx); db.close();
  db = await open('books', 1, d => d.createObjectStore('b', { autoIncrement: true }));
  tx = db.transaction('b', 'readwrite'); tx.objectStore('b').put({ title: 'Dune' }); await done(tx); db.close();
  db = await open('mystery', 1, d => d.createObjectStore('x')); db.close();
}, TOKEN);
await p.reload();
await p.evaluate(() => window.backupReady);
const before = await p.evaluate(() => indexedDB.databases().then(l => l.map(d => d.name + '@' + d.version).sort().join()));

const groups = await p.$$eval('#local .group > summary b', l => l.map(x => x.textContent));
for (const g of ['GymTracker', 'SpeechImprover', 'Tachyread', 'Shared settings (font, language, hub)', 'Other data']) ok('group shown: ' + g, groups.includes(g));
ok('token keys are listed as left out', /Left out.*gymtracker-access-token/.test(await p.textContent('#local')) && /gymtracker-session/.test(await p.textContent('#local')));
await p.click('#local .group > summary b'); await p.click('#local .group[open] .item summary'); // a group opens, then an item shows its value
await p.waitForSelector('#local .item pre', { timeout: 3000 }).catch(() => {});
ok('an item opens to show its data', await p.$('#local .item pre'));
ok('no sideways scroll on a phone', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);

await p.click('#driveBtn');
await p.waitForFunction(() => /2 files added/.test(document.getElementById('driveMsg').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Drive copy added', /2 files added/.test(await p.textContent('#driveMsg')));

// leave "Other data" out, download, and read the file back
await p.evaluate(() => { for (const s of document.querySelectorAll('#local .group > summary')) if (/Other data/.test(s.textContent)) s.querySelector('input').checked = false; });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dl')]);
const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-check-')), file = path.join(dir, dl.suggestedFilename());
await dl.saveAs(file);
const text = await readFile(file, 'utf8'), snap = JSON.parse(text);
const bytes = s => [...Buffer.from(s, 'base64')];
ok('file name is dated', /^adervec-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()));
ok('format header', snap.format === 'adervec-backup' && snap.schema === 1 && !isNaN(Date.parse(snap.made)));
ok('settings are exact', snap.localStorage['gymtracker-log'] === '{"a":1}' && snap.localStorage['tr-settings'] === '{"wpm":300}' && snap.localStorage['maker-font'] === 'serif');
ok('unticked group is left out', !('zz-misc' in snap.localStorage) && !('mystery' in snap.indexedDB));
ok('tokens never reach the file', !text.includes('ya29.') && snap.skipped.includes('gymtracker-access-token') && snap.skipped.includes('gymtracker-session') && !('gymtracker-session' in snap.localStorage));
const sp = snap.indexedDB['speechimprover-db'], take = sp && sp.stores.takes.values[0];
ok('database shape is kept', sp && sp.version === 3 && sp.stores.takes.keyPath === 'id' && sp.stores.takes.indexes[0].name === 'byWhen' && sp.stores.takes.indexes[0].keyPath === 'when' && sp.stores.kv.keyPath === null);
ok('record with a clashing $t key is wrapped', take && take.$t === 'obj' && take.v.$t === 'mine');
const t = take ? take.v : {};
ok('recording bytes are exact', t.audio && t.audio.$t === 'blob' && t.audio.type === 'audio/webm' && bytes(t.audio.b64).join() === '1,2,3,255');
ok('date, typed array, map, undefined kept', t.when && t.when.v === 1e12 && t.wave.ctor === 'Float32Array' && new Float32Array(Uint8Array.from(bytes(t.wave.b64)).buffer)[1] === -1 && t.tags.$t === 'map' && t.tags.v[0][0] === 'a' && t.gone.$t === 'undef');
ok('a token inside a record is blanked', t.tok === '[token]');
ok('out-of-line keys are kept', sp && sp.stores.kv.keys[0] === 'greeting' && sp.stores.kv.values[0] === 'hello');
ok('inventory-declared database included', snap.indexedDB.books && snap.indexedDB.books.stores.b.values[0].title === 'Dune' && snap.indexedDB.books.stores.b.autoIncrement === true);
ok('a Drive file is matched to its app by the inventory', (await p.$$eval('#drive .group > summary b', l => l.map(x => x.textContent))).includes('Tachyread'));
ok('Drive files included, text and binary', snap.drive && snap.drive.length === 2 && snap.drive[0].text === '{"books":2}' && bytes(snap.drive[1].b64).join() === '255,254,0,1');
ok('backing up changed no database', before === await p.evaluate(() => indexedDB.databases().then(l => l.map(d => d.name + '@' + d.version).sort().join())));
ok('last backup is noted', /today/.test(await p.textContent('#last')) && /Saved/.test(await p.textContent('#dlMsg')));

// check a file: the good one reads, a damaged one says so
await p.setInputFiles('#file', file);
await p.waitForFunction(() => document.getElementById('fileMsg').textContent !== 'Reading…');
ok('a saved file checks as readable', /^Readable/.test(await p.textContent('#fileMsg')) && (await p.$$('#check .group')).length >= 3 && !(await p.$('#check input[type=checkbox]')));
const badFile = path.join(dir, 'bad.json'); await writeFile(badFile, text.slice(0, text.length / 2));
await p.setInputFiles('#file', badFile);
await p.waitForFunction(() => /damaged|not a backup/.test(document.getElementById('fileMsg').textContent), null, { timeout: 5000 }).catch(() => {});
ok('a damaged file is reported', /damaged/.test(await p.textContent('#fileMsg')));

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: true }); // SHOT=out.png to look at the page
// the About panel's button (what an iPhone home-screen app uses)
await p.evaluate(() => { const a = document.createElement('app-about'); document.body.appendChild(a); a.querySelector('details').open = true; });
const btn = p.locator('app-about button', { hasText: 'Back up my data' });
ok('About panel has the button', await btn.count() === 1);
if (await btn.count()) { const [d2] = await Promise.all([p.waitForEvent('download'), btn.click()]); ok('About button downloads a backup', /^adervec-backup-/.test(d2.suggestedFilename())); }

ok('no page or CSP errors: ' + errs.join(' | '), !errs.length);
await b.close(); if (server) server.close();
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'backup-check: all ok');
process.exit(fails.length ? 1 : 0);
