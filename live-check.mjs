// live-check.mjs — after a deploy, open the LIVE site in headless Chrome and fail loudly if it is
// broken: a non-200 page, a script error, the house crash notice, or a page that renders nothing.
//
//   node live-check.mjs https://adervec.github.io/Mise/ [--tries 4] [--wait 20]
//
// GitHub Pages can take a minute to serve a new deploy, so a failure is retried a few times before
// it counts. Needs playwright-core and an installed Chrome (GitHub's ubuntu runners have one).
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
const tries = opt('--tries', 4), waitS = opt('--wait', 20);
if (!url) { console.error('usage: node live-check.mjs <url> [--tries N] [--wait S]'); process.exit(2); }

// Benign noise that is not this app's fault (same list as font.js's crash notice).
const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|AbortError|NotAllowedError/;

async function checkOnce() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => { if (!NOISE.test(e.message)) errors.push(e.message); });
    // a query string skips any cached copy of the page itself
    const res = await page.goto(url + (url.includes('?') ? '&' : '?') + 'live-check=' + Date.now(), { waitUntil: 'load', timeout: 60000 });
    const status = res ? res.status() : 0;
    await page.waitForTimeout(4000); // let startup code run
    const r = await page.evaluate(() => ({
      text: (document.body ? document.body.innerText : '').trim().length,
      crash: !!document.getElementById('app-crash-notice'),
      title: document.title,
    }));
    const problems = [];
    if (status !== 200) problems.push(`HTTP ${status}`);
    if (errors.length) problems.push('page errors: ' + errors.slice(0, 3).join(' | '));
    if (r.crash) problems.push('the crash notice is showing');
    if (r.text < 50) problems.push(`page rendered almost nothing (${r.text} chars)`);
    return { ok: !problems.length, problems, title: r.title, text: r.text };
  } finally {
    await browser.close();
  }
}

for (let i = 1; i <= tries; i++) {
  let r;
  try { r = await checkOnce(); } catch (e) { r = { ok: false, problems: ['could not load: ' + e.message.split('\n')[0]] }; }
  if (r.ok) { console.log(`live check ok: ${url} — "${r.title}", ${r.text} chars rendered`); process.exit(0); }
  console.log(`live check attempt ${i}/${tries} failed: ${r.problems.join('; ')}`);
  if (i < tries) await new Promise((res) => setTimeout(res, waitS * 1000));
}
console.error(`::error::The live site ${url} is broken after this deploy. Check it now; roll back by re-running the last good deploy.`);
process.exit(1);
