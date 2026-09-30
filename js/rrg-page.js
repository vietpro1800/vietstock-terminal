// Trang RRG: sức mạnh tương đối của các ngành và các mã trong từng ngành so với VN-Index.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.rrg;
  const rrg = VST.rrg;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.rrg.v1';
  const Q_ORDER = { leading: 0, improving: 1, weakening: 2, lagging: 3 };
  const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const LOAD_TF = { label: 'Ngày', resolution: 'D', days: cfg.days };

  const prefs = loadPrefs();
  const state = {
    tf: cfg.timeframes[prefs.tf] ? prefs.tf : 'D',
    tail: cfg.tails.indexOf(prefs.tail) >= 0 ? prefs.tail : cfg.defaultTail,
    bench: prefs.bench === 'sector' ? 'sector' : 'index',
    sector: null,       // null = xem tất cả ngành
    hidden: {},         // { [khóa màn hình]: Set id bị ẩn }
    benchBars: null,
    bars: {},           // { [mã]: nến ngày }
    loadToken: 0,
    items: [],
  };

  const chart = new VST.RrgChart($('rrg-chart'), { onSelect: onSelect, fmtTip: fmtTip });

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'rrg');
  buildControls();
  readHash();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  load();

  // ---------- Điều khiển ----------

  function buildControls() {
    $('rrg-view').innerHTML = '<option value="">Tất cả ngành</option>' + cfg.sectors.map((s) =>
      '<option value="' + s.id + '">' + esc(s.name) + ' (' + s.symbols.length + ' mã)</option>').join('');
    $('rrg-view').addEventListener('change', function () { go(this.value || null); });
    $('rrg-back').addEventListener('click', function () { go(null); });

    $('rrg-tf').innerHTML = Object.keys(cfg.timeframes).map((k) =>
      '<button type="button" data-v="' + k + '">' + cfg.timeframes[k].label + '</button>').join('');
    $('rrg-tail').innerHTML = cfg.tails.map((n) => '<button type="button" data-v="' + n + '">' + n + '</button>').join('');
    segHandler('rrg-tf', function (v) { state.tf = v; });
    segHandler('rrg-tail', function (v) { state.tail = Number(v); });
    $('rrg-bench').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-bench]');
      if (!b) return;
      state.bench = b.dataset.bench;
      savePrefs();
      render();
    });

    $('rrg-reload').addEventListener('click', load);
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });

    $('rrg-list').addEventListener('change', function (e) {
      const cb = e.target.closest('input[data-toggle]');
      if (!cb) return;
      const set = hiddenSet();
      if (cb.checked) set.delete(cb.dataset.toggle); else set.add(cb.dataset.toggle);
      renderChart(true);
    });
    $('rrg-list').addEventListener('click', function (e) {
      if (e.target.closest('input, a, label')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) onSelect(tr.dataset.id);
    });
  }

  function segHandler(id, apply) {
    $(id).addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      apply(b.dataset.v);
      savePrefs();
      render();
    });
  }

  function markSeg(id, value) {
    $(id).querySelectorAll('button').forEach(function (b) {
      const on = (b.dataset.v || b.dataset.bench) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  // Điều hướng bằng #mã-ngành để nút Quay lại của trình duyệt/điện thoại hoạt động.
  function go(sectorId) {
    if (sectorId) {
      // Đổi hash sẽ phát sự kiện hashchange → readHash() + render().
      if (location.hash !== '#' + sectorId) { location.hash = sectorId; return; }
    } else if (location.hash) {
      history.pushState(null, '', location.pathname + location.search);
    }
    readHash();
    render();
  }

  function readHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    state.sector = cfg.sectors.find((s) => s.id === id) || null;
    chart.setPinned(null);
  }

  function onSelect(id) {
    if (!state.sector) { go(id); return; }
    chart.setPinned(chart.pinned === id ? null : id);
    markPinnedRow();
  }

  function hiddenSet() {
    const key = state.sector ? state.sector.id : '_all';
    return state.hidden[key] || (state.hidden[key] = new Set());
  }

  // ---------- Dữ liệu ----------

  async function load() {
    const token = ++state.loadToken;
    const symbols = [];
    cfg.sectors.forEach((s) => s.symbols.forEach((sym) => { if (symbols.indexOf(sym) < 0) symbols.push(sym); }));
    $('rrg-reload').disabled = true;
    progress(0, symbols.length);
    $('rrg-loading').hidden = false;
    try {
      const benchBars = await source.getHistory(cfg.benchmark, LOAD_TF);
      if (token !== state.loadToken) return;
      const res = await source.getHistoryBatch(symbols, LOAD_TF, function (done, total) {
        if (token === state.loadToken) progress(done, total);
      });
      if (token !== state.loadToken) return;
      state.benchBars = benchBars;
      state.bars = {};
      const failed = [];
      symbols.forEach(function (sym) {
        if (res[sym].bars) state.bars[sym] = res[sym].bars; else failed.push(sym);
      });
      if (failed.length === symbols.length) {
        showNotice('Không tải được dữ liệu các mã. ' + messageOf(res[symbols[0]].error));
      } else if (failed.length) {
        showNotice('Không tải được ' + failed.length + ' mã (đã bỏ qua): ' + failed.join(', ') + '.');
      } else {
        $('notice').hidden = true;
      }
      render();
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice('Không tải được VN-Index nên chưa tính được RRG. ' + messageOf(err));
      $('rrg-summary').textContent = 'Chưa có dữ liệu.';
    } finally {
      if (token === state.loadToken) {
        $('rrg-loading').hidden = true;
        $('rrg-reload').disabled = false;
      }
    }
  }

  function progress(done, total) {
    $('rrg-progress-text').textContent = 'Đang tải dữ liệu ' + done + '/' + total + ' mã…';
    $('rrg-progress-bar').style.width = (total ? (100 * done) / total : 0) + '%';
  }

  // ---------- Tính toán ----------

  function computeItems() {
    const params = cfg.timeframes[state.tf];
    const benchC = rrg.toCloses(state.benchBars, state.tf);
    const run = function (series, bench) { return rrg.summarize(rrg.compute(series, bench, params), state.tail); };
    const members = (s) => s.symbols.filter((sym) => state.bars[sym]);

    if (!state.sector) {
      return cfg.sectors.map(function (s) {
        const ok = members(s);
        const base = { id: s.id, name: s.name, count: ok.length, total: s.symbols.length };
        if (!ok.length) return Object.assign(base, { summary: null });
        const idx = rrg.sectorIndex(ok.map((sym) => state.bars[sym]), state.benchBars);
        return Object.assign(base, { summary: run(rrg.toCloses(idx, state.tf), benchC) });
      });
    }

    const s = state.sector;
    const ok = members(s);
    let bench = benchC;
    if (state.bench === 'sector' && ok.length) {
      bench = rrg.toCloses(rrg.sectorIndex(ok.map((sym) => state.bars[sym]), state.benchBars), state.tf);
    }
    return s.symbols.map(function (sym) {
      const bars = state.bars[sym];
      return { id: sym, name: sym, failed: !bars, summary: bars ? run(rrg.toCloses(bars, state.tf), bench) : null };
    });
  }

  // ---------- Hiển thị ----------

  function render() {
    const s = state.sector;
    markSeg('rrg-tf', state.tf);
    markSeg('rrg-tail', state.tail);
    markSeg('rrg-bench', state.bench);
    $('rrg-view').value = s ? s.id : '';
    $('rrg-back').hidden = !s;
    $('rrg-bench-field').hidden = !s;
    $('rrg-title').textContent = s ? 'Ngành ' + s.name : 'Sức mạnh tương đối các ngành';
    $('rrg-list-title').textContent = s ? 'Các mã trong ngành' : 'Bảng xếp hạng ngành';
    $('rrg-col-name').textContent = s ? 'Mã' : 'Ngành';
    $('rrg-col-change').textContent = '% ' + state.tail + ' kỳ';
    document.title = (s ? s.name + ' · ' : '') + 'RRG ngành · ThảoChi Stock';
    if (!state.benchBars) return;

    state.items = computeItems();
    renderSummary();
    renderList();
    renderChart(false);
  }

  function renderSummary() {
    const s = state.sector;
    const valid = state.items.filter((it) => it.summary);
    const count = { leading: 0, weakening: 0, lagging: 0, improving: 0 };
    valid.forEach((it) => { count[it.summary.quadrant]++; });
    const last = valid.reduce((t, it) => Math.max(t, it.summary.time), 0);
    const benchName = s && state.bench === 'sector' ? 'chỉ số ngành' : 'VN-Index';
    $('rrg-summary').innerHTML = [
      'Khung ' + cfg.timeframes[state.tf].label.toLowerCase(),
      valid.length + (s ? ' mã' : ' ngành'),
      'đuôi ' + state.tail + ' kỳ',
      'so với ' + benchName,
      '<span class="q-leading">Dẫn dắt ' + count.leading + '</span>',
      '<span class="q-weakening">Suy yếu ' + count.weakening + '</span>',
      '<span class="q-lagging">Tụt hậu ' + count.lagging + '</span>',
      '<span class="q-improving">Cải thiện ' + count.improving + '</span>',
      last ? 'dữ liệu đến ' + fmtDate(last) : '',
    ].filter(Boolean).join(' · ');
  }

  function renderChart(keepView) {
    const hidden = hiddenSet();
    const visible = state.items.filter((it) => it.summary && !hidden.has(it.id)).map((it) => ({
      id: it.id, name: it.name, points: it.summary.points, quadrant: it.summary.quadrant, item: it,
    }));
    chart.setData(visible, keepView);
  }

  function renderList() {
    const s = state.sector;
    const hidden = hiddenSet();
    const rows = state.items.slice().sort(function (a, b) {
      if (!a.summary || !b.summary) return (a.summary ? 0 : 1) - (b.summary ? 0 : 1);
      return Q_ORDER[a.summary.quadrant] - Q_ORDER[b.summary.quadrant] || b.summary.ratio - a.summary.ratio;
    });
    $('rrg-list').innerHTML = rows.map(function (it) {
      const m = it.summary;
      const name = s
        ? '<b>' + esc(it.name) + '</b>'
        : '<b>' + esc(it.name) + '</b> <span class="dim small">' + it.count + (it.count < it.total ? '/' + it.total : '') + ' mã</span>';
      const link = s && SYMBOL_RE.test(it.id)
        ? '<a class="rrg-open" href="index.html?symbol=' + encodeURIComponent(it.id) + '" title="Xem biểu đồ ' + esc(it.id) + '">Biểu đồ</a>'
        : (!s ? '<span class="rrg-open dim" aria-hidden="true">›</span>' : '');
      if (!m) {
        return '<tr data-id="' + esc(it.id) + '"><td></td><td>' + name + '</td><td colspan="4" class="dim">' +
          (it.failed ? 'Lỗi tải dữ liệu' : 'Chưa đủ dữ liệu') + '</td><td>' + link + '</td></tr>';
      }
      const chg = m.change;
      return '<tr data-id="' + esc(it.id) + '">' +
        '<td><label class="rrg-check"><input type="checkbox" data-toggle="' + esc(it.id) + '"' + (hidden.has(it.id) ? '' : ' checked') +
          ' aria-label="Hiện ' + esc(it.name) + ' trên biểu đồ"></label></td>' +
        '<td>' + name + '</td>' +
        '<td><span class="q-' + m.quadrant + '">' + rrg.QUADRANTS[m.quadrant] + '</span></td>' +
        '<td class="num">' + fmtNum(m.ratio) + '</td>' +
        '<td class="num">' + fmtNum(m.momentum) + '</td>' +
        '<td class="num ' + (chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref') + '">' + (chg > 0 ? '+' : '') + fmtNum(chg * 100) + '%</td>' +
        '<td>' + link + '</td></tr>';
    }).join('');
    markPinnedRow();
  }

  function markPinnedRow() {
    $('rrg-list').querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.classList.toggle('active', tr.dataset.id === chart.pinned);
    });
  }

  function fmtTip(v) {
    const it = v.item, m = it.summary;
    const chg = m.change;
    return '<b>' + esc(it.name) + '</b> · <span class="q-' + m.quadrant + '">' + rrg.QUADRANTS[m.quadrant] + '</span><br>' +
      'RS-Ratio <b>' + fmtNum(m.ratio) + '</b> · RS-Momentum <b>' + fmtNum(m.momentum) + '</b><br>' +
      (state.sector ? 'Giá' : 'Chỉ số ngành') + ' ' + state.tail + ' kỳ: <b class="' + (chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref') + '">' +
      (chg > 0 ? '+' : '') + fmtNum(chg * 100) + '%</b> · ' + fmtDate(m.time) +
      (state.sector ? '' : '<br><span class="dim">Nhấn để xem các mã trong ngành</span>');
  }

  // ---------- Tiện ích ----------

  function fmtNum(v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(t) {
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
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
      localStorage.setItem(STORE_KEY, JSON.stringify({ tf: state.tf, tail: state.tail, bench: state.bench }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
