import { LOGO, setActiveNav } from './lib.js';
import { getIdentity } from './identity.js';
import { $ } from './dom.js';

document.getElementById('logo').innerHTML = LOGO;
getIdentity().then((me) => { const c = $('#me-chip .nm'); if (c) c.textContent = me.name; }).catch(() => { const c = $('#me-chip .nm'); if (c) c.textContent = 'Guest'; });

const routes = [
  [/^\/?$/, () => import('./views/home.js'), 'home'],
  [/^\/discover\/?$/, () => import('./views/discover.js'), 'discover'],
  [/^\/experiments\/?$/, () => import('./views/experiments.js'), 'experiments'],
  [/^\/e\/([\w-]+)\/run\/?$/, () => import('./views/run.js'), 'experiments'],
  [/^\/e\/([\w-]+)(?:\/(\w+))?\/?$/, () => import('./views/experiment.js'), 'experiments'],
  [/^\/o\/(obs_[0-9a-f]{12})\/?$/, () => import('./views/observation.js'), 'experiments'],
  [/^\/ledger\/?$/, () => import('./views/ledger.js'), 'ledger'],
  [/^\/method\/?$/, () => import('./views/method.js'), 'method'],
  [/^\/me\/?$/, () => import('./views/me.js'), 'me'],
];

const view = document.getElementById('view');
let cleanup = null, token = 0;

async function route() {
  const my = ++token;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  cleanup?.(); cleanup = null;
  document.body.classList.remove('day');
  for (const [re, load, nav] of routes) {
    const m = path.match(re);
    if (!m) continue;
    setActiveNav(path.includes('/observatory') ? 'observatory' : nav);
    view.innerHTML = '<div class="wrap section"><div class="skeleton" style="height:320px"></div></div>';
    try {
      const mod = await load();
      if (my !== token) return;
      view.innerHTML = '';
      const out = await mod.render(view, { params: m.slice(1), query: new URLSearchParams(query || ''), day: (v = true) => document.body.classList.toggle('day', v) });
      if (my !== token) { out?.(); return; }
      cleanup = out || null;
      if (mod.title) document.title = `${typeof mod.title === 'function' ? mod.title(m.slice(1)) : mod.title} — OBSERVED`;
      else document.title = 'OBSERVED — test the world yourself';
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="wrap section"><h1 class="h-lg">That didn’t load.</h1><p class="lede">${String(e.message || e).replace(/</g, '&lt;')}</p><a class="btn" href="#/">Back home</a></div>`;
    }
    if (!window.__keepScroll) window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = '<div class="wrap section"><h1 class="h-lg">Nothing here.</h1><p class="lede">That page doesn’t exist — but there’s a lot to measure.</p><a class="btn primary" href="#/experiments">Browse experiments</a></div>';
}

window.addEventListener('hashchange', route);
route();
