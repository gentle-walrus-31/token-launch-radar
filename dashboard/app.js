// Token Radar's dashboard (model radar-2). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the board, the top-10 picks, the live comparables
// and the method. No network: every byte it shows is in data.js.
//
// What makes this radar different from a TVL table:
//  - every row's implied value is auditable: the detail view shows the comps behind its
//    multiple, the multiple itself and every adjustment, and recomputes the number.
//  - a farmability score (cost / time / risk) and an early score (recency / growth /
//    spread) come from the same snapshot figures.
//  - a scenario simulator lets a reader change the airdrop share and the multiple
//    haircut and watch the values move; the board itself keeps the model's numbers.
//  - the top 10 carry a written reason each, not just a rank.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', tab: 'board', sort: 'implied', dir: -1,
    selected: null, wlOnly: false, earlyOnly: false, minFarm: 0,
    sim: { on: false, airdrop: 7.5, haircut: 100 },
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + 'x'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- scenario values: the simulator's assumptions applied to a row's stored model ----
  function scenImplied(row) { return Math.max(1, Math.round(row.implied_value_usd * state.sim.haircut / 100)); }
  function scenAirdrop(row) { return Math.max(1, Math.round(scenImplied(row) * state.sim.airdrop / 100)); }
  function shownImplied(row) { return state.sim.on ? scenImplied(row) : row.implied_value_usd; }
  function shownAirdrop(row) { return state.sim.on ? scenAirdrop(row) : row.airdrop_pool_usd; }

  // ---- the model's arithmetic, recomputed in the page so the detail view can audit it ----
  function recompute(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.comp_multiple * row.growth_multiplier * row.age_multiplier * row.chain_multiplier));
  }
  function compEntry(category) {
    var found = null;
    DATA.comps.forEach(function (c) { if (c.category === category) found = c; });
    return found;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wlOnly && !r.on_watchlist) return false;
      if (state.earlyOnly && r.early_score < 60) return false;
      if (r.farmability.score < state.minFarm) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (state.sort === 'farm') { av = a.farmability.score; bv = b.farmability.score; }
      else if (state.sort === 'early') { av = a.early_score; bv = b.early_score; }
      else { av = shownImplied(a); bv = shownImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- header, hero, facts ----
  var RADAR_SVG = '<svg viewBox="0 0 200 200" width="200" height="200" aria-hidden="true">'
    + '<circle cx="100" cy="100" r="96" fill="none" stroke="#1e2c47" stroke-width="1"/>'
    + '<circle cx="100" cy="100" r="64" fill="none" stroke="#1e2c47" stroke-width="1"/>'
    + '<circle cx="100" cy="100" r="32" fill="none" stroke="#1e2c47" stroke-width="1"/>'
    + '<line x1="100" y1="4" x2="100" y2="196" stroke="#1e2c47" stroke-width="1"/>'
    + '<line x1="4" y1="100" x2="196" y2="100" stroke="#1e2c47" stroke-width="1"/>'
    + '<circle cx="138" cy="66" r="5" fill="#5ef2b8"/><circle cx="66" cy="128" r="4" fill="#a78bfa"/>'
    + '<circle cx="118" cy="140" r="3.5" fill="#67e8f9"/><circle cx="100" cy="100" r="3" fill="#fbbf24"/></svg>';

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-name', html: 'TOKEN <em>RADAR</em>' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { class: 'pill', html: 'Source <b>DefiLlama protocol index</b>' })
      )
    );
  }
  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { html: 'Which pre-token protocol is <span class="grad">worth farming next?</span>' }),
        el('p', { text: '198 pre-token protocols, ranked by what their launch would be worth — priced from the live protocols that already trade, not from a TVL table. Every number shows its working, every row carries a farmability score, early signals and a concrete farm plan.' })
      ),
      el('div', { class: 'radar' }, el('div', { class: 'sweep', 'aria-hidden': 'true' }), el('div', { html: RADAR_SVG }))
    );
  }
  function facts() {
    var early = DATA.rows.filter(function (r) { return r.early_score >= 60; }).length;
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { class: 'num', text: fmtUsd(DATA.total_implied_usd) })),
      el('div', { class: 'fact' }, el('span', { text: 'Airdrop pools (7.5%)' }), el('b', { class: 'num', text: fmtUsd(DATA.total_airdrop_usd) })),
      el('div', { class: 'fact' }, el('span', { text: 'Flagged EARLY' }), el('b', { text: String(early) }))
    );
  }

  // ---- tabs ----
  function tabs() {
    var defs = [['board', 'Board'], ['picks', 'Top 10 picks'], ['live', 'Live comps'], ['method', 'How it works']];
    return el('div', { class: 'tabs', role: 'tablist' }, defs.map(function (d) {
      return el('button', {
        type: 'button', role: 'tab', 'aria-pressed': state.tab === d[0] ? 'true' : 'false', text: d[1],
        onclick: function () { state.tab = d[0]; writeHash(); render(); },
      });
    }));
  }

  // ---- simulator ----
  function simulator() {
    function slider(id, label, min, max, step, value, fmt, oninput) {
      var out = el('b', { text: fmt(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { out.textContent = fmt(Number(input.value)); oninput(Number(input.value)); });
      return el('div', { class: 'slider' }, el('label', { for: id }, el('span', { text: label }), out), input);
    }
    var sim = el('section', { class: 'sim' },
      el('h2', { text: 'Scenario simulator — change the assumptions, watch the values move' }),
      el('p', { text: 'The board ranks by the model\u2019s own numbers (7.5% of supply to an airdrop, full comps multiple). Move the sliders to stress-test them. Turning the simulator on re-sorts the board by your scenario values; the model\u2019s numbers stay in the detail view either way.' }),
      el('div', { class: 'sliders' },
        slider('sim-air', 'Airdrop share of supply', 2, 15, 0.5, state.sim.airdrop, function (v) { return v.toFixed(1) + '%'; }, function (v) { state.sim.airdrop = v; renderSimOut(); }),
        slider('sim-hair', 'Comps multiple haircut', 50, 150, 5, state.sim.haircut, function (v) { return v + '%'; }, function (v) { state.sim.haircut = v; renderSimOut(); }),
        el('div', { class: 'slider' },
          el('label', null, el('span', { text: 'Apply to the board' }), el('b', { text: state.sim.on ? 'on' : 'off' })),
          el('button', {
            class: 'button primary', type: 'button', text: state.sim.on ? 'Scenario on — click to use model values' : 'Use my scenario on the board',
            onclick: function () { state.sim.on = !state.sim.on; render(); },
          })
        )
      ),
      el('div', { class: 'sim-out', id: 'sim-out' })
    );
    function renderSimOut() {
      var box = sim.querySelector('#sim-out');
      if (!box) return;
      var top = DATA.rows[0];
      var total = DATA.rows.reduce(function (n, r) { return n + scenImplied(r); }, 0);
      var pool = DATA.rows.reduce(function (n, r) { return n + scenAirdrop(r); }, 0);
      box.textContent = '';
      box.appendChild(el('div', null, el('span', { text: 'Total implied value, your scenario' }), el('b', { class: 'num', text: fmtUsd(total) })));
      box.appendChild(el('div', null, el('span', { text: 'Total airdrop pool, your scenario' }), el('b', { class: 'num', text: fmtUsd(pool) })));
      box.appendChild(el('div', null, el('span', { text: 'Rank 1 under your scenario' }), el('b', { text: top.name + ' — ' + fmtUsd(scenImplied(top)) })));
      box.appendChild(el('div', null, el('span', { text: 'Rank 1 airdrop pool' }), el('b', { class: 'num', text: fmtUsd(scenAirdrop(top)) })));
    }
    renderSimOut();
    return sim;
  }

  // ---- controls ----
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var farm = el('select', { id: 'minfarm', 'aria-label': 'Minimum farmability score' },
      [['0', 'Any farmability'], ['50', 'Farmability 50+'], ['65', 'Farmability 65+ (B or better)'], ['80', 'Farmability 80+ (A)']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minFarm) === o[0] ? 'selected' : null });
      })
    );
    farm.addEventListener('change', function () { state.minFarm = Number(farm.value); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wlOnly ? 'checked' : null });
    wl.addEventListener('change', function () { state.wlOnly = wl.checked; render(); });
    var eo = el('input', { type: 'checkbox', id: 'eo', checked: state.earlyOnly ? 'checked' : null });
    eo.addEventListener('change', function () { state.earlyOnly = eo.checked; render(); });
    return el('div', null,
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
        el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
        el('div', { class: 'field' }, el('label', { for: 'minfarm', text: 'Farmability' }), farm),
        el('span', { class: 'count', text: filteredRows().length + ' of ' + DATA.rows.length + ' rows shown' + (state.sim.on ? ' · scenario values' : '') })
      ),
      el('div', { class: 'checks' },
        el('label', { for: 'wl' }, wl, 'Watchlist only'),
        el('label', { for: 'eo' }, eo, 'EARLY signals only')
      )
    );
  }

  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function badges(r) {
    var out = [];
    if (r.on_watchlist) out.push(el('span', { class: 'badge wl', text: 'WATCHLIST' }));
    else if (r.tvl_usd >= DATA.floor_usd) out.push(el('span', { class: 'badge off', text: 'OFF-WATCHLIST' }));
    if (r.early_score >= 60) out.push(el('span', { class: 'badge early', text: 'EARLY' }));
    return out;
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wlOnly = false; state.earlyOnly = false; state.minFarm = 0; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { max = Math.max(max, shownImplied(r)); });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), badges(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownImplied(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownImplied(r)) })
        )),
        el('td', { class: 'num', text: fmtUsd(shownAirdrop(r)) }),
        el('td', { class: 'num' }, el('span', { class: 'grade ' + r.farmability.grade.toLowerCase(), text: r.farmability.grade + ' ' + r.farmability.score }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (state.sim.on ? 'Scenario values (your airdrop share and haircut) — the model\u2019s own numbers are in each detail view.' : 'Pre-token protocols, strongest implied value first.') + ' Select a row for its audit, farmability and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', 'num'),
            sortHeader('growth', '7d', 'num'),
            sortHeader('age', 'Age', 'num'),
            sortHeader('implied', 'Implied value', 'num'),
            sortHeader('implied', 'Airdrop pool', 'num'),
            sortHeader('farm', 'Farm', 'num')
          )),
          tbody
        )
      )
    );
  }

  // ---- horizontal bar chart (inline SVG string, no library, no network) ----
  function hbars(items, valueOf, labelOf, color, fmt) {
    var fmtV = fmt || fmtUsd;
    var max = 1;
    items.forEach(function (it) { max = Math.max(max, valueOf(it)); });
    var parts = ['<svg viewBox="0 0 760 ' + (26 * items.length + 8) + '" class="chart" role="img">'];
    items.forEach(function (it, i) {
      var y = 8 + i * 26;
      var w = Math.max(4, Math.round((valueOf(it) / max) * 430));
      var lab = String(labelOf(it)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      parts.push('<text x="0" y="' + (y + 13) + '" fill="#93a3c0" font-size="12">' + lab + '</text>');
      parts.push('<rect x="190" y="' + y + '" width="' + w + '" height="16" rx="4" fill="' + color + '"/>');
      parts.push('<text x="' + (198 + w) + '" y="' + (y + 13) + '" fill="#e8eefc" font-size="12" font-family="ui-monospace, Menlo, monospace">' + fmtV(valueOf(it)) + '</text>');
    });
    parts.push('</svg>');
    return el('div', { html: parts.join('') });
  }

  // ---- top 10 picks ----
  function picksView() {
    var top = DATA.rows.slice(0, 10);
    var cards = top.map(function (r) {
      return el('article', {
        class: 'pick', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('span', { class: 'rank', text: 'Pick #' + r.rank + ' · ' + (r.category || 'Other') }),
        el('h3', { text: r.name }),
        el('p', { text: r.pick_reason || '' }),
        el('div', { class: 'meta' },
          el('span', null, 'Implied ', el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
          el('span', null, 'Airdrop pool ', el('b', { class: 'num', text: fmtUsd(r.airdrop_pool_usd) })),
          el('span', null, 'Farm ', el('b', { text: r.farmability.grade + ' ' + r.farmability.score }))
        )
      );
    });
    return el('div', null,
      el('div', { class: 'panel pad', style: 'margin-bottom:12px' },
        el('h2', { text: 'The top 10, and why each one' }),
        el('p', { class: 'sub', text: 'A rank is a claim; a reason is the argument. Each pick below is written from its own figures — its size in its category, its comps, its growth, its tenure with no token, and how cheap it is to farm. Select a card for the full audit and farm plan.' }),
        hbars(top, function (r) { return r.implied_value_usd; }, function (r) { return '#' + r.rank + ' ' + r.name.slice(0, 22); }, '#5ef2b8')
      ),
      el('div', { class: 'picks' }, cards)
    );
  }

  // ---- live comps ----
  function liveView() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('span', { class: 'badge off', text: 'ALREADY TRADES' }))
      ));
    });
    var medRows = DATA.comps.filter(function (c) { return !c.fallback_global; }).sort(function (a, b) { return b.median - a.median; });
    return el('div', null,
      el('div', { class: 'panel pad', style: 'margin-bottom:12px' },
        el('h2', { text: 'The comparables: what live tokens actually trade at' }),
        el('p', { class: 'sub', text: 'The implied value of every pre-token protocol is TVL times one of these medians. A category with fewer than 3 traded comps falls back to the global median of ' + DATA.global_median_multiple.toFixed(2) + 'x, and the detail view says so. Market cap is the conservative proxy for fully-diluted value: FDV is usually at least the market cap, so these multiples understate rather than overstate.' }),
        hbars(medRows.slice(0, 10), function (c) { return c.median; }, function (c) { return c.category.slice(0, 24) + ' (n=' + c.n + ')'; }, '#a78bfa', function (v) { return v.toFixed(2) + 'x'; })
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'The largest live-token protocols by market cap. They already trade, so their market cap is a fact, not a model — and they are kept out of the pre-token ranking.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
            tbody
          )
        )
      )
    );
  }

  // ---- methodology ----
  function methodView() {
    var m = DATA.model;
    return el('div', null,
      el('div', { class: 'panel pad' },
        el('h2', { text: 'How it works — the whole model, in the open' }),
        el('p', { class: 'sub', text: 'Nothing here is a black box. The same arithmetic scores every row, no name is special-cased, and the detail view of any protocol shows its own numbers plugged into the formula.' }),
        el('h3', { text: 'Implied value (comps model)' }),
        el('div', { class: 'formula', text: 'implied FDV = tvl_usd × compMultiple × growthMult × ageMult × chainMult\n'
          + 'airdrop pool = implied FDV × ' + (m.airdrop_pct * 100).toFixed(1) + '% of supply\n\n'
          + 'compMultiple  = median(market-cap / TVL) of the live-token protocols in the same\n'
          + '                category (≥3 comps, else the global median ' + DATA.global_median_multiple.toFixed(2) + 'x),\n'
          + '                clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']\n'
          + 'growthMult    = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '\n'
          + 'ageMult       = ' + m.age_floor + ' + min(age_days, ' + m.age_days + ') / ' + m.age_days + ' × ' + m.age_range
          + '   (age = days since listed, with no token; unknown age uses ' + m.unknown_age_days + ' days)\n'
          + 'chainMult     = 1 + min(chains − 1, ' + m.chain_max_extra + ') × ' + m.chain_step }),
        el('h3', { text: 'Farmability (0–100)' }),
        el('p', { class: 'sub', text: 'Cost 30: the main chain\u2019s gas tier (cheap chains like Solana, Base and Arbitrum score 30, mid-tier chains 20, Ethereum and Bitcoin 10). Time 30: the hold window (30 days scores 30, 45 days 22, 60 days 15). Risk 40: starts at 40 and loses 10 if listed under 180 days, 8 if TVL is under $100M, 8 for high-risk categories (perpetuals, derivatives, leveraged, basis trading, prediction, options), 5 for a single chain and 5 for a 7-day drawdown worse than −20%. Grades: A 80+, B 65+, C 50+, D below.' }),
        el('h3', { text: 'Early score (0–100)' }),
        el('p', { class: 'sub', text: 'Recency 40 (listed under 90 days scores 40, under 180 days 32, under a year 24, under two years 12, older 5; unknown age 15), 7-day growth 35 (over +20% scores 35, over +10% 28, positive 20, mildly negative 10, worse 5; unreported 10), chain spread 25 (5 or more chains 25, 3–4 chains 18, 2 chains 10, one chain 4). 60 or more earns the EARLY badge.' }),
        el('h3', { text: 'What the model cannot know — read this before you farm' }),
        el('div', { class: 'callout' },
          el('p', { text: '“No token on record” is what DefiLlama records, not proof a token does not exist. A protocol on this board may have a token its record does not carry.' }),
          el('p', { text: 'Implied value is not a prediction that a token will launch, when it will, or at what price. It prices a launch IF the protocol\u2019s record stayed as it is.' }),
          el('p', { text: 'Market cap is a conservative stand-in for fully-diluted value; a token with most of its supply locked would price higher than the multiple suggests.' }),
          el('p', { text: 'The 7.5% airdrop share is an assumption, not a fact — the simulator exists so you can replace it with your own. Gas tiers are rough estimates by chain, not quotes.' }),
          el('p', { text: 'The snapshot is frozen at 14 November 2026. TVL, growth and listings have moved since; re-run the program on a fresh snapshot and the board re-ranks itself.' })
        ),
        el('h3', { text: 'Coverage' }),
        el('p', { class: 'sub', text: 'The board covers all ' + DATA.watchlist_size + ' watchlist protocols, plus ' + DATA.early_size + ' pre-token protocols below the $50M floor — and ' + DATA.off_watchlist_above_floor + ' more above the floor that the watchlist leaves out, because DefiLlama records a parent protocol for them (a field this snapshot does not carry). Those rows are flagged OFF-WATCHLIST in the board and explained in their detail view. ' + DATA.live_size + ' live-token protocols are set aside with their market caps shown.' }),
        el('div', { class: 'legend' },
          el('span', null, el('b', { text: 'WATCHLIST' }), ' — on the house watchlist'),
          el('span', null, el('b', { text: 'EARLY' }), ' — early score 60+'),
          el('span', null, el('b', { text: 'OFF-WATCHLIST' }), ' — above the floor, not on the list')
        )
      )
    );
  }

  // ---- detail dialog ----
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'Other') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown') + ' · ' + fmtAge(row.age_days) + ' with no token on record' }),
        el('div', { class: 'chips' }, badges(row))
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    if (row.pick_reason) {
      inner.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why this one' }),
        el('p', { text: row.pick_reason })
      ));
    }
    if (!row.on_watchlist && row.tvl_usd >= DATA.floor_usd) {
      inner.appendChild(el('p', { class: 'note', html: '<b>Off-watchlist, above the floor.</b> This protocol is not on the house watchlist: DefiLlama records a parent protocol for it, a field this snapshot does not carry. It is ranked here because its own record shows no token, and every exclusion the snapshot can express was applied.' }));
    }

    // Audit: the formula with this row's numbers, and the comps behind the multiple.
    var recomp = recompute(row);
    var audit = el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the audit' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comps multiple (' + row.comp_category + ')' }), el('b', { class: 'num', text: fmtMult(row.comp_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: row.age_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: row.chain_multiplier.toFixed(4) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Recomputed in this page from the same inputs: ' + fmtUsd(recomp) + (recomp === row.implied_value_usd ? ' — the same number board.json carries.' : ' — differs from the board; the data would be stale.') + ' Airdrop pool at the model\u2019s 7.5% assumption: ' + fmtUsd(row.airdrop_pool_usd) + (state.sim.on ? ' · under your scenario (' + state.sim.airdrop.toFixed(1) + '% share, ' + state.sim.haircut + '% multiple): ' + fmtUsd(scenAirdrop(row)) + '.' : '') })
    );
    var entry = compEntry(row.comp_category);
    if (entry) {
      var cbody = el('tbody');
      entry.comps.forEach(function (c) {
        cbody.appendChild(el('tr', null,
          el('td', null, el('b', { text: c.name })),
          el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
          el('td', { class: 'num', text: fmtMult(c.multiple) })
        ));
      });
      audit.appendChild(el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The comparables: the largest live-token ' + row.comp_category + ' protocols. Their median market-cap/TVL is ' + entry.median.toFixed(2) + 'x across ' + entry.n + ' traded comps' + (entry.fallback_global ? '; fewer than 3 comps, so the global median ' + DATA.global_median_multiple.toFixed(2) + 'x was used instead.' : '.') }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }))),
          cbody
        )
      ));
    } else if (row.comp_fallback_global) {
      audit.appendChild(el('p', { class: 'sub', text: 'No traded comps in this category, so the global median of ' + DATA.global_median_multiple.toFixed(2) + 'x was used.' }));
    }
    inner.appendChild(audit);

    // Farmability + early signals.
    var f = row.farmability;
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farmability — ' + f.score + '/100, grade ' + f.grade }),
      el('div', { class: 'scorebars' },
        el('div', { class: 'scorebar' }, el('span', { text: 'Cost (gas tier: ' + f.gas_tier + ') — /30' }), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(f.cost / 30 * 100) + '%' })), el('b', { text: f.cost + ' / 30' })),
        el('div', { class: 'scorebar' }, el('span', { text: 'Time (hold window) — /30' }), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(f.time / 30 * 100) + '%' })), el('b', { text: f.time + ' / 30' })),
        el('div', { class: 'scorebar' }, el('span', { text: 'Risk (age, size, category, chains) — /40' }), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(f.risk / 40 * 100) + '%' })), el('b', { text: f.risk + ' / 40' }))
      ),
      el('p', { class: 'sub', text: 'Cost is the main chain\u2019s gas tier, time is how long the position must be held to count, risk is the protocol\u2019s age, size, category, chain count and 7-day drawdown. The formula is in How it works.' })
    ));
    var sig = row.early_signals && row.early_signals.length
      ? row.early_signals.map(function (s) { return el('span', { class: 'chip hot', text: s }); })
      : [el('span', { class: 'chip', text: 'no early signal fired' })];
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Early signals — ' + row.early_score + '/100' }),
      el('div', { class: 'chips' }, sig)
    ));

    // Farm plan.
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('p', { text: 'Token Radar, model ' + DATA.model_version + '. Data: DefiLlama protocol index, snapshot ' + DATA.as_of + ', frozen — re-run the program on a fresh snapshot and the board re-ranks itself. Implied values are the entry\u2019s own claim, never a promise; “no token on record” is what DefiLlama records, not proof a token does not exist.' }),
      el('p', { text: 'Built from the sealed snapshot alone. No network requests, no external assets.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(facts());
    shell.appendChild(tabs());
    if (state.tab === 'board') {
      shell.appendChild(simulator());
      shell.appendChild(controls());
      shell.appendChild(boardTable());
    } else if (state.tab === 'picks') {
      shell.appendChild(picksView());
    } else if (state.tab === 'live') {
      shell.appendChild(liveView());
    } else {
      shell.appendChild(methodView());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
