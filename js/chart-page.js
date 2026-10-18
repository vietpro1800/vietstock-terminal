// Trang Biểu đồ (chart.html), bố cục kiểu FireAnt: thanh công cụ vẽ dọc bên trái, biểu đồ kỹ thuật ở giữa,
// sổ lệnh + khớp lệnh realtime bên phải, nút chọn khoảng thời gian (5 năm … 1 ngày) phía dưới.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.chart.v1';
  const MAX_RECENT = 6;
  const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

  // Khoảng thời gian hiển thị: khung nến cần dùng và số ngày nhìn thấy.
  const RANGES = [
    { key: '5y', label: '5 năm', tf: 'W', days: 365 * 5 },
    { key: '1y', label: '1 năm', tf: 'D', days: 365 },
    { key: '6m', label: '6 tháng', tf: 'D', days: 182 },
    { key: '3m', label: '3 tháng', tf: 'D', days: 91 },
    { key: '1m', label: '1 tháng', tf: 'D', days: 30 },
    { key: '5d', label: '5 ngày', tf: '60', days: 5 },
    { key: '1d', label: '1 ngày', tf: '15', days: 1 },
  ];
  const IND_LABELS = [
    ['ma20', 'MA20'], ['ma50', 'MA50'], ['ma200', 'MA200'], ['bb', 'Bollinger (20, 2)'],
    ['vp', 'Volume profile'], ['vol', 'Khối lượng'], ['rsi', 'RSI (14)'], ['macd', 'MACD (12, 26, 9)'],
  ];
  const DEFAULT_IND = { ma20: true, ma50: true, ma200: true, bb: false, vp: true, vol: true, rsi: true, macd: false };

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.MarketRouter(
    new VST.VndirectSource({ batchSize: cfg.batchSize }),
    new VST.BinanceSource(cfg.globalAssets));
  const globalAssets = {};
  cfg.globalAssets.forEach(function (a) {
    globalAssets[a.symbol] = a;
    (a.aliases || []).forEach(function (k) { globalAssets[k] = a; });
  });
  const canonical = (s) => (globalAssets[s] ? globalAssets[s].symbol : s);

  const prefs = loadPrefs();
  const urlSymbol = (new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase();
  const state = {
    symbol: canonical(SYMBOL_RE.test(urlSymbol) ? urlSymbol : (prefs.symbol || cfg.defaultSymbol)),
    tfKey: cfg.timeframes[prefs.tfKey] ? prefs.tfKey : 'D',
    range: RANGES.some((r) => r.key === prefs.range) ? prefs.range : null,
    indicators: Object.assign({}, DEFAULT_IND, prefs.indicators),
    recent: Array.isArray(prefs.recent) ? prefs.recent.filter((s) => SYMBOL_RE.test(s)).slice(0, MAX_RECENT) : [],
    loadToken: 0,
    lastLoad: 0,
  };

  let chart = null;
  if (window.klinecharts) {
    chart = new VST.ChartView({ main: $('chart-main'), legend: $('fa-legend'), tools: $('fa-tools') },
      { toolset: 'full', valueMarks: true });
  } else {
    showNotice('Không tải được thư viện biểu đồ. Kiểm tra kết nối Internet rồi tải lại trang.');
  }
  const feed = new VST.SsiRealtimeFeed();
  const book = new VST.OrderBook($('orderbook'));
  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'chart');

  buildControls();
  selectSymbol(state.symbol);
  setInterval(tick, cfg.refreshMs);
  setInterval(renderClock, 1000);
  renderClock();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastLoad >= cfg.refreshMs) loadChart(true);
  });
  window.addEventListener('online', function () { loadChart(true); });

  // ---------- Điều khiển ----------

  function buildControls() {
    $('fa-symbol-list').innerHTML = cfg.boardSymbols.map((s) => '<option value="' + s + '">').join('') +
      cfg.globalAssets.map((a) => '<option value="' + a.symbol + '" label="' + esc(a.name) + '">').join('');
    $('fa-symbol-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const v = canonical($('fa-symbol-input').value.trim().toUpperCase().replace(/[\s/]/g, ''));
      if (!v) return;
      $('fa-symbol-input').blur();
      selectSymbol(v);
    });

    $('fa-recent').addEventListener('click', function (e) {
      const close = e.target.closest('button[data-close]');
      if (close) {
        state.recent = state.recent.filter((s) => s !== close.dataset.close);
        savePrefs();
        renderRecent();
        return;
      }
      const b = e.target.closest('button[data-symbol]');
      if (b && b.dataset.symbol !== state.symbol) selectSymbol(b.dataset.symbol);
    });

    const tfGroup = $('fa-tf');
    tfGroup.innerHTML = Object.keys(cfg.timeframes).map((k) =>
      '<button type="button" data-tf="' + k + '">' + cfg.timeframes[k].label + '</button>').join('');
    tfGroup.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-tf]');
      if (!b || b.dataset.tf === state.tfKey) return;
      state.tfKey = b.dataset.tf;
      state.range = null;
      savePrefs();
      renderTf();
      loadChart(false);
    });

    $('fa-range').innerHTML = RANGES.map((r) =>
      '<button type="button" data-range="' + r.key + '">' + r.label + '</button>').join('');
    $('fa-range').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-range]');
      if (!b) return;
      const r = RANGES.find((x) => x.key === b.dataset.range);
      state.range = r.key;
      savePrefs();
      if (r.tf !== state.tfKey) {
        state.tfKey = r.tf;
        renderTf();
        loadChart(false);
      } else {
        renderTf();
        if (chart) chart.setVisibleDays(r.days);
      }
    });
    renderTf();

    $('fa-ind-list').innerHTML = IND_LABELS.map((x) =>
      '<label class="fa-ind-item c-' + x[0] + '"><input type="checkbox" data-ind="' + x[0] + '"' +
      (state.indicators[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>').join('');
    $('fa-ind-list').addEventListener('change', function (e) {
      const cb = e.target.closest('input[data-ind]');
      if (!cb) return;
      state.indicators[cb.dataset.ind] = cb.checked;
      savePrefs();
      if (chart) chart.setIndicators(state.indicators);
    });
    // Bấm ra ngoài thì đóng danh sách chỉ báo.
    document.addEventListener('click', function (e) {
      const d = $('fa-ind');
      if (d.open && !d.contains(e.target)) d.open = false;
    });
    if (chart) chart.setIndicators(state.indicators);

    $('notice-close').addEventListener('click', hideNotice);
  }

  function renderTf() {
    $('fa-tf').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.tf === state.tfKey;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    $('fa-range').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.range === state.range;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    const tf = cfg.timeframes[state.tfKey];
    $('fa-title-tf').textContent = tf.label;
    renderRecent();
  }

  function renderRecent() {
    const tf = cfg.timeframes[state.tfKey];
    $('fa-recent').innerHTML = state.recent.map((s) => {
      const on = s === state.symbol;
      return '<span class="fa-tab' + (on ? ' active' : '') + '">' +
        '<button type="button" data-symbol="' + s + '" aria-pressed="' + on + '">' + s +
          (on ? ' <small>(' + esc(tf.label) + ')</small>' : '') + '</button>' +
        '<button type="button" class="fa-tab-x" data-close="' + s + '" aria-label="Đóng tab ' + s + '">×</button></span>';
    }).join('');
  }

  function selectSymbol(symbol) {
    const asset = globalAssets[symbol] || null;
    state.symbol = symbol;
    state.recent = [symbol].concat(state.recent.filter((s) => s !== symbol)).slice(0, MAX_RECENT);
    $('fa-symbol-input').value = '';
    $('fa-symbol-input').placeholder = symbol;
    $('fa-title-sym').textContent = asset ? asset.name : symbol;
    document.title = symbol + ' · Biểu đồ · ThảoChi Stock';
    if (chart) chart.setPrecision(asset ? asset.decimals : 2);
    book.reset(symbol, asset ? asset.decimals : 2);
    if (asset) {
      feed.pause();
      book.setUnavailable('Không có sổ lệnh · giá theo nến gần nhất');
    } else {
      feed.watch(symbol, (q) => book.push(q), (s) => book.setStatus(s));
    }
    savePrefs();
    renderRecent();
    loadChart(false);
  }

  // ---------- Dữ liệu ----------

  // keepView = true khi tự làm mới, để không mất vị trí người dùng đang xem.
  async function loadChart(keepView) {
    if (!chart) return;
    const token = ++state.loadToken;
    const symbol = state.symbol;
    const tf = cfg.timeframes[state.tfKey];
    if (!keepView) $('chart-loading').hidden = false;
    setStatus('loading', 'Đang cập nhật…');
    try {
      const bars = await source.getHistory(symbol, tf);
      if (token !== state.loadToken) return;
      chart.setData(symbol, bars, tf, keepView);
      const r = RANGES.find((x) => x.key === state.range);
      if (!keepView && r && r.tf === state.tfKey) chart.setVisibleDays(r.days);
      if (tf.resolution === 'D' && !tf.aggregate) book.setFallback(symbol, bars);
      state.lastLoad = Date.now();
      hideNotice();
      setStatus('ok', 'Cập nhật ' + new Date().toLocaleTimeString('vi-VN', { hour12: false }));
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice(err && err.name === 'DataError' ? err.message : 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.');
      setStatus('error', 'Lỗi lúc ' + new Date().toLocaleTimeString('vi-VN', { hour12: false }));
    } finally {
      if (token === state.loadToken) $('chart-loading').hidden = true;
    }
  }

  function tick() {
    if (document.hidden) return; // không gọi API khi tab bị ẩn
    loadChart(true);
  }

  // ---------- Trạng thái ----------

  function renderClock() {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    $('fa-clock').textContent = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' (UTC+7)';
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
      localStorage.setItem(STORE_KEY, JSON.stringify({
        symbol: state.symbol, tfKey: state.tfKey, range: state.range, indicators: state.indicators, recent: state.recent,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
