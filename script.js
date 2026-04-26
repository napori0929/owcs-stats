/* ============================================================
   OW Analytics Dashboard — script.js
   ============================================================ */

'use strict';

// ── CSV loader (PapaParse) ────────────────────────────────────
const _csvCache = {};

function loadCSV(path) {
  if (_csvCache[path]) return Promise.resolve(_csvCache[path]);
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      download:       true,
      header:         true,
      skipEmptyLines: true,
      dynamicTyping:  true,
      complete: r => {
        const normalized = r.data.map(normalizeCountColumn);
        _csvCache[path] = normalized;
        resolve(normalized);
      },
      error:    e => reject(e),
    });
  });
}

// ── Formatters ────────────────────────────────────────────────
function fmtPct(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

function fmtNum(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString();
}

// ── Helpers ───────────────────────────────────────────────────
function getTopN(rows, field, n) {
  return [...rows]
    .filter(r => r[field] != null)
    .sort((a, b) => b[field] - a[field])
    .slice(0, n);
}

function filterRows(rows, filters) {
  return rows.filter(row => {
    for (const [field, value] of Object.entries(filters)) {
      if (!value) continue;
      const cellVal = (row[field] ?? '').toString().toLowerCase();
      if (!cellVal.includes(value.toLowerCase())) return false;
    }
    return true;
  });
}

function uniqueValues(rows, field) {
  const set = new Set(rows.map(r => r[field]).filter(v => v != null && v !== ''));
  return [...set].sort();
}

function populateSelect(el, values) {
  // Keep the first option (the "All …" placeholder), then add the rest
  const first = el.options[0];
  el.innerHTML = '';
  el.appendChild(first);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
}

// ── Count column normalizer ───────────────────────────────────
// Ensures every row has pick_count. If only usage_count exists, promotes
// it to pick_count. The original usage_count key is left untouched in the
// raw object but is never referenced in display columns.
function normalizeCountColumn(row) {
  if (row.pick_count == null && row.usage_count != null) {
    row.pick_count = row.usage_count;
  }
  return row;
}

// ── Rate bar HTML ─────────────────────────────────────────────
function rateBarHtml(value, cls = 'pr') {
  if (value == null || value === '') return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return '—';
  const pct = (n * 100).toFixed(1);
  const low = cls === 'wr' && n < 0.45;
  const fillCls = low ? 'low' : cls;
  return `<div class="rate-bar-wrap">
    <div class="rate-bar"><div class="rate-bar-fill ${fillCls}" style="width:${pct}%"></div></div>
    <span class="rate-label">${pct}%</span>
  </div>`;
}

// ── Role / position badge ─────────────────────────────────────
function roleBadge(role) {
  if (!role) return '';
  const r = role.toLowerCase();
  if (r === 'tank')    return `<span class="badge badge-tank">Tank</span>`;
  if (r === 'support') return `<span class="badge badge-support">Support</span>`;
  if (r === 'dps')     return `<span class="badge badge-dps">DPS</span>`;
  return `<span class="badge">${role}</span>`;
}

const positionBadge = roleBadge;  // same styling logic

// ── Table renderer ────────────────────────────────────────────
// columns: [{key, label, render?, class?, sortType?}]
// sortType: 'num' | 'str' (default 'str')
function renderTable(containerId, rows, columns, opts = {}) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  if (!rows || rows.length === 0) {
    wrap.innerHTML = `<div class="state-msg"><div class="icon">📭</div>No data</div>`;
    return;
  }

  const sortState = {
    col: opts.defaultSort ?? columns[0].key,
    dir: opts.defaultDir  ?? 'desc',
  };

  function sortedRows() {
    const col   = columns.find(c => c.key === sortState.col) ?? columns[0];
    const isNum = col.sortType === 'num';
    return [...rows].sort((a, b) => {
      let av = a[sortState.col], bv = b[sortState.col];
      if (isNum) { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
      else       { av = (av ?? '').toString(); bv = (bv ?? '').toString(); }
      if (av < bv) return sortState.dir === 'asc' ? -1 :  1;
      if (av > bv) return sortState.dir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  function build() {
    const thead = columns.map(c => {
      const active = c.key === sortState.col;
      const cls    = active ? `sorted-${sortState.dir}` : '';
      const arrow  = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '↕';
      return `<th class="${cls}" data-key="${c.key}">${c.label} <span class="sort-arrow">${arrow}</span></th>`;
    }).join('');

    const tbody = sortedRows().map((row, i) => {
      const cells = columns.map(c => {
        const val      = row[c.key];
        const rendered = c.render ? c.render(val, row, i) : (val ?? '—');
        return `<td class="${c.class ?? ''}">${rendered}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    wrap.innerHTML = `<table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

    wrap.querySelectorAll('thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (sortState.col === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        else { sortState.col = key; sortState.dir = 'desc'; }
        build();
      });
    });
  }

  build();
}

// ── Chart renderer ────────────────────────────────────────────
const _charts = {};

function renderBarChart(canvasId, labels, values, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_charts[canvasId]) { _charts[canvasId].destroy(); }

  const palette = ['#4d9ef7','#f75d5d','#6dd67b','#f7a84d','#a78bfa','#38bdf8','#fb7185'];
  const bgColors = Array.isArray(opts.color)
    ? opts.color
    : labels.map((_, i) => opts.color ?? palette[i % palette.length]);

  _charts[canvasId] = new Chart(canvas, {
    type: opts.type ?? 'bar',
    data: {
      labels,
      datasets: [{
        label:           opts.label ?? '',
        data:            values,
        backgroundColor: bgColors,
        borderColor:     bgColors,
        borderWidth:     opts.type === 'line' ? 2 : 0,
        borderRadius:    4,
        tension:         0.3,
        fill:            false,
        pointRadius:     3,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      indexAxis:           opts.horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed[opts.horizontal ? 'x' : 'y'];
              return opts.pct ? ` ${(v * 100).toFixed(1)}%` : ` ${fmtNum(v)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks:  { color: '#8b9ab5', font: { size: 11 }, maxRotation: opts.horizontal ? 0 : 40 },
          grid:   { color: 'rgba(37,45,61,.5)' },
          border: { color: '#252d3d' },
        },
        y: {
          ticks: {
            color: '#8b9ab5',
            font: { size: 11 },
            callback: v => opts.pct ? (v * 100).toFixed(0) + '%' : fmtNum(v),
          },
          grid:   { color: 'rgba(37,45,61,.5)' },
          border: { color: '#252d3d' },
        },
      },
    },
  });
}

// ── Sidebar navigation ────────────────────────────────────────
function initNav() {
  const items = document.querySelectorAll('.nav-item[data-page]');
  const pages = document.querySelectorAll('.page');

  function activate(pageKey) {
    const pageId = `page-${pageKey}`;
    pages.forEach(p => p.classList.toggle('active', p.id === pageId));
    items.forEach(it => it.classList.toggle('active', it.dataset.page === pageKey));
    PAGE_LOADERS[pageKey]?.();
  }

  items.forEach(it => it.addEventListener('click', () => activate(it.dataset.page)));

  // Activate first page on load
  const first = items[0];
  if (first) activate(first.dataset.page);
}

// ── Load-once guard ───────────────────────────────────────────
const _loaded = {};
function once(key, fn) {
  if (_loaded[key]) return;
  _loaded[key] = true;
  fn();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: OVERVIEW
// ─────────────────────────────────────────────────────────────
async function loadOverview() {
  const [overall, mapSetData, matchData, tournData] = await Promise.all([
    loadCSV('data/overall_hero_usage.csv'),
    loadCSV('data/hero_usage_by_map_set.csv').catch(() => []),
    loadCSV('data/hero_usage_by_match.csv').catch(() => []),
    loadCSV('data/hero_usage_by_tournament.csv'),
  ]);

  const totalPicks     = overall.reduce((s, r) => s + (r.pick_count ?? 0), 0);
  const uniqueHeroes   = new Set(overall.map(r => r.hero_name)).size;
  const uniqueTourneys = new Set(tournData.map(r => r.tournament_sheet)).size;

  // For match count: hero_usage_by_match has match_id column
  const uniqueMatches  = matchData.length > 0
    ? new Set(matchData.map(r => r.match_id)).size : '—';

  // For map set count: unique map_set_id rows in map_set data (each row is one hero pick per map set per team)
  const uniqueMapSets  = mapSetData.length > 0
    ? new Set(mapSetData.map(r => r.match_id + '|' + r.map_set_index)).size : '—';

  document.getElementById('stat-tournaments').textContent = fmtNum(uniqueTourneys);
  document.getElementById('stat-matches').textContent     = fmtNum(uniqueMatches);
  document.getElementById('stat-mapsets').textContent     = fmtNum(uniqueMapSets);
  document.getElementById('stat-picks').textContent       = fmtNum(totalPicks);
  document.getElementById('stat-heroes').textContent      = uniqueHeroes;

  // Top heroes chart
  const top15 = getTopN(overall, 'pick_count', 15);
  renderBarChart('chart-top-heroes',
    top15.map(r => r.hero_name),
    top15.map(r => r.pick_count),
    { label: 'Pick Count', horizontal: true }
  );

  // Role distribution (overview second chart)
  const posData = await loadCSV('data/hero_pick_rate_by_position.csv').catch(() => []);
  const posTotals = {};
  for (const r of posData) {
    if (!r.position) continue;
    posTotals[r.position] = (posTotals[r.position] ?? 0) + (r.pick_count ?? 0);
  }
  const posLabels = Object.keys(posTotals);
  const posColors = posLabels.map(p =>
    p === 'Tank' ? '#4d9ef7' : p === 'DPS' ? '#f75d5d' : p === 'Support' ? '#6dd67b' : '#8b9ab5'
  );
  renderBarChart('chart-position',
    posLabels, Object.values(posTotals),
    { label: 'Picks', color: posColors }
  );

  // Overview table
  const searchEl = document.getElementById('ov-search');
  const roleEl   = document.getElementById('ov-role');
  const limitEl  = document.getElementById('ov-limit');

  function applyOv() {
    let rows = filterRows(overall, {
      hero_name: searchEl.value,
      role:      roleEl.value,
    });
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('ov-table-wrap', rows, [
      { key: 'hero_name',  label: 'Hero',      sortType: 'str' },
      { key: 'role',       label: 'Role',      sortType: 'str', render: v => roleBadge(v) },
      { key: 'pick_count', label: 'Picks',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'pick_rate',  label: 'Pick Rate', sortType: 'num', render: v => rateBarHtml(v, 'pr') },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  searchEl.addEventListener('input',  applyOv);
  roleEl.addEventListener('change',   applyOv);
  limitEl.addEventListener('change',  applyOv);
  applyOv();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: TOURNAMENT
// ─────────────────────────────────────────────────────────────
async function loadTournament() {
  const data = await loadCSV('data/hero_usage_by_tournament.csv');

  const tournEl  = document.getElementById('tourn-filter');
  const roleEl   = document.getElementById('tourn-role');
  const searchEl = document.getElementById('tourn-search');
  const limitEl  = document.getElementById('tourn-limit');

  populateSelect(tournEl, uniqueValues(data, 'tournament_sheet'));

  function apply() {
    let rows = filterRows(data, {
      tournament_sheet: tournEl.value,
      role:             roleEl.value,
      hero_name:        searchEl.value,
    });
    const top15 = getTopN(rows, 'pick_count', 15);
    renderBarChart('chart-tourn',
      top15.map(r => r.hero_name),
      top15.map(r => r.pick_count),
      { label: 'Picks', horizontal: true }
    );
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('tourn-table-wrap', rows, [
      { key: 'tournament_sheet', label: 'Tournament', sortType: 'str' },
      { key: 'hero_name',        label: 'Hero',       sortType: 'str' },
      { key: 'role',             label: 'Role',       sortType: 'str', render: v => roleBadge(v) },
      { key: 'pick_count',       label: 'Picks',      sortType: 'num', render: v => fmtNum(v) },
      { key: 'pick_rate',        label: 'Pick Rate',  sortType: 'num', render: v => rateBarHtml(v, 'pr') },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  [tournEl, roleEl, limitEl].forEach(el => el.addEventListener('change', apply));
  searchEl.addEventListener('input', apply);
  apply();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: MAP
// ─────────────────────────────────────────────────────────────
async function loadMap() {
  const [heroByMap, mapWinRates] = await Promise.all([
    loadCSV('data/hero_usage_by_map.csv'),
    loadCSV('data/map_set_win_rates.csv'),
  ]);

  const mapEl1    = document.getElementById('map-filter');
  const roleEl    = document.getElementById('map-role');
  const searchEl  = document.getElementById('map-search');
  const limitEl   = document.getElementById('map-limit');
  const mapEl2    = document.getElementById('mapwr-map');
  const tournEl2  = document.getElementById('mapwr-tourn');
  const searchEl2 = document.getElementById('mapwr-search');
  const limitEl2  = document.getElementById('mapwr-limit');

  populateSelect(mapEl1,   uniqueValues(heroByMap,   'map_name'));
  populateSelect(mapEl2,   uniqueValues(mapWinRates, 'map_name'));
  populateSelect(tournEl2, uniqueValues(mapWinRates, 'tournament_sheet'));

  function applyHero() {
    let rows = filterRows(heroByMap, {
      map_name:  mapEl1.value,
      role:      roleEl.value,
      hero_name: searchEl.value,
    });
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('map-table-wrap', rows, [
      { key: 'map_name',   label: 'Map',       sortType: 'str' },
      { key: 'hero_name',  label: 'Hero',      sortType: 'str' },
      { key: 'role',       label: 'Role',      sortType: 'str', render: v => roleBadge(v) },
      { key: 'pick_count', label: 'Picks',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'pick_rate',  label: 'Pick Rate', sortType: 'num', render: v => rateBarHtml(v, 'pr') },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  function applyWR() {
    let rows = filterRows(mapWinRates, {
      map_name:         mapEl2.value,
      tournament_sheet: tournEl2.value,
      team_name:        searchEl2.value,
    });
    const limit = parseInt(limitEl2.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('mapwr-table-wrap', rows, [
      { key: 'tournament_sheet', label: 'Tournament', sortType: 'str' },
      { key: 'team_name',        label: 'Team',       sortType: 'str' },
      { key: 'map_name',         label: 'Map',        sortType: 'str' },
      { key: 'matches_played',   label: 'Played',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'wins',             label: 'Wins',       sortType: 'num', render: v => fmtNum(v) },
      { key: 'losses',           label: 'Losses',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'win_rate',         label: 'Win Rate',   sortType: 'num', render: v => rateBarHtml(v, 'wr') },
    ], { defaultSort: 'win_rate', defaultDir: 'desc' });
  }

  [mapEl1, roleEl, limitEl].forEach(el => el.addEventListener('change', applyHero));
  searchEl.addEventListener('input', applyHero);
  [mapEl2, tournEl2, limitEl2].forEach(el => el.addEventListener('change', applyWR));
  searchEl2.addEventListener('input', applyWR);

  applyHero();
  applyWR();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: MATCH FORMAT
// ─────────────────────────────────────────────────────────────
async function loadFormat() {
  const data = await loadCSV('data/hero_usage_by_match_format.csv');

  const fmtEl    = document.getElementById('fmt-filter');
  const tournEl  = document.getElementById('fmt-tourn');
  const searchEl = document.getElementById('fmt-search');
  const limitEl  = document.getElementById('fmt-limit');

  populateSelect(fmtEl,   uniqueValues(data, 'match_format'));
  populateSelect(tournEl, uniqueValues(data, 'tournament_sheet'));

  function apply() {
    let rows = filterRows(data, {
      match_format:     fmtEl.value,
      tournament_sheet: tournEl.value,
      hero_name:        searchEl.value,
    });
    const top15 = getTopN(rows, 'pick_count', 15);
    renderBarChart('chart-fmt',
      top15.map(r => r.hero_name),
      top15.map(r => r.pick_count),
      { label: 'Picks', horizontal: true }
    );
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('fmt-table-wrap', rows, [
      { key: 'tournament_sheet', label: 'Tournament', sortType: 'str' },
      { key: 'match_format',     label: 'Format',     sortType: 'str' },
      { key: 'hero_name',        label: 'Hero',       sortType: 'str' },
      { key: 'pick_count',       label: 'Picks',      sortType: 'num', render: v => fmtNum(v) },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  [fmtEl, tournEl, limitEl].forEach(el => el.addEventListener('change', apply));
  searchEl.addEventListener('input', apply);
  apply();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: TEAM
// ─────────────────────────────────────────────────────────────
async function loadTeam() {
  const [heroByTeam, teamWR] = await Promise.all([
    loadCSV('data/hero_usage_by_team.csv'),
    loadCSV('data/team_hero_win_rate.csv'),
  ]);

  const teamEl1   = document.getElementById('team-filter');
  const roleEl    = document.getElementById('team-role');
  const searchEl  = document.getElementById('team-search');
  const limitEl   = document.getElementById('team-limit');
  const teamEl2   = document.getElementById('teamwr-filter');
  const searchEl2 = document.getElementById('teamwr-search');
  const limitEl2  = document.getElementById('teamwr-limit');

  populateSelect(teamEl1, uniqueValues(heroByTeam, 'team_name'));
  populateSelect(teamEl2, uniqueValues(teamWR,     'team_name'));

  function applyPicks() {
    let rows = filterRows(heroByTeam, {
      team_name: teamEl1.value,
      role:      roleEl.value,
      hero_name: searchEl.value,
    });
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('team-table-wrap', rows, [
      { key: 'team_name',  label: 'Team',      sortType: 'str' },
      { key: 'hero_name',  label: 'Hero',      sortType: 'str' },
      { key: 'role',       label: 'Role',      sortType: 'str', render: v => roleBadge(v) },
      { key: 'pick_count', label: 'Picks',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'pick_rate',  label: 'Pick Rate', sortType: 'num', render: v => rateBarHtml(v, 'pr') },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  function applyWR() {
    let rows = filterRows(teamWR, {
      team_name: teamEl2.value,
      hero_name: searchEl2.value,
    });
    const limit = parseInt(limitEl2.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('teamwr-table-wrap', rows, [
      { key: 'team_name',      label: 'Team',     sortType: 'str' },
      { key: 'hero_name',      label: 'Hero',     sortType: 'str' },
      { key: 'matches_played', label: 'Played',   sortType: 'num', render: v => fmtNum(v) },
      { key: 'wins',           label: 'Wins',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'losses',         label: 'Losses',   sortType: 'num', render: v => fmtNum(v) },
      { key: 'win_rate',       label: 'Win Rate', sortType: 'num', render: v => rateBarHtml(v, 'wr') },
    ], { defaultSort: 'win_rate', defaultDir: 'desc' });
  }

  [teamEl1, roleEl, limitEl].forEach(el => el.addEventListener('change', applyPicks));
  searchEl.addEventListener('input', applyPicks);
  [teamEl2, limitEl2].forEach(el => el.addEventListener('change', applyWR));
  searchEl2.addEventListener('input', applyWR);

  applyPicks();
  applyWR();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: PLAYER
// ─────────────────────────────────────────────────────────────
async function loadPlayer() {
  const [heroByPlayer, playerWR] = await Promise.all([
    loadCSV('data/hero_usage_by_player.csv'),
    loadCSV('data/player_hero_win_rate.csv'),
  ]);

  const searchEl1 = document.getElementById('player-search');
  const teamEl    = document.getElementById('player-team');
  const limitEl   = document.getElementById('player-limit');
  const searchEl2 = document.getElementById('playerwr-search');
  const limitEl2  = document.getElementById('playerwr-limit');

  populateSelect(teamEl, uniqueValues(heroByPlayer, 'team_name'));

  function applyPicks() {
    // player-search can match player_name or hero_name
    const q     = searchEl1.value.toLowerCase();
    const team  = teamEl.value;
    let rows = heroByPlayer.filter(r => {
      if (team && (r.team_name ?? '') !== team) return false;
      if (q) {
        const pn = (r.player_name ?? '').toLowerCase();
        const hn = (r.hero_name   ?? '').toLowerCase();
        if (!pn.includes(q) && !hn.includes(q)) return false;
      }
      return true;
    });
    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('player-table-wrap', rows, [
      { key: 'player_name', label: 'Player',      sortType: 'str' },
      { key: 'team_name',   label: 'Team',        sortType: 'str', class: 'td-mute' },
      { key: 'hero_name',   label: 'Hero',        sortType: 'str' },
      { key: 'pick_count',  label: 'Picks',       sortType: 'num', render: v => fmtNum(v) },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  const LOW = 10;
  function applyWR() {
    const q = searchEl2.value.toLowerCase();
    let rows = playerWR.filter(r => {
      if (!q) return true;
      const pn = (r.player_name ?? '').toLowerCase();
      const hn = (r.hero_name   ?? '').toLowerCase();
      return pn.includes(q) || hn.includes(q);
    });
    const limit = parseInt(limitEl2.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('playerwr-table-wrap', rows, [
      { key: 'player_name',    label: 'Player',   sortType: 'str' },
      { key: 'hero_name',      label: 'Hero',     sortType: 'str' },
      { key: 'matches_played', label: 'Played',   sortType: 'num', render: v => fmtNum(v) },
      { key: 'wins',           label: 'Wins',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'losses',         label: 'Losses',   sortType: 'num', render: v => fmtNum(v) },
      {
        key: 'win_rate', label: 'Win Rate', sortType: 'num',
        render: (v, row) => {
          const bar  = rateBarHtml(v, 'wr');
          const warn = row.matches_played < LOW
            ? '<span class="warn-icon" title="Low sample size (&lt;10 map sets)">⚠</span>' : '';
          return bar + warn;
        },
      },
    ], { defaultSort: 'win_rate', defaultDir: 'desc' });
  }

  [teamEl, limitEl].forEach(el => el.addEventListener('change', applyPicks));
  searchEl1.addEventListener('input', applyPicks);
  limitEl2.addEventListener('change', applyWR);
  searchEl2.addEventListener('input', applyWR);

  applyPicks();
  applyWR();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: WIN RATE
// ─────────────────────────────────────────────────────────────
async function loadWinRate() {
  const [data, rolesData] = await Promise.all([
    loadCSV('data/hero_win_rate.csv'),
    loadCSV('data/hero_roles.csv').catch(() => []),
  ]);

  const roleMap = {};
  for (const r of rolesData) if (r.hero_name && r.role) roleMap[r.hero_name] = r.role;
  const augmented = data.map(r => ({ ...r, role: roleMap[r.hero_name] ?? 'Unknown' }));

  const searchEl = document.getElementById('gwr-search');
  const limitEl  = document.getElementById('gwr-limit');

  function apply() {
    const q = searchEl.value.toLowerCase();
    let rows = q
      ? augmented.filter(r => (r.hero_name ?? '').toLowerCase().includes(q))
      : [...augmented];

    // chart: top 15 by win rate, min 10 played
    const chartRows = getTopN(rows.filter(r => r.matches_played >= 10), 'win_rate', 15);
    renderBarChart('chart-gwr',
      chartRows.map(r => r.hero_name),
      chartRows.map(r => r.win_rate),
      {
        label: 'Win Rate', pct: true, horizontal: true,
        color: chartRows.map(r => r.win_rate >= 0.5 ? '#6dd67b' : '#f75d5d'),
      }
    );

    const limit = parseInt(limitEl.value) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    renderTable('gwr-table-wrap', rows, [
      { key: 'hero_name',      label: 'Hero',     sortType: 'str' },
      { key: 'role',           label: 'Role',     sortType: 'str', render: v => roleBadge(v) },
      { key: 'matches_played', label: 'Played',   sortType: 'num', render: v => fmtNum(v) },
      { key: 'wins',           label: 'Wins',     sortType: 'num', render: v => fmtNum(v) },
      { key: 'losses',         label: 'Losses',   sortType: 'num', render: v => fmtNum(v) },
      { key: 'win_rate',       label: 'Win Rate', sortType: 'num', render: v => rateBarHtml(v, 'wr') },
    ], { defaultSort: 'win_rate', defaultDir: 'desc' });
  }

  searchEl.addEventListener('input',  apply);
  limitEl.addEventListener('change',  apply);
  apply();
}

// ─────────────────────────────────────────────────────────────
//  PAGE: POSITION
// ─────────────────────────────────────────────────────────────
async function loadPosition() {
  const data = await loadCSV('data/hero_pick_rate_by_position.csv');

  function posChart(position, canvasId, color) {
    const rows = getTopN(data.filter(r => r.position === position), 'pick_count', 10);
    renderBarChart(canvasId,
      rows.map(r => r.hero_name),
      rows.map(r => r.pick_count),
      { label: position, horizontal: true, color }
    );
  }

  posChart('Tank',    'chart-tank', '#4d9ef7');
  posChart('DPS',     'chart-dps',  '#f75d5d');
  posChart('Support', 'chart-supp', '#6dd67b');

  const posEl    = document.getElementById('pos-filter');
  const searchEl = document.getElementById('pos-search');

  function apply() {
    let rows = filterRows(data, {
      position:  posEl.value,
      hero_name: searchEl.value,
    });
    renderTable('pos-table-wrap', rows, [
      { key: 'position',             label: 'Position',    sortType: 'str', render: v => positionBadge(v) },
      { key: 'hero_name',            label: 'Hero',        sortType: 'str' },
      { key: 'pick_count',           label: 'Picks',       sortType: 'num', render: v => fmtNum(v) },
      { key: 'total_position_picks', label: 'Total (pos)', sortType: 'num', class: 'td-mute', render: v => fmtNum(v) },
      { key: 'pick_rate',            label: 'Pick Rate',   sortType: 'num', render: v => rateBarHtml(v, 'pr') },
    ], { defaultSort: 'pick_count', defaultDir: 'desc' });
  }

  [posEl].forEach(el => el.addEventListener('change', apply));
  searchEl.addEventListener('input', apply);
  apply();
}

// ─────────────────────────────────────────────────────────────
//  PAGE LOADERS MAP  (keys match data-page values in nav)
// ─────────────────────────────────────────────────────────────
const PAGE_LOADERS = {
  overview:   () => once('overview',   loadOverview),
  tournament: () => once('tournament', loadTournament),
  map:        () => once('map',        loadMap),
  format:     () => once('format',     loadFormat),
  team:       () => once('team',       loadTeam),
  player:     () => once('player',     loadPlayer),
  winrate:    () => once('winrate',    loadWinRate),
  position:   () => once('position',   loadPosition),
  notes:      () => {},
};

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initNav);
