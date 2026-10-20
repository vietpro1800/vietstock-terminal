// Trang lọc cổ phiếu: tải nến ngày toàn bộ mã HOSE/HNX/UPCoM (VST.universe), tính chỉ số một lần (VST.scan.metrics),
// rồi lọc tức thì mỗi khi đổi tiêu chí. Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.scan;
  const uni = VST.universe;
  const sectors = uni.sectors;
  const scan = VST.scan;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.scan.v1';
  const CACHE_KEY = 'vst.scan.cache.v2';
  const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const LOAD_TF = { label: 'Ngày', resolution: 'D', days: cfg.days };

  const universe = uni.all;
  const EXCHANGES = [['hose', 'HOSE'], ['hnx', 'HNX'], ['upcom', 'UPCoM']];
  const EX_LABEL = { hose: 'HOSE', hnx: 'HNX', upcom: 'UPCoM' };
  // Phạm vi lọc: '' = tất cả, 'ex:<sàn>' hoặc id ngành.
  const SCOPES = [{ id: '', label: 'Toàn thị trường', test: () => true }]
    .concat(EXCHANGES.map((e) => ({ id: 'ex:' + e[0], label: 'Sàn ' + e[1], count: uni.count[e[0]], test: (r) => r.exchange === e[0] })))
    .concat(sectors.map((s) => ({ id: s.id, label: s.name, count: s.symbols.length, test: (r) => r.sector === s.name })));

  const COLUMNS = [
    { key: 'symbol', label: 'Mã', get: (r) => r.symbol, text: true },
    { key: 'exchange', label: 'Sàn', get: (r) => EX_LABEL[r.exchange], text: true },
    { key: 'sector', label: 'Ngành', get: (r) => r.industry, text: true },
    { key: 'price', label: 'Giá', get: (r) => r.m.price, fmt: (v) => fmtNum(v, 2) },
    { key: 'chg1', label: '% ngày', get: (r) => r.m.chg1, fmt: fmtPct, color: true },
    { key: 'chg20', label: '% 20 phiên', get: (r) => r.m.chg[20], fmt: fmtPct, color: true },
    { key: 'rsi', label: 'RSI', get: (r) => r.m.rsi, fmt: (v) => fmtNum(v, 1) },
    { key: 'volRatio', label: 'KL/TB20', get: (r) => r.m.volRatio, fmt: (v) => fmtNum(v, 2) + '×' },
    { key: 'value20', label: 'GTGD TB20 (tỷ)', get: (r) => r.m.value20, fmt: (v) => fmtNum(v, 1) },
    { key: 'fromHigh52', label: 'Cách đỉnh 52T', get: (r) => r.m.fromHigh52, fmt: fmtPct },
  ];
  const PASSED_COL = { key: 'passed', label: 'Đạt', get: (r) => r.passed };

  const prefs = loadPrefs();
  const state = {
    on: prefs.on && typeof prefs.on === 'object' ? prefs.on : { liquidity: true, aboveMa: true, rsi: true },
    params: {},
    universe: SCOPES.some((s) => s.id === prefs.universe) ? prefs.universe : '',
    miss: [0, 1, 2].indexOf(prefs.miss) >= 0 ? prefs.miss : 0,
    sort: prefs.sort && prefs.sort.key ? prefs.sort : { key: 'value20', dir: -1 },
    rows: null,       // [{ symbol, exchange, sector, industry, m }]
    failed: [],
    loadToken: 0,
  };
  scan.CRITERIA.forEach(function (c) {
    state.params[c.id] = scan.normalize(c.id, prefs.params && prefs.params[c.id]);
  });

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'scan');
  buildControls();
  render();
  if (!restoreCache()) load();

  // ---------- Điều khiển ----------

  function buildControls() {
    $('scan-presets').innerHTML = scan.PRESETS.map((p) =>
      '<button type="button" class="chip" data-preset="' + p.id + '">' + esc(p.label) + '</button>').join('');
    $('scan-presets').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-preset]');
      if (b) applyPreset(b.dataset.preset);
    });

    const opt = (s) => '<option value="' + esc(s.id) + '">' + esc(s.label) + ' (' + (s.count || universe.length) + ' mã)</option>';
    $('scan-universe').innerHTML = opt(SCOPES[0]) +
      '<optgroup label="Theo sàn">' + SCOPES.filter((s) => s.id.indexOf('ex:') === 0).map(opt).join('') + '</optgroup>' +
      '<optgroup label="Theo ngành">' + SCOPES.slice(1 + EXCHANGES.length).map(opt).join('') + '</optgroup>';
    $('scan-universe').value = state.universe;
    $('scan-universe').addEventListener('change', function () { state.universe = this.value; changed(); });

    buildCriteria();
    const box = $('scan-criteria');
    box.addEventListener('change', onCriteriaInput);
    box.addEventListener('input', onCriteriaInput);

    $('scan-miss').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.miss = Number(b.dataset.v);
      changed();
    });

    $('scan-head').addEventListener('click', function (e) {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      const textCol = key === 'symbol' || key === 'sector' || key === 'exchange';
      state.sort = state.sort.key === key ? { key: key, dir: -state.sort.dir } : { key: key, dir: textCol ? 1 : -1 };
      changed();
    });
    $('scan-list').addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr[data-symbol]');
      if (tr) location.href = chartUrl(tr.dataset.symbol);
    });

    $('scan-reset').addEventListener('click', function () { state.on = {}; syncCriteria(); changed(); });
    $('scan-reload').addEventListener('click', load);
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
  }

  function buildCriteria() {
    $('scan-criteria').innerHTML = scan.CRITERIA.map(function (c) {
      const fields = c.params.map(function (p) {
        const id = 'sc-' + c.id + '-' + p.key;
        const ctrl = p.type === 'select'
          ? '<select id="' + id + '" class="input" data-crit="' + c.id + '" data-key="' + p.key + '">' +
              p.options.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select>'
          : '<input id="' + id + '" class="input" type="number" inputmode="decimal" step="' + p.step + '" data-crit="' + c.id +
              '" data-key="' + p.key + '" placeholder="Không giới hạn">';
        const showIf = p.showIf ? ' data-show-if="' + esc(JSON.stringify(p.showIf)) + '"' : '';
        return '<label class="form-field"' + showIf + '><span>' + esc(p.label) + '</span>' + ctrl + '</label>';
      }).join('');
      return '<div class="scan-crit" data-id="' + c.id + '">' +
        '<label class="scan-crit-head"><input type="checkbox" data-on="' + c.id + '">' +
          '<span class="scan-crit-name">' + esc(c.label) + '</span><span class="scan-count" data-count="' + c.id + '"></span></label>' +
        '<div class="scan-crit-body"><p class="form-hint">' + esc(c.hint) + '</p><div class="scan-params">' + fields + '</div></div>' +
      '</div>';
    }).join('');
    syncCriteria();
  }

  // Đưa trạng thái (bật/tắt, tham số) lên các ô nhập.
  function syncCriteria() {
    scan.CRITERIA.forEach(function (c) {
      const card = $('scan-criteria').querySelector('.scan-crit[data-id="' + c.id + '"]');
      card.querySelector('[data-on]').checked = !!state.on[c.id];
      card.classList.toggle('on', !!state.on[c.id]);
      c.params.forEach(function (p) {
        const el = $('sc-' + c.id + '-' + p.key);
        const v = state.params[c.id][p.key];
        el.value = v == null ? '' : String(v);
      });
      updateShowIf(card, c.id);
    });
  }

  function updateShowIf(card, id) {
    card.querySelectorAll('[data-show-if]').forEach(function (f) {
      const cond = JSON.parse(f.dataset.showIf);
      f.hidden = Object.keys(cond).some((k) => String(state.params[id][k]) !== String(cond[k]));
    });
  }

  function onCriteriaInput(e) {
    const t = e.target;
    if (t.dataset.on) {
      if (e.type !== 'change') return;
      state.on[t.dataset.on] = t.checked;
      t.closest('.scan-crit').classList.toggle('on', t.checked);
    } else if (t.dataset.crit) {
      const id = t.dataset.crit;
      const raw = Object.assign({}, state.params[id]);
      raw[t.dataset.key] = t.value;
      state.params[id] = scan.normalize(id, raw);
      updateShowIf(t.closest('.scan-crit'), id);
    } else {
      return;
    }
    changed();
  }

  function applyPreset(id) {
    const ps = scan.PRESETS.find((p) => p.id === id);
    if (!ps) return;
    state.on = {};
    Object.keys(ps.filters).forEach(function (cid) {
      state.on[cid] = true;
      state.params[cid] = scan.normalize(cid, Object.assign(scan.defaults(cid), ps.filters[cid]));
    });
    syncCriteria();
    changed();
  }

  function changed() {
    savePrefs();
    render();
  }

  // ---------- Dữ liệu ----------

  async function load() {
    const token = ++state.loadToken;
    $('scan-reload').disabled = true;
    progress(0, universe.length);
    $('scan-loading').hidden = false;
    try {
      const res = await source.getHistoryBatch(universe, LOAD_TF, function (done, total) {
        if (token === state.loadToken) progress(done, total);
      });
      if (token !== state.loadToken) return;
      const rows = [];
      const failed = [];
      universe.forEach(function (sym) {
        const m = res[sym].bars ? scan.metrics(res[sym].bars) : null;
        const info = uni.info[sym];
        if (m) rows.push({ symbol: sym, exchange: info.exchange, sector: info.sector, industry: info.industry, m: m });
        else failed.push(sym);
      });
      state.rows = rows;
      state.failed = failed;
      if (!rows.length) {
        const err = (res[universe[0]] || {}).error;
        showNotice('Không tải được dữ liệu các mã. ' + messageOf(err));
      } else {
        if (failed.length) showNotice('Không tải được hoặc thiếu dữ liệu ' + failed.length + ' mã (đã bỏ qua' +
          (failed.length > 3 ? ', thường là mã mới niêm yết hoặc tạm ngừng giao dịch' : '') + '): ' +
          failed.slice(0, 40).join(', ') + (failed.length > 40 ? ', …' : '.'));
        else $('notice').hidden = true;
        saveCache();
      }
      render();
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice(messageOf(err));
    } finally {
      if (token === state.loadToken) {
        $('scan-loading').hidden = true;
        $('scan-reload').disabled = false;
      }
    }
  }

  function progress(done, total) {
    $('scan-progress-text').textContent = 'Đang tải dữ liệu ' + done + '/' + total + ' mã…';
    $('scan-progress-bar').style.width = (total ? (100 * done) / total : 0) + '%';
  }

  // Kết quả tính được giữ trong sessionStorage vài phút: quay lại trang không phải tải lại ~1500 mã.
  function restoreCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      if (!c || !Array.isArray(c.rows) || Date.now() - c.at > cfg.cacheMinutes * 60000) return false;
      state.rows = c.rows.filter((r) => uni.info[r.symbol] && r.exchange);
      state.failed = c.failed || [];
      state.cachedAt = c.at;
      $('scan-loading').hidden = true;
      render();
      return state.rows.length > 0;
    } catch (e) {
      return false;
    }
  }

  function saveCache() {
    state.cachedAt = Date.now();
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: state.cachedAt, rows: state.rows, failed: state.failed }));
    } catch (e) { /* bỏ qua: bị chặn lưu trữ */ }
  }

  // ---------- Hiển thị ----------

  function activeFilters() {
    const f = {};
    scan.CRITERIA.forEach(function (c) { if (state.on[c.id]) f[c.id] = state.params[c.id]; });
    return f;
  }

  function render() {
    $('scan-miss').querySelectorAll('button').forEach(function (b) {
      const on = Number(b.dataset.v) === state.miss;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    const filters = activeFilters();
    const nActive = Object.keys(filters).length;
    const cols = state.miss > 0 && nActive ? COLUMNS.concat([PASSED_COL]) : COLUMNS;
    renderHead(cols);
    if (!state.rows) return;

    const scope = SCOPES.find((s) => s.id === state.universe) || SCOPES[0];
    const pool = state.rows.filter(scope.test);
    const miss = Math.min(state.miss, Math.max(0, nActive - 1));
    const matches = scan.run(pool, filters, miss);

    // Số mã đạt riêng từng tiêu chí (trong phạm vi đang xem): giúp biết tiêu chí nào đang quá chặt.
    scan.CRITERIA.forEach(function (c) {
      const n = scan.run(pool, { [c.id]: state.params[c.id] }).length;
      const el = $('scan-criteria').querySelector('[data-count="' + c.id + '"]');
      el.textContent = n + ' mã';
    });

    sortRows(matches, cols);
    renderSummary(matches.length, pool.length, nActive, miss);
    renderList(matches, cols, nActive);
  }

  function renderHead(cols) {
    $('scan-head').innerHTML = '<tr>' + cols.map(function (c) {
      const on = state.sort.key === c.key;
      const arrow = on ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th class="' + (c.text ? '' : 'num') + (c.key === 'sector' || c.key === 'exchange' ? ' scan-sector' : '') + (on ? ' sorted' : '') + '" data-sort="' + c.key + '" aria-sort="' +
        (on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button">' + esc(c.label) + arrow + '</button></th>';
    }).join('') + '</tr>';
  }

  function sortRows(rows, cols) {
    const col = cols.find((c) => c.key === state.sort.key) || COLUMNS.find((c) => c.key === 'value20');
    const dir = col.key === state.sort.key ? state.sort.dir : -1;
    rows.sort(function (a, b) {
      if (state.miss > 0 && col.key !== 'passed' && a.passed !== b.passed) return b.passed - a.passed;
      const x = col.get(a), y = col.get(b);
      if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
      if (col.text) return dir * String(x).localeCompare(String(y), 'vi');
      return dir * (x - y);
    });
  }

  function renderSummary(nMatch, nPool, nActive, miss) {
    const last = state.rows.reduce((t, r) => Math.max(t, r.m.time), 0);
    const parts = [
      '<b>' + nMatch + '</b>/' + nPool + ' mã đạt',
      nActive ? nActive + ' tiêu chí' + (miss ? ' (cho thiếu ' + miss + ')' : '') : 'chưa bật tiêu chí nào',
      last ? 'dữ liệu đến ' + fmtDate(last) : '',
      state.cachedAt ? 'tải lúc ' + fmtClock(state.cachedAt) : '',
    ];
    $('scan-summary').innerHTML = parts.filter(Boolean).join(' · ');
  }

  function renderList(rows, cols, nActive) {
    if (!rows.length) {
      $('scan-list').innerHTML = '<tr><td colspan="' + cols.length + '" class="dim center scan-empty">' +
        'Không có mã nào thỏa các tiêu chí. Thử nới lỏng điều kiện hoặc chọn "Thiếu tối đa 1".</td></tr>';
      return;
    }
    $('scan-list').innerHTML = rows.map(function (r) {
      return '<tr data-symbol="' + esc(r.symbol) + '">' + cols.map(function (c) {
        if (c.key === 'symbol') {
          return '<td class="sym"><a href="' + chartUrl(r.symbol) + '" title="Xem biểu đồ ' + esc(r.symbol) + '">' + esc(r.symbol) + '</a></td>';
        }
        if (c.key === 'sector') return '<td class="dim scan-sector" title="' + esc(r.sector) + '">' + esc(r.industry) + '</td>';
        if (c.key === 'exchange') return '<td class="dim scan-sector">' + esc(EX_LABEL[r.exchange]) + '</td>';
        if (c.key === 'passed') {
          const names = r.failed.map((id) => scan.criterion(id).label).join(', ');
          return '<td class="num' + (r.failed.length ? ' ref' : ' up') + '"' + (names ? ' title="Chưa đạt: ' + esc(names) + '"' : '') + '>' +
            r.passed + '/' + nActive + '</td>';
        }
        const v = c.get(r);
        const cls = c.color && v != null ? (v > 0 ? ' up' : v < 0 ? ' down' : ' ref') : '';
        return '<td class="num' + cls + '">' + (v == null ? '–' : c.fmt(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
  }

  // ---------- Tiện ích ----------

  function chartUrl(sym) { return SYMBOL_RE.test(sym) ? 'index.html?symbol=' + encodeURIComponent(sym) : 'index.html'; }

  function fmtNum(v, d) { return v.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtPct(v) { return (v > 0 ? '+' : '') + fmtNum(v, 2) + '%'; }
  function fmtDate(t) {
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fmtClock(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function messageOf(err) {
    return err && err.name === 'DataError' ? err.message : 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        on: state.on, params: state.params, universe: state.universe, miss: state.miss, sort: state.sort,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
