// Launch Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table and a per-protocol detail sheet with the model's own inputs
// and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// Deep links: #/protocol/<slug> opens a protocol's detail sheet, #/filter/<text> filters the
// board, #/category/<name> picks a category. The page writes the same hash back as you use it.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // radar-2, the same function main.ts runs: the page recomputes a row from the snapshot figures
  // and checks the number board.json carries, so page and board visibly agree.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? model.growth_up_weight : model.growth_down_weight;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.log1p(Math.min(Math.max(age, 0), model.maturity_days)) / Math.log1p(model.maturity_days)) * model.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth * row.sector_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  function readHash() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    if (!hash) return;
    var parts = hash.split('/');
    if (parts[0] === 'protocol' && parts[1]) state.selected = decodeURIComponent(parts[1]);
    else if (parts[0] === 'filter' && parts[1] !== undefined) state.q = decodeURIComponent(parts.slice(1).join('/'));
    else if (parts[0] === 'category' && parts[1]) state.category = decodeURIComponent(parts.slice(1).join('/'));
    else {
      var params = new URLSearchParams(hash);
      if (params.get('q')) state.q = params.get('q');
      if (params.get('p')) state.selected = params.get('p');
      if (params.get('category')) state.category = params.get('category');
    }
  }
  function writeHash() {
    var next = '';
    if (state.selected) next = '#/protocol/' + encodeURIComponent(state.selected);
    else if (state.q) next = '#/filter/' + encodeURIComponent(state.q);
    else if (state.category !== 'all') next = '#/category/' + encodeURIComponent(state.category);
    if (next) window.history.replaceState(null, '', next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, r.sector, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'radar-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Launch' }), ' Radar')),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, ranked by the same implied value. An implied value is a model, not a promise — and never a claim that a token will launch.')),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'Early rows below the floor' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'Live-token protocols set aside' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.selected = null; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
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
        el('td', { class: 'rank-num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', null, el('span', { class: 'sector-tag', text: r.sector || 'other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Sector' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked. A falling TVL is punished harder than a rising one is rewarded; age counts on a log scale, so a protocol that ran years with no token banks more unpriced usage than one listed last month.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x growthMult x maturityMult x breadthMult x sectorMult )\n' +
        'growthMult   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_up_weight + ' up, x ' + m.growth_down_weight + ' down\n' +
        'maturityMult = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x ln(1 + age_days) / ln(1 + ' + m.maturity_days + ')\n' +
        'breadthMult  = 1 + 0.03 x min(chains - 1, 5)      sectorMult = 0.90 bridge, 0.95 stablecoin, 1.00 staking / derivatives, 1.05 liquidity / chain, 1.08 real-world, 1.10 lending'
      ),
      el('dl', null,
        el('div', null, el('dt', { text: 'Base multiple' }), el('dd', { text: 'x ' + m.base_multiple + ' of TVL' })),
        el('div', null, el('dt', { text: 'Growth clamp' }), el('dd', { text: m.growth_floor + '% to +' + m.growth_cap + '%' })),
        el('div', null, el('dt', { text: 'Age horizon' }), el('dd', { text: m.maturity_days + ' days, log scale' })),
        el('div', null, el('dt', { text: 'Unknown age' }), el('dd', { text: m.unknown_age_days + ' days' })),
        el('div', null, el('dt', { text: 'Model version' }), el('dd', { text: DATA.model_version }))
      )
    );
  }

  var sheet = el('aside', { class: 'detail', id: 'detail', hidden: 'hidden', 'aria-labelledby': 'detail-title' });
  var scrim = el('div', { class: 'scrim', hidden: 'hidden', onclick: function () { closeDetail(); } });

  function closeDetail() {
    state.selected = null;
    sheet.setAttribute('hidden', 'hidden');
    scrim.setAttribute('hidden', 'hidden');
    writeHash();
    render();
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    sheet.textContent = '';
    sheet.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name' }, el('b', { text: 'Rank ' + row.rank }), ' of ' + DATA.board_size + ' · ' + (row.sector || 'other')),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); } })
    ));
    sheet.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Sector multiplier' }), el('b', { class: 'num', text: String(row.sector_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': this page recomputes the row as ' + fmtUsd(recomputed) + (matches ? ', the same number board.json carries.' : ', which differs from the board — the data would be stale.') + ' An estimate, not a price, and no prediction that a token launches.' })
    ));
    sheet.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    sheet.removeAttribute('hidden');
    scrim.removeAttribute('hidden');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!sheet.isConnected) { app.appendChild(scrim); app.appendChild(sheet); }
    if (state.selected) openDetail(state.selected);
    else { sheet.setAttribute('hidden', 'hidden'); scrim.setAttribute('hidden', 'hidden'); }
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
