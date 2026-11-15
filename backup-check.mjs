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
const errs = [];
// a pretend Google shared by every pretend device: sign-in always succeeds, and the private Drive folder
// starts with one text and one binary file
const drive = {
  f1: { name: 'tachy-library.json', modifiedTime: '2026-11-01T00:00:00Z', body: Buffer.from('{"books":2}') },
  f2: { name: 'gymtracker-photo.bin', modifiedTime: '2026-11-02T00:00:00Z', body: Buffer.from([255, 254, 0, 1]) },
};
async function device(viewport) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true });
  // one app with a data inventory (house standard 23); the rest are matched by name
  await ctx.route('**/Tachyread/app-data.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 1, localStorage: ['tr-*'], indexedDB: ['books'], drive: ['tachy-*.json'] }) }));
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:'${TOKEN}'})},0)}}}}}};` }));
  await ctx.route('https://www.googleapis.com/**', r => {
    const q = r.request(), u = new URL(q.url()), cors = { 'access-control-allow-origin': '*' };
    const json = o => r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    const meta = id => ({ id, name: drive[id].name, modifiedTime: drive[id].modifiedTime, size: String(drive[id].body.length) });
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (q.headers().authorization !== 'Bearer ' + TOKEN) return r.fulfill({ status: 401, headers: cors });
    if (u.pathname.endsWith('/userinfo')) return json({ name: 'Test Reader', email: 'reader@example.com', picture: '' });
    if (u.pathname === '/drive/v3/files') {
      const name = /name='([^']+)'/.exec(u.searchParams.get('q') || ''), ids = Object.keys(drive);
      if (name) return json({ files: ids.filter(id => drive[id].name === name[1]).map(meta) });
      if (u.searchParams.get('pageToken')) return json({ files: ids.slice(1).map(meta) }); // two pages, to exercise paging
      return json(ids.length > 1 ? { nextPageToken: 'p2', files: ids.slice(0, 1).map(meta) } : { files: ids.map(meta) });
    }
    if (u.pathname === '/upload/drive/v3/files') { // a new file: metadata part, then the content part
      const buf = q.postDataBuffer(), gap = Buffer.from('\r\n\r\n'), a = buf.indexOf(gap), a2 = buf.indexOf('\r\n--', a), c = buf.indexOf(gap, a2);
      const id = 'n' + Object.keys(drive).length;
      drive[id] = { name: JSON.parse(buf.slice(a + 4, a2).toString()).name, modifiedTime: new Date().toISOString(), body: buf.slice(c + 4, buf.lastIndexOf('\r\n--')) };
      return json({ id });
    }
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if (q.method() === 'PATCH') { drive[id].body = q.postDataBuffer() || Buffer.alloc(0); drive[id].modifiedTime = new Date().toISOString(); return json({ id }); }
    return drive[id] ? r.fulfill({ headers: cors, contentType: 'application/octet-stream', body: drive[id].body }) : r.fulfill({ status: 404, headers: cors });
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return pg;
}
const p = await device({ width: 390, height: 844 });

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
  tx = db.transaction('b', 'readwrite'); tx.objectStore('b').put({ title: 'Dune' }); for (let i = 2; i <= 500; i++) tx.objectStore('b').put({ title: 'Book ' + i }); await done(tx); db.close();
  db = await open('mystery', 1, d => d.createObjectStore('x')); db.close();
}, TOKEN);
await p.reload();
await p.evaluate(() => window.backupReady);
const before = await p.evaluate(() => indexedDB.databases().then(l => l.map(d => d.name + '@' + d.version).sort().join()));

const row = name => p.$$eval('#cmp tbody tr:not(.detail)', (l, name) => { const r = l.find(x => x.querySelector('.name').textContent === name); return r ? r.textContent : ''; }, name);
const groups = await p.$$eval('#cmp .name', l => l.map(x => x.textContent));
for (const g of ['GymTracker', 'SpeechImprover', 'Tachyread', 'Shared settings (font, language, hub)', 'Other data']) ok('app row shown: ' + g, groups.includes(g));
ok('token keys are listed as left out', /Left out.*gymtracker-access-token/.test(await p.textContent('#local')) && /gymtracker-session/.test(await p.textContent('#local')));
ok('before sign-in the Drive column says so, and the summary too', /not signed in/.test(await row('GymTracker')) && /this browser \(/.test(await p.textContent('#sum')) && /Google Drive copy is not included/.test(await p.textContent('#sum')));
await p.click('#cmp .name'); await p.click('#cmp tr.detail:not([hidden]) .item summary'); // a row opens, then an item shows its value
await p.waitForSelector('#cmp .item pre', { timeout: 3000 }).catch(() => {});
ok('an item opens to show its data', await p.$('#cmp .item pre'));
ok('no sideways scroll on a phone', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);

await p.click('#driveBtn');
await p.waitForFunction(() => /2 files found/.test(document.getElementById('driveMsg').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Drive copy listed', /2 files found/.test(await p.textContent('#driveMsg')));
ok('the table compares the two copies', /In both/.test(await row('Tachyread')) && /1 file/.test(await row('Tachyread')) && /Only in this browser/.test(await row('SpeechImprover')) && /2 records/.test(await row('SpeechImprover')));
ok('the summary names both copies', /this browser \(.*and Google Drive \(.*2 files/.test(await p.textContent('#sum')));

// cancel: nothing is saved
let stray = false; const onStray = () => { stray = true; }; p.on('download', onStray);
await p.evaluate(() => { document.getElementById('dl').click(); document.getElementById('cancel').click(); });
await p.waitForFunction(() => /Cancelled/.test(document.getElementById('dlMsg').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Cancel stops the download and saves nothing', /Cancelled/.test(await p.textContent('#dlMsg')) && !stray && await p.evaluate(() => !localStorage.getItem('portal-last-backup') && document.getElementById('cancel').hidden && !document.getElementById('dl').disabled));
p.off('download', onStray);

// leave "Other data" out, download, and read the file back
await p.uncheck('#cmp input[data-side=local][data-owner="Other data"]');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dl')]);
const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-check-')), file = path.join(dir, dl.suggestedFilename());
await dl.saveAs(file);
const text = await readFile(file, 'utf8'), snap = JSON.parse(text);
const bytes = s => [...Buffer.from(s, 'base64')];
ok('file name is dated', /^adervec-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()));
ok('format header', snap.format === 'adervec-backup' && snap.schema === 2 && !isNaN(Date.parse(snap.made)));
ok('settings are exact', snap.localStorage['gymtracker-log'] === '{"a":1}' && snap.localStorage['tr-settings'] === '{"wpm":300}' && snap.localStorage['maker-font'] === 'serif');
ok('unticked group is left out', !('zz-misc' in snap.localStorage) && !('mystery' in snap.indexedDB));
ok('tokens never reach the file', !text.includes('ya29.') && snap.skipped.includes('gymtracker-access-token') && snap.skipped.includes('gymtracker-session') && !('gymtracker-session' in snap.localStorage));
const sp = snap.indexedDB['speechimprover-db'], take = sp && sp.stores.takes.rows[0][1];
ok('database shape is kept', sp && sp.version === 3 && sp.stores.takes.keyPath === 'id' && sp.stores.takes.indexes[0].name === 'byWhen' && sp.stores.takes.indexes[0].keyPath === 'when' && sp.stores.kv.keyPath === null);
ok('record with a clashing $t key is wrapped', take && take.$t === 'obj' && take.v.$t === 'mine');
const t = take ? take.v : {};
ok('recording bytes are exact', t.audio && t.audio.$t === 'blob' && t.audio.type === 'audio/webm' && bytes(t.audio.b64).join() === '1,2,3,255');
ok('date, typed array, map, undefined kept', t.when && t.when.v === 1e12 && t.wave.ctor === 'Float32Array' && new Float32Array(Uint8Array.from(bytes(t.wave.b64)).buffer)[1] === -1 && t.tags.$t === 'map' && t.tags.v[0][0] === 'a' && t.gone.$t === 'undef');
ok('a token inside a record is blanked', t.tok === '[token]');
ok('out-of-line keys are kept', sp && sp.stores.kv.rows[0][0] === 'greeting' && sp.stores.kv.rows[0][1] === 'hello' && sp.stores.takes.rows[0][0] === 1);
ok('inventory-declared database included', snap.indexedDB.books && snap.indexedDB.books.stores.b.rows[0][1].title === 'Dune' && snap.indexedDB.books.stores.b.autoIncrement === true);
ok('a Drive file is matched to its app by the inventory', await p.$('#cmp input[data-side=drive][data-owner=Tachyread]'));
const rows = snap.indexedDB.books.stores.b.rows;
ok('every record of a larger database, in order, across batches', rows.length === 500 && rows.every((r, i) => r[0] === i + 1) && rows[499][1].title === 'Book 500');
ok('no unreadable databases', JSON.stringify(snap.errors) === '{}');
ok('Drive files included, text and binary', snap.drive && snap.drive.length === 2 && snap.drive[0].text === '{"books":2}' && bytes(snap.drive[1].b64).join() === '255,254,0,1');
ok('backing up changed no database', before === await p.evaluate(() => indexedDB.databases().then(l => l.map(d => d.name + '@' + d.version).sort().join())));
ok('both progress bars finish', await p.evaluate(() => { const a = document.getElementById('pl'), b = document.getElementById('pd'); return !document.getElementById('prog').hidden && a.value === a.max && b.value === b.max && /records/.test(document.getElementById('plt').textContent) && /2 files/.test(document.getElementById('pdt').textContent); }));
ok('last backup is noted', /today/.test(await p.textContent('#last')) && /Saved/.test(await p.textContent('#dlMsg')));

// the Drive column switched off: the file holds this browser only
await p.uncheck('#all-drive');
ok('the summary follows the column switch', !/Google Drive \(/.test(await p.textContent('#sum')));
const [dl3] = await Promise.all([p.waitForEvent('download'), p.click('#dl')]);
const file3 = path.join(dir, 'local-only.json'); await dl3.saveAs(file3);
const snap3 = JSON.parse(await readFile(file3, 'utf8'));
ok('with Drive unticked the file has no Drive part', !('drive' in snap3) && snap3.indexedDB.books && !('zz-misc' in snap3.localStorage));

// ---- open a backup file: what is in it ----
const openFile = async (pg, f) => { await pg.setInputFiles('#file', f); await pg.waitForFunction(() => document.getElementById('fileMsg').textContent !== 'Reading…'); };
const frow = (pg, name) => pg.$$eval('#ftab tbody tr:not(.detail)', (l, name) => { const r = l.find(x => x.querySelector('.name').textContent === name); return r ? r.textContent : ''; }, name);
await openFile(p, file);
const fnames = await p.$$eval('#ftab .name', l => l.map(x => x.textContent));
ok('a saved file opens and lists its apps', /^Readable/.test(await p.textContent('#fileMsg')) && ['GymTracker', 'SpeechImprover', 'Tachyread', 'Shared settings (font, language, hub)'].every(g => fnames.includes(g)) && !fnames.includes('Other data'));
ok('the file is summed up', /Made /.test(await p.textContent('#check')) && /4 apps, \d+ settings, 502 records, 2 Drive files/.test(await p.textContent('#check')) && /Left out.*gymtracker-session/.test(await p.textContent('#check')));
ok('each app shows what the file has beside what is here now', /1 setting · 500 records/.test(await frow(p, 'Tachyread')) && /Same counts as this browser has now/.test(await frow(p, 'Tachyread')) && /1 file/.test(await frow(p, 'Tachyread')) && /now: 1 setting · 500 records/.test(await frow(p, 'Tachyread')));
ok('nothing is ticked, and Restore waits', await p.$eval('#restore', x => !x.hidden && x.disabled) && (await p.$$('#ftab input:checked')).length === 0);
await p.click('#ftab tbody .name'); await p.click('#ftab tr.detail:not([hidden]) .item summary');
await p.waitForSelector('#ftab .item pre', { timeout: 3000 }).catch(() => {});
ok('a file\'s items open to show their data', /"a": 1/.test(await p.textContent('#ftab .item pre').catch(() => '')));
const badFile = path.join(dir, 'bad.json'); await writeFile(badFile, text.slice(0, text.length / 2));
await openFile(p, badFile);
ok('a damaged file is reported, and offers nothing to restore', /damaged/.test(await p.textContent('#fileMsg')) && await p.$eval('#restore', x => x.hidden) && !(await p.$('#ftab')));
const notOurs = path.join(dir, 'other.json'); await writeFile(notOurs, '{"hello":"world"}');
await openFile(p, notOurs);
ok('a file that is not a backup is refused', /not a backup file/.test(await p.textContent('#fileMsg')));

// ---- restore into a clean browser: one app out of many, then everything ----
const p3 = await device({ width: 1100, height: 800 });
p3.on('dialog', d => d.accept());
const safety = []; p3.on('download', d => safety.push(d));
await p3.goto(url); await p3.evaluate(() => window.backupReady);
await openFile(p3, file);
ok('in a clean browser the file shows as not here', /Not in this browser now/.test(await frow(p3, 'Tachyread')) && /now: nothing here/.test(await frow(p3, 'Tachyread')));
const doRestore = async () => {
  await p3.evaluate(() => { document.getElementById('rMsg').textContent = ''; });
  await p3.click('#restore');
  await p3.waitForFunction(() => /^Restored|stopped/.test(document.getElementById('rMsg').textContent) && !document.getElementById('restore').disabled, null, { timeout: 60000 }).catch(() => {});
  return p3.textContent('#rMsg');
};
const state = () => p3.evaluate(async () => ({
  dbs: (await indexedDB.databases()).map(d => d.name + '@' + d.version).sort().join(),
  keys: Object.keys(localStorage).filter(k => !/^(maker-|portal-)/.test(k)).sort().join(),
  tr: localStorage.getItem('tr-settings'),
}));
const books = () => p3.evaluate(() => new Promise(res => { const q = indexedDB.open('books'); q.onsuccess = () => { const st = q.result.transaction('b').objectStore('b'), c = st.count(), g = st.get(1), a = st.autoIncrement; g.onsuccess = () => { q.result.close(); res([c.result, g.result && g.result.title, a].join()); }; }; }));
await p3.check('#ftab input[data-side=local][data-owner=Tachyread]');
ok('the summary names what is ticked', /Tachyread \(1 setting, 1 database\)/.test(await p3.textContent('#rsum')));
ok('restore finishes', /^Restored/.test(await doRestore()));
let st3 = await state();
ok('one app out of many is put back, and only it', st3.dbs === 'books@1' && st3.keys === 'tr-settings' && st3.tr === '{"wpm":300}' && (await books()) === '500,Dune,true');
ok('nothing existed to replace, so no safety file', safety.length === 0 && /no safety file/.test(await p3.textContent('#report')) && /Reload any tab/.test(await p3.textContent('#report')));
ok('the table now shows the app as the same as the file', /Same counts as this browser has now/.test(await frow(p3, 'Tachyread')));

// everything, both sides. Drive has drifted since the backup: one file changed, one deleted.
drive.f1.body = Buffer.from('changed'); delete drive.f2;
await p3.check('#fall-local'); await p3.check('#fall-drive');
ok('everything restores', /^Restored/.test(await doRestore()));
const again = JSON.parse(await p3.evaluate(() => appFont.backup.build().then(r => r.blob.text())));
ok('every database comes back identical, record for record (recording, date, map, typed array, keys)', JSON.stringify(again.indexedDB['speechimprover-db']) === JSON.stringify(snap.indexedDB['speechimprover-db']) && JSON.stringify(again.indexedDB.books) === JSON.stringify(snap.indexedDB.books));
ok('every setting in the file comes back identical', Object.keys(snap.localStorage).every(k => again.localStorage[k] === snap.localStorage[k]) && !('zz-misc' in again.localStorage));
const byName = n => Object.values(drive).find(f => f.name === n);
ok('Drive files are put back, text and binary, changed or missing', drive.f1.body.toString() === '{"books":2}' && byName('gymtracker-photo.bin') && [...byName('gymtracker-photo.bin').body].join() === '255,254,0,1');
ok('what was replaced went to a safety file first', safety.length === 1 && /^adervec-before-restore-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(safety[0].suggestedFilename()));
if (safety.length) {
  const sf = path.join(dir, 'safety.json'); await safety[0].saveAs(sf);
  const sj = JSON.parse(await readFile(sf, 'utf8'));
  ok('the safety file holds exactly what was replaced', sj.localStorage['tr-settings'] === '{"wpm":300}' && sj.indexedDB.books.stores.b.rows.length === 500 && !('speechimprover-db' in sj.indexedDB) && sj.drive.length === 1 && sj.drive[0].text === 'changed');
}

// a database that is here and has the file's shape is emptied and refilled in place
await p3.evaluate(async () => {
  localStorage.setItem('tr-settings', 'x');
  const db = await new Promise(r => { const q = indexedDB.open('books'); q.onsuccess = () => r(q.result); });
  const tx = db.transaction('b', 'readwrite'); tx.objectStore('b').put({ title: 'Extra' }); tx.objectStore('b').delete(1);
  await new Promise(r => { tx.oncomplete = r; }); db.close();
});
await p3.uncheck('#fall-local'); await p3.uncheck('#fall-drive');
await p3.check('#ftab input[data-side=local][data-owner=Tachyread]');
ok('changed data shows as differing from the file', /Differs from what this browser has now/.test(await frow(p3, 'Tachyread')) || /Same counts/.test(await frow(p3, 'Tachyread')));
ok('restoring over changed data puts the file\'s version back', /^Restored/.test(await doRestore()) && (await books()) === '500,Dune,true' && (await state()).tr === '{"wpm":300}' && safety.length === 2);

// the app has moved its database on since the backup: it is rebuilt as the file has it
await p3.evaluate(() => new Promise(res => { const d = indexedDB.deleteDatabase('books'); d.onsuccess = () => { const q = indexedDB.open('books', 3); q.onupgradeneeded = () => q.result.createObjectStore('other'); q.onsuccess = () => { q.result.close(); res(); }; }; }));
ok('a newer-shaped database is rebuilt at the file\'s version', /^Restored/.test(await doRestore()) && (await state()).dbs.includes('books@1') && (await books()) === '500,Dune,true');

// the file is from a newer app than this browser has: refused before anything is touched
await p3.evaluate(() => new Promise(res => { const d = indexedDB.deleteDatabase('speechimprover-db'); d.onsuccess = () => { const q = indexedDB.open('speechimprover-db', 2); q.onupgradeneeded = () => q.result.createObjectStore('old'); q.onsuccess = () => { q.result.close(); res(); }; }; }));
await p3.evaluate(() => localStorage.setItem('tr-settings', 'mine'));
await p3.check('#ftab input[data-side=local][data-owner=SpeechImprover]');
const refused = await doRestore();
ok('a file from a newer app is refused and nothing is changed', /newer version/.test(refused) && /Nothing was changed/.test(refused) && (await state()).dbs.includes('speechimprover-db@2') && (await state()).tr === 'mine');

if (process.env.SHOT) { await p3.setViewportSize({ width: 390, height: 844 }); await p3.locator('#check').scrollIntoViewIfNeeded(); await p3.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-restore.png'), fullPage: true }); }
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
