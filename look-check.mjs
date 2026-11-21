// Look-and-feel scan (house standard 29, scan only): opens every app's live first screen on a phone and a
// desktop, in the device's light and dark setting, and measures what makes apps feel like one family or
// not: fonts, type sizes, colours, button and card shapes, the top bar, navigation, names and icons.
// It changes nothing. It writes look.json and screenshots into the folder given with --out.
//   node look-check.mjs --out ../_review            every app in apps.json, live
//   node look-check.mjs GymTracker315,Mise --out ../_review
// ponytail: the first screen only (no sign-in, no data); deeper screens need seeded states, add when wanted.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), oi = argv.indexOf('--out'), out = oi >= 0 ? path.resolve(argv[oi + 1]) : null;
const only = argv.find((x, i) => !x.startsWith('--') && i !== oi + 1);
const apps = JSON.parse(readFileSync(path.join(HUB, 'apps.json'), 'utf8')).filter((a) => !only || only.split(',').includes(a.slug));
if (out) mkdirSync(path.join(out, 'shots'), { recursive: true });

// runs inside the page: everything measured from what is actually drawn
function measure() {
  const vw = innerWidth, vh = innerHeight, cs = (el) => getComputedStyle(el);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = cs(el); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < vh * 3 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.1; };
  const px = (v) => Math.round(parseFloat(v) || 0);
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[, /]+/).map(Number); return p.length > 3 && p[3] < 0.05 ? null : p.slice(0, 3); };
  const hex = (c) => { const p = rgb(c); return p ? '#' + p.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : ''; };
  const lum = (c) => { const p = rgb(c); if (!p) return null; const f = p.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const sat = (c) => { const p = rgb(c); if (!p) return 0; const mx = Math.max(...p), mn = Math.min(...p); return mx ? (mx - mn) / mx : 0; };
  const family = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim();
  const top = (list) => { const n = {}; list.forEach((x) => { if (x !== '' && x != null) n[x] = (n[x] || 0) + 1; }); return Object.entries(n).sort((a, b) => b[1] - a[1]); };
  const first = (list) => (top(list)[0] || [''])[0];
  const pageBg = () => { for (const el of [document.body, document.documentElement]) { const h = hex(cs(el).backgroundColor); if (h) return h; } return '#ffffff'; };
  const body = cs(document.body), bg = pageBg();
  const heads = [...document.querySelectorAll('h1,h2')].filter(visible);
  const h = heads[0] ? cs(heads[0]) : null;
  const btns = [...document.querySelectorAll('button, [role=button], input[type=button], input[type=submit], a.btn, a.button, .btn, .button')].filter(visible).slice(0, 80);
  const filled = btns.filter((b) => hex(cs(b).backgroundColor) && hex(cs(b).backgroundColor) !== bg);
  const label = (b) => (b.innerText || b.value || '').trim().split('\n')[0];
  const labels = btns.map(label).filter((t) => /[A-Za-z]{3}/.test(t) && t.length < 40);
  const casing = (t) => { const w = t.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter((x) => x.length > 2); if (!w.length) return ''; if (t === t.toUpperCase()) return 'UPPERCASE'; if (w.length > 1 && w.every((x) => x[0] === x[0].toUpperCase())) return 'Title Case'; if (t === t.toLowerCase()) return 'lowercase'; return 'Sentence case'; };
  const boxes = [...document.querySelectorAll('section, article, div, li, form, details')].filter((el) => { if (!visible(el)) return false; const r = el.getBoundingClientRect(), s = cs(el); return r.width * r.height > 18000 && r.width < vw * 0.98 && px(s.borderTopLeftRadius) > 0 && (hex(s.backgroundColor) && hex(s.backgroundColor) !== bg || px(s.borderTopWidth) > 0); }).slice(0, 60);
  const bars = [...document.querySelectorAll('header, nav, [role=banner], [role=navigation], [role=tablist], .topbar, .navbar, .tabbar, .tabs, footer')].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect(), s: cs(el) }));
  const topBar = bars.find((b) => b.r.top < 8 && b.r.width > vw * 0.8 && b.r.height < 140);
  const bottomBar = bars.find((b) => b.r.bottom > vh - 8 && b.r.width > vw * 0.8 && b.r.height < 120 && /fixed|sticky/.test(b.s.position));
  const side = bars.find((b) => b.r.height > vh * 0.6 && b.r.width < vw * 0.4 && b.r.left < 8);
  const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 40);
  const svgs = [...document.querySelectorAll('button svg, a svg, nav svg, header svg')].filter(visible).length;
  const emoji = (document.body.innerText.slice(0, 6000).match(/\p{Extended_Pictographic}/gu) || []).length;
  const accentPool = filled.map((b) => hex(cs(b).backgroundColor)).filter((c) => sat(cs(document.body).color) < 2 && sat('rgb(' + parseInt(c.slice(1, 3), 16) + ',' + parseInt(c.slice(3, 5), 16) + ',' + parseInt(c.slice(5, 7), 16) + ')') > 0.35);
  const man = document.querySelector('link[rel=manifest]');
  const root = document.documentElement;
  const tBg = cs(root).getPropertyValue('--t-bg').trim().toLowerCase();
  return {
    title: document.title,
    manifest: man ? man.href : '',
    themeColor: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content).join(' / '),
    icon: (document.querySelector('link[rel~=icon]') || {}).href ? ((document.querySelector('link[rel~=icon]').href.match(/\.(svg|png|ico)(\?|$)/) || [0, 'other'])[1]) : 'none',
    appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
    bodyFont: family(body.fontFamily), bodySize: px(body.fontSize), bodyLine: body.lineHeight === 'normal' ? 'normal' : (parseFloat(body.lineHeight) / parseFloat(body.fontSize)).toFixed(2),
    usesHouseFont: /Atkinson/.test(body.fontFamily) || /var\(--app-font/.test(document.body.getAttribute('style') || ''),
    bg, text: hex(body.color), dark: (lum('rgb(' + parseInt(bg.slice(1, 3), 16) + ',' + parseInt(bg.slice(3, 5), 16) + ',' + parseInt(bg.slice(5, 7), 16) + ')') || 0) < 0.2,
    usesHousePalette: !!tBg && tBg === bg,
    headFont: h ? family(h.fontFamily) : '', headSize: h ? px(h.fontSize) : 0, headWeight: h ? h.fontWeight : '', headCase: h ? h.textTransform : '', headText: heads[0] ? heads[0].innerText.trim().slice(0, 40) : '',
    buttons: btns.length, btnRadius: first(filled.map((b) => px(cs(b).borderTopLeftRadius))), btnRadii: top(btns.map((b) => px(cs(b).borderTopLeftRadius))).length,
    btnHeight: first(filled.map((b) => Math.round(b.getBoundingClientRect().height / 2) * 2)), btnFont: first(btns.map((b) => family(cs(b).fontFamily))), btnSize: first(btns.map((b) => px(cs(b).fontSize))), btnWeight: first(filled.map((b) => cs(b).fontWeight)),
    btnSmall: btns.length ? Math.round(100 * btns.filter((b) => b.getBoundingClientRect().height < 40).length / btns.length) : 0,
    btnCase: first(labels.map(casing)), btnUpper: first(btns.map((b) => cs(b).textTransform)) === 'uppercase',
    accent: first(accentPool), accents: top(accentPool).length, link: first(links.map((a) => hex(cs(a).color))),
    cardRadius: first(boxes.map((b) => px(cs(b).borderTopLeftRadius))), cardRadii: top(boxes.map((b) => px(cs(b).borderTopLeftRadius))).length, cardShadow: boxes.some((b) => cs(b).boxShadow !== 'none'), cardBorder: boxes.some((b) => px(cs(b).borderTopWidth) > 0),
    topBar: topBar ? Math.round(topBar.r.height) : 0, topBarText: topBar ? topBar.el.innerText.trim().split('\n')[0].slice(0, 30) : '', topBarFixed: topBar ? /fixed|sticky/.test(topBar.s.position) : false,
    nav: bottomBar ? 'bottom bar' : side ? 'side bar' : topBar && topBar.el.querySelectorAll('a,button').length > 3 ? 'top bar' : 'none found',
    avatar: (() => { const a = document.querySelector('app-account'); if (!a) return 'none'; const r = a.getBoundingClientRect(); return r.width ? (r.left > vw / 2 ? 'top right' : 'top left') : 'placed, hidden until sign-in'; })(),
    svgIcons: svgs, emoji, pageHeight: Math.round(document.documentElement.scrollHeight / vh * 10) / 10, overflow: Math.max(0, document.documentElement.scrollWidth - vw),
  };
}

const b = await chromium.launch({ channel: 'chrome' });
const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const result = { at: new Date().toISOString(), apps: [] };
for (const a of apps) {
  const row = { slug: a.slug, title: a.title, url: `https://adervec.github.io/${a.slug}/`, views: {} };
  for (const [label, viewport] of Object.entries(sizes)) for (const scheme of label === 'phone' ? ['light', 'dark'] : ['light']) {
    const ctx = await b.newContext({ viewport, isMobile: label === 'phone', hasTouch: label === 'phone', colorScheme: scheme });
    const p = await ctx.newPage();
    try {
      await p.goto(row.url, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(3500);
      const m = await p.evaluate(measure);
      if (m.manifest && !row.manifest) row.manifest = await p.evaluate(async (u) => { try { const j = await (await fetch(u)).json(); return { name: j.name, short_name: j.short_name, theme_color: j.theme_color, background_color: j.background_color, display: j.display, icons: (j.icons || []).map((i) => i.sizes).join(' ') }; } catch { return null; } }, m.manifest);
      row.views[label + (scheme === 'dark' ? '-dark' : '')] = m;
      if (out) await p.screenshot({ path: path.join(out, 'shots', `${a.slug}-${label}${scheme === 'dark' ? '-dark' : ''}.png`) });
    } catch (e) { row.views[label + (scheme === 'dark' ? '-dark' : '')] = { error: String(e.message || e).split('\n')[0] }; }
    await ctx.close();
  }
  const v = row.views.phone || {};
  console.log((a.slug + ' '.repeat(26)).slice(0, 26), v.error ? 'ERROR ' + v.error : [v.bodyFont, v.bodySize + 'px', 'bg ' + v.bg, 'btn r' + v.btnRadius, 'card r' + v.cardRadius, 'nav ' + v.nav].join(' · '));
  result.apps.push(row);
}
await b.close();
if (out) { writeFileSync(path.join(out, 'look.json'), JSON.stringify(result)); console.log('wrote', path.join(out, 'look.json'), 'and', path.join(out, 'shots')); }
else console.log(JSON.stringify(result));
