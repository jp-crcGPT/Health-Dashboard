/* Health Baseline app: interface, storage on this device, report import, backup.
   All data lives in this browser's storage. Nothing is sent anywhere. */
(function () {
  'use strict';
  const HB = window.HB;
  const KEY = 'healthBaseline.v1';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  let today = HB.todayISO();
  let storageOK = true;
  let persistAsked = false;

  const ICON = {
    x: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.25 8 9.75l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------------- State ---------------- */
  function defaultState() {
    const t = HB.todayISO();
    return {
      v: 1, created: t,
      profiles: {
        man: { label: 'Man', sex: 'M', age: 32, ageAsOf: t, heightCm: null },
        woman: { label: 'Woman', sex: 'F', age: 27, ageAsOf: t, heightCm: null },
        partner: { label: 'Partner', sex: 'M', age: null, ageAsOf: null, heightCm: null }
      },
      results: [], vaccines: { man: {}, woman: {} },
      plan: { target: null, partner: 'separate', checks: {} },
      aliases: {}, lastBackup: null, lastChange: null, ui: { tab: 'man' }
    };
  }
  function upgrade(s) {
    const d = defaultState();
    s = s && typeof s === 'object' ? s : d;
    s.profiles = Object.assign({}, d.profiles, s.profiles || {});
    for (const k of Object.keys(d.profiles)) s.profiles[k] = Object.assign({}, d.profiles[k], s.profiles[k] || {});
    s.results = Array.isArray(s.results) ? s.results.filter(r => r && r.p && r.t && HB.isISO(r.d)) : [];
    s.vaccines = Object.assign({ man: {}, woman: {} }, s.vaccines || {});
    s.plan = Object.assign({}, d.plan, s.plan || {});
    s.plan.checks = s.plan.checks || {};
    s.aliases = s.aliases || {};
    s.ui = s.ui || { tab: 'man' };
    s.v = 1;
    return s;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? upgrade(JSON.parse(raw)) : defaultState();
    } catch (e) { storageOK = false; return defaultState(); }
  }
  let S = load();
  const ui = { tab: ['man', 'woman', 'plan'].includes(S.ui.tab) ? S.ui.tab : 'man', open: new Set(), install: null, imp: null };

  function save(changed) {
    if (changed !== false) S.lastChange = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; }
    catch (e) { storageOK = false; toast('Couldn\'t save on this phone. The browser may be in incognito mode or out of space.'); return false; }
    if (changed !== false) askPersist();
    return true;
  }
  async function askPersist() {
    if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
    persistAsked = true;
    try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* not supported */ }
  }

  /* ---------------- Small render helpers ---------------- */
  const STATE_CLASS = { due: 's-due', soon: 's-soon', ok: 's-ok', done: 's-ok', optional: 's-opt', na: 's-opt', needed: 's-due', action: 's-due', repeat: 's-soon' };
  function badge(ev) {
    if (!ev || !['in', 'border', 'out', 'none'].includes(ev.flag) || !ev.word) return '';
    return '<span class="badge f-' + ev.flag + '">' + esc(ev.word) + '</span>';
  }
  function shortValue(tid, r) {
    const t = HB.TESTS[tid];
    if (t.kind === 'num') return (r.q ? r.q : '') + HB.num(r.v, t.dp) + ((r.u || t.unit) === '%' ? '%' : '');
    if (t.kind === 'bp') return r.v + '/' + r.v2;
    if (t.kind === 'bloodgroup') return r.v || '';
    return HB.formatValue(tid, r);
  }
  function evalFor(p, tid, r) { return HB.evaluate(tid, r, HB.ctxFor(S, p, r.d)); }
  function chipsFor(p, testIds) {
    const chips = [];
    for (const tid of testIds) {
      const t = HB.TESTS[tid];
      if (t.kind === 'date') continue;
      const r = HB.latest(S, p, tid);
      if (!r) continue;
      const ev = evalFor(p, tid, r);
      const f = ['in', 'border', 'out'].includes(ev.flag) ? ev.flag : 'none';
      chips.push('<span class="chip"><span class="dot f-' + f + '" aria-hidden="true"></span>' + esc(t.short) + ' ' + esc(shortValue(tid, r)) +
        (f !== 'none' && f !== 'in' ? '<span class="sr"> (' + esc(ev.word) + ')</span>' : '') + '</span>');
    }
    if (chips.length > 4) return chips.slice(0, 4).join('') + '<span class="chip more">+' + (chips.length - 4) + '</span>';
    return chips.join('');
  }
  function testsShown(pa, p, mode) {
    if (mode === 'plan' || mode === 'partner') return HB.planTests(pa);
    return HB.visibleTests(pa).concat((pa.planOnly || []).filter(t => HB.latest(S, p, t)));
  }

  /* ---------------- Ribbon and trend ---------------- */
  function autoDom(zones, vals) {
    const bounds = zones.map(z => z.max).filter(isFinite);
    const all = bounds.concat(vals);
    let a = Math.min(...all), b = Math.max(...all);
    const span = (b - a) || Math.abs(b) || 1;
    a -= span * 0.35; b += span * 0.35;
    if (a < 0 && Math.min(...all) >= 0) a = 0;
    return [a, b];
  }
  let svgSeq = 0;
  function ribbon(t, zones, ctx, r, hist, domOverride) {
    const unit = r.u || t.unit;
    const vals = hist.filter(x => (x.u || t.unit) === unit).map(x => +x.v).filter(v => isFinite(v));
    if (!vals.length) return '';
    let [a, b] = domOverride || (t.dom ? t.dom(Object.assign({}, ctx, { unit })) : autoDom(zones, vals));
    const span = b - a;
    const vmin = Math.min(...vals), vmax = Math.max(...vals);
    if (vmin < a) a = vmin - span * 0.06;
    if (vmax > b) b = vmax + span * 0.06;
    const W = 320, y = 9, h = 10, H = 36;
    const sx = v => Math.max(0, Math.min(W, (v - a) / (b - a) * W));
    const id = 'rb' + (++svgSeq);
    let rects = '', labels = '', lower = -Infinity;
    for (const z of zones) {
      const from = Math.max(a, lower), to = Math.min(b, z.max);
      if (to > from) rects += '<rect x="' + sx(from).toFixed(1) + '" y="' + y + '" width="' + (sx(to) - sx(from)).toFixed(1) + '" height="' + h + '" class="z z-' + z.flag + '"/>';
      if (isFinite(z.max) && z.max > a && z.max < b) {
        const x = Math.max(9, Math.min(W - 9, sx(z.max)));
        labels += '<text x="' + x.toFixed(1) + '" y="' + (y + h + 13) + '" class="zl" text-anchor="middle">' + HB.num(z.max) + '</text>';
      }
      lower = z.max;
    }
    const ticks = vals.slice(1, 8).map(v => '<circle cx="' + sx(v).toFixed(1) + '" cy="' + (y + h / 2) + '" r="2.4" class="tick"/>').join('');
    const xv = sx(+r.v).toFixed(1);
    const label = t.name + ': ' + HB.num(r.v, t.dp) + ' ' + HB.unitLabel(unit);
    return '<svg class="ribbon" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + ' on its range bar">' +
      '<defs><clipPath id="' + id + '"><rect x="0" y="' + y + '" width="' + W + '" height="' + h + '" rx="5"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')"><rect x="0" y="' + y + '" width="' + W + '" height="' + h + '" class="z-track"/>' + rects + '</g>' + labels + ticks +
      '<line x1="' + xv + '" x2="' + xv + '" y1="' + (y - 5) + '" y2="' + (y + h + 4) + '" class="mk-line"/><circle cx="' + xv + '" cy="' + (y + h / 2) + '" r="5.5" class="mk"/></svg>';
  }
  function trend(p, tid, hist) {
    const t = HB.TESTS[tid];
    const unit = hist[0].u || t.unit;
    const pts = hist.filter(x => (x.u || t.unit) === unit && isFinite(+x.v)).slice().reverse();
    if (pts.length < 2) return '';
    const W = 320, H = 96, L = 8, R = 8, T = 10, B = 20;
    const times = pts.map(x => HB.parseISO(x.d).getTime());
    const t0 = times[0], t1 = times[times.length - 1];
    const vs = pts.map(x => +x.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.3 || Math.abs(hi) * 0.15 || 1;
    lo -= pad; hi += pad;
    const sx = tm => L + (t1 === t0 ? (W - L - R) / 2 : (tm - t0) / (t1 - t0) * (W - L - R));
    const sy = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ev0 = evalFor(p, tid, pts[pts.length - 1]);
    let band = '';
    if (ev0.zones) {
      let lower = -Infinity;
      for (const z of ev0.zones) {
        if (z.flag === 'in') {
          const top = sy(Math.min(hi, z.max)), bot = sy(Math.max(lo, lower));
          if (bot > top) band += '<rect x="' + L + '" y="' + top.toFixed(1) + '" width="' + (W - L - R) + '" height="' + (bot - top).toFixed(1) + '" class="band"/>';
        }
        lower = z.max;
      }
    }
    const path = pts.map((x, i) => (i ? 'L' : 'M') + sx(times[i]).toFixed(1) + ' ' + sy(vs[i]).toFixed(1)).join(' ');
    const dots = pts.map((x, i) => {
      const f = evalFor(p, tid, x).flag;
      return '<circle cx="' + sx(times[i]).toFixed(1) + '" cy="' + sy(vs[i]).toFixed(1) + '" r="3.6" class="pt f-' + (['in', 'border', 'out'].includes(f) ? f : 'none') + '"/>';
    }).join('');
    return '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t.name) + ' over time">' + band +
      '<path d="' + path + '" class="tl"/>' + dots +
      '<text x="' + L + '" y="' + (H - 4) + '" class="zl">' + esc(HB.fmtMonth(pts[0].d)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 4) + '" class="zl" text-anchor="end">' + esc(HB.fmtMonth(pts[pts.length - 1].d)) + '</text></svg>';
  }

  /* ---------------- Test blocks ---------------- */
  function testBlock(p, tid) {
    const t = HB.TESTS[tid];
    const hist = HB.history(S, p, tid);
    const r = hist[0];
    if (!r) return '<div class="test empty"><div class="t-head"><span class="t-name">' + esc(t.name) + '</span><span class="t-none">No result yet</span></div></div>';
    const ctx = HB.ctxFor(S, p, r.d);
    if (t.kind === 'date') {
      return '<div class="test"><div class="t-head"><span class="t-name">' + esc(t.name) + '</span><span class="t-val small">Last done ' + esc(HB.fmtDate(r.d)) + '</span></div>' +
        (r.note ? '<p class="t-date">' + esc(r.note) + '</p>' : '') + historyBlock(p, tid, hist, false) + '</div>';
    }
    const ev = HB.evaluate(tid, r, ctx);
    let h = '<div class="test"><div class="t-head"><span class="t-name">' + esc(t.name) + '</span><span class="t-right"><span class="t-val">' + esc(HB.formatValue(tid, r)) + '</span>' + badge(ev) + '</span></div>';
    h += '<p class="t-date">' + esc(HB.fmtDate(r.d)) + (r.note ? '. ' + esc(r.note) : '') + '</p>';
    if (t.kind === 'num' && ev.zones) h += ribbon(t, ev.zones, ctx, r, hist);
    if (tid === 'weight') h += bmiBlock(p, r);
    if (tid === 'creat') h += egfrBlock(p, r);
    if (tid === 'bloodgroup' && /-$/.test(r.v || '') && S.profiles[p].sex === 'F') h += '<p class="t-note strong">Rhesus negative: tell the doctor early in any pregnancy.</p>';
    if (ev.text) h += '<p class="t-range">' + esc(ev.text) + '</p>';
    if (t.note) h += '<p class="t-note">' + esc(t.note) + '</p>';
    if (t.source) h += '<p class="t-src">' + esc(t.source) + '</p>';
    h += historyBlock(p, tid, hist, t.kind === 'num');
    return h + '</div>';
  }
  function bmiBlock(p, r) {
    const hcm = S.profiles[p].heightCm;
    if (!hcm) return '<p class="t-note">Add a height in Edit details to see body mass index.</p>';
    const v = HB.bmi(+r.v, hcm);
    const ev = HB.evaluateBmi(v);
    const fake = { name: 'Body mass index', unit: '', dp: 1 };
    return '<div class="derived"><div class="t-head"><span class="t-name">Body mass index</span><span class="t-right"><span class="t-val">' + v + '</span>' + badge(ev) + '</span></div>' +
      ribbon(fake, ev.zones, {}, { v }, [{ v }], [15, 32]) + '<p class="t-range">' + esc(ev.text) + '</p></div>';
  }
  function egfrBlock(p, r) {
    const ctx = HB.ctxFor(S, p, r.d);
    const v = HB.egfr(+r.v, ctx.age, ctx.sex);
    if (v == null) return '';
    const ev = HB.evaluateEgfr(v);
    const fake = { name: 'eGFR', unit: 'mL/min', dp: 0 };
    return '<div class="derived"><div class="t-head"><span class="t-name">eGFR, kidney filtering</span><span class="t-right"><span class="t-val">' + v + '</span>' + badge(ev) + '</span></div>' +
      ribbon(fake, ev.zones, {}, { v }, [{ v }], [40, 130]) + '<p class="t-range">' + esc(ev.text) + ' Worked out with the CKD-EPI 2021 equation.</p></div>';
  }
  function historyBlock(p, tid, hist, withTrend) {
    if (!hist.length) return '';
    const items = hist.map(r => {
      const ev = evalFor(p, tid, r);
      return '<li><span class="h-date">' + esc(HB.fmtDate(r.d)) + '</span><span class="h-val">' + esc(HB.formatValue(tid, r)) + '</span>' + badge(ev) +
        '<button class="text-btn" data-act="edit" data-id="' + esc(r.id) + '">Edit</button></li>';
    }).join('');
    return '<details class="hist"><summary>All results (' + hist.length + ')</summary>' + (withTrend && hist.length > 1 ? trend(p, tid, hist) : '') + '<ul>' + items + '</ul></details>';
  }

  /* ---------------- Panels ---------------- */
  function panelItem(pa, p, sch, mode) {
    const key = (mode || 'base') + ':' + p + ':' + pa.id;
    const open = ui.open.has(key);
    const name = (mode === 'plan' && pa.plan && pa.plan.name) || pa.name;
    return '<li class="panel' + (open ? ' open' : '') + '">' +
      '<button class="row" data-act="toggle" data-key="' + esc(key) + '" aria-expanded="' + open + '">' +
      '<span class="row-name">' + esc(name) + '</span>' +
      '<span class="row-when ' + (STATE_CLASS[sch.state] || '') + '">' + esc(sch.text) + '</span>' +
      '<span class="row-chips">' + (pa.id === 'vaccines' ? '' : chipsFor(p, testsShown(pa, p, mode))) + '</span>' + ICON.chev + '</button>' +
      (open ? '<div class="panel-body">' + panelBody(pa, p, mode, sch) + '</div>' : '') + '</li>';
  }
  function panelBody(pa, p, mode, sch) {
    if (pa.id === 'vaccines') return vaccineForm(p);
    const tests = testsShown(pa, p, mode);
    let h = '<p class="why">' + esc(pa.why) + '</p>';
    h += tests.map(t => testBlock(p, t)).join('');
    const freq = mode ? (pa.plan && pa.plan.months ? 'Needed within ' + pa.plan.months + ' months of the planned date' : '') : (sch.freq || '');
    h += '<div class="panel-foot"><span class="freq">' + esc(freq) + '</span><button class="text-btn" data-act="add" data-p="' + p + '" data-test="' + tests[0] + '">Add result</button></div>';
    return h;
  }
  function vaccineForm(p) {
    const v = S.vaccines[p] || (S.vaccines[p] = {});
    const age = HB.ageOn(S.profiles[p], today);
    return '<p class="why">' + esc(HB.PANEL.vaccines.why) + '</p><ul class="vax">' + HB.VACCINES.map(x => {
      const cur = v[x.id] || {};
      return '<li><div class="vax-name">' + esc(x.name) + '<span class="vax-note">' + esc(x.note(age)) + '</span></div><div class="vax-ctl">' +
        '<select data-act="vax" data-p="' + p + '" data-v="' + x.id + '" aria-label="' + esc(x.name) + '"><option value="">Not marked</option>' +
        HB.VACCINE_STATUS.map(([k, l]) => '<option value="' + k + '"' + (cur.s === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
        (x.id === 'td' ? '<label class="mini">Last dose <input type="date" data-act="vaxdate" data-p="' + p + '" data-v="td" value="' + esc(cur.d || '') + '" max="' + today + '"></label>' : '') +
        '</div></li>';
    }).join('') + '</ul><p class="t-src">Before a pregnancy, MMR and chickenpox vaccines need a one-month gap before trying. They aren\'t given during pregnancy.</p>';
  }
  function group(title, items, p, mode) {
    if (!items.length) return '';
    return '<section class="group"><h2>' + esc(title) + '</h2><ul class="panels">' + items.map(x => panelItem(x.pa, p, x.sch, mode)).join('') + '</ul></section>';
  }

  /* ---------------- Views ---------------- */
  function metaLine(prof, age) {
    const bits = [];
    if (age != null) bits.push(age + ' years');
    if (prof.heightCm) bits.push(prof.heightCm + ' cm');
    return bits.join(', ') || 'Add age and height';
  }
  function outOfRangeCount(p) {
    let n = 0;
    for (const tid of Object.keys(HB.TESTS)) {
      const r = HB.latest(S, p, tid);
      if (r && evalFor(p, tid, r).flag === 'out') n++;
    }
    return n;
  }
  function statusSentence(due, outs) {
    if (!due && !outs) return 'Everything is up to date.';
    const a = due ? plural(due, 'check') + ' ' + (due === 1 ? 'is' : 'are') + ' due.' : 'Nothing is due right now.';
    const b = outs ? ' ' + plural(outs, 'result') + ' out of range, worth discussing with a doctor.' : '';
    return a + b;
  }
  function backupBanner() {
    if (!storageOK) return '<div class="banner warn"><p>This browser isn\'t saving data, often because of incognito mode. Open the app in a normal Chrome tab or from the installed icon.</p></div>';
    if (!S.results.length) return '';
    const last = S.lastBackup;
    const changed = !last || (S.lastChange && S.lastChange.slice(0, 10) >= last && S.lastChange > (S.lastBackupAt || ''));
    if (!changed) return '';
    if (last && HB.daysBetween(last, today) < 30) return '';
    const msg = last ? 'Your last backup was ' + plural(HB.daysBetween(last, today), 'day') + ' ago.' : 'You haven\'t made a backup yet.';
    return '<div class="banner"><p>' + msg + ' A backup file keeps your results safe if this browser\'s data is ever cleared.</p><button class="btn small" data-act="backup">Back up now</button></div>';
  }
  function viewProfile(p) {
    const prof = S.profiles[p];
    const age = HB.ageOn(prof, today);
    const items = HB.panelsFor(p, S).map(pa => ({ pa, sch: HB.schedule(pa, p, S, today) })).filter(x => x.sch.state !== 'na');
    const by = st => items.filter(x => st.includes(x.sch.state));
    const due = by(['due']);
    let h = '<section class="intro"><div><h1>' + esc(prof.label) + '</h1><p class="meta">' + esc(metaLine(prof, age)) + '</p></div>' +
      '<button class="text-btn" data-act="profile" data-p="' + p + '">Edit details</button></section>';
    h += '<p class="status-line">' + esc(statusSentence(due.length, outOfRangeCount(p))) + '</p>';
    h += '<div class="actions"><button class="btn primary" data-act="import" data-p="' + p + '">Import report</button><button class="btn" data-act="add" data-p="' + p + '">Add result</button></div>';
    h += backupBanner();
    if (!S.results.some(r => r.p === p)) h += '<p class="hint">Import a lab report or add a result to start. Everything stays on this phone.</p>';
    h += group('Due now', due, p) + group('Coming up', by(['soon']), p) + group('Up to date', by(['ok', 'done']), p) + group('Optional', by(['optional']), p);
    return h;
  }
  function countdown(T) {
    if (!T) return '';
    const d = HB.daysBetween(today, T);
    if (d < 0) return '<p class="count">The planned date has passed. Set a new one if you are still planning.</p>';
    let s = '<p class="count"><span class="count-n">' + d + '</span> ' + (d === 1 ? 'day' : 'days') + ' to go</p>';
    if (d < 90) s += '<p class="warn-line">Less than 3 months to go. Start folic acid now and book the tests this week. Vaccines may mean moving the date.</p>';
    return s;
  }
  function timelineBlock() {
    const items = HB.timeline(S, today);
    if (!items) return '';
    const checks = S.plan.checks || {};
    const testsTodo = HB.PLAN_PANELS.map(id => HB.planStatus(HB.PANEL[id], 'woman', S, today)).filter(s => s && ['needed', 'repeat', 'action'].includes(s.state)).length;
    const partnerTodo = ['blood', 'carrier'].filter(id => HB.partnerStatus(id, S, today).state !== 'ok').length;
    return '<section class="group"><h2>Timeline</h2><ol class="timeline">' + items.map(it => {
      let done = false, auto = '';
      if (it.key === 'tests') { done = testsTodo === 0; auto = done ? 'All current' : plural(testsTodo, 'item') + ' still to do'; }
      else if (it.key === 'partner') { done = partnerTodo === 0; auto = done ? 'Done' : plural(partnerTodo, 'test') + ' still to do'; }
      else if (!it.final) done = !!checks[it.key];
      const late = !done && !it.final && it.by < today;
      const body = (it.auto || it.final)
        ? '<span class="tl-text">' + esc(it.text) + '</span>' + (auto ? '<span class="tl-auto">' + esc(auto) + '</span>' : '')
        : '<label class="tl-check"><input type="checkbox" data-act="check" data-key="' + it.key + '"' + (done ? ' checked' : '') + '><span class="tl-text">' + esc(it.text) + '</span></label>';
      return '<li class="' + (done ? 'done' : '') + (late ? ' late' : '') + (it.final ? ' final' : '') + '"><span class="tl-date">' + esc(HB.fmtDate(it.by)) + '</span><div class="tl-body">' + body +
        (it.note ? '<p class="tl-note">' + esc(it.note) + '</p>' : '') + '</div></li>';
    }).join('') + '</ol></section>';
  }
  function viewPlan() {
    const T = S.plan.target;
    const w = S.profiles.woman;
    let h = '<section class="intro"><div><h1>Pregnancy planning</h1><p class="meta">For ' + esc(w.label) + ', using her results</p></div></section>';
    h += '<div class="target"><label for="target">Planned date to start trying</label><input type="date" id="target" data-act="target" value="' + esc(T || '') + '" min="' + today + '">' + countdown(T) + '</div>';
    if (!T) h += '<p class="hint">Set a date to get a countdown with deadlines for tests, folic acid and vaccines.</p>';
    h += '<div class="actions"><button class="btn primary" data-act="import" data-p="woman">Import report</button><button class="btn" data-act="add" data-p="woman">Add result</button></div>';
    h += timelineBlock();
    const rows = HB.PLAN_PANELS.map(id => HB.PANEL[id]).map(pa => ({ pa, sch: HB.planStatus(pa, 'woman', S, today) }));
    const todo = rows.filter(x => ['needed', 'action', 'repeat'].includes(x.sch.state));
    const done = rows.filter(x => x.sch.state === 'ok');
    const opt = rows.filter(x => x.sch.state === 'optional');
    h += group('Her tests to do', todo, 'woman', 'plan') + group('Her tests done', done, 'woman', 'plan') + group('Optional', opt, 'woman', 'plan');
    h += partnerBlock() + skipBlock();
    return h;
  }
  function partnerBlock() {
    const src = S.plan.partner;
    const pk = HB.partnerKey(S);
    let h = '<section class="group"><h2>Partner\'s tests</h2><div class="seg" role="radiogroup" aria-label="Where the partner\'s results come from">' +
      '<button role="radio" aria-checked="' + (src === 'man') + '" data-act="partner" data-v="man">Use ' + esc(S.profiles.man.label) + '\'s results</button>' +
      '<button role="radio" aria-checked="' + (src !== 'man') + '" data-act="partner" data-v="separate">Enter separately</button></div><ul class="panels">';
    for (const id of ['blood', 'carrier']) {
      const st = HB.partnerStatus(id, S, today);
      h += panelItem(HB.PANEL[id], pk, { state: st.state, text: st.text }, 'partner');
    }
    return h + '</ul></section>';
  }
  function skipBlock() {
    return '<section class="group"><h2>Usually not needed</h2><ul class="skip">' + HB.SKIP_TESTS.map(s =>
      '<li><h3>' + esc(s.name) + '</h3><p>' + esc(s.text) + '</p></li>').join('') + '</ul></section>';
  }
  function renderTabs() {
    const tabs = [['man', S.profiles.man.label], ['woman', S.profiles.woman.label], ['plan', 'Pregnancy planning']];
    $('#tabs').innerHTML = tabs.map(([k, l]) => '<button role="tab" class="tab" aria-selected="' + (ui.tab === k) + '" data-act="tab" data-tab="' + k + '">' + esc(l) + '</button>').join('');
  }
  function render(focusKey) {
    today = HB.todayISO();
    renderTabs();
    $('#view').innerHTML = (ui.tab === 'plan' ? viewPlan() : viewProfile(ui.tab)) + '<p class="foot">Flags compare results with published ranges. They are prompts to discuss with a doctor, not a diagnosis.</p>';
    if (focusKey) { const b = document.querySelector('[data-key="' + CSS.escape(focusKey) + '"]'); if (b) b.focus({ preventScroll: true }); }
  }

  /* ---------------- Sheets ---------------- */
  function openSheet(title, body) {
    const d = $('#sheet');
    d.innerHTML = '<div class="sheet-inner"><header class="sheet-head"><h2 id="sheet-title">' + esc(title) + '</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">' + ICON.x + '</button></header><div class="sheet-body">' + body + '</div></div>';
    if (!d.open) { d.showModal(); try { history.pushState({ hbSheet: true }, ''); } catch (e) { /* ignore */ } }
  }
  function setSheetBody(body) { const b = $('#sheet .sheet-body'); if (b) b.innerHTML = body; }
  function closeSheet(fromPop) {
    const d = $('#sheet');
    if (d.open) d.close();
    ui.imp = null;
    if (!fromPop && history.state && history.state.hbSheet) history.back();
  }
  function profileOptions(sel) {
    const opts = [['man', S.profiles.man.label], ['woman', S.profiles.woman.label]];
    if (S.plan.partner !== 'man') opts.push(['partner', S.profiles.partner.label + ' (partner)']);
    return opts.map(([k, l]) => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  }
  function testOptions(sel) {
    return HB.PANELS.filter(pa => pa.tests.length).map(pa => '<optgroup label="' + esc(pa.name) + '">' + pa.tests.map(tid =>
      '<option value="' + tid + '"' + (tid === sel ? ' selected' : '') + '>' + esc(HB.TESTS[tid].name) + '</option>').join('') + '</optgroup>').join('');
  }
  function unitChoices(t) { return [t.unit].concat(t.altUnits || [], Object.keys(t.conv || {})); }
  function fieldsFor(tid, r) {
    const t = HB.TESTS[tid];
    r = r || {};
    let h = '';
    if (t.kind === 'num') {
      const u = r.u || t.unit;
      h += '<div class="field-row"><label class="field grow"><span>Value</span><input id="f-v" inputmode="decimal" autocomplete="off" value="' + esc(r.v != null ? r.v : '') + '"></label>' +
        '<label class="field"><span>Unit</span><select id="f-u">' + unitChoices(t).map(x => '<option value="' + esc(x) + '"' + (x === u ? ' selected' : '') + '>' + esc(HB.unitLabel(x)) + '</option>').join('') + '</select></label></div>';
      if (t.labRange || ['hb', 'alt'].includes(tid)) {
        h += '<div class="field-row"><label class="field grow"><span>Lab range, low (optional)</span><input id="f-lo" inputmode="decimal" value="' + esc(r.lo != null ? r.lo : '') + '"></label>' +
          '<label class="field grow"><span>Lab range, high (optional)</span><input id="f-hi" inputmode="decimal" value="' + esc(r.hi != null ? r.hi : '') + '"></label></div>';
      }
    } else if (t.kind === 'bp') {
      h += '<div class="field-row"><label class="field grow"><span>Systolic (top)</span><input id="f-v" inputmode="numeric" value="' + esc(r.v != null ? r.v : '') + '"></label>' +
        '<label class="field grow"><span>Diastolic (bottom)</span><input id="f-v2" inputmode="numeric" value="' + esc(r.v2 != null ? r.v2 : '') + '"></label></div>';
    } else if (t.kind === 'qual') {
      h += '<label class="field"><span>Result</span><select id="f-q"><option value="">Choose</option>' + t.options.map(o => '<option value="' + o[0] + '"' + (r.v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
    } else if (t.kind === 'bloodgroup') {
      const abo = r.v ? r.v.slice(0, -1) : '', rh = r.v ? r.v.slice(-1) : '';
      h += '<div class="field-row"><label class="field grow"><span>Group</span><select id="f-abo"><option value="">Choose</option>' + ['A', 'B', 'AB', 'O'].map(x => '<option' + (abo === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
        '<label class="field grow"><span>Rhesus</span><select id="f-rh"><option value="">Choose</option><option value="+"' + (rh === '+' ? ' selected' : '') + '>Positive</option><option value="-"' + (rh === '-' ? ' selected' : '') + '>Negative</option></select></label></div>';
    }
    h += '<label class="field"><span>Note (optional)</span><input id="f-note" autocomplete="off" value="' + esc(r.note || '') + '"></label>';
    if (t.source) h += '<p class="t-src">' + esc(t.source) + '</p>';
    return h;
  }
  function sheetAdd(p, testId, editId) {
    const r = editId ? S.results.find(x => x.id === editId) : null;
    if (editId && !r) return;
    const pSel = r ? r.p : (p || 'man');
    const tSel = r ? r.t : (testId || 'hba1c');
    const body = '<div class="field-row"><label class="field grow"><span>Person</span><select id="f-p">' + profileOptions(pSel) + '</select></label>' +
      '<label class="field grow"><span>Date</span><input type="date" id="f-d" value="' + esc(r ? r.d : today) + '" max="' + today + '"></label></div>' +
      '<label class="field"><span>Test</span><select id="f-t" data-act="f-t">' + testOptions(tSel) + '</select></label>' +
      '<div id="f-fields">' + fieldsFor(tSel, r) + '</div>' +
      '<div class="sheet-actions">' + (r ? '<button type="button" class="btn danger" data-act="del" data-id="' + esc(r.id) + '">Delete</button>' : '') +
      '<button type="button" class="btn primary" data-act="save-result" data-id="' + esc(r ? r.id : '') + '">' + (r ? 'Save changes' : 'Save result') + '</button></div>';
    openSheet(r ? 'Edit result' : 'Add result', body);
  }
  const numIn = id => { const el = $('#' + id); if (!el) return null; const s = el.value.trim().replace(/,/g, ''); if (s === '') return null; const v = Number(s); return isFinite(v) ? v : NaN; };
  function saveResult(editId) {
    const p = $('#f-p').value, tid = $('#f-t').value, d = $('#f-d').value;
    const t = HB.TESTS[tid];
    if (!HB.isISO(d) || d > today) return toast('Pick a date up to today.');
    const r = { id: editId || uid(), p, t: tid, d, src: 'manual', at: Date.now() };
    const note = $('#f-note').value.trim(); if (note) r.note = note;
    if (t.kind === 'num') {
      const v = numIn('f-v'), lo = numIn('f-lo'), hi = numIn('f-hi');
      if (v == null || isNaN(v)) return toast('Enter a number for the value.');
      if ((lo != null && isNaN(lo)) || (hi != null && isNaN(hi))) return toast('The lab range needs numbers, or leave it empty.');
      const u = $('#f-u').value;
      const b = HB.toBase(tid, v, u, lo, hi);
      if (t.plaus && (b.u ? false : (b.v < t.plaus[0] || b.v > t.plaus[1])) && !confirm(HB.num(v) + ' ' + HB.unitLabel(u) + ' looks unusual for ' + t.name + '. Save it anyway?')) return;
      r.v = b.v; if (b.u) r.u = b.u; if (b.lo != null) r.lo = b.lo; if (b.hi != null) r.hi = b.hi;
      if (b.note && u !== t.unit) r.note = (r.note ? r.note + '. ' : '') + b.note;
    } else if (t.kind === 'bp') {
      const v = numIn('f-v'), v2 = numIn('f-v2');
      if (!(v >= 60 && v <= 260) || !(v2 >= 30 && v2 <= 160)) return toast('Enter both blood pressure numbers, for example 118 and 76.');
      r.v = v; r.v2 = v2;
    } else if (t.kind === 'qual') {
      const q = $('#f-q').value; if (!q) return toast('Choose a result.');
      r.v = q;
    } else if (t.kind === 'bloodgroup') {
      const abo = $('#f-abo').value, rh = $('#f-rh').value;
      if (!abo || !rh) return toast('Choose the group and Rhesus factor.');
      r.v = abo + rh;
    }
    if (editId) { const i = S.results.findIndex(x => x.id === editId); if (i >= 0) S.results[i] = r; }
    else S.results.push(r);
    save();
    closeSheet();
    if (p !== 'partner' && ui.tab !== 'plan') ui.tab = p;
    ui.open.add('base:' + p + ':' + HB.PANEL_OF[tid]);
    render();
    toast(editId ? 'Changes saved' : 'Result saved');
  }
  function deleteResult(id) {
    const r = S.results.find(x => x.id === id);
    if (!r) return;
    if (!confirm('Delete this ' + HB.TESTS[r.t].name + ' result from ' + HB.fmtDate(r.d) + '?')) return;
    S.results = S.results.filter(x => x.id !== id);
    save(); closeSheet(); render(); toast('Result deleted');
  }
  function sheetProfile(p) {
    const keys = p ? [p] : (S.plan.partner !== 'man' ? ['man', 'woman', 'partner'] : ['man', 'woman']);
    let body = keys.map(k => profileFields(k)).join('');
    body += '<div class="sheet-actions"><button type="button" class="btn primary" data-act="save-profile" data-keys="' + keys.join(',') + '">Save details</button></div>';
    openSheet('Details', body);
  }
  function profileFields(k) {
    const pr = S.profiles[k];
    const age = HB.ageOn(pr, today);
    return '<fieldset class="pf"><legend>' + (k === 'partner' ? 'Partner' : k === 'man' ? 'Man\'s profile' : 'Woman\'s profile') + '</legend>' +
      '<label class="field"><span>Name shown in the app</span><input id="pf-' + k + '-label" autocomplete="off" value="' + esc(pr.label) + '"></label>' +
      (k === 'partner' ? '' : '<div class="field-row"><label class="field grow"><span>Age</span><input id="pf-' + k + '-age" inputmode="numeric" value="' + esc(age != null ? age : '') + '"></label>' +
        '<label class="field grow"><span>Height in cm</span><input id="pf-' + k + '-h" inputmode="decimal" value="' + esc(pr.heightCm || '') + '"></label></div>') + '</fieldset>';
  }
  function saveProfile(keys) {
    for (const k of keys) {
      const pr = S.profiles[k];
      const label = $('#pf-' + k + '-label').value.trim();
      if (!label) return toast('Each person needs a name.');
      if (k !== 'partner') {
        const age = numIn('pf-' + k + '-age'), h = numIn('pf-' + k + '-h');
        if (age != null && (isNaN(age) || age < 1 || age > 110)) return toast('Enter an age between 1 and 110.');
        if (h != null && (isNaN(h) || h < 100 || h > 230)) return toast('Enter a height in centimetres, for example 172.');
        if (age != null && age !== HB.ageOn(pr, today)) { pr.age = age; pr.ageAsOf = today; }
        pr.heightCm = h != null ? h : null;
      }
      pr.label = label.slice(0, 40);
    }
    save(); closeSheet(); render(); toast('Details saved');
  }

  /* ---------------- Import ---------------- */
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./pdf.min.js').then(m => {
        m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', document.baseURI).href;
        return m;
      }).catch(e => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }
  function sheetImport(p) {
    ui.imp = { p: p || 'man', step: 'pick' };
    openSheet('Import a lab report', importBody());
  }
  function importBody() {
    const imp = ui.imp;
    if (!imp) return '';
    if (imp.step === 'pick') {
      return '<p class="lead">Pick the report file your lab sent you. The app reads it on this phone; nothing is uploaded.</p>' +
        '<button type="button" class="btn primary wide" data-act="pick-file">Choose report file</button>' +
        '<p class="hint">Works with digital reports. If you can select text in the report, it will import. Scanned or photographed reports need typing in with Add result.</p>';
    }
    if (imp.step === 'reading') return '<p class="lead" role="status">Reading the report…</p>';
    if (imp.step === 'password') {
      return '<p class="lead">' + (imp.badPassword ? 'That password didn\'t work. Try again.' : 'This report is password-protected. Enter the password from the lab\'s email or message.') + '</p>' +
        '<label class="field"><span>Password</span><input id="imp-pw" type="password" autocomplete="off"></label>' +
        '<div class="sheet-actions"><button type="button" class="btn" data-act="pick-file">Choose another file</button><button type="button" class="btn primary" data-act="imp-pw">Open report</button></div>';
    }
    if (imp.step === 'error') {
      const msg = {
        scanned: 'This report has no readable text inside, so it is probably a scan or photo. Ask the lab for the digital copy, or type the values in with Add result.',
        nothing: 'No tests the app tracks were found in this report. You can type values in with Add result.',
        read: 'This file couldn\'t be opened as a report. Check that it is the lab\'s file and try again.',
        load: 'The report reader couldn\'t load. Connect to the internet once so the app can finish installing, then try again.'
      }[imp.error] || 'Something went wrong reading this file.';
      return '<p class="lead">' + esc(msg) + '</p><div class="sheet-actions"><button type="button" class="btn primary" data-act="pick-file">Choose another file</button></div>';
    }
    if (imp.step === 'review') return reviewBody();
    return '';
  }
  function refreshImport() { if (ui.imp && $('#sheet').open) setSheetBody(importBody()); }
  async function readPdf(file, password) {
    const imp = ui.imp;
    if (!imp) return;
    imp.file = file; imp.step = 'reading'; refreshImport();
    let pdfjs;
    try { pdfjs = await loadPdfJs(); } catch (e) { imp.step = 'error'; imp.error = 'load'; refreshImport(); return; }
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        pages.push(tc.items.filter(it => typeof it.str === 'string').map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10 })));
        page.cleanup();
      }
      await doc.destroy();
      const res = HB.parseReport(pages, S.aliases, today);
      if (res.textLength < 40) { imp.step = 'error'; imp.error = 'scanned'; }
      else if (!res.items.length && !res.others.length) { imp.step = 'error'; imp.error = 'nothing'; }
      else {
        imp.res = res;
        imp.date = res.date || today;
        if (res.sex === 'F' && imp.p !== 'woman') imp.p = 'woman';
        else if (res.sex === 'M' && imp.p === 'woman') imp.p = 'man';
        imp.rows = res.items.map(it => Object.assign({ include: true }, it));
        imp.step = 'review';
      }
    } catch (e) {
      if (e && e.name === 'PasswordException') { imp.step = 'password'; imp.badPassword = e.code === 2; }
      else { imp.step = 'error'; imp.error = 'read'; }
    }
    refreshImport();
    if (imp.step === 'password') setTimeout(() => { const el = $('#imp-pw'); if (el) el.focus(); }, 50);
  }
  function rowEval(r, ctx) {
    const t = HB.TESTS[r.test];
    if (t.kind === 'num' && (r.v == null || r.v === '' || isNaN(+r.v))) return null;
    if (t.kind === 'qual' && !r.v) return null;
    return HB.evaluate(r.test, { v: t.kind === 'num' ? +r.v : r.v, v2: r.v2, u: r.u, lo: r.lo, hi: r.hi }, ctx);
  }
  function rangeStr(r, t) {
    const f = v => HB.num(v, t.dp == null ? 2 : t.dp + 1);
    if (r.lo != null && r.hi != null) return f(r.lo) + ' to ' + f(r.hi);
    if (r.hi != null) return 'up to ' + f(r.hi);
    return 'from ' + f(r.lo);
  }
  function reviewRow(r, i, ctx) {
    const t = HB.TESTS[r.test];
    let ctl = '';
    if (t.kind === 'num') {
      const u = r.u || t.unit;
      ctl = '<input class="rv-num" inputmode="decimal" data-act="rv-v" data-i="' + i + '" value="' + esc(r.v != null ? HB.num(r.v, t.dp == null ? 2 : t.dp + 1) : '') + '" aria-label="' + esc(t.name) + ' value"><span class="rv-unit">' + esc(HB.unitLabel(u)) + '</span>';
    } else if (t.kind === 'bp') {
      ctl = '<input class="rv-num" inputmode="numeric" data-act="rv-v" data-i="' + i + '" value="' + esc(r.v) + '" aria-label="Systolic"><span class="rv-unit">/</span><input class="rv-num" inputmode="numeric" data-act="rv-v2" data-i="' + i + '" value="' + esc(r.v2) + '" aria-label="Diastolic">';
    } else if (t.kind === 'qual') {
      ctl = '<select data-act="rv-q" data-i="' + i + '" aria-label="' + esc(t.name) + ' result"><option value="">Choose</option>' + t.options.map(o => '<option value="' + o[0] + '"' + (r.v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    } else if (t.kind === 'bloodgroup') {
      ctl = '<select data-act="rv-abo" data-i="' + i + '" aria-label="Blood group"><option value="">Group</option>' + ['A', 'B', 'AB', 'O'].map(x => '<option' + (r.abo === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' +
        '<select data-act="rv-rh" data-i="' + i + '" aria-label="Rhesus"><option value="">Rhesus</option><option value="+"' + (r.rh === '+' ? ' selected' : '') + '>Positive</option><option value="-"' + (r.rh === '-' ? ' selected' : '') + '>Negative</option></select>';
    }
    const ev = rowEval(r, ctx);
    return '<li class="rv-row' + (r.include ? '' : ' off') + '"><label class="rv-inc"><input type="checkbox" data-act="rv-inc" data-i="' + i + '"' + (r.include ? ' checked' : '') + '><span class="rv-name">' + esc(t.name) + '</span></label>' +
      '<div class="rv-ctl">' + ctl + '<span class="rv-badge" id="rvb-' + i + '">' + badge(ev) + '</span></div>' +
      (r.note ? '<p class="rv-note' + (r.warn ? ' warn' : '') + '">' + esc(r.note) + '</p>' : (r.warn && t.kind === 'qual' ? '<p class="rv-note warn">Couldn\'t read the result; choose it from the report.</p>' : '')) +
      (t.kind === 'num' && (r.lo != null || r.hi != null) ? '<p class="rv-line">Lab range ' + esc(rangeStr(r, t)) + '</p>' : '') +
      (r.line ? '<p class="rv-line">On the report: ' + esc(r.line) + '</p>' : '') + '</li>';
  }
  function reviewBody() {
    const imp = ui.imp, res = imp.res;
    const ctx = HB.ctxFor(S, imp.p, imp.date);
    const n = imp.rows.filter(r => r.include).length;
    let h = '<div class="field-row"><label class="field grow"><span>Whose report?</span><select data-act="imp-p">' + profileOptions(imp.p) + '</select></label>' +
      '<label class="field grow"><span>Test date</span><input type="date" data-act="imp-d" value="' + esc(imp.date) + '" max="' + today + '"></label></div>';
    const ps = S.profiles[imp.p] ? S.profiles[imp.p].sex : null;
    if (res.sex && ps && res.sex !== ps) h += '<p class="rv-note warn">The report says ' + (res.sex === 'F' ? 'female' : 'male') + '. Check the person above.</p>';
    if (!res.date) h += '<p class="rv-note warn">The report date wasn\'t found, so today is filled in. Change it to the sample date.</p>';
    h += '<p class="lead">Found ' + plural(imp.rows.length, 'result') + '. Check each value against the report, untick anything wrong, then save.</p>';
    h += '<ul class="rv">' + imp.rows.map((r, i) => reviewRow(r, i, ctx)).join('') + '</ul>';
    const others = res.others.map((o, i) => Object.assign({ i }, o)).filter(o => !o.assigned);
    if (others.length) {
      h += '<details class="others"><summary>Lines not recognised (' + others.length + ')</summary><p class="hint">If one of these is a test the app tracks under another name, pick it. The app remembers that name for this lab\'s future reports.</p><ul>' +
        others.map(o => '<li><span class="o-label">' + esc(o.label) + '</span><span class="o-val">' + esc(o.valueText) + '</span><select data-act="assign" data-i="' + o.i + '" aria-label="Use ' + esc(o.label) + ' as"><option value="">Use as…</option>' +
          Object.values(HB.TESTS).filter(t => t.kind === 'num').map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select></li>').join('') + '</ul></details>';
    }
    h += '<div class="sheet-actions"><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn primary" data-act="imp-save"' + (n ? '' : ' disabled') + '>Save ' + plural(n, 'result') + '</button></div>';
    return h;
  }
  function assignOther(i, tid) {
    const imp = ui.imp, o = imp.res.others[i];
    if (!o || !tid) return;
    const pv = HB.parseValueCell(o.cells[0]);
    if (!pv) return toast('No number found on that line.');
    let unit = pv.unit, rest = [pv.rest].concat(o.cells.slice(1));
    if (!unit && o.cells[1]) { const u = HB.canonUnit(o.cells[1]); if (u) { unit = u; rest = [pv.rest].concat(o.cells.slice(2)); } }
    const rg = HB.parseRange(rest.join(' '), imp.res.sex);
    const b = HB.toBase(tid, pv.v, unit, rg ? rg.lo : null, rg ? rg.hi : null);
    imp.rows = imp.rows.filter(r => r.test !== tid);
    imp.rows.push({ test: tid, include: true, v: b.v, u: b.u, q: pv.q, lo: b.lo, hi: b.hi, note: b.note, warn: b.warn, line: o.line, learnKey: o.key });
    o.assigned = tid;
    refreshImport();
  }
  function saveImport() {
    const imp = ui.imp;
    if (!imp) return;
    if (!HB.isISO(imp.date) || imp.date > today) return toast('Pick a test date up to today.');
    const add = [];
    for (const r of imp.rows.filter(x => x.include)) {
      const t = HB.TESTS[r.test];
      const out = { id: uid(), p: imp.p, t: r.test, d: imp.date, src: 'import', at: Date.now() };
      if (t.kind === 'num') {
        const v = Number(String(r.v).replace(/,/g, ''));
        if (r.v === '' || r.v == null || !isFinite(v)) return toast('Enter a number for ' + t.name + ', or untick it.');
        out.v = v; if (r.u) out.u = r.u; if (r.q) out.q = r.q; if (r.lo != null) out.lo = r.lo; if (r.hi != null) out.hi = r.hi;
      } else if (t.kind === 'bp') {
        if (!(r.v >= 60 && r.v2 >= 30)) return toast('Check the blood pressure numbers, or untick them.');
        out.v = +r.v; out.v2 = +r.v2;
      } else if (t.kind === 'qual') {
        if (!r.v) return toast('Choose a result for ' + t.name + ', or untick it.');
        out.v = r.v;
      } else if (t.kind === 'bloodgroup') {
        if (!r.abo || !r.rh) return toast('Choose the blood group and Rhesus factor, or untick it.');
        out.v = r.abo + r.rh;
      }
      if (r.derived) out.note = 'Worked out from total cholesterol and HDL';
      add.push(out);
    }
    let skipped = 0;
    for (const r of add) {
      const dup = S.results.some(x => x.p === r.p && x.t === r.t && x.d === r.d && String(x.v) === String(r.v) && String(x.v2 || '') === String(r.v2 || ''));
      if (dup) skipped++; else S.results.push(r);
    }
    for (const r of imp.rows) if (r.include && r.learnKey) S.aliases[r.learnKey] = r.test;
    save();
    const p = imp.p;
    closeSheet();
    ui.tab = p === 'partner' ? 'plan' : p;
    render();
    window.scrollTo({ top: 0 });
    const saved = add.length - skipped;
    toast(saved ? 'Saved ' + plural(saved, 'result') + (skipped ? '. ' + plural(skipped, 'was', 'were') + ' already in the app' : '') : 'These results were already in the app');
  }

  /* ---------------- Settings, backup, export ---------------- */
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function sheetSettings() {
    const last = S.lastBackup ? HB.fmtDate(S.lastBackup) : 'never';
    const canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
    let b = '<section class="set"><h3>People</h3><p>' + esc(S.profiles.man.label) + ' and ' + esc(S.profiles.woman.label) + (S.plan.partner !== 'man' ? ', with ' + esc(S.profiles.partner.label) + ' as the partner in pregnancy planning' : '') + '.</p>' +
      '<button type="button" class="btn" data-act="profile-all">Edit names, ages and heights</button></section>';
    b += '<section class="set"><h3>Backup</h3><p>Last backup: ' + esc(last) + '. Keep the file somewhere safe, such as Google Drive. Restoring it brings everything back, on this phone or a new one.</p><div class="btn-row">' +
      '<button type="button" class="btn primary" data-act="backup">Download backup</button>' + (canShare ? '<button type="button" class="btn" data-act="share-backup">Share backup</button>' : '') +
      '<button type="button" class="btn" data-act="restore">Restore from backup</button></div></section>';
    b += '<section class="set"><h3>For the doctor</h3><p>Print a one-page summary, or choose Save as PDF in the print screen.</p><div class="btn-row">' +
      ['man', 'woman'].map(k => '<button type="button" class="btn" data-act="print" data-p="' + k + '">Summary for ' + esc(S.profiles[k].label) + '</button>').join('') +
      '<button type="button" class="btn" data-act="csv">Download all results (CSV)</button></div></section>';
    b += '<section class="set"><h3>Install</h3>' + (isStandalone() ? '<p>Installed. Open it from your home screen.</p>'
      : ui.install ? '<p>Install the app for a home-screen icon. It also works offline.</p><button type="button" class="btn" data-act="install">Install app</button>'
        : '<p>In Chrome, open the menu and choose Add to home screen or Install app.</p>') + '</section>';
    b += '<section class="set"><h3>Your data</h3><p>Saved in this browser on this phone only. Nothing is sent anywhere, and reports are read on the phone. <span id="persist-status"></span></p></section>';
    b += '<section class="set"><h3>About</h3><p>Health Baseline ' + esc(HB.VERSION) + '. Flags compare results with the published ranges below. They are prompts to discuss with a doctor, not a diagnosis.</p>' +
      '<details class="sources"><summary>Sources</summary><ul>' + HB.SOURCES.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></details></section>';
    b += '<section class="set"><h3>Delete everything</h3><p>Removes all people, results and settings from this phone. Download a backup first if you might want them back.</p><button type="button" class="btn danger" data-act="wipe">Delete all data</button></section>';
    openSheet('Settings', b);
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(ok => { const el = $('#persist-status'); if (el) el.textContent = ok ? 'The browser has agreed not to clear it on its own.' : 'Installing the app helps stop the browser from clearing it to save space.'; }).catch(() => {});
    }
  }
  function backupBlob() {
    return new Blob([JSON.stringify({ app: 'health-baseline', version: HB.VERSION, exported: new Date().toISOString(), state: S })], { type: 'application/json' });
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function markBackedUp() { S.lastBackup = today; S.lastBackupAt = new Date().toISOString(); save(false); }
  function downloadBackup() {
    downloadBlob(backupBlob(), 'health-baseline-backup-' + today + '.json');
    markBackedUp(); render();
    if ($('#sheet').open) sheetSettings();
    toast('Backup saved to your downloads');
  }
  async function shareBackup() {
    const file = new File([backupBlob()], 'health-baseline-backup-' + today + '.json', { type: 'application/json' });
    try { await navigator.share({ files: [file], title: 'Health Baseline backup' }); markBackedUp(); render(); if ($('#sheet').open) sheetSettings(); toast('Backup shared'); }
    catch (e) { if (e && e.name !== 'AbortError') toast('Sharing didn\'t work. Use Download backup instead.'); }
  }
  async function restoreFrom(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { return toast('That file isn\'t a Health Baseline backup.'); }
    if (!obj || obj.app !== 'health-baseline' || !obj.state || !Array.isArray(obj.state.results)) return toast('That file isn\'t a Health Baseline backup.');
    const when = obj.exported ? HB.fmtDate(obj.exported.slice(0, 10)) : 'an unknown date';
    if (!confirm('Replace everything on this phone with the backup from ' + when + '? It has ' + plural(obj.state.results.length, 'result') + '.')) return;
    S = upgrade(obj.state);
    S.lastBackup = obj.exported ? obj.exported.slice(0, 10) : today;
    S.lastBackupAt = new Date().toISOString();
    save(false);
    ui.tab = 'man'; ui.open.clear();
    closeSheet(); render(); toast('Backup restored');
  }
  function exportCsv() {
    const rows = [['Person', 'Test', 'Date', 'Value', 'Unit', 'Lab low', 'Lab high', 'Flag', 'Note']];
    const sorted = S.results.slice().sort((a, b) => a.p.localeCompare(b.p) || a.t.localeCompare(b.t) || a.d.localeCompare(b.d));
    for (const r of sorted) {
      const t = HB.TESTS[r.t]; if (!t) continue;
      const ev = evalFor(r.p, r.t, r);
      const val = t.kind === 'num' ? (r.q || '') + r.v : t.kind === 'bp' ? r.v + '/' + r.v2 : HB.formatValue(r.t, r);
      const unit = t.kind === 'num' ? HB.unitLabel(r.u || t.unit) : t.kind === 'bp' ? 'mmHg' : '';
      rows.push([(S.profiles[r.p] || {}).label || r.p, t.name, r.d, val, unit, r.lo != null ? r.lo : '', r.hi != null ? r.hi : '', ev.word || '', r.note || '']);
    }
    const csv = rows.map(row => row.map(c => { const s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv' }), 'health-baseline-results-' + today + '.csv');
    toast('Results saved to your downloads');
  }
  function printSummary(p) {
    const prof = S.profiles[p];
    const age = HB.ageOn(prof, today);
    let h = '<h1>' + esc(prof.label) + ': health summary</h1><p class="ps-meta">' + esc(metaLine(prof, age)) + '. Printed ' + esc(HB.fmtDate(today)) + '.</p>';
    h += '<table><thead><tr><th>Test</th><th>Latest result</th><th>Date</th><th>Flag</th></tr></thead><tbody>';
    let any = false;
    for (const pa of HB.panelsFor(p, S)) {
      for (const tid of testsShown(pa, p)) {
        const r = HB.latest(S, p, tid); if (!r) continue;
        any = true;
        const ev = evalFor(p, tid, r);
        let val = HB.formatValue(tid, r);
        if (tid === 'weight' && prof.heightCm) val += ' (body mass index ' + HB.bmi(+r.v, prof.heightCm) + ')';
        if (tid === 'creat') { const c = HB.ctxFor(S, p, r.d); const g = HB.egfr(+r.v, c.age, c.sex); if (g) val += ' (eGFR ' + g + ')'; }
        h += '<tr><td>' + esc(HB.TESTS[tid].name) + '</td><td>' + esc(val) + '</td><td>' + esc(HB.fmtDate(r.d)) + '</td><td>' + esc(ev.flag === 'done' || ev.flag === 'info' ? '' : ev.word || '') + '</td></tr>';
      }
    }
    if (!any) h += '<tr><td colspan="4">No results yet.</td></tr>';
    h += '</tbody></table>';
    const due = HB.panelsFor(p, S).map(pa => ({ pa, s: HB.schedule(pa, p, S, today) })).filter(x => x.s.state === 'due');
    if (due.length) h += '<h2>Due now</h2><ul>' + due.map(x => '<li>' + esc(x.pa.name) + ': ' + esc(x.s.text) + '</li>').join('') + '</ul>';
    if (p === 'woman' && S.plan.target) {
      h += '<h2>Pregnancy planning</h2><p>Planned date to start trying: ' + esc(HB.fmtDate(S.plan.target)) + '.</p><ul>' +
        HB.PLAN_PANELS.map(id => { const s = HB.planStatus(HB.PANEL[id], 'woman', S, today); return '<li>' + esc((HB.PANEL[id].plan && HB.PANEL[id].plan.name) || HB.PANEL[id].name) + ': ' + esc(s.text) + '</li>'; }).join('') + '</ul>';
    }
    h += '<p class="ps-fine">Flags compare results with published ranges (sources listed in the app). They are prompts for discussion, not a diagnosis.</p>';
    $('#print-area').innerHTML = h;
    closeSheet();
    setTimeout(() => window.print(), 250);
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, actionLabel, action) {
    const el = $('#toast');
    const host = $('#sheet').open ? $('#sheet') : document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button" class="text-btn" id="toast-act">' + esc(actionLabel) + '</button>' : '');
    el.classList.add('show');
    if (actionLabel) $('#toast-act').onclick = () => { el.classList.remove('show'); action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 12000 : 3500);
  }

  /* ---------------- Events ---------------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const CHANGE_ONLY = ['check', 'vax', 'vaxdate', 'target', 'f-t', 'imp-p', 'imp-d', 'rv-inc', 'rv-v', 'rv-v2', 'rv-q', 'rv-abo', 'rv-rh', 'assign'];
    if (CHANGE_ONLY.includes(act)) return;
    switch (act) {
      case 'tab': ui.tab = el.dataset.tab; S.ui = { tab: ui.tab }; save(false); render(); window.scrollTo({ top: 0 }); break;
      case 'toggle': { const k = el.dataset.key; if (ui.open.has(k)) ui.open.delete(k); else ui.open.add(k); render(k); break; }
      case 'import': sheetImport(el.dataset.p); break;
      case 'pick-file': { const f = $('#file-pdf'); f.value = ''; f.click(); break; }
      case 'imp-pw': { const pw = $('#imp-pw').value; if (ui.imp && ui.imp.file) readPdf(ui.imp.file, pw); break; }
      case 'imp-save': saveImport(); break;
      case 'add': sheetAdd(el.dataset.p, el.dataset.test); break;
      case 'edit': sheetAdd(null, null, el.dataset.id); break;
      case 'save-result': saveResult(el.dataset.id || null); break;
      case 'del': deleteResult(el.dataset.id); break;
      case 'profile': sheetProfile(el.dataset.p); break;
      case 'profile-all': sheetProfile(null); break;
      case 'save-profile': saveProfile(el.dataset.keys.split(',')); break;
      case 'settings': sheetSettings(); break;
      case 'close': closeSheet(); break;
      case 'backup': downloadBackup(); break;
      case 'share-backup': shareBackup(); break;
      case 'restore': { const f = $('#file-backup'); f.value = ''; f.click(); break; }
      case 'csv': exportCsv(); break;
      case 'print': printSummary(el.dataset.p); break;
      case 'install': if (ui.install) { ui.install.prompt(); ui.install.userChoice.finally(() => { ui.install = null; closeSheet(); }); } break;
      case 'partner': S.plan.partner = el.dataset.v; save(); render(); break;
      case 'wipe':
        if (confirm('Delete all data on this phone? This can\'t be undone.') && confirm('Are you sure? Every result will be removed.')) {
          localStorage.removeItem(KEY); S = defaultState(); save(false); ui.tab = 'man'; ui.open.clear(); closeSheet(); render(); toast('All data deleted');
        }
        break;
    }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const imp = ui.imp;
    const i = el.dataset.i != null ? +el.dataset.i : null;
    switch (act) {
      case 'vax': { const p = el.dataset.p, v = el.dataset.v; S.vaccines[p] = S.vaccines[p] || {}; const cur = S.vaccines[p][v] || {}; if (el.value) S.vaccines[p][v] = Object.assign(cur, { s: el.value }); else delete S.vaccines[p][v]; save(); render(); break; }
      case 'vaxdate': { const p = el.dataset.p; S.vaccines[p] = S.vaccines[p] || {}; const cur = S.vaccines[p].td || {}; cur.d = el.value || null; if (cur.d && !cur.s) cur.s = 'done'; S.vaccines[p].td = cur; save(); render(); break; }
      case 'target': S.plan.target = el.value || null; save(); render(); break;
      case 'check': S.plan.checks[el.dataset.key] = el.checked ? today : null; save(); render(); break;
      case 'f-t': $('#f-fields').innerHTML = fieldsFor(el.value, null); break;
      case 'imp-p': if (imp) { imp.p = el.value; refreshImport(); } break;
      case 'imp-d': if (imp) { imp.date = el.value; refreshImport(); } break;
      case 'rv-inc': if (imp) { imp.rows[i].include = el.checked; refreshImport(); } break;
      case 'rv-v': case 'rv-v2':
        if (imp) {
          const r = imp.rows[i];
          r[act === 'rv-v' ? 'v' : 'v2'] = el.value.trim().replace(/,/g, '');
          r.note = null; r.warn = false;
          const ctx = HB.ctxFor(S, imp.p, imp.date);
          const b = $('#rvb-' + i); if (b) b.innerHTML = badge(rowEval(r, ctx));
        }
        break;
      case 'rv-q': if (imp) { imp.rows[i].v = el.value || null; imp.rows[i].warn = false; refreshImport(); } break;
      case 'rv-abo': case 'rv-rh': if (imp) { const r = imp.rows[i]; r[act === 'rv-abo' ? 'abo' : 'rh'] = el.value || null; r.v = r.abo && r.rh ? r.abo + r.rh : null; refreshImport(); } break;
      case 'assign': if (imp && el.value) assignOther(i, el.value); break;
    }
  });
  $('#file-pdf').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f && ui.imp) readPdf(f); });
  $('#file-backup').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) restoreFrom(f); });
  $('#sheet').addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  $('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) closeSheet(); });
  $('#sheet').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'imp-pw') { e.preventDefault(); if (ui.imp && ui.imp.file) readPdf(ui.imp.file, e.target.value); } });
  window.addEventListener('popstate', () => { if ($('#sheet').open) closeSheet(true); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.install = e; });
  window.addEventListener('appinstalled', () => { ui.install = null; toast('Installed. Open Health Baseline from your home screen.'); });
  window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && HB.todayISO() !== today && !$('#sheet').open) render(); });
  window.addEventListener('storage', e => { if (e.key === KEY) { S = load(); render(); } });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'activated' && hadController) toast('An update is ready.', 'Reload', () => location.reload()); });
      });
    }).catch(() => { /* offline install not available */ });
  }

  render();
})();
