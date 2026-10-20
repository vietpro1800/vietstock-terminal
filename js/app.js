// Đồ thị kỹ thuật (dashboard.html, chạy trong khung index.html), bố cục kiểu FireAnt: tab mã vừa xem, công cụ vẽ dọc, biểu đồ ở giữa,
// nút chọn khoảng thời gian (5 năm … 1 ngày) phía dưới; cột phải có sổ lệnh realtime + thảo luận/tin tức/bảng giá.
// Khởi tạo, gắn sự kiện giao diện và tự làm mới.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.prefs.v1';
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

  // Đổi nguồn dữ liệu tại đây. Cổ phiếu VN: VNDirect; vàng, tiền số, ngoại hối: Binance.
  const source = new VST.MarketRouter(
    new VST.VndirectSource({ batchSize: cfg.batchSize }),
    new VST.BinanceSource(cfg.globalAssets));

  // Tra tài sản thế giới theo mã hoặc tên gọi tắt (BTC, GOLD, VANG…).
  const globalAssets = {};
  cfg.globalAssets.forEach(function (a) {
    globalAssets[a.symbol] = a;
    (a.aliases || []).forEach(function (k) { globalAssets[k] = a; });
  });
  const canonical = (s) => (globalAssets[s] ? globalAssets[s].symbol : s);

  const prefs = loadPrefs();
  // Cho phép mở thẳng một mã: dashboard.html?symbol=HPG (ví dụ từ trang RRG, Bảng giá).
  const urlSymbol = (new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase();
  const state = {
    symbol: canonical(SYMBOL_RE.test(urlSymbol) ? urlSymbol : (prefs.symbol || cfg.defaultSymbol)),
    tfKey: cfg.timeframes[prefs.tfKey] ? prefs.tfKey : cfg.defaultTimeframe,
    range: RANGES.some((r) => r.key === prefs.range) ? prefs.range : null,
    indicators: Object.assign({}, cfg.defaultIndicators, prefs.indicators),
    recent: Array.isArray(prefs.recent) ? prefs.recent.filter((s) => SYMBOL_RE.test(s)).slice(0, MAX_RECENT) : [],
    sideTab: ['chat', 'news', 'board'].indexOf(prefs.sideTab) >= 0 ? prefs.sideTab : 'chat',
    loadToken: 0,
    refreshing: false,
    lastRefresh: 0,
  };

  let chart = null;
  if (window.klinecharts) {
    chart = new VST.ChartView({ main: $('chart-main'), legend: $('legend'), tools: $('draw-tools') },
      { toolset: 'full', valueMarks: true });
  } else {
    showNotice('Không tải được thư viện biểu đồ. Kiểm tra kết nối Internet rồi tải lại trang.');
  }

  const board = new VST.PriceBoard($('board-body'), source, selectSymbol);
  // Sổ lệnh realtime (nguồn WebSocket trong data.js) và thảo luận theo mã.
  const feed = new VST.SsiRealtimeFeed();
  const book = new VST.OrderBook($('orderbook'));
  const chat = new VST.StockChat($('chat'), {
    user: ctx.user,
    profile: ctx.profile,
    onUnread: function (n) {
      $('chat-badge').textContent = n > 99 ? '99+' : n;
      $('chat-badge').hidden = !n;
    },
  });
  // Tin tức liên quan đến mã đang xem (tải khi mở tab Tin tức).
  const news = new VST.StockNews($('news'), new VST.NewsSource());
  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'dashboard');

  buildControls();
  selectSymbol(state.symbol);
  // Khung ứng dụng (js/shell.js) gọi để đổi mã khi đã mở sẵn dashboard, không tải lại trang.
  VST.dashboard = {
    selectSymbol: function (s) {
      s = canonical(String(s || '').toUpperCase());
      if (SYMBOL_RE.test(s)) selectSymbol(s);
    },
  };
  setInterval(tick, cfg.refreshMs);
  setInterval(renderClock, 1000);
  renderClock();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastRefresh >= cfg.refreshMs) refreshAll();
  });
  window.addEventListener('online', refreshAll);

  // ---------- Giao diện ----------

  function buildControls() {
    $('symbol-list').innerHTML = cfg.boardSymbols.map((s) => '<option value="' + s + '">').join('') +
      cfg.globalAssets.map((a) => '<option value="' + a.symbol + '" label="' + esc(a.name) + '">').join('');
    $('symbol-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const v = canonical($('symbol-input').value.trim().toUpperCase().replace(/[\s/]/g, ''));
      if (!v) return;
      $('symbol-input').blur();
      selectSymbol(v);
    });

    // Mở trang Phân tích mã (hội chẩn 6 vai trò) cho mã đang xem.
    $('analysis-btn').addEventListener('click', function () {
      VST.nav.open('analysis.html?symbol=' + encodeURIComponent(state.symbol));
    });

    $('recent-tabs').addEventListener('click', function (e) {
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

    const assetGroup = $('asset-group');
    assetGroup.innerHTML = cfg.globalAssets.map((a) =>
      '<button type="button" data-symbol="' + a.symbol + '" title="' + esc(a.name) + '">' + esc(a.label) + '</button>').join('');
    assetGroup.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-symbol]');
      if (b && b.dataset.symbol !== state.symbol) selectSymbol(b.dataset.symbol);
    });

    const tfGroup = $('tf-group');
    tfGroup.innerHTML = Object.keys(cfg.timeframes).map((k) =>
      '<button type="button" data-tf="' + k + '">' + cfg.timeframes[k].label + '</button>').join('');
    tfGroup.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-tf]');
      if (!btn || btn.dataset.tf === state.tfKey) return;
      state.tfKey = btn.dataset.tf;
      state.range = null;
      savePrefs();
      renderTf();
      loadChart(false);
    });

    $('range-group').innerHTML = RANGES.map((r) =>
      '<button type="button" data-range="' + r.key + '">' + r.label + '</button>').join('');
    $('range-group').addEventListener('click', function (e) {
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

    $('ind-group').innerHTML = IND_LABELS.map((x) =>
      '<label class="fa-ind-item c-' + x[0] + '"><input type="checkbox" data-ind="' + x[0] + '"' +
      (state.indicators[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>').join('');
    $('ind-group').addEventListener('change', function (e) {
      const cb = e.target.closest('input[data-ind]');
      if (!cb) return;
      state.indicators[cb.dataset.ind] = cb.checked;
      savePrefs();
      if (chart) chart.setIndicators(state.indicators);
    });
    // Bấm ra ngoài thì đóng danh sách chỉ báo.
    document.addEventListener('click', function (e) {
      const d = $('ind-menu');
      if (d.open && !d.contains(e.target)) d.open = false;
    });
    if (chart) chart.setIndicators(state.indicators);

    $('notice-close').addEventListener('click', hideNotice);

    $('side-tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      state.sideTab = b.dataset.tab;
      savePrefs();
      renderSideTab();
    });
    renderSideTab();
  }

  function renderSideTab() {
    $('side-tabs').querySelectorAll('button[data-tab]').forEach(function (b) {
      const on = b.dataset.tab === state.sideTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('pane-chat').hidden = state.sideTab !== 'chat';
    $('pane-news').hidden = state.sideTab !== 'news';
    $('pane-board').hidden = state.sideTab !== 'board';
    chat.setVisible(state.sideTab === 'chat');
    news.setVisible(state.sideTab === 'news');
  }

  function renderTf() {
    const mark = (sel, on) => document.querySelectorAll(sel).forEach(function (b) {
      b.classList.toggle('active', on(b));
      b.setAttribute('aria-pressed', on(b));
    });
    mark('#tf-group button', (b) => b.dataset.tf === state.tfKey);
    mark('#range-group button', (b) => b.dataset.range === state.range);
    $('chart-tf').textContent = cfg.timeframes[state.tfKey].label;
    renderRecent();
  }

  function renderRecent() {
    const tf = cfg.timeframes[state.tfKey];
    $('recent-tabs').innerHTML = state.recent.map((s) => {
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
    $('symbol-input').value = '';
    $('symbol-input').placeholder = symbol;
    $('chart-title').textContent = symbol;
    $('chart-name').textContent = asset ? asset.name : '';
    document.title = symbol + ' · ThảoChi Stock';
    $('asset-group').querySelectorAll('button[data-symbol]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.symbol === symbol);
      b.setAttribute('aria-pressed', b.dataset.symbol === symbol);
    });
    board.setActive(symbol);
    if (chart) chart.setPrecision(asset ? asset.decimals : 2);
    book.reset(symbol, asset ? asset.decimals : 2);
    if (asset) {
      // Sổ lệnh realtime chỉ có cho cổ phiếu VN (bảng giá SSI).
      feed.pause();
      book.setUnavailable('Không có sổ lệnh · giá theo nến gần nhất');
    } else {
      feed.watch(symbol, (q) => book.push(q), (s) => book.setStatus(s));
    }
    chat.setSymbol(symbol);
    news.setSymbol(symbol, asset ? asset.news : null, asset ? asset.label : symbol);
    savePrefs();
    renderRecent();
    if (state.lastRefresh === 0) refreshAll();
    else loadChart(false);
    if (window.innerWidth < 768) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Dữ liệu ----------

  // keepView = true khi tự làm mới, để không mất vị trí người dùng đang xem.
  async function loadChart(keepView) {
    if (!chart) return;
    const token = ++state.loadToken;
    const symbol = state.symbol;
    const tf = cfg.timeframes[state.tfKey];
    if (!keepView) $('chart-loading').hidden = false;
    try {
      const bars = await source.getHistory(symbol, tf);
      if (token !== state.loadToken) return; // đã có yêu cầu mới hơn
      chart.setData(symbol, bars, tf, keepView);
      const r = RANGES.find((x) => x.key === state.range);
      if (!keepView && r && r.tf === state.tfKey) chart.setVisibleDays(r.days);
      // Nến ngày cho sổ lệnh hiện giá tham khảo khi chưa có dữ liệu realtime.
      if (tf.resolution === 'D' && !tf.aggregate) book.setFallback(symbol, bars);
      return true;
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice(messageOf(err));
      return false;
    } finally {
      if (token === state.loadToken) $('chart-loading').hidden = true;
    }
  }

  async function refreshBoard() {
    try {
      const errors = await board.refresh(cfg.boardSymbols);
      if (errors.length === cfg.boardSymbols.length) {
        showNotice('Không tải được bảng giá. ' + messageOf(errors[0]));
        return false;
      }
      if (errors.length) {
        showNotice('Không tải được ' + errors.length + ' mã trong bảng giá: ' +
          errors.map((e) => e.symbol).join(', ') + '.');
        return 'partial';
      }
      return true;
    } catch (err) {
      showNotice(messageOf(err));
      return false;
    }
  }

  async function refreshAll() {
    if (state.refreshing) return;
    state.refreshing = true;
    setStatus('loading', 'Đang cập nhật…');
    const first = state.lastRefresh === 0;
    const results = await Promise.all([loadChart(!first), refreshBoard()]);
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

  // ---------- Thông báo ----------

  function renderClock() {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    $('clock').textContent = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' (UTC+7)';
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
      localStorage.setItem(STORE_KEY, JSON.stringify({
        symbol: state.symbol, tfKey: state.tfKey, range: state.range, indicators: state.indicators,
        recent: state.recent, sideTab: state.sideTab,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
