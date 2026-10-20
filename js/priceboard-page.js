// Trang bảng giá (priceboard.html): biểu đồ chỉ số trong ngày ở đầu trang, bảng giá theo nhóm
// (Danh mục của tôi, VN30, HNX30, ngành). Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.priceboard;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.priceboard.v1';
  const SYMBOL_RE = /^[A-Z0-9]{3,10}$/;
  const VN_OFFSET = 7 * 3600;
  const DAILY_TF = { label: 'Ngày', resolution: 'D', days: 15 };
  const INTRADAY_TF = { label: '5 phút', resolution: '5', days: 7, intraday: true };
  const INTRADAY_FALLBACK = { label: '15 phút', resolution: '15', days: 7, intraday: true };
  const RT_TEXT = { connecting: 'Đang kết nối realtime…', open: 'Realtime', closed: 'Mất kết nối realtime, đang thử lại…' };

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const feed = new VST.SsiBoardFeed();

  // Nhóm: danh mục của tôi, các rổ chỉ số, rồi các ngành (cùng danh sách với trang RRG / Lọc mã).
  const groups = [{ id: 'mine', name: 'Danh mục của tôi' }]
    .concat(cfg.groups)
    .concat(VST.config.priceboard.sectors.map((s) => ({ id: 'sec-' + s.id, name: s.name, symbols: s.symbols, sector: true })));
  const groupById = {};
  groups.forEach((g) => { groupById[g.id] = g; });

  const prefs = loadPrefs();
  const state = {
    group: groupById[prefs.group] ? prefs.group : cfg.defaultGroup,
    compact: typeof prefs.compact === 'boolean' ? prefs.compact : window.innerWidth < 768,
    watchlist: Array.isArray(prefs.watchlist) ? prefs.watchlist.filter((s) => SYMBOL_RE.test(s)) : cfg.defaultWatchlist.slice(),
    loadToken: 0,
    refreshing: false,
    lastRefresh: 0,
    rt: 'connecting',
  };

  const table = new VST.PriceTable($('pb-table'), {
    onOpen: (s) => { VST.nav.open('dashboard.html?symbol=' + encodeURIComponent(s)); },
    onPin: togglePin,
    isPinned: (s) => state.watchlist.indexOf(s) >= 0,
  });
  table.compact = state.compact;

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'priceboard');
  buildIndexCards();
  buildControls();
  showGroup();
  setInterval(tick, cfg.refreshMs);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastRefresh >= cfg.refreshMs) refreshAll();
  });
  window.addEventListener('online', refreshAll);

  // ---------- Điều khiển ----------

  function buildControls() {
    const tabs = groups.filter((g) => !g.sector);
    $('pb-groups').innerHTML = tabs.map((g) =>
      '<button type="button" data-group="' + g.id + '">' + esc(g.name) + '</button>').join('');
    $('pb-groups').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-group]');
      if (b) setGroup(b.dataset.group);
    });

    $('pb-sector').innerHTML = '<option value="">Ngành…</option>' + groups.filter((g) => g.sector).map((g) =>
      '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('');
    $('pb-sector').addEventListener('change', function () { if (this.value) setGroup(this.value); });

    $('pb-view').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-compact]');
      if (!b) return;
      state.compact = b.dataset.compact === '1';
      savePrefs();
      renderView();
      table.setCompact(state.compact);
    });
    renderView();

    $('pb-search').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('pb-search-input');
      const s = input.value.trim().toUpperCase();
      if (!SYMBOL_RE.test(s)) { showNotice('Mã chứng khoán không hợp lệ: "' + input.value.trim() + '".'); return; }
      input.value = '';
      input.blur();
      if (table.hasSymbol(s)) { table.highlight(s); return; }
      // Mã chưa có trong nhóm đang xem: thêm vào danh mục của tôi rồi chuyển sang đó.
      if (state.watchlist.indexOf(s) < 0) state.watchlist.push(s);
      savePrefs();
      if (state.group === 'mine') showGroup(); else setGroup('mine');
      table.highlight(s);
    });
    $('pb-search-list').innerHTML = allSymbols().map((s) => '<option value="' + s + '">').join('');

    $('notice-close').addEventListener('click', hideNotice);
  }

  function setGroup(id) {
    if (!groupById[id] || id === state.group) return;
    state.group = id;
    savePrefs();
    showGroup();
  }

  function renderGroupTabs() {
    $('pb-groups').querySelectorAll('button[data-group]').forEach(function (b) {
      const on = b.dataset.group === state.group;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    const sel = $('pb-sector');
    sel.value = groupById[state.group].sector ? state.group : '';
    sel.classList.toggle('active', !!sel.value);
  }

  function renderView() {
    $('pb-view').querySelectorAll('button[data-compact]').forEach(function (b) {
      const on = (b.dataset.compact === '1') === state.compact;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  function groupSymbols() {
    const g = groupById[state.group];
    return g.id === 'mine' ? state.watchlist.slice() : g.symbols.slice();
  }

  function showGroup() {
    renderGroupTabs();
    const g = groupById[state.group];
    const symbols = groupSymbols();
    table.setSymbols(symbols, g.exchange || 'hose');
    feed.watch(symbols, (q) => table.pushQuote(q), setRealtime);
    if (!symbols.length) setRealtime(state.rt);
    if (state.lastRefresh === 0) refreshAll(); else loadDaily();
  }

  function togglePin(s) {
    const i = state.watchlist.indexOf(s);
    if (i >= 0) state.watchlist.splice(i, 1); else state.watchlist.push(s);
    savePrefs();
    if (state.group === 'mine') showGroup(); else table.refreshPins();
  }

  function allSymbols() {
    const seen = {};
    groups.forEach((g) => (g.symbols || []).forEach((s) => { seen[s] = 1; }));
    return Object.keys(seen).sort();
  }

  // ---------- Dữ liệu ----------

  // Nến ngày cho TC, cao, thấp, KL (và giá khi chưa có realtime).
  async function loadDaily() {
    const token = ++state.loadToken;
    const symbols = groupSymbols();
    if (!symbols.length) return true;
    const res = await source.getHistoryBatch(symbols, DAILY_TF);
    if (token !== state.loadToken) return true; // đã đổi nhóm
    const errors = [];
    symbols.forEach(function (s) {
      const r = res[s];
      if (r.error) errors.push(r.error); else table.setDaily(s, r.bars);
    });
    if (errors.length === symbols.length) {
      showNotice('Không tải được bảng giá. ' + messageOf(errors[0]));
      return false;
    }
    if (errors.length) {
      showNotice('Không tải được ' + errors.length + ' mã: ' + errors.map((e) => e.symbol).join(', ') + '.');
      return 'partial';
    }
    return true;
  }

  async function refreshAll() {
    if (state.refreshing) return;
    state.refreshing = true;
    setStatus('loading', 'Đang cập nhật…');
    const results = await Promise.all([loadDaily(), loadIndices()]);
    state.lastRefresh = Date.now();
    state.refreshing = false;
    const ok = results.every((r) => r !== false);
    if (results.every((r) => r === true)) hideNotice();
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setStatus(ok ? 'ok' : 'error', (ok ? 'Cập nhật ' : 'Lỗi lúc ') + time);
  }

  function tick() {
    if (document.hidden) return; // không gọi API khi tab bị ẩn
    refreshAll();
  }

  // ---------- Chỉ số ----------

  function buildIndexCards() {
    $('pb-indices').innerHTML = cfg.indices.map((ix, i) =>
      '<article class="pb-ix" data-i="' + i + '">' +
        '<div class="pb-ix-chart"><span class="dim">Đang tải…</span></div>' +
        '<div class="pb-ix-info">' +
          '<b class="pb-ix-name">' + esc(ix.name) + '</b>' +
          '<span class="pb-ix-value"></span>' +
          '<span class="pb-ix-chg"></span>' +
          '<span class="pb-ix-vol dim"></span>' +
        '</div>' +
      '</article>').join('');
    $('pb-ix-rows').innerHTML = cfg.indices.map((ix, i) =>
      '<tr data-i="' + i + '"><td>' + esc(ix.name) + '</td><td class="v">—</td><td class="c"></td><td class="p"></td><td class="k"></td></tr>').join('');
  }

  async function loadIndices() {
    const res = await Promise.all(cfg.indices.map(function (ix) {
      return source.getHistory(ix.symbol, INTRADAY_TF)
        .catch(() => source.getHistory(ix.symbol, INTRADAY_FALLBACK))
        .then((bars) => ({ bars: bars }), (err) => ({ error: err }));
    }));
    res.forEach(function (r, i) { renderIndex(i, r); });
    return res.some((r) => r.bars) ? true : 'partial';
  }

  function renderIndex(i, r) {
    const card = $('pb-indices').querySelector('[data-i="' + i + '"]');
    const box = card.querySelector('.pb-ix-chart');
    if (r.error || !r.bars.length) {
      if (!card.classList.contains('has-data')) box.innerHTML = '<span class="dim">Không tải được dữ liệu</span>';
      card.title = r.error ? r.error.message : '';
      return;
    }
    card.title = '';
    card.classList.add('has-data');
    const day = sessionOf(r.bars);
    const last = day.bars[day.bars.length - 1].close;
    const chg = last - day.ref;
    const cls = chg > 0.005 ? 'up' : chg < -0.005 ? 'down' : 'ref';
    const sign = chg > 0.005 ? '+' : '';
    const value = card.querySelector('.pb-ix-value');
    value.textContent = fmt2(last);
    value.className = 'pb-ix-value ' + cls;
    const ch = card.querySelector('.pb-ix-chg');
    ch.textContent = (chg > 0.005 ? '▲ ' : chg < -0.005 ? '▼ ' : '■ ') + sign + fmt2(chg) + ' (' + sign + fmt2(day.ref ? chg / day.ref * 100 : 0) + '%)';
    ch.className = 'pb-ix-chg ' + cls;
    const vol = day.bars.reduce((s, b) => s + b.volume, 0);
    card.querySelector('.pb-ix-vol').textContent = vol ? 'KL ' + fmtVol(vol) + ' CP · ' + day.label : day.label;
    box.innerHTML = sparkSvg(i, day);

    const row = $('pb-ix-rows').querySelector('[data-i="' + i + '"]');
    const set = (sel, text) => { const td = row.querySelector(sel); td.textContent = text; td.className = sel.slice(1) + ' ' + cls; };
    set('.v', fmt2(last));
    set('.c', sign + fmt2(chg));
    set('.p', sign + fmt2(day.ref ? chg / day.ref * 100 : 0) + '%');
    row.querySelector('.k').textContent = vol ? fmtVol(vol) : '';
  }

  // Phiên gần nhất trong dữ liệu trong ngày; giá tham chiếu = giá đóng cửa phiên trước.
  function sessionOf(bars) {
    const dayKey = (t) => Math.floor((t + VN_OFFSET) / 86400);
    const key = dayKey(bars[bars.length - 1].time);
    let start = bars.length - 1;
    while (start > 0 && dayKey(bars[start - 1].time) === key) start--;
    const d = new Date(key * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    return {
      bars: bars.slice(start),
      ref: start > 0 ? bars[start - 1].close : bars[start].open,
      day0: key * 86400 - VN_OFFSET,
      label: p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1),
    };
  }

  // Đường giá 9:00–15:00 (giờ VN): phần trên tham chiếu xanh, dưới đỏ; KL dạng cột mờ phía dưới.
  function sparkSvg(i, day) {
    const W = 300, H = 96, PH = 72; // PH: chiều cao vùng giá
    const t0 = day.day0 + 9 * 3600, t1 = day.day0 + 15 * 3600;
    const bars = day.bars.filter((b) => b.time >= t0 - 1800 && b.time <= t1);
    if (!bars.length) return '<span class="dim">Chưa có giao dịch</span>';
    let lo = day.ref, hi = day.ref, vmax = 1;
    bars.forEach((b) => { lo = Math.min(lo, b.low, b.close); hi = Math.max(hi, b.high, b.close); vmax = Math.max(vmax, b.volume); });
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const x = (t) => ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0) * W).toFixed(1);
    const y = (v) => ((hi - v) / (hi - lo) * PH + 2).toFixed(1);
    const yRef = y(day.ref);
    const pts = bars.map((b) => x(b.time) + ',' + y(b.close)).join(' ');
    const bw = Math.max(1, W / ((t1 - t0) / 300) - 0.6);
    const vols = bars.map((b) => {
      const h = (b.volume / vmax) * (H - PH - 4);
      return '<rect x="' + x(b.time) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
    }).join('');
    const ticks = [9, 10, 11, 13, 14, 15].map((h) => '<line x1="' + x(day.day0 + h * 3600) + '" x2="' + x(day.day0 + h * 3600) + '" y1="0" y2="' + (PH + 2) + '"/>').join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><clipPath id="pbu' + i + '"><rect x="0" y="0" width="' + W + '" height="' + yRef + '"/></clipPath>' +
      '<clipPath id="pbd' + i + '"><rect x="0" y="' + yRef + '" width="' + W + '" height="' + (H - yRef) + '"/></clipPath></defs>' +
      '<g class="pb-ix-grid">' + ticks + '</g>' +
      '<g class="pb-ix-bars">' + vols + '</g>' +
      '<line class="pb-ix-ref" x1="0" x2="' + W + '" y1="' + yRef + '" y2="' + yRef + '"/>' +
      '<polyline class="pb-ix-line up" clip-path="url(#pbu' + i + ')" points="' + pts + '"/>' +
      '<polyline class="pb-ix-line down" clip-path="url(#pbd' + i + ')" points="' + pts + '"/>' +
      '</svg>';
  }

  function fmtVol(v) {
    if (v >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tr';
    if (v >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' N';
    return v.toLocaleString('vi-VN');
  }

  function fmt2(v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // ---------- Trạng thái & thông báo ----------

  function setRealtime(s) {
    state.rt = s;
    $('pb-rt-dot').className = 'dot ' + (s === 'open' ? 'ok' : s === 'connecting' ? 'loading' : 'error');
    $('pb-rt-text').textContent = RT_TEXT[s] || RT_TEXT.closed;
  }

  function messageOf(err) {
    return err && err.name === 'DataError' ? err.message : 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
  }

  function hideNotice() { $('notice').hidden = true; }

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }

  // ---------- Lưu tùy chọn (chỉ trên trình duyệt này) ----------

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ group: state.group, compact: state.compact, watchlist: state.watchlist }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
