// ============================================================
//  Cut & Build — SPA logic (vanilla, no build step, on-device storage)
// ============================================================
import { api, kv } from './store.js';

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const toISO = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const todayISO = () => toISO(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (iso) => DOW[parseISO(iso).getDay()];
const prettyDate = (iso) => parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

let toastTimer;
function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (ok ? ' ok' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2200);
}

// ---------- rest timer (persists across re-renders; lives on <body>) ----------
const fmtRest = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const restTimer = {
  node: null, remaining: 0, iv: null,
  mount() {
    this.node = el(`<div id="rest-timer" class="rest-timer">
      <span class="rt-time">0:00</span>
      <button class="rt-add">+30s</button>
      <button class="rt-skip">Skip</button>
    </div>`);
    document.body.append(this.node);
    this.node.querySelector('.rt-add').onclick = () => { this.remaining += 30; this.paint(); this.node.classList.remove('done'); };
    this.node.querySelector('.rt-skip').onclick = () => this.stop();
  },
  start(sec) {
    this.remaining = sec;
    this.node.classList.remove('done');
    this.node.classList.add('show');
    this.paint();
    clearInterval(this.iv);
    this.iv = setInterval(() => this.tick(), 1000);
  },
  tick() { this.remaining -= 1; if (this.remaining <= 0) this.finish(); else this.paint(); },
  finish() {
    clearInterval(this.iv); this.remaining = 0; this.paint();
    this.node.classList.add('done');
    this.beep(); navigator.vibrate?.([180, 90, 180]);
    clearTimeout(this._hide); this._hide = setTimeout(() => this.stop(), 4000);
  },
  stop() { clearInterval(this.iv); this.node.classList.remove('show', 'done'); },
  paint() {
    const r = Math.max(0, this.remaining);
    this.node.querySelector('.rt-time').textContent = fmtRest(r);
  },
  beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const a = new AC(); const t = a.currentTime;
      [0, 0.26, 0.52].forEach((d, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
        o.connect(g); g.connect(a.destination);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.32, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
        o.start(t + d); o.stop(t + d + 0.22);
      });
      setTimeout(() => a.close(), 1600);
    } catch { /* audio unavailable */ }
  },
};

// ---------- app state ----------
const state = {
  settings: null,
  plan: null,
  activeDate: todayISO(),
  view: 'dashboard',
  session: null, // training tab (resolved to active program's first session)
};

// Active training block (strength + schedule + targets) for the current phase.
const activeProgram = () => state.plan.phases[state.settings.phase] || state.plan.phases.cut;

// Switch phase: flips the program AND loads that phase's macro targets.
async function setPhase(phase) {
  const ph = state.plan.phases[phase];
  if (!ph) return;
  state.settings = await api.put('/settings', { ...state.settings, phase, ...ph.targets });
  state.session = ph.strength[0].key;
  syncBrand();
  toast(`Switched to ${ph.label} phase`);
  render();
}

const syncBrand = () => {
  const ph = activeProgram();
  $('#brand-sub').textContent = `${ph.label} · ${state.settings.start_weight} → ${state.settings.goal_weight} lb`;
};

// ---------- SVG ring ----------
function ring(value, target, color, label, unit) {
  const pct = target > 0 ? Math.min(value / target, 1) : 0;
  const r = 40, C = 2 * Math.PI * r;
  const offset = C * (1 - pct);
  const over = value > target;
  const remaining = target - value;
  const sub = over ? `+${Math.round(value - target)} over` : `${Math.round(remaining)} left`;
  return `
    <div class="ring-card">
      <div class="ring">
        <svg viewBox="0 0 100 100">
          <circle class="track" cx="50" cy="50" r="${r}"></circle>
          <circle class="fill" cx="50" cy="50" r="${r}" stroke="${over ? 'var(--danger)' : color}"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="ring-center">
          <span class="val">${Math.round(value)}</span>
          <span class="unit">/ ${target}${unit}</span>
        </div>
      </div>
      <div class="ring-label">${label}</div>
      <div class="ring-sub">${sub}</div>
    </div>`;
}

// ---------- macro totals ----------
const sumMacros = (rows) => rows.reduce((a, r) => ({
  calories: a.calories + r.calories, protein: a.protein + r.protein, carbs: a.carbs + r.carbs, fat: a.fat + r.fat,
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });

// ============================================================
//  VIEWS
// ============================================================
const views = {};

// Extra planned-but-unlogged set rows, keyed by date|session|exercise.
const pendingSets = {};

// ---- Dashboard ----
views.dashboard = async () => {
  const s = state.settings;
  const [food, weights] = await Promise.all([
    api.get('/food?date=' + state.activeDate),
    api.get('/weight'),
  ]);
  const totals = sumMacros(food);

  // weight math
  const latest = weights[weights.length - 1];
  const cur = latest ? latest.weight : s.start_weight;
  const last7 = weights.slice(-7);
  const avg7 = last7.length ? last7.reduce((a, w) => a + w.weight, 0) / last7.length : cur;
  const lost = s.start_weight - cur;
  const toGo = cur - s.goal_weight;
  const progPct = Math.max(0, Math.min(100, ((s.start_weight - cur) / (s.start_weight - s.goal_weight)) * 100));
  const trendPill = lost > 0.1 ? `<span class="pill down">▼ ${lost.toFixed(1)} lb</span>`
    : lost < -0.1 ? `<span class="pill up">▲ ${Math.abs(lost).toFixed(1)} lb</span>`
    : `<span class="pill flat">— even</span>`;

  // today's schedule (from the active phase's program)
  const prog = activeProgram();
  const dow = dayName(state.activeDate);
  const sched = prog.schedule.find((x) => x.day === dow);
  const tagClass = sched ? sched.type : 'rest';

  const root = el(`<div class="grid" style="gap:22px"></div>`);

  // macro rings
  const phaseTag = state.settings.phase === 'cut' ? 'lift' : 'run';
  root.append(el(`
    <div>
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
        <span>Today's macros · ${prettyDate(state.activeDate)}</span>
        <span class="tag ${phaseTag}" style="letter-spacing:.02em">${esc(prog.label)} phase</span>
      </div>
      <div class="rings">
        ${ring(totals.calories, s.cal_target, 'var(--cal)', 'Calories', '')}
        ${ring(totals.protein, s.protein_target, 'var(--protein)', 'Protein', 'g')}
        ${ring(totals.carbs, s.carb_target, 'var(--carbs)', 'Carbs', 'g')}
        ${ring(totals.fat, s.fat_target, 'var(--fat)', 'Fat', 'g')}
      </div>
    </div>`));

  // weight + schedule row
  const row2 = el(`<div class="grid grid-2"></div>`);
  row2.append(el(`
    <div class="card pad-lg">
      <div class="card-head"><span class="card-title">Body weight</span>${trendPill}</div>
      <div class="stat">
        <span class="big">${cur.toFixed(1)} <span style="font-size:16px;color:var(--text-faint)">lb</span></span>
        <span class="sub">7-day avg <b>${avg7.toFixed(1)}</b> · goal ${s.goal_weight} · <b>${toGo > 0 ? toGo.toFixed(1) + ' to go' : 'goal hit! 🎉'}</b></span>
      </div>
      <div class="track-bar" style="margin-top:16px"><span style="width:${progPct}%;background:var(--accent)"></span></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-top:6px">
        <span>${s.start_weight} lb start</span><span>${Math.round(progPct)}%</span><span>${s.goal_weight} lb goal</span>
      </div>
    </div>`));
  row2.append(el(`
    <div class="card pad-lg">
      <div class="card-head"><span class="card-title">${dow} · on the plan</span><span class="tag ${tagClass}">${tagClass}</span></div>
      <div class="stat">
        <span class="big" style="font-size:22px;line-height:1.3">${sched ? esc(sched.session) : 'Rest'}</span>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px">
        ${tagClass === 'lift' ? `<button class="btn sm" data-goto="training">Log workout →</button>` : ''}
        ${tagClass === 'run' ? `<button class="btn sm" data-goto="running">Log run →</button>` : ''}
        <button class="btn-outline" data-goto="nutrition">Log food</button>
      </div>
    </div>`));
  root.append(row2);

  // quick log meals
  const quick = el(`
    <div class="card">
      <div class="card-head"><span class="card-title">Quick-log a meal</span><button class="btn-outline" data-goto="nutrition">Full nutrition →</button></div>
      <div class="chips" id="dash-chips"></div>
    </div>`);
  const chips = $('#dash-chips', quick) || quick.querySelector('.chips');
  state.plan.meals.forEach((m) => {
    const c = el(`<button class="chip"><span class="chip-txt"><span class="chip-slot">${esc(m.slot)}</span><span class="chip-name">${esc(m.name)}</span><span class="chip-macros">${m.calories} kcal · ${m.protein}p ${m.carbs}c ${m.fat}f</span></span></button>`);
    c.onclick = async () => { await api.post('/food', { date: state.activeDate, ...m }); toast(`Logged ${m.slot}`); render(); };
    chips.append(c);
  });
  root.append(quick);

  $$('[data-goto]', root).forEach((b) => (b.onclick = () => go(b.dataset.goto)));
  return root;
};

// ---- Nutrition ----
views.nutrition = async () => {
  const s = state.settings;
  const food = await api.get('/food?date=' + state.activeDate);
  const t = sumMacros(food);
  const root = el(`<div class="grid" style="gap:22px"></div>`);

  const bar = (name, val, target, color) => {
    const pct = Math.min(100, target > 0 ? (val / target) * 100 : 0);
    const over = val > target;
    return `<div class="macro-bar" style="--c:${color}">
      <div class="macro-bar-top"><span class="name">${name}</span><span class="num"><b>${Math.round(val)}</b> / ${target}${name === 'Calories' ? '' : 'g'}</span></div>
      <div class="track-bar"><span style="width:${pct}%;background:${over ? 'var(--danger)' : color}"></span></div>
    </div>`;
  };
  root.append(el(`
    <div class="card pad-lg">
      <div class="card-head"><span class="card-title">Totals · ${prettyDate(state.activeDate)}</span></div>
      ${bar('Calories', t.calories, s.cal_target, 'var(--cal)')}
      ${bar('Protein', t.protein, s.protein_target, 'var(--protein)')}
      ${bar('Carbs', t.carbs, s.carb_target, 'var(--carbs)')}
      ${bar('Fat', t.fat, s.fat_target, 'var(--fat)')}
    </div>`));

  // daily meals — log + expandable prep
  const dayTot = sumMacros(state.plan.meals);
  const presets = el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Daily meals</span><span class="head-meta">${dayTot.calories} kcal · ${dayTot.protein}p</span></div><div id="meal-list"></div></div>`);
  const ml = presets.querySelector('#meal-list');
  state.plan.meals.forEach((m) => {
    const card = el(`<div class="meal-card">
      <div class="meal-head">
        <div class="meal-headmain">
          <span class="meal-slot">${esc(m.slot)}</span>
          <span class="meal-name">${esc(m.name)}</span>
          <span class="meal-macros"><b>${m.calories}</b> kcal · <b>${m.protein}</b>p <b>${m.carbs}</b>c <b>${m.fat}</b>f</span>
        </div>
        <button class="btn sm meal-log">Log</button>
      </div>
      ${(m.ingredients || m.prep) ? `<button class="meal-toggle" aria-expanded="false">Ingredients & prep ▾</button>
      <div class="meal-body" hidden>
        ${m.ingredients ? `<div class="meal-sub">Ingredients</div><ul class="meal-ing">${m.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        ${m.prep ? `<div class="meal-sub">Prep</div><ol class="meal-steps">${m.prep.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      </div>` : ''}
    </div>`);
    card.querySelector('.meal-log').onclick = async () => {
      await api.post('/food', { date: state.activeDate, name: m.name, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat });
      toast(`Logged ${m.slot}`); render();
    };
    const toggle = card.querySelector('.meal-toggle');
    if (toggle) toggle.onclick = () => {
      const body = card.querySelector('.meal-body');
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Hide prep ▴' : 'Ingredients & prep ▾';
    };
    ml.append(card);
  });
  root.append(presets);

  // custom add
  const form = el(`
    <div class="card">
      <div class="card-head"><span class="card-title">Add custom food</span></div>
      <div class="inline-form">
        <div class="field" style="flex:2;min-width:160px"><label>Food</label><input class="inp" id="f-name" placeholder="e.g. Protein shake" /></div>
        <div class="field"><label>Cal</label><input class="inp" id="f-cal" type="number" inputmode="numeric" placeholder="0" /></div>
        <div class="field"><label>Protein</label><input class="inp" id="f-p" type="number" inputmode="numeric" placeholder="0" /></div>
        <div class="field"><label>Carbs</label><input class="inp" id="f-c" type="number" inputmode="numeric" placeholder="0" /></div>
        <div class="field"><label>Fat</label><input class="inp" id="f-f" type="number" inputmode="numeric" placeholder="0" /></div>
        <button class="btn" id="f-add">Add</button>
      </div>
    </div>`);
  form.querySelector('#f-add').onclick = async () => {
    const name = $('#f-name', form).value.trim();
    if (!name) return toast('Enter a food name', false);
    await api.post('/food', {
      date: state.activeDate, name,
      calories: +$('#f-cal', form).value || 0, protein: +$('#f-p', form).value || 0,
      carbs: +$('#f-c', form).value || 0, fat: +$('#f-f', form).value || 0,
    });
    toast('Food added'); render();
  };
  root.append(form);

  // log list
  const list = el(`<div class="card"><div class="card-head"><span class="card-title">Logged today (${food.length})</span></div><div id="food-list"></div></div>`);
  const lw = list.querySelector('#food-list');
  if (!food.length) lw.append(el(`<div class="empty">Nothing logged yet. Tap a meal above to start.</div>`));
  food.forEach((f) => {
    const r = el(`<div class="row">
      <div class="row-main"><div class="row-title">${esc(f.name)}</div></div>
      <div class="row-macros"><span><b>${f.calories}</b> kcal</span><span><b>${f.protein}</b>p</span><span><b>${f.carbs}</b>c</span><span><b>${f.fat}</b>f</span></div>
      <button class="del-btn" title="Delete">✕</button>
    </div>`);
    r.querySelector('.del-btn').onclick = async () => { await api.del('/food/' + f.id); toast('Removed'); render(); };
    lw.append(r);
  });
  root.append(list);

  // shopping list (checkable, persisted on-device)
  const checked = kv.get('shop', {});
  const shop = el(`<div class="card"><div class="card-head"><span class="card-title">Weekly shopping list</span><button class="btn-outline" id="shop-reset">Uncheck all</button></div><div id="shop-wrap"></div></div>`);
  const sw = shop.querySelector('#shop-wrap');
  state.plan.shoppingList.forEach((cat) => {
    const group = el(`<div class="shop-group"><div class="shop-cat">${esc(cat.category)}</div></div>`);
    cat.items.forEach((item) => {
      const on = !!checked[item];
      const line = el(`<label class="shop-item ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''}/><span>${esc(item)}</span></label>`);
      line.querySelector('input').onchange = (e) => {
        checked[item] = e.target.checked; kv.set('shop', checked);
        line.classList.toggle('on', e.target.checked);
      };
      group.append(line);
    });
    sw.append(group);
  });
  shop.querySelector('#shop-reset').onclick = () => { kv.set('shop', {}); render(); };
  root.append(shop);
  return root;
};

// ---- Weight ----
views.weight = async () => {
  const s = state.settings;
  const weights = await api.get('/weight');
  const root = el(`<div class="grid" style="gap:22px"></div>`);

  const cur = weights.length ? weights[weights.length - 1].weight : s.start_weight;
  const last7 = weights.slice(-7);
  const avg7 = last7.length ? last7.reduce((a, w) => a + w.weight, 0) / last7.length : cur;
  const progPct = Math.max(0, Math.min(100, ((s.start_weight - cur) / (s.start_weight - s.goal_weight)) * 100));

  // add form
  const form = el(`
    <div class="card">
      <div class="card-head"><span class="card-title">Log weight</span></div>
      <div class="inline-form">
        <div class="field"><label>Date</label><input class="inp" type="date" id="w-date" value="${state.activeDate}" /></div>
        <div class="field"><label>Weight (lb)</label><input class="inp" type="number" step="0.1" inputmode="decimal" id="w-val" placeholder="${cur.toFixed(1)}" /></div>
        <button class="btn" id="w-add">Save</button>
      </div>
      <p style="font-size:12px;color:var(--text-faint);margin-top:10px">Weigh in same time each day. The 7-day average is what matters — daily numbers bounce.</p>
    </div>`);
  form.querySelector('#w-add').onclick = async () => {
    const val = +$('#w-val', form).value;
    if (!val) return toast('Enter a weight', false);
    await api.post('/weight', { date: $('#w-date', form).value, weight: val });
    toast('Weight saved'); render();
  };

  // stat cards
  const stats = el(`<div class="grid grid-3">
    <div class="card"><div class="stat"><span class="lbl">Current</span><span class="big">${cur.toFixed(1)}</span><span class="sub">${weights.length ? prettyDate(weights[weights.length - 1].date) : 'no entries'}</span></div></div>
    <div class="card"><div class="stat"><span class="lbl">7-day avg</span><span class="big" style="color:var(--protein)">${avg7.toFixed(1)}</span><span class="sub">the number that counts</span></div></div>
    <div class="card"><div class="stat"><span class="lbl">To goal</span><span class="big" style="color:var(--accent)">${Math.max(0, cur - s.goal_weight).toFixed(1)}</span><span class="sub">${Math.round(progPct)}% there</span></div></div>
  </div>`);

  root.append(stats, form);

  // chart
  const chart = el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Trend</span></div><div id="chart"></div>
    <div class="legend"><span><i style="background:var(--m-weight)"></i> Daily</span><span><i style="background:var(--tx-1)"></i> 7-day avg</span><span><i style="background:var(--acc)"></i> Goal ${s.goal_weight}</span></div></div>`);
  chart.querySelector('#chart').append(weightChart(weights, s));
  root.append(chart);

  // history
  const hist = el(`<div class="card"><div class="card-head"><span class="card-title">History (${weights.length})</span></div><div id="w-list"></div></div>`);
  const wl = hist.querySelector('#w-list');
  if (!weights.length) wl.append(el(`<div class="empty">No weigh-ins yet.</div>`));
  [...weights].reverse().forEach((w, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? w.weight - prev.weight : 0;
    const dTxt = prev ? (delta > 0 ? `<span class="pill up">▲ ${delta.toFixed(1)}</span>` : delta < 0 ? `<span class="pill down">▼ ${Math.abs(delta).toFixed(1)}</span>` : `<span class="pill flat">—</span>`) : '';
    const r = el(`<div class="row"><div class="row-main"><div class="row-title">${w.weight.toFixed(1)} lb</div><div class="row-sub">${prettyDate(w.date)}</div></div>${dTxt}<button class="del-btn">✕</button></div>`);
    r.querySelector('.del-btn').onclick = async () => { await api.del('/weight/' + w.id); toast('Removed'); render(); };
    wl.append(r);
  });
  root.append(hist);
  return root;
};

function weightChart(weights, s) {
  const W = 720, H = 240, pad = { l: 38, r: 14, t: 16, b: 24 };
  if (weights.length < 2) {
    return el(`<div class="empty">Log at least two weigh-ins to see your trend.</div>`);
  }
  const pts = weights.map((w) => ({ x: parseISO(w.date).getTime(), y: w.weight }));
  // moving average
  const avg = weights.map((_, i) => {
    const slice = weights.slice(Math.max(0, i - 6), i + 1);
    return { x: parseISO(weights[i].date).getTime(), y: slice.reduce((a, w) => a + w.weight, 0) / slice.length };
  });
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys, s.goal_weight) - 1, maxY = Math.max(...ys, s.start_weight) + 1;
  const sx = (x) => pad.l + ((x - minX) / (maxX - minX || 1)) * (W - pad.l - pad.r);
  const sy = (y) => pad.t + (1 - (y - minY) / (maxY - minY || 1)) * (H - pad.t - pad.b);
  const line = (arr) => arr.map((p, i) => (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
  const area = `${line(pts)} L${sx(maxX).toFixed(1)} ${sy(minY).toFixed(1)} L${sx(minX).toFixed(1)} ${sy(minY).toFixed(1)} Z`;
  const goalY = sy(s.goal_weight);
  // y ticks
  const ticks = 4, tickEls = [];
  for (let i = 0; i <= ticks; i++) {
    const yv = minY + (i / ticks) * (maxY - minY);
    tickEls.push(`<text class="chart-lbl" x="4" y="${(sy(yv) + 3).toFixed(1)}">${yv.toFixed(0)}</text>`);
  }
  return el(`<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:240px">
    <defs><linearGradient id="wtArea" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="var(--m-weight)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--m-weight)" stop-opacity="0"/>
    </linearGradient></defs>
    ${tickEls.join('')}
    <line class="chart-goal" x1="${pad.l}" x2="${W - pad.r}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}"></line>
    <path class="chart-area" d="${area}"></path>
    <path class="chart-avg" d="${line(avg)}"></path>
    <path class="chart-line" d="${line(pts)}"></path>
    ${pts.map((p) => `<circle class="chart-dot" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3"></circle>`).join('')}
  </svg></div>`);
}

// ---- Training (per-set logging) ----
const restForScheme = (scheme) => (/(×\s*5)|(6[–-]8)/.test(scheme) ? 150 : 90);
const bySetNo = (a, b) => (a.set_no || 0) - (b.set_no || 0) || a.id - b.id;

views.training = async () => {
  const allSets = await api.get('/strength/all');
  const program = activeProgram();
  const root = el(`<div class="grid" style="gap:18px"></div>`);

  let sess = program.strength.find((x) => x.key === state.session);
  if (!sess) { sess = program.strength[0]; state.session = sess.key; }
  const todayAll = allSets.filter((r) => r.date === state.activeDate);

  // session tabs
  const tabs = el(`<div class="session-tabs"></div>`);
  program.strength.forEach((s) => {
    const n = todayAll.filter((l) => l.session === s.key).length;
    const b = el(`<button class="session-tab ${s.key === state.session ? 'active' : ''}">${esc(s.title)} <small>${s.day}${n ? ' · ' + n + ' set' + (n > 1 ? 's' : '') : ''}</small></button>`);
    b.onclick = () => { state.session = s.key; render(); };
    tabs.append(b);
  });
  const header = el(`<div><div class="section-label">${esc(program.label)} · Workout · ${prettyDate(state.activeDate)}</div></div>`);
  header.append(tabs);
  root.append(header);

  const card = el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">${esc(sess.title)} — ${sess.day}</span>${sess.focus ? `<span class="head-meta">${esc(sess.focus)}</span>` : ''}</div></div>`);

  // rest-timer presets
  const restBar = el(`<div class="rest-bar"><span class="rest-lbl">Rest</span></div>`);
  [60, 90, 120, 180].forEach((sec) => {
    const b = el(`<button class="rest-preset">${fmtRest(sec)}</button>`);
    b.onclick = () => restTimer.start(sec);
    restBar.append(b);
  });
  card.append(restBar);

  sess.exercises.forEach((ex) => {
    const today = todayAll.filter((l) => l.exercise === ex.name && l.session === sess.key).sort(bySetNo);
    const prior = allSets.filter((r) => r.exercise === ex.name && r.date < state.activeDate);
    const prevDate = prior.length ? prior.reduce((m, r) => (r.date > m ? r.date : m), '') : null;
    const prev = prevDate ? prior.filter((r) => r.date === prevDate).sort(bySetNo) : [];

    const defaultN = parseInt(ex.scheme, 10) || 3;
    const pkey = `${state.activeDate}|${sess.key}|${ex.name}`;
    const baseN = Math.max(defaultN, today.length);
    const rowN = baseN + (pendingSets[pkey] || 0);

    const block = el(`<div class="ex-block">
      <div class="ex-top">
        <div class="ex-info">
          <div class="ex-name">${esc(ex.name)}</div>
          <div class="ex-meta"><span class="ex-scheme">${esc(ex.scheme)}</span>${ex.video ? ` · <a class="ex-video" href="${ex.video.url}" target="_blank" rel="noopener">▶ Form</a>` : ''}${prevDate ? ` · prev ${esc(prettyDate(prevDate))}` : ''}</div>
        </div>
        <span class="ex-count ${today.length >= defaultN ? 'complete' : ''}">${today.length}/${defaultN}</span>
      </div>
      <div class="set-head"><span>Set</span><span>Prev</span><span>lb</span><span>Reps</span><span></span></div>
      <div class="set-rows"></div>
      <div class="set-actions"><button class="set-add">+ Add set</button>${(pendingSets[pkey] || 0) > 0 ? '<button class="set-del">− Remove set</button>' : ''}</div>
    </div>`);
    const rowsWrap = block.querySelector('.set-rows');

    for (let i = 0; i < rowN; i++) {
      const logged = today[i] || null;
      const pv = prev[i] || null;
      const setNo = i + 1;
      const row = el(`<div class="set-row ${logged ? 'done' : ''}">
        <span class="set-no">${setNo}</span>
        <span class="set-prev">${pv ? `${pv.weight ?? '–'}×${pv.reps ?? '–'}` : '—'}</span>
        <input class="set-w" inputmode="decimal" enterkeyhint="next" value="${logged ? (logged.weight ?? '') : (pv ? (pv.weight ?? '') : '')}" placeholder="${pv && pv.weight != null ? pv.weight : 'lb'}" />
        <input class="set-r" inputmode="numeric" enterkeyhint="done" value="${logged ? (logged.reps ?? '') : (pv ? (pv.reps ?? '') : '')}" placeholder="${pv && pv.reps != null ? pv.reps : 'reps'}" />
        <button class="set-check ${logged ? 'on' : ''}" aria-label="${logged ? 'Completed, tap to undo' : 'Mark set done'}">${logged ? '✓' : ''}</button>
      </div>`);
      const wIn = row.querySelector('.set-w'), rIn = row.querySelector('.set-r'), chk = row.querySelector('.set-check');

      chk.onclick = async () => {
        if (logged) { await api.del('/strength/' + logged.id); render(); return; }
        const weight = wIn.value === '' ? null : Number(wIn.value);
        const reps = rIn.value === '' ? null : Number(rIn.value);
        if (weight == null && reps == null) return toast('Enter weight & reps', false);
        await api.post('/strength', { date: state.activeDate, session: sess.key, exercise: ex.name, set_no: setNo, weight, reps });
        if ((pendingSets[pkey] || 0) > 0 && i >= baseN) pendingSets[pkey] -= 1;
        restTimer.start(restForScheme(ex.scheme));
        toast(`${ex.name} · set ${setNo} done · resting ${fmtRest(restForScheme(ex.scheme))}`);
        render();
      };
      if (logged) {
        const save = async () => {
          await api.put('/strength/' + logged.id, {
            weight: wIn.value === '' ? null : Number(wIn.value),
            reps: rIn.value === '' ? null : Number(rIn.value),
          });
          toast('Set updated');
        };
        wIn.onchange = save; rIn.onchange = save;
      }
      rowsWrap.append(row);
    }

    block.querySelector('.set-add').onclick = () => { pendingSets[pkey] = (pendingSets[pkey] || 0) + 1; render(); };
    const del = block.querySelector('.set-del');
    if (del) del.onclick = () => { pendingSets[pkey] = Math.max(0, (pendingSets[pkey] || 0) - 1); render(); };

    card.append(block);
  });

  root.append(card);
  return root;
};

// ---- Running ----
views.running = async () => {
  const runs = await api.get('/runs');
  const root = el(`<div class="grid" style="gap:18px"></div>`);
  const byWeek = {};
  runs.forEach((r) => { const w = r.week || 0; (byWeek[w] ||= []).push(r); });

  const totalRuns = runs.length;
  const targetRuns = state.plan.runWeeks.length * 3;
  // current week = first week with < 3 runs
  const curWeek = state.plan.runWeeks.find((w) => (byWeek[w.week] || []).length < 3) || state.plan.runWeeks[state.plan.runWeeks.length - 1];

  root.append(el(`<div class="grid grid-3">
    <div class="card"><div class="stat"><span class="lbl">Runs done</span><span class="big">${totalRuns}<span style="font-size:16px;color:var(--text-faint)">/${targetRuns}</span></span></div></div>
    <div class="card"><div class="stat"><span class="lbl">Current week</span><span class="big" style="color:var(--accent)">${curWeek.week}</span><span class="sub">${esc(curWeek.interval)}</span></div></div>
    <div class="card"><div class="stat"><span class="lbl">Logging to</span><span class="big" style="font-size:20px;line-height:1.4">${prettyDate(state.activeDate)}</span><span class="sub">tap a dot to log a run</span></div></div>
  </div>`));

  root.append(el(`<div class="section-label">8-week run/walk progression · all easy pace</div>`));

  state.plan.runWeeks.forEach((w) => {
    const done = (byWeek[w.week] || []).length;
    const row = el(`<div class="week-row ${done >= 3 ? 'done' : ''}">
      <div class="week-num"><small>Week</small><b>${w.week}</b></div>
      <div class="week-body">
        <div class="week-interval">${esc(w.interval)}</div>
        <div class="week-note">${esc(w.note)}</div>
        <div class="week-progress"></div>
      </div>
    </div>`);
    const prog = row.querySelector('.week-progress');
    for (let i = 0; i < 3; i++) {
      const filled = i < done;
      const dot = el(`<button class="run-dot ${filled ? 'filled' : ''}">${filled ? '✓' : ''}</button>`);
      dot.onclick = () => setWeekRuns(w.week, done, i, byWeek[w.week] || []);
      prog.append(dot);
    }
    prog.append(el(`<span class="runs-lbl">${done}/3 runs</span>`));
    root.append(row);
  });

  root.append(el(`<div class="card" style="margin-top:8px"><div class="card-head"><span class="card-title">Running rules — matters more at 41</span></div>
    <ul class="note-list">${state.plan.runCoaching.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`));
  return root;
};

async function setWeekRuns(week, curDone, clickedIdx, weekRuns) {
  // clicking dot i -> target count = (curDone === i+1) ? i : i+1
  const target = curDone === clickedIdx + 1 ? clickedIdx : clickedIdx + 1;
  if (target > curDone) {
    for (let k = curDone; k < target; k++) await api.post('/runs', { date: state.activeDate, week });
    toast(`Week ${week} run logged`);
  } else {
    const sorted = [...weekRuns].sort((a, b) => b.id - a.id);
    for (let k = curDone; k > target; k--) { const r = sorted.shift(); if (r) await api.del('/runs/' + r.id); }
    toast(`Week ${week} run removed`);
  }
  render();
}

// ---- Plan (reference + settings) ----
views.plan = async () => {
  const s = state.settings;
  const prog = activeProgram();
  const root = el(`<div class="grid" style="gap:22px"></div>`);

  // phase toggle — Cut (active) vs Bulk (queued); flips program + macro targets
  const phaseCard = el(`<div class="card pad-lg">
    <div class="card-head"><span class="card-title">Training phase</span></div>
    <div class="session-tabs" id="phase-tabs" style="margin-bottom:14px">
      <button class="session-tab ${s.phase === 'cut' ? 'active' : ''}" data-phase="cut">Cut <small>Full Body 3×</small></button>
      <button class="session-tab ${s.phase === 'bulk' ? 'active' : ''}" data-phase="bulk">Bulk <small>Upper/Lower 4×</small></button>
    </div>
    <div class="stat" style="gap:6px;padding:0;background:none;border:0;box-shadow:none">
      <span class="lbl">${esc(prog.label)} · ${esc(prog.goal)}</span>
      <span class="sub" style="color:var(--tx-2)">${esc(prog.note)}</span>
    </div>
  </div>`);
  phaseCard.querySelectorAll('[data-phase]').forEach((b) => {
    b.onclick = () => { if (b.dataset.phase !== s.phase) setPhase(b.dataset.phase); };
  });
  root.append(phaseCard);

  // weekly schedule (active phase)
  root.append(el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Weekly schedule</span><span class="head-meta">${esc(prog.label)}</span></div>
    <table class="plan-table"><tbody>
      ${prog.schedule.map((d) => `<tr><td style="width:60px;font-weight:600">${d.day}</td><td>${esc(d.session)}</td><td style="text-align:right"><span class="tag ${d.type}">${d.type}</span></td></tr>`).join('')}
    </tbody></table></div>`));

  // macros + settings editor
  const setCard = el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Targets</span><button class="btn-outline" id="edit-toggle">Edit</button></div>
    <div class="grid grid-3" id="target-view">
      <div class="stat"><span class="lbl">Calories</span><span class="big">${s.cal_target}</span></div>
      <div class="stat"><span class="lbl">Protein</span><span class="big" style="color:var(--protein)">${s.protein_target}g</span></div>
      <div class="stat"><span class="lbl">Carbs</span><span class="big" style="color:var(--carbs)">${s.carb_target}g</span></div>
      <div class="stat"><span class="lbl">Fat</span><span class="big" style="color:var(--fat)">${s.fat_target}g</span></div>
      <div class="stat"><span class="lbl">Start</span><span class="big">${s.start_weight}</span></div>
      <div class="stat"><span class="lbl">Goal</span><span class="big" style="color:var(--accent)">${s.goal_weight}</span></div>
    </div>
    <div id="target-edit" style="display:none">
      <div class="grid grid-3" style="gap:12px">
        ${['cal_target|Calories', 'protein_target|Protein', 'carb_target|Carbs', 'fat_target|Fat', 'start_weight|Start wt', 'goal_weight|Goal wt'].map((f) => {
          const [k, lbl] = f.split('|'); return `<div class="field"><label>${lbl}</label><input class="inp" type="number" step="0.1" data-k="${k}" value="${s[k]}" /></div>`;
        }).join('')}
      </div>
      <div style="margin-top:14px;display:flex;gap:10px"><button class="btn" id="save-targets">Save</button><button class="btn-outline" id="cancel-targets">Cancel</button></div>
    </div></div>`);
  setCard.querySelector('#edit-toggle').onclick = () => {
    const v = setCard.querySelector('#target-view'), e = setCard.querySelector('#target-edit');
    const showing = e.style.display === 'none';
    v.style.display = showing ? 'none' : ''; e.style.display = showing ? '' : 'none';
  };
  setCard.querySelector('#cancel-targets').onclick = () => render();
  setCard.querySelector('#save-targets').onclick = async () => {
    const payload = {};
    $$('[data-k]', setCard).forEach((i) => (payload[i.dataset.k] = +i.value));
    state.settings = await api.put('/settings', payload);
    syncBrand();
    toast('Targets updated'); render();
  };
  root.append(setCard);

  // strength reference (active phase)
  const strCard = el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Strength program</span><span class="head-meta">${esc(prog.label)} · ${prog.strength.length}-day</span></div><div class="grid grid-3" id="str-grid"></div></div>`);
  const sg = strCard.querySelector('#str-grid');
  prog.strength.forEach((sess) => {
    sg.append(el(`<div><h3 style="font-size:14px;margin-bottom:4px">${esc(sess.title)} <span style="color:var(--text-faint);font-weight:400">· ${sess.day}</span></h3>
      ${sess.focus ? `<div style="font-size:11px;color:var(--tx-3);margin-bottom:10px">${esc(sess.focus)}</div>` : ''}
      <ul class="note-list">${sess.exercises.map((e) => `<li><span>${esc(e.name)} <b style="color:var(--accent)">${esc(e.scheme)}</b></span></li>`).join('')}</ul></div>`));
  });
  root.append(strCard);

  // meal plan
  root.append(el(`<div class="card pad-lg"><div class="card-head"><span class="card-title">Meal plan · ~${s.cal_target} kcal / ${s.protein_target}g protein</span></div>
    <table class="plan-table"><thead><tr><th>Slot</th><th>Meal</th><th style="text-align:right">Cal</th><th style="text-align:right">P/C/F</th></tr></thead><tbody>
      ${state.plan.meals.map((m) => `<tr><td><b>${esc(m.slot)}</b></td><td>${esc(m.name)}</td><td style="text-align:right">${m.calories}</td><td style="text-align:right;color:var(--text-dim)">${m.protein}/${m.carbs}/${m.fat}</td></tr>`).join('')}
    </tbody></table></div>`));

  return root;
};

// ============================================================
//  ROUTER + INIT
// ============================================================
const TITLES = { dashboard: 'Dashboard', nutrition: 'Nutrition', weight: 'Weight', training: 'Training', running: 'Running', plan: 'The Plan' };

function go(view) { state.view = view; render(); }

async function render() {
  // nav highlight
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $$('.mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#view-title').textContent = TITLES[state.view];
  $('#active-date').value = state.activeDate;

  const container = $('#view');
  container.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const node = await views[state.view]();
    container.innerHTML = '';
    container.append(node);
    container.scrollTo?.(0, 0);
  } catch (e) {
    container.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function shiftDate(days) {
  const d = parseISO(state.activeDate); d.setDate(d.getDate() + days);
  state.activeDate = toISO(d); render();
}

async function init() {
  // theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  $('#theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; localStorage.setItem('theme', next);
  };

  // nav wiring
  $$('.nav-item, .mobile-nav button').forEach((b) => (b.onclick = () => go(b.dataset.view)));
  $('#date-prev').onclick = () => shiftDate(-1);
  $('#date-next').onclick = () => shiftDate(1);
  $('#date-today').onclick = () => { state.activeDate = todayISO(); render(); };
  $('#active-date').onchange = (e) => { state.activeDate = e.target.value; render(); };

  restTimer.mount();

  // bootstrap
  const boot = await api.get('/bootstrap');
  state.settings = boot.settings;
  state.plan = boot.plan;
  state.session = activeProgram().strength[0].key;
  syncBrand();

  render();
}

init().catch((e) => { $('#view').innerHTML = `<div class="empty">Failed to load: ${esc(e.message)}</div>`; });
